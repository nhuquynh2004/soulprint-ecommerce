// Unit test quy tắc vận hành đơn phía quản trị (services/opsRules.js), không cần kết nối MongoDB
const test = require("node:test")
const assert = require("node:assert/strict")
const r = require("../services/opsRules")
const st = require("../services/orderState")

const at = (iso) => new Date(iso)
const NOW = at("2026-10-16T03:00:00Z")
const order = (extra = {}) => ({
  code: "SP2610150001", orderStatus: "CHO_XAC_NHAN", paymentStatus: "CHUA_THANH_TOAN", paymentMethod: "COD", paidAmount: 0, refundedAmount: 0,
  hasPersonalizedItems: false, total: 430000, depositAmount: 0, shippingFee: 30000, giftWrapFee: 0, discount: 0,
  items: [{ _id: "a", productId: "p1", variantSku: "AO-M", name: "Áo", unitPrice: 200000, quantity: 2, personalizationFeePerUnit: 0, lineValue: 400000, fulfillStatus: "BINH_THUONG" }],
  createdAt: at("2026-10-16T01:00:00Z"), statusHistory: [{ field: "orderStatus", to: "CHO_XAC_NHAN", at: at("2026-10-16T01:00:00Z") }],
  ...extra,
})
const all = () => true
const only = (...codes) => (c) => codes.includes(c)

test("BR-32: đơn có yêu cầu đổi trả chờ xử lý xếp trên đơn mới và có nhãn Khẩn cấp (OPS-01 AC2)", () => {
  const fresh = { ...order({ code: "B", createdAt: at("2026-10-16T02:50:00Z") }) }
  const ret = { ...order({ code: "A", orderStatus: "DA_GIAO", returnStatus: "DANG_YEU_CAU", createdAt: at("2026-10-10T02:00:00Z") }) }
  const rows = [fresh, ret].map((o) => ({ ...o, priority: r.priority(o, { now: NOW }) })).sort(r.comparePriority)
  assert.equal(rows[0].code, "A")
  assert.equal(rows[0].priority.level, "KHAN_CAP")
  assert.equal(rows[1].priority.level, "BINH_THUONG")
})

test("BR-32: Chờ xác nhận quá 24 giờ thành Cần chú ý; trước hạn vẫn hiện thời gian còn lại", () => {
  const old = r.priority(order({ createdAt: at("2026-10-15T01:00:00Z") }), { now: NOW })
  assert.equal(old.level, "CAN_CHU_Y")
  assert.equal(old.reason, "Chờ xác nhận quá 24 giờ")
  const fresh = r.priority(order(), { now: NOW })
  assert.equal(fresh.level, "BINH_THUONG")
  assert.equal(r.remainingText(fresh.deadline, NOW), "22 giờ")
  assert.equal(r.remainingText(at("2026-10-16T04:40:00Z"), NOW), "1 giờ 40 phút")
  assert.equal(r.remainingText(at("2026-10-15T19:00:00Z"), NOW), "Quá 8 giờ")
})

test("BR-32: COD lệch tiền, hoàn tiền chờ xử lý, đơn mới đánh dấu không thể thực hiện là Khẩn cấp; lưu kho còn ≤ 3 ngày là Cần chú ý", () => {
  assert.equal(r.priority(order({ orderStatus: "DA_GIAO", codDiscrepancy: { expected: 430000, collected: 400000 } }), { now: NOW }).reason, "COD lệch tiền, cần đối soát")
  assert.equal(r.priority(order({ orderStatus: "DA_HUY" }), { now: NOW, refund: { status: "CHO_XU_LY", bankInfo: { accountNumber: "0123456789" }, slaDeadline: at("2026-10-17T00:00:00Z") } }).level, "KHAN_CAP")
  // Chờ khách nhập tài khoản thì nhân viên chưa làm được gì, chỉ Cần chú ý
  assert.equal(r.priority(order({ orderStatus: "DA_HUY" }), { now: NOW, refund: { status: "CHO_XU_LY", slaDeadline: at("2026-10-17T00:00:00Z") } }).level, "CAN_CHU_Y")
  // 2 giờ đầu cần nhắn khách là Khẩn cấp, sau đó Cần chú ý tới hạn trả lời, quá hạn thì Khẩn cấp "cần hủy"
  const asking = (sla, due) => order({ unfulfillable: { status: "DANG_HOI_KHACH", itemIds: ["a"], slaDeadline: at(sla), responseDeadline: at(due) } })
  assert.equal(r.priority(asking("2026-10-16T04:00:00Z", "2026-10-18T00:00:00Z"), { now: NOW }).reason, "Không thể thực hiện, cần nhắn khách")
  assert.equal(r.priority(asking("2026-10-16T02:00:00Z", "2026-10-18T00:00:00Z"), { now: NOW }).level, "CAN_CHU_Y")
  const overdue = r.priority(asking("2026-10-15T20:00:00Z", "2026-10-16T00:00:00Z"), { now: NOW })
  assert.deepEqual([overdue.level, overdue.reason], ["KHAN_CAP", "Quá hạn chờ khách, cần hủy"])
  const storage = order({ orderStatus: "DA_HUY", storageStatus: "DANG_LUU_KHO", storageDeadline: at("2026-10-18T00:00:00Z") })
  assert.equal(r.priority(storage, { now: NOW }).level, "CAN_CHU_Y")
  assert.equal(r.priority({ ...storage, storageDeadline: at("2026-10-28T00:00:00Z") }, { now: NOW }).level, "BINH_THUONG")
})

