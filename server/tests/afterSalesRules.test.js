// Unit test quy tắc hậu mãi (services/afterSalesRules.js), không cần kết nối MongoDB
const test = require("node:test")
const assert = require("node:assert/strict")
const r = require("../services/afterSalesRules")
const st = require("../services/orderState")

const at = (iso) => new Date(iso)
const NOW = at("2026-10-20T03:00:00Z")
const DAY = 24 * 60 * 60 * 1000
const order = (extra = {}) => ({
  code: "SP2610100001", orderStatus: "DA_GIAO", returnStatus: "KHONG_CO", paidAmount: 430000, refundedAmount: 0, total: 430000,
  deliveredAt: new Date(NOW.getTime() - 3 * DAY),
  items: [
    { _id: "a", name: "Áo đấu", quantity: 1, lineValue: 150000, isPersonalized: false, fulfillStatus: "BINH_THUONG" },
    { _id: "b", name: "Bình khắc tên", quantity: 2, lineValue: 250000, isPersonalized: true, fulfillStatus: "BINH_THUONG" },
  ],
  ...extra,
})
const body = (extra = {}) => ({ items: [{ orderItemId: "a", quantity: 1, reason: "DOI_Y" }], resolution: "HOAN_TIEN", conditionConfirmed: true, ...extra })

test("BR-12: còn nút đổi trả khi giao 6 ngày trước, mất khi giao 8 ngày trước (TRK-04 AC1)", () => {
  assert.equal(r.canReturn(order({ deliveredAt: new Date(NOW - 6 * DAY) }), NOW), true)
  assert.equal(r.canReturn(order({ deliveredAt: new Date(NOW - 8 * DAY) }), NOW), false)
  const e = r.checkReturn(order({ deliveredAt: new Date(NOW - 8 * DAY) }), body(), { now: NOW }).error
  assert.equal(e.rule, "BR-12")
})

test("TRK-04 AC5: đơn đã Hoàn thành, giao 5 ngày trước vẫn gửi được yêu cầu", () => {
  assert.equal(r.canReturn(order({ orderStatus: "HOAN_THANH", deliveredAt: new Date(NOW - 5 * DAY) }), NOW), true)
})

test("BR-14: lý do Đổi ý với sản phẩm cá nhân hóa bị từ chối 422 (TRK-04 AC2)", () => {
  const e = r.checkReturn(order(), body({ items: [{ orderItemId: "b", quantity: 1, reason: "DOI_Y" }] }), { imageCount: 1, now: NOW }).error
  assert.equal(e.status, 422)
  assert.equal(e.rule, "BR-14")
})

test("BR-31: Lỗi in/khắc không có ảnh bị từ chối 422; món cá nhân hóa luôn cần ảnh (TRK-04 AC3)", () => {
  const e1 = r.checkReturn(order(), body({ items: [{ orderItemId: "a", quantity: 1, reason: "LOI_IN_KHAC" }] }), { imageCount: 0, now: NOW }).error
  assert.equal(e1.rule, "BR-31")
  const e2 = r.checkReturn(order(), body({ items: [{ orderItemId: "b", quantity: 1, reason: "GIAO_SAI" }] }), { imageCount: 0, now: NOW }).error
  assert.equal(e2.rule, "BR-31")
  // Giao sai sản phẩm không cá nhân hóa thì ảnh không bắt buộc
  assert.ok(r.checkReturn(order(), body({ items: [{ orderItemId: "a", quantity: 1, reason: "GIAO_SAI" }] }), { imageCount: 0, now: NOW }).value)
})

test("BR-13: sản phẩm không cá nhân hóa cần xác nhận tình trạng; món cá nhân hóa thì không", () => {
  assert.equal(r.checkReturn(order(), body({ conditionConfirmed: false }), { now: NOW }).error.rule, "BR-13")
  const v = r.checkReturn(order(), body({ items: [{ orderItemId: "b", quantity: 1, reason: "LOI_IN_KHAC" }], conditionConfirmed: false }), { imageCount: 2, now: NOW }).value
  assert.equal(v.items[0].lineValue, 125000)
})

test("Kiểm tra trường: số lượng vượt dòng, thiếu hình thức, đơn đang có yêu cầu", () => {
  assert.equal(r.checkReturn(order(), body({ items: [{ orderItemId: "b", quantity: 3, reason: "HU_HONG" }] }), { imageCount: 1, now: NOW }).error.status, 400)
  assert.ok(r.checkReturn(order(), body({ resolution: "" }), { now: NOW }).error.fields.resolution)
  assert.equal(r.checkReturn(order({ returnStatus: "DANG_YEU_CAU" }), body(), { now: NOW }).error.status, 409)
  assert.equal(r.checkReturn(order(), body(), { imageCount: 6, now: NOW }).error.status, 400)
})

test("Số hoàn mặc định = giá trị dòng trả, không vượt phần đã trả chưa hoàn (OPS-07 AC2, 6Ea)", () => {
  const req = { items: [{ orderItemId: "a", quantity: 1, lineValue: 150000 }] }
  assert.equal(r.defaultRefund(req, order()), 150000)
  assert.equal(r.defaultRefund(req, order({ refundedAmount: 330000 })), 100000)
})

