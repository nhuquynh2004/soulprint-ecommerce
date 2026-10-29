// Luồng gợi ý của UC-DIS-05 bước 6 (hàm thuần, dùng chung cho server và script đánh giá):
// chấm điểm -> lọc theo ngân sách -> lấy 3-5 món -> lý do -> combo -> khớp đủ tiêu chí (matchedAll) -> gợi ý nới tiêu chí.
// Hàm chấm điểm (scorer) do engine truyền vào: Logistic Regression hoặc cosine dự phòng (services/recommendationEngine.js).
//
// Khóa tag có dạng "NHOM:slug" (VD "SO_THICH:bong-da"); tagInfo: Map khóa -> { name, group }.
const { inBudget, hasBudget, hasAge, ageOverlap } = require("./features")
const { cosineSets } = require("./metrics")

const MAX_RESULTS = 5
const MIN_RESULTS = 3
const COMBO_BUDGET_FACTOR = 1.2 // Combo vượt ngân sách tối đa 20%
const COMBO_POOL = 8

const list = (v) => (Array.isArray(v) ? v : [])
const fmt = (n) => String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "đ"
const lower = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s)

function budgetText(c) {
  const min = c.budgetMin || 0
  if (min > 0 && c.budgetMax != null) return `${fmt(min)} - ${fmt(c.budgetMax)}`
  if (c.budgetMax != null) return `dưới ${fmt(c.budgetMax)}`
  if (min > 0) return `từ ${fmt(min)}`
  return ""
}

function ageText(c) {
  if (c.ageMin != null && c.ageMax != null) return `${c.ageMin} - ${c.ageMax >= 40 ? "40+" : c.ageMax} tuổi`
  if (c.ageMin != null) return `từ ${c.ageMin} tuổi`
  if (c.ageMax != null) return `dưới ${c.ageMax} tuổi`
  return ""
}

// Mọi tag khách đã chọn hoặc rút từ mô tả
const criteriaTags = (c) => [...(c.recipient ? [c.recipient] : []), ...list(c.occasions), ...list(c.hobbies), ...list(c.personalities), ...list(c.noteTags)]

const tagSetOf = (item) => item.tagSet || (item.tagSet = new Set(item.tags))
const anyIn = (keys, set) => !keys.length || keys.some((k) => set.has(k))

// Khớp đủ mọi tiêu chí (6Ea): mỗi nhóm đã chọn có ít nhất 1 tag trùng, độ tuổi giao nhau, giá trong ngân sách
function fullMatch(c, item, { ignoreBudget = false } = {}) {
  const tags = tagSetOf(item)
  if (c.recipient && !tags.has(c.recipient)) return false
  for (const g of [c.occasions, c.hobbies, c.personalities, c.noteTags]) if (!anyIn(list(g), tags)) return false
  if (hasAge(c) && ageOverlap(c, item) <= 0) return false
  if (!ignoreBudget && !inBudget(item.price, c)) return false
  return true
}

const names = (keys, tagInfo) => keys.map((k) => tagInfo.get(k)?.name).filter(Boolean)
const joinVi = (arr) => (arr.length <= 1 ? arr.join("") : `${arr.slice(0, -1).join(", ")} và ${arr[arr.length - 1]}`)

// Lý do "Vì sao Sâu chọn món này?" - ít nhất 1 dòng
function reasonsFor(c, item, tagInfo, full) {
  const tags = tagSetOf(item)
  const hit = (keys) => list(keys).filter((k) => tags.has(k))
  const out = []
  const occ = names(hit(c.occasions), tagInfo)
  if (occ.length) out.push(`Hợp dịp ${joinVi(occ)}`)
  const hob = names(hit(c.hobbies), tagInfo)
  if (hob.length) out.push(`Đúng sở thích ${joinVi(hob)}`)
  const pers = hit(c.personalities)
  const tinh = names(pers.filter((k) => tagInfo.get(k)?.group !== "PHONG_CACH"), tagInfo)
  const style = names(pers.filter((k) => tagInfo.get(k)?.group === "PHONG_CACH"), tagInfo)
  if (tinh.length) out.push(`Hợp tính ${joinVi(tinh.map(lower))}`)
  if (style.length) out.push(`Hợp phong cách ${joinVi(style.map(lower))}`)
  if (c.recipient && tags.has(c.recipient)) out.push(`Hợp làm quà cho ${lower(tagInfo.get(c.recipient)?.name || "")}`)
  const shown = new Set([...list(c.occasions), ...list(c.hobbies), ...list(c.personalities), c.recipient])
  const note = names(hit(c.noteTags).filter((k) => !shown.has(k)), tagInfo)
  if (note.length) out.push(`Đúng ý bạn mô tả: ${joinVi(note)}`)
  if (hasBudget(c) && inBudget(item.price, c)) out.push(`Trong ngân sách ${budgetText(c)}`)
  if (hasAge(c) && ageOverlap(c, item) >= 0.5) out.push(`Hợp độ tuổi ${ageText(c)}`)
  if (item.personalizable) out.push(c.preferPersonalized ? "Khắc được tên theo ý bạn" : "Cá nhân hóa được cho người nhận")

  if (!full) {
    if (c.budgetMax != null && item.price > c.budgetMax) out.push(`Cao hơn ngân sách ${fmt(item.price - c.budgetMax)}`)
    else if ((c.budgetMin || 0) > item.price) out.push(`Thấp hơn khoảng ngân sách bạn chọn`)
    const missHob = list(c.hobbies).length && !hit(c.hobbies).length ? names(c.hobbies, tagInfo) : []
    if (missHob.length) out.push(`Chưa đúng sở thích ${joinVi(missHob)}`)
    const missOcc = list(c.occasions).length && !hit(c.occasions).length ? names(c.occasions, tagInfo) : []
    if (missOcc.length) out.push(`Chưa đúng dịp ${joinVi(missOcc)}`)
  }
  if (!out.length) out.push(item.rating > 0 ? `Được đánh giá ${item.rating.toFixed(1).replace(".", ",")}/5` : "Món quà được nhiều khách chọn")
  return out
}

