// Adapter RecommendationEngine (07 Mục 1.5): recommend(criteria, items, tagInfo) -> {results, combos, matchedAll, relaxSuggestions}.
// - LogisticEngine: đọc hệ số Logistic Regression ở ml/model.json một lần khi khởi động (tạo bằng `npm run train`).
// - CosineEngine: dự phòng khi thiếu hoặc hỏng model.json (6Ec), độ tương đồng cosine trên tag.
// Service gợi ý chỉ gọi `engine()`, không cần biết đang dùng bản nào; aiSessions ghi engine.code và modelVersion.
const fs = require("fs")
const path = require("path")
const ranker = require("../ml/ranker")
const { buildFeatures, normalize, FEATURE_NAMES } = require("../ml/features")
const { predictProba } = require("../ml/logistic")
const { basePrice } = require("./pricing")

const MODEL_PATH = process.env.AI_MODEL_PATH || path.join(__dirname, "..", "ml", "model.json")

// Kiểm tra file mô hình đủ trường và đúng số đặc trưng; sai thì trả null để dùng dự phòng
function parseModel(text) {
  try {
    const m = JSON.parse(text)
    const d = FEATURE_NAMES.length
    const okArray = (a) => Array.isArray(a) && a.length === d && a.every(Number.isFinite)
    if (!okArray(m.weights) || !Number.isFinite(m.bias) || !m.normalizer || !okArray(m.normalizer.mean) || !okArray(m.normalizer.std)) return null
    if (JSON.stringify(m.featureNames) !== JSON.stringify(FEATURE_NAMES)) return null
    return m
  } catch {
    return null
  }
}

function logisticEngine(model) {
  const scorer = (c, item) => predictProba(model, normalize(buildFeatures(c, item), model.normalizer))
  return {
    code: "HOC_MAY",
    modelVersion: model.modelVersion || null,
    recommend: (c, items, tagInfo) => ranker.recommend(c, items, tagInfo, scorer),
  }
}

const cosineEngine = {
  code: "DU_PHONG",
  modelVersion: null,
  recommend: (c, items, tagInfo) => ranker.recommend(c, items, tagInfo, ranker.cosineScorer),
}

function loadEngine(file = MODEL_PATH) {
  let text = null
  try {
    text = fs.readFileSync(file, "utf8")
  } catch {
    console.warn(`[AI] Không có ${path.basename(file)}, tư vấn quà dùng phương án dự phòng cosine (6Ec). Chạy: npm run train`)
    return cosineEngine
  }
  const model = parseModel(text)
  if (!model) {
    console.warn(`[AI] ${path.basename(file)} hỏng hoặc sai cấu trúc, dùng phương án dự phòng cosine (6Ec)`)
    return cosineEngine
  }
  console.log(`[AI] Đã tải mô hình Logistic Regression ${model.modelVersion}`)
  return logisticEngine(model)
}

let current = null
// Engine đang dùng (tải lần đầu khi cần). reload() để test hoặc sau khi train lại.
const engine = () => current || (current = loadEngine())
const reload = (file) => (current = loadEngine(file))

// Sản phẩm document -> item của ml/features.js (khóa tag "NHOM:slug")
function toItem(p, tagKeyById, now = new Date()) {
  return {
    id: String(p._id),
    name: p.name,
    price: basePrice(p, now),
    tags: (p.tagIds || []).map((id) => tagKeyById.get(String(id))).filter(Boolean),
    ageMin: p.ageMin ?? null,
    ageMax: p.ageMax ?? null,
    rating: p.ratingAvg || 0,
    sold: p.soldCount || 0,
    personalizable: !!(p.personalization && p.personalization.allowed),
    axis: p.axis,
    doc: p,
  }
}

// Sản phẩm được gợi ý (bước 6): đang hiển thị, aiEligible khác false, còn ít nhất 1 biến thể đang bán có tồn
const ELIGIBLE = { status: "DANG_HIEN_THI", aiEligible: { $ne: false }, variants: { $elemMatch: { isActive: { $ne: false }, stock: { $gt: 0 } } } }

// Đọc catalog từ MongoDB cho server và cho `train --feedback`
async function loadCatalogFromDb(database) {
  const rules = require("./recommendRules")
  const tags = await database.collection("tags").find({}).toArray()
  const tagInfo = rules.buildTagInfo(tags)
  const tagKeyById = new Map(tags.filter((t) => !t.range).map((t) => [String(t._id), rules.keyOf(t)]))
  const docs = await database.collection("products").find(ELIGIBLE).toArray()
  const now = new Date()
  const items = docs.map((p) => toItem(p, tagKeyById, now))
  return { tagInfo, items, toCriteria: (input) => rules.fromInput(input || {}, tagInfo) }
}

module.exports = { engine, reload, loadEngine, parseModel, cosineEngine, logisticEngine, toItem, loadCatalogFromDb, ELIGIBLE }