test("Trạng thái thanh toán sau hoàn: hoàn 150.000đ của 430.000đ là hoàn một phần (OPS-07 AC2); đơn hủy hoàn đủ là Đã hoàn tiền (CNL-05 AC3)", () => {
  assert.equal(r.paymentStatusAfterRefund(order(), 150000, 280000), "HOAN_TIEN_MOT_PHAN")
  const cancelled = order({ orderStatus: "DA_HUY", cancelBy: "REFUSED", refusedShippingFee: 30000 })
  assert.equal(r.paymentStatusAfterRefund(cancelled, 400000, st.refundOnCancel({ ...cancelled, refundedAmount: 400000 })), "DA_HOAN_TIEN")
})

test("Tiến trình đổi trả: Đã gửi → Đang xem xét → Shipper lấy hàng → Hoàn tiền", () => {
  const p = r.returnProgress({ status: "DONG_Y", resolution: "HOAN_TIEN", createdAt: NOW, decidedAt: NOW })
  assert.deepEqual(p.map((x) => x.state), ["done", "done", "current", "todo"])
  assert.equal(p[3].label, "Hoàn tiền")
  assert.deepEqual(r.returnProgress({ status: "DA_HOAN_TAT", resolution: "GIAO_LAI" }).map((x) => x.state), ["done", "done", "done", "done"])
})

test("BR-17: đồng hồ 12 tháng giao 11 tháng trước còn bảo hành, phụ kiện 6 tháng giao 7 tháng trước hết hạn (TRK-05 AC1, AC2)", () => {
  const delivered11 = new Date(NOW)
  delivered11.setMonth(delivered11.getMonth() - 11)
  const s1 = r.warrantyState(order({ deliveredAt: delivered11 }), order().items[0], 12, { now: NOW })
  assert.equal(s1.allowed, true)
  const delivered7 = new Date(NOW)
  delivered7.setMonth(delivered7.getMonth() - 7)
  const s2 = r.warrantyState(order({ deliveredAt: delivered7 }), order().items[0], 6, { now: NOW })
  assert.equal(s2.expired, true)
  assert.equal(s2.allowed, false)
  // 3Eb: đang có yêu cầu chưa kết thúc
  assert.equal(r.warrantyState(order({ deliveredAt: delivered11 }), order().items[0], 12, { openCount: 1, now: NOW }).allowed, false)
  // Không có bảo hành
  assert.equal(r.warrantyState(order(), order().items[0], 0, { now: NOW }).allowed, false)
})

test("Bảo hành không có ảnh bị từ chối BR-31 (TRK-05 AC3); thiếu hiện tượng báo lỗi tại trường", () => {
  assert.equal(r.checkWarranty({ symptom: "KHONG_HOAT_DONG", description: "Không lên đèn", shippingMethod: "TU_GUI" }, { imageCount: 0 }).error.rule, "BR-31")
  assert.ok(r.checkWarranty({ description: "x", shippingMethod: "TU_GUI" }, { imageCount: 1 }).error.fields.symptom)
  assert.ok(r.checkWarranty({ symptom: "KHAC", description: "Bị lỏng dây", shippingMethod: "SHIPPER_LAY" }, { imageCount: 1 }).value)
})

test("Tab Yêu cầu hậu mãi theo tiến độ (05 Mục 2.6)", () => {
  assert.equal(r.stageOf("RETURN", "DANG_YEU_CAU"), "cho-duyet")
  assert.equal(r.stageOf("REFUND", "THAT_BAI"), "cho-hoan-tien")
  assert.equal(r.stageOf("REFUND", "CHO_XU_LY"), "cho-hoan-tien")
  assert.equal(r.stageOf("WARRANTY", "DA_DUYET"), "dang-gui-ve")
  assert.equal(r.stageOf("RETURN", "DA_NHAN_HANG"), "da-nhan")
  assert.equal(r.stageOf("REFUND", "DA_HOAN"), "hoan-tat")
  assert.equal(r.stageOf("WARRANTY", "TU_CHOI"), "tu-choi")
})

test("BR-32: đổi trả chờ duyệt là Khẩn cấp, bảo hành chờ xem xét là Cần chú ý (OPS-07 AC1)", () => {
  const p = r.requestPriority("RETURN", { status: "DANG_YEU_CAU", slaDeadline: new Date(NOW.getTime() + 5 * 3600000) }, NOW)
  assert.equal(p.level, "KHAN_CAP")
  assert.equal(r.requestPriority("WARRANTY", { status: "DANG_XEM_XET" }, NOW).level, "CAN_CHU_Y")
  assert.equal(r.requestPriority("REFUND", { status: "CHO_XU_LY", bankInfo: null }, NOW).reason, "Chờ khách nhập tài khoản")
  assert.equal(r.requestPriority("RETURN", { status: "DA_HOAN_TAT" }, NOW).level, "BINH_THUONG")
})

