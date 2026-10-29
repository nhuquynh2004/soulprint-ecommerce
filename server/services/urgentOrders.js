// Đặt gấp: khách cần nhận trước ngày giao sớm nhất thì gửi yêu cầu thay vì đặt hàng. Yêu cầu là một đơn nháp
// kind "DAT_GAP" (dùng lại tính tiền, liên kết thanh toán, tạo đơn của UC-OPS-02) gắn với hội thoại CSKH của khách.
// Vòng đời urgent.status: CHO_XEM_XET -> DA_CHOT (nhân viên chốt, khách thấy đơn đã khóa) -> khách "Đặt hàng và thanh toán"
// -> đơn nháp HOAN_TAT (hiển thị DA_DAT). Nhân viên sửa đơn đã chốt thì tự về CHO_XEM_XET; TU_CHOI, KHACH_HUY là kết thúc.
// Tình huống đã xử lý: giá, tồn kho, voucher đổi sau khi chốt, ngày gấp đã qua, khách mở bản chốt cũ (version),
// bấm thanh toán 2 lần (dùng lại giao dịch đang chờ), trả online thất bại (đơn nháp quay về chờ thanh toán lại).
const crypto = require("crypto")
const { database, ObjectId } = require("../config/db")
const params = require("../config/params")
const HttpError = require("../utils/httpError")
const v = require("../utils/validators")
const cart = require("./cart")
const order = require("./order")
const payment = require("./payment")
const math = require("./checkoutMath")
const drafts = require("./draftOrders")
const chat = require("./chat")
const chatRules = require("./chatRules")
const { nextSequence } = require("./giftAdmin")
const { notifier } = require("./notifier")
const { writeLog } = require("./adminLog")

const col = () => database.collection("draftOrders")
const conversations = () => database.collection("conversations")
const users = () => database.collection("users")
const OPEN = ["CHO_XEM_XET", "DA_CHOT"]
const STATUS_LABEL = {
  CHO_XEM_XET: "Shop đang xem xét", DA_CHOT: "Shop đã chốt, chờ bạn thanh toán", DA_DAT: "Đã đặt hàng",
  TU_CHOI: "Shop chưa nhận được yêu cầu này", KHACH_HUY: "Bạn đã hủy yêu cầu",
}
const isMember = (req) => !!(req.user && req.user.role === "member")
const dmy = (ymd) => (ymd ? ymd.slice(8, 10) + "/" + ymd.slice(5, 7) : "")

const statusOf = (d) => (d.status === "HOAN_TAT" ? "DA_DAT" : d.urgent.status)
const historyEntry = (action, by, note = null) => ({ at: new Date(), action, by: by ? by._id || by : "KHACH", byName: by?.fullName || null, note })

async function nextCode(now) {
  const day = math.vnDate(now).slice(2).replace(/-/g, "")
  return "G" + day + String(await nextSequence("urgent-" + day)).padStart(4, "0")
}

// ===== Hội thoại gắn với yêu cầu =====

// Hội thoại đang mở của phiên hoặc Member; không có thì mở mới (như API-60)
async function conversationFor(req, contact) {
  const sid = ObjectId.isValid(String(req.session.chatConversationId || "")) ? new ObjectId(String(req.session.chatConversationId)) : null
  let conv = sid ? await conversations().findOne({ _id: sid, status: { $ne: "DA_DONG" } }) : null
  if (!conv && isMember(req)) conv = await conversations().find({ userId: req.user._id, status: { $ne: "DA_DONG" } }).sort({ lastMessageAt: -1 }).limit(1).next()
  if (!conv) {
    const now = new Date()
    conv = {
      userId: isMember(req) ? req.user._id : null, sessionId: req.sessionID, customerName: contact.fullName, status: "BOT", summary: null,
      sentiment: null, sentimentScore: null, topic: null, contact: contact.phone, botMissCount: 0, assignedAdminId: null, escalatedAt: null,
      lastMessageAt: now, internalNotes: [], labels: [], createdAt: now,
    }
    conv._id = (await conversations().insertOne(conv)).insertedId
  }
  req.session.chatConversationId = String(conv._id)
  return conv
}

