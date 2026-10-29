// Khách hàng và đánh giá phía quản trị (UC-OPS-08; 07_API_Spec.md API-98, API-138 đến API-142). Nhân viên xem hồ sơ,
// khóa/mở khóa, mở khóa đăng nhập hoặc tra cứu OTP, gửi lại liên kết kích hoạt; ẩn/hiện đánh giá vi phạm. Không sửa
// thông tin cá nhân hay sổ địa chỉ của khách (đảm bảo tối thiểu). Số đơn, tổng chi tiêu tính bằng aggregation (Chương VII).
const { database, ObjectId } = require("../config/db")
const HttpError = require("../utils/httpError")
const { accentInsensitivePattern } = require("../utils/vnText")
const { destroyUserSessions } = require("../middlewares/auth")
const { writeLog } = require("./adminLog")
const { notifier } = require("./notifier")
const order = require("./order")
const st = require("./orderState")

const users = () => database.collection("users")
const orders = () => database.collection("orders")
const reviews = () => database.collection("reviews")
const STATUSES = ["HOAT_DONG", "CHO_KICH_HOAT", "BI_KHOA"]
const text = (x, max) => (typeof x === "string" ? x.normalize("NFC").trim().slice(0, max) : "")
const toId = (x) => (x && ObjectId.isValid(String(x)) ? new ObjectId(String(x)) : null)
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

// ===== API-98 danh sách =====

const SORTS = {
  "moi-nhat": { createdAt: -1 },
  "chi-tieu": { totalSpent: -1, createdAt: -1 },
  "so-don": { orderCount: -1, createdAt: -1 },
  "don-gan-nhat": { lastOrderAt: -1, createdAt: -1 },
  ten: { fullName: 1 },
}

async function list(query) {
  const match = { role: "member" }
  if (STATUSES.includes(query.status)) match.status = query.status
  const q = String(query.q || "").trim()
  if (q) {
    const digits = q.replace(/[\s.]/g, "")
    match.$or = [
      { fullName: { $regex: accentInsensitivePattern(q), $options: "i" } },
      { email: { $regex: escapeRe(q), $options: "i" } },
      ...(/^\d{3,10}$/.test(digits) ? [{ phone: { $regex: digits } }] : []),
    ]
  }
  const pageSize = Math.min(50, Math.max(1, parseInt(query.pageSize, 10) || 20))
  const page = Math.max(1, parseInt(query.page, 10) || 1)
  const after = []
  if (query.hasOrders === "true") after.push({ $match: { orderCount: { $gt: 0 } } })
  if (query.hasOrders === "false") after.push({ $match: { orderCount: 0 } })

  const [r] = await users()
    .aggregate([
      { $match: match },
      {
        $lookup: {
          from: "orders",
          let: { uid: "$_id" },
          pipeline: [
            { $match: { $expr: { $eq: ["$userId", "$$uid"] } } },
            { $sort: { createdAt: -1 } },
            {
              $group: {
                _id: null,
                orderCount: { $sum: 1 },
                totalSpent: { $sum: { $cond: [{ $eq: ["$orderStatus", "DA_HUY"] }, 0, "$total"] } },
                lastOrderCode: { $first: "$code" },
                lastOrderAt: { $first: "$createdAt" },
              },
            },
          ],
          as: "stats",
        },
      },
      {
        $set: {
          orderCount: { $ifNull: [{ $first: "$stats.orderCount" }, 0] },
          totalSpent: { $ifNull: [{ $first: "$stats.totalSpent" }, 0] },
          lastOrderCode: { $first: "$stats.lastOrderCode" },
          lastOrderAt: { $first: "$stats.lastOrderAt" },
        },
      },
      ...after,
      { $sort: SORTS[query.sort] || SORTS["moi-nhat"] },
      {
        $facet: {
          items: [
            { $skip: (page - 1) * pageSize },
            { $limit: pageSize },
            { $project: { fullName: 1, phone: 1, email: 1, status: 1, createdAt: 1, orderCount: 1, totalSpent: 1, lastOrderCode: 1, lastOrderAt: 1, lockedUntil: 1 } },
          ],
          total: [{ $count: "n" }],
        },
      },
    ])
    .toArray()
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const [all, fresh] = await Promise.all([users().countDocuments({ role: "member" }), users().countDocuments({ role: "member", createdAt: { $gte: monthAgo } })])
  const lookupLocked = await lookupLocks(r.items.map((u) => u.phone).filter(Boolean))
  return {
    items: r.items.map((u) => ({ ...u, _id: String(u._id), loginLocked: !!u.lockedUntil && new Date(u.lockedUntil) > new Date(), lookupLocked: lookupLocked.has(u.phone) })),
    page, pageSize, total: r.total[0]?.n || 0, allCount: all, newThisMonth: fresh,
  }
}

