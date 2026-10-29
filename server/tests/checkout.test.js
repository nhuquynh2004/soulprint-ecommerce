// Unit test tính tiền đặt hàng và voucher (services/checkoutMath.js), không cần kết nối MongoDB.
// Số liệu theo AC của UC-PAY-03, UC-PAY-04 và ví dụ 06_DataModel.md Mục 7.2.
const test = require("node:test")
const assert = require("node:assert/strict")

const m = require("../services/checkoutMath")

const line = (o) => ({ productId: "p1", categoryId: "c1", quantity: 1, personalizationFeePerUnit: 0, isPersonalized: false, ...o, lineValue: ((o.unitPrice || 0) + (o.personalizationFeePerUnit || 0)) * (o.quantity || 1) })
const now = new Date("2026-10-12T10:00:00+07:00")
const live = (o) => ({ code: "MA10", status: "HOAT_DONG", startAt: new Date("2026-10-01"), endAt: new Date("2026-12-31"), audience: "PUBLIC", totalQuantity: 100, usedCount: 0, perUserLimit: 1, ...o })

test("voucher 10% trần 50.000đ trên tạm tính 800.000đ giảm 50.000đ (PAY-03 AC1)", () => {
  const v = live({ type: "PERCENT", value: 10, maxDiscount: 50000 })
  assert.equal(m.discountOf(v, [line({ unitPrice: 800000 })], 30000), 50000)
})

test("chưa đạt giá trị tối thiểu: báo số tiền cần thêm, không giảm (PAY-03 AC2)", () => {
  const v = live({ code: "SOULPRINT10", type: "PERCENT", value: 10, minOrderValue: 300000 })
  const p = m.voucherProblem(v, { now, lines: [line({ unitPrice: 290000 })], shippingFee: 30000 })
  assert.equal(p.code, "VOUCHER_MIN_ORDER")
  assert.equal(p.message, "Đơn hàng cần tối thiểu 300.000đ để áp dụng mã này")
  assert.equal(p.hint, "Tạm tính hiện tại 290.000đ, thêm 10.000đ nữa để dùng SOULPRINT10.")
})

test("voucher tạm ngừng, hết hạn, chưa tới ngày, hết lượt bị từ chối (PAY-03 2Ea-2Ec, AC4)", () => {
  const ctx = { now, lines: [line({ unitPrice: 500000 })], shippingFee: 30000 }
  assert.equal(m.voucherProblem(live({ type: "FIXED", value: 1, status: "TAM_NGUNG" }), ctx).message, "Mã giảm giá không hợp lệ")
  assert.equal(m.voucherProblem(live({ type: "FIXED", value: 1, endAt: new Date("2026-10-01") }), ctx).message, "Mã giảm giá đã hết hạn sử dụng")
  assert.equal(m.voucherProblem(live({ type: "FIXED", value: 1, startAt: new Date("2026-11-01") }), ctx).message, "Mã giảm giá chưa đến thời gian áp dụng")
  assert.equal(m.voucherProblem(live({ type: "FIXED", value: 1, usedCount: 100 }), ctx).message, "Mã giảm giá đã hết lượt sử dụng")
  assert.equal(m.voucherProblem(live({ type: "FIXED", value: 1 }), { ...ctx, usedByUser: 1 }).message, "Mã giảm giá đã hết lượt sử dụng")
})

test("voucher được cấp riêng quá hạn dùng sau khi nhận thì hết hạn", () => {
  const v = live({ type: "PERCENT", value: 10, audience: "NEW_MEMBERS" })
  const grant = { expiresAt: new Date("2026-10-11") }
  const p = m.voucherProblem(v, { now, user: { createdAt: new Date("2026-10-01") }, grant, lines: [line({ unitPrice: 100000 })], shippingFee: 30000 })
  assert.equal(p.code, "VOUCHER_EXPIRED")
})