// Đưa hội thoại lên đầu hàng đợi và giao cho nhân viên đang trực ít việc nhất (CSKH ưu tiên xử lý ngay)
async function prioritize(conv, code, contact) {
  const now = new Date()
  const set = { urgentOpen: true, customerName: conv.customerName || contact.fullName, contact: conv.contact || contact.phone, topic: `Đặt gấp #${code}` }
  if (conv.status === "BOT") Object.assign(set, { status: "CHO_NHAN_VIEN", escalatedAt: now })
  await conversations().updateOne({ _id: conv._id }, { $set: set, $addToSet: { urgentCodes: code, labels: "DAT_GAP" } })
  const fresh = await conversations().findOne({ _id: conv._id })
  if (fresh.status !== "CHO_NHAN_VIEN") return fresh
  const staff = await require("./chatAdmin").staffOnDuty()
  if (!staff.length) {
    await chat.addMessage(fresh, "BOT", `Sâu đã báo nhân viên. ${chatRules.replyPromise(now, chat.inSupportHours(now))} Bạn để ý tin nhắn ở đây nhé.`)
    return fresh
  }
  const loads = await conversations().aggregate([{ $match: { status: "DANG_HO_TRO", assignedAdminId: { $in: staff.map((s) => s._id) } } }, { $group: { _id: "$assignedAdminId", n: { $sum: 1 } } }]).toArray()
  const loadOf = new Map(loads.map((l) => [String(l._id), l.n]))
  const [plan] = chatRules.planHandover([fresh._id], staff.map((s) => ({ _id: s._id, fullName: s.fullName, load: loadOf.get(String(s._id)) || 0 })))
  const r = await conversations().updateOne({ _id: fresh._id, status: "CHO_NHAN_VIEN" }, { $set: { status: "DANG_HO_TRO", assignedAdminId: plan.to._id, assignedAt: now } })
  if (r.modifiedCount) await chat.addMessage(fresh, "HE_THONG", `${plan.to.fullName} đã tham gia cuộc trò chuyện`)
  return conversations().findOne({ _id: fresh._id })
}

// Tin hệ thống có thẻ yêu cầu (khách và nhân viên đều thấy, bấm mở trang yêu cầu)
async function postCard(d, text, cardText) {
  const conv = d.urgent.conversationId ? await conversations().findOne({ _id: d.urgent.conversationId }) : null
  if (!conv) return
  // Hội thoại đã đóng: mở lại để khách và nhân viên tiếp tục trao đổi về yêu cầu
  if (conv.status === "DA_DONG") await conversations().updateOne({ _id: conv._id }, { $set: { status: conv.assignedAdminId ? "DANG_HO_TRO" : "CHO_NHAN_VIEN", escalatedAt: new Date(), closedAt: null } })
  await chat.addMessage(conv, "HE_THONG", text, {
    card: { type: "DAT_GAP", code: d.code, status: statusOf(d), title: `Yêu cầu đặt gấp #${d.code}`, text: cardText, url: `/dat-gap/${d.code}?t=${d.urgent.token}` },
  })
}

// Yêu cầu đóng (đã đặt, từ chối, khách hủy) thì gỡ nhãn Đơn gấp nếu khách không còn yêu cầu nào mở (nhãn tự gỡ)
async function refreshLabel(d) {
  if (!d.urgent.conversationId) return
  const conv = await conversations().findOne({ _id: d.urgent.conversationId })
  if (!conv) return
  const open = await col().countDocuments({ kind: "DAT_GAP", code: { $in: conv.urgentCodes || [] }, status: { $ne: "HOAN_TAT" }, "urgent.status": { $in: OPEN } })
  if (!open) await conversations().updateOne({ _id: conv._id }, { $set: { urgentOpen: false }, ...(conv.labelsManual ? {} : { $pull: { labels: "DAT_GAP" } }) })
}

async function notifyMember(d, title, body) {
  if (!d.customerUserId) return
  const u = await users().findOne({ _id: d.customerUserId })
  if (u) await notifier.notify(u, { type: "DON_HANG", title, body, link: `/dat-gap/${d.code}` })
}

// ===== Khách gửi yêu cầu (API-201) =====

