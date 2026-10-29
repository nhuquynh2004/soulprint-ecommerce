// Unit test việc định kỳ (services/scheduler.js), không cần kết nối MongoDB
const test = require("node:test")
const assert = require("node:assert/strict")

process.env.MONGODB_URI ||= "mongodb://localhost/test"
const { fileIdsIn } = require("../services/scheduler")

test("tìm mã tệp trong mọi chỗ của document: mảng ảnh, biến thể, HTML chính sách (06 Mục 6.2)", () => {
  const a = "6a0000000000000000000001"
  const b = "6a0000000000000000000002"
  const c = "6a0000000000000000000003"
  const doc = {
    images: [`/api/files/${a}`],
    variants: [{ image: `/api/files/${b}` }],
    body: `<p>Xem <img src="/api/files/${c}"></p>`,
    other: "/assets/products/tt-ao-001-1.webp",
  }
  assert.deepEqual([...fileIdsIn(doc)].sort(), [a, b, c])
})

test("gộp kết quả qua nhiều document, bỏ chuỗi không phải mã 24 ký tự", () => {
  const found = new Set()
  fileIdsIn({ x: "/api/files/6a0000000000000000000001" }, found)
  fileIdsIn({ y: "/api/files/abc", z: "/api/files/6a0000000000000000000001" }, found)
  assert.equal(found.size, 1)
})
