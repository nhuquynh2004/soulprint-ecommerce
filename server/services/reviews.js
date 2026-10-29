// Đánh giá sản phẩm (UC-TRK-03; API-53, API-54, API-195). Đánh giá hiện ngay, nhân viên ẩn nội dung vi phạm sau
// (UC-OPS-08). Mỗi dòng sản phẩm của đơn chỉ đánh giá 1 lần: cờ items.reviewed giữ true kể cả khi khách xóa đánh giá.
const { database, ObjectId } = require("../config/db")
const params = require("../config/params")
const HttpError = require("../utils/httpError")
const rules = require("./afterSalesRules")
const common = require("./afterSalesCommon")
const { refreshRating } = require("./customersAdmin")

const reviews = () => database.collection("reviews")
const orders = () => database.collection("orders")
const HOUR = 60 * 60 * 1000

const fail = (e) => new HttpError(e.status, e.code, e.message, { fields: e.fields })

// Đánh giá của Member hiện ở dòng sản phẩm (SCR-19, SCR-27)
function view(x, now = new Date()) {
  return {
    _id: String(x._id),
    orderItemId: String(x.orderItemId),
    rating: x.rating,
    ratingLabel: rules.RATING_LABELS[x.rating],
    likes: x.likes || [],
    comment: x.comment || "",
    images: x.images || [],
    hideName: !!x.hideName,
    isHidden: !!x.isHidden,
    reply: x.reply && x.reply.text ? { text: x.reply.text, at: x.reply.updatedAt || x.reply.at } : null,
    createdAt: x.createdAt,
    editableUntil: x.editableUntil,
    editable: new Date(x.editableUntil) > now,
  }
}

async function forOrder(o) {
  const list = await reviews().find({ orderId: o._id }).toArray()
  return new Map(list.map((x) => [String(x.orderItemId), view(x)]))
}

// Ảnh gửi lên khi sửa: đường dẫn ảnh cũ được giữ, data URL là ảnh mới
async function readImages(list, { keep = [], userId }) {
  const items = Array.isArray(list) ? list : []
  if (items.length > params.RETURN_MAX_IMAGES) throw new HttpError(400, "VALIDATION_ERROR", `Tối đa ${params.RETURN_MAX_IMAGES} ảnh`, { fields: { images: `Tối đa ${params.RETURN_MAX_IMAGES} ảnh` } })
  const kept = items.filter((x) => common.isFileUrl(x) && keep.includes(x))
  const fresh = items.filter((x) => !common.isFileUrl(x))
  // Ảnh đánh giá hiện công khai trên SCR-03
  const urls = await common.saveFiles(fresh, { ownerUserId: userId, uploadedBy: userId, visibility: "CONG_KHAI", label: "Ảnh đánh giá" })
  return [...kept, ...urls]
}

// ===== API-53 =====

async function create(user, body) {
  const checked = rules.checkReview(body)
  if (checked.error) throw fail(checked.error)
  const itemId = ObjectId.isValid(String(body.orderItemId)) ? new ObjectId(String(body.orderItemId)) : null
  const o = itemId ? await orders().findOne({ userId: user._id, "items._id": itemId }) : null
  if (!o) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy sản phẩm trong đơn")
  // AC2: chỉ đánh giá đơn đã giao
  if (!["DA_GIAO", "HOAN_THANH"].includes(o.orderStatus)) throw new HttpError(422, "BUSINESS_RULE", "Chỉ đánh giá được sản phẩm của đơn đã giao")
  const it = o.items.find((i) => String(i._id) === String(itemId))
  if (it.reviewed) throw new HttpError(409, "ALREADY_REVIEWED", "Bạn đã đánh giá sản phẩm này")

  const images = await readImages(body.images, { userId: user._id })
  // Đánh dấu trước để 2 lần gửi cùng lúc chỉ 1 lần qua (AC3)
  const claim = await orders().updateOne({ _id: o._id, items: { $elemMatch: { _id: itemId, reviewed: { $ne: true } } } }, { $set: { "items.$.reviewed": true } })
  if (!claim.modifiedCount) {
    await common.removeFiles(images)
    throw new HttpError(409, "ALREADY_REVIEWED", "Bạn đã đánh giá sản phẩm này")
  }
  const now = new Date()
  const doc = {
    productId: it.productId, orderId: o._id, orderItemId: it._id, userId: user._id, userName: user.fullName || "Khách hàng",
    variantName: it.variantName || null, ...checked.value, images, editableUntil: new Date(now.getTime() + params.REVIEW_EDIT_HOURS * HOUR),
    isHidden: false, createdAt: now, updatedAt: now,
  }
  try {
    doc._id = (await reviews().insertOne(doc)).insertedId
  } catch (err) {
    await orders().updateOne({ _id: o._id, "items._id": itemId }, { $set: { "items.$.reviewed": false } })
    await common.removeFiles(images)
    throw err
  }
  await refreshRating(it.productId)
  return { review: view(doc, now) }
}

async function ownReview(user, id) {
  const x = ObjectId.isValid(String(id)) ? await reviews().findOne({ _id: new ObjectId(String(id)), userId: user._id }) : null
  if (!x) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy đánh giá")
  return x
}

// ===== API-54 =====

async function update(user, body) {
  const x = await ownReview(user, body._id)
  const now = new Date()
  // 1aEa: quá 24 giờ
  if (new Date(x.editableUntil) <= now) throw new HttpError(410, "EXPIRED", "Đã quá 24 giờ, không thể sửa đánh giá")
  const checked = rules.checkReview(body)
  if (checked.error) throw fail(checked.error)
  const images = await readImages(body.images, { keep: x.images || [], userId: user._id })
  const r = await reviews().updateOne({ _id: x._id, editableUntil: { $gt: now } }, { $set: { ...checked.value, images, updatedAt: now } })
  if (!r.modifiedCount) {
    await common.removeFiles(images.filter((u) => !(x.images || []).includes(u)))
    throw new HttpError(410, "EXPIRED", "Đã quá 24 giờ, không thể sửa đánh giá")
  }
  await common.removeFiles((x.images || []).filter((u) => !images.includes(u)))
  await refreshRating(x.productId)
  return { review: view({ ...x, ...checked.value, images }, now) }
}

// ===== API-195: xóa hẳn đánh giá và ảnh, không đánh giá lại =====

async function remove(user, id) {
  const x = await ownReview(user, id)
  await reviews().deleteOne({ _id: x._id })
  await common.removeFiles(x.images)
  await refreshRating(x.productId)
}

module.exports = { view, forOrder, create, update, remove }