async function create(req, body = {}) {
  const contact = order.readContact(req, body)
  const recipientType = body.recipientType === "OTHER" ? "OTHER" : "SELF"
  const base = await order.checkoutLines(req)
  const personalized = base.lines.some((l) => l.isPersonalized)
  const { shippingAddress, noteForShop } = order.readShipping(body, recipientType, contact, { personalized, urgent: true })
  const range = math.deliveryRange(new Date(), { province: shippingAddress.province, personalized })
  if (shippingAddress.deliveryDate >= range.min) {
    throw new HttpError(422, "NOT_URGENT", `Ngày ${dmy(shippingAddress.deliveryDate)} vẫn kịp giao bình thường, bạn bỏ chọn Đặt gấp và đặt hàng như thường nhé`, { earliest: range.min })
  }
  const open = await col().countDocuments({ kind: "DAT_GAP", "customer.phone": contact.phone, status: { $ne: "HOAN_TAT" }, "urgent.status": { $in: OPEN } })
  if (open >= params.URGENT_OPEN_MAX) throw new HttpError(429, "QUOTA_EXCEEDED", `Bạn đang có ${open} yêu cầu đặt gấp chờ xử lý, vui lòng nhắn shop trong khung chat để được hỗ trợ`)
  if (!isMember(req) && (await users().findOne({ phone: contact.phone, role: "admin" }, { projection: { _id: 1 } }))) {
    throw new HttpError(422, "VALIDATION_ERROR", "Số điện thoại này thuộc tài khoản nhân viên, vui lòng dùng số khác", { fields: { "contact.phone": "Số điện thoại thuộc tài khoản nhân viên" } })
  }

  // Chép dòng giỏ đang chọn (giữ _id để đặt xong thì xóa đúng dòng khỏi giỏ), gói quà "Mẫu của tôi" chép thành tự tạo
  const raw = await cart.loadCart(req)
  const ids = new Set(base.lines.map((l) => String(l._id)))
  const items = raw.items.filter((it) => ids.has(String(it._id))).map((it) => ({ _id: String(it._id), productId: String(it.productId), variantSku: it.variantSku, quantity: it.quantity, personalization: it.personalization || null, selected: true }))
  let giftWrap = raw.giftWrap && raw.giftWrap.selected !== false ? { ...raw.giftWrap } : null
  if (giftWrap && giftWrap.source === "CUA_TOI") giftWrap = { source: "TAO_MOI", name: giftWrap.name, custom: giftWrap.custom, selected: true }
  const owner = isMember(req) ? req.user : await users().findOne({ phone: contact.phone, role: "member" })

  const now = new Date()
  const code = await nextCode(now)
  const conv = await conversationFor(req, contact)
  const doc = {
    code, kind: "DAT_GAP", status: "MO", source: "WEBSITE", tags: ["Đơn gấp"],
    customerUserId: owner ? owner._id : null, customer: contact, items, giftWrap, recipientType,
    shippingAddress: { recipientName: shippingAddress.recipientName, phone: shippingAddress.phone, province: shippingAddress.province, ward: shippingAddress.ward, street: shippingAddress.street, noteForShipper: shippingAddress.noteForShipper },
    deliveryDate: shippingAddress.deliveryDate, deliveryWindow: shippingAddress.deliveryWindow || null, noteForShop,
    voucherCodes: math.readCodes(body.voucherCodes ?? body.voucherCode), paymentChoice: null, remainingMethod: null, urgentFee: 0, internalNote: "",
    urgent: {
      status: "CHO_XEM_XET", requestedDate: shippingAddress.deliveryDate, earliestDate: range.min, token: crypto.randomBytes(16).toString("hex"),
      sessionId: req.sessionID, conversationId: conv._id, version: 0, history: [historyEntry("GUI", null)],
      // Gói quà khách chọn lúc gửi: tab "Mẫu của khách" để nhân viên xem và quay lại mẫu gốc
      originalGiftWrap: giftWrap ? { ...giftWrap } : null,
    },
    createdBy: null, updatedBy: null, createdAt: now, updatedAt: now,
  }
  Object.assign(doc, await drafts.withEstimate(doc))
  doc._id = (await col().insertOne(doc)).insertedId
  req.session.urgentCodes = [code, ...(req.session.urgentCodes || [])].slice(0, 10)

  await chat.addMessage(conv, "KHACH", `Mình cần đặt gấp, mong nhận ngày ${dmy(doc.deliveryDate)}.`)
  const fresh = await prioritize(conv, code, contact)
  await postCard({ ...doc, urgent: { ...doc.urgent, conversationId: fresh._id } }, "Sâu đã gửi yêu cầu đặt gấp cho shop. Shop sẽ kiểm tra khả năng làm kịp, báo phụ phí (nếu có) ngay trong khung chat này.", `Mong nhận ${dmy(doc.deliveryDate)}, ${items.length} sản phẩm`)
  await notifyMember(doc, `Đã gửi yêu cầu đặt gấp #${code}`, "Shop đang xem xét, bạn theo dõi trong khung chat nhé")
  return { code, token: doc.urgent.token, url: `/dat-gap/${code}?t=${doc.urgent.token}`, conversationId: String(fresh._id) }
}