test("voucher dành cho Member: Guest được gợi ý đăng nhập, Member cũ không thuộc Thành viên mới (PAY-03 2Ee)", () => {
  const v = live({ type: "PERCENT", value: 10, audience: "NEW_MEMBERS" })
  const lines = [line({ unitPrice: 100000 })]
  assert.equal(m.voucherProblem(v, { now, user: null, lines, shippingFee: 30000 }).loginHint, true)
  assert.equal(m.voucherProblem(v, { now, user: { createdAt: new Date("2026-08-01") }, lines, shippingFee: 30000 }).code, "VOUCHER_AUDIENCE")
  assert.equal(m.voucherProblem(v, { now, user: { createdAt: new Date("2026-10-01") }, lines, shippingFee: 30000 }), null)
})

test("voucher miễn phí vận chuyển giảm bằng phí ship, tối đa value (PAY-03 AC5)", () => {
  assert.equal(m.discountOf(live({ type: "FREESHIP", value: 30000 }), [], 30000), 30000)
  assert.equal(m.discountOf(live({ type: "FREESHIP", value: 20000 }), [], 30000), 20000)
})

test("voucher theo danh mục chỉ giảm trên dòng thuộc phạm vi, trừ sản phẩm bị loại trừ (PAY-03 AC7)", () => {
  const v = live({ type: "PERCENT", value: 15, scope: { kind: "CATEGORY", ids: ["game"], excludeProductIds: [] } })
  const lines = [line({ productId: "a", categoryId: "game", unitPrice: 200000 }), line({ productId: "b", categoryId: "khac", unitPrice: 300000 })]
  assert.equal(m.discountOf(v, lines, 30000), 30000)
  const exclude = live({ type: "PERCENT", value: 10, scope: { kind: "ALL", ids: [], excludeProductIds: ["b"] } })
  assert.equal(m.discountOf(exclude, lines, 30000), 20000)
  const onlyExcluded = live({ type: "PERCENT", value: 10, scope: { kind: "ALL", ids: [], excludeProductIds: ["a", "b"] } })
  assert.equal(m.voucherProblem(onlyExcluded, { now, lines, shippingFee: 30000 }).code, "VOUCHER_SCOPE")
})

test("ngân sách tối đa: giảm không vượt phần còn lại, hết ngân sách thì hết lượt (PAY-03 AC8)", () => {
  const lines = [line({ unitPrice: 500000 })]
  assert.equal(m.discountOf(live({ type: "FIXED", value: 50000, maxBudget: 100000, discountGiven: 80000 }), lines, 30000), 20000)
  const done = live({ type: "FIXED", value: 50000, maxBudget: 100000, discountGiven: 100000 })
  assert.equal(m.voucherProblem(done, { now, lines, shippingFee: 30000 }).message, "Mã giảm giá đã hết lượt sử dụng")
  assert.equal(m.displayStatus(done, now), "HET_LUOT")
})

test("1 mã giảm giá + 1 mã miễn phí vận chuyển: tổng 620.100đ (PAY-03 AC6)", () => {
  const lines = [line({ unitPrice: 399000, isPersonalized: true }), line({ unitPrice: 290000 })]
  const pct = live({ type: "PERCENT", value: 10 })
  const ship = live({ type: "FREESHIP", value: 30000 })
  const discounts = [{ discount: m.discountOf(pct, lines, 30000) }, { discount: m.discountOf(ship, lines, 30000) }]
  assert.deepEqual(discounts, [{ discount: 68900 }, { discount: 30000 }])
  const r = m.money(lines, { shippingFee: 30000, depositRate: 0.5, discounts })
  assert.equal(r.total, 620100)
  assert.equal(m.kindOf("PERCENT"), m.kindOf("FIXED"))
  assert.notEqual(m.kindOf("PERCENT"), m.kindOf("FREESHIP"))
})

