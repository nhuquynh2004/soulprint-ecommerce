// Tư vấn quà bằng AI (UC-DIS-05, 07 Mục 2.4): API-59 gợi ý / tinh chỉnh, API-198 lượt thử còn lại.
// Phần thuần (đọc khảo sát, rút tag, tinh chỉnh, chip, đếm lượt) ở recommendRules.js; xếp hạng qua adapter
// recommendationEngine.js (Logistic Regression, dự phòng cosine). Ở đây đọc/ghi CSDL: aiSessions, aiGaps, cookie lượt thử.
const { database, ObjectId } = require("../config/db")
const params = require("../config/params")
const HttpError = require("../utils/httpError")
const rules = require("./recommendRules")
const engines = require("./recommendationEngine")
const { toCard } = require("./productView")
const { basePrice } = require("./pricing")

const sessions = () => database.collection("aiSessions")
const TRIAL_COOKIE = "sp_ai_trial"
const ONE_YEAR = 365 * 24 * 60 * 60 * 1000
const MAX_SESSION_IDS = 30 // số lượt tư vấn nhớ trong phiên Guest để cho tinh chỉnh

const isMember = (req) => !!(req.user && req.user.role === "member")
const toId = (v) => (v && ObjectId.isValid(String(v)) ? new ObjectId(String(v)) : null)
const timeoutMs = () => Number(process.env.AI_TIMEOUT_MS ?? 10000) // NFR-PERF-03: quá 10 giây thì 503

// ===== Lượt thử Guest =====

const usedOf = (req) => rules.usedTrials(req.cookies && req.cookies[TRIAL_COOKIE], req.session && req.session.aiTrials)
const quotaFor = (req) => rules.quotaOf(isMember(req), usedOf(req), params.GUEST_AI_TRIALS)

// Chỉ trừ lượt sau khi xếp hạng thành công (6Eb: lỗi máy chủ không trừ lượt)
function consumeTrial(req, res) {
  const used = usedOf(req) + 1
  req.session.aiTrials = used
  res.cookie(TRIAL_COOKIE, String(used), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: ONE_YEAR })
}

function rememberSession(req, id) {
  const list = (req.session.aiSessionIds || []).filter((x) => x !== String(id))
  req.session.aiSessionIds = [String(id), ...list].slice(0, MAX_SESSION_IDS)
}

// Lượt tư vấn thuộc người gọi: Member chủ lượt, hoặc cùng phiên trình duyệt
function owns(req, doc) {
  if (!doc) return false
  if (doc.userId && req.user && String(doc.userId) === String(req.user._id)) return true
  if (doc.sessionId && doc.sessionId === req.sessionID) return true
  return (req.session.aiSessionIds || []).includes(String(doc._id))
}

// ===== Xếp hạng =====

function withTimeout(work, ms) {
  let timer
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(busy()), ms)
  })
  return Promise.race([work, limit]).finally(() => clearTimeout(timer))
}

const busy = () => new HttpError(503, "AI_BUSY", "Trợ lý AI đang bận. Bạn thử lại hoặc dùng bộ lọc nâng cao nhé")

// Lỗi bất ngờ khi xếp hạng cũng trả 503 để khách có lối đi tiếp (6Eb)
async function rank(criteria, catalog) {
  const eng = engines.engine()
  const started = Date.now()
  try {
    const out = eng.recommend(criteria, catalog.items, catalog.tagInfo)
    return { ...out, engine: eng.code, modelVersion: eng.modelVersion, tookMs: Date.now() - started }
  } catch (err) {
    console.error("[AI] Lỗi xếp hạng:", err)
    throw busy()
  }
}

// Đọc catalog cũng tính vào giới hạn 10 giây (NFR-PERF-03)
const loadCatalog = () => withTimeout(engines.loadCatalogFromDb(database), timeoutMs())

// Thẻ sản phẩm cho SCR-10: thẻ chung + biến thể mặc định để thêm thẳng vào giỏ (1 biến thể) hoặc mở SCR-03
function cardOf(item, now) {
  const p = item.doc
  const active = (p.variants || []).filter((v) => v.isActive !== false)
  const single = active.length === 1 ? active[0] : null
  return {
    ...toCard(p, now),
    defaultVariantSku: single && single.stock > 0 ? single.sku : null,
    needsOptions: !single,
  }
}

