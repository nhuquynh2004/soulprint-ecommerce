// Unit test máy học của UC-DIS-05 (server/ml): đặc trưng, sigmoid, dự đoán, chuẩn hóa, train, độ đo, cosine, luồng xếp hạng.
// Không cần MongoDB: dùng catalog nhỏ viết tay.
const test = require("node:test")
const assert = require("node:assert/strict")
const { buildFeatures, fitNormalizer, normalize, FEATURE_NAMES, ageOverlap } = require("../ml/features")
const { sigmoid, predictProba, train } = require("../ml/logistic")
const { classification, precisionAtK, cosineSets } = require("../ml/metrics")
const ranker = require("../ml/ranker")
const { createRng } = require("../ml/rng")
const { simulate } = require("../ml/simulate")
const { splitByScenario } = require("../ml/train")
const { loadSeedCatalog } = require("../ml/catalog")

const tagInfo = new Map([
  ["DIP_TANG:sinh-nhat", { name: "Sinh nhật", group: "DIP_TANG" }],
  ["DIP_TANG:tot-nghiep", { name: "Tốt nghiệp", group: "DIP_TANG" }],
  ["SO_THICH:bong-da", { name: "Bóng đá", group: "SO_THICH" }],
  ["SO_THICH:anime", { name: "Anime", group: "SO_THICH" }],
  ["SO_THICH:game", { name: "Game", group: "SO_THICH" }],
  ["TINH_CACH:hai-huoc", { name: "Hài hước", group: "TINH_CACH" }],
  ["PHONG_CACH:nang-dong", { name: "Năng động", group: "PHONG_CACH" }],
  ["DOI_TUONG:ban-trai", { name: "Bạn trai", group: "DOI_TUONG" }],
])
const item = (id, price, tags, extra = {}) => ({ id, name: id, price, tags, ageMin: 10, ageMax: 40, rating: 0, sold: 0, personalizable: false, ...extra })
const ITEMS = [
  item("ao-dau", 399000, ["DIP_TANG:sinh-nhat", "SO_THICH:bong-da", "PHONG_CACH:nang-dong", "DOI_TUONG:ban-trai"], { personalizable: true }),
  item("khan", 180000, ["DIP_TANG:sinh-nhat", "SO_THICH:bong-da"]),
  item("bong", 390000, ["SO_THICH:bong-da", "PHONG_CACH:nang-dong"], { personalizable: true }),
  item("ninja", 590000, ["DIP_TANG:sinh-nhat", "SO_THICH:anime", "DOI_TUONG:ban-trai"]),
  item("ly", 190000, ["SO_THICH:anime", "TINH_CACH:hai-huoc"]),
  item("chuot", 399000, ["SO_THICH:game", "DOI_TUONG:ban-trai"]),
]
const crit = (o) => ({ recipient: null, occasions: [], hobbies: [], personalities: [], noteTags: [], ageMin: null, ageMax: null, budgetMin: 0, budgetMax: null, preferPersonalized: false, ...o })
// Điểm đơn giản để test luồng xếp hạng độc lập với model.json: số tiêu chí khớp
const countScorer = (c, it) => ranker.criteriaTags(c).filter((k) => it.tags.includes(k)).length / 10

test("features: tỷ lệ khớp từng nhóm, trong ngân sách, vượt ngân sách", () => {
  const c = crit({ occasions: ["DIP_TANG:sinh-nhat", "DIP_TANG:tot-nghiep"], hobbies: ["SO_THICH:bong-da"], recipient: "DOI_TUONG:ban-trai", budgetMax: 300000 })
  const x = buildFeatures(c, ITEMS[0])
  assert.equal(x.length, FEATURE_NAMES.length)
  assert.equal(x[0], 0.5) // 1/2 dịp
  assert.equal(x[1], 1) // sở thích
  assert.equal(x[3], 1) // người nhận
  assert.equal(x[5], 0) // 399.000đ > 300.000đ
  assert.ok(Math.abs(x[6] - 0.33) < 1e-9) // vượt 33%
  assert.equal(buildFeatures(c, ITEMS[1])[5], 1)
})

