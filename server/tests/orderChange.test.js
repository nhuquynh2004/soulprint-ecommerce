// Unit test bù trừ tiền khi đơn đổi trước khi xác nhận (BR-47) - services/orderChange.js, không kết nối MongoDB
process.env.MONGODB_URI ||= "mongodb://localhost/test" // nạp config/db nhưng không kết nối
const test = require("node:test")
const assert = require("node:assert/strict")
const c = require("../services/orderChange")

const line = (id, price, qty = 1, extra = {}) => ({ _id: id, productId: "p" + id, variantSku: "V" + id, unitPrice: price, quantity: qty, personalizationFeePerUnit: 0, lineValue: price * qty, isPersonalized: false, fulfillStatus: "BINH_THUONG", ...extra })
const order = (extra = {}) => ({
  code: "SP2610240001", orderStatus: "CHO_XAC_NHAN", recipientType: "SELF", paymentMethod: "COD", remainingMethod: null,
  paidAmount: 0, refundedAmount: 0, shippingFee: 30000, giftWrapFee: 0, discount: 0, depositAmount: 0,
  items: [line("a", 150000)], total: 180000, ...extra,
})
const RATE = 0.5

test("BR-47: đơn COD không cọc đổi sang món đắt hơn thì tổng và số thu khi giao tăng, không thu trước (OPS-03 AC6)", () => {
  const o = order({ items: [line("a", 150000), line("b", 120000)], total: 300000 })
  const s = c.settle(o, [line("x", 250000), line("b", 120000)], { depositRate: RATE })
  assert.equal(s.total, 400000)
  assert.deepEqual([s.extra, s.surplus, s.remainingAmount], [0, 0, 400000])
})

test("BR-47: đơn đã trả 100% tăng giá thì trả thêm qua giao dịch, giảm giá thì hoàn đúng phần dư (OPS-03 AC7)", () => {
  const o = order({ recipientType: "OTHER", paymentMethod: "ONLINE", items: [line("a", 270000)], total: 300000, paidAmount: 300000 })
  const up = c.settle(o, [line("x", 370000)], { depositRate: RATE })
  assert.deepEqual([up.total, up.extra, up.surplus], [400000, 100000, 0])
  const down = c.settle(o, [line("y", 220000)], { depositRate: RATE })
  assert.deepEqual([down.total, down.extra, down.surplus, down.remainingAmount], [250000, 0, 50000, 0])
})

test("BR-47: đơn đã cọc nhân viên đổi sản phẩm thì cọc tính lại: thiếu cọc thêm, dư trừ vào COD, vượt tổng thì hoàn (OPS-03 AC8)", () => {
  const pz = (id, price) => line(id, price, 1, { isPersonalized: true })
  const o = order({ paymentMethod: "ONLINE", remainingMethod: "COD", items: [pz("a", 200000)], total: 230000, paidAmount: 100000, depositAmount: 100000 })
  const recalc = { depositRate: RATE, keepDeposit: false }
  // Đổi sang món cá nhân hóa 300.000đ: cọc mới 150.000đ, cọc thêm 50.000đ
  const up = c.settle(o, [pz("x", 300000)], recalc)
  assert.deepEqual([up.required, up.extra, up.surplus, up.total, up.remainingAmount], [150000, 50000, 0, 330000, 180000])
  // Đổi sang món cá nhân hóa 120.000đ: cọc mới 60.000đ, 40.000đ cọc dư nằm trong số đã trả nên COD = tổng - 100.000đ
  const down = c.settle(o, [pz("y", 120000)], recalc)
  assert.deepEqual([down.required, down.extra, down.surplus, down.total, down.remainingAmount], [60000, 0, 0, 150000, 50000])
  // Đổi sang món thường: không cần cọc, số đã cọc trừ hết vào COD
  const plain = c.settle(o, [line("z", 150000)], recalc)
  assert.deepEqual([plain.extra, plain.surplus, plain.remainingAmount], [0, 0, 80000])
  // Ví dụ của Quỳnh: đã cọc 500.000đ, sau khi đổi tổng còn 460.000đ thì hoàn 40.000đ, COD 0đ
  const big = order({ paymentMethod: "ONLINE", remainingMethod: "COD", items: [pz("a", 970000)], total: 1000000, paidAmount: 500000, depositAmount: 500000 })
  const small = c.settle(big, [pz("z", 430000)], recalc)
  assert.deepEqual([small.total, small.extra, small.surplus, small.remainingAmount], [460000, 0, 40000, 0])
})

