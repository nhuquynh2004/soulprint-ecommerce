// Cài đặt cửa hàng (07_API_Spec.md Mục 2.16) - UC-CAT-07, BR-35, BR-40. Chỉ vai trò Quản trị (AC4).
// API-144 GET, API-145 PUT; chính sách API-147 PUT (slug trong body); FAQ chatbot API-148 GET, API-149 POST,
// API-150 PUT (_id trong body), API-151 DELETE.
const { database, ObjectId } = require("../config/db")
const params = require("../config/params")
const HttpError = require("../utils/httpError")
const { writeLog } = require("../services/adminLog")
const { sanitizeHtml, textOf } = require("../utils/sanitizeHtml")
const { removeAccents, accentInsensitivePattern } = require("../utils/vnText")
const { VARIABLES, unknownVariables } = require("../services/settings")

const settings = () => database.collection("siteSettings")
const faqs = () => database.collection("faqs")
const toId = (v) => (v && ObjectId.isValid(String(v)) ? new ObjectId(String(v)) : null)
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "")
const FAQ_CATEGORIES = ["VAN_CHUYEN", "THANH_TOAN", "DOI_TRA", "CA_NHAN_HOA", "GOI_QUA", "KHAC"] // GOI_QUA

// Giá trị mặc định khi siteSettings chưa có trường (02 Mục 5)
function withDefaults(doc = {}) {
  return {
    fees: { shippingFee: params.SHIPPING_FEE, depositRate: params.DEPOSIT_RATE, stickerFee: params.STICKER_FEE, ...(doc.fees || {}) },
    payments: { onlineFull: true, depositCod: true, codFull: true, ...(doc.payments || {}) },
    insights: {
      stockoutDays: params.INSIGHT_STOCKOUT_DAYS, expiryDays: params.INSIGHT_EXPIRY_DAYS, abandonedCartDays: params.ABANDONED_CART_DAYS, ...(doc.insights || {}),
    },
    info: {
      storeName: "Soulprint", hotline: "", email: "", returnAddress: "", workingHours: "", ...(doc.info || {}),
      social: { facebook: "", zalo: "", instagram: "", tiktok: "", ...(doc.info?.social || {}) },
    },
  }
}

// Kiểm tra cài đặt sau khi gộp (3Ea, 3Eb). Trả {fields} lỗi theo đường dẫn trường.
function validateSettings(s) {
  const f = {}
  const int = (v) => Number.isInteger(v)
  if (!int(s.fees.shippingFee) || s.fees.shippingFee < 0) f["fees.shippingFee"] = "Phí vận chuyển phải là số nguyên không âm"
  if (!(typeof s.fees.depositRate === "number" && s.fees.depositRate >= 0.1 && s.fees.depositRate <= 1)) f["fees.depositRate"] = "Tỷ lệ cọc từ 10% đến 100%"
  if (!int(s.fees.stickerFee) || s.fees.stickerFee < 0) f["fees.stickerFee"] = "Phí sticker phải là số nguyên không âm"
  for (const k of ["stockoutDays", "expiryDays", "abandonedCartDays"]) {
    if (!int(s.insights[k]) || s.insights[k] < 1 || s.insights[k] > 60) f[`insights.${k}`] = "Ngưỡng từ 1 đến 60 ngày"
  }
  // BR-40: đơn có món cá nhân hóa cần Online 100% hoặc Cọc + COD; đơn không cá nhân hóa cần Online 100% hoặc COD toàn bộ
  const p = s.payments
  if (!(p.onlineFull || p.depositCod) || !(p.onlineFull || p.codFull)) f.payments = "Cần giữ ít nhất 1 phương thức cho mỗi loại đơn"
  if (s.info.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.info.email)) f["info.email"] = "Email không hợp lệ"
  if (!s.info.storeName) f["info.storeName"] = "Nhập tên cửa hàng"
  for (const [k, v] of Object.entries(s.info.social)) if (v && !/^https?:\/\//.test(v)) f[`info.social.${k}`] = "Liên kết cần bắt đầu bằng http:// hoặc https://"
  return f
}

// API-144 GET /api/admin/settings - toàn bộ siteSettings.store kèm danh sách biến dùng cho chính sách/FAQ
async function getSettings(req, res) {
  const doc = await settings().findOne({ key: "store" })
  res.send({ ...withDefaults(doc || {}), variables: VARIABLES, updatedAt: doc?.updatedAt || null })
}

