// Chat "Sâu Béo" phía khách (07_API_Spec.md Mục 2.9) - UC-CSK-01, CSK-02, CSK-03: API-60 đến API-63, API-197.
// Hội thoại gắn với phiên (session.chatConversationId); Member còn gắn userId nên mở lại được sau khi đăng nhập lại.
// Tin mới lấy bằng REST polling: client gọi API-61 với ?after=<id tin cuối> mỗi 3-5 giây.
const { database, ObjectId } = require("../config/db")
const params = require("../config/params")
const HttpError = require("../utils/httpError")
const rules = require("./chatRules")
const { ai } = require("./aiProvider")
const st = require("./orderState")
const { getStoreSettings, variableValues, fillVariables } = require("./settings")

const conversations = () => database.collection("conversations")
const messages = () => database.collection("messages")
const OPEN = ["BOT", "CHO_NHAN_VIEN", "DANG_HO_TRO"]

const toId = (id) => (ObjectId.isValid(String(id)) ? new ObjectId(String(id)) : null)

// ===== Trạng thái hỗ trợ =====

// SUPPORT_HOURS_ALWAYS=true (chỉ để thử và demo ngoài giờ): coi như luôn trong giờ hỗ trợ
const inSupportHours = (now = new Date()) => process.env.SUPPORT_HOURS_ALWAYS === "true" || rules.isSupportHours(now)

// online = trong giờ hỗ trợ và có nhân viên đang trực nhận hội thoại mới (UC-CSK-02 4Ea)
async function supportStatus(now = new Date()) {
  const inHours = inSupportHours(now)
  const onDuty = inHours ? await database.collection("users").countDocuments({ role: "admin", status: "HOAT_DONG", onDuty: true }) : 0
  return { online: inHours && onDuty > 0, offHours: !inHours, hours: rules.hoursText() }
}

// Vị trí trong hàng đợi: số hội thoại chờ chuyển trước mình + 1
async function queuePosition(conv) {
  if (conv.status !== "CHO_NHAN_VIEN") return null
  return 1 + (await conversations().countDocuments({ status: "CHO_NHAN_VIEN", escalatedAt: { $lt: conv.escalatedAt } }))
}

// ===== Hiển thị =====

// Khách không thấy ghi chú nội bộ, tin gốc trước chuyển ngữ (UC-CSK-04 AC4)
const messageView = (m) => ({
  _id: String(m._id), sender: m.sender, text: m.text, senderName: m.senderName || null, link: m.link || null, card: m.card || null, createdAt: m.createdAt,
})

async function stateOf(conv) {
  const position = await queuePosition(conv)
  let agentName = null
  if (conv.assignedAdminId) {
    const a = await database.collection("users").findOne({ _id: conv.assignedAdminId }, { projection: { fullName: 1 } })
    agentName = a ? a.fullName : null
  }
  return {
    conversationId: String(conv._id), status: conv.status, statusLabel: rules.STATUS_LABEL[conv.status],
    queuePosition: position, waitMinutes: position ? rules.waitMinutes(position) : null, agentName,
    contact: conv.contact || null, leftMessage: !!conv.leftMessage,
  }
}

// ===== Sở hữu =====

// Chỉ phiên đã mở hội thoại (hoặc Member chủ hội thoại) đọc, gửi được; sai thì 404 để không lộ hội thoại người khác
async function own(req, id) {
  const _id = toId(id)
  const conv = _id && (await conversations().findOne({ _id }))
  const mine = conv && (String(req.session.chatConversationId || "") === String(conv._id) || (req.user && conv.userId && String(conv.userId) === String(req.user._id)))
  if (!mine) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy cuộc trò chuyện")
  return conv
}

async function addMessage(conv, sender, text, extra = {}) {
  const now = new Date()
  const doc = { conversationId: conv._id, sender, text, createdAt: now, ...extra }
  doc._id = (await messages().insertOne(doc)).insertedId
  await conversations().updateOne({ _id: conv._id }, { $set: { lastMessageAt: now } })
  return doc
}

const customerTexts = async (conv) =>
  (await messages().find({ conversationId: conv._id, sender: "KHACH" }).sort({ createdAt: 1 }).toArray()).map((m) => m.text)