function present(doc, out, criteria, catalog, extra) {
  const now = new Date()
  return {
    sessionId: String(doc._id),
    summary: rules.summaryOf(criteria, catalog.tagInfo),
    input: rules.toInput(criteria, catalog.tagInfo),
    criteria: rules.chipsOf(criteria, catalog.tagInfo),
    results: out.results.map((r) => ({ product: cardOf(r.item, now), score: r.score, reasons: r.reasons, overBudget: r.overBudget })),
    combos: out.combos.map((c) => {
      const products = c.items.map((it) => cardOf(it, now))
      return { name: c.name, products, total: c.total, overBudget: c.overBudget, reasons: c.reasons, canAddAll: products.every((p) => !!p.defaultVariantSku) }
    }),
    matchedAll: out.matchedAll,
    relaxSuggestions: out.relaxSuggestions.map((s) => ({ label: s.label, input: rules.toInput(s.criteria, catalog.tagInfo) })),
    notes: extra.notes,
    quota: extra.quota,
  }
}

// Phần lưu vào aiSessions (06 Mục 5.1)
const stored = (out, criteria, catalog) => ({
  criteria: rules.toInput(criteria, catalog.tagInfo),
  extractedTags: criteria.noteTags || [],
  engine: out.engine,
  modelVersion: out.modelVersion,
  results: out.results.map((r) => ({ productId: new ObjectId(r.item.id), score: r.score, reasons: r.reasons, overBudget: r.overBudget })),
  combos: out.combos.map((c) => ({ name: c.name, productIds: c.items.map((it) => new ObjectId(it.id)), total: c.total, overBudget: c.overBudget })),
  matchedAll: out.matchedAll,
  tookMs: out.tookMs,
})

// AC4: không khớp đủ thì tăng aiGaps.count theo khóa nhu cầu (SCR-44 "Nhu cầu chưa đáp ứng").
// Nhu cầu đã xử lý mà khách lại tìm nghĩa là vẫn chưa đáp ứng: trở về MOI
async function recordGap(criteria, catalog) {
  const now = new Date()
  await database.collection("aiGaps").updateOne(
    { criteriaKey: rules.gapKeyOf(criteria, catalog.tagInfo) },
    { $inc: { count: 1 }, $set: { status: "MOI", lastSeenAt: now, sampleInput: criteria.note || rules.summaryOf(criteria, catalog.tagInfo) }, $setOnInsert: { createdAt: now } },
    { upsert: true },
  )
}

const CRITERIA_FIELDS = ["recipient", "occasions", "hobbies", "personalities", "noteTags", "ageMin", "ageMax", "budgetMin", "budgetMax", "note", "preferPersonalized"]
const hasCriteriaFields = (body) => CRITERIA_FIELDS.some((f) => Object.prototype.hasOwnProperty.call(body, f))

// API-59 POST /api/recommendations
async function recommend(req, res) {
  const body = req.body || {}
  const catalog = await loadCatalog()
  if (body.sessionId != null) return refine(req, body, catalog)

  let criteria = rules.readCriteria(body, catalog.tagInfo)
  if (!rules.hasAnyField(criteria)) throw new HttpError(400, "VALIDATION_ERROR", "Bạn cần nhập ít nhất một thông tin")
  const quota = quotaFor(req)
  if (!quota.member && quota.remaining <= 0) {
    throw new HttpError(429, "QUOTA_EXCEEDED", `Bạn đã dùng hết ${params.GUEST_AI_TRIALS} lượt thử. Đăng nhập để dùng Sâu Béo không giới hạn, hoàn toàn miễn phí.`, { quota })
  }
  const noted = rules.applyNote(criteria, catalog.tagInfo)
  criteria = noted.criteria
  const out = await withTimeout(rank(criteria, catalog), timeoutMs())

  const now = new Date()
  const doc = {
    userId: isMember(req) ? req.user._id : null,
    sessionId: req.sessionID, // phiên được lưu vì ghi aiTrials / aiSessionIds ngay dưới
    input: rules.toInput(rules.readCriteria(body, catalog.tagInfo), catalog.tagInfo),
    ...stored(out, criteria, catalog),
    clickedProductIds: [],
    orderCodes: [],
    refinements: [],
    createdAt: now,
    updatedAt: now,
  }
  if (!quota.member) consumeTrial(req, res)
  doc._id = (await sessions().insertOne(doc)).insertedId
  rememberSession(req, doc._id)
  if (!out.matchedAll) await recordGap(criteria, catalog)
  return present(doc, out, criteria, catalog, { notes: noted.notes, quota: quotaFor(req) })
}

