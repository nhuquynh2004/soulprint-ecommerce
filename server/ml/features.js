// Đặc trưng của cặp (khảo sát, sản phẩm) cho mô hình Logistic Regression (UC-DIS-05).
// Dùng chung cho script train (dữ liệu giả lập) và server (xếp hạng thật) nên chỉ là hàm thuần.
//
// Khảo sát (criteria): { recipient, occasions[], hobbies[], personalities[], noteTags[], ageMin, ageMax,
//   budgetMin, budgetMax, preferPersonalized } - các tag là "khóa" (chuỗi): server dùng String(tag._id), script dùng slug.
// Sản phẩm (item): { id, name, price (giá hiệu lực), tags[] (khóa), ageMin, ageMax, rating (0-5), sold, personalizable }

const FEATURE_NAMES = [
  "occasionMatch", // tỷ lệ dịp tặng đã chọn có trong tag sản phẩm
  "hobbyMatch", // tỷ lệ sở thích khớp
  "personalityMatch", // tỷ lệ tính cách, phong cách khớp
  "recipientMatch", // 1 nếu sản phẩm hợp người nhận đã chọn
  "noteMatch", // tỷ lệ tag rút từ "Mô tả thêm" khớp
  "inBudget", // 1 nếu giá nằm trong khoảng ngân sách
  "priceOverRatio", // giá vượt ngân sách tối đa bao nhiêu phần (0 nếu không vượt, tối đa 1)
  "ageFit", // phần khoảng tuổi người nhận nằm trong khoảng tuổi phù hợp của sản phẩm
  "rating", // điểm đánh giá / 5; chưa có đánh giá thì lấy mức trung tính 4/5
  "popularity", // log lượt bán, chuẩn về 0-1
  "personalizationWanted", // khách muốn khắc tên và sản phẩm cho cá nhân hóa
]

// Sản phẩm chưa có đánh giá không bị xem là "0 sao" (giống trung bình cộng đồng), tránh kéo điểm của hàng mới xuống
const UNRATED = 4

const list = (v) => (Array.isArray(v) ? v : [])

// Tỷ lệ phần tử của `wanted` có trong tập tag sản phẩm; không chọn gì thì 0 (không ảnh hưởng thứ hạng trong cùng 1 lượt)
function matchRatio(wanted, tagSet) {
  const w = list(wanted)
  if (!w.length) return 0
  return w.filter((k) => tagSet.has(k)).length / w.length
}

const hasBudget = (c) => c.budgetMax != null || (c.budgetMin || 0) > 0
const inBudget = (price, c) => price >= (c.budgetMin || 0) && (c.budgetMax == null || price <= c.budgetMax)
const hasAge = (c) => c.ageMin != null || c.ageMax != null

// Phần khoảng tuổi [ageMin, ageMax] của khảo sát nằm trong khoảng của sản phẩm (tính theo số tuổi nguyên)
function ageOverlap(c, item) {
  const lo = c.ageMin ?? 6
  const hi = c.ageMax ?? 99
  const pLo = item.ageMin ?? 0
  const pHi = item.ageMax ?? 99
  // Sản phẩm ghi 40 là "40+": người nhận lớn hơn 40 vẫn hợp
  const pHiOpen = pHi >= 40 ? 99 : pHi
  const inter = Math.min(hi, pHiOpen) - Math.max(lo, pLo) + 1
  if (inter <= 0) return 0
  return Math.min(1, inter / (Math.min(hi, 60) - lo + 1))
}

function buildFeatures(c, item) {
  const tags = item.tagSet || new Set(item.tags)
  const price = item.price
  return [
    matchRatio(c.occasions, tags),
    matchRatio(c.hobbies, tags),
    matchRatio(c.personalities, tags),
    c.recipient && tags.has(c.recipient) ? 1 : 0,
    matchRatio(c.noteTags, tags),
    inBudget(price, c) ? 1 : 0,
    c.budgetMax ? Math.min(1, Math.max(0, price / c.budgetMax - 1)) : 0,
    hasAge(c) ? ageOverlap(c, item) : 0,
    (item.rating > 0 ? Math.min(5, item.rating) : UNRATED) / 5,
    Math.min(1, Math.log1p(Math.max(0, item.sold || 0)) / Math.log1p(500)),
    c.preferPersonalized && item.personalizable ? 1 : 0,
  ]
}

// Tham số chuẩn hóa z-score (mean, std) tính trên tập train; std = 0 thì dùng 1 để không chia cho 0
function fitNormalizer(X) {
  const n = X.length
  const d = X[0].length
  const mean = new Array(d).fill(0)
  const std = new Array(d).fill(0)
  for (const row of X) for (let j = 0; j < d; j++) mean[j] += row[j] / n
  for (const row of X) for (let j = 0; j < d; j++) std[j] += (row[j] - mean[j]) ** 2 / n
  return { mean, std: std.map((v) => (Math.sqrt(v) > 1e-9 ? Math.sqrt(v) : 1)) }
}

const normalize = (x, norm) => x.map((v, j) => (v - norm.mean[j]) / norm.std[j])

module.exports = { FEATURE_NAMES, buildFeatures, fitNormalizer, normalize, matchRatio, inBudget, hasBudget, hasAge, ageOverlap }