// Nhãn tự gắn: tính lại sau mỗi tin của khách; nhân viên đã sửa tay (labelsManual) thì giữ nguyên
async function updateLabels(convId) {
  const conv = await conversations().findOne({ _id: convId })
  if (!conv || conv.labelsManual) return
  const labels = rules.autoLabels({ texts: await customerTexts(conv), sentiment: conv.sentiment, urgentOpen: !!conv.urgentOpen })
  await conversations().updateOne({ _id: conv._id }, { $set: { labels } })
}

// ===== API-60 mở hội thoại =====

function greeting(name, support) {
  const who = name ? `Chào ${name}! ` : "Chào bạn! "
  if (support.offHours) {
    return `${who}Hiện đã ngoài giờ trực của nhân viên (${support.hours}). Sâu vẫn trả lời các câu hỏi thường gặp, hoặc bạn để lại lời nhắn nhé.`
  }
  if (!support.online) return `${who}Hiện chưa có nhân viên trực. Sâu vẫn trả lời các câu hỏi thường gặp, hoặc bạn để lại lời nhắn để nhân viên phản hồi sớm nhất nhé.`
  return `${who}Mình là Sâu Béo, trợ lý của Soulprint. Bạn cần mình giúp gì nè?`
}

// Dùng lại hội thoại đang mở của phiên (UC-CSK-01 AC2); Member không có thì tìm hội thoại đang mở theo tài khoản
async function open(req, body = {}) {
  const support = await supportStatus()
  let conv = null
  const sid = toId(req.session.chatConversationId)
  if (sid) conv = await conversations().findOne({ _id: sid, status: { $in: OPEN } })
  if (req.user && req.user.role === "member" && (!conv || conv.status === "BOT")) {
    // Nhân viên vừa mở chat với khách từ đơn hàng (API-221): ưu tiên hội thoại có nhân viên hơn hội thoại Sâu Béo của phiên
    const staffConv = await conversations().find({ userId: req.user._id, status: { $in: ["CHO_NHAN_VIEN", "DANG_HO_TRO"] } }).sort({ lastMessageAt: -1 }).limit(1).next()
    if (staffConv) conv = staffConv
  }
  if (!conv && req.user && req.user.role === "member") {
    conv = await conversations().find({ userId: req.user._id, status: { $in: OPEN } }).sort({ lastMessageAt: -1 }).limit(1).next()
  }

  if (!conv) {
    const member = req.user && req.user.role === "member" ? req.user : null
    const typed = String(body.customerName || "").trim().slice(0, 60)
    const now = new Date()
    conv = {
      userId: member ? member._id : null, sessionId: req.sessionID, customerName: member ? member.fullName : typed || null,
      status: "BOT", summary: null, sentiment: null, sentimentScore: null, topic: null, contact: null, botMissCount: 0,
      assignedAdminId: null, escalatedAt: null, lastMessageAt: now, internalNotes: [], createdAt: now,
    }
    conv._id = (await conversations().insertOne(conv)).insertedId
    await addMessage(conv, "BOT", greeting(member ? member.fullName : typed, support))
    if (support.online) await addMessage(conv, "BOT", `Bạn chọn nhanh một chủ đề bên dưới hoặc gõ câu hỏi nhé. Nhân viên trực từ ${support.hours} mỗi ngày.`)
  }
  req.session.chatConversationId = String(conv._id)

  const list = await messages().find({ conversationId: conv._id }).sort({ createdAt: 1 }).toArray()
  return { ...(await stateOf(conv)), support, quickTopics: rules.QUICK_TOPICS, messages: list.map(messageView) }
}

// ===== API-61 tin mới =====

