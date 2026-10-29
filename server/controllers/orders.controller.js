// Đơn hàng của khách (07_API_Spec.md Mục 2.7, 2.8, 2.2): API-42 đến API-46, tra cứu đơn API-55 đến API-58,
// thông báo API-21, API-22, API-192 - S7; hậu mãi API-47, API-48, API-50 đến API-54, API-195 - S9.
const { database, ObjectId } = require("../config/db")
const st = require("../services/orderState")
const HttpError = require("../utils/httpError")
const myOrders = require("../services/myOrders")
const lookup = require("../services/lookup")
const orderChange = require("../services/orderChange")
const redelivery = require("../services/redelivery")
const returns = require("../services/returns")
const warranty = require("../services/warranty")
const reviews = require("../services/reviews")

const isMember = (req) => !!(req.user && req.user.role === "member")

// ===== Đơn hàng =====

// API-42 GET /api/orders?tab=&range=&page=
async function listOrders(req, res) {
  res.send(await myOrders.list(req.user, req.query))
}

// API-43 GET /api/orders/:code - Member chủ đơn; phiên vừa đặt (recentOrders, SCR-09); phiên đã xác thực tra cứu cùng SĐT
// Đơn người gọi được xem (API-43, API-229): chủ đơn, phiên vừa đặt, phiên tra cứu
async function readableOrder(req) {
  const code = String(req.params["code"])
  if (isMember(req)) {
    await myOrders.autoComplete({ userId: req.user._id, code })
  }
  // Thay đổi chờ thanh toán quá hạn thì bỏ trước khi trả chi tiết
  const o = await orderChange.expireIfDue(await database.collection("orders").findOne({ code }))
  if (!o) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy đơn hàng")
  let mode = null
  if (isMember(req) && String(o.userId) === String(req.user._id)) mode = "owner"
  else if ((req.session.recentOrders || []).includes(o.code)) mode = "session"
  else if (lookup.lookupPhone(req) === o.customer.phone) mode = "lookup"
  if (!mode) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy đơn hàng")
  return { o, mode }
}

async function getOrder(req, res) {
  const { o, mode } = await readableOrder(req)
  res.send(await myOrders.detail(o, mode))
}

// API-229 GET /api/orders/:code/version - phiên bản đơn để SCR-19 tự tải lại (NFR-REL-06)
async function getOrderVersion(req, res) {
  const { o } = await readableOrder(req)
  res.send({ version: st.orderVersion(o) })
}

// API-44 PUT /api/orders/:code/cancel - {reason, detail?, refundAccount? | useSavedAccount, saveAccount?}
async function cancelOrder(req, res) {
  res.send(await myOrders.cancel(req.user, req.params["code"], req.body || {}))
}

// API-45 PUT /api/orders/:code/received
async function confirmReceived(req, res) {
  res.send(await myOrders.received(req.user, req.params["code"]))
}

// API-46 POST /api/orders/:code/reorder
async function reorder(req, res) {
  res.send(await myOrders.reorder(req, req.params["code"]))
}

// API-49 đã bỏ: khách không tự chọn sản phẩm thay thế nữa (UC-OPS-06 viết lại)
async function chooseSubstitution(req, res) {
  throw new HttpError(410, "GONE", "Chức năng chọn sản phẩm thay thế không còn dùng, vui lòng nhắn Soulprint")
}

// API-215 PUT /api/orders/:code/shipping - khách sửa thông tin giao hàng khi đơn chờ xác nhận (UC-TRK-06);
// đổi sang Giao người nhận mà phải trả thêm thì 202 {payment}
async function updateShipping(req, res) {
  const r = await orderChange.customerShipping(req, req.params["code"], req.body || {})
  if (r.status === 202) return res.status(202).send({ payment: r.payment })
  res.send(r)
}

// API-216 PUT /api/orders/:code/items/:itemId/personalization - {personalization}; phải trả thêm thì 202 {payment}
async function updatePersonalization(req, res) {
  const r = await orderChange.customerPersonalization(req, req.params["code"], req.params["itemId"], req.body || {})
  if (r.status === 202) return res.status(202).send({ payment: r.payment })
  res.send(r)
}

// API-219 POST /api/orders/:code/refunds/voucher - nhận voucher thay cho chờ chuyển khoản phần dư (BR-47 b)
async function refundToVoucher(req, res) {
  res.send(await orderChange.refundToVoucher(req, req.params["code"]))
}

// ===== Hậu mãi (S9) =====

// API-47 POST /api/orders/:code/redelivery - {recipientType, shippingAddress | addressId, deliveryWindow?}
async function requestRedelivery(req, res) {
  res.status(201).send(await redelivery.request(req, req.params["code"], req.body || {}))
}

// API-48 POST /api/orders/:code/refund-request - {refundAccount | useSavedAccount, saveAccount?}
async function requestRefund(req, res) {
  res.status(201).send(await redelivery.refundRequest(req.user, req.params["code"], req.body || {}))
}

