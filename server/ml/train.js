// npm run train (UC-DIS-05): giả lập dữ liệu -> chia train/test 80/20 theo kịch bản (seed cố định)
// -> chuẩn hóa z-score -> Logistic Regression gradient descent có L2 -> đo accuracy, precision, recall, F1 trên tập test
// -> ghi ml/model.json. Không cài gói nào: chỉ dùng Node.
//
// Tùy chọn --feedback: đọc thêm phản hồi thật từ aiSessions (cần server/.env có MONGODB_URI): sản phẩm khách đã thêm giỏ
// (clickedProductIds) là nhãn 1, sản phẩm được gợi ý mà không bấm là nhãn 0 (vòng phản hồi, Chương 5.4.10).
// Chạy: node --env-file=.env ml/train.js --feedback
const fs = require("fs")
const path = require("path")
const { loadSeedCatalog } = require("./catalog")
const { simulate } = require("./simulate")
const { FEATURE_NAMES, buildFeatures, fitNormalizer, normalize } = require("./features")
const { train, predictProba } = require("./logistic")
const { classification } = require("./metrics")
const { createRng } = require("./rng")

const SEED = 2026
const OPTIONS = { learningRate: 0.5, epochs: 1500, l2: 0.001 }
const MODEL_PATH = path.join(__dirname, "model.json")

// Chia theo kịch bản (không theo dòng) để các dòng của cùng 1 khảo sát không nằm ở cả 2 tập
function splitByScenario(rows, scenarioCount, testRatio = 0.2, seed = SEED) {
  const rng = createRng(seed + 1)
  const order = rng.sample([...Array(scenarioCount).keys()], scenarioCount)
  const testSet = new Set(order.slice(0, Math.round(scenarioCount * testRatio)))
  return { train: rows.filter((r) => !testSet.has(r.scenario)), test: rows.filter((r) => testSet.has(r.scenario)) }
}

// Phản hồi thật từ MongoDB (tùy chọn)
async function feedbackRows() {
  const { client, database } = require("../config/db")
  const engine = require("../services/recommendationEngine")
  try {
    const sessions = await database.collection("aiSessions").find({ "clickedProductIds.0": { $exists: true } }).limit(5000).toArray()
    if (!sessions.length) return []
    const { items, toCriteria } = await engine.loadCatalogFromDb(database)
    const byId = new Map(items.map((it) => [String(it.id), it]))
    const rows = []
    for (const s of sessions) {
      const c = toCriteria(s.criteria || s.input || {})
      const clicked = new Set((s.clickedProductIds || []).map(String))
      for (const r of s.results || []) {
        const item = byId.get(String(r.productId))
        if (item) rows.push({ scenario: -1, itemId: item.id, x: buildFeatures(c, item), y: clicked.has(String(r.productId)) ? 1 : 0 })
      }
    }
    return rows
  } finally {
    await client.close()
  }
}

async function main() {
  const started = Date.now()
  const catalog = loadSeedCatalog()
  const sim = simulate(catalog, { scenarios: 600, seed: SEED })
  const { train: trainRows, test: testRows } = splitByScenario(sim.rows, sim.scenarios.length)
  let extra = []
  if (process.argv.includes("--feedback")) {
    extra = await feedbackRows()
    console.log(`Phản hồi thật từ aiSessions: ${extra.length} dòng`)
  }
  const all = [...trainRows, ...extra]
  const norm = fitNormalizer(all.map((r) => r.x))
  const X = all.map((r) => normalize(r.x, norm))
  const y = all.map((r) => r.y)
  const fit = train(X, y, OPTIONS)
  const model = { weights: fit.weights, bias: fit.bias }

  const yTest = testRows.map((r) => r.y)
  const yPred = testRows.map((r) => (predictProba(model, normalize(r.x, norm)) >= 0.5 ? 1 : 0))
  const m = classification(yTest, yPred)
  const round = (v) => Math.round(v * 10000) / 10000

  const out = {
    modelVersion: new Date().toISOString().slice(0, 10),
    trainedAt: new Date().toISOString(),
    algorithm: "LogisticRegression",
    featureNames: FEATURE_NAMES,
    weights: fit.weights.map(round),
    bias: round(fit.bias),
    normalizer: { mean: norm.mean.map(round), std: norm.std.map(round) },
    threshold: 0.5,
    training: { ...OPTIONS, seed: SEED, scenarios: sim.scenarios.length, products: sim.items.length, trainRows: trainRows.length, feedbackRows: extra.length, testRows: testRows.length, positiveRate: round(y.filter(Boolean).length / y.length), finalLoss: round(fit.history[fit.history.length - 1].loss) },
    metrics: { accuracy: round(m.accuracy), precision: round(m.precision), recall: round(m.recall), f1: round(m.f1), confusion: m.confusion },
  }
  fs.writeFileSync(MODEL_PATH, JSON.stringify(out, null, 2) + "\n")

  console.log(`Dữ liệu: ${sim.scenarios.length} kịch bản x ${sim.items.length} sản phẩm; train ${trainRows.length} dòng, test ${testRows.length} dòng, tỷ lệ nhãn 1: ${out.training.positiveRate}`)
  console.log("Log-loss:", fit.history.map((h) => `${h.epoch}:${h.loss.toFixed(4)}`).join(" "))
  console.log("Hệ số:")
  FEATURE_NAMES.forEach((f, j) => console.log(`  ${f.padEnd(22)} ${out.weights[j]}`))
  console.log(`  bias                   ${out.bias}`)
  console.log(`Tập test: accuracy ${out.metrics.accuracy}, precision ${out.metrics.precision}, recall ${out.metrics.recall}, F1 ${out.metrics.f1}`)
  console.log(`Ma trận nhầm lẫn: ${JSON.stringify(m.confusion)}`)
  console.log(`Đã ghi ${path.relative(process.cwd(), MODEL_PATH)} (modelVersion ${out.modelVersion}) trong ${Date.now() - started} ms`)
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}

module.exports = { splitByScenario }