test("tab nhanh SCR-47: Cần xác nhận, Cần đóng gói, Đang giao, Hàng lưu kho", () => {
  const p = { level: "BINH_THUONG" }
  assert.equal(r.VIEWS["to-confirm"]({ ...order(), priority: p }), true)
  assert.equal(r.VIEWS["to-pack"]({ ...order({ orderStatus: "DANG_CHUAN_BI" }), priority: p }), true)
  assert.equal(r.VIEWS.shipping({ ...order({ orderStatus: "DANG_VAN_CHUYEN" }), priority: p }), true)
  assert.equal(r.VIEWS.storage({ ...order({ storageStatus: "DA_TIEU_HUY" }), priority: p }), false)
})

test("State Machine: đơn thường xác nhận sang Đang chuẩn bị, đơn cá nhân hóa sang Đang cá nhân hóa (OPS-01 AC1, AC6)", () => {
  assert.equal(r.nextSteps(order())[0].to, "DANG_CHUAN_BI")
  assert.equal(r.nextSteps(order({ hasPersonalizedItems: true }))[0].to, "DANG_CA_NHAN_HOA")
  assert.equal(r.checkTransition(order(), "DANG_CHUAN_BI", all), null)
  // Không nhảy cóc (5a)
  assert.equal(r.checkTransition(order(), "DANG_VAN_CHUYEN", all).status, 409)
  // Khách vừa hủy: trang cũ bấm xác nhận nhận 409 (AC4)
  assert.equal(r.checkTransition(order({ orderStatus: "DA_HUY" }), "DANG_CHUAN_BI", all).code, "INVALID_TRANSITION")
  assert.deepEqual(r.requiredChecks(order({ hasPersonalizedItems: true })), ["content", "address"])
  assert.deepEqual(r.requiredChecks(order()), ["address"])
})

test("phân bước theo vai trò: Bán hàng không giao cho vận chuyển; Kho thì được (OPS-01 AC7, 5Ea)", () => {
  const packing = order({ orderStatus: "DANG_CHUAN_BI" })
  const sales = only("DON_HANG.XEM", "DON_HANG.SUA", "DON_HANG.IN_PHIEU", "DON_HANG.HUY_DON")
  const kho = only("DON_HANG.XEM", "DON_HANG.DONG_GOI", "DON_HANG.GIAO_VAN_CHUYEN", "DON_HANG.IN_PHIEU")
  assert.equal(r.checkTransition(packing, "DANG_VAN_CHUYEN", sales).status, 403)
  assert.equal(r.checkTransition(packing, "DANG_VAN_CHUYEN", kho), null)
  assert.equal(r.adminActions(packing, sales).next, null)
  assert.equal(r.adminActions(packing, kho).next.to, "DANG_VAN_CHUYEN")
  // Hoàn tất cá nhân hóa thuộc Kho
  assert.equal(r.checkTransition(order({ orderStatus: "DANG_CA_NHAN_HOA", hasPersonalizedItems: true }), "DANG_CHUAN_BI", sales).status, 403)
})

test("đơn đang hỏi khách hoặc chờ khách trả thêm thì chưa xác nhận được (OPS-06, BR-47)", () => {
  assert.equal(r.checkTransition(order({ unfulfillable: { status: "DANG_HOI_KHACH", itemIds: ["a"] } }), "DANG_CHUAN_BI", all).status, 422)
  assert.equal(r.checkTransition(order({ pendingChange: { amount: 50000 } }), "DANG_CHUAN_BI", all).status, 422)
  assert.equal(r.checkTransition(order({ unfulfillable: { status: "DA_DONG", itemIds: [] } }), "DANG_CHUAN_BI", all), null)
})