// ===== Quyền xem của khách =====

// Phiên đã gửi, Member chủ yêu cầu, hoặc liên kết có token (Guest mở trên thiết bị khác). Sai thì 404.
async function own(req, code, token) {
  const d = await col().findOne({ code: String(code || "").toUpperCase(), kind: "DAT_GAP" })
  const ok = d && (
    (req.session.urgentCodes || []).includes(d.code) ||
    (isMember(req) && d.customerUserId && String(d.customerUserId) === String(req.user._id)) ||
    (token && typeof token === "string" && token.length === d.urgent.token.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(d.urgent.token)))
  )
  if (!ok) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy yêu cầu đặt gấp")
  if (!(req.session.urgentCodes || []).includes(d.code)) req.session.urgentCodes = [d.code, ...(req.session.urgentCodes || [])].slice(0, 10)
  // Mở khung chat đúng hội thoại của yêu cầu
  if (d.urgent.conversationId) req.session.chatConversationId = String(d.urgent.conversationId)
  return drafts.syncLink(d)
}

// ===== Tự mở lại khi bản chốt không còn đúng =====

async function reopen(d, reason, by = null) {
  const r = await col().updateOne(
    { _id: d._id, status: { $ne: "HOAN_TAT" }, "urgent.status": "DA_CHOT" },
    { $set: { "urgent.status": "CHO_XEM_XET", updatedAt: new Date() }, $push: { "urgent.history": historyEntry("MO_LAI", by, reason) } },
  )
  if (!r.modifiedCount) return false
  if (d.status === "DA_GUI_LINK") {
    await payment.cancelPending(d.paymentId)
    await col().updateOne({ _id: d._id }, { $set: { status: "MO", paymentId: null, paymentUrl: null, paymentExpiresAt: null } })
  }
  const fresh = await col().findOne({ _id: d._id })
  await postCard(fresh, by ? "Shop đang cập nhật lại đơn gấp, bạn chờ chút nhé." : `${reason}. Shop sẽ kiểm tra và chốt lại cho bạn ngay.`, STATUS_LABEL.CHO_XEM_XET)
  return true
}

// Nhân viên sửa đơn gấp đã chốt (draftOrders.update)
async function onReopened(d, staff) {
  await col().updateOne({ _id: d._id }, { $push: { "urgent.history": historyEntry("SUA", staff) } })
  if (d.status === "DA_GUI_LINK") await col().updateOne({ _id: d._id }, { $set: { status: "MO", paymentId: null, paymentUrl: null, paymentExpiresAt: null } })
  const fresh = await col().findOne({ _id: d._id })
  await postCard(fresh, "Shop đang cập nhật lại đơn gấp, bạn chờ chút nhé.", STATUS_LABEL.CHO_XEM_XET)
}

// ===== Xem (API-202) =====

// Phương thức nhân viên chọn cho đơn gấp (lưu ở đơn nháp); chưa chọn hoặc không còn hợp lệ thì null
const staffOption = (d, options) => (d.paymentChoice ? math.pickOption(options, d.paymentChoice, d.remainingMethod) : null)