// API-50 POST /api/orders/:code/returns
async function createReturn(req, res) {
  res.status(201).send(await returns.create(req.user, req.params["code"], req.body || {}))
}

// API-51 DELETE /api/returns/:id
async function cancelReturn(req, res) {
  await returns.cancel(req.user, req.params["id"])
  res.status(204).end()
}

// API-52 POST /api/orders/:code/warranty
async function createWarranty(req, res) {
  res.status(201).send(await warranty.create(req.user, req.params["code"], req.body || {}))
}

// API-53 POST /api/reviews
async function createReview(req, res) {
  res.status(201).send(await reviews.create(req.user, req.body || {}))
}

// API-54 PUT /api/reviews - _id trong body
async function updateReview(req, res) {
  res.send(await reviews.update(req.user, req.body || {}))
}

// API-195 DELETE /api/reviews/:id
async function deleteReview(req, res) {
  await reviews.remove(req.user, req.params["id"])
  res.status(204).end()
}

// ===== Tra cứu đơn (UC-TRK-01) =====

// API-55 POST /api/lookup/otp - {target}
async function lookupOtp(req, res) {
  res.send(await lookup.sendOtp(req.body || {}))
}

// API-56 POST /api/lookup/verify - {target, otp}
async function lookupVerify(req, res) {
  res.send(await lookup.verify(req, req.body || {}))
}

// API-57 GET /api/lookup/orders
async function lookupOrders(req, res) {
  res.send(await lookup.list(req))
}

// API-58 POST /api/lookup/activation-link
async function lookupActivation(req, res) {
  res.send(await lookup.resendActivation(req))
}

// ===== Thông báo (UC-TRK-02 1a) =====

// Nhóm tab SCR-23 (06 Mục 1.5)
const GROUPS = {
  "don-hang": ["DON_HANG", "HOAN_TIEN", "DOI_TRA", "BAO_HANH"],
  "uu-dai": ["UU_DAI"],
  "he-thong": ["TAI_KHOAN", "HO_TRO"],
}
const groupOf = (type) => Object.keys(GROUPS).find((g) => GROUPS[g].includes(type)) || "he-thong"
const notifications = () => database.collection("notifications")

// API-21 GET /api/notifications?group=&page=
async function listNotifications(req, res) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1)
  const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize, 10) || 20))
  const mine = { userId: req.user._id }
  const filter = GROUPS[req.query.group] ? { ...mine, type: { $in: GROUPS[req.query.group] } } : mine
  const [items, total, unread] = await Promise.all([
    notifications().find(filter).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).toArray(),
    notifications().countDocuments(filter),
    notifications().aggregate([{ $match: { ...mine, readAt: null } }, { $group: { _id: "$type", n: { $sum: 1 } } }]).toArray(),
  ])
  const counts = { "don-hang": 0, "uu-dai": 0, "he-thong": 0 }
  for (const u of unread) counts[groupOf(u._id)] += u.n
  res.send({
    items: items.map((n) => ({ _id: String(n._id), type: n.type, group: groupOf(n.type), title: n.title, body: n.body, link: n.link, readAt: n.readAt, createdAt: n.createdAt, highlight: n.highlight || null })),
    // Hộp nổi bật chưa xem (VD voucher xin lỗi): mới nhất, không phụ thuộc trang đang xem
    highlight: await notifications().findOne({ ...mine, highlight: { $ne: null, $exists: true }, highlightSeenAt: null }, { sort: { createdAt: -1 } }).then((n) => (n ? { _id: String(n._id), kind: n.highlight, title: n.title, body: n.body, link: n.link } : null)),
    unreadCount: counts["don-hang"] + counts["uu-dai"] + counts["he-thong"],
    counts,
    page,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  })
}

// API-22 PUT /api/notifications/:id/read
async function readNotification(req, res) {
  const id = String(req.params["id"])
  if (!ObjectId.isValid(id)) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy thông báo")
  await notifications().updateOne({ _id: new ObjectId(id), userId: req.user._id, readAt: null }, { $set: { readAt: new Date() } })
  await notifications().updateOne({ _id: new ObjectId(id), userId: req.user._id, highlight: { $exists: true }, highlightSeenAt: null }, { $set: { highlightSeenAt: new Date() } })
  res.status(204).end()
}

// API-192 PUT /api/notifications/read-all
async function readAllNotifications(req, res) {
  const r = await notifications().updateMany({ userId: req.user._id, readAt: null }, { $set: { readAt: new Date() } })
  res.send({ updated: r.modifiedCount })
}

module.exports = {
  listOrders, getOrder, getOrderVersion, cancelOrder, confirmReceived, reorder, chooseSubstitution, updateShipping, updatePersonalization, refundToVoucher,
  requestRedelivery, requestRefund, createReturn, cancelReturn, createWarranty, createReview, updateReview, deleteReview,
  lookupOtp, lookupVerify, lookupOrders, lookupActivation,
  listNotifications, readNotification, readAllNotifications,
}