// SĐT đang bị khóa tra cứu OTP (BR-24)
async function lookupLocks(phones) {
  if (!phones.length) return new Set()
  const list = await database.collection("otps").find({ target: { $in: phones }, purpose: "TRA_CUU_DON", lockedUntil: { $gt: new Date() } }, { projection: { target: 1 } }).toArray()
  return new Set(list.map((x) => x.target))
}

// ===== API-138 hồ sơ =====

async function loadMember(id) {
  const u = await users().findOne({ _id: toId(id), role: "member" })
  if (!u) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy khách hàng")
  return u
}

async function detail(id) {
  const u = await loadMember(id)
  const [orderList, stats, reviewList, grants, conversations, lookupLocked] = await Promise.all([
    orders().find({ userId: u._id }, { projection: { code: 1, createdAt: 1, orderStatus: 1, total: 1, returnStatus: 1 } }).sort({ createdAt: -1 }).limit(30).toArray(),
    orders().aggregate([{ $match: { userId: u._id } }, { $group: { _id: null, n: { $sum: 1 }, spent: { $sum: { $cond: [{ $eq: ["$orderStatus", "DA_HUY"] }, 0, "$total"] } }, first: { $min: "$createdAt" } } }]).toArray(),
    reviews().aggregate([
      { $match: { userId: u._id } },
      { $sort: { createdAt: -1 } },
      { $limit: 10 },
      { $lookup: { from: "products", localField: "productId", foreignField: "_id", as: "p" } },
      { $lookup: { from: "orders", localField: "orderId", foreignField: "_id", as: "o" } },
      { $project: { rating: 1, comment: 1, images: 1, isHidden: 1, createdAt: 1, productName: { $first: "$p.name" }, orderCode: { $first: "$o.code" } } },
    ]).toArray(),
    database.collection("userVouchers").find({ userId: u._id }).sort({ assignedAt: -1 }).limit(20).toArray(),
    database.collection("conversations").find({ userId: u._id }).sort({ lastMessageAt: -1 }).limit(3).toArray(),
    lookupLocks(u.phone ? [u.phone] : []),
  ])
  const requests = [
    ...(await database.collection("returnRequests").find({ userId: u._id }).sort({ createdAt: -1 }).limit(10).toArray()).map((x) => ({ _id: String(x._id), kind: "DOI_TRA", orderCode: x.orderCode, status: x.status, createdAt: x.createdAt })),
    ...(await database.collection("warrantyRequests").find({ userId: u._id }).sort({ createdAt: -1 }).limit(10).toArray()).map((x) => ({ _id: String(x._id), kind: "BAO_HANH", orderCode: x.orderCode, status: x.status, createdAt: x.createdAt })),
  ]
  const now = new Date()
  return {
    _id: String(u._id), fullName: u.fullName, phone: u.phone || null, email: u.email || null, status: u.status, gender: u.gender || null, birthday: u.birthday || null,
    createdAt: u.createdAt, ...st.membership(u, stats[0]?.first), lastLoginAt: u.lastLoginAt || null, statusReason: u.statusReason || null,
    loginLocked: !!u.lockedUntil && new Date(u.lockedUntil) > now, lockedUntil: u.lockedUntil || null, failedLogins: u.failedLogins || 0,
    lookupLocked: !!u.phone && lookupLocked.has(u.phone),
    addresses: (u.addresses || []).map((a) => ({ ...a, _id: String(a._id) })),
    orderCount: stats[0]?.n || 0, totalSpent: stats[0]?.spent || 0,
    orders: orderList.map((o) => ({ code: o.code, createdAt: o.createdAt, orderStatus: o.orderStatus, orderStatusLabel: st.ORDER_LABEL[o.orderStatus], total: o.total })),
    requests,
    reviews: reviewList.map((r) => ({ ...r, _id: String(r._id), imageCount: (r.images || []).length })),
    vouchers: grants.map((g) => ({ code: g.code, source: g.source, assignedAt: g.assignedAt, expiresAt: g.expiresAt, usedCount: g.usedCount || 0 })),
    conversations: conversations.map((c) => ({ _id: String(c._id), summary: c.summary || null, status: c.status, lastMessageAt: c.lastMessageAt })),
  }
}

