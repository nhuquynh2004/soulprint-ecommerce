// Unit test ngày giao sớm nhất và phụ phí giao gấp (services/checkoutMath.js), không cần MongoDB
const test = require("node:test")
const assert = require("node:assert/strict")
const m = require("../services/checkoutMath")

// Giờ Việt Nam -> Date (UTC+7)
const vn = (ymd, hh) => new Date(`${ymd}T${String(hh).padStart(2, "0")}:00:00+07:00`)
const HCM = "Thành phố Hồ Chí Minh"
const HN = "Thành phố Hà Nội"

test("4 ví dụ Quỳnh chốt 18/10/2026: TP.HCM 2 ngày, tỉnh khác 4 ngày, cá nhân hóa 3 ngày, sau 12h cộng 1", () => {
  assert.equal(m.earliestDelivery({ now: vn("2026-10-18", 9), province: HCM }).date, "2026-10-20")
  assert.equal(m.earliestDelivery({ now: vn("2026-10-18", 9), province: HN }).date, "2026-10-22")
  assert.equal(m.earliestDelivery({ now: vn("2026-10-18", 13), province: HCM, personalized: true }).date, "2026-10-24")
  assert.equal(m.earliestDelivery({ now: vn("2026-10-18", 13), province: HN, personalized: true }).date, "2026-10-26")
})

test("đúng 12:00 tính là sau 12h; 11:59 thì không", () => {
  assert.equal(m.earliestDelivery({ now: vn("2026-10-18", 12), province: HCM }).afterCutoff, true)
  assert.equal(m.earliestDelivery({ now: new Date("2026-10-18T11:59:00+07:00"), province: HCM }).afterCutoff, false)
})

test("giờ server UTC vẫn tính theo giờ Việt Nam (23:30 VN là ngày hôm sau theo UTC+7)", () => {
  // 23:30 ngày 18/10 giờ VN = 16:30 UTC cùng ngày: sau 12h nên +1
  assert.equal(m.earliestDelivery({ now: new Date("2026-10-18T16:30:00Z"), province: HCM }).date, "2026-10-21")
})

test("nhận diện TP.HCM theo nhiều cách viết, chưa chọn tỉnh thì tính như tỉnh khác", () => {
  for (const p of ["Thành phố Hồ Chí Minh", "TP.HCM", "tp hcm", "Hồ Chí Minh", "ho chi minh"]) assert.equal(m.isHcm(p), true, p)
  assert.equal(m.isHcm("Thành phố Hà Nội"), false)
  assert.equal(m.earliestDelivery({ now: vn("2026-10-18", 9), province: "" }).date, "2026-10-22")
})

test("khoảng chọn ngày: thường từ ngày sớm nhất, đặt gấp từ ngày mai", () => {
  const r = m.deliveryRange(vn("2026-10-18", 9), { province: HCM })
  assert.equal(r.min, "2026-10-20")
  assert.equal(r.urgentMin, "2026-10-19")
  assert.equal(r.urgentMax, "2026-10-19")
  assert.equal(r.max, "2026-11-03")
})

test("đặt gấp chọn được tới trước ngày giao thường sớm nhất, cùng 1 hàm cho Thanh toán và yêu cầu", () => {
  // 20:00 26/10, không cá nhân hóa, TP.HCM: 26 + 1 + 2 = 29/10; chưa chọn tỉnh thì tính như tỉnh khác 31/10
  const hcm = m.deliveryRange(vn("2026-10-26", 20), { province: "Thành phố Hồ Chí Minh" })
  assert.equal(hcm.min, "2026-10-29")
  assert.equal(hcm.urgentMax, "2026-10-28")
  assert.equal(m.deliveryRange(vn("2026-10-26", 20), { province: "" }).min, "2026-10-31")
})

test("phụ phí giao gấp cộng vào tổng, không bị voucher giảm, cọc không đổi", () => {
  const lines = [{ unitPrice: 300000, quantity: 1, personalizationFeePerUnit: 0, isPersonalized: true, lineValue: 300000 }]
  const base = m.money(lines, { shippingFee: 30000, depositRate: 0.5, discounts: [{ discount: 50000 }] })
  const urgent = m.money(lines, { shippingFee: 30000, depositRate: 0.5, discounts: [{ discount: 50000 }], urgentFee: 40000 })
  assert.equal(urgent.total, base.total + 40000)
  assert.equal(urgent.urgentFee, 40000)
  assert.equal(urgent.depositAmount, base.depositAmount)
  assert.equal(urgent.remainingAmount, base.remainingAmount + 40000)
})