test("BR-47: chỉ đổi nội dung cá nhân hóa (cùng sản phẩm, phân loại, số lượng) mới giữ cọc", () => {
  const old = line("a", 200000, 1, { isPersonalized: true })
  assert.equal(c.contentOnly(old, { ...old, personalizationFeePerUnit: 5000 }), true)
  assert.equal(c.contentOnly(old, { ...old, quantity: 2 }), false)
  assert.equal(c.contentOnly(old, { ...old, variantSku: "VX" }), false)
  assert.equal(c.contentOnly(old, { ...old, productId: "px" }), false)
  // Món thường được thêm cá nhân hóa: không phải chỉ đổi nội dung
  assert.equal(c.contentOnly(line("b", 200000), line("b", 200000, 1, { isPersonalized: true })), false)
})

test("BR-02: đổi Giao cho tôi sang Giao người nhận phải trả online cho đủ 100% (UC-TRK-06 AC9)", () => {
  const cod = order({ items: [line("a", 400000)], total: 430000 })
  const s = c.settle({ ...cod, recipientType: "OTHER", paymentMethod: "ONLINE", remainingMethod: null }, cod.items, { depositRate: RATE })
  assert.deepEqual([s.required, s.extra, s.remainingAmount], [430000, 430000, 0])
  const deposit = order({ paymentMethod: "ONLINE", remainingMethod: "COD", items: [line("a", 400000, 1, { isPersonalized: true })], total: 430000, paidAmount: 200000 })
  const s2 = c.settle({ ...deposit, recipientType: "OTHER", paymentMethod: "ONLINE", remainingMethod: null }, deposit.items, { depositRate: RATE })
  assert.deepEqual([s2.extra, s2.remainingAmount], [230000, 0])
})

test("BR-42: đơn vừa có món cá nhân hóa thì Giao cho tôi dời ngày dự kiến, Giao người nhận ngày quá sớm thì báo lỗi", () => {
  const now = new Date("2026-10-28T09:00:00+07:00")
  const items = [line("a", 200000, 1, { isPersonalized: true })]
  // 28/10 trước 12:00 + 3 ngày cá nhân hóa + 2 ngày TP.HCM = 02/11
  const self = c.deliveryAfterChange(order({ expectedDeliveryDate: "2026-10-30", shippingAddress: { province: "Thành phố Hồ Chí Minh" } }), items, now)
  assert.deepEqual(self, { expectedDeliveryDate: "2026-11-02" })
  assert.deepEqual(c.deliveryAfterChange(order({ hasPersonalizedItems: true, expectedDeliveryDate: "2026-10-30" }), items, now), {})
  const other = order({ recipientType: "OTHER", shippingAddress: { province: "Thành phố Hồ Chí Minh", deliveryDate: "2026-10-31" } })
  assert.throws(() => c.deliveryAfterChange(other, items, now), (e) => e.code === "DELIVERY_TOO_EARLY")
})

test("BR-47: đơn COD chưa trả gì có thêm món cá nhân hóa (Giao cho tôi) thì phải cọc theo BR-03", () => {
  const s = c.settle(order(), [line("x", 200000, 1, { isPersonalized: true })], { depositRate: RATE })
  assert.deepEqual([s.required, s.extra], [100000, 100000])
})

test("BR-47: khách tự sửa nội dung cá nhân hóa ở đơn đã cọc thì giữ cọc (UC-TRK-06 AC2)", () => {
  const withStickers = (n) => line("a", 200000, 1, { isPersonalized: true, personalizationFeePerUnit: 5000 * n, lineValue: 200000 + 5000 * n })
  const o = order({ paymentMethod: "ONLINE", remainingMethod: "COD", items: [withStickers(2)], total: 240000, paidAmount: 105000, depositAmount: 105000 })
  const s = c.settle(o, [withStickers(3)], { depositRate: RATE, keepDeposit: true })
  assert.deepEqual([s.total, s.extra, s.remainingAmount], [245000, 0, 140000])
})

test("trạng thái thanh toán sau khi đổi và tồn kho cần trừ, cộng trả", () => {
  assert.equal(c.paymentStatusOf(300000, 0, null), "CHUA_THANH_TOAN")
  assert.equal(c.paymentStatusOf(300000, 100000, "COD"), "DA_COC")
  assert.equal(c.paymentStatusOf(300000, 300000, null), "DA_THANH_TOAN")
  // Cùng biến thể chỉ tính phần chênh số lượng; khác biến thể thì trừ mới, trả cũ
  assert.deepEqual(c.stockMoves([line("a", 1, 2)], [line("a", 1, 3)]), { take: [{ productId: "pa", sku: "Va", qty: 1 }], release: [] })
  assert.deepEqual(c.stockMoves([line("a", 1, 2)], [line("b", 1, 1)]), { take: [{ productId: "pb", sku: "Vb", qty: 1 }], release: [{ productId: "pa", sku: "Va", qty: 2 }] })
})