// Sắp xếp theo điểm giảm dần; bằng điểm thì món bán nhiều hơn, rồi theo id để kết quả ổn định
const byScore = (a, b) => b.score - a.score || (b.item.sold || 0) - (a.item.sold || 0) || String(a.item.id).localeCompare(String(b.item.id))

// Khoảng cách tới khoảng ngân sách (0 nếu nằm trong)
function budgetGap(c, price) {
  if (c.budgetMax != null && price > c.budgetMax) return price - c.budgetMax
  if ((c.budgetMin || 0) > price) return c.budgetMin - price
  return 0
}

function pickResults(c, scored) {
  const inRange = scored.filter((s) => inBudget(s.item.price, c))
  const top = inRange[0]?.score || 0
  const picked = inRange.slice(0, MAX_RESULTS).filter((s, i) => i < MIN_RESULTS || s.score >= top * 0.5)
  if (picked.length < MIN_RESULTS) {
    // 6Ea: trong ngân sách dưới 3 món thì bổ sung món sát ngân sách nhất: ưu tiên món điểm cao trong khoảng
    // gấp đôi ngân sách, không có thì món có giá gần ngân sách nhất
    const others = scored.filter((s) => !inBudget(s.item.price, c))
    const near = (s) => budgetGap(c, s.item.price) <= Math.max(c.budgetMax || 0, c.budgetMin || 0)
    others.sort((a, b) => Number(near(b)) - Number(near(a)) || (near(a) ? byScore(a, b) : 0) || budgetGap(c, a.item.price) - budgetGap(c, b.item.price) || byScore(a, b))
    picked.push(...others.slice(0, MIN_RESULTS - picked.length))
  }
  return picked
}

// Tag chung để đặt tên combo: ưu tiên tag khách chọn (sở thích trước), rồi tag bất kỳ
function commonTag(a, b, c, tagInfo) {
  const A = tagSetOf(a)
  const B = tagSetOf(b)
  const order = [...list(c.hobbies), ...list(c.occasions), ...list(c.noteTags), ...list(c.personalities)]
  const chosen = order.find((k) => A.has(k) && B.has(k))
  if (chosen) return chosen
  const groupRank = { SO_THICH: 0, CONG_DUNG: 1, DIP_TANG: 2, PHONG_CACH: 3, TINH_CACH: 4 }
  return [...A]
    .filter((k) => B.has(k) && tagInfo.get(k) && groupRank[tagInfo.get(k).group] != null)
    .sort((x, y) => groupRank[tagInfo.get(x).group] - groupRank[tagInfo.get(y).group])[0] || null
}

