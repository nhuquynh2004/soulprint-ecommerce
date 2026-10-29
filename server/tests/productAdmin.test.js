const test = require("node:test")
const assert = require("node:assert")
const pa = require("../services/productAdmin")
const { sanitizeHtml, isSafeUrl } = require("../utils/sanitizeHtml")

const groups = [
  { name: "Màu sắc", hasImages: true, values: [{ value: "Đỏ đô", images: ["/api/files/a"] }, { value: "Trắng" }] },
  { name: "Size", values: [{ value: "M" }, { value: "L" }, { value: "XL" }] },
]

test("slug và mã giá trị bỏ dấu tiếng Việt", () => {
  assert.equal(pa.slugify("Áo đấu CLB Đỏ đô"), "ao-dau-clb-do-do")
  assert.equal(pa.valueCode("Xanh navy"), "XANHNAVY")
  assert.equal(pa.valueCode("Đỏ đô"), "DODO")
})

test("sinh đủ tổ hợp biến thể, SKU tự sinh theo mã giá trị (BR-39)", () => {
  const { doc } = pa.normalizeProduct({ name: "Áo đấu", sku: "TT-DNC-SNBD-001", optionGroups: groups })
  assert.equal(doc.variants.length, 6)
  assert.equal(doc.variants[0].sku, "TT-DNC-SNBD-001-DODO-M")
  assert.equal(doc.variants[0].name, "Đỏ đô / M")
  assert.ok(doc.variants.every((v) => v.stock === 0 && v.priceDelta === 0 && v.isActive))
})

test("không có nhóm biến thể thì có 1 biến thể Mặc định mang SKU sản phẩm", () => {
  const { doc } = pa.normalizeProduct({ name: "Bình nước", sku: "GM-KGC-005", variants: [{ attributes: {}, stock: 7 }] })
  assert.equal(doc.variants.length, 1)
  assert.equal(doc.variants[0].name, "Mặc định")
  assert.equal(doc.variants[0].sku, "GM-KGC-005")
  assert.equal(doc.variants[0].stock, 7)
})

test("giữ tồn, chênh giá của biến thể đã có theo tổ hợp; giá trị ẩn thì biến thể ngừng bán", () => {
  const variants = [{ attributes: { "Màu sắc": "Trắng", Size: "XL" }, stock: 4, priceDelta: 20000, sku: "TT-DNC-SNBD-001-TRANG-XL" }]
  const hidden = groups.map((g) => (g.name === "Màu sắc" ? { ...g, values: [g.values[0], { value: "Trắng", isHidden: true }] } : g))
  const { doc } = pa.normalizeProduct({ name: "Áo đấu", sku: "TT-DNC-SNBD-001", optionGroups: hidden, variants })
  const kept = doc.variants.find((v) => v.sku === "TT-DNC-SNBD-001-TRANG-XL")
  assert.equal(doc.variants.length, 4) // 3 tổ hợp Đỏ đô + 1 biến thể của giá trị ẩn
  assert.equal(kept.stock, 4)
  assert.equal(kept.priceDelta, 20000)
  assert.equal(kept.isActive, false)
})

test("bản nháp chỉ cần tên; xuất bản thiếu trường thì báo kèm số vùng (UC-CAT-01 bước 5, 7)", () => {
  assert.doesNotThrow(() => pa.normalizeProduct({ name: "Nháp" }))
  try {
    pa.normalizeProduct({ name: "Áo", status: "DANG_HIEN_THI", price: 100000 })
    assert.fail("phải báo lỗi")
  } catch (err) {
    assert.ok(err instanceof pa.ProductError)
    const areas = pa.withAreas(err.fields)
    assert.ok(areas.some((a) => a.field === "images" && a.area === 4))
    assert.ok(areas.some((a) => a.field === "variants" && a.area === 3))
  }
})

test("giá sale phải nhỏ hơn giá gốc, thời gian sale kết thúc sau bắt đầu", () => {
  assert.throws(() => pa.normalizeProduct({ name: "Áo", price: 100000, salePrice: 120000 }), /Giá sale/)
  assert.throws(
    () => pa.normalizeProduct({ name: "Áo", price: 100000, saleStartAt: "2026-10-20", saleEndAt: "2026-10-10" }),
    /kết thúc sale/,
  )
})

test("nhóm biến thể sai luật BR-39 bị chặn", () => {
  assert.throws(() => pa.normalizeGroups([{ name: "Size", values: [{ value: "M" }, { value: "m" }] }]), /bị trùng/)
  assert.throws(() => pa.normalizeGroups([{ name: "A", hasImages: true, values: [{ value: "1" }] }, { name: "B", hasImages: true, values: [{ value: "2" }] }]), /Gắn ảnh/)
  assert.throws(() => pa.normalizeGroups([1, 2, 3, 4].map((i) => ({ name: "N" + i, values: [{ value: "x" }] }))), /Tối đa/)
})

test("cảnh báo giá trị của nhóm gắn ảnh chưa có ảnh (AC12)", () => {
  const { warnings } = pa.normalizeProduct({ name: "Áo đấu", sku: "TT-DNC-SNBD-001", optionGroups: groups })
  assert.deepEqual(warnings, ["Trắng: chưa có ảnh"])
})

