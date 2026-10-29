// Dựng truy vấn danh sách sản phẩm cho API-26 (lọc, sắp xếp, phân trang - UC-DIS-03, UC-DIS-04)
// và cho trang bộ sưu tập API-108. Chỉ gồm hàm thuần (không gọi CSDL) để viết unit test được;
// phần tra slug -> ObjectId nằm ở services/catalog.js.
//
// Quy tắc lọc: AND giữa các nhóm tiêu chí, OR trong cùng một nhóm (UC-DIS-04 bước 3).
const { ObjectId } = require("mongodb")
const params = require("../config/params")
const { onSaleExpr, basePriceExpr } = require("./pricing")

const DAY = 24 * 60 * 60 * 1000

// Trục đam mê: URL dùng slug, CSDL lưu enum (06 Mục 2.4).
const AXES = { "the-thao": "THE_THAO", anime: "ANIME", game: "GAME" }
const CHIPS = ["ban-chay", "moi", "giam-gia", "danh-gia-cao", "goi-y-ai"]
const SORTS = {
  "gia-tang": { basePrice: 1, _id: 1 },
  "gia-giam": { basePrice: -1, _id: 1 },
  "moi-nhat": { createdAt: -1, _id: 1 },
  "pho-bien": { soldCount: -1, viewCount: -1, _id: 1 },
}
// Thứ tự riêng của chip, dùng khi khách chưa chọn sắp xếp (07 Mục 2.3).
const CHIP_SORTS = {
  "ban-chay": { soldCount: -1, viewCount: -1, _id: 1 },
  moi: { createdAt: -1, _id: 1 },
  "danh-gia-cao": { ratingAvg: -1, ratingCount: -1, _id: 1 },
  "goi-y-ai": { aiRank: 1, _id: 1 },
}