// Tin tự động khi nhân viên chậm: đang DANG_HO_TRO, tin cuối của khách chờ quá CHAT_REPLY_REMIND_MINUTES chưa có
// nhân viên trả lời thì gửi 1 lần cho lượt chờ đó. Ghi autoAckAt bằng điều kiện để 2 lần hỏi cùng lúc không gửi trùng.
const AUTO_ACK_TEXT = "Xin chào, cảm ơn bạn đã liên hệ với chúng tôi. Chúng tôi đã nhận được tin nhắn của bạn và sẽ sớm phản hồi."
async function autoAck(conv, now = new Date()) {
  if (conv.status !== "DANG_HO_TRO") return
  const last = await messages().find({ conversationId: conv._id, sender: "KHACH" }).sort({ createdAt: -1 }).limit(1).next()
  if (!last || now - last.createdAt < params.CHAT_REPLY_REMIND_MINUTES * 60000) return
  if (await messages().countDocuments({ conversationId: conv._id, sender: "ADMIN", createdAt: { $gt: last.createdAt } }, { limit: 1 })) return
  const r = await conversations().updateOne(
    { _id: conv._id, status: "DANG_HO_TRO", $or: [{ autoAckAt: null }, { autoAckAt: { $lt: last.createdAt } }] },
    { $set: { autoAckAt: now } },
  )
  if (r.modifiedCount) await addMessage(conv, "BOT", AUTO_ACK_TEXT)
}

async function poll(req, id, after) {
  const conv = await own(req, id)
  await autoAck(conv)
  const filter = { conversationId: conv._id }
  const afterId = toId(after)
  if (afterId) filter._id = { $gt: afterId }
  const list = await messages().find(filter).sort({ _id: 1 }).toArray()
  // Ghi lần cuối khách còn mở cửa sổ: nhân viên trả lời khi khách đã rời đi thì gửi thông báo cho Member (UC-CSK-04 5Ea)
  await conversations().updateOne({ _id: conv._id }, { $set: { customerSeenAt: new Date() } })
  return { ...(await stateOf(conv)), support: await supportStatus(), messages: list.map(messageView) }
}

// ===== API-62 gửi tin =====

// Câu trả lời về đơn (UC-CSK-01 bước 5): Member xem tóm tắt đơn gần nhất (hoặc đơn có mã trong tin); Guest được chỉ sang Tra cứu
async function orderAnswer(req, text) {
  if (!req.user || req.user.role !== "member") {
    return { text: "Bạn tra cứu đơn bằng số điện thoại hoặc mã đơn ở trang Tra cứu đơn hàng nhé, Sâu sẽ gửi mã xác minh để bảo vệ thông tin của bạn.", link: { label: "Tra cứu đơn hàng", url: "/tra-cuu-don" } }
  }
  const code = rules.orderCodeIn(text)
  const filter = { userId: req.user._id, ...(code ? { code } : {}) }
  const o = await database.collection("orders").find(filter).sort({ createdAt: -1 }).limit(1).next()
  if (!o) {
    return code
      ? { text: `Sâu không tìm thấy đơn ${code} trong tài khoản của bạn. Bạn kiểm tra lại mã đơn giúp Sâu nhé.` }
      : { text: "Bạn chưa có đơn hàng nào. Khi đặt hàng, bạn hỏi Sâu bất cứ lúc nào để xem tình trạng đơn nhé." }
  }
  const delivered = st.timeline(o).find((s) => s.status === "DA_GIAO")
  const eta = delivered && delivered.state === "todo" && delivered.expected ? `, dự kiến giao ${fmtDay(delivered.expected.from)}${delivered.expected.to && fmtDay(delivered.expected.to) !== fmtDay(delivered.expected.from) ? " - " + fmtDay(delivered.expected.to) : ""}` : ""
  return {
    text: `Đơn ${o.code}${code ? "" : " (đơn gần nhất)"} đang ở trạng thái "${st.statusLabel("orderStatus", o.orderStatus)}"${eta}.`,
    link: { label: "Xem chi tiết đơn", url: `/tai-khoan/don-hang/${o.code}` },
  }
}
const fmtDay = (d) => {
  const x = new Date(d)
  return `${String(x.getUTCDate()).padStart(2, "0")}/${String(x.getUTCMonth() + 1).padStart(2, "0")}`
}

