// Hỗ trợ khách hàng phía nhân viên (07_API_Spec.md API-104 đến API-107, API-176, API-177) - UC-CSK-04.
// Hàng đợi xếp chỉ báo đỏ lên đầu; mở hội thoại đang chờ thì nhận luôn (khi đang trực và có HO_TRO.TRA_LOI);
// chỉ người đã nhận được trả lời, đóng; tắt "Đang trực" khi còn hội thoại thì phải chọn cách bàn giao (1a).
const { database, ObjectId } = require("../config/db")
const params = require("../config/params")
const HttpError = require("../utils/httpError")
const rules = require("./chatRules")
const { addMessage } = require("./chat")
const { getEffectivePermissions } = require("./permissions")
const { notifier } = require("./notifier")
const st = require("./orderState")

const conversations = () => database.collection("conversations")
const messages = () => database.collection("messages")
const users = () => database.collection("users")
const toId = (x) => (x && ObjectId.isValid(String(x)) ? new ObjectId(String(x)) : null)
const MINUTE = 60 * 1000
// Khách không hỏi tin mới quá 30 giây coi như đã rời cửa sổ chat: Member nhận thông báo khi có trả lời (UC-CSK-04 5Ea)
const AWAY_MS = 30 * 1000

const canReply = (req) => req.isFullAccess || req.permissions.has("HO_TRO.TRA_LOI")
const isMine = (req, conv) => conv.assignedAdminId && String(conv.assignedAdminId) === String(req.user._id)
const guestName = (c) => c.customerName || "Khách vãng lai"

async function load(id) {
  const conv = toId(id) && (await conversations().findOne({ _id: toId(id) }))
  if (!conv) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy hội thoại")
  return conv
}

// Nhân viên đang trực nhận được hội thoại mới: bật trực, không ở chế độ "Xử lý nốt rồi nghỉ", có quyền trả lời
async function staffOnDuty(exceptId = null) {
  const list = await users().find({ role: "admin", status: "HOAT_DONG", onDuty: true, dutyFinishing: { $ne: true } }).toArray()
  const roles = await database.collection("roles").find({ code: { $in: [...new Set(list.flatMap((u) => u.staffRoles || []))] } }).toArray()
  return list.filter((u) => {
    if (exceptId && String(u._id) === String(exceptId)) return false
    const eff = getEffectivePermissions(u, roles.filter((r) => (u.staffRoles || []).includes(r.code)))
    return eff.isFullAccess || eff.permissions.includes("HO_TRO.TRA_LOI")
  })
}

// ===== API-104 hàng đợi =====

// Nhãn đã lưu; hội thoại cũ chưa có nhãn thì suy từ chủ đề
const labelsOf = (c) => rules.sortLabels(c.labels && c.labels.length ? c.labels : rules.autoLabels({ texts: c.topic ? [c.topic] : [], sentiment: c.sentiment, urgentOpen: !!c.urgentOpen }))
const labelView = (c) => labelsOf(c).map((code) => ({ code, label: rules.LABELS[code] }))

function itemView(c, now, last, me) {
  const since = c.status === "CHO_NHAN_VIEN" ? c.escalatedAt : c.lastMessageAt
  const reminder = rules.replyReminder({ lastCustomerAt: last?.lastCustomerAt, lastStaffAt: last?.lastStaffAt, staffSeenAt: c.staffSeenAt, now })
  const mine = !!me && !!c.assignedAdminId && String(c.assignedAdminId) === String(me._id)
  return {
    _id: String(c._id), status: c.status, customerName: guestName(c), isMember: !!c.userId, topic: c.topic || rules.topicOf([]),
    sentiment: c.sentiment || "TRUNG_TINH", sentimentLabel: rules.SENTIMENT_LABEL[c.sentiment || "TRUNG_TINH"],
    escalatedAt: c.escalatedAt, lastMessageAt: c.lastMessageAt, waitMinutes: since ? Math.max(0, Math.floor((now - new Date(since)) / MINUTE)) : 0,
    leftMessage: !!c.leftMessage, lastText: last ? last.text : null, lastSender: last ? last.sender : null,
    labels: labelView(c), urgentOpen: !!c.urgentOpen, isMine: mine, assignedName: c.assignedName || null,
    // Chưa đọc: khách nhắn sau lần nhân viên mở cuối; nhắc: đã xem mà quá CHAT_REPLY_REMIND_MINUTES phút chưa trả lời
    unread: c.status !== "DA_DONG" && reminder.unread, remindMinutes: c.status === "DANG_HO_TRO" && mine ? reminder.remindMinutes : 0,
  }
}

