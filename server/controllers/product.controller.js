// Sản phẩm phía khách (07_API_Spec.md Mục 2.3): API-26 danh sách, API-184 lọc giá, API-27 gợi ý tìm kiếm,
// API-28 chi tiết, API-29 đánh giá. Chỉ trả sản phẩm DANG_HIEN_THI.
const { database, ObjectId } = require("../config/db")
const params = require("../config/params")
const HttpError = require("../utils/httpError")
const { accentInsensitivePattern } = require("../utils/vnText")
const { onSaleExpr, basePriceExpr } = require("../services/pricing")
const { CARD_FIELDS, parseListQuery, customerVisible, visible } = require("../services/productQuery")
const { toCard, toDetail } = require("../services/productView")
const { listProducts, textMatches } = require("../services/catalog")
const { stickerSetsFor } = require("../services/personalization")
const { hiddenName, REVIEW_LIKES, RATING_LABELS } = require("../services/afterSalesRules")
const productStats = require("../services/productStats")

const products = () => database.collection("products")

// API-26 GET /api/products?q=&category=&axis=&tags=&priceMin=&priceMax=&age=&rating=&chip=&sort=&page=&pageSize=
async function getProducts(req, res) {
  res.send(await listProducts(parseListQuery(req.query)))
}

// API-184 GET /api/products/filter/price?min=&max= - theo mẫu slide 6.7.2 (/books/filter/price).
async function filterByPrice(req, res) {
  const min = parseFloat(req.query.min)
  const max = parseFloat(req.query.max)
  if (req.query.min === undefined || req.query.max === undefined || isNaN(min) || isNaN(max) || min > max) {
    throw new HttpError(400, "VALIDATION_ERROR", "Vui lòng cung cấp đầy đủ tham số ?min=...&max=...")
  }
  const now = new Date()
  const result = await products()
    .aggregate([
      { $match: customerVisible() },
      { $addFields: { basePrice: basePriceExpr(now), onSale: onSaleExpr(now) } },
      { $match: { basePrice: { $gte: min, $lte: max } } },
      { $sort: { basePrice: 1, _id: 1 } },
      { $project: CARD_FIELDS },
    ])
    .toArray()
  res.send(result.map((p) => toCard(p, now)))
}

// API-27 GET /api/products/suggest?q= - tối đa 5 gợi ý: danh mục khớp trước, rồi tên sản phẩm (UC-DIS-03 bước 3).
// Lịch sử tìm kiếm của Member (type "history") thêm ở S2 khi có đăng nhập.
async function suggest(req, res) {
  const q = String(req.query.q || "").trim()
  if (q.length < params.SEARCH_MIN_CHARS) return res.send([])

  const categories = await database.collection("categories").find({ isActive: true }).sort({ sortOrder: 1 }).toArray()
  const items = categories
    .filter((c) => textMatches(q, [c.name]))
    .slice(0, 2)
    .map((c) => ({ type: "category", label: c.name, slug: c.slug }))

  const found = await products()
    .find(visible({ name: { $regex: accentInsensitivePattern(q), $options: "i" } }))
    .project({ name: 1, slug: 1, images: { $slice: 1 } })
    .sort({ soldCount: -1, viewCount: -1 })
    .limit(params.SUGGEST_LIMIT - items.length)
    .toArray()
  for (const p of found) items.push({ type: "product", label: p.name, slug: p.slug, image: (p.images || [])[0] || null })

  res.send(items)
}

// API-28 GET /api/products/:slug
async function getProductBySlug(req, res) {
  const now = new Date()
  const product = await products().findOne(visible({ slug: req.params["slug"] }))
  if (!product) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy sản phẩm")

  const [category, tags, stickerSets, related] = await Promise.all([
    database.collection("categories").findOne({ _id: product.categoryId }, { projection: { name: 1, slug: 1 } }),
    database
      .collection("tags")
      .find({ _id: { $in: product.tagIds || [] } })
      .project({ name: 1, slug: 1, group: 1 })
      .toArray(),
    stickerSetsFor(product, now),
    // "Có thể bạn quan tâm": cùng danh mục hoặc cùng tag (UC-DIS-02 bước 6)
    products()
      .find(
        visible({
          _id: { $ne: product._id },
          $or: [{ categoryId: product.categoryId }, { tagIds: { $in: product.tagIds || [] } }],
        }),
      )
      .sort({ soldCount: -1, viewCount: -1, _id: 1 })
      .limit(params.RELATED_LIMIT)
      .toArray(),
  ])

  // Đếm lượt xem (hậu điều kiện UC-DIS-02)
  await products().updateOne({ _id: product._id }, { $inc: { viewCount: 1 } })
  productStats.record(product._id, "views") // phễu theo ngày ở SCR-40

  res.send({
    ...toDetail(product, now, { category, tags }),
    stickerSets,
    related: related.map((p) => toCard(p, now)),
  })
}

// API-29 GET /api/products/:id/reviews?rating=&page= - danh sách + phân bố số sao (đánh giá bị ẩn không trả).
async function getReviews(req, res) {
  const id = req.params["id"]
  if (!ObjectId.isValid(id)) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy sản phẩm")
  const productId = new ObjectId(id)
  const base = { productId, isHidden: { $ne: true } }

  const rating = parseInt(req.query.rating)
  const filter = rating >= 1 && rating <= 5 ? { ...base, rating } : base
  const page = Math.max(1, parseInt(req.query.page) || 1)
  const pageSize = params.REVIEW_PAGE_SIZE

  const reviews = database.collection("reviews")
  const [items, total, groups] = await Promise.all([
    reviews
      .find(filter)
      .project({ userName: 1, rating: 1, comment: 1, images: 1, createdAt: 1, variantName: 1, likes: 1, hideName: 1, reply: 1 })
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .toArray(),
    reviews.countDocuments(filter),
    reviews.aggregate([{ $match: base }, { $group: { _id: "$rating", n: { $sum: 1 } } }]).toArray(),
  ])

  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  for (const g of groups) distribution[g._id] = g.n
  const count = Object.values(distribution).reduce((a, b) => a + b, 0)
  const sum = Object.entries(distribution).reduce((a, [star, n]) => a + star * n, 0)

  res.send({
    // Tên che dạng "M*** A" khi khách chọn "Ẩn tên khi hiển thị đánh giá"; điểm thích kèm nhãn
    // Phản hồi từ Soulprint (UC-OPS-08 1b): chỉ trả nội dung và thời điểm, không lộ tên nhân viên
    items: items.map(({ hideName, likes, reply, ...x }) => ({
      ...x,
      reply: reply && reply.text ? { text: reply.text, at: reply.updatedAt || reply.at } : null,
      userName: hideName ? hiddenName(x.userName) : x.userName,
      ratingLabel: RATING_LABELS[x.rating],
      likes: (likes || []).filter((k) => REVIEW_LIKES[k]).map((k) => ({ code: k, label: REVIEW_LIKES[k] })),
    })),
    page,
    pageSize,
    total,
    distribution,
    ratingAvg: count ? Math.round((sum / count) * 10) / 10 : 0,
    ratingCount: count,
  })
}

module.exports = { getProducts, filterByPrice, suggest, getProductBySlug, getReviews }