test("Kho chỉ sửa tồn thì chỉ cần quyền CAP_NHAT_TON; đổi giá cần SUA_GIA (07 Mục 1.1)", () => {
  const before = pa.normalizeProduct({ name: "Bình", sku: "GM-KGC-005", price: 100000, variants: [{ attributes: {}, stock: 1 }] }).doc
  const stockOnly = pa.normalizeProduct({ name: "Bình", sku: "GM-KGC-005", price: 100000, variants: [{ attributes: {}, stock: 9, sku: "GM-KGC-005" }] }).doc
  assert.deepEqual([...pa.requiredPermissions(before, stockOnly)], ["SAN_PHAM.CAP_NHAT_TON"])
  const priced = pa.normalizeProduct({ name: "Bình", sku: "GM-KGC-005", price: 90000, variants: [{ attributes: {}, stock: 1, sku: "GM-KGC-005" }] }).doc
  assert.deepEqual([...pa.requiredPermissions(before, priced)], ["SAN_PHAM.SUA_GIA"])
})

test("tình trạng tồn: hết, sắp hết, còn hàng (cột Tồn kho SCR-41)", () => {
  assert.equal(pa.stockInfo([{ stock: 0 }]).stockStatus, "HET_HANG")
  assert.equal(pa.stockInfo([{ stock: 3, lowStockThreshold: 5 }, { stock: 20 }]).stockStatus, "SAP_HET")
  assert.equal(pa.stockInfo([{ stock: 30 }, { stock: 0, isActive: false }]).totalStock, 30)
})

test("lọc HTML mô tả: bỏ script, thuộc tính sự kiện, liên kết javascript (NFR-SEC-14)", () => {
  assert.equal(sanitizeHtml('<p onclick="x()">Chào <b>bạn</b></p><script>alert(1)</script>'), "<p>Chào <strong>bạn</strong></p>")
  assert.equal(sanitizeHtml('<a href="javascript:alert(1)">x</a>'), "<a>x</a>")
  assert.equal(sanitizeHtml('<a href="/san-pham">x</a>'), '<a href="/san-pham" rel="noopener">x</a>')
  assert.equal(sanitizeHtml("<div><img src=x onerror=1>Chữ</div>"), "Chữ")
  assert.equal(isSafeUrl("//evil.com"), false)
})

test("tag nhóm khoảng tự khớp theo giá hiệu lực và độ tuổi (UC-CAT-04 AC5)", () => {
  process.env.MONGODB_URI ||= "mongodb://localhost/test" // controller nạp config/db nhưng test không kết nối
  const { matchesRange } = require("../controllers/admin-tag.controller")
  const now = new Date("2026-10-15T00:00:00+07:00")
  const sale = { price: 700000, salePrice: 450000, saleStartAt: new Date("2026-10-01"), saleEndAt: new Date("2026-10-30") }
  assert.equal(matchesRange(sale, "PRICE", { min: 300000, max: 600000 }, now), true) // giá sale đang chạy
  assert.equal(matchesRange({ price: 700000 }, "PRICE", { min: 300000, max: 600000 }, now), false)
  assert.equal(matchesRange({ price: 2000000 }, "PRICE", { min: 1000000, max: null }, now), true) // không giới hạn trên
  assert.equal(matchesRange({ ageMin: 16, ageMax: 40 }, "AGE", { min: 13, max: 17 }, now), true) // khoảng giao nhau
  assert.equal(matchesRange({ ageMin: 18, ageMax: 40 }, "AGE", { min: 6, max: 12 }, now), false)
})

test("sửa sản phẩm đang hiển thị đã bán hết vẫn lưu được; chỉ kiểm tồn lúc xuất bản", () => {
  const body = { name: "Bình", sku: "GM-KGC-005", slug: "binh", categoryId: "x", axis: "GAME", images: ["/images/a.png"], price: 100000, status: "DANG_HIEN_THI", variants: [{ attributes: {}, stock: 0 }] }
  assert.throws(() => pa.normalizeProduct(body), /tồn kho/)
  assert.doesNotThrow(() => pa.normalizeProduct(body, new Date(), { requireStock: false }))
})

test("khối Video nhận đường dẫn YouTube, bỏ đường dẫn khác (CAT-05 AC9)", () => {
  process.env.MONGODB_URI ||= "mongodb://localhost/test"
  const { youtubeId } = require("../controllers/admin-home.controller")
  assert.equal(youtubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10"), "dQw4w9WgXcQ")
  assert.equal(youtubeId("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ")
  assert.equal(youtubeId("https://vimeo.com/123456"), null)
})

test("BST sắp Liên quan nhất: cộng 1 điểm cho mỗi điều kiện khớp, NE đảo điều kiện", () => {
  const { collectionRulesScore } = require("../services/productQuery")
  const s = collectionRulesScore([{ field: "AXIS", value: "ANIME" }, { field: "ON_SALE", value: true }, { field: "AXIS", operator: "NE", value: "GAME" }])
  assert.equal(s.$add.length, 3)
  assert.deepEqual(s.$add[0], { $cond: [{ $eq: ["$axis", "ANIME"] }, 1, 0] })
  assert.deepEqual(s.$add[2].$cond[0], { $not: [{ $eq: ["$axis", "GAME"] }] })
  assert.equal(collectionRulesScore([]), 0)
})

test("Gợi ý SKU kế tiếp theo trục và danh mục, BST chỉ chèn mã, không tách dãy số (BR-46)", () => {
  const skus = ["TT-MMN-001", "TT-MMN-006", "TT-MMN-SNBD-007", "TT-MMNX-099", "AN-MMN-020"]
  assert.deepEqual(pa.suggestSku({ axis: "THE_THAO", categoryCode: "MMN", existingSkus: skus }), { prefix: "TT-MMN", next: 8, sku: "TT-MMN-008" })
  assert.equal(pa.suggestSku({ axis: "THE_THAO", categoryCode: "MMN", collectionCode: "VAL26", existingSkus: skus }).sku, "TT-MMN-VAL26-008")
  assert.equal(pa.suggestSku({ axis: "GAME", categoryCode: "TBN", existingSkus: [] }).sku, "GM-TBN-001")
})