test("nhân viên bỏ món và thêm món trong 1 lần sửa: tiền tính lại 1 lần, tồn cộng dồn theo biến thể (OPS-03 AC11)", () => {
  const a = line("a", 150000)
  const b = line("b", 100000)
  const added = line("c", 80000, 2)
  const o = order({ shippingFee: 50000, items: [a, b], total: 300000 })
  const s = c.settle(o, [a, added], { depositRate: RATE })
  assert.deepEqual([s.total, s.extra, s.surplus, s.remainingAmount], [360000, 0, 0, 360000])
  assert.deepEqual(c.stockMoves([b], [added]), { take: [{ productId: "pc", sku: "Vc", qty: 2 }], release: [{ productId: "pb", sku: "Vb", qty: 1 }] })
  // Bỏ 1 dòng, tăng dòng cùng biến thể ở dòng khác: chỉ tính phần chênh
  assert.deepEqual(c.stockMoves([line("a", 1, 1), line("a2", 1, 1, { productId: "pa", variantSku: "Va" })], [line("a", 1, 3)]), { take: [{ productId: "pa", sku: "Va", qty: 1 }], release: [] })
  // Đơn đã trả 100% bỏ món 100.000đ: hoàn đúng 100.000đ
  const paid = order({ recipientType: "OTHER", paymentMethod: "ONLINE", shippingFee: 50000, items: [a, b], total: 300000, paidAmount: 300000 })
  const drop = c.settle(paid, [a], { depositRate: RATE })
  assert.deepEqual([drop.total, drop.extra, drop.surplus], [200000, 0, 100000])
})

test("BR-47: khách tự sửa làm đổi giá trị tối đa 1 lần", () => {
  assert.equal(c.editsLeftOf(order()), 1)
  assert.equal(c.editsLeftOf(order({ valueEditCount: 1 })), 0)
  assert.equal(c.editsLeftOf(order({ valueEditCount: 3 })), 0)
})

test("lịch sử khách sửa giao hàng nêu địa chỉ cũ và mới", () => {
  const before = { recipientName: "Lan", phone: "0901234567", street: "12 Lê Lợi", ward: "Phường Bến Thành", province: "Thành phố Hồ Chí Minh", deliveryDate: "2026-10-29", deliveryWindow: "08:00 - 12:00", noteForShipper: "" }
  const after = { ...before, street: "45 Nguyễn Huệ", deliveryDate: "2026-10-30" }
  assert.equal(
    c.shippingChangeNote(before, after),
    "Khách sửa thông tin giao hàng: địa chỉ 12 Lê Lợi, Phường Bến Thành, Thành phố Hồ Chí Minh → 45 Nguyễn Huệ, Phường Bến Thành, Thành phố Hồ Chí Minh; ngày nhận 29/10/2026 08:00 - 12:00 → 30/10/2026 08:00 - 12:00",
  )
  assert.equal(c.shippingChangeNote(before, { ...before }), "Khách sửa thông tin giao hàng")
  assert.equal(c.shippingChangeNote(before, { ...before, phone: "0907654321" }), "Khách sửa thông tin giao hàng: người nhận Lan 0901234567 → Lan 0907654321")
})

test("Giao cho tôi sang Giao người nhận phải trả đủ 100%; ngược lại không thu, không hoàn (UC-OPS-03 2a)", () => {
  const toOther = { recipientType: "OTHER", paymentMethod: "ONLINE", remainingMethod: null, depositAmount: 0 }
  // COD chưa trả gì: trả cả tổng
  assert.deepEqual([c.settle({ ...order(), ...toOther }, order().items, { depositRate: RATE }).extra], [180000])
  // Đã cọc 75.000đ: trả phần còn lại
  const dep = order({ paymentMethod: "ONLINE", remainingMethod: "COD", paidAmount: 75000, depositAmount: 75000, items: [line("a", 150000, 1, { isPersonalized: true })] })
  const s = c.settle({ ...dep, ...toOther }, dep.items, { depositRate: RATE })
  assert.deepEqual([s.extra, s.surplus, s.remainingAmount], [105000, 0, 0])
  // Giao người nhận đã trả 100% về Giao cho tôi
  const other = order({ recipientType: "OTHER", paymentMethod: "ONLINE", paidAmount: 180000 })
  const back = c.settle({ ...other, recipientType: "SELF" }, other.items, { depositRate: RATE })
  assert.deepEqual([back.extra, back.surplus, back.remainingAmount], [0, 0, 0])
})
