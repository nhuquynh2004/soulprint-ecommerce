// API-108 GET /api/collections/:slug - trang bộ sưu tập SCR-32: thông tin BST + sản phẩm có lọc/sắp xếp như API-26.
// Chỉ BST HIEN_THI trong thời gian hiển thị. BST đã hết thời gian trả 404 kèm `ended`, tóm tắt BST và các BST đang mở
// để SCR-32 hiện trạng thái "Bộ sưu tập này đã kết thúc".
const { database } = require("../config/db")
const HttpError = require("../utils/httpError")
const { parseListQuery } = require("../services/productQuery")
const { listProducts, isCollectionOpen, collectionScope } = require("../services/catalog")

const summary = (c) => ({
  _id: c._id,
  name: c.name,
  slug: c.slug,
  description: c.description || "",
  coverImage: c.coverImage || null,
  startAt: c.startAt || null,
  endAt: c.endAt || null,
})

async function openCollections(now, exceptId) {
  const list = await database.collection("collections").find({ status: "HIEN_THI" }).sort({ sortOrder: 1 }).toArray()
  return list.filter((c) => isCollectionOpen(c, now) && !c._id.equals(exceptId)).slice(0, 4).map(summary)
}

async function getCollectionBySlug(req, res) {
  const now = new Date()
  const c = await database.collection("collections").findOne({ slug: req.params["slug"] })
  if (!isCollectionOpen(c, now)) {
    const ended = c && c.status === "HIEN_THI" && c.endAt && c.endAt < now
    const extra = ended ? { ended: true, collection: summary(c), openCollections: await openCollections(now, c._id) } : {}
    throw new HttpError(404, "NOT_FOUND", ended ? "Bộ sưu tập này đã kết thúc" : "Không tìm thấy bộ sưu tập", extra)
  }
  const list = await listProducts(parseListQuery(req.query), collectionScope(c, now), now)
  res.send({ collection: summary(c), ...list })
}

// API-207 GET /api/collections - BST đang mở cho menu xổ "Bộ sưu tập" ở thanh điều hướng; bỏ BST chưa có sản phẩm hiển thị
async function listOpenCollections(req, res) {
  const now = new Date()
  // Thứ tự theo khối BST trên trang chủ đã xuất bản (kể cả khối đang tắt), BST không có khối xếp sau theo sortOrder
  const [all, home] = await Promise.all([
    database.collection("collections").find({ status: "HIEN_THI" }).sort({ sortOrder: 1, _id: 1 }).toArray(),
    database.collection("siteSettings").findOne({ key: "home" }, { projection: { "published.sections": 1 } }),
  ])
  const blockOrder = ((home && home.published && home.published.sections) || []).filter((s) => s.type === "collection").map((s) => String(s.settings?.collectionId))
  const rank = (c) => (blockOrder.includes(String(c._id)) ? blockOrder.indexOf(String(c._id)) : blockOrder.length)
  const list = all.filter((c) => isCollectionOpen(c, now)).sort((a, b) => rank(a) - rank(b)) // sort ổn định: cùng hạng giữ sortOrder
  const counted = await Promise.all(
    list.map(async (c) => ({ ...summary(c), productCount: (await listProducts(parseListQuery({ pageSize: 1 }), collectionScope(c, now), now)).total }))
  )
  res.send(counted.filter((c) => c.productCount > 0).map(({ _id, name, slug, coverImage, productCount }) => ({ _id, name, slug, coverImage, productCount })))
}

module.exports = { getCollectionBySlug, listOpenCollections }