// Sâu Béo trả lời 1 tin (UC-CSK-01 bước 5, 5a). Trả {reply, escalate}
async function botReply(req, conv, text) {
  if (rules.wantsHuman(text) || rules.wantsBulk(text)) return { reply: null, escalate: true }
  if (rules.isGreeting(text)) return { reply: { text: "Sâu đây! Bạn cần hỏi về phí vận chuyển, đổi trả, cá nhân hóa hay đơn hàng nè?" } }
  if (rules.isThanks(text)) return { reply: { text: "Không có chi nè! Bạn cần gì thêm cứ nhắn Sâu nhé." } }
  if (rules.asksOrder(text)) return { reply: await orderAnswer(req, text) }

  const faqs = await database.collection("faqs").find({ isActive: { $ne: false } }).sort({ sortOrder: 1, _id: 1 }).toArray()
  const faq = rules.matchFaq(text, faqs)
  if (faq) {
    await database.collection("faqs").updateOne({ _id: faq._id }, { $inc: { hitCount: 1 } })
    const values = variableValues(await getStoreSettings())
    return { reply: { text: fillVariables(faq.answer, values), faqId: faq._id }, hit: true }
  }

  const misses = (conv.botMissCount || 0) + 1
  await conversations().updateOne({ _id: conv._id }, { $set: { botMissCount: misses } })
  if (misses >= params.CHAT_BOT_MISS_LIMIT) return { reply: null, escalate: true }
  return { reply: { text: "Sâu chưa hiểu ý bạn lắm. Bạn thử hỏi cách khác, chọn một chủ đề bên dưới, hoặc bấm \"Gặp nhân viên\" để được hỗ trợ ngay nhé." } }
}

const HANDOFF_TEXT = "Mình sẽ chuyển bạn đến nhân viên hỗ trợ để giải quyết nhanh hơn nhé."
const BUSY_TEXT = "Chatbot đang bận, nhân viên hỗ trợ sẽ phản hồi bạn sớm nhất."

async function send(req, id, body = {}) {
  const conv = await own(req, id)
  if (conv.status === "DA_DONG") throw new HttpError(409, "CONVERSATION_CLOSED", "Cuộc trò chuyện đã kết thúc. Bạn bắt đầu cuộc trò chuyện mới nhé.")
  const err = rules.textError(body.text, params.CHAT_MESSAGE_MAX)
  if (err) throw new HttpError(422, "VALIDATION_ERROR", err) // UC-CSK-01 3Ea
  const original = String(body.text).trim()

  // UC-CSK-03: gay gắt mà khách chưa chọn bản nào thì đề xuất, chưa lưu tin
  let text = original
  let extra = {}
  if (body.confirmSoftened === "SOFTENED") {
    const softened = await ai.soften(original)
    if (softened) {
      text = softened
      extra = { originalText: original, softened: true }
    }
  } else if (body.confirmSoftened !== "ORIGINAL" && (await ai.isHarsh(original))) {
    const softened = await ai.soften(original)
    if (softened) return { needsConfirm: true, softened }
  }

  const created = [await addMessage(conv, "KHACH", text, extra)]
  let escalation = null
  // Lối vào có ý định rõ: gắn mã đơn để nhân viên biết khách hỏi đơn nào
  const orderCode = rules.orderCodeIn(body.orderCode)
  if (orderCode) await conversations().updateOne({ _id: conv._id }, { $set: { orderCode } })
  // Khách chọn "Đổi sản phẩm" ở đơn đang được hỏi: hỏi tiếp sản phẩm muốn đổi, kể cả khi đã có nhân viên
  if (body.intent === "DOI_SAN_PHAM") created.push(await addMessage(conv, "BOT", "Bạn muốn đổi sang sản phẩm nào? Bạn gửi tên hoặc liên kết sản phẩm, nhân viên Soulprint sẽ báo phần chênh (nếu có) nhé."))
  if (conv.status === "BOT" && body.toStaff === true) {
    // Nối thẳng nhân viên, không qua Sâu Béo (báo giá số lượng lớn, trả lời đơn đang hỏi, liên hệ sửa đơn)
    const support = await supportStatus()
    if (!support.online) {
      created.push(await addMessage(conv, "BOT", "Vấn đề này cần nhân viên hỗ trợ. " + rules.replyPromise(new Date(), inSupportHours()) + " Bạn để lại số điện thoại hoặc email và lời nhắn để nhân viên liên hệ nhé."))
      escalation = "LEAVE_MESSAGE"
    } else {
      created.push(await addMessage(conv, "BOT", "Sâu đang kết nối bạn với nhân viên Soulprint, bạn chờ một chút nhé."))
      await doEscalate(conv)
      escalation = "QUEUED"
    }
  } else if (conv.status !== "BOT") {
    // Đang chờ hoặc đang hỗ trợ: tính lại cảm xúc để khách bực bội được đưa lên đầu hàng đợi (UC-CSK-04 bước 2)
    const mood = await ai.sentiment(await customerTexts(conv)).catch(() => null)
    if (mood) await conversations().updateOne({ _id: conv._id }, { $set: mood })
    await updateLabels(conv._id)
  } else {
    let result
    try {
      result = await botReply(req, conv, text)
    } catch (e) {
      result = { reply: { text: BUSY_TEXT }, escalate: true, busy: true } // UC-CSK-01 5Ea
    }
    if (result.reply) {
      created.push(await addMessage(conv, "BOT", result.reply.text, result.reply.link ? { link: result.reply.link } : {}))
      if (result.hit) await conversations().updateOne({ _id: conv._id }, { $set: { botMissCount: 0 } })
    }
    if (result.escalate) {
      const support = await supportStatus()
      if (!support.online) {
        // Ngoài giờ hoặc chưa ai trực: mời để lại lời nhắn (UC-CSK-02 4Ea), hội thoại vẫn ở BOT tới khi khách gửi form
        if (!result.busy) created.push(await addMessage(conv, "BOT", "Vấn đề này cần nhân viên hỗ trợ. " + rules.replyPromise(new Date(), inSupportHours()) + " Bạn để lại số điện thoại hoặc email và lời nhắn để nhân viên liên hệ nhé."))
        escalation = "LEAVE_MESSAGE"
      } else {
        if (!result.busy) created.push(await addMessage(conv, "BOT", HANDOFF_TEXT))
        await doEscalate(conv)
        escalation = "QUEUED"
      }
    }
  }
  const fresh = await conversations().findOne({ _id: conv._id })
  return { ...(await stateOf(fresh)), escalation, messages: created.map(messageView) }
}

