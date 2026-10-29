// Đơn nháp (UC-OPS-02; 07_API_Spec.md API-97, API-152 đến API-157, API-193). Nhân viên soạn đơn thay khách
// đặt qua điện thoại, Zalo, Facebook, email. Dùng chung tính tiền và tạo đơn với UC-PAY-04 (order.js) để không lệch quy
// tắc: giá tính lại khi đọc, BR-01 đến BR-05, voucher BR-23, trừ tồn có điều kiện lúc hoàn tất. Đơn nháp không giữ tồn,
// không trừ lượt voucher (đảm bảo tối thiểu).
const { database, ObjectId } = require("../config/db")
const params = require("../config/params")
const HttpError = require("../utils/httpError")
const v = require("../utils/validators")
const { accentInsensitivePattern } = require("../utils/vnText")
const cart = require("./cart")
const order = require("./order")
const payment = require("./payment")
const math = require("./checkoutMath")
const rules = require("./opsRules")
const { nextSequence } = require("./giftAdmin")
const { writeLog } = require("./adminLog")

const drafts = () => database.collection("draftOrders")
const users = () => database.collection("users")
const PAGE_SIZE = 20
const SOURCES = ["DIEN_THOAI", "ZALO", "FACEBOOK", "EMAIL", "KHAC"]
const STATUSES = ["MO", "DA_GUI_LINK", "HOAN_TAT"]

const text = (x, max) => (typeof x === "string" ? x.normalize("NFC").trim().slice(0, max) : "")
const toId = (x) => (x && ObjectId.isValid(String(x)) ? new ObjectId(String(x)) : null)
const canOf = (req) => (code) => !!req.isFullAccess || req.permissions.has(code)

