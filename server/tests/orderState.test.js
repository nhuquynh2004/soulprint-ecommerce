// Unit test quy tắc trạng thái đơn phía khách (services/orderState.js), không cần kết nối MongoDB
const test = require("node:test")
const assert = require("node:assert/strict")
const s = require("../services/orderState")

const at = (iso) => new Date(iso)
const order = (extra = {}) => ({
  orderStatus: "CHO_XAC_NHAN", paymentStatus: "CHUA_THANH_TOAN", paidAmount: 0, refundedAmount: 0, hasPersonalizedItems: false,
  items: [{ fulfillStatus: "BINH_THUONG", reviewed: false }], createdAt: at("2026-10-15T02:12:00Z"),
  statusHistory: [{ field: "orderStatus", to: "CHO_XAC_NHAN", at: at("2026-10-15T02:12:00Z") }],
  ...extra,
})

test("tab: Đang cá nhân hóa nằm ở Đang xử lý, Hoàn thành ở Đã giao (TRK-02 AC1, 05 Mục 2.5)", () => {
  assert.equal(s.tabOf("DANG_CA_NHAN_HOA"), "dang-xu-ly")
  assert.equal(s.tabOf("DANG_CHUAN_BI"), "dang-xu-ly")
  assert.equal(s.tabOf("HOAN_THANH"), "da-giao")
  assert.equal(s.tabOf("DA_HUY"), "da-huy")
})

test("BR-27: đơn thường hủy được ở Chờ xác nhận và Đang chuẩn bị; đơn cá nhân hóa chỉ ở Chờ xác nhận (CNL-02 AC3, AC5, TRK-02 AC4)", () => {
  assert.equal(s.canCancel(order()), true)
  assert.equal(s.canCancel(order({ orderStatus: "DANG_CHUAN_BI" })), true)
  assert.equal(s.canCancel(order({ orderStatus: "DANG_CHUAN_BI", hasPersonalizedItems: true })), false)
  assert.equal(s.canCancel(order({ orderStatus: "DANG_CA_NHAN_HOA", hasPersonalizedItems: true })), false)
  assert.equal(s.canCancel(order({ orderStatus: "DANG_VAN_CHUYEN" })), false)
  assert.equal(s.actions(order({ orderStatus: "DANG_VAN_CHUYEN" })).cancel, false)
})

test("BR-28: COD chưa trả là TH1; đã cọc chưa bắt đầu cá nhân hóa là TH2; đã bắt đầu là TH3 (CNL-02 AC1, AC2, AC4)", () => {
  assert.equal(s.cancelCase(order()), "TH1")
  const deposit = order({ hasPersonalizedItems: true, paidAmount: 199500, paymentStatus: "DA_COC" })
  assert.equal(s.cancelCase(deposit), "TH2")
  assert.equal(s.refundOnCancel(deposit), 199500)
  assert.equal(s.cancelCase(order({ paidAmount: 430000 })), "TH2")
  assert.equal(s.cancelCase({ ...deposit, personalizationStartedAt: at("2026-10-15T03:30:00Z") }), "TH3")
})

test("nút theo trường hợp hủy: TH1 chỉ Đặt lại; TH2 thêm Nhận tiền hoàn khi chưa có yêu cầu; TH3 không Đặt lại (CNL-01 AC1, CNL-03 AC3)", () => {
  const th1 = s.actions(order({ orderStatus: "DA_HUY", cancelCase: "TH1" }))
  assert.equal(th1.reorder, true)
  assert.equal(th1.refund, false)
  const th2 = order({ orderStatus: "DA_HUY", cancelCase: "TH2", paidAmount: 199500 })
  assert.equal(s.actions(th2).refund, true)
  assert.equal(s.actions(th2, { refund: { status: "CHO_XU_LY" } }).refund, false)
  const th3 = s.actions(order({ orderStatus: "DA_HUY", cancelCase: "TH3", paidAmount: 199500, storageStatus: "DANG_LUU_KHO" }))
  assert.equal(th3.reorder, false)
  assert.equal(th3.redelivery, true)
})

test("đơn đã giao 3 ngày trước: có Đổi/trả, Đánh giá, Mua lại; quá 7 ngày thì hết Đổi/trả (TRK-02 AC6, BR-12)", () => {
  const now = at("2026-10-20T03:00:00Z")
  const done = order({ orderStatus: "HOAN_THANH", deliveredAt: at("2026-10-17T03:00:00Z") })
  const a = s.actions(done, { now })
  assert.deepEqual([a.return, a.review, a.reorder, a.received, a.cancel], [true, true, true, false, false])
  assert.equal(s.actions({ ...done, deliveredAt: at("2026-10-12T02:00:00Z") }, { now }).return, false)
  assert.equal(s.actions(order({ orderStatus: "DA_GIAO", deliveredAt: now }), { now }).received, true)
})

