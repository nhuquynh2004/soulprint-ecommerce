// Gắn thẻ @nhân viên trong ghi chú nội bộ của đơn (UC-OPS-01, bản gọn): gợi ý tên (API-209),
// mỗi người được gắn có 1 dòng staffMentions; chuông khu quản trị đọc số chưa đọc (API-210), mở thì đánh dấu đã đọc (API-211).
const { database, ObjectId } = require("../config/db")
const HttpError = require("../utils/httpError")

const mentions = () => database.collection("staffMentions")
const users = () => database.collection("users")
const MAX_MENTIONS = 5
const toId = (id) => (ObjectId.isValid(String(id)) ? new ObjectId(String(id)) : null)
const initials = (name) =>
  String(name || "")
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((w) => w[0] || "")
    .join("")
    .toUpperCase()

// API-209: nhân viên đang hoạt động, trừ người gọi
async function mentionable(req) {
  const list = await users()
    .find({ role: "admin", status: "HOAT_DONG", _id: { $ne: req.user._id } }, { projection: { fullName: 1 } })
    .sort({ fullName: 1 })
    .toArray()
  return list.map((u) => ({ _id: String(u._id), fullName: u.fullName, initials: initials(u.fullName) }))
}

// Kiểm tra người được gắn thẻ của API-160: tối đa 5, phải là nhân viên đang hoạt động; tự gắn mình thì bỏ qua
async function readMentions(req, input) {
  const ids = [...new Set((Array.isArray(input) ? input : []).map(String))].filter((id) => id !== String(req.user._id))
  if (!ids.length) return []
  if (ids.length > MAX_MENTIONS) throw new HttpError(422, "VALIDATION_ERROR", `Gắn thẻ tối đa ${MAX_MENTIONS} nhân viên`, { fields: { mentions: "Tối đa 5 người" } })
  const oids = ids.map(toId)
  if (oids.some((x) => !x)) throw new HttpError(422, "VALIDATION_ERROR", "Nhân viên được gắn thẻ không hợp lệ", { fields: { mentions: "Không hợp lệ" } })
  const found = await users().find({ _id: { $in: oids }, role: "admin", status: "HOAT_DONG" }, { projection: { fullName: 1 } }).toArray()
  if (found.length !== oids.length) throw new HttpError(422, "VALIDATION_ERROR", "Nhân viên được gắn thẻ không còn hoạt động", { fields: { mentions: "Không hợp lệ" } })
  return found
}

async function record(req, { order, noteId, text, staff, now }) {
  if (!staff.length) return
  const excerpt = text.length > 120 ? text.slice(0, 117) + "..." : text
  await mentions().insertMany(
    staff.map((u) => ({ adminId: u._id, byAdminId: req.user._id, byName: req.user.fullName, orderCode: order.code, noteId, excerpt, readAt: null, createdAt: now })),
  )
}

// API-210: 20 lần gần nhất mình được gắn thẻ
async function mine(req) {
  const [items, unread] = await Promise.all([
    mentions().find({ adminId: req.user._id }).sort({ createdAt: -1 }).limit(20).toArray(),
    mentions().countDocuments({ adminId: req.user._id, readAt: null }),
  ])
  return {
    unread,
    items: items.map((m) => ({ _id: String(m._id), orderCode: m.orderCode, byName: m.byName, excerpt: m.excerpt, createdAt: m.createdAt, readAt: m.readAt })),
  }
}

// API-211: chỉ dòng của chính mình; ids trống là tất cả
async function markRead(req, body = {}) {
  const filter = { adminId: req.user._id, readAt: null }
  if (Array.isArray(body.ids) && body.ids.length) filter._id = { $in: body.ids.map(toId).filter(Boolean) }
  await mentions().updateMany(filter, { $set: { readAt: new Date() } })
  return { unread: await mentions().countDocuments({ adminId: req.user._id, readAt: null }) }
}

module.exports = { mentionable, readMentions, record, mine, markRead, MAX_MENTIONS }