test("đơn COD không cá nhân hóa 400.000đ + ship 30.000đ = 430.000đ (PAY-04 AC1)", () => {
  const r = m.money([line({ unitPrice: 200000, quantity: 2 })], { shippingFee: 30000, depositRate: 0.5 })
  assert.equal(r.total, 430000)
  assert.equal(r.depositAmount, 0)
  const options = m.paymentOptions(r, "SELF", {})
  assert.deepEqual(options.map((o) => o.key), ["COD", "ONLINE"])
  assert.equal(m.pickOption(options, "COD").amountDueNow, 0)
})

test("đơn có món cá nhân hóa, voucher 10%: cọc 199.500đ, còn lại 414.600đ (PAY-04 AC3, 06 Mục 7.2)", () => {
  const lines = [line({ unitPrice: 399000, isPersonalized: true }), line({ unitPrice: 250000 })]
  const r = m.money(lines, { shippingFee: 30000, depositRate: 0.5, discounts: [{ discount: 64900 }] })
  assert.equal(r.total, 614100)
  assert.equal(r.depositAmount, 199500)
  assert.equal(r.remainingAmount, 414600)
  const options = m.paymentOptions(r, "SELF", {})
  assert.deepEqual(options.map((o) => o.key), ["DEPOSIT_COD", "ONLINE"])
  assert.equal(m.pickOption(options, "COD"), null) // BR-03: không có COD toàn bộ
  assert.equal(m.pickOption(options, "ONLINE", "COD").amountDueNow, 199500)
})

test("giao người nhận: chỉ online 100%, không cọc (PAY-02 AC3, PAY-04 AC2, BR-02)", () => {
  const r = m.money([line({ unitPrice: 399000, isPersonalized: true })], { shippingFee: 30000, depositRate: 0.5, recipientType: "OTHER" })
  assert.equal(r.depositAmount, 0)
  const options = m.paymentOptions(r, "OTHER", {})
  assert.deepEqual(options.map((o) => o.key), ["ONLINE"])
  assert.equal(options[0].amountDueNow, 429000)
})

test("phương thức bị tắt ở Cài đặt cửa hàng không hiện (BR-40)", () => {
  const r = m.money([line({ unitPrice: 100000 })], { shippingFee: 30000, depositRate: 0.5 })
  assert.deepEqual(m.paymentOptions(r, "SELF", { codFull: false }).map((o) => o.key), ["ONLINE"])
  assert.deepEqual(m.paymentOptions(r, "OTHER", { onlineFull: false }), [])
})

test("ngày giao người nhận từ ngày sớm nhất đến + 14, mã đơn theo ngày giờ Việt Nam (PAY-02 AC4)", () => {
  // Chưa chọn tỉnh tính như tỉnh khác (4 ngày), đặt trước 12h
  const range = m.deliveryRange(new Date("2026-10-12T10:00:00+07:00"))
  assert.equal(range.min, "2026-10-16")
  assert.equal(range.max, "2026-10-30")
  assert.equal(range.slots.length, 3)
  // 23:30 ngày 14/10 giờ Việt Nam vẫn là ngày 14/10 dù UTC đã sang 16:30
  assert.equal(m.orderCode(new Date("2026-10-14T23:30:00+07:00"), 1), "SP2610140001")
})

test("đọc mã: chữ in hoa, bỏ trùng, tối đa 2 (BR-23)", () => {
  assert.deepEqual(m.readCodes([" soulprint10", "SOULPRINT10", "freeship30", "GAMER50K"]), ["SOULPRINT10", "FREESHIP30"])
  assert.deepEqual(m.readCodes("ma10"), ["MA10"])
  assert.deepEqual(m.readCodes({ $ne: null }), [])
})

test("tỷ lệ cọc 40%, món cá nhân hóa 400.000đ: cọc 160.000đ (CAT-07 AC5)", () => {
  const r = m.money([line({ unitPrice: 400000, isPersonalized: true })], { shippingFee: 30000, depositRate: 0.4 })
  assert.equal(r.depositAmount, 160000)
  assert.equal(r.remainingAmount, 270000)
  assert.equal(m.pickOption(m.paymentOptions(r, "SELF", {}), "ONLINE", "COD").amountDueNow, 160000)
})