// ===== API-139 khóa, mở khóa =====

async function update(req, id, body) {
  const u = await loadMember(id)
  const can = (code) => !!req.isFullAccess || req.permissions.has(code)
  const now = new Date()
  if (body.status !== undefined) {
    if (!can("KHACH_HANG.KHOA_TAI_KHOAN")) throw new HttpError(403, "FORBIDDEN", "Bạn không có quyền khóa tài khoản khách")
    if (body.status === "BI_KHOA") {
      const reason = text(body.reason, 300)
      // 4Ea: khóa mà không nhập lý do
      if (reason.length < 5) throw new HttpError(422, "VALIDATION_ERROR", "Nhập lý do khóa tài khoản (ít nhất 5 ký tự)", { fields: { reason: "Nhập lý do" } })
      if (u.status === "BI_KHOA") throw new HttpError(409, "ALREADY_LOCKED", "Tài khoản đã bị khóa")
      await users().updateOne({ _id: u._id }, { $set: { status: "BI_KHOA", statusBefore: u.status, statusReason: reason, lockedAt: now, lockedBy: req.user._id, updatedAt: now } })
      // AC1: hủy mọi phiên, request tiếp theo của khách nhận 401
      const ended = await destroyUserSessions(u._id)
      await writeLog({ adminId: req.user._id, action: "CUSTOMER_UPDATE", targetType: "users", targetId: u._id, reason, before: { status: u.status }, after: { status: "BI_KHOA", sessionsEnded: ended } })
    } else if (body.status === "HOAT_DONG") {
      if (u.status !== "BI_KHOA") throw new HttpError(409, "NOT_LOCKED", "Tài khoản không bị khóa")
      // Mở khóa trả về trạng thái trước khi khóa (tài khoản chưa kích hoạt vẫn chờ kích hoạt)
      const back = u.statusBefore === "CHO_KICH_HOAT" ? "CHO_KICH_HOAT" : "HOAT_DONG"
      await users().updateOne({ _id: u._id }, { $set: { status: back, updatedAt: now }, $unset: { statusReason: "", statusBefore: "", lockedAt: "", lockedBy: "" } })
      await writeLog({ adminId: req.user._id, action: "CUSTOMER_UPDATE", targetType: "users", targetId: u._id, reason: text(body.reason, 300) || null, before: { status: "BI_KHOA" }, after: { status: back } })
    } else throw new HttpError(422, "VALIDATION_ERROR", "Trạng thái không hợp lệ")
  } else if (body.unlockLogin === true) {
    if (!can("KHACH_HANG.SUA")) throw new HttpError(403, "FORBIDDEN", "Bạn không có quyền thực hiện thao tác này")
    // 4b, AC2: xóa bộ đếm sai và thời gian khóa
    await users().updateOne({ _id: u._id }, { $set: { failedLogins: 0, lockedUntil: null, updatedAt: now } })
    await writeLog({ adminId: req.user._id, action: "CUSTOMER_UPDATE", targetType: "users", targetId: u._id, before: { lockedUntil: u.lockedUntil || null }, after: { unlockLogin: true } })
  } else if (body.unlockLookup === true) {
    if (!can("KHACH_HANG.SUA")) throw new HttpError(403, "FORBIDDEN", "Bạn không có quyền thực hiện thao tác này")
    // 4c: xóa khóa OTP tra cứu của SĐT khách (BR-24)
    if (u.phone) await database.collection("otps").updateMany({ target: u.phone, purpose: "TRA_CUU_DON" }, { $set: { lockedUntil: null, attempts: 0 } })
    await writeLog({ adminId: req.user._id, action: "CUSTOMER_UPDATE", targetType: "users", targetId: u._id, after: { unlockLookup: true } })
  } else throw new HttpError(422, "VALIDATION_ERROR", "Chọn thao tác")
  return detail(u._id)
}