test("COD phải thu = tổng - đã trả (OPS-01 AC3)", () => {
  assert.equal(r.codDue(order()), 430000)
  assert.equal(r.codDue(order({ total: 614100, paidAmount: 199500 })), 414600)
  assert.equal(r.codDue(order({ paidAmount: 430000 })), 0)
})

test("đã thu COD tách khỏi tiền cọc online", () => {
  const at = new Date()
  assert.equal(r.codPaid(order({ total: 429000, depositAmount: 199500, paidAmount: 199500 })), 0)
  assert.equal(r.codPaid(order({ total: 429000, depositAmount: 199500, paidAmount: 429000, codCollectedAt: at, codCollectedAmount: 229500 })), 229500)
  // Đơn cũ chưa lưu codCollectedAmount: suy ra tổng - cọc
  assert.equal(r.codPaid(order({ total: 429000, depositAmount: 199500, paidAmount: 429000, codCollectedAt: at })), 229500)
  assert.equal(r.codPaid(order({ total: 430000, depositAmount: 0, paidAmount: 430000, codCollectedAt: at })), 430000)
})

test("kiểm tra tự động khi xác nhận: cọc, tồn từng dòng, vật liệu gói quà (OPS-01 6a, 6Eb)", () => {
  const o = order({ hasPersonalizedItems: true, total: 614100, depositAmount: 199500, paidAmount: 199500, giftWrap: { name: "Sân cỏ xanh", paper: { code: "G1" }, ribbon: { code: "R1" }, card: { code: "T1" } } })
  const ok = r.confirmChecks(o, { stockOf: new Map([["p1|AO-M", 12]]), materialStock: new Map([["G1", 3], ["R1", 2], ["T1", 5]]) })
  assert.ok(ok.every((c) => c.ok))
  assert.equal(ok[0].label, "Đã nhận cọc 199.500đ")
  const short = r.confirmChecks({ ...o, paidAmount: 0 }, { stockOf: new Map([["p1|AO-M", -1]]) })
  assert.equal(short.filter((c) => !c.ok).length, 2)
})

test("loại ngoại lệ theo trạng thái và quyền (OPS-03 2b, 2d, 2e)", () => {
  assert.deepEqual(r.exceptionTypes(order(), all), ["SUA_THONG_TIN", "DOI_SAN_PHAM", "HUY_DON", "CAP_VOUCHER", "GIA_HAN", "KHAC"])
  assert.ok(!r.exceptionTypes(order({ orderStatus: "DANG_CHUAN_BI" }), all).includes("DOI_SAN_PHAM"))
  assert.ok(r.exceptionTypes(order({ paidAmount: 300000 }), all).includes("HOAN_TIEN"))
  const delivered = r.exceptionTypes(order({ orderStatus: "DA_GIAO", paidAmount: 430000 }), all)
  assert.ok(!delivered.includes("GIA_HAN") && !delivered.includes("HUY_DON") && delivered.includes("HOAN_TIEN"))
  // Không có quyền Hủy đơn thì không có loại Hủy
  assert.ok(!r.exceptionTypes(order(), only("DON_HANG.SUA")).includes("HUY_DON"))
  // AC3: đã trả 300.000đ thì hoàn tối đa 300.000đ
  assert.equal(r.refundable(order({ paidAmount: 300000 })), 300000)
})

test("từ chối nhận: đơn thường đã trả là TH2, số hoàn trừ phí phát sinh (OPS-04 AC1)", () => {
  const o = order({ orderStatus: "DANG_VAN_CHUYEN", paidAmount: 430000, paymentStatus: "DA_THANH_TOAN" })
  assert.equal(r.refusalOutcome(o, NOW).cancelCase, "TH2")
  assert.equal(st.refundOnCancel({ ...o, cancelBy: "REFUSED", refusedShippingFee: 30000 }), 400000)
  // Member tự hủy không trừ phí
  assert.equal(st.refundOnCancel({ ...o, cancelBy: "MEMBER" }), 430000)
})

