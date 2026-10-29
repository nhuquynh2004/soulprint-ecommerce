// Unit test thanh toán online (services/payment.js, services/paymentGateway.js), không cần kết nối MongoDB
const test = require("node:test")
const assert = require("node:assert/strict")

process.env.MONGODB_URI ||= "mongodb://localhost/test"
const { ObjectId } = require("mongodb")
const payment = require("../services/payment")
const { gateway } = require("../services/paymentGateway")

test("mã giao dịch GD + yyMMdd giờ Việt Nam + 4 số", () => {
  // 18:30 UTC ngày 11/10 là 01:30 ngày 12/10 giờ Việt Nam
  assert.equal(payment.paymentCode(new Date("2026-10-11T18:30:00Z"), 7), "GD2610120007")
  assert.equal(payment.paymentCode(new Date("2026-10-15T03:00:00Z"), 1234), "GD2610151234")
})

test("nội dung giao dịch theo lựa chọn thanh toán", () => {
  assert.equal(payment.describe({ key: "DEPOSIT_COD" }, 0.5), "Đặt cọc 50% món cá nhân hóa")
  assert.equal(payment.describe({ key: "DEPOSIT_COD" }, 0.4), "Đặt cọc 40% món cá nhân hóa")
  assert.equal(payment.describe({ key: "ONLINE" }, 0.5), "Thanh toán toàn bộ đơn hàng")
})

test("chỉ giữ các trường khách nhập ở SCR-07 để thử lại", () => {
  const kept = payment.pickRequest({ contact: { fullName: "A" }, paymentChoice: "ONLINE", expectedTotal: 614100, role: "admin", $where: "x" })
  assert.deepEqual(kept, { contact: { fullName: "A" }, paymentChoice: "ONLINE", expectedTotal: 614100 })
})

test("cổng giả lập: kết quả có chữ ký đúng thì đọc được, sửa dữ liệu hoặc chữ ký thì bị từ chối (5bEb)", () => {
  const p = { _id: new ObjectId(), code: "GD2610120001", providerTransId: "MOCK-GD2610120001" }
  const body = gateway.resultFor(p, "success")
  assert.deepEqual(gateway.verifyCallback(body), { paymentId: String(p._id), result: "success", providerTransId: "MOCK-GD2610120001" })

  const tampered = { data: body.data.replace("success", "fail"), mac: body.mac }
  assert.equal(gateway.verifyCallback(tampered), null)
  assert.equal(gateway.verifyCallback({ data: body.data, mac: "0".repeat(64) }), null)
  assert.equal(gateway.verifyCallback({ data: body.data, mac: "abc" }), null)
  assert.equal(gateway.verifyCallback({}), null)
  assert.equal(gateway.verifyCallback(null), null)
})

// Ví dụ 06 Mục 7.2: món cá nhân hóa 399.000đ + món thường 250.000đ, ship 30.000đ, voucher 10% -> cọc 199.500đ
const depositSnap = {
  contact: { fullName: "Nguyễn Minh Anh", phone: "0901234567" },
  lines: [{ quantity: 1 }, { quantity: 1 }],
  money: { total: 614100, depositAmount: 199500, remainingAmount: 414600 },
  option: { key: "DEPOSIT_COD", amountDueNow: 199500 },
}

test("API-39 trả số tiền, phần còn lại, người thanh toán cho SCR-08 (AC3)", () => {
  const v = payment.view({
    _id: new ObjectId(), code: "GD2610150001", purpose: "ORDER", amount: 199500, status: "PENDING", description: "Đặt cọc 50% món cá nhân hóa",
    expiresAt: new Date(), checkoutSnapshot: depositSnap, checkoutRequest: { paymentChoice: "ONLINE", remainingMethod: "COD" },
  })
  assert.equal(v.amount, 199500)
  assert.equal(v.total, 614100)
  assert.equal(v.remainingAmount, 414600)
  assert.equal(v.payerName, "Nguyễn Minh Anh")
  assert.equal(v.itemCount, 2)
  assert.equal(v.expired, false)
  assert.deepEqual(v.checkout, { paymentChoice: "ONLINE", remainingMethod: "COD" })
})

test("trả trước 100% không có phần còn lại; hết hạn thì expired = true", () => {
  const full = { ...depositSnap, option: { key: "ONLINE", amountDueNow: 614100 } }
  const v = payment.view({ _id: new ObjectId(), purpose: "ORDER", amount: 614100, status: "FAILED", failReason: "HET_HAN", checkoutSnapshot: full })
  assert.equal(v.remainingAmount, 0)
  assert.equal(v.expired, true)
  const failed = payment.view({ _id: new ObjectId(), purpose: "ORDER", amount: 614100, status: "FAILED", failReason: "THAT_BAI", checkoutSnapshot: full })
  assert.equal(failed.expired, false)
})

test("liên kết đơn nháp thất bại còn hạn thì Thử lại được; hết hạn, nhân viên hủy, đã thay liên kết thì không", () => {
  const now = new Date("2026-10-26T13:40:00Z")
  const p = { _id: new ObjectId(), purpose: "ORDER", draftCode: "D12", status: "FAILED", failReason: "THAT_BAI", checkoutSnapshot: {} }
  const d = { status: "DA_GUI_LINK", paymentId: p._id, paymentExpiresAt: new Date("2026-10-26T14:24:00Z") }
  assert.equal(payment.draftRetryable(p, d, now), true)
  assert.equal(payment.draftRetryable({ ...p, failReason: "KHACH_HUY" }, d, now), true)
  assert.equal(payment.draftRetryable(p, { ...d, paymentExpiresAt: new Date("2026-10-26T13:30:00Z") }, now), false)
  assert.equal(payment.draftRetryable({ ...p, failReason: "KHACH_HUY", failMessage: "Liên kết đã bị hủy" }, d, now), false)
  assert.equal(payment.draftRetryable(p, { ...d, status: "MO" }, now), false)
  assert.equal(payment.draftRetryable({ ...p, checkoutSnapshot: { urgentCode: "G1" } }, d, now), false)
  // Liên kết cũ mở lại sau khi đã thử lại: cùng chuỗi giao dịch thì vẫn dẫn tới phiên mới
  const next = { _id: new ObjectId(), retryOf: p._id }
  assert.equal(payment.draftRetryable(p, { ...d, paymentId: next._id }, now, next), true)
  assert.equal(payment.draftRetryable(p, { ...d, paymentId: next._id }, now, { _id: next._id, retryOf: null }), false)
})