// ===== API-140 gửi lại liên kết kích hoạt (BR-25) =====

async function resendActivation(req, id) {
  const u = await loadMember(id)
  if (u.status !== "CHO_KICH_HOAT") throw new HttpError(409, "ALREADY_ACTIVE", "Tài khoản đã kích hoạt")
  const devLink = await order.sendActivation(u)
  await writeLog({ adminId: req.user._id, action: "CUSTOMER_UPDATE", targetType: "users", targetId: u._id, after: { activationLink: true } })
  return { sent: true, devLink }
}

// ===== API-141, API-142 đánh giá =====

async function listReviews(query) {
  const match = {}
  const rating = parseInt(query.rating, 10)
  if (rating >= 1 && rating <= 5) match.rating = rating
  if (query.hidden === "true") match.isHidden = true
  if (query.hidden === "false") match.isHidden = { $ne: true }
  if (toId(query.productId)) match.productId = toId(query.productId)
  if (query.replied === "true") match["reply.text"] = { $exists: true }
  if (query.replied === "false") match["reply.text"] = { $exists: false }
  const pageSize = 20
  const page = Math.max(1, parseInt(query.page, 10) || 1)
  const q = String(query.q || "").trim()
  const search = q
    ? [{ $match: { $or: [{ comment: { $regex: accentInsensitivePattern(q), $options: "i" } }, { userName: { $regex: accentInsensitivePattern(q), $options: "i" } }, { productName: { $regex: accentInsensitivePattern(q), $options: "i" } }] } }]
    : []
  const [r] = await reviews()
    .aggregate([
      { $match: match },
      { $lookup: { from: "products", localField: "productId", foreignField: "_id", as: "p" } },
      { $lookup: { from: "orders", localField: "orderId", foreignField: "_id", as: "o" } },
      { $set: { productName: { $first: "$p.name" }, productSlug: { $first: "$p.slug" }, orderCode: { $first: "$o.code" } } },
      ...search,
      { $sort: { createdAt: -1 } },
      {
        $facet: {
          items: [{ $skip: (page - 1) * pageSize }, { $limit: pageSize }, { $project: { p: 0, o: 0 } }],
          total: [{ $count: "n" }],
        },
      },
    ])
    .toArray()
  const [shown, hidden] = await Promise.all([reviews().countDocuments({ isHidden: { $ne: true } }), reviews().countDocuments({ isHidden: true })])
  return {
    items: r.items.map((x) => ({
      _id: String(x._id), rating: x.rating, comment: x.comment || "", images: x.images || [], userName: x.userName || "Khách hàng", userId: x.userId ? String(x.userId) : null,
      productId: String(x.productId), productName: x.productName || "", productSlug: x.productSlug || null, orderCode: x.orderCode || null,
      isHidden: !!x.isHidden, hiddenReason: x.hiddenReason || null, createdAt: x.createdAt,
      reply: x.reply ? { text: x.reply.text, byName: x.reply.byName || null, at: x.reply.at, updatedAt: x.reply.updatedAt || x.reply.at } : null,
    })),
    page, pageSize, total: r.total[0]?.n || 0, counts: { all: shown + hidden, shown, hidden },
  }
}

// Điểm trung bình và số đánh giá của sản phẩm chỉ tính đánh giá đang hiện (AC3)
async function refreshRating(productId) {
  const [g] = await reviews().aggregate([{ $match: { productId, isHidden: { $ne: true } } }, { $group: { _id: null, n: { $sum: 1 }, sum: { $sum: "$rating" } } }]).toArray()
  const ratingCount = g?.n || 0
  const ratingAvg = ratingCount ? Math.round((g.sum / ratingCount) * 10) / 10 : 0
  await database.collection("products").updateOne({ _id: productId }, { $set: { ratingAvg, ratingCount } })
  return { ratingAvg, ratingCount }
}