test("timeline đơn thường không có mốc Đang cá nhân hóa, mốc chưa tới có ngày dự kiến (TRK-02 AC3)", () => {
  const t = s.timeline(order())
  assert.deepEqual(t.map((x) => x.status), ["CHO_XAC_NHAN", "DANG_CHUAN_BI", "DANG_VAN_CHUYEN", "DA_GIAO", "HOAN_THANH"])
  assert.equal(t[0].state, "current")
  assert.deepEqual(t[1].expected, { from: "2026-10-16", to: "2026-10-16" })
  assert.deepEqual(t[3].expected, { from: "2026-10-18", to: "2026-10-19" })
  assert.equal(t[4].expected, null)
})

test("timeline đơn cá nhân hóa có mốc Đang cá nhân hóa; đơn hủy chèn mốc Đã hủy, mốc sau không dự kiến", () => {
  const p = order({
    hasPersonalizedItems: true, orderStatus: "DANG_CA_NHAN_HOA",
    statusHistory: [
      { field: "orderStatus", to: "CHO_XAC_NHAN", at: at("2026-10-15T02:12:00Z") },
      { field: "orderStatus", to: "DANG_CA_NHAN_HOA", at: at("2026-10-15T03:30:00Z") },
    ],
  })
  const t = s.timeline(p)
  assert.equal(t[1].status, "DANG_CA_NHAN_HOA")
  assert.equal(t[1].state, "current")
  assert.deepEqual(t[2].expected, { from: "2026-10-16", to: "2026-10-16" })

  const c = s.timeline(order({ orderStatus: "DA_HUY", cancelledAt: at("2026-10-15T08:02:00Z") }))
  assert.deepEqual(c.map((x) => x.status).slice(0, 3), ["CHO_XAC_NHAN", "DA_HUY", "DANG_CHUAN_BI"])
  assert.equal(c[1].state, "cancelled")
  assert.equal(c[2].expected, null)
})

test("lịch sử chi tiết mới nhất trước, có nhãn trạng thái thanh toán", () => {
  const h = s.history(order({
    statusHistory: [
      { field: "orderStatus", to: "CHO_XAC_NHAN", at: at("2026-10-15T02:12:00Z") },
      { field: "paymentStatus", to: "DA_COC", at: at("2026-10-15T02:13:00Z") },
    ],
  }))
  assert.deepEqual(h.map((x) => x.label), ["Đã đặt cọc", "Chờ xác nhận"])
})

test("che thông tin khi xem qua tra cứu đơn (SCR-24)", () => {
  assert.equal(s.maskName("Phan Ngọc Bảo"), "Ph*** N*** B***")
  assert.equal(s.maskName("Minh"), "Mi***")
  assert.equal(s.maskPhone("0901234567"), "0901 *** 567")
  assert.equal(s.maskPhoneShort("0901234567"), "090 *** ****")
  assert.equal(s.maskStreet("12 Nguyễn Văn Bảo"), "12 Ng***")
  assert.equal(s.maskStreet("Hẻm 5"), "Hẻ***")
  assert.equal(s.maskWard("Phường Bến Nghé"), "P***")
  assert.equal(s.maskAccount("0071003456"), "****3456")
})

test("tài khoản nhận tiền hoàn: tên viết hoa bỏ dấu, số tài khoản 6-20 chữ số (UC-CNL-02 3Eb)", () => {
  const ok = s.readRefundAccount({ bankName: "Vietcombank", accountNumber: "0071 0034 56", accountName: "Nguyễn Minh Anh" })
  assert.deepEqual(ok.account, { bankName: "Vietcombank", accountNumber: "0071003456", accountName: "NGUYEN MINH ANH" })
  assert.ok(Object.values(ok.errors).every((e) => !e))
  const bad = s.readRefundAccount({ bankName: "", accountNumber: "12ab", accountName: "" })
  assert.ok(bad.errors["refundAccount.bankName"] && bad.errors["refundAccount.accountNumber"] && bad.errors["refundAccount.accountName"])
})

test("lọc thời gian: mặc định 3 tháng, Tất cả không giới hạn", () => {
  const now = at("2026-10-12T00:00:00Z")
  assert.equal(s.rangeStart("3m", now).toISOString().slice(0, 7), "2026-07")
  assert.equal(s.rangeStart("lung-tung", now).toISOString().slice(0, 7), "2026-07")
  assert.equal(s.rangeStart("all", now), null)
})

test("NFR-REL-06: phiên bản đơn đổi khi người xem thấy thay đổi, ghi chú nội bộ chỉ đổi phía nhân viên", () => {
  const base = { orderStatus: "CHO_XAC_NHAN", paymentStatus: "CHUA_THANH_TOAN", total: 300000, items: [{ _id: "a", variantSku: "V", quantity: 1 }], statusHistory: [{}], internalNotes: [] }
  const noted = { ...base, internalNotes: [{ text: "ghi chú" }], updatedAt: new Date() }
  assert.equal(s.orderVersion(noted), s.orderVersion(base))
  assert.notEqual(s.orderVersion(noted, { staff: true }), s.orderVersion(base, { staff: true }))
  assert.notEqual(s.orderVersion({ ...base, orderStatus: "DANG_CHUAN_BI" }), s.orderVersion(base))
  assert.notEqual(s.orderVersion({ ...base, shippingAddress: { street: "Số 2" } }), s.orderVersion(base))
})