test("từ chối nhận: đơn cá nhân hóa lưu kho 14 ngày; giao lại lần 2 bị từ chối thì hết hạn ngay (OPS-04 AC2, BR-11)", () => {
  const o = order({ orderStatus: "DANG_VAN_CHUYEN", hasPersonalizedItems: true, personalizationStartedAt: at("2026-10-14T00:00:00Z"), paidAmount: 199500 })
  const first = r.refusalOutcome(o, NOW)
  assert.equal(first.cancelCase, "TH3")
  assert.equal(first.storageStatus, "DANG_LUU_KHO")
  assert.equal(first.storageDeadline.toISOString(), "2026-10-30T03:00:00.000Z")
  const second = r.refusalOutcome({ ...o, redeliveryCount: 1 }, NOW)
  assert.equal(second.storageStatus, "HET_HAN_LUU_KHO")
  // Không còn nút Nhận lại hàng khi đã hết hạn
  assert.equal(st.actions({ ...o, orderStatus: "DA_HUY", cancelCase: "TH3", storageStatus: "HET_HAN_LUU_KHO", redeliveryCount: 1 }).redelivery, false)
  // Chưa trả đồng nào là TH1 (không lưu kho)
  assert.equal(r.refusalOutcome({ ...o, paidAmount: 0 }, NOW).storageStatus, null)
})

test("hàng lưu kho: nhóm Đang lưu / Sắp hết hạn / Chờ tiêu hủy, mã LK-MMdd-nn (SCR-51)", () => {
  const base = order({ orderStatus: "DA_HUY", cancelBy: "REFUSED" })
  assert.equal(r.storageGroup({ ...base, storageStatus: "DANG_LUU_KHO", storageDeadline: at("2026-10-28T00:00:00Z") }, NOW), "dang-luu")
  assert.equal(r.storageGroup({ ...base, storageStatus: "DANG_LUU_KHO", storageDeadline: at("2026-10-18T00:00:00Z") }, NOW), "sap-het-han")
  assert.equal(r.storageGroup({ ...base, storageStatus: "HET_HAN_LUU_KHO" }, NOW), "cho-tieu-huy")
  assert.equal(r.storageReason(base), "Khách từ chối nhận")
  assert.equal(r.storageReason({ ...base, cancelBy: "ADMIN" }), "Hủy sau khi cá nhân hóa")
  // 23:30 giờ VN ngày 13/10 vẫn thuộc ngày 13/10
  assert.equal(r.storageCode(at("2026-10-13T16:30:00Z"), 1), "LK-1013-01")
})

test("tính lại tiền: bỏ 1 sản phẩm của đơn COD giảm tổng, không phát sinh hoàn (OPS-06 AC1)", () => {
  const o = order({
    total: 620000, subtotal: 590000,
    items: [
      { _id: "a", unitPrice: 300000, quantity: 1, personalizationFeePerUnit: 0, lineValue: 300000, fulfillStatus: "BINH_THUONG" },
      { _id: "b", unitPrice: 290000, quantity: 1, personalizationFeePerUnit: 0, lineValue: 290000, fulfillStatus: "CHO_KHACH_CHON" },
    ],
  })
  const m = r.recalcTotals(o, o.items.map((it) => (it._id === "b" ? { ...it, fulfillStatus: "DA_HOAN_TIEN" } : it)))
  assert.equal(m.total, 330000)
  assert.equal(m.refundDue, 0)
  assert.equal(m.remainingAmount, 330000)
})

test("tính lại tiền: đơn đã trả 100% bỏ sản phẩm thì hoàn đúng giá trị dòng; thay thế rẻ hơn hoàn phần chênh", () => {
  const items = [
    { _id: "a", unitPrice: 300000, quantity: 1, personalizationFeePerUnit: 0, lineValue: 300000, fulfillStatus: "BINH_THUONG" },
    { _id: "b", unitPrice: 290000, quantity: 1, personalizationFeePerUnit: 0, lineValue: 290000, fulfillStatus: "CHO_KHACH_CHON" },
  ]
  const o = order({ total: 620000, paidAmount: 620000, items })
  assert.equal(r.recalcTotals(o, items.map((it) => (it._id === "b" ? { ...it, fulfillStatus: "DA_HOAN_TIEN" } : it))).refundDue, 290000)
  const cheaper = items.map((it) => (it._id === "b" ? { ...it, fulfillStatus: "DA_THAY_THE", substitute: { unitPrice: 250000 } } : it))
  assert.equal(r.recalcTotals(o, cheaper).refundDue, 40000)
  // Đổi size cùng giá: tổng không đổi (OPS-03 AC4)
  assert.equal(r.recalcTotals(o, items).total, 620000)
})

test("thẻ đơn: bỏ trùng không phân biệt hoa thường, mỗi thẻ ≤ 30 ký tự (OPS-01 5d, AC8)", () => {
  assert.deepEqual(r.normalizeTags(["Quà công ty", "quà công ty", " ", "x".repeat(31), "Khách quen"]), ["Quà công ty", "Khách quen"])
})

