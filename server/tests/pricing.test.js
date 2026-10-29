const test = require("node:test")
const assert = require("node:assert")
const { isOnSale, basePrice, unitPrice } = require("../services/pricing")

const now = new Date("2026-10-15T00:00:00+07:00")
const aoDau = {
  price: 450000,
  salePrice: 399000,
  saleStartAt: new Date("2026-10-01T00:00:00+07:00"),
  saleEndAt: new Date("2026-12-31T23:59:59+07:00"),
}

test("đang trong thời gian sale thì dùng giá sale", () => {
  assert.equal(isOnSale(aoDau, now), true)
  assert.equal(basePrice(aoDau, now), 399000)
})

test("sale đã hết hạn thì chỉ dùng giá gốc (UC-DIS-02 AC4)", () => {
  const later = new Date("2027-01-01T00:00:00+07:00")
  assert.equal(isOnSale(aoDau, later), false)
  assert.equal(basePrice(aoDau, later), 450000)
})

test("sale chưa bắt đầu thì dùng giá gốc", () => {
  assert.equal(basePrice(aoDau, new Date("2026-09-30T00:00:00+07:00")), 450000)
})

test("giá sale không nhỏ hơn giá gốc thì bỏ qua", () => {
  assert.equal(basePrice({ price: 100000, salePrice: 100000 }, now), 100000)
})

test("biến thể có chênh giá cộng vào giá hiệu lực (UC-DIS-02 AC7)", () => {
  assert.equal(unitPrice(aoDau, { priceDelta: 20000 }, now), 419000)
  assert.equal(unitPrice(aoDau, { priceDelta: 0 }, now), 399000)
  assert.equal(unitPrice({ price: 290000 }, undefined, now), 290000)
})
