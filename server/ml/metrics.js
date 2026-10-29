// Độ đo đánh giá mô hình (đề cương Học máy Chương 5): accuracy, precision, recall, F1 cho phân loại;
// Precision@K cho bài toán gợi ý; độ tương đồng cosine dùng cho phương án dự phòng.

function confusion(yTrue, yPred) {
  const m = { tp: 0, fp: 0, tn: 0, fn: 0 }
  yTrue.forEach((t, i) => {
    const p = yPred[i]
    if (t === 1 && p === 1) m.tp++
    else if (t === 0 && p === 1) m.fp++
    else if (t === 0 && p === 0) m.tn++
    else m.fn++
  })
  return m
}

function classification(yTrue, yPred) {
  const m = confusion(yTrue, yPred)
  const total = m.tp + m.fp + m.tn + m.fn
  const precision = m.tp + m.fp ? m.tp / (m.tp + m.fp) : 0
  const recall = m.tp + m.fn ? m.tp / (m.tp + m.fn) : 0
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0
  return { accuracy: total ? (m.tp + m.tn) / total : 0, precision, recall, f1, confusion: m }
}

// Tỷ lệ món phù hợp trong K món đầu (chia cho K, kể cả khi danh sách ngắn hơn K)
function precisionAtK(rankedIds, relevantIds, k = 5) {
  const rel = new Set(relevantIds)
  return rankedIds.slice(0, k).filter((id) => rel.has(id)).length / k
}

// Cosine giữa 2 tập tag (vector nhị phân): |A ∩ B| / sqrt(|A| × |B|)
function cosineSets(a, b) {
  const A = a instanceof Set ? a : new Set(a)
  const B = b instanceof Set ? b : new Set(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const x of A) if (B.has(x)) inter++
  return inter / Math.sqrt(A.size * B.size)
}

module.exports = { confusion, classification, precisionAtK, cosineSets }
