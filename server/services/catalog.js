// Truy vấn catalog dùng chung cho các controller của S1 (sản phẩm, trang chủ, bộ sưu tập).
// Driver mongodb theo Chương VII: database.collection(...).find(...).toArray(), findOne, aggregate.
const { database } = require("../config/db")
const params = require("../config/params")
const { removeAccents, accentInsensitivePattern, escapeRegex, VI_COLLATION } = require("../utils/vnText")
const { buildListPipeline, collectionRulesMatch, collectionRulesScore } = require("./productQuery")
const { toCard } = require("./productView")

const products = () => database.collection("products")

// Tên/từ đồng nghĩa của danh mục, tag có nằm trong từ khóa không (hoặc ngược lại), so sánh không dấu.
// VD "qua sinh nhat ban trai" khớp tag "Sinh nhật" và "Bạn trai".
function textMatches(keyword, names) {
  const k = removeAccents(keyword)
  return names.some((n) => {
    const v = removeAccents(n)
    return v.length >= params.SEARCH_MIN_CHARS && (k.includes(v) || v.includes(k))
  })
}

async function searchRefs(q) {
  const [categories, tags] = await Promise.all([
    database.collection("categories").find({ isActive: true }).toArray(),
    database.collection("tags").find({}).toArray(),
  ])
  return {
    pattern: accentInsensitivePattern(q),
    // Mã SKU sản phẩm, SKU phân loại khớp một phần (hộp Đổi sản phẩm của nhân viên gõ mã)
    skuPattern: escapeRegex(String(q).trim()),
    categoryIds: categories.filter((c) => textMatches(q, [c.name])).map((c) => c._id),
    tagIds: tags.filter((t) => textMatches(q, [t.name, ...(t.synonyms || [])])).map((t) => t._id),
  }
}

// Sản phẩm từng được gợi ý ở UC-DIS-05, nhiều lần trước (chip "Gợi ý bởi AI"). Rỗng cho tới S10.
async function aiSuggestedIds() {
  const rows = await database
    .collection("aiSessions")
    .aggregate([
      { $unwind: "$results" },
      { $group: { _id: "$results.productId", n: { $sum: 1 } } },
      { $sort: { n: -1 } },
      { $limit: 200 },
    ])
    .toArray()
  return rows.map((r) => r._id)
}

// Tra slug trong query (danh mục, tag) sang ObjectId để buildMatch dùng.
async function resolveListRefs(p) {
  const refs = { categoryIds: null, tagGroups: [], search: null, aiProductIds: null }
  if (p.categories.length) {
    const found = await database
      .collection("categories")
      .find({ slug: { $in: p.categories }, isActive: true })
      .toArray()
    refs.categoryIds = found.map((c) => c._id)
  }
  if (p.tags.length) {
    const found = await database
      .collection("tags")
      .find({ slug: { $in: p.tags } })
      .toArray()
    const byGroup = new Map()
    for (const t of found) byGroup.set(t.group, [...(byGroup.get(t.group) || []), t._id])
    refs.tagGroups = [...byGroup.values()]
  }
  if (p.q.length >= params.SEARCH_MIN_CHARS) refs.search = await searchRefs(p.q)
  if (p.chip === "goi-y-ai") refs.aiProductIds = await aiSuggestedIds()
  return refs
}

// Danh sách phân trang dạng { items, page, pageSize, total } (07 Mục 1.2).
async function listProducts(p, extra = {}, now = new Date()) {
  const refs = await resolveListRefs(p)
  const [result] = await products().aggregate(buildListPipeline(p, refs, now, extra), { collation: VI_COLLATION }).toArray()
  return {
    items: result.items.map((x) => toCard(x, now)),
    page: p.page,
    pageSize: p.pageSize,
    total: result.total[0] ? result.total[0].n : 0,
  }
}

// Bộ sưu tập đang mở: HIEN_THI và trong thời gian hiển thị (06 Mục 2.6).
function isCollectionOpen(c, now = new Date()) {
  if (!c || c.status !== "HIEN_THI") return false
  if (c.startAt && new Date(c.startAt) > now) return false
  if (c.endAt && new Date(c.endAt) < now) return false
  return true
}

// Thứ tự sản phẩm của BST (06 Mục 2.6); giá trị là khóa SORTS của productQuery hoặc object sort
const COLLECTION_SORTS = {
  BAN_CHAY: "pho-bien",
  MOI_NHAT: "moi-nhat",
  GIA_TANG: "gia-tang",
  GIA_GIAM: "gia-giam",
  TEN_AZ: { name: 1, _id: 1 },
  TEN_ZA: { name: -1, _id: 1 },
  LIEN_QUAN: { relevance: -1, soldCount: -1, viewCount: -1, _id: 1 },
}

// Điều kiện lấy sản phẩm của 1 bộ sưu tập: chọn tay theo productIds (giữ thứ tự), tự động theo rules.
function collectionScope(c, now = new Date()) {
  if (c.type === "TU_DONG") {
    return {
      postMatch: collectionRulesMatch(c.rules, c.matchMode, now),
      ...(c.sortBy === "LIEN_QUAN" ? { scoreExpr: collectionRulesScore(c.rules, now) } : {}),
      defaultSort: COLLECTION_SORTS[c.sortBy] || "pho-bien",
    }
  }
  const ids = c.productIds || []
  return {
    match: { _id: { $in: ids } },
    order: c.sortBy === "THU_CONG" || !c.sortBy ? ids : null,
    defaultSort: (c.sortBy !== "LIEN_QUAN" && COLLECTION_SORTS[c.sortBy]) || "pho-bien",
  }
}

module.exports = { listProducts, resolveListRefs, isCollectionOpen, collectionScope, textMatches }