test("features: độ tuổi 40 của sản phẩm là 40+, không chọn tiêu chí thì đặc trưng bằng 0", () => {
  assert.equal(ageOverlap(crit({ ageMin: 45, ageMax: 50 }), { ageMin: 18, ageMax: 40 }), 1)
  assert.equal(ageOverlap(crit({ ageMin: 6, ageMax: 8 }), { ageMin: 10, ageMax: 30 }), 0)
  const x = buildFeatures(crit({}), ITEMS[0])
  assert.deepEqual(x.slice(0, 5), [0, 0, 0, 0, 0])
  assert.equal(x[5], 1) // không có ngân sách thì luôn "trong ngân sách"
})

test("sigmoid và dự đoán: sigmoid(0) = 0,5, không tràn số, xác suất tăng theo w·x", () => {
  assert.equal(sigmoid(0), 0.5)
  assert.ok(sigmoid(1000) <= 1 && sigmoid(1000) > 0.999)
  assert.ok(sigmoid(-1000) >= 0 && sigmoid(-1000) < 0.001)
  const model = { weights: [2, -1], bias: 0.5 }
  assert.equal(predictProba(model, [0, 0]), sigmoid(0.5))
  assert.ok(predictProba(model, [1, 0]) > predictProba(model, [0, 1]))
})

test("chuẩn hóa z-score: trung bình 0, độ lệch 1; cột hằng số không chia cho 0", () => {
  const X = [[1, 5], [3, 5], [5, 5]]
  const norm = fitNormalizer(X)
  assert.deepEqual(norm.mean, [3, 5])
  assert.equal(norm.std[1], 1)
  const z = X.map((x) => normalize(x, norm))
  assert.ok(Math.abs(z.reduce((s, r) => s + r[0], 0)) < 1e-9)
  assert.deepEqual(z.map((r) => r[1]), [0, 0, 0])
})

test("train: gradient descent học được dữ liệu tách được, log-loss giảm", () => {
  const rng = createRng(7)
  const X = []
  const y = []
  for (let i = 0; i < 400; i++) {
    const a = rng.next() * 2 - 1
    const b = rng.next() * 2 - 1
    X.push([a, b])
    y.push(a + 0.5 * b > 0 ? 1 : 0)
  }
  const fit = train(X, y, { learningRate: 0.5, epochs: 300, l2: 0 })
  assert.ok(fit.history[fit.history.length - 1].loss < fit.history[0].loss)
  assert.ok(fit.weights[0] > fit.weights[1] && fit.weights[1] > 0)
  const pred = X.map((x) => (predictProba(fit, x) >= 0.5 ? 1 : 0))
  assert.ok(classification(y, pred).accuracy > 0.95)
})

test("độ đo: accuracy, precision, recall, F1 từ ma trận nhầm lẫn", () => {
  const m = classification([1, 1, 1, 0, 0, 0], [1, 1, 0, 1, 0, 0])
  assert.deepEqual(m.confusion, { tp: 2, fp: 1, tn: 2, fn: 1 })
  assert.equal(m.precision, 2 / 3)
  assert.equal(m.recall, 2 / 3)
  assert.ok(Math.abs(m.f1 - 2 / 3) < 1e-12)
  assert.equal(m.accuracy, 4 / 6)
  assert.equal(classification([0, 0], [0, 0]).f1, 0) // không có dự đoán dương
})

test("Precision@5 chia cho 5 kể cả khi danh sách ngắn hơn; cosine trên tập tag", () => {
  assert.equal(precisionAtK(["a", "b", "c", "d", "e", "f"], ["a", "c", "f"], 5), 0.4)
  assert.equal(precisionAtK(["a", "b"], ["a", "b"], 5), 0.4)
  assert.equal(cosineSets(["a", "b"], ["a", "b"]), 1)
  assert.equal(cosineSets(["a"], ["b"]), 0)
  assert.equal(cosineSets(["a", "b"], ["a", "c", "d", "e"]), 1 / Math.sqrt(8))
  assert.equal(cosineSets([], ["a"]), 0)
})