async function view(req, code, token) {
  let d = await own(req, code, token)
  const status = statusOf(d)
  const q = await drafts.quoteOf(d)
  // Đã chốt mà tổng đổi (giá, voucher hết hạn) hoặc hết hàng: không cho trả theo số cũ, tự mở lại
  if (status === "DA_CHOT") {
    const reason = q.stockWarnings.length ? "Một sản phẩm trong đơn vừa thay đổi tồn kho" : q.voucherErrors.length ? `Mã ${q.voucherErrors[0].code} không còn áp dụng` : q.money && q.money.total !== d.urgent.lockedTotal ? "Giá trong đơn vừa thay đổi" : d.deliveryDate < math.deliveryRange().urgentMin ? "Ngày giao đã chốt đã qua" : null
    if (reason && (await reopen(d, reason))) d = await col().findOne({ _id: d._id })
  }
  const s = statusOf(d)
  const pendingPay = d.status === "DA_GUI_LINK" && d.paymentId ? await database.collection("payments").findOne({ _id: d.paymentId, status: "PENDING" }) : null
  // Đã chốt: khách chỉ thấy đúng phương thức nhân viên chọn (UC-PAY-04 5c)
  const fixed = s !== "CHO_XEM_XET" ? staffOption(d, q.paymentOptions) : null
  return {
    code: d.code, status: s, statusLabel: STATUS_LABEL[s], createdAt: d.createdAt, locked: s !== "CHO_XEM_XET", version: d.urgent.version || 0,
    requestedDate: d.urgent.requestedDate, earliestDate: d.urgent.earliestDate, deliveryDate: d.deliveryDate, deliveryWindow: d.deliveryWindow,
    recipientType: d.recipientType, customer: d.customer, shippingAddress: d.shippingAddress, noteForShop: d.noteForShop || "",
    items: q.items, giftWrap: q.giftWrap, money: q.money, vouchers: q.vouchers, paymentOptions: fixed ? [fixed] : q.paymentOptions, paymentFixed: !!fixed,
    confirmedAt: d.urgent.confirmedAt || null, rejectReason: d.urgent.rejectReason || null, orderCode: d.orderCode || null,
    conversationId: d.urgent.conversationId ? String(d.urgent.conversationId) : null,
    pendingPayment: pendingPay ? { paymentId: String(pendingPay._id), paymentUrl: `/cong-thanh-toan/${pendingPay._id}`, amount: pendingPay.amount } : null,
  }
}

// ===== Khách đặt hàng và thanh toán (API-203) =====

async function checkout(req, code, body = {}) {
  let d = await own(req, code, body.t)
  const status = statusOf(d)
  if (status === "DA_DAT") throw new HttpError(409, "URGENT_DONE", "Yêu cầu đã thành đơn hàng", { orderCode: d.orderCode })
  if (status !== "DA_CHOT") throw new HttpError(409, "URGENT_NOT_CONFIRMED", status === "CHO_XEM_XET" ? "Shop đang cập nhật đơn, bạn chờ shop chốt lại nhé" : STATUS_LABEL[status])
  // Khách đang xem bản chốt cũ (shop vừa sửa và chốt lại)
  if (Number(body.version) !== (d.urgent.version || 0)) throw new HttpError(409, "URGENT_CHANGED", "Shop vừa cập nhật đơn gấp, bạn xem lại thông tin mới trước khi thanh toán nhé")
  if (body.acceptPolicy !== true) throw new HttpError(422, "POLICY_NOT_ACCEPTED", "Vui lòng đồng ý Chính sách thanh toán và đặt cọc", { fields: { acceptPolicy: "Vui lòng đồng ý Chính sách thanh toán và đặt cọc" } })

  let snap
  try {
    // Nhân viên đã chọn phương thức khi chốt thì dùng lựa chọn đó, bỏ qua lựa chọn khách gửi; yêu cầu cũ chưa có thì khách chọn
    const choice = d.paymentChoice ? { paymentChoice: d.paymentChoice, remainingMethod: d.remainingMethod || null } : { paymentChoice: ["COD", "ONLINE"].includes(body.paymentChoice) ? body.paymentChoice : null, remainingMethod: body.remainingMethod === "COD" ? "COD" : null }
    snap = await drafts.prepare({ ...d, ...choice }, null)
  } catch (err) {
    // Hết hàng, voucher hết lượt, ngày gấp đã qua: mở lại để shop xử lý, khách không phải tự sửa
    if (err instanceof HttpError && ["OUT_OF_STOCK", "VOUCHER_INVALID", "GIFT_WRAP_UNAVAILABLE", "VALIDATION_ERROR"].includes(err.code)) {
      await reopen(d, err.code === "VALIDATION_ERROR" ? "Ngày giao đã chốt không còn hợp lệ" : err.message.replace(/[.,].*$/, ""))
      throw new HttpError(409, "URGENT_REOPENED", "Đơn gấp vừa có thay đổi nên shop cần chốt lại. Shop đã được báo trong khung chat, bạn chờ chút nhé")
    }
    throw err
  }
  if (snap.money.total !== d.urgent.lockedTotal) {
    await reopen(d, "Giá trong đơn vừa thay đổi")
    throw new HttpError(409, "URGENT_REOPENED", "Giá trong đơn vừa thay đổi nên shop cần chốt lại. Bạn chờ chút nhé")
  }
  snap.sessionId = req.sessionID

  const due = snap.option.amountDueNow
  if (due <= 0) {
    const r = await col().updateOne({ _id: d._id, status: { $ne: "HOAN_TAT" }, "urgent.status": "DA_CHOT", "urgent.version": d.urgent.version || 0 }, { $set: { status: "HOAN_TAT", updatedAt: new Date() } })
    if (!r.modifiedCount) throw new HttpError(409, "URGENT_CHANGED", "Shop vừa cập nhật đơn gấp, bạn xem lại trước khi đặt nhé")
    try {
      const { order: created, owner, accountCreated } = await order.place(snap, { req })
      await col().updateOne({ _id: d._id }, { $set: { orderCode: created.code } })
      order.rememberOrder(req, created.code)
      return { orderCode: created.code, total: created.total, activation: await order.activationFor(snap, owner, accountCreated) }
    } catch (err) {
      await col().updateOne({ _id: d._id }, { $set: { status: "MO" } })
      throw err
    }
  }
  // Bấm 2 lần: dùng lại giao dịch còn hạn cùng số tiền
  if (d.status === "DA_GUI_LINK" && d.paymentId) {
    const p = await database.collection("payments").findOne({ _id: d.paymentId, status: "PENDING", expiresAt: { $gt: new Date() } })
    if (p && p.amount === due) {
      payment.rememberPayment(req, p._id)
      return { paymentId: String(p._id), paymentUrl: `/cong-thanh-toan/${p._id}`, amount: p.amount }
    }
    await payment.cancelPending(d.paymentId)
  }
  const link = await payment.createForDraft(snap, d, { ttlMinutes: params.PAYMENT_TTL_MINUTES })
  payment.rememberPayment(req, link.paymentId)
  await col().updateOne({ _id: d._id }, { $set: { status: "DA_GUI_LINK", paymentId: new ObjectId(link.paymentId), paymentUrl: link.paymentUrl, paymentExpiresAt: link.expiresAt, updatedAt: new Date() } })
  return { paymentId: link.paymentId, paymentUrl: link.paymentUrl, amount: link.amount }
}