async function withLast(list, now, me) {
  const lasts = await messages()
    .aggregate([
      { $match: { conversationId: { $in: list.map((c) => c._id) } } },
      { $sort: { _id: -1 } },
      {
        $group: {
          _id: "$conversationId", text: { $first: "$text" }, sender: { $first: "$sender" },
          lastCustomerAt: { $max: { $cond: [{ $eq: ["$sender", "KHACH"] }, "$createdAt", null] } },
          lastStaffAt: { $max: { $cond: [{ $eq: ["$sender", "ADMIN"] }, "$createdAt", null] } },
        },
      },
    ])
    .toArray()
  const map = new Map(lasts.map((l) => [String(l._id), l]))
  const ids = list.map((c) => c.assignedAdminId).filter(Boolean)
  const names = new Map((ids.length ? await users().find({ _id: { $in: ids } }, { projection: { fullName: 1 } }).toArray() : []).map((u) => [String(u._id), u.fullName]))
  return list.map((c) => itemView({ ...c, assignedName: c.assignedAdminId ? names.get(String(c.assignedAdminId)) || null : null }, now, map.get(String(c._id)), me))
}

async function list(req, query = {}) {
  const now = new Date()
  const me = await users().findOne({ _id: req.user._id })
  const onDutyStaff = await staffOnDuty()
  const base = {
    onDuty: !!me.onDuty, finishing: !!me.dutyFinishing, canReply: canReply(req),
    onDutyStaff: onDutyStaff.filter((u) => String(u._id) !== String(me._id)).map((u) => u.fullName),
    waitingCount: await conversations().countDocuments({ status: "CHO_NHAN_VIEN" }),
  }
  if (query.status === "DA_DONG") {
    const closed = await conversations().find({ status: "DA_DONG" }).sort({ closedAt: -1 }).limit(50).toArray()
    return { ...base, closed: await withLast(closed, now, me) }
  }
  // Quản trị (toàn quyền) thấy thêm hội thoại người khác đang hỗ trợ để theo dõi (nhóm "Tất cả")
  const [queue, mine, others] = await Promise.all([
    conversations().find({ status: "CHO_NHAN_VIEN" }).toArray(),
    conversations().find({ status: "DANG_HO_TRO", assignedAdminId: me._id }).sort({ lastMessageAt: -1 }).toArray(),
    req.isFullAccess ? conversations().find({ status: "DANG_HO_TRO", assignedAdminId: { $ne: me._id } }).sort({ lastMessageAt: -1 }).limit(50).toArray() : [],
  ])
  const mineView = await withLast(mine, now, me)
  // "Của tôi": cần nhắc trả lời lên đầu, rồi đơn gấp, rồi tin mới nhất
  mineView.sort((a, b) => (b.remindMinutes > 0) - (a.remindMinutes > 0) || b.urgentOpen - a.urgentOpen || new Date(b.lastMessageAt) - new Date(a.lastMessageAt))
  return {
    ...base, queue: await withLast(rules.sortQueue(queue), now, me), mine: mineView, others: await withLast(others, now, me),
    remindCount: mineView.filter((c) => c.remindMinutes > 0).length,
    urgentCount: queue.filter((c) => c.urgentOpen).length + mine.filter((c) => c.urgentOpen).length,
    labels: Object.entries(rules.LABELS).map(([code, label]) => ({ code, label })),
  }
}