test("timeline phía khách dùng ngày gia hạn cho mốc Đã giao (OPS-03 AC5)", () => {
  const t = st.timeline({ ...order({ orderStatus: "DANG_CHUAN_BI" }), expectedDeliveryDate: "2026-10-25" })
  const delivered = t.find((x) => x.status === "DA_GIAO")
  assert.deepEqual(delivered.expected, { from: "2026-10-25", to: "2026-10-25" })
})

test("BR-30: khách hủy khi đang hỏi thì đơn Khẩn cấp chờ quyết định voucher xin lỗi, quyết định xong thì hết", () => {
  const cancelled = order({ orderStatus: "DA_HUY", unfulfillable: { status: "DA_DONG", outcome: "KHACH_HUY", apologyVoucher: { pending: true } } })
  const p = r.priority(cancelled, { now: NOW })
  assert.equal(p.level, "KHAN_CAP")
  assert.equal(p.reason, "Khách hủy, chọn gửi voucher xin lỗi")
  assert.equal(r.adminActions(cancelled, all).apology, true)
  const decided = order({ orderStatus: "DA_HUY", unfulfillable: { status: "DA_DONG", outcome: "KHACH_HUY", apologyVoucher: { code: "QUATANG10" } } })
  assert.notEqual(r.priority(decided, { now: NOW }).reason, "Khách hủy, chọn gửi voucher xin lỗi")
  assert.equal(r.adminActions(decided, all).apology, false)
})

test("BR-48: ngoại lệ đặc biệt cần quyền hoặc Quản trị duyệt", () => {
  const o = order()
  assert.equal(r.specialOf("EXCEPTION", o, { type: "CAP_VOUCHER" }), "CAP_VOUCHER")
  assert.equal(r.specialOf("EXCEPTION", o, { type: "HOAN_TIEN" }), "HOAN_TIEN")
  assert.equal(r.specialOf("EXCEPTION", o, { type: "GIA_HAN" }), null)
  // Hủy đơn chưa cá nhân hóa, tặng voucher: làm thẳng; đã cá nhân hóa hoặc bỏ voucher: cần duyệt
  assert.equal(r.specialOf("EXCEPTION", o, { type: "HUY_DON", cause: "SOULPRINT", apologyVoucher: {} }), null)
  assert.equal(r.specialOf("EXCEPTION", order({ personalizationStartedAt: NOW }), { type: "HUY_DON", cause: "KHACH" }), "HUY_DON")
  assert.equal(r.specialOf("EXCEPTION", o, { type: "HUY_DON", cause: "SOULPRINT", apologyVoucher: { skip: true } }), "BO_VOUCHER_XIN_LOI")
  assert.equal(r.specialOf("EXCEPTION", o, { type: "HUY_DON", cause: "KHACH" }), null)
  assert.equal(r.specialOf("UNFULFILLABLE", o, { action: "CANCEL", apologyVoucher: { skip: true } }), "BO_VOUCHER_XIN_LOI")
  assert.equal(r.specialOf("UNFULFILLABLE", o, { action: "CANCEL", apologyVoucher: {} }), null)
  assert.equal(r.VIEWS.approval({ approvalPending: true }), true)
})

test("đổi kiểu nhận chờ khách trả thêm ở đơn đã xác nhận: vẫn làm hàng, chưa giao vận chuyển được (UC-OPS-03 2a)", () => {
  const pc = { kind: "DOI_KIEU_NHAN", amount: 200000 }
  assert.deepEqual(r.changeStatuses("DOI_KIEU_NHAN"), ["CHO_XAC_NHAN", "DANG_CA_NHAN_HOA", "DANG_CHUAN_BI"])
  assert.deepEqual(r.changeStatuses("DOI_SAN_PHAM"), ["CHO_XAC_NHAN"])
  assert.equal(r.checkTransition(order({ orderStatus: "DANG_CA_NHAN_HOA", hasPersonalizedItems: true, pendingChange: pc }), "DANG_CHUAN_BI", all), null)
  const packing = order({ orderStatus: "DANG_CHUAN_BI", pendingChange: pc })
  assert.equal(r.checkTransition(packing, "DANG_VAN_CHUYEN", all).status, 422)
  assert.equal(r.adminActions(packing, all).next, null)
  // Nút đổi kiểu nhận: trước khi giao, không phải đơn gấp, không có thay đổi đang chờ
  assert.equal(r.adminActions(order({ orderStatus: "DANG_CHUAN_BI" }), all).switchRecipient, true)
  assert.equal(r.adminActions(packing, all).switchRecipient, false)
  assert.equal(r.adminActions(order({ orderStatus: "DANG_VAN_CHUYEN" }), all).switchRecipient, false)
  assert.equal(r.adminActions(order({ urgentCode: "G2610290001" }), all).switchRecipient, false)
})