// "a, b,,c" -> ["a", "b", "c"]
const toList = (value) =>
  String(value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

// Sản phẩm khách được thấy (07 Mục 2.3): đang hiển thị, và không phải loại "Tự ẩn khi hết hàng" đang hết hàng (BR-41)
const IN_STOCK = { variants: { $elemMatch: { isActive: { $ne: false }, stock: { $gt: 0 } } } }
function customerVisible() {
  return { status: "DANG_HIEN_THI", $or: [{ outOfStockBehavior: { $ne: "AN_KHI_HET" } }, IN_STOCK] }
}

// Ghép điều kiện hiển thị với điều kiện khác (dùng $and để không đè $or của nhau)
const visible = (extra = {}) => ({ $and: [customerVisible(), extra] })

function toNumber(value) {
  if (value === undefined || value === null || value === "") return null
  const n = parseFloat(value)
  return Number.isFinite(n) ? n : null
}

function toAxis(value) {
  if (AXES[value]) return AXES[value]
  return Object.values(AXES).includes(value) ? value : null
}

// Đọc query string của API-26 thành tham số đã chuẩn hóa. Giá trị không hợp lệ thì bỏ qua (không lọc theo nó).
function parseListQuery(query = {}) {
  const page = Math.max(1, Math.floor(toNumber(query.page) || 1))
  const pageSize = Math.min(params.MAX_PAGE_SIZE, Math.max(1, Math.floor(toNumber(query.pageSize) || params.PRODUCT_PAGE_SIZE)))

  // Độ tuổi dạng "18-25" hoặc "36" (một tuổi).
  let ageMin = null
  let ageMax = null
  if (query.age) {
    const [a, b] = String(query.age).split("-").map(toNumber)
    if (a !== null) {
      ageMin = a
      ageMax = b ?? a
    }
  }

  const rating = toNumber(query.rating)
  return {
    q: String(query.q ?? "").trim(),
    categories: toList(query.category),
    axes: toList(query.axis).map(toAxis).filter(Boolean),
    tags: toList(query.tags),
    priceMin: toNumber(query.priceMin),
    priceMax: toNumber(query.priceMax),
    ageMin,
    ageMax,
    rating: rating !== null && rating > 0 && rating <= 5 ? rating : null,
    chip: CHIPS.includes(query.chip) ? query.chip : null,
    sort: SORTS[query.sort] ? query.sort : null,
    page,
    pageSize,
  }
}

// Điều kiện lọc. `refs` là kết quả tra CSDL:
//   categoryIds: ObjectId[] | null   (null = không lọc danh mục; [] = slug không tồn tại -> không có kết quả)
//   tagGroups:   ObjectId[][]        (mỗi phần tử là các tag cùng nhóm: OR trong nhóm, AND giữa nhóm)
//   search:      { pattern, skuPattern, categoryIds, tagIds } | null
//   aiProductIds: ObjectId[] | null  (chip "Gợi ý bởi AI", đã xếp theo số lần được gợi ý)
// Trả về 2 tầng: `match` chạy trước (dùng index), `postMatch` chạy sau khi đã tính giá hiệu lực.
function buildMatch(p, refs = {}, now = new Date()) {
  const and = [customerVisible()]
  const post = []

  if (refs.categoryIds) and.push({ categoryId: { $in: refs.categoryIds } })
  if (p.axes.length) and.push({ axis: { $in: p.axes } })
  for (const group of refs.tagGroups || []) and.push({ tagIds: { $in: group } })

  if (refs.search) {
    const { pattern, skuPattern, categoryIds = [], tagIds = [] } = refs.search
    const or = [
      { name: { $regex: pattern, $options: "i" } },
      { shortDescription: { $regex: pattern, $options: "i" } },
    ]
    if (skuPattern) or.push({ sku: { $regex: skuPattern, $options: "i" } }, { "variants.sku": { $regex: skuPattern, $options: "i" } })
    if (categoryIds.length) or.push({ categoryId: { $in: categoryIds } })
    if (tagIds.length) or.push({ tagIds: { $in: tagIds } })
    and.push({ $or: or })
  }

  // Khoảng tuổi của sản phẩm giao với khoảng khách chọn.
  if (p.ageMin !== null) {
    and.push({ $or: [{ ageMin: null }, { ageMin: { $lte: p.ageMax } }] })
    and.push({ $or: [{ ageMax: null }, { ageMax: { $gte: p.ageMin } }] })
  }
  if (p.rating !== null) and.push({ ratingAvg: { $gte: p.rating } })

  if (p.chip === "moi") and.push({ createdAt: { $gte: new Date(now.getTime() - params.NEW_PRODUCT_DAYS * DAY) } })
  if (p.chip === "danh-gia-cao") and.push({ ratingAvg: { $gte: params.HIGH_RATING_MIN } })
  if (p.chip === "goi-y-ai") and.push({ _id: { $in: refs.aiProductIds || [] } })
  if (p.chip === "giam-gia") post.push({ onSale: true })

  if (p.priceMin !== null) post.push({ basePrice: { $gte: p.priceMin } })
  if (p.priceMax !== null) post.push({ basePrice: { $lte: p.priceMax } })

  return { match: { $and: and }, postMatch: post.length ? { $and: post } : null }
}

function sortStage(p, fallback = "pho-bien") {
  if (p.sort) return SORTS[p.sort]
  if (p.chip && CHIP_SORTS[p.chip]) return CHIP_SORTS[p.chip]
  return SORTS[fallback] || fallback
}

// Trường cần cho thẻ sản phẩm (giữ kết quả $facet nhỏ, không trả costPrice).
const CARD_FIELDS = {
  name: 1, slug: 1, images: { $slice: ["$images", 1] }, price: 1, salePrice: 1, saleStartAt: 1, saleEndAt: 1,
  basePrice: 1, onSale: 1, axis: 1, categoryId: 1, ratingAvg: 1, ratingCount: 1, soldCount: 1, createdAt: 1,
  "personalization.allowed": 1, "personalization.types": 1, "variants.stock": 1, "variants.isActive": 1,
}

// Pipeline aggregation đầy đủ: lọc -> tính giá hiệu lực -> lọc giá -> sắp xếp + phân trang và đếm tổng ($facet).
// `extra.match` thêm điều kiện (VD sản phẩm của bộ sưu tập), `extra.order` là danh sách _id để xếp theo thứ tự tay.
function buildListPipeline(p, refs = {}, now = new Date(), extra = {}) {
  const { match, postMatch } = buildMatch(p, refs, now)
  const pipeline = [{ $match: extra.match ? { $and: [match, extra.match] } : match }]
  pipeline.push({ $addFields: { basePrice: basePriceExpr(now), onSale: onSaleExpr(now) } })
  if (postMatch) pipeline.push({ $match: postMatch })
  if (extra.postMatch) pipeline.push({ $match: extra.postMatch })
  if (extra.scoreExpr) pipeline.push({ $addFields: { relevance: extra.scoreExpr } }) // BST tự động sắp "Liên quan nhất"

  let sort = sortStage(p, extra.defaultSort)
  const order = p.chip === "goi-y-ai" && !p.sort ? refs.aiProductIds : !p.sort && !p.chip ? extra.order : null
  if (order) {
    pipeline.push({ $addFields: { aiRank: { $indexOfArray: [order, "$_id"] } } })
    sort = { aiRank: 1, _id: 1 }
  } else if (refs.search && !p.sort && !p.chip) {
    // UC-DIS-03 bước 5: khách chưa chọn sắp xếp thì tên có từ bắt đầu bằng từ khóa lên đầu, rồi tên chứa từ khóa
    const hit = (regex) => ({ $regexMatch: { input: "$name", regex, options: "i" } })
    pipeline.push({ $addFields: { nameHit: { $cond: [hit("(^|\\s)" + refs.search.pattern), 2, { $cond: [hit(refs.search.pattern), 1, 0] }] } } })
    sort = { nameHit: -1, ...sort }
  }

  pipeline.push({
    $facet: {
      items: [{ $sort: sort }, { $skip: (p.page - 1) * p.pageSize }, { $limit: p.pageSize }, { $project: CARD_FIELDS }],
      total: [{ $count: "n" }],
    },
  })
  return pipeline
}

// Điều kiện của bộ sưu tập tự động (06 Mục 2.6): rules [{field, operator, value}], matchMode ALL | ANY.
// Áp dụng sau bước tính giá hiệu lực vì có điều kiện PRICE, ON_SALE.
function collectionRulesMatch(rules = [], matchMode = "ALL", now = new Date()) {
  const toId = (v) => (ObjectId.isValid(String(v)) ? new ObjectId(String(v)) : null)
  const yes = (v) => v === true || v === "true"
  const conds = []
  for (const { field, operator = "EQ", value } of rules) {
    const not = operator === "NE"
    let cond = null
    if (field === "CATEGORY") cond = { categoryId: toId(value) }
    else if (field === "TAG") cond = { tagIds: toId(value) }
    else if (field === "AXIS") cond = { axis: toAxis(value) }
    else if (field === "PRICE") cond = { basePrice: { [operator === "GT" ? "$gt" : "$lt"]: Number(value) } }
    else if (field === "CREATED_WITHIN_DAYS")
      cond = { createdAt: { $gte: new Date(now.getTime() - Number(value) * DAY) } }
    else if (field === "IN_STOCK")
      cond = { variants: { [yes(value) ? "$elemMatch" : "$not"]: yes(value) ? { isActive: true, stock: { $gt: 0 } } : { $elemMatch: { isActive: true, stock: { $gt: 0 } } } } }
    else if (field === "ON_SALE") cond = { onSale: value === undefined ? true : yes(value) }
    if (!cond) continue
    conds.push(not ? { $nor: [cond] } : cond)
  }
  if (!conds.length) return { _id: null } // không có điều kiện hợp lệ thì không khớp sản phẩm nào
  return matchMode === "ANY" ? { $or: conds } : { $and: conds }
}

// Điểm "Liên quan nhất" của BST tự động: số điều kiện sản phẩm khớp, dùng sau bước tính giá hiệu lực.
// Cùng ý nghĩa với collectionRulesMatch nhưng viết bằng biểu thức aggregation để cộng điểm.
function collectionRulesScore(rules = [], now = new Date()) {
  const toId = (v) => (ObjectId.isValid(String(v)) ? new ObjectId(String(v)) : null)
  const yes = (v) => v === true || v === "true"
  const inStock = { $anyElementTrue: [{ $map: { input: { $ifNull: ["$variants", []] }, as: "v", in: { $and: [{ $ne: ["$v.isActive", false] }, { $gt: ["$v.stock", 0] }] } } }] }
  const parts = []
  for (const { field, operator = "EQ", value } of rules) {
    let e = null
    if (field === "CATEGORY") e = { $eq: ["$categoryId", toId(value)] }
    else if (field === "TAG") e = { $in: [toId(value), { $ifNull: ["$tagIds", []] }] }
    else if (field === "AXIS") e = { $eq: ["$axis", toAxis(value)] }
    else if (field === "PRICE") e = { [operator === "GT" ? "$gt" : "$lt"]: ["$basePrice", Number(value)] }
    else if (field === "CREATED_WITHIN_DAYS") e = { $gte: ["$createdAt", new Date(now.getTime() - Number(value) * DAY)] }
    else if (field === "IN_STOCK") e = yes(value) ? inStock : { $not: [inStock] }
    else if (field === "ON_SALE") e = { $eq: ["$onSale", value === undefined ? true : yes(value)] }
    if (!e) continue
    parts.push({ $cond: [operator === "NE" ? { $not: [e] } : e, 1, 0] })
  }
  return parts.length ? { $add: parts } : 0
}

module.exports = { AXES, IN_STOCK, customerVisible, visible, CARD_FIELDS, parseListQuery, buildMatch, buildListPipeline, collectionRulesMatch, collectionRulesScore, toList }