// ===== API-105 chi tiết, nhận hội thoại =====

const adminMessageView = (m) => ({
  _id: String(m._id), sender: m.sender, text: m.text, senderName: m.senderName || null, link: m.link || null, card: m.card || null,
  originalText: m.originalText || null, softened: !!m.softened, createdAt: m.createdAt,
})

// Một khách là một hội thoại xuyên suốt: các phiên trước của cùng khách (Member theo tài khoản, Guest theo liên hệ
// để lại) hiện phía trên, có vạch mốc giữa các phiên. Tối đa 5 phiên, mỗi phiên 50 tin gần nhất.
async function earlierSessions(conv) {
  const who = conv.userId ? { userId: conv.userId } : conv.contact ? { contact: conv.contact } : null
  if (!who) return []
  const list = await conversations().find({ ...who, _id: { $ne: conv._id }, createdAt: { $lt: conv.createdAt } }).sort({ createdAt: -1 }).limit(5).toArray()
  const out = []
  for (const c of list.reverse()) {
    const msgs = (await messages().find({ conversationId: c._id }).sort({ _id: -1 }).limit(50).toArray()).reverse()
    out.push({ _id: String(c._id), createdAt: c.createdAt, closedAt: c.closedAt || null, topic: c.topic || null, messages: msgs.map(adminMessageView) })
  }
  return out
}

// Yêu cầu đặt gấp của hội thoại (khung phải): trạng thái, ngày mong muốn, mở trang đơn nháp để sửa và chốt
async function urgentOf(conv) {
  if (!(conv.urgentCodes || []).length) return []
  const list = await database.collection("draftOrders").find({ code: { $in: conv.urgentCodes }, kind: "DAT_GAP" }).sort({ createdAt: -1 }).toArray()
  const label = require("./urgentOrders").STATUS_LABEL
  return list.map((d) => {
    const status = d.status === "HOAN_TAT" ? "DA_DAT" : d.urgent.status
    return {
      code: d.code, status, statusLabel: label[status], requestedDate: d.urgent.requestedDate, deliveryDate: d.deliveryDate,
      total: d.totalEstimate ?? null, urgentFee: d.urgentFee || 0, orderCode: d.orderCode || null, createdAt: d.createdAt,
    }
  })
}

async function customerPanel(conv) {
  if (!conv.userId) return null
  const u = await users().findOne({ _id: conv.userId }, { projection: { fullName: 1, phone: 1, email: 1, status: 1, createdAt: 1, activatedAt: 1 } })
  if (!u) return null
  const orders = database.collection("orders")
  const [stats, recent, previous] = await Promise.all([
    orders.aggregate([{ $match: { userId: u._id } }, { $group: { _id: null, n: { $sum: 1 }, spent: { $sum: { $cond: [{ $eq: ["$orderStatus", "DA_HUY"] }, 0, "$total"] } }, first: { $min: "$createdAt" } } }]).toArray(),
    orders.find({ userId: u._id }, { projection: { code: 1, orderStatus: 1, paymentStatus: 1, total: 1, items: 1, createdAt: 1 } }).sort({ createdAt: -1 }).limit(3).toArray(),
    conversations().find({ userId: u._id, _id: { $ne: conv._id } }).sort({ lastMessageAt: -1 }).limit(10).toArray(),
  ])
  return {
    _id: String(u._id), fullName: u.fullName, phone: u.phone || null, email: u.email || null, ...st.membership(u, stats[0]?.first),
    orderCount: stats[0]?.n || 0, totalSpent: stats[0]?.spent || 0,
    recentOrders: recent.map((o) => ({
      code: o.code, orderStatus: o.orderStatus, orderStatusLabel: st.statusLabel("orderStatus", o.orderStatus),
      paymentStatusLabel: st.statusLabel("paymentStatus", o.paymentStatus), total: o.total, createdAt: o.createdAt,
      firstItem: o.items?.[0]?.name || "", moreItems: Math.max(0, (o.items || []).length - 1),
    })),
    // UC-CSK-04 4a: các hội thoại trước với khách này
    previousConversations: previous.map((c) => ({ _id: String(c._id), status: c.status, topic: c.topic || null, summary: c.summary || null, lastMessageAt: c.lastMessageAt })),
  }
}