test("AC1: chỉ gợi ý món trong ngân sách khi đủ 3 món, mỗi món có ít nhất 1 lý do", () => {
  const c = crit({ occasions: ["DIP_TANG:sinh-nhat"], hobbies: ["SO_THICH:bong-da"], budgetMax: 400000 })
  const out = ranker.recommend(c, ITEMS, tagInfo, countScorer)
  assert.ok(out.results.length >= 3 && out.results.length <= 5)
  assert.ok(out.results.every((r) => r.item.price <= 400000 && !r.overBudget && r.reasons.length >= 1))
  assert.equal(out.results[0].item.id, "ao-dau")
  assert.ok(out.results[0].reasons.includes("Hợp dịp Sinh nhật"))
  assert.ok(out.results[0].reasons.includes("Đúng sở thích Bóng đá"))
  assert.ok(out.results[0].reasons.includes("Trong ngân sách dưới 400.000đ"))
  assert.equal(out.matchedAll, true)
})

test("6Ea: trong ngân sách dưới 3 món thì bổ sung món sát ngân sách, lý do 'Cao hơn ngân sách', matchedAll false, có gợi ý nới", () => {
  const c = crit({ occasions: ["DIP_TANG:tot-nghiep"], hobbies: ["SO_THICH:anime"], budgetMax: 200000 })
  const out = ranker.recommend(c, ITEMS, tagInfo, countScorer)
  assert.equal(out.matchedAll, false)
  assert.equal(out.results.length, 3)
  const over = out.results.filter((r) => r.overBudget)
  assert.equal(over.length, 1) // chỉ "ly" (190.000đ) và "khan" trong ngân sách
  assert.ok(over[0].reasons.some((x) => x.startsWith("Cao hơn ngân sách")))
  assert.ok(out.relaxSuggestions.length >= 1 && out.relaxSuggestions.length <= 3)
  assert.ok(out.relaxSuggestions.some((s) => s.label === "Bỏ tiêu chí Tốt nghiệp"))
})

test("6Ea: nới ngân sách lên mức giá thấp nhất của món khớp đủ, làm tròn 50.000đ", () => {
  const c = crit({ hobbies: ["SO_THICH:anime"], recipient: "DOI_TUONG:ban-trai", budgetMax: 300000 })
  const s = ranker.relaxSuggestions(c, ITEMS, tagInfo)
  assert.equal(s[0].label, "Nới ngân sách lên 600.000đ")
  assert.equal(s[0].criteria.budgetMax, 600000)
})

test("AC6: combo 2 món, tổng ≤ 120% ngân sách, vượt thì có dòng 'Cao hơn ngân sách'", () => {
  const c = crit({ hobbies: ["SO_THICH:bong-da"], budgetMax: 500000 })
  const out = ranker.recommend(c, ITEMS, tagInfo, countScorer)
  assert.ok(out.combos.length >= 1 && out.combos.length <= 2)
  for (const combo of out.combos) {
    assert.equal(combo.items.length, 2)
    assert.ok(combo.total <= 600000)
    assert.equal(combo.name, "Bộ quà Bóng đá")
    if (combo.total > 500000) assert.ok(combo.overBudget && combo.reasons.some((x) => x.startsWith("Cao hơn ngân sách")))
  }
})

test("combo không ghép 2 món không chung tiêu chí của khách", () => {
  const c = crit({ hobbies: ["SO_THICH:game"], budgetMax: 1000000 })
  assert.equal(ranker.recommend(c, ITEMS, tagInfo, countScorer).combos.length, 0) // chỉ 1 món game
})

test("6Ec: điểm cosine dự phòng xếp món nhiều tag khớp lên trước", () => {
  const c = crit({ occasions: ["DIP_TANG:sinh-nhat"], hobbies: ["SO_THICH:bong-da"] })
  const out = ranker.recommend(c, ITEMS, tagInfo, ranker.cosineScorer)
  assert.equal(out.results[0].item.id, "khan") // 2/2 tag khớp, cosine = 1
})

test("giả lập: seed cố định cho cùng dữ liệu; chia 80/20 theo kịch bản không trùng", () => {
  const catalog = loadSeedCatalog()
  const a = simulate(catalog, { scenarios: 20, seed: 5 })
  const b = simulate(catalog, { scenarios: 20, seed: 5 })
  assert.deepEqual(a.rows.map((r) => r.y), b.rows.map((r) => r.y))
  assert.equal(a.rows.length, 20 * catalog.items.length)
  const split = splitByScenario(a.rows, 20)
  const trainS = new Set(split.train.map((r) => r.scenario))
  assert.ok(split.test.every((r) => !trainS.has(r.scenario)))
  assert.equal(new Set(split.test.map((r) => r.scenario)).size, 4)
})