// API-145 PUT /api/admin/settings - {fees?, payments?, insights?, info?}; gửi phần nào sửa phần đó
async function updateSettings(req, res) {
  const doc = (await settings().findOne({ key: "store" })) || {}
  const before = withDefaults(doc)
  const b = req.body || {}
  const num = (v, d) => (v === undefined || v === null || v === "" ? d : Number(v))
  const next = {
    fees: b.fees
      ? { shippingFee: num(b.fees.shippingFee, before.fees.shippingFee), depositRate: num(b.fees.depositRate, before.fees.depositRate), stickerFee: num(b.fees.stickerFee, before.fees.stickerFee) }
      : before.fees,
    payments: b.payments ? Object.fromEntries(Object.keys(before.payments).map((k) => [k, b.payments[k] === undefined ? before.payments[k] : !!b.payments[k]])) : before.payments,
    insights: b.insights ? Object.fromEntries(Object.keys(before.insights).map((k) => [k, num(b.insights[k], before.insights[k])])) : before.insights,
    info: b.info
      ? {
          storeName: str(b.info.storeName ?? before.info.storeName, 60),
          hotline: str(b.info.hotline ?? before.info.hotline, 20),
          email: str(b.info.email ?? before.info.email, 100),
          returnAddress: str(b.info.returnAddress ?? before.info.returnAddress, 200),
          workingHours: str(b.info.workingHours ?? before.info.workingHours, 80),
          social: Object.fromEntries(Object.keys(before.info.social).map((k) => [k, str(b.info.social?.[k] ?? before.info.social[k], 200)])),
        }
      : before.info,
  }
  const fields = validateSettings(next)
  if (Object.keys(fields).length) throw new HttpError(422, "VALIDATION_ERROR", Object.values(fields)[0], { fields, rule: fields.payments ? "BR-40" : undefined })

  await settings().updateOne({ key: "store" }, { $set: { ...next, updatedAt: new Date(), updatedBy: req.user._id } }, { upsert: true })
  const changed = (k) => JSON.stringify(before[k]) !== JSON.stringify(next[k])
  const parts = ["fees", "payments", "insights", "info"].filter(changed)
  await writeLog({
    adminId: req.user._id, action: "SETTINGS_UPDATE", targetType: "siteSettings",
    before: Object.fromEntries(parts.map((k) => [k, before[k]])), after: Object.fromEntries(parts.map((k) => [k, next[k]])),
  })
  const warnings = before.payments.onlineFull && !next.payments.onlineFull ? ["Khách sẽ không chọn được Giao người nhận"] : []
  res.send({ ...next, variables: VARIABLES, warnings })
}

// API-147 PUT /api/admin/policies - {slug, title, content}; lọc HTML, chặn nội dung rỗng và biến không tồn tại (1bEa)
async function updatePolicy(req, res) {
  const existing = await database.collection("policies").findOne({ slug: String(req.body.slug || "") })
  if (!existing) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy trang chính sách")
  const title = str(req.body.title ?? existing.title, 120)
  const content = sanitizeHtml(str(req.body.content ?? existing.content, 50000))
  const fields = {}
  if (!title) fields.title = "Nhập tiêu đề"
  if (!textOf(content)) fields.content = "Nội dung chính sách không được rỗng"
  const unknown = unknownVariables(content)
  if (unknown.length) fields.content = `Biến không tồn tại: ${unknown.map((k) => `{{${k}}}`).join(", ")}`
  if (Object.keys(fields).length) throw new HttpError(422, "VALIDATION_ERROR", Object.values(fields)[0], { fields })
  const updatedAt = new Date()
  await database.collection("policies").updateOne({ _id: existing._id }, { $set: { title, content, updatedAt, updatedBy: req.user._id } })
  await writeLog({ adminId: req.user._id, action: "POLICY_UPDATE", targetType: "policies", targetId: existing._id, before: { title: existing.title }, after: { title } })
  res.send({ slug: existing.slug, title, content, updatedAt })
}

// Danh sách 6 trang chính sách cho tab "Chính sách" (đọc kèm API-144; nội dung lấy bằng API-146 ?raw=true)
async function listPolicies(req, res) {
  res.send(await database.collection("policies").find({}, { projection: { slug: 1, title: 1, sortOrder: 1, updatedAt: 1 } }).sort({ sortOrder: 1 }).toArray())
}