async function detail(req, id, after) {
  let conv = await load(id)
  const me = await users().findOne({ _id: req.user._id })
  // Mở hội thoại đang chờ: nhận luôn nếu đang trực (không ở chế độ xử lý nốt) và có quyền trả lời (bước 4)
  if (conv.status === "CHO_NHAN_VIEN" && canReply(req) && me.onDuty && !me.dutyFinishing) {
    const r = await conversations().updateOne(
      { _id: conv._id, status: "CHO_NHAN_VIEN" },
      { $set: { status: "DANG_HO_TRO", assignedAdminId: me._id, assignedAt: new Date() } }
    )
    if (r.modifiedCount) await addMessage(conv, "HE_THONG", `${me.fullName} đã tham gia cuộc trò chuyện`)
    conv = await load(id)
  }
  // Người đang hỗ trợ mở hội thoại: ghi lần xem để biết tin nào chưa đọc, tin nào đã xem mà chưa trả lời
  if (isMine(req, conv)) await conversations().updateOne({ _id: conv._id }, { $set: { staffSeenAt: new Date() } })

  const filter = { conversationId: conv._id }
  if (toId(after)) filter._id = { $gt: toId(after) }
  const list = (await messages().find(filter).sort({ _id: 1 }).toArray()).map(adminMessageView)
  let assignedName = null
  if (conv.assignedAdminId) assignedName = (await users().findOne({ _id: conv.assignedAdminId }, { projection: { fullName: 1 } }))?.fullName || null
  const mine = isMine(req, conv)
  const state = {
    _id: String(conv._id), status: conv.status, statusLabel: rules.STATUS_LABEL[conv.status], assignedName, isMine: mine,
    canReply: canReply(req) && conv.status === "DANG_HO_TRO" && mine,
    canClose: canReply(req) && (conv.status === "CHO_NHAN_VIEN" || (conv.status === "DANG_HO_TRO" && (mine || req.isFullAccess))),
    // Lý do chưa trả lời được, hiện trên ô soạn tin
    blockedReason: conv.status === "DA_DONG" ? "Hội thoại đã đóng" : conv.status === "BOT" ? "Khách đang trò chuyện với Sâu Béo (đã rời nhân viên)" : !canReply(req) ? "Bạn chỉ có quyền xem hội thoại" : conv.status === "CHO_NHAN_VIEN" ? "Bật Đang trực để nhận hội thoại này" : !mine ? `${assignedName || "Nhân viên khác"} đang hỗ trợ khách này` : null,
    sentiment: conv.sentiment || "TRUNG_TINH", sentimentLabel: rules.SENTIMENT_LABEL[conv.sentiment || "TRUNG_TINH"],
    labels: labelView(conv), labelsManual: !!conv.labelsManual, urgentOpen: !!conv.urgentOpen,
    messages: list,
  }
  if (toId(after)) return state
  return {
    ...state,
    customerName: guestName(conv), isMember: !!conv.userId, topic: conv.topic || null, contact: conv.contact || null, leftMessage: !!conv.leftMessage,
    summary: conv.summary || null, escalatedAt: conv.escalatedAt, createdAt: conv.createdAt,
    notes: [...(conv.internalNotes || [])].sort((a, b) => new Date(b.at) - new Date(a.at)).map((n) => ({ ...n, _id: String(n._id), by: String(n.by) })),
    customer: await customerPanel(conv),
    quickReplies: params.CHAT_QUICK_REPLIES,
    earlier: await earlierSessions(conv),
    urgentRequests: await urgentOf(conv),
  }
}