// ===== API-63 chuyển nhân viên =====

// Tạo tóm tắt, cảm xúc, chủ đề rồi đưa vào hàng đợi (UC-CSK-02 bước 2-4); tóm tắt lỗi thì để trống (2Ea)
async function doEscalate(conv, extra = {}) {
  const texts = await customerTexts(conv)
  let summary = null
  try {
    summary = await ai.summarize(texts)
  } catch (e) {
    summary = null
  }
  let mood = { sentiment: "TRUNG_TINH", sentimentScore: 0 }
  try {
    mood = await ai.sentiment(texts)
  } catch (e) {
    // giữ Trung tính
  }
  const now = new Date()
  await conversations().updateOne(
    { _id: conv._id },
    { $set: { status: "CHO_NHAN_VIEN", escalatedAt: now, summary, sentiment: mood.sentiment, sentimentScore: mood.sentimentScore, topic: rules.topicOf(texts), ...extra } }
  )
  await updateLabels(conv._id)
}

async function escalate(req, id, body = {}) {
  const conv = await own(req, id)
  if (conv.status !== "BOT") throw new HttpError(409, "INVALID_TRANSITION", "Cuộc trò chuyện đã được chuyển cho nhân viên")
  const support = await supportStatus()
  const created = []

  if (!support.online) {
    // Form "Để lại lời nhắn": Member không nhập thì lấy SĐT tài khoản
    const member = req.user && req.user.role === "member" ? req.user : null
    const contact = rules.validContact(body.contact) || (!String(body.contact || "").trim() && member ? member.phone : null)
    const errors = {}
    if (!contact) errors.contact = String(body.contact || "").trim() ? "Số điện thoại hoặc email chưa đúng" : "Vui lòng nhập số điện thoại hoặc email"
    const textErr = rules.textError(body.text, params.CHAT_MESSAGE_MAX, "Nội dung")
    if (textErr) errors.text = textErr
    if (Object.keys(errors).length) throw new HttpError(422, "VALIDATION_ERROR", Object.values(errors)[0], { fields: errors })
    created.push(await addMessage(conv, "KHACH", String(body.text).trim()))
    await doEscalate(conv, { contact, leftMessage: true })
    created.push(await addMessage(conv, "BOT", `Sâu đã nhận lời nhắn của bạn. ${rules.replyPromise(new Date(), inSupportHours())}`))
  } else {
    created.push(await addMessage(conv, "BOT", "Sâu đang kết nối bạn với nhân viên. Trong lúc chờ, bạn mô tả trước vấn đề để được hỗ trợ nhanh hơn nhé."))
    await doEscalate(conv)
  }
  const fresh = await conversations().findOne({ _id: conv._id })
  return { ...(await stateOf(fresh)), offHours: support.offHours, messages: created.map(messageView) }
}