function pickCombos(c, scored, tagInfo) {
  const limit = c.budgetMax != null ? c.budgetMax * COMBO_BUDGET_FACTOR : Infinity
  const pool = scored.filter((s) => c.budgetMax == null || s.item.price <= c.budgetMax).slice(0, COMBO_POOL)
  const wanted = criteriaTags(c)
  const pairs = []
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i].item
      const b = pool[j].item
      const total = a.price + b.price
      if (total > limit || total < (c.budgetMin || 0)) continue
      const tag = commonTag(a, b, c, tagInfo)
      if (!tag) continue
      // Có tiêu chí thì 2 món phải cùng hợp ít nhất 1 tiêu chí của khách
      if (wanted.length && !wanted.some((k) => tagSetOf(a).has(k) && tagSetOf(b).has(k))) continue
      pairs.push({ a, b, tag, total, score: (pool[i].score + pool[j].score) / 2 })
    }
  }
  pairs.sort((x, y) => y.score - x.score || x.total - y.total)
  // Combo thứ 2: ưu tiên cặp không trùng món nào với combo đầu, không có thì lấy cặp kế tiếp
  const chosen = pairs.slice(0, 1)
  if (pairs.length > 1) {
    const first = [pairs[0].a.id, pairs[0].b.id]
    chosen.push(pairs.slice(1).find((p) => !first.includes(p.a.id) && !first.includes(p.b.id)) || pairs[1])
  }
  return chosen.map((p) => {
    const tagName = tagInfo.get(p.tag)?.name || ""
    const overBudget = c.budgetMax != null && p.total > c.budgetMax
    const reasons = [`Cả 2 món đều hợp ${lower(tagName)}`]
    if (p.a.personalizable && p.b.personalizable) reasons.push("Cả 2 món đều cá nhân hóa được")
    if (overBudget) reasons.push(`Cao hơn ngân sách ${fmt(p.total - c.budgetMax)}`)
    else if (hasBudget(c)) reasons.push(`Tổng trong ngân sách ${budgetText(c)}`)
    return { name: `Bộ quà ${tagName}`, items: [p.a, p.b], total: p.total, overBudget, reasons }
  })
}

// Bỏ 1 tiêu chí khỏi khảo sát (dùng cho gợi ý nới tiêu chí và chip "x")
function withoutCriterion(c, type, value) {
  const n = { ...c, occasions: list(c.occasions), hobbies: list(c.hobbies), personalities: list(c.personalities), noteTags: list(c.noteTags) }
  if (type === "recipient") n.recipient = null
  else if (type === "age") n.ageMin = n.ageMax = null
  else if (type === "budget") n.budgetMin = n.budgetMax = null
  else if (["occasions", "hobbies", "personalities", "noteTags"].includes(type)) n[type] = n[type].filter((k) => k !== value)
  return n
}

// 6Ea: 1-3 gợi ý nới tiêu chí, mỗi gợi ý kèm bộ tiêu chí mới để gửi tinh chỉnh
function relaxSuggestions(c, items, tagInfo) {
  const out = []
  if (c.budgetMax != null) {
    const prices = items.filter((it) => fullMatch(c, it, { ignoreBudget: true }) && it.price > c.budgetMax).map((it) => it.price)
    if (prices.length) {
      const raised = Math.ceil(Math.min(...prices) / 50000) * 50000
      out.push({ label: `Nới ngân sách lên ${fmt(raised)}`, criteria: { ...c, budgetMax: raised } })
    }
  }
  const singles = [
    ...(c.recipient ? [["recipient", c.recipient]] : []),
    ...list(c.occasions).map((k) => ["occasions", k]),
    ...list(c.hobbies).map((k) => ["hobbies", k]),
    ...list(c.personalities).map((k) => ["personalities", k]),
    ...list(c.noteTags).map((k) => ["noteTags", k]),
  ]
  for (const [type, key] of singles) {
    if (out.length >= 3) break
    const n = withoutCriterion(c, type, key)
    if (items.some((it) => fullMatch(n, it))) out.push({ label: `Bỏ tiêu chí ${tagInfo.get(key)?.name || ""}`, criteria: n })
  }
  if (out.length < 3 && hasAge(c)) {
    const n = withoutCriterion(c, "age")
    if (items.some((it) => fullMatch(n, it))) out.push({ label: `Bỏ tiêu chí ${ageText(c)}`, criteria: n })
  }
  return out.slice(0, 3)
}

// items: sản phẩm đã lọc DANG_HIEN_THI, còn hàng, aiEligible. scorer(c, item) -> điểm 0-1
function recommend(c, items, tagInfo, scorer) {
  const scored = items.map((item) => ({ item, score: scorer(c, item) })).sort(byScore)
  const matchedAll = items.some((it) => fullMatch(c, it))
  const results = pickResults(c, scored).map((s) => {
    const full = fullMatch(c, s.item)
    return {
      item: s.item,
      score: Math.round(s.score * 1000) / 1000,
      reasons: reasonsFor(c, s.item, tagInfo, full),
      overBudget: c.budgetMax != null && s.item.price > c.budgetMax,
    }
  })
  return {
    results,
    combos: pickCombos(c, scored, tagInfo),
    matchedAll: matchedAll && results.some((r) => fullMatch(c, r.item)),
    relaxSuggestions: matchedAll ? [] : relaxSuggestions(c, items, tagInfo),
  }
}

// Điểm dự phòng 6Ec: cosine giữa tập tag khảo sát và tập tag sản phẩm
const cosineScorer = (c, item) => cosineSets(criteriaTags(c), tagSetOf(item))

module.exports = { recommend, cosineScorer, fullMatch, reasonsFor, pickCombos, relaxSuggestions, withoutCriterion, criteriaTags, budgetText, ageText, fmt, COMBO_BUDGET_FACTOR }