async function setVisibility(req, body) {
  const ids = (Array.isArray(body.reviewIds) ? body.reviewIds : []).map(toId).filter(Boolean)
  if (!ids.length || ids.length > 100) throw new HttpError(422, "VALIDATION_ERROR", "Chọn từ 1 đến 100 đánh giá")
  const isHidden = body.isHidden === true
  const reason = text(body.reason, 200)
  // 1aEa: ẩn mà không nhập lý do
  if (isHidden && reason.length < 3) throw new HttpError(422, "VALIDATION_ERROR", "Nhập lý do ẩn đánh giá", { fields: { reason: "Nhập lý do" } })
  const now = new Date()
  const list = await reviews().find({ _id: { $in: ids } }, { projection: { productId: 1, isHidden: 1 } }).toArray()
  const set = isHidden ? { isHidden: true, hiddenReason: reason, hiddenBy: req.user._id, hiddenAt: now } : { isHidden: false, hiddenReason: null, hiddenBy: null, hiddenAt: null }
  const r = await reviews().updateMany({ _id: { $in: list.map((x) => x._id) } }, { $set: { ...set, updatedAt: now } })
  for (const pid of [...new Set(list.map((x) => String(x.productId)))]) await refreshRating(new ObjectId(pid))
  await writeLog({ adminId: req.user._id, action: "REVIEW_HIDE", targetType: "reviews", reason: reason || null, after: { isHidden, targetIds: list.map((x) => String(x._id)) } })
  return { updated: r.modifiedCount }
}

// API-233: trả lời đánh giá thay mặt Soulprint (UC-OPS-08 1b). Mỗi đánh giá 1 câu, sửa thì ghi đè, text rỗng là xóa.
// Lần trả lời đầu báo Member chủ đánh giá.
async function replyReview(req, body) {
  const id = toId(body._id)
  const r = id ? await reviews().findOne({ _id: id }) : null
  if (!r) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy đánh giá")
  const value = typeof body.text === "string" ? body.text.normalize("NFC").trim() : ""
  if (Array.from(value).length > 500) throw new HttpError(400, "VALIDATION_ERROR", "Câu trả lời tối đa 500 ký tự", { fields: { text: "Tối đa 500 ký tự" } })
  const now = new Date()
  if (!value) {
    await reviews().updateOne({ _id: r._id }, { $unset: { reply: "" }, $set: { updatedAt: now } })
  } else {
    const reply = { text: value, by: req.user._id, byName: req.user.fullName || null, at: r.reply?.at || now, updatedAt: now }
    await reviews().updateOne({ _id: r._id }, { $set: { reply, updatedAt: now } })
  }
  await writeLog({ adminId: req.user._id, action: "REVIEW_REPLY", targetType: "reviews", targetId: r._id, before: { reply: r.reply?.text || null }, after: { reply: value || null } })
  if (value && !r.reply && r.userId) {
    const [owner, p] = await Promise.all([
      database.collection("users").findOne({ _id: r.userId }, { projection: { phone: 1 } }),
      database.collection("products").findOne({ _id: r.productId }, { projection: { name: 1, slug: 1 } }),
    ])
    if (owner) {
      await notifier.notify(owner, { type: "DON_HANG", title: `Soulprint đã trả lời đánh giá của bạn về ${p?.name || "sản phẩm"}`, body: value.slice(0, 160), link: p?.slug ? `/san-pham/${p.slug}` : null })
        .catch((err) => console.error("Gửi thông báo trả lời đánh giá lỗi:", err.message))
    }
  }
  const fresh = await reviews().findOne({ _id: r._id })
  return { review: { _id: String(fresh._id), reply: fresh.reply ? { text: fresh.reply.text, byName: fresh.reply.byName || null, at: fresh.reply.at, updatedAt: fresh.reply.updatedAt } : null } }
}

module.exports = { list, detail, update, resendActivation, listReviews, setVisibility, refreshRating, replyReview }