// ===== API-206 sửa nhãn =====

// Nhân viên sửa khi hệ thống nhận diện sai; từ đó hệ thống không tự đổi nhãn hội thoại này. auto=true: trả về tự động.
async function setLabels(req, id, body = {}) {
  const conv = await load(id)
  if (body.auto === true) {
    await conversations().updateOne({ _id: conv._id }, { $set: { labelsManual: false } })
    await require("./chat").updateLabels(conv._id)
  } else {
    const codes = rules.sortLabels(Array.isArray(body.labels) ? body.labels.map(String) : [])
    if (!codes.length) throw new HttpError(422, "VALIDATION_ERROR", "Chọn ít nhất 1 nhãn")
    await conversations().updateOne({ _id: conv._id }, { $set: { labels: codes, labelsManual: true } })
  }
  const fresh = await load(id)
  return { labels: labelView(fresh), labelsManual: !!fresh.labelsManual }
}

// ===== API-106 trả lời =====

async function reply(req, id, body = {}) {
  const conv = await load(id)
  if (conv.status === "DA_DONG") throw new HttpError(409, "CONVERSATION_CLOSED", "Hội thoại đã đóng, không gửi được tin") // AC3
  if (conv.status !== "DANG_HO_TRO" || !isMine(req, conv)) throw new HttpError(409, "NOT_ASSIGNED", "Bạn chưa nhận hội thoại này")
  const err = rules.textError(body.text, params.CHAT_MESSAGE_MAX)
  if (err) throw new HttpError(422, "VALIDATION_ERROR", err)
  const msg = await addMessage(conv, "ADMIN", String(body.text).trim(), { senderName: req.user.fullName, adminId: req.user._id })

  // Khách đã rời cửa sổ chat: Member nhận thông báo (UC-CSK-02 5a, UC-CSK-04 5Ea); Guest thấy khi mở lại trong cùng phiên
  const away = !conv.customerSeenAt || Date.now() - new Date(conv.customerSeenAt).getTime() > AWAY_MS
  if (away && conv.userId) {
    const member = await users().findOne({ _id: conv.userId })
    if (member) {
      const text = String(body.text).trim()
      await notifier.notify(member, { type: "HO_TRO", title: "Soulprint đã trả lời bạn", body: text.length > 120 ? text.slice(0, 117) + "..." : text, link: "/?chat=1" })
    }
  }
  return adminMessageView(msg)
}

// ===== API-107 kết thúc hỗ trợ =====

async function finishDutyIfDone(adminId) {
  const me = await users().findOne({ _id: adminId })
  if (me && me.dutyFinishing && !(await conversations().countDocuments({ status: "DANG_HO_TRO", assignedAdminId: adminId }))) {
    await users().updateOne({ _id: adminId }, { $set: { onDuty: false, dutyFinishing: false } })
  }
}

async function close(req, id) {
  const conv = await load(id)
  if (conv.status === "DA_DONG") throw new HttpError(409, "CONVERSATION_CLOSED", "Hội thoại đã đóng")
  if (!canReply(req)) throw new HttpError(403, "FORBIDDEN", "Bạn không có quyền thực hiện thao tác này")
  if (conv.status === "DANG_HO_TRO" && !isMine(req, conv) && !req.isFullAccess) throw new HttpError(409, "NOT_ASSIGNED", "Hội thoại do nhân viên khác hỗ trợ")
  await conversations().updateOne({ _id: conv._id }, { $set: { status: "DA_DONG", closedAt: new Date(), closedBy: req.user._id } })
  await addMessage(conv, "HE_THONG", "Cảm ơn bạn đã trò chuyện cùng Soulprint. Cuộc trò chuyện đã kết thúc, bạn cần thêm gì cứ nhắn Sâu Béo nhé!")
  // "Xử lý nốt rồi nghỉ": đóng hội thoại cuối thì tự tắt trực (UC-CSK-04 1a)
  if (conv.assignedAdminId) await finishDutyIfDone(conv.assignedAdminId)
  return { status: "DA_DONG" }
}