async function loadDraft(code) {
  const d = await drafts().findOne({ code: String(code || "").replace(/^#/, "").toUpperCase() })
  if (!d) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy đơn nháp")
  return syncLink(d)
}

// 6aEa: liên kết quá 24 giờ chưa thanh toán (hoặc đã hủy) thì đơn nháp quay về MO; trả thành công thì HOAN_TAT
async function syncLink(d) {
  if (d.status !== "DA_GUI_LINK" || !d.paymentId) return d
  const p = await database.collection("payments").findOne({ _id: d.paymentId })
  const now = new Date()
  if (p && p.status === "SUCCESS" && p.orderCode) {
    await drafts().updateOne({ _id: d._id }, { $set: { status: "HOAN_TAT", orderCode: p.orderCode, updatedAt: now } })
    return { ...d, status: "HOAN_TAT", orderCode: p.orderCode }
  }
  // Khách trả không thành công nhưng liên kết còn hạn: giữ liên kết để khách Thử lại, ghi lúc thất bại cho nhân viên
  if (p && p.status === "FAILED" && payment.draftRetryable(p, d, now)) {
    if (!d.payFailedAt || +new Date(d.payFailedAt) !== +p.updatedAt) await drafts().updateOne({ _id: d._id, paymentId: p._id }, { $set: { payFailedAt: p.updatedAt } })
    return { ...d, payFailedAt: p.updatedAt }
  }
  if (!p || p.status === "FAILED" || p.status === "REFUNDED" || (p.status === "PENDING" && p.expiresAt <= now)) {
    if (p && p.status === "PENDING") await database.collection("payments").updateOne({ _id: p._id, status: "PENDING" }, { $set: { status: "FAILED", failReason: "HET_HAN", updatedAt: now } })
    await drafts().updateOne({ _id: d._id, status: "DA_GUI_LINK" }, { $set: { status: "MO", paymentId: null, paymentUrl: null, paymentExpiresAt: null, updatedAt: now } })
    return { ...d, status: "MO", paymentId: null, paymentUrl: null, paymentExpiresAt: null, linkExpired: true }
  }
  return d
}

// ===== Đọc dữ liệu form (lưu nháp không bắt buộc đủ trường - bước 5) =====

async function readItems(list) {
  const items = []
  for (const raw of Array.isArray(list) ? list.slice(0, params.CART_MAX_ITEMS) : []) {
    const p = await database.collection("products").findOne({ _id: toId(raw.productId) })
    if (!p) throw new HttpError(422, "VALIDATION_ERROR", "Sản phẩm không còn tồn tại", { fields: { items: "Sản phẩm không hợp lệ" } })
    const variant = cart.findVariant(p, String(raw.variantSku || ""))
    if (!variant) throw new HttpError(422, "VALIDATION_ERROR", `Chọn phân loại cho ${p.name}`, { fields: { items: `Chọn phân loại cho ${p.name}` } })
    const quantity = cart.readQuantity(raw.quantity ?? 1)
    const personalization = await cart.normalizeFor(p, raw.personalization)
    items.push({ _id: String(toId(raw._id) || new ObjectId()), productId: String(p._id), variantSku: variant.sku, quantity, personalization, selected: true })
  }
  return items
}

async function readGiftWrap(g) {
  if (!g || g.source === null) return null
  // Đơn nháp chỉ chọn mẫu gợi ý hoặc tự tạo; "Mẫu của tôi" là dữ liệu riêng của khách
  if (g.source !== "GOI_Y" && g.source !== "TAO_MOI") throw new HttpError(422, "VALIDATION_ERROR", "Chọn mẫu gói quà gợi ý hoặc tự tạo", { fields: { giftWrap: "Không hợp lệ" } })
  return cart.buildGiftWrap(null, g)
}

function readShippingLoose(body) {
  const a = body.shippingAddress || null
  if (!a) return null
  return {
    recipientName: text(a.recipientName, 60), phone: v.str(a.phone).replace(/[\s.]/g, ""), province: text(a.province, 60), ward: text(a.ward, 80),
    street: text(a.street, 200), noteForShipper: text(a.noteForShipper, params.NOTE_MAX_CHARS),
  }
}

async function readCustomer(body) {
  if (body.customerUserId) {
    const u = await users().findOne({ _id: toId(body.customerUserId), role: "member" }, { projection: { fullName: 1, phone: 1, email: 1, status: 1 } })
    if (!u) throw new HttpError(422, "VALIDATION_ERROR", "Không tìm thấy khách hàng", { fields: { customerUserId: "Khách không hợp lệ" } })
    return { customerUserId: u._id, customer: { fullName: u.fullName, phone: u.phone, ...(u.email ? { email: u.email } : {}) } }
  }
  const c = body.customer || null
  if (!c) return { customerUserId: null, customer: null }
  const customer = { fullName: text(c.fullName, 60), phone: v.str(c.phone).replace(/[\s.]/g, ""), email: v.str(c.email).toLowerCase() }
  v.assertFields({
    "customer.fullName": !customer.fullName || customer.fullName.length >= 2 ? "" : "Họ tên ít nhất 2 ký tự",
    "customer.phone": !customer.phone || v.isPhone(customer.phone) ? "" : "Số điện thoại cần 10 số, bắt đầu bằng 0",
    "customer.email": !customer.email || v.isEmail(customer.email) ? "" : "Email không hợp lệ",
  })
  if (!customer.email) delete customer.email
  // Khách mới nhưng SĐT đã có tài khoản: gắn vào tài khoản đó (2a)
  const found = customer.phone ? await users().findOne({ phone: customer.phone }, { projection: { role: 1 } }) : null
  if (found && found.role !== "member") throw new HttpError(422, "VALIDATION_ERROR", "Số điện thoại thuộc tài khoản nhân viên", { fields: { "customer.phone": "Số điện thoại thuộc tài khoản nhân viên" } })
  return { customerUserId: found ? found._id : null, customer }
}

async function readDraft(body, existing = {}) {
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k)
  const out = {}
  if (has("customerUserId") || has("customer")) Object.assign(out, await readCustomer(body))
  if (has("items")) out.items = await readItems(body.items)
  if (has("giftWrap")) out.giftWrap = await readGiftWrap(body.giftWrap)
  if (has("recipientType")) out.recipientType = body.recipientType === "OTHER" ? "OTHER" : "SELF"
  if (has("shippingAddress")) out.shippingAddress = readShippingLoose(body)
  if (has("deliveryDate")) out.deliveryDate = v.str(body.deliveryDate) || null
  if (has("deliveryWindow")) out.deliveryWindow = v.str(body.deliveryWindow) || null
  if (has("noteForShop")) out.noteForShop = text(body.noteForShop, params.NOTE_MAX_CHARS)
  if (has("voucherCodes")) out.voucherCodes = math.readCodes(body.voucherCodes)
  if (has("paymentChoice")) out.paymentChoice = ["COD", "ONLINE"].includes(body.paymentChoice) ? body.paymentChoice : null
  if (has("remainingMethod")) out.remainingMethod = body.remainingMethod === "COD" ? "COD" : null
  if (has("source")) out.source = SOURCES.includes(body.source) ? body.source : "KHAC"
  if (has("tags")) {
    out.tags = rules.normalizeTags(body.tags)
    if (out.tags.length > 10) throw new HttpError(422, "VALIDATION_ERROR", "Tối đa 10 thẻ", { fields: { tags: "Tối đa 10 thẻ" } })
  }
  if (has("internalNote")) out.internalNote = text(body.internalNote, 500)
  // Phụ phí giao gấp: chỉ đơn gấp, số nguyên 0 đến URGENT_FEE_MAX
  if (has("urgentFee") && (existing.kind === "DAT_GAP" || body.kind === "DAT_GAP")) {
    const fee = Number(body.urgentFee)
    if (!Number.isInteger(fee) || fee < 0 || fee > params.URGENT_FEE_MAX) {
      throw new HttpError(422, "VALIDATION_ERROR", `Phụ phí giao gấp từ 0 đến ${math.fmt(params.URGENT_FEE_MAX)}`, { fields: { urgentFee: "Phụ phí không hợp lệ" } })
    }
    out.urgentFee = fee
  }
  return { ...existing, ...out }
}

// ===== API-97 tính tiền =====

// Bảng tiền như API-37 cho dữ liệu đơn nháp (đã lưu hoặc đang soạn). Không ném lỗi khi thiếu trường.
async function quoteOf(d) {
  const c = { items: (d.items || []).map((it) => ({ ...it, selected: true })), giftWrap: d.giftWrap || null }
  const view = await cart.buildView(null, c, { persist: false })
  const stockWarnings = view.warnings.filter((w) => w.itemId)
  const owner = d.customerUserId ? await users().findOne({ _id: d.customerUserId }) : null
  const recipientType = d.recipientType === "OTHER" ? "OTHER" : "SELF"
  let money = null
  let options = []
  let vouchers = []
  let voucherErrors = []
  if (view.items.some((it) => !it.warning)) {
    const base = await order.linesFromView(view)
    const r = await order.price(owner && owner.role === "member" ? owner : null, { voucherCodes: d.voucherCodes || [], recipientType, urgentFee: d.urgentFee || 0 }, base, owner)
    money = r.m
    options = r.options
    vouchers = r.applied.map((a) => ({ code: a.voucher.code, name: a.voucher.name, type: a.voucher.type, kind: a.kind, discount: a.discount }))
    voucherErrors = r.errors.map(({ code, message }) => ({ code, message }))
  }
  // Đã thành đơn: tiền và voucher lấy từ đơn đã tạo, không tính lại (mã vừa dùng cho chính đơn này sẽ báo hết lượt)
  const made = d.status === "HOAN_TAT" && d.orderCode ? await database.collection("orders").findOne({ code: d.orderCode }) : null
  if (made) {
    money = {
      subtotal: made.subtotal, personalizationFee: made.personalizationFee || 0, giftWrapFee: made.giftWrapFee || 0, shippingFee: made.shippingFee, urgentFee: made.urgentFee || 0,
      discount: made.discount || 0, total: made.total, hasPersonalized: !!made.hasPersonalizedItems, depositAmount: made.depositAmount || 0, remainingAmount: made.remainingAmount ?? 0,
    }
    vouchers = (made.vouchers || []).map((x) => ({ code: x.code, name: x.code, type: x.type, kind: "", discount: x.discount }))
    voucherErrors = []
  }
  const chosen = math.pickOption(options, d.paymentChoice, d.remainingMethod) || options[0] || null
  const missing = []
  if (!d.customer || !d.customer.fullName || !v.isPhone(d.customer.phone)) missing.push("customer")
  if (!(d.items || []).length) missing.push("items")
  if (!d.shippingAddress || !d.shippingAddress.street || !d.shippingAddress.province) missing.push("shipping")
  return {
    items: view.items.map((it) => ({
      _id: it._id, productId: it.productId, slug: it.slug, name: it.name, image: it.image, variantSku: it.variantSku, variantName: it.variantName,
      quantity: it.quantity, personalization: it.personalization, personalizationTypes: it.personalizationTypes, engrave: it.engrave, hasOptions: it.hasOptions,
      unitPrice: it.unitPrice, personalizationFeePerUnit: it.personalizationFeePerUnit, lineValue: it.lineValue, stock: it.stock, warning: it.warning,
    })),
    giftWrap: view.giftWrap,
    money,
    vouchers,
    voucherErrors,
    paymentOptions: options,
    allowedMethods: options.map((o) => o.key),
    chosenOption: chosen ? chosen.key : null,
    amountDueNow: chosen ? chosen.amountDueNow : null,
    // Nút chính đổi theo phương thức: không phải trả trước thì "Tạo đơn", ngược lại "Gửi liên kết thanh toán" (bước 6, AC2)
    primaryAction: chosen && chosen.amountDueNow > 0 ? "PAYMENT_LINK" : "CREATE_ORDER",
    stockWarnings,
    missing,
    delivery: math.deliveryRange(new Date(), { province: d.shippingAddress?.province || "", personalized: !!money?.hasPersonalized }),
    shippingFee: money ? money.shippingFee : null,
  }
}

async function quote(body) {
  return quoteOf(await readDraft(body || {}))
}

// ===== Danh sách, chi tiết (API-152, API-154) =====

async function list(query) {
  const filter = {}
  if (STATUSES.includes(query.status)) filter.status = query.status
  if (query.kind === "DAT_GAP") filter.kind = "DAT_GAP"
  if (SOURCES.includes(query.source)) filter.source = query.source
  if (query.tag) filter.tags = String(query.tag)
  const q = String(query.q || "").trim()
  if (q) {
    const digits = q.replace(/[\s.#]/g, "")
    filter.$or = [
      { code: { $regex: q.replace(/[^A-Za-z0-9]/g, "").toUpperCase() || "^$" } },
      ...(/^\d{3,11}$/.test(digits) ? [{ "customer.phone": { $regex: digits } }] : []),
      { "customer.fullName": { $regex: accentInsensitivePattern(q), $options: "i" } },
    ]
  }
  // Đồng bộ liên kết hết hạn trước khi đếm (6aEa)
  for (const d of await drafts().find({ status: "DA_GUI_LINK" }).toArray()) await syncLink(d)
  const page = Math.max(1, parseInt(query.page, 10) || 1)
  const [docs, total, countRows] = await Promise.all([
    drafts().find(filter).sort({ updatedAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).toArray(),
    drafts().countDocuments(filter),
    drafts().aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]).toArray(),
  ])
  const counts = { all: 0, MO: 0, DA_GUI_LINK: 0, HOAN_TAT: 0 }
  for (const r of countRows) {
    counts[r._id] = r.n
    counts.all += r.n
  }
  // Đơn gấp chờ nhân viên xem xét
  counts.urgent = await drafts().countDocuments({ kind: "DAT_GAP", status: { $ne: "HOAN_TAT" }, "urgent.status": "CHO_XEM_XET" })
  const ids = docs.map((d) => d.customerUserId).filter(Boolean)
  const orderCounts = new Map(
    (await database.collection("orders").aggregate([{ $match: { userId: { $in: ids } } }, { $group: { _id: "$userId", n: { $sum: 1 } } }]).toArray()).map((r) => [String(r._id), r.n]),
  )
  return {
    items: docs.map((d) => ({
      code: d.code, createdAt: d.createdAt, updatedAt: d.updatedAt, hasNote: !!(d.internalNote || d.noteForShop), status: d.status,
      customer: d.customer ? { ...d.customer, userId: d.customerUserId ? String(d.customerUserId) : null, orderCount: d.customerUserId ? orderCounts.get(String(d.customerUserId)) || 0 : 0 } : null,
      total: d.totalEstimate ?? null, tags: d.tags || [], source: d.source || null, orderCode: d.orderCode || null, primaryAction: d.primaryAction || null,
      kind: d.kind || "THUONG", urgentStatus: d.urgent ? (d.status === "HOAN_TAT" ? "DA_DAT" : d.urgent.status) : null, requestedDate: d.urgent?.requestedDate || null,
    })),
    counts, page, pageSize: PAGE_SIZE, total,
  }
}

function draftView(d) {
  return {
    code: d.code, status: d.status, createdAt: d.createdAt, updatedAt: d.updatedAt,
    customerUserId: d.customerUserId ? String(d.customerUserId) : null, customer: d.customer || null,
    items: d.items || [], giftWrap: d.giftWrap || null, recipientType: d.recipientType || "SELF", shippingAddress: d.shippingAddress || null,
    deliveryDate: d.deliveryDate || null, deliveryWindow: d.deliveryWindow || null, noteForShop: d.noteForShop || "", voucherCodes: d.voucherCodes || [],
    paymentChoice: d.paymentChoice || null, remainingMethod: d.remainingMethod || null, source: d.source || null, tags: d.tags || [], internalNote: d.internalNote || "",
    paymentUrl: d.paymentUrl || null, paymentExpiresAt: d.paymentExpiresAt || null, orderCode: d.orderCode || null, linkExpired: !!d.linkExpired,
    payFailedAt: d.status === "DA_GUI_LINK" ? d.payFailedAt || null : null,
    kind: d.kind || "THUONG", urgentFee: d.urgentFee || 0, urgent: d.urgent ? urgentAdminView(d) : null,
  }
}

// Khối "Đặt gấp" ở SCR đơn nháp
function urgentAdminView(d) {
  const u = d.urgent
  return {
    status: d.status === "HOAN_TAT" ? "DA_DAT" : u.status, requestedDate: u.requestedDate, earliestDate: u.earliestDate,
    conversationId: u.conversationId ? String(u.conversationId) : null, confirmedAt: u.confirmedAt || null, version: u.version || 0,
    rejectReason: u.rejectReason || null, history: (u.history || []).slice(-20),
  }
}

async function get(code) {
  const d = await loadDraft(code)
  const creator = d.createdBy ? await users().findOne({ _id: d.createdBy }, { projection: { fullName: 1 } }) : null
  // Mẫu gói quà gốc của khách (đơn gấp), kèm tên và ảnh vật liệu để nhân viên duyệt
  const orig = d.urgent?.originalGiftWrap
  const customerGiftWrap = orig ? (await cart.giftWrapView(orig, new Date(), [])).view : null
  // Liên kết đang gửi (mã giao dịch để vẽ QR, xác nhận tay với cổng giả lập) và tóm tắt đơn đã tạo (mẫu tin nhắn)
  const pay = d.status === "DA_GUI_LINK" && d.paymentId ? await database.collection("payments").findOne({ _id: d.paymentId }, { projection: { code: 1, amount: 1, provider: 1, status: 1 } }) : null
  const made = d.status === "HOAN_TAT" && d.orderCode
    ? await database.collection("orders").findOne({ code: d.orderCode }, { projection: { code: 1, total: 1, paidAmount: 1, remainingAmount: 1, expectedDeliveryDate: 1 } })
    : null
  return {
    draft: {
      ...draftView(d), createdByName: creator?.fullName || null, customerGiftWrap,
      payment: pay ? { code: pay.code, amount: pay.amount, canConfirm: pay.provider === "MOCK" && pay.status === "PENDING" } : null,
      order: made ? { code: made.code, total: made.total, paidAmount: made.paidAmount || 0, remainingAmount: made.remainingAmount ?? Math.max(0, made.total - (made.paidAmount || 0)), expectedDeliveryDate: made.expectedDeliveryDate || null } : null,
    },
    quote: await quoteOf(d),
  }
}

// Ước tính tổng và nút chính lưu kèm để bảng danh sách không phải tính lại
async function withEstimate(d) {
  try {
    const qv = await quoteOf(d)
    return { totalEstimate: qv.money ? qv.money.total : null, primaryAction: qv.primaryAction }
  } catch {
    return { totalEstimate: null, primaryAction: null }
  }
}

// ===== API-153, API-155, API-156 =====

// API-224: chép đơn có sẵn vào đơn nháp mới. Giá tính lại theo hiện tại; dòng không còn bán được thì bỏ qua và báo
async function copyFromOrder(req, code) {
  const o = await database.collection("orders").findOne({ code: String(code || "").toUpperCase() })
  if (!o) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy đơn hàng")
  const { plain } = require("./orderChange")
  const items = []
  const skipped = []
  for (const it of o.items || []) {
    if ((it.fulfillStatus || "BINH_THUONG") === "DA_HOAN_TIEN") continue
    const raw = { productId: String(it.productId), variantSku: it.variantSku, quantity: it.quantity, personalization: plain(it.personalization) || null }
    try {
      const [line] = await readItems([raw])
      const p = await database.collection("products").findOne({ _id: toId(raw.productId) }, { projection: { status: 1, variants: 1 } })
      const variant = p && cart.findVariant(p, line.variantSku)
      if (!p || p.status !== "DANG_HIEN_THI" || !variant || variant.isActive === false || (variant.stock || 0) < 1) throw new Error("ngừng bán")
      items.push(line)
    } catch (err) {
      skipped.push(it.name)
    }
  }
  if (!items.length) throw new HttpError(422, "BUSINESS_RULE", `Không chép được sản phẩm nào: ${skipped.join(", ")} không còn bán`)
  // Gói quà: mẫu gợi ý còn áp dụng thì giữ mẫu, còn lại chép vật liệu như tự tạo; lỗi thì bỏ gói quà
  let giftWrap = null
  const g = o.giftWrap
  if (g) {
    const message = g.message || ""
    const tryWrap = async (x) => readGiftWrap(x).catch(() => null)
    // Đơn đặt trước khi lưu mã mẫu: tìm mẫu gợi ý cùng tên
    const templateId = g.source === "GOI_Y" ? g.templateId || (await database.collection("giftWrapTemplates").findOne({ name: g.name }, { projection: { _id: 1 } }))?._id : null
    giftWrap = templateId ? await tryWrap({ source: "GOI_Y", templateId: String(templateId), message }) : null
    if (!giftWrap && g.paper && g.ribbon && g.card) giftWrap = await tryWrap({ source: "TAO_MOI", name: g.name, custom: { paper: g.paper.code, ribbon: g.ribbon.code, card: g.card.code, message } })
    if (!giftWrap) skipped.push(`gói quà ${g.name}`)
  }
  const owner = o.userId ? await users().findOne({ _id: o.userId, role: "member" }, { projection: { _id: 1 } }) : null
  const a = o.shippingAddress || {}
  const body = {
    ...(owner ? { customerUserId: String(owner._id) } : { customer: { fullName: o.customer?.fullName || "", phone: o.customer?.phone || "", ...(o.customer?.email ? { email: o.customer.email } : {}) } }),
    recipientType: o.recipientType === "OTHER" ? "OTHER" : "SELF",
    shippingAddress: { recipientName: a.recipientName, phone: a.phone, province: a.province, ward: a.ward, street: a.street, noteForShipper: a.noteForShipper || "" },
    noteForShop: o.noteForShop || "",
    internalNote: `Chép từ đơn ${o.code}`,
  }
  const draft = await create(req, body)
  // Dòng sản phẩm, gói quà đã kiểm ở trên: ghi thẳng để không kiểm lại lần 2
  await drafts().updateOne({ code: draft.draft.code }, { $set: { items, giftWrap, updatedAt: new Date() } })
  const fresh = await drafts().findOne({ code: draft.draft.code })
  await drafts().updateOne({ _id: fresh._id }, { $set: await withEstimate(fresh) })
  await writeLog({ adminId: req.user._id, action: "DRAFT_ORDER", targetType: "draftOrders", targetId: fresh._id, after: { code: fresh.code, summary: `chép từ đơn ${o.code}` } })
  return { draftCode: fresh.code, skipped }
}

// API-225: voucher khách của đơn nháp dùng được (công khai, cấp riêng, trong ví), kèm đủ điều kiện theo đơn nháp.
// GET :code đọc bản đã lưu; POST nhận nội dung form đang soạn như API-97 để khớp với khi nhập tay mã
async function vouchersFor(code) {
  return walletOf(await loadDraft(code))
}
async function vouchersForForm(body) {
  return walletOf(await readDraft(body || {}))
}
async function walletOf(d) {
  const owner = d.customerUserId ? await users().findOne({ _id: d.customerUserId }) : null
  const c = { items: (d.items || []).map((it) => ({ ...it, selected: true })), giftWrap: d.giftWrap || null }
  const view = await cart.buildView(null, c, { persist: false })
  const lines = view.items.some((it) => !it.warning) ? (await order.linesFromView(view)).lines : []
  const q = await quoteOf(d)
  const voucherService = require("./voucher")
  const items = await voucherService.walletForCheckout({ user: owner && owner.role === "member" ? owner : null, lines, shippingFee: q.shippingFee || 0 })
  return { items }
}

async function create(req, body) {
  const now = new Date()
  const d = await readDraft(body || {}, { items: [], tags: [], source: "DIEN_THOAI", voucherCodes: [] })
  const seq = await nextSequence("draft")
  const doc = { ...d, code: `D${seq}`, status: "MO", createdBy: req.user._id, updatedBy: req.user._id, createdAt: now, updatedAt: now }
  Object.assign(doc, await withEstimate(doc))
  doc._id = (await drafts().insertOne(doc)).insertedId
  await writeLog({ adminId: req.user._id, action: "DRAFT_ORDER", targetType: "draftOrders", targetId: doc._id, after: { code: doc.code, summary: "tạo đơn nháp" } })
  return get(doc.code)
}

async function update(req, body) {
  const d = await loadDraft(body.code)
  if (d.status === "HOAN_TAT") throw new HttpError(409, "DRAFT_COMPLETED", "Đơn nháp đã thành đơn hàng, không sửa được")
  const now = new Date()
  const { code, ...rest } = body
  delete rest.kind
  delete rest.urgent
  if (d.kind === "DAT_GAP" && ["TU_CHOI", "KHACH_HUY"].includes(d.urgent?.status)) throw new HttpError(409, "URGENT_CLOSED", "Yêu cầu đặt gấp đã đóng, không sửa được")
  const next = await readDraft(rest, d)
  // Đơn gấp gắn với khách gửi yêu cầu (hội thoại, tài khoản): không đổi khách
  if (d.kind === "DAT_GAP" && "customer" in next && next.customer?.phone !== d.customer?.phone) {
    throw new HttpError(422, "BUSINESS_RULE", "Yêu cầu đặt gấp gắn với khách đã gửi, không đổi khách được", { fields: { customer: "Không đổi khách của đơn gấp" } })
  }
  const set = { ...next, updatedBy: req.user._id, updatedAt: now }
  // Đơn gấp đã chốt mà nhân viên sửa: tự mở lại, khách thấy "Shop đang cập nhật" tới khi chốt lại
  let reopened = false
  if (d.kind === "DAT_GAP" && d.urgent?.status === "DA_CHOT") {
    set["urgent.status"] = "CHO_XEM_XET"
    reopened = true
  }
  // 1a: sửa đơn nháp đã gửi liên kết thì liên kết cũ bị hủy
  if (d.status === "DA_GUI_LINK") {
    await payment.cancelPending(d.paymentId)
    Object.assign(set, { status: "MO", paymentId: null, paymentUrl: null, paymentExpiresAt: null, payFailedAt: null })
  }
  delete set._id
  delete set.linkExpired
  delete set.urgent
  Object.assign(set, await withEstimate({ ...d, ...set }))
  await drafts().updateOne({ _id: d._id, status: { $ne: "HOAN_TAT" } }, { $set: set })
  if (reopened) await require("./urgentOrders").onReopened(d, req.user)
  return get(d.code)
}

async function remove(req, code) {
  const d = await loadDraft(code)
  if (d.kind === "DAT_GAP") throw new HttpError(409, "URGENT_DRAFT", "Yêu cầu đặt gấp không xóa được, hãy bấm Từ chối kèm lý do")
  if (d.status === "HOAN_TAT") throw new HttpError(409, "DRAFT_COMPLETED", "Đơn nháp đã thành đơn hàng, chỉ xem được")
  if (d.status === "DA_GUI_LINK") await payment.cancelPending(d.paymentId)
  await drafts().deleteOne({ _id: d._id, status: { $ne: "HOAN_TAT" } })
  await writeLog({ adminId: req.user._id, action: "DRAFT_ORDER", targetType: "draftOrders", targetId: d._id, before: { code: d.code, status: d.status }, after: { summary: "xóa đơn nháp" } })
}

// ===== API-157 hoàn tất =====

// Kiểm tra đủ như khách tự đặt (bước 7) và dựng bản chụp đơn cho order.place
// staff: nhân viên hoàn tất đơn nháp; null khi khách tự thanh toán đơn gấp đã chốt
async function prepare(d, staff) {
  const fields = {}
  if (!d.customer || !d.customer.fullName || !v.isPhone(d.customer.phone)) fields.customer = "Chọn khách hoặc nhập họ tên, số điện thoại"
  if (!(d.items || []).length) fields.items = "Thêm ít nhất 1 sản phẩm"
  if (!d.shippingAddress) fields.shipping = "Thêm thông tin giao hàng"
  // 6Ea: thiếu khách, sản phẩm hoặc giao hàng
  if (Object.keys(fields).length) throw new HttpError(422, "DRAFT_INCOMPLETE", Object.values(fields)[0], { fields })
  const recipientType = d.recipientType === "OTHER" ? "OTHER" : "SELF"
  const c = { items: d.items.map((it) => ({ ...it, selected: true })), giftWrap: d.giftWrap || null }
  const view = await cart.buildView(null, c, { persist: false })
  const urgent = d.kind === "DAT_GAP"
  const { shippingAddress, noteForShop, expectedDeliveryDate } = order.readShipping(
    { shippingAddress: d.shippingAddress, deliveryDate: d.deliveryDate, deliveryWindow: d.deliveryWindow, noteForShop: d.noteForShop, noteForShipper: d.shippingAddress.noteForShipper },
    recipientType,
    d.customer,
    { personalized: view.items.some((it) => !!it.personalization), urgent },
  )
  // 7Ea: hết hàng tại thời điểm hoàn tất - báo dòng thiếu, không tạo đơn
  const bad = view.items.filter((it) => it.warning)
  if (bad.length) {
    throw new HttpError(409, "OUT_OF_STOCK", `${bad[0].name}: ${bad[0].warning.message}`, { lines: bad.map((it) => ({ itemId: it._id, name: it.name, message: it.warning.message, available: it.stock })) })
  }
  if (view.giftWrap && !view.giftWrap.available) throw new HttpError(409, "GIFT_WRAP_UNAVAILABLE", `Gói quà "${view.giftWrap.name}" tạm hết vật liệu`)
  const owner = d.customerUserId ? await users().findOne({ _id: d.customerUserId }) : await users().findOne({ phone: d.customer.phone })
  if (owner && owner.role !== "member") throw new HttpError(422, "VALIDATION_ERROR", "Số điện thoại thuộc tài khoản nhân viên")
  const base = await order.linesFromView(view)
  const { applied, errors, m, options } = await order.price(owner || null, { voucherCodes: d.voucherCodes || [], recipientType, urgentFee: urgent ? d.urgentFee || 0 : 0 }, base, owner)
  // 7Eb: voucher không còn hợp lệ - báo lỗi, client gỡ mã và tính lại
  if (errors.length) throw new HttpError(409, "VOUCHER_INVALID", `Mã ${errors[0].code}: ${errors[0].message}`, { invalidCodes: errors.map((e) => e.code) })
  const option = math.pickOption(options, d.paymentChoice, d.remainingMethod) || (d.paymentChoice ? null : options[0])
  if (!option) throw new HttpError(422, "BUSINESS_RULE", "Phương thức thanh toán không áp dụng cho đơn này (BR-01 đến BR-05)", { rule: "BR-02" })
  return {
    sessionId: null,
    memberId: owner ? owner._id : null,
    contact: d.customer,
    recipientType,
    shippingAddress,
    noteForShop,
    expectedDeliveryDate,
    sourceAddressId: null,
    setAsDefault: false,
    lines: base.lines,
    giftWrap: base.giftWrap,
    vouchers: applied.map((a) => ({ voucherId: a.voucher._id, code: a.voucher.code, type: a.voucher.type, value: a.voucher.value, discount: a.discount })),
    money: m,
    option,
    policyAcceptedAt: staff ? null : new Date(),
    createdBy: staff ? "ADMIN" : "KHACH",
    source: urgent ? "WEBSITE" : d.source || "KHAC",
    draftCode: d.code,
    ...(urgent ? { urgentCode: d.code } : {}),
    tags: urgent ? rules.normalizeTags(["Đơn gấp", ...(d.tags || [])]) : d.tags || [],
    internalNote: d.internalNote || "",
    staffId: staff ? staff._id : null,
  }
}

async function completeOne(req, d, mode) {
  if (d.status === "HOAN_TAT") throw new HttpError(409, "DRAFT_COMPLETED", "Đơn nháp đã thành đơn hàng")
  // Đơn gấp: nhân viên chỉ chốt, khách tự đặt và thanh toán
  if (d.kind === "DAT_GAP") throw new HttpError(409, "URGENT_DRAFT", "Đơn gấp do khách tự đặt và thanh toán sau khi bạn bấm Chốt đơn gấp")
  const snap = await prepare(d, req.user)
  const due = snap.option.amountDueNow
  if (mode === "CREATE_ORDER") {
    if (due > 0) throw new HttpError(422, "BUSINESS_RULE", "Đơn này cần khách trả trước, hãy gửi liên kết thanh toán", { rule: "BR-02" })
    if (d.status === "DA_GUI_LINK") await payment.cancelPending(d.paymentId)
    const { order: created } = await order.place(snap, { paidAmount: 0 })
    await drafts().updateOne({ _id: d._id }, { $set: { status: "HOAN_TAT", orderCode: created.code, paymentId: null, paymentUrl: null, updatedBy: req.user._id, updatedAt: new Date() } })
    await writeLog({ adminId: req.user._id, action: "DRAFT_ORDER", targetType: "draftOrders", targetId: d._id, after: { code: d.code, orderCode: created.code, summary: "tạo đơn từ đơn nháp" } })
    await writeLog({ adminId: req.user._id, action: "DRAFT_ORDER", targetType: "orders", targetId: created._id, after: { summary: `tạo đơn từ đơn nháp #${d.code}` } })
    return { mode, orderCode: created.code }
  }
  if (mode === "PAYMENT_LINK") {
    if (due <= 0) throw new HttpError(422, "BUSINESS_RULE", "Đơn không cần trả trước, hãy bấm Tạo đơn")
    if (d.status === "DA_GUI_LINK") await payment.cancelPending(d.paymentId)
    const link = await payment.createForDraft(snap, d)
    await drafts().updateOne(
      { _id: d._id },
      { $set: { status: "DA_GUI_LINK", paymentId: new ObjectId(link.paymentId), paymentUrl: link.paymentUrl, paymentExpiresAt: link.expiresAt, payFailedAt: null, updatedBy: req.user._id, updatedAt: new Date() } },
    )
    await writeLog({ adminId: req.user._id, action: "DRAFT_ORDER", targetType: "draftOrders", targetId: d._id, after: { code: d.code, payment: link.code, summary: "gửi liên kết thanh toán" } })
    return { mode, paymentId: link.paymentId, paymentUrl: link.paymentUrl, expiresAt: link.expiresAt, amount: link.amount }
  }
  throw new HttpError(400, "VALIDATION_ERROR", "Chọn Tạo đơn hoặc Gửi liên kết thanh toán")
}

async function complete(req, code, body) {
  return completeOne(req, await loadDraft(code), String(body.mode || ""))
}

// ===== API-193 thao tác hàng loạt (1c) =====

async function bulk(req, body) {
  const codes = [...new Set((Array.isArray(body.codes) ? body.codes : []).map((c) => String(c).replace(/^#/, "").toUpperCase()))]
  if (!codes.length || codes.length > 50) throw new HttpError(422, "VALIDATION_ERROR", "Chọn từ 1 đến 50 đơn nháp")
  const action = String(body.action || "")
  const need = { COMPLETE: "DON_NHAP.KICH_HOAT", RESEND_LINK: "DON_NHAP.KICH_HOAT", ADD_TAGS: "DON_NHAP.SUA", DELETE: "DON_NHAP.XOA" }[action]
  if (!need) throw new HttpError(400, "VALIDATION_ERROR", "Thao tác không hợp lệ")
  if (!canOf(req)(need)) throw new HttpError(403, "FORBIDDEN", "Bạn không có quyền thực hiện thao tác này")
  const tags = action === "ADD_TAGS" ? rules.normalizeTags(body.tags) : []
  if (action === "ADD_TAGS" && !tags.length) throw new HttpError(422, "VALIDATION_ERROR", "Nhập thẻ (1-30 ký tự)")

  const failed = []
  const orders = []
  const links = []
  let updated = 0
  for (const code of codes) {
    let d
    try {
      d = await loadDraft(code)
    } catch {
      failed.push({ code, reason: "Không tìm thấy đơn nháp" })
      continue
    }
    try {
      if (action === "DELETE") await remove(req, d.code)
      else if (action === "ADD_TAGS") {
        if (d.status === "HOAN_TAT") throw new HttpError(409, "DRAFT_COMPLETED", "Đã thành đơn")
        const next = rules.normalizeTags([...(d.tags || []), ...tags])
        if (next.length > 10) throw new HttpError(422, "VALIDATION_ERROR", "Đã đủ 10 thẻ")
        await drafts().updateOne({ _id: d._id }, { $set: { tags: next, updatedAt: new Date() } })
      } else if (action === "COMPLETE") {
        if (d.status !== "MO") throw new HttpError(409, "DRAFT_COMPLETED", d.status === "HOAN_TAT" ? "Đã thành đơn" : "Đã gửi liên kết thanh toán")
        const r = await completeOne(req, d, "CREATE_ORDER")
        orders.push(r.orderCode)
      } else if (action === "RESEND_LINK") {
        if (d.status === "HOAN_TAT") throw new HttpError(409, "DRAFT_COMPLETED", "Đã thành đơn")
        const r = await completeOne(req, d, "PAYMENT_LINK")
        links.push({ code: d.code, paymentUrl: r.paymentUrl, expiresAt: r.expiresAt, amount: r.amount })
      }
      updated += 1
    } catch (err) {
      if (!(err instanceof HttpError)) throw err
      // Lý do ngắn gọn cho từng đơn nháp bị bỏ qua (AC6)
      const reason =
        err.code === "DRAFT_INCOMPLETE" ? ({ customer: "Thiếu thông tin khách", items: "Thiếu sản phẩm", shipping: "Thiếu thông tin giao hàng" }[Object.keys(err.extra?.fields || {})[0]] || err.message)
          : err.code === "BUSINESS_RULE" && action === "COMPLETE" ? "Cần gửi liên kết thanh toán"
            : err.code === "OUT_OF_STOCK" ? `Hết hàng: ${err.message}`
              : err.message
      failed.push({ code: d.code, reason })
    }
  }
  await writeLog({ adminId: req.user._id, action: "BULK_ACTION", targetType: "draftOrders", after: { action, targetIds: codes, orders, failed } })
  return { updated, failed, orders, links }
}

module.exports = { list, get, quote, create, update, remove, complete, bulk, syncLink, loadDraft, prepare, quoteOf, readDraft, withEstimate, draftView, copyFromOrder, vouchersFor, vouchersForForm }