test("Nút theo quyền: vai trò Kho chỉ xác nhận nhận hàng (OPS-07 AC7); Hoàn tiền ngay không qua Đồng ý (AC6)", () => {
  const kho = (c) => ["HAU_MAI.XEM", "HAU_MAI.XAC_NHAN_NHAN_HANG"].includes(c)
  const all = () => true
  assert.equal(r.returnActions({ status: "DANG_YEU_CAU" }, kho).approve, false)
  assert.equal(r.returnActions({ status: "DONG_Y" }, kho).received, true)
  assert.equal(r.returnActions({ status: "DANG_YEU_CAU" }, all).refundNow, true)
  // Đã tạo đơn thay thế: chờ đơn được giao, không hoàn tất hay từ chối nữa
  const waiting = r.returnActions({ status: "DA_NHAN_HANG", replacementOrderCode: "SP2610200001" }, all)
  assert.equal(waiting.complete || waiting.reject || waiting.refundNow, false)
  // Hoàn tiền chưa có tài khoản: không bấm Đã chuyển khoản được
  assert.equal(r.refundActions({ status: "CHO_XU_LY", method: "BANK_TRANSFER", bankInfo: null }, all).markPaid, false)
  assert.equal(r.refundActions({ status: "DA_HOAN", method: "BANK_TRANSFER", bankInfo: {} }, all).markPaid, false)
  // Chưa có tài khoản thì chưa chuyển nên không có "Chuyển khoản thất bại"
  assert.equal(r.refundActions({ status: "CHO_XU_LY", method: "BANK_TRANSFER", bankInfo: null }, all).markFailed, false)
  assert.equal(r.refundActions({ status: "CHO_XU_LY", method: "BANK_TRANSFER", bankInfo: { accountNumber: "0123456789" } }, all).markFailed, true)
})

test("Nhãn khoản hoàn đang chờ tách theo việc cần làm", () => {
  assert.equal(r.refundStatusLabel({ status: "CHO_XU_LY", method: "BANK_TRANSFER", bankInfo: null }), "Chờ khách nhập tài khoản")
  assert.equal(r.refundStatusLabel({ status: "CHO_XU_LY", method: "BANK_TRANSFER", bankInfo: { accountNumber: "1" } }), "Chờ chuyển khoản")
  assert.equal(r.refundStatusLabel({ status: "CHO_XU_LY", method: "GATEWAY" }), "Chờ hoàn qua cổng")
  assert.equal(r.refundStatusLabel({ status: "DA_HOAN" }), "Đã hoàn")
})

test("Đánh giá: tên che dạng M*** A (TRK-03 AC5), nhận xét tối đa 500 ký tự, điểm thích lạ bị bỏ", () => {
  assert.equal(r.hiddenName("Nguyễn Minh Anh"), "M*** A")
  assert.equal(r.hiddenName("Hà"), "H***")
  assert.equal(r.checkReview({ rating: 0 }).error.fields.rating, "Chọn số sao")
  assert.ok(r.checkReview({ rating: 5, comment: "a".repeat(501) }).error.fields.comment)
  assert.deepEqual(r.checkReview({ rating: 4, likes: ["GIAO_NHANH", "LA", "GIAO_NHANH"] }).value.likes, ["GIAO_NHANH"])
})

test("Nút khách: nhập lại tài khoản khi chuyển khoản thất bại thay cho Nhận tiền hoàn (CNL-05 5a)", () => {
  const o = order({ orderStatus: "DA_HUY", cancelCase: "TH2", deliveredAt: null })
  const a = st.actions(o, { now: NOW, refund: { status: "THAT_BAI", method: "BANK_TRANSFER", bankInfo: {} } })
  assert.equal(a.refundAccount, true)
  assert.equal(a.refund, false)
  assert.equal(st.actions(o, { now: NOW }).refund, true)
})

test("Timeline đơn nhận lại hàng giữ mốc Đã hủy, các mốc sau tính từ lúc giao lại (CNL-04)", () => {
  const t0 = at("2026-10-01T03:00:00Z")
  const h = (to, d) => ({ field: "orderStatus", to, at: new Date(t0.getTime() + d * DAY) })
  const o = {
    orderStatus: "DANG_CHUAN_BI", hasPersonalizedItems: true, createdAt: t0, cancelledAt: new Date(t0.getTime() + 5 * DAY), redeliveredAt: new Date(t0.getTime() + 7 * DAY),
    statusHistory: [h("CHO_XAC_NHAN", 0), h("DANG_CA_NHAN_HOA", 1), h("DANG_CHUAN_BI", 3), h("DANG_VAN_CHUYEN", 4), h("DA_HUY", 5), h("DANG_CHUAN_BI", 7)],
  }
  const t = st.timeline(o)
  assert.deepEqual(t.map((x) => x.status), ["CHO_XAC_NHAN", "DANG_CA_NHAN_HOA", "DA_HUY", "DANG_CHUAN_BI", "DANG_VAN_CHUYEN", "DA_GIAO", "HOAN_THANH"])
  assert.equal(t[3].state, "current")
  assert.equal(t[4].state, "todo")
})