// ===== API-176 ghi chú nội bộ =====

async function addNote(req, id, body = {}) {
  const conv = await load(id)
  const err = rules.textError(body.text, params.CHAT_NOTE_MAX, "Ghi chú")
  if (err) throw new HttpError(422, "VALIDATION_ERROR", err) // 4cEa
  const note = { _id: new ObjectId(), at: new Date(), by: req.user._id, byName: req.user.fullName, text: String(body.text).trim() }
  await conversations().updateOne({ _id: conv._id }, { $push: { internalNotes: note } })
  return { ...note, _id: String(note._id), by: String(note.by) }
}

// ===== API-177 bật/tắt Đang trực =====

async function setDuty(req, body = {}) {
  const meId = req.user._id
  if (body.onDuty === true) {
    await users().updateOne({ _id: meId }, { $set: { onDuty: true, dutyFinishing: false } })
    return { onDuty: true, finishing: false, reassigned: 0, remaining: 0 }
  }
  if (body.onDuty !== false) throw new HttpError(422, "VALIDATION_ERROR", "Thiếu trạng thái trực")

  const open = await conversations().find({ status: "DANG_HO_TRO", assignedAdminId: meId }).toArray()
  if (!open.length) {
    await users().updateOne({ _id: meId }, { $set: { onDuty: false, dutyFinishing: false } })
    return { onDuty: false, finishing: false, reassigned: 0, remaining: 0 }
  }
  if (body.handover === "FINISH_FIRST") {
    await users().updateOne({ _id: meId }, { $set: { onDuty: true, dutyFinishing: true } })
    return { onDuty: true, finishing: true, reassigned: 0, remaining: open.length }
  }
  if (body.handover !== "REASSIGN") {
    throw new HttpError(409, "HANDOVER_REQUIRED", `Bạn còn ${open.length} hội thoại đang hỗ trợ`, { remaining: open.length })
  }

  // REASSIGN: chia cho người đang trực ít việc nhất; không còn ai thì trả về hàng đợi chung
  const staff = await staffOnDuty(meId)
  const loads = await conversations().aggregate([{ $match: { status: "DANG_HO_TRO", assignedAdminId: { $in: staff.map((s) => s._id) } } }, { $group: { _id: "$assignedAdminId", n: { $sum: 1 } } }]).toArray()
  const loadOf = new Map(loads.map((l) => [String(l._id), l.n]))
  const plan = rules.planHandover(open.map((c) => c._id), staff.map((s) => ({ _id: s._id, fullName: s.fullName, load: loadOf.get(String(s._id)) || 0 })))
  let reassigned = 0
  for (const p of plan) {
    const conv = open.find((c) => String(c._id) === String(p.id))
    if (p.to) {
      await conversations().updateOne({ _id: conv._id }, { $set: { assignedAdminId: p.to._id, assignedAt: new Date() } })
      await addMessage(conv, "HE_THONG", `${p.to.fullName} đã tham gia cuộc trò chuyện`)
      reassigned++
    } else {
      await conversations().updateOne({ _id: conv._id }, { $set: { status: "CHO_NHAN_VIEN", assignedAdminId: null } })
      await addMessage(conv, "HE_THONG", "Nhân viên sẽ phản hồi bạn sớm nhất.")
    }
  }
  await users().updateOne({ _id: meId }, { $set: { onDuty: false, dutyFinishing: false } })
  return { onDuty: false, finishing: false, reassigned, remaining: 0, returnedToQueue: open.length - reassigned }
}

module.exports = { list, detail, reply, close, addNote, setDuty, staffOnDuty, setLabels }