// API-148 GET /api/admin/faqs?category=&q=
async function listFaqs(req, res) {
  const filter = {}
  if (FAQ_CATEGORIES.includes(req.query.category)) filter.category = req.query.category
  const q = String(req.query.q || "").trim()
  if (q) {
    const re = { $regex: accentInsensitivePattern(q), $options: "i" }
    filter.$or = [{ question: re }, { answer: re }, { keywords: re }]
  }
  const list = await faqs().find(filter).sort({ sortOrder: 1, _id: 1 }).toArray()
  res.send(list.map((f) => ({ ...f, hitCount: f.hitCount || 0 })))
}

// Chuẩn hóa FAQ (1cEa); từ khóa lưu dạng không dấu, chữ thường để chatbot so khớp
function normalizeFaq(body, existing = null) {
  const pick = (k, d) => (body[k] !== undefined ? body[k] : existing ? existing[k] : d)
  const keywordsIn = pick("keywords", [])
  const list = Array.isArray(keywordsIn) ? keywordsIn : String(keywordsIn || "").split(",")
  const doc = {
    question: str(pick("question", ""), 200),
    answer: str(pick("answer", ""), 1000),
    keywords: [...new Set(list.map((k) => removeAccents(String(k)).trim().replace(/\s+/g, " ")).filter(Boolean))].slice(0, 20),
    category: FAQ_CATEGORIES.includes(pick("category", "KHAC")) ? pick("category", "KHAC") : "KHAC",
    isActive: !!pick("isActive", true),
  }
  const so = pick("sortOrder", null)
  doc.sortOrder = Number.isInteger(Number(so)) && so !== null && so !== "" ? Number(so) : null
  const fields = {}
  if (!doc.question) fields.question = "Nhập câu hỏi"
  if (!doc.answer) fields.answer = "Nhập câu trả lời"
  if (!doc.keywords.length) fields.keywords = "Nhập ít nhất 1 từ khóa"
  const unknown = unknownVariables(doc.answer)
  if (unknown.length) fields.answer = `Biến không tồn tại: ${unknown.map((k) => `{{${k}}}`).join(", ")}`
  if (Object.keys(fields).length) throw new HttpError(422, "VALIDATION_ERROR", Object.values(fields)[0], { fields })
  return doc
}

// API-149 POST /api/admin/faqs
async function createFaq(req, res) {
  const doc = normalizeFaq(req.body)
  if (doc.sortOrder === null) {
    const last = await faqs().find({}).sort({ sortOrder: -1 }).limit(1).next()
    doc.sortOrder = (last?.sortOrder || 0) + 1
  }
  const now = new Date()
  Object.assign(doc, { hitCount: 0, updatedBy: req.user._id, createdAt: now, updatedAt: now })
  doc._id = (await faqs().insertOne(doc)).insertedId
  await writeLog({ adminId: req.user._id, action: "FAQ_UPDATE", targetType: "faqs", targetId: doc._id, after: { question: doc.question } })
  res.status(201).send(doc)
}

// API-150 PUT /api/admin/faqs - _id trong body, gửi một phần (VD bật/tắt {_id, isActive})
async function updateFaq(req, res) {
  const existing = await faqs().findOne({ _id: toId(req.body._id) })
  if (!existing) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy câu hỏi")
  const doc = normalizeFaq(req.body, existing)
  if (doc.sortOrder === null) doc.sortOrder = existing.sortOrder ?? 0
  await faqs().updateOne({ _id: existing._id }, { $set: { ...doc, updatedBy: req.user._id, updatedAt: new Date() } })
  await writeLog({ adminId: req.user._id, action: "FAQ_UPDATE", targetType: "faqs", targetId: existing._id, before: { question: existing.question, isActive: existing.isActive }, after: { question: doc.question, isActive: doc.isActive } })
  res.send(await faqs().findOne({ _id: existing._id }))
}

// API-151 DELETE /api/admin/faqs/:id
async function deleteFaq(req, res) {
  const f = await faqs().findOne({ _id: toId(req.params["id"]) })
  if (!f) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy câu hỏi")
  await faqs().deleteOne({ _id: f._id })
  await writeLog({ adminId: req.user._id, action: "FAQ_UPDATE", targetType: "faqs", targetId: f._id, before: { question: f.question }, reason: "Xóa câu hỏi" })
  res.status(204).send()
}

module.exports = { getSettings, updateSettings, updatePolicy, listPolicies, listFaqs, createFaq, updateFaq, deleteFaq, validateSettings, withDefaults }