// 8a, 8c: tinh chỉnh cùng lượt tư vấn, không trừ lượt
async function refine(req, body, catalog) {
  const id = toId(body.sessionId)
  const doc = id ? await sessions().findOne({ _id: id }) : null
  if (!owns(req, doc)) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy lượt tư vấn")
  const text = typeof body.refineText === "string" ? body.refineText.trim() : ""
  let criteria
  if (hasCriteriaFields(body)) {
    criteria = rules.readCriteria(body, catalog.tagInfo)
    if (!rules.hasAnyField(criteria) && !text) throw new HttpError(400, "VALIDATION_ERROR", "Bạn cần nhập ít nhất một thông tin")
  } else {
    if (!text) throw new HttpError(400, "VALIDATION_ERROR", "Bạn hãy nhập điều muốn tinh chỉnh")
    criteria = rules.fromInput(doc.criteria || doc.input || {}, catalog.tagInfo)
  }
  const noted = rules.applyNote(criteria, catalog.tagInfo)
  criteria = noted.criteria
  const notes = [...noted.notes]
  if (text) {
    const prices = (doc.results || []).map((r) => catalog.items.find((it) => it.id === String(r.productId))?.price).filter(Boolean)
    const r = rules.applyRefine(criteria, text, catalog.tagInfo, { maxPrice: prices.length ? Math.max(...prices) : null })
    if (r.understood) criteria = r.criteria
    else notes.push(rules.REFINE_NOT_UNDERSTOOD)
  }
  const out = await withTimeout(rank(criteria, catalog), timeoutMs())
  const before = rules.gapKeyOf(rules.fromInput(doc.criteria || {}, catalog.tagInfo), catalog.tagInfo)
  const now = new Date()
  await sessions().updateOne(
    { _id: doc._id },
    { $set: { ...stored(out, criteria, catalog), updatedAt: now }, $push: { refinements: { text: text || "Sửa tiêu chí", at: now } } },
  )
  if (!out.matchedAll && rules.gapKeyOf(criteria, catalog.tagInfo) !== before) await recordGap(criteria, catalog)
  return present(doc, out, criteria, catalog, { notes, quota: quotaFor(req) })
}

// API-32: lượt tư vấn hợp lệ cho dòng giỏ - thuộc người gọi và có sản phẩm trong kết quả hoặc combo
async function ownedSessionFor(req, aiSessionId, productId) {
  const id = toId(aiSessionId)
  const doc = id ? await sessions().findOne({ _id: id }, { projection: { userId: 1, sessionId: 1, results: 1, combos: 1 } }) : null
  if (!owns(req, doc)) return null
  const pid = String(productId)
  const listed = (doc.results || []).some((r) => String(r.productId) === pid) || (doc.combos || []).some((c) => (c.productIds || []).some((x) => String(x) === pid))
  return listed ? String(doc._id) : null
}

async function recordClick(aiSessionId, productId) {
  await sessions().updateOne({ _id: new ObjectId(aiSessionId) }, { $addToSet: { clickedProductIds: new ObjectId(String(productId)) } })
}

// Đầu trên thanh Ngân sách SCR-10 (API-198): giá cao nhất của sản phẩm được gợi ý, làm tròn lên 100.000đ, tối thiểu 1.000.000đ.
// Đọc mỗi lần mở form nên sản phẩm mới đắt hơn tự nới thanh kéo.
async function budgetMax() {
  const now = new Date()
  const docs = await database.collection("products").find(engines.ELIGIBLE).toArray()
  const top = Math.max(0, ...docs.map((p) => basePrice(p, now) + Math.max(0, ...(p.variants || []).map((v) => v.priceDelta || 0))))
  return Math.max(1000000, Math.ceil(top / 100000) * 100000)
}

module.exports = { recommend, quotaFor, budgetMax, ownedSessionFor, recordClick, TRIAL_COOKIE }
