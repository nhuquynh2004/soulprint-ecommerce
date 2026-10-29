const test = require("node:test")
const assert = require("node:assert")
const { ObjectId } = require("mongodb")
const { parseListQuery, buildMatch, buildListPipeline, collectionRulesMatch, customerVisible } = require("../services/productQuery")

const now = new Date("2026-10-15T00:00:00+07:00")

test("đọc query: danh sách cách bởi dấu phẩy, trục đam mê theo slug, phân trang mặc định 12", () => {
  const p = parseListQuery({ tags: "sinh-nhat, tot-nghiep", axis: "anime,the-thao", page: "2" })
  assert.deepEqual(p.tags, ["sinh-nhat", "tot-nghiep"])
  assert.deepEqual(p.axes, ["ANIME", "THE_THAO"])
  assert.equal(p.page, 2)
  assert.equal(p.pageSize, 12)
})

test("giá trị không hợp lệ thì bỏ qua", () => {
  const p = parseListQuery({ priceMin: "abc", chip: "khong-co", sort: "lung-tung", rating: "9", pageSize: "1000" })
  assert.equal(p.priceMin, null)
  assert.equal(p.chip, null)
  assert.equal(p.sort, null)
  assert.equal(p.rating, null)
  assert.equal(p.pageSize, 48)
})

test("độ tuổi dạng khoảng hoặc một số", () => {
  assert.deepEqual([parseListQuery({ age: "18-25" }).ageMin, parseListQuery({ age: "18-25" }).ageMax], [18, 25])
  assert.deepEqual([parseListQuery({ age: "36" }).ageMin, parseListQuery({ age: "36" }).ageMax], [36, 36])
})

test("AND giữa các nhóm tag, OR trong cùng nhóm (UC-DIS-04 AC1)", () => {
  const sinhNhat = new ObjectId()
  const totNghiep = new ObjectId()
  const bongDa = new ObjectId()
  const { match } = buildMatch(parseListQuery({}), { tagGroups: [[sinhNhat, totNghiep], [bongDa]] }, now)
  assert.deepEqual(match.$and, [
    customerVisible(),
    { tagIds: { $in: [sinhNhat, totNghiep] } },
    { tagIds: { $in: [bongDa] } },
  ])
})

test("từ khóa khớp cả SKU sản phẩm và SKU phân loại (API-26)", () => {
  const { match } = buildMatch(parseListQuery({ q: "GM-GBX-003" }), { search: { pattern: "GM-GBX-003", skuPattern: "GM-GBX-003" } }, now)
  const or = match.$and.find((c) => c.$or && c.$or.some((x) => x.name)).$or
  assert.ok(or.some((x) => x.sku && x.sku.$regex === "GM-GBX-003" && x.sku.$options === "i"))
  assert.ok(or.some((x) => x["variants.sku"] && x["variants.sku"].$regex === "GM-GBX-003"))
  assert.ok(new RegExp(or.find((x) => x.sku).sku.$regex, "i").test("gm-gbx-003"))
})

test("slug danh mục không tồn tại thì không có kết quả", () => {
  const { match } = buildMatch(parseListQuery({ category: "khong-co" }), { categoryIds: [] }, now)
  assert.deepEqual(match.$and[1], { categoryId: { $in: [] } })
})

test("lọc giá và chip giảm giá chạy sau khi tính giá hiệu lực", () => {
  const { postMatch } = buildMatch(parseListQuery({ priceMax: "300000", chip: "giam-gia" }), {}, now)
  assert.deepEqual(postMatch.$and, [{ onSale: true }, { basePrice: { $lte: 300000 } }])
})

test("sắp xếp: chọn sort thì theo sort; chỉ có chip thì theo thứ tự của chip; mặc định phổ biến", () => {
  const sortOf = (q) => buildListPipeline(parseListQuery(q), {}, now).at(-1).$facet.items[0].$sort
  assert.deepEqual(sortOf({ sort: "gia-tang", chip: "moi" }), { basePrice: 1, _id: 1 })
  assert.deepEqual(sortOf({ chip: "moi" }), { createdAt: -1, _id: 1 })
  assert.deepEqual(sortOf({}), { soldCount: -1, viewCount: -1, _id: 1 })
})

test("phân trang: trang 3, 12 sản phẩm/trang bỏ qua 24", () => {
  const facet = buildListPipeline(parseListQuery({ page: "3" }), {}, now).at(-1).$facet
  assert.deepEqual(facet.items.slice(1, 3), [{ $skip: 24 }, { $limit: 12 }])
})

test("bộ sưu tập tự động: khớp tất cả / khớp bất kỳ", () => {
  const rules = [
    { field: "AXIS", operator: "EQ", value: "ANIME" },
    { field: "PRICE", operator: "LT", value: 500000 },
  ]
  assert.deepEqual(collectionRulesMatch(rules, "ALL", now), { $and: [{ axis: "ANIME" }, { basePrice: { $lt: 500000 } }] })
  assert.deepEqual(collectionRulesMatch(rules, "ANY", now), { $or: [{ axis: "ANIME" }, { basePrice: { $lt: 500000 } }] })
  assert.deepEqual(collectionRulesMatch([{ field: "AXIS", operator: "NE", value: "GAME" }], "ALL", now), {
    $and: [{ $nor: [{ axis: "GAME" }] }],
  })
})

test("sản phẩm Tự ẩn khi hết hàng chỉ hiện khi còn ít nhất 1 biến thể đang bán có tồn (BR-41)", () => {
  const v = customerVisible()
  assert.equal(v.status, "DANG_HIEN_THI")
  assert.deepEqual(v.$or[0], { outOfStockBehavior: { $ne: "AN_KHI_HET" } })
  assert.deepEqual(v.$or[1], { variants: { $elemMatch: { isActive: { $ne: false }, stock: { $gt: 0 } } } })
})
