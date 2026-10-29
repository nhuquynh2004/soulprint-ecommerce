// Danh sách yêu thích của Member (07_API_Spec.md Mục 2.2, UC-CRT-02): API-18 GET, API-19 POST, API-20 DELETE.
// users.wishlist là mảng productId; $addToSet / $pull nên bấm nhiều lần liên tiếp không tạo mục trùng (AC1).
const { database, ObjectId } = require("../config/db")
const productStats = require("../services/productStats")
const HttpError = require("../utils/httpError")
const { toCard } = require("../services/productView")

const users = () => database.collection("users")
const toId = (v) => (v && ObjectId.isValid(String(v)) ? new ObjectId(String(v)) : null)

async function currentIds(userId) {
  const u = await users().findOne({ _id: userId }, { projection: { wishlist: 1 } })
  return (u && u.wishlist) || []
}

// API-18 GET /api/account/wishlist?ids=true - thẻ sản phẩm mới nhất trước kèm trạng thái (4Eb):
// DANG_BAN, TAM_HET (hết hàng), NGUNG_KINH_DOANH (ngừng bán, bị ẩn hoặc đã xóa). ids=true chỉ trả mảng id để tô trái tim.
async function getWishlist(req, res) {
  const ids = await currentIds(req.user._id)
  if (req.query.ids === "true") return res.send(ids.map(String))
  const list = ids.length ? await database.collection("products").find({ _id: { $in: ids } }).toArray() : []
  const byId = new Map(list.map((p) => [String(p._id), p]))
  const now = new Date()
  const items = [...ids].reverse().map((id) => {
    const p = byId.get(String(id))
    if (!p) return { _id: id, name: "Sản phẩm không còn tồn tại", slug: null, image: null, finalPrice: 0, price: 0, status: "NGUNG_KINH_DOANH" }
    const card = toCard(p, now)
    const status = p.status !== "DANG_HIEN_THI" ? "NGUNG_KINH_DOANH" : card.inStock ? "DANG_BAN" : "TAM_HET"
    const active = (p.variants || []).filter((v) => v.isActive !== false)
    return { ...card, status, needsOptions: active.length > 1, defaultVariantSku: active.length === 1 ? active[0].sku : null }
  })
  res.send(items)
}

// API-19 POST /api/account/wishlist - {productId}; chỉ thêm sản phẩm đang hiển thị
async function addToWishlist(req, res) {
  const productId = toId(req.body && req.body.productId)
  const p = productId && (await database.collection("products").findOne({ _id: productId, status: "DANG_HIEN_THI" }, { projection: { _id: 1 } }))
  if (!p) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy sản phẩm")
  const r = await users().updateOne({ _id: req.user._id }, { $addToSet: { wishlist: productId } })
  if (r.modifiedCount) productStats.record(productId, "wishlists") // chỉ đếm lần thêm mới
  res.send({ wishlist: (await currentIds(req.user._id)).map(String) })
}

// API-20 DELETE /api/account/wishlist/:productId
async function removeFromWishlist(req, res) {
  const productId = toId(req.params["productId"])
  if (productId) await users().updateOne({ _id: req.user._id }, { $pull: { wishlist: productId } })
  res.send({ wishlist: (await currentIds(req.user._id)).map(String) })
}

module.exports = { getWishlist, addToWishlist, removeFromWishlist }