// ===== API-197 hủy chờ =====

async function cancelEscalation(req, id) {
  const conv = await own(req, id)
  const r = await conversations().updateOne(
    { _id: conv._id, status: "CHO_NHAN_VIEN", assignedAdminId: null },
    { $set: { status: "BOT", escalatedAt: null, botMissCount: 0, leftMessage: false } }
  )
  if (!r.modifiedCount) throw new HttpError(409, "INVALID_TRANSITION", "Nhân viên đã nhận cuộc trò chuyện, bạn không thể hủy chờ")
  const msg = await addMessage(conv, "HE_THONG", "Bạn đã hủy chờ nhân viên. Sâu Béo tiếp tục hỗ trợ bạn nhé.")
  const fresh = await conversations().findOne({ _id: conv._id })
  return { ...(await stateOf(fresh)), messages: [messageView(msg)] }
}

// ===== API-208 quay lại Sâu Béo =====

async function backToBot(req, id) {
  const conv = await own(req, id)
  const r = await conversations().updateOne(
    { _id: conv._id, status: "DANG_HO_TRO" },
    { $set: { status: "BOT", assignedAdminId: null, escalatedAt: null, botMissCount: 0, leftMessage: false } },
  )
  if (!r.modifiedCount) throw new HttpError(409, "INVALID_TRANSITION", "Bạn đang không trò chuyện với nhân viên")
  const created = [
    await addMessage(conv, "HE_THONG", "Khách đã chuyển về trò chuyện với Sâu Béo"),
    await addMessage(conv, "BOT", "Sâu đây! Bạn hỏi tiếp nhé. Cần nhân viên hỗ trợ thì bấm Gặp nhân viên."),
  ]
  const fresh = await conversations().findOne({ _id: conv._id })
  return { ...(await stateOf(fresh)), messages: created.map(messageView) }
}

// ===== Gộp hội thoại khách vãng lai khi đăng nhập =====

// Hội thoại đang mở của phiên trước khi đăng nhập (req.guestChatId, giữ lại qua regenerate) gắn vào tài khoản.
// Tài khoản đã có hội thoại đang mở ở thiết bị khác thì dồn tin vào 1 hội thoại: giữ hội thoại "đi xa" hơn
// (đang hỗ trợ > chờ nhân viên > Sâu Béo, bằng nhau thì mới hơn), hội thoại còn lại đóng và trỏ sang.
const RANK = { DANG_HO_TRO: 3, CHO_NHAN_VIEN: 2, BOT: 1 }
async function adoptGuestConversation(req, user) {
  const gid = toId(req.guestChatId)
  req.guestChatId = null
  const guest = gid && (await conversations().findOne({ _id: gid, userId: null, status: { $in: OPEN } }))
  if (!guest) return
  await conversations().updateOne({ _id: guest._id }, { $set: { userId: user._id, customerName: user.fullName } })
  const other = await conversations().find({ userId: user._id, status: { $in: OPEN }, _id: { $ne: guest._id } }).sort({ lastMessageAt: -1 }).limit(1).next()
  let keep = guest
  if (other) {
    const otherFirst = RANK[other.status] > RANK[guest.status] || (RANK[other.status] === RANK[guest.status] && other.lastMessageAt > guest.lastMessageAt)
    keep = otherFirst ? other : guest
    const drop = otherFirst ? guest : other
    await messages().updateMany({ conversationId: drop._id }, { $set: { conversationId: keep._id } })
    const now = new Date()
    await conversations().updateOne({ _id: drop._id }, { $set: { status: "DA_DONG", closedAt: now, mergedInto: keep._id } })
    await conversations().updateOne({ _id: keep._id }, { $max: { lastMessageAt: drop.lastMessageAt } })
    await updateLabels(keep._id)
  }
  req.session.chatConversationId = String(keep._id)
}

module.exports = { open, poll, send, escalate, cancelEscalation, backToBot, adoptGuestConversation, autoAck, supportStatus, addMessage, messageView, doEscalate, inSupportHours, updateLabels }
