// Đánh giá xếp hạng trên bộ kịch bản viết tay (ml/eval-scenarios.json): Precision@5 của Logistic Regression
// so với dự phòng cosine, cùng luồng lọc ngân sách của server (ml/ranker.js). In bảng kết quả ra màn hình.
// Chạy: node ml/evaluate.js (sau npm run train)
const fs = require("fs")
const path = require("path")
const { loadSeedCatalog } = require("./catalog")
const { recommend, cosineScorer } = require("./ranker")
const { precisionAtK } = require("./metrics")
const { buildFeatures, normalize } = require("./features")
const { predictProba } = require("./logistic")
const rules = require("../services/recommendRules")
const { parseModel } = require("../services/recommendationEngine")

const K = 5
const OUT = path.join(__dirname, "..", "..", "docs", "05-qa", "results", "ml-evaluation.md")

// Thứ hạng đầy đủ để đo P@5: kết quả trả khách (3-5 món) rồi các món còn lại theo điểm
function rankedIds(c, items, tagInfo, scorer) {
  const out = recommend(c, items, tagInfo, scorer)
  const shown = out.results.map((r) => r.item.id)
  const rest = items
    .filter((it) => !shown.includes(it.id) && it.price >= (c.budgetMin || 0) && (c.budgetMax == null || it.price <= c.budgetMax))
    .map((it) => ({ id: it.id, s: scorer(c, it) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.id)
  return { shown, ranked: [...shown, ...rest], matchedAll: out.matchedAll }
}

function evaluate(model) {
  const { items, tagInfo } = loadSeedCatalog()
  const scenarios = JSON.parse(fs.readFileSync(path.join(__dirname, "eval-scenarios.json"), "utf8")).scenarios
  const lr = (c, item) => predictProba(model, normalize(buildFeatures(c, item), model.normalizer))
  const rows = scenarios.map((s) => {
    const c = rules.applyNote(rules.readCriteria(s.input, tagInfo), tagInfo).criteria
    const a = rankedIds(c, items, tagInfo, lr)
    const b = rankedIds(c, items, tagInfo, cosineScorer)
    const ideal = Math.min(K, s.relevant.length) / K // P@5 tối đa khi số món phù hợp < 5
    return { ...s, lr: precisionAtK(a.ranked, s.relevant, K), cos: precisionAtK(b.ranked, s.relevant, K), ideal, lrTop: a.ranked.slice(0, K), cosTop: b.ranked.slice(0, K) }
  })
  const avg = (f) => rows.reduce((t, r) => t + f(r), 0) / rows.length
  return {
    rows,
    lr: avg((r) => r.lr),
    cos: avg((r) => r.cos),
    ideal: avg((r) => r.ideal),
    lrNorm: avg((r) => r.lr / r.ideal),
    cosNorm: avg((r) => r.cos / r.ideal),
    wins: rows.filter((r) => r.lr > r.cos).length,
    ties: rows.filter((r) => r.lr === r.cos).length,
    losses: rows.filter((r) => r.lr < r.cos).length,
  }
}

const pct = (v) => `${(v * 100).toFixed(1).replace(".", ",")}%`
const num = (v) => v.toFixed(4).replace(".", ",")

function report(model, ev) {
  const m = model.metrics
  const t = model.training
  const lines = [
    "# Đánh giá mô hình gợi ý quà (UC-DIS-05)",
    "",
    `Sinh tự động bằng \`node ml/evaluate.js\` ngày ${new Date().toISOString().slice(0, 10)}, mô hình \`ml/model.json\` bản ${model.modelVersion}.`,
    "",
    "## Tổng quan",
    "",
    "- Mô hình: Logistic Regression tự viết (gradient descent có L2), 11 đặc trưng khớp khảo sát và sản phẩm (`server/ml/features.js`).",
    "- Dữ liệu train: giả lập theo quy tắc người mua có nhiễu (`server/ml/simulate.js`), chia train/test 80/20 theo kịch bản, seed cố định.",
    "- Hai cách đo: (1) phân loại phù hợp / không phù hợp trên tập test giả lập; (2) Precision@5 trên 30 kịch bản viết tay, so với phương án dự phòng cosine trên tag.",
    "",
    "## 1. Độ đo trên tập test (giả lập)",
    "",
    `Dữ liệu ${t.scenarios} kịch bản x ${t.products} sản phẩm; train ${t.trainRows} dòng, test ${t.testRows} dòng; tỷ lệ nhãn "phù hợp" ${pct(t.positiveRate)}; ngưỡng 0,5; ${t.epochs} vòng, learning rate ${String(t.learningRate).replace(".", ",")}, L2 ${String(t.l2).replace(".", ",")}.`,
    "",
    "| Độ đo | Giá trị |",
    "|---|---|",
    `| Accuracy | ${num(m.accuracy)} |`,
    `| Precision | ${num(m.precision)} |`,
    `| Recall | ${num(m.recall)} |`,
    `| F1 | ${num(m.f1)} |`,
    "",
    `Ma trận nhầm lẫn: TP ${m.confusion.tp}, FP ${m.confusion.fp}, TN ${m.confusion.tn}, FN ${m.confusion.fn}.`,
    "",
    "Hệ số đã học (trên đặc trưng chuẩn hóa z-score):",
    "",
    "| Đặc trưng | Hệ số |",
    "|---|---|",
    ...model.featureNames.map((f, j) => `| \`${f}\` | ${num(model.weights[j])} |`),
    `| bias | ${num(model.bias)} |`,
    "",
    "## 2. Precision@5 trên 30 kịch bản viết tay",
    "",
    "Cách đo: mỗi kịch bản chạy đúng luồng của server (lọc ngân sách, lấy 3-5 món), thứ hạng đo là các món trả cho khách rồi tới các món còn lại trong ngân sách theo điểm. Precision@5 = số món phù hợp trong 5 món đầu / 5. Kịch bản có dưới 5 món phù hợp thì P@5 tối đa nhỏ hơn 1, nên có thêm cột chuẩn hóa (chia cho mức tối đa).",
    "",
    "| Phương án | Precision@5 trung bình | Chuẩn hóa theo mức tối đa |",
    "|---|---|---|",
    `| Logistic Regression | ${num(ev.lr)} | ${num(ev.lrNorm)} |`,
    `| Cosine trên tag (dự phòng) | ${num(ev.cos)} | ${num(ev.cosNorm)} |`,
    `| Mức tối đa có thể | ${num(ev.ideal)} | 1,0000 |`,
    "",
    `Logistic Regression tốt hơn ở ${ev.wins} kịch bản, bằng ở ${ev.ties}, kém hơn ở ${ev.losses}.`,
    "",
    "| Kịch bản | Mô tả | Món phù hợp | P@5 LR | P@5 cosine | 5 món đầu LR | 5 món đầu cosine |",
    "|---|---|---|---|---|---|---|",
    ...ev.rows.map((r) => `| ${r.id} | ${r.description} | ${r.relevant.length} | ${num(r.lr)} | ${num(r.cos)} | ${r.lrTop.join(", ")} | ${r.cosTop.join(", ")} |`),
    "",
    "## 3. Hạn chế",
    "",
    "- Nhãn train là giả lập theo trọng số do nhóm phát triển đặt (`RULE` trong `simulate.js`); độ đo ở Mục 1 cho thấy mô hình học lại được quy tắc đó, không chứng minh khách thật thích các gợi ý.",
    "- Catalog 60 sản phẩm (57 đủ điều kiện gợi ý); điểm đánh giá và lượt bán lấy từ dataset 1,5 năm do nhóm sinh (`scripts/gen-dataset.js`), không phải số liệu bán hàng thật nên hệ số của 2 đặc trưng này chỉ phản ánh dataset.",
    "- Nhãn \"món phù hợp\" của 30 kịch bản do nhóm phát triển chọn khi đọc catalog, mang tính chủ quan (Quỳnh đã duyệt 20/10/2026); nhiều kịch bản có dưới 5 món phù hợp.",
    "- \"Phù hợp x%\" trên SCR-10 là xác suất của mô hình học từ quy tắc giả lập: món khớp nhiều tiêu chí phụ (dịp, người nhận, ngân sách, độ tuổi) vẫn có thể đạt trên 90% dù chưa đúng sở thích; khảo sát chỉ có 1 tiêu chí cho xác suất thấp. Thứ hạng đáng tin hơn con số tuyệt đối.",
    "- Cosine chỉ dùng tag nên không phân biệt được món trong và ngoài ngân sách ở bước xếp hạng; cả 2 phương án đều qua cùng bước lọc ngân sách nên so sánh công bằng ở phần còn lại.",
    "- Cải tiến: chạy `node --env-file=.env ml/train.js --feedback` sau khi có lượt tư vấn thật để thêm nhãn từ `aiSessions.clickedProductIds` (vòng phản hồi).",
    "",
  ]
  return lines.join("\n")
}

if (require.main === module) {
  const model = parseModel(fs.readFileSync(path.join(__dirname, "model.json"), "utf8"))
  if (!model) {
    console.error("Thiếu hoặc hỏng ml/model.json. Chạy npm run train trước.")
    process.exit(1)
  }
  const ev = evaluate(model)
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, report(model, ev))
  console.log(`Precision@5: Logistic Regression ${ev.lr.toFixed(4)}, cosine ${ev.cos.toFixed(4)} (tối đa ${ev.ideal.toFixed(4)}); LR hơn ${ev.wins}, bằng ${ev.ties}, kém ${ev.losses}`)
  console.log(`Đã ghi ${path.relative(process.cwd(), OUT)}`)
}

module.exports = { evaluate, rankedIds }