// ===== Khách hủy yêu cầu (API-204) =====

async function cancel(req, code, body = {}) {
  const d = await own(req, code, body.t)
  if (!OPEN.includes(statusOf(d))) throw new HttpError(409, "URGENT_CLOSED", "Yêu cầu đã đóng")
  if (d.status === "DA_GUI_LINK") await payment.cancelPending(d.paymentId)
  await col().updateOne(
    { _id: d._id, status: { $ne: "HOAN_TAT" } },
    { $set: { "urgent.status": "KHACH_HUY", status: "MO", paymentId: null, paymentUrl: null, updatedAt: new Date() }, $push: { "urgent.history": historyEntry("KHACH_HUY", null, body.reason ? String(body.reason).slice(0, 200) : null) } },
  )
  const fresh = await col().findOne({ _id: d._id })
  await postCard(fresh, "Bạn đã hủy yêu cầu đặt gấp. Các sản phẩm vẫn còn trong giỏ hàng nếu bạn muốn đặt bình thường.", STATUS_LABEL.KHACH_HUY)
  await refreshLabel(fresh)
  return view(req, d.code)
}

// ===== Nhân viên chốt, từ chối, mở lại (API-205) =====

async function staffAction(req, code, body = {}) {
  const d = await drafts.loadDraft(code)
  if (d.kind !== "DAT_GAP") throw new HttpError(404, "NOT_FOUND", "Không phải yêu cầu đặt gấp")
  const status = statusOf(d)
  const action = String(body.action || "")
  const now = new Date()

  if (action === "CONFIRM") {
    if (status !== "CHO_XEM_XET") throw new HttpError(409, "INVALID_TRANSITION", status === "DA_CHOT" ? "Đơn gấp đã chốt, sửa đơn để mở lại" : "Yêu cầu đã đóng")
    // Kiểm tra đủ như lúc khách thanh toán: khách, sản phẩm, tồn, voucher, ngày giao (từ ngày mai)
    const snap = await drafts.prepare(d, req.user)
    const version = (d.urgent.version || 0) + 1
    await col().updateOne(
      { _id: d._id, "urgent.status": "CHO_XEM_XET", status: { $ne: "HOAN_TAT" } },
      {
        $set: { "urgent.status": "DA_CHOT", "urgent.version": version, "urgent.lockedTotal": snap.money.total, "urgent.confirmedAt": now, "urgent.confirmedBy": req.user._id, totalEstimate: snap.money.total, updatedBy: req.user._id, updatedAt: now },
        $push: { "urgent.history": historyEntry("CHOT", req.user) },
      },
    )
    const fresh = await col().findOne({ _id: d._id })
    const fee = d.urgentFee ? `, phụ phí giao gấp ${math.fmt(d.urgentFee)}` : ""
    await postCard(fresh, `Shop đã chốt đơn gấp: giao ngày ${dmy(d.deliveryDate)}, tổng ${math.fmt(snap.money.total)}${fee}. Bạn xem lại và bấm "Đặt hàng và thanh toán" nhé.`, `Giao ${dmy(d.deliveryDate)}, tổng ${math.fmt(snap.money.total)}`)
    await notifyMember(fresh, `Shop đã chốt đơn gấp #${d.code}`, `Tổng ${math.fmt(snap.money.total)}, bạn xem lại và thanh toán nhé`)
    await writeLog({ adminId: req.user._id, action: "DRAFT_ORDER", targetType: "draftOrders", targetId: d._id, after: { code: d.code, total: snap.money.total, summary: "chốt đơn gấp" } })
    return drafts.get(d.code)
  }
  if (action === "REOPEN") {
    if (status !== "DA_CHOT") throw new HttpError(409, "INVALID_TRANSITION", "Chỉ mở lại đơn gấp đã chốt")
    await reopen(d, "Shop mở lại để cập nhật", req.user)
    return drafts.get(d.code)
  }
  if (action === "REJECT") {
    if (!OPEN.includes(status)) throw new HttpError(409, "INVALID_TRANSITION", "Yêu cầu đã đóng")
    const reason = typeof body.reason === "string" ? body.reason.normalize("NFC").trim().slice(0, 300) : ""
    if (reason.length < 5) throw new HttpError(422, "VALIDATION_ERROR", "Nhập lý do (ít nhất 5 ký tự) để khách hiểu", { fields: { reason: "Nhập lý do" } })
    if (d.status === "DA_GUI_LINK") await payment.cancelPending(d.paymentId)
    await col().updateOne(
      { _id: d._id, status: { $ne: "HOAN_TAT" } },
      { $set: { "urgent.status": "TU_CHOI", "urgent.rejectReason": reason, status: "MO", paymentId: null, paymentUrl: null, updatedBy: req.user._id, updatedAt: now }, $push: { "urgent.history": historyEntry("TU_CHOI", req.user, reason) } },
    )
    const fresh = await col().findOne({ _id: d._id })
    await postCard(fresh, `Shop rất tiếc chưa nhận được yêu cầu đặt gấp này: ${reason}. Bạn vẫn đặt hàng bình thường được, sản phẩm còn trong giỏ.`, STATUS_LABEL.TU_CHOI)
    await notifyMember(fresh, `Yêu cầu đặt gấp #${d.code} chưa được nhận`, reason)
    await refreshLabel(fresh)
    await writeLog({ adminId: req.user._id, action: "DRAFT_ORDER", targetType: "draftOrders", targetId: d._id, after: { code: d.code, reason, summary: "từ chối đơn gấp" } })
    return drafts.get(d.code)
  }
  throw new HttpError(400, "VALIDATION_ERROR", "Thao tác không hợp lệ")
}

// Đơn gấp đã thành đơn hàng (order.afterPlaced): báo trong chat, gỡ nhãn
async function onPlaced(created) {
  const d = await col().findOne({ code: created.urgentCode, kind: "DAT_GAP" })
  if (!d) return
  await col().updateOne({ _id: d._id }, { $set: { status: "HOAN_TAT", orderCode: created.code, updatedAt: new Date() }, $push: { "urgent.history": historyEntry("DAT", null, created.code) } })
  const fresh = await col().findOne({ _id: d._id })
  await postCard(fresh, `Đặt hàng thành công đơn ${created.code}. Shop ưu tiên xử lý để giao ngày ${dmy(d.deliveryDate)}.`, `Đơn ${created.code}`)
  await refreshLabel(fresh)
}

module.exports = { create, view, checkout, cancel, staffAction, onReopened, onPlaced, STATUS_LABEL }
