// Quy tắc thuần của UC-DIS-05 (không đọc CSDL, có unit test): đọc khảo sát, rút tag từ "Mô tả thêm" (bước 5, 5Ea),
// hiểu câu tinh chỉnh (8a), đếm lượt thử Guest (GUEST_AI_TRIALS), câu tóm tắt và chip tiêu chí (bước 7).
// Không dùng mô hình ngôn ngữ: mọi chỗ "hiểu chữ" là so khớp từ khóa không dấu với tên tag và tags.synonyms.
const HttpError = require("../utils/httpError")
const { removeAccents } = require("../utils/vnText")
const { budgetText, ageText, fmt } = require("../ml/ranker")

const AGE_MIN = 6
const AGE_MAX = 40 // 40 trên thanh kéo là "40+"
const NOTE_MAX_CHARS = 500
const REFINE_MAX_CHARS = 200
const CHEAPER_FACTOR = 0.7 // "rẻ hơn" giảm ngân sách 30% (8a)
const PRICIER_FACTOR = 1.3

// Nhóm tag của từng trường khảo sát; "Tính cách" gồm cả nhóm Phong cách
const FIELD_GROUPS = { recipient: ["DOI_TUONG"], occasions: ["DIP_TANG"], hobbies: ["SO_THICH"], personalities: ["TINH_CACH", "PHONG_CACH"] }
const LIST_FIELDS = ["occasions", "hobbies", "personalities"]
// Từ dài trong tên tag Sở thích được khớp riêng (VD "game" khớp "Game PC", "Game mobile")
const PARTIAL_GROUPS = ["SO_THICH"]
const STOP_WORDS = new Set(["tuoi", "nhung", "thich", "choi", "hinh", "theo"])

// Chuẩn hóa để so khớp: bỏ dấu, chữ thường, chỉ giữ chữ và số, có khoảng trắng 2 đầu
const plain = (text) => ` ${removeAccents(text).replace(/[^a-z0-9]+/g, " ").trim()} `

const keyOf = (tag) => `${tag.group}:${tag.slug}`

// tags: danh sách tag từ CSDL hoặc seed -> Map khóa -> {name, group, slug, synonyms}
function buildTagInfo(tags) {
  return new Map(tags.filter((t) => !t.range).map((t) => [keyOf(t), { name: t.name, group: t.group, slug: t.slug, synonyms: t.synonyms || [] }]))
}

const toInt = (v) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Math.round(Number(v)) : NaN)

// Khóa tag theo slug, chỉ trong các nhóm của trường; slug lạ thì bỏ qua (dữ liệu Atlas có thể khác seed)
function resolve(slugs, groups, tagInfo) {
  const out = []
  for (const s of Array.isArray(slugs) ? slugs : []) {
    for (const g of groups) {
      const k = `${g}:${String(s)}`
      if (tagInfo.has(k) && !out.includes(k)) out.push(k)
    }
  }
  return out
}

// Đọc body API-59 thành khảo sát (criteria, khóa "NHOM:slug"). Ném 400 nếu sai kiểu hoặc không có trường nào (3Ea).
function readCriteria(body, tagInfo) {
  const b = body || {}
  const errors = {}
  const recipient = b.recipient && b.recipient !== "khac" ? resolve([b.recipient], FIELD_GROUPS.recipient, tagInfo)[0] || null : null
  const c = {
    recipient,
    otherRecipient: b.recipient === "khac",
    occasions: resolve(b.occasions, FIELD_GROUPS.occasions, tagInfo),
    hobbies: resolve(b.hobbies, FIELD_GROUPS.hobbies, tagInfo),
    personalities: resolve(b.personalities, FIELD_GROUPS.personalities, tagInfo),
    noteTags: Array.isArray(b.noteTags) ? b.noteTags.filter((k) => tagInfo.has(String(k))).map(String) : null,
    ageMin: toInt(b.ageMin),
    ageMax: toInt(b.ageMax),
    budgetMin: toInt(b.budgetMin),
    budgetMax: toInt(b.budgetMax),
    note: typeof b.note === "string" ? b.note.trim() : "",
    preferPersonalized: b.preferPersonalized === true,
  }
  for (const f of ["ageMin", "ageMax"]) {
    if (Number.isNaN(c[f]) || (c[f] != null && (c[f] < AGE_MIN || c[f] > AGE_MAX))) errors[f] = `Độ tuổi trong khoảng ${AGE_MIN} - ${AGE_MAX}+`
  }
  for (const f of ["budgetMin", "budgetMax"]) {
    if (Number.isNaN(c[f]) || (c[f] != null && c[f] < 0)) errors[f] = "Ngân sách không hợp lệ"
  }
  if (c.note.length > NOTE_MAX_CHARS) errors.note = `Mô tả thêm tối đa ${NOTE_MAX_CHARS} ký tự`
  if (Object.keys(errors).length) throw new HttpError(400, "VALIDATION_ERROR", "Thông tin chưa hợp lệ", { fields: errors })
  if (c.ageMin != null && c.ageMax != null && c.ageMin > c.ageMax) [c.ageMin, c.ageMax] = [c.ageMax, c.ageMin]
  if (c.budgetMin != null && c.budgetMax != null && c.budgetMin > c.budgetMax) [c.budgetMin, c.budgetMax] = [c.budgetMax, c.budgetMin]
  c.budgetMin = c.budgetMin || 0
  return c
}

// Có ít nhất 1 thông tin (3Ea). "Khác" ở Người nhận cũng là đã chọn.
const hasAnyField = (c) =>
  !!(c.recipient || c.otherRecipient || c.occasions.length || c.hobbies.length || c.personalities.length || (c.noteTags && c.noteTags.length) ||
    c.ageMin != null || c.ageMax != null || c.budgetMin > 0 || c.budgetMax != null || c.note)

// Số tiền trong câu: "500k", "500 nghìn", "1,2 triệu", "300.000đ"
function readMoney(t) {
  let m = t.match(/ (\d+(?: \d+)?) ?(k|nghin|ngan|tr|trieu|cu) /)
  if (m) {
    const n = Number(m[1].replace(" ", "."))
    return Math.round(n * (["tr", "trieu", "cu"].includes(m[2]) ? 1000000 : 1000))
  }
  m = t.match(/ (\d{1,3}(?: 000)+) ?(d|dong|vnd)? /)
  if (m) return Number(m[1].replace(/ /g, ""))
  return null
}

// Tag nhắc tới trong câu (khóa):
// 1. cụm tên tag hoặc từ đồng nghĩa có trong câu, hoặc đủ mọi từ của tên tag theo thứ tự bất kỳ ("đá bóng" -> Bóng đá);
// 2. nhóm Sở thích khớp thêm theo từ đầu của tên nếu dài từ 4 chữ ("game" -> Game PC, Game mobile; không lấy Board game),
//    trừ khi từ đó đã thuộc tag khớp ở bước 1.
function tagsInText(text, tagInfo) {
  const t = plain(text)
  const words = (s) => plain(s).trim().split(" ").filter(Boolean)
  const found = []
  const covered = new Set()
  for (const [k, info] of tagInfo) {
    const hit = [info.name, ...info.synonyms].some((phrase) => {
      const ws = words(phrase)
      return ws.length && (t.includes(` ${ws.join(" ")} `) || ws.every((w) => t.includes(` ${w} `)))
    })
    if (hit) {
      found.push(k)
      words(info.name).forEach((w) => covered.add(w))
    }
  }
  for (const [k, info] of tagInfo) {
    if (found.includes(k) || !PARTIAL_GROUPS.includes(info.group)) continue
    const head = words(info.name)[0] || ""
    if (head.length >= 4 && !STOP_WORDS.has(head) && !covered.has(head) && t.includes(` ${head} `)) found.push(k)
  }
  return found
}

// Bước 5: rút tag, độ tuổi, ngân sách từ "Mô tả thêm". Không rút được gì thì understood = false (5Ea).
function extractFromNote(note, tagInfo) {
  if (!note) return { tags: [], ageMin: null, ageMax: null, budgetMax: null, understood: true }
  const t = plain(note)
  const tags = tagsInText(note, tagInfo)
  const age = t.match(/ (\d{1,2}) ?tuoi /)
  const n = age ? Math.min(AGE_MAX, Math.max(AGE_MIN, Number(age[1]))) : null
  const budgetMax = readMoney(t)
  return { tags, ageMin: n, ageMax: n, budgetMax, understood: !!(tags.length || n != null || budgetMax != null) }
}

const NOTE_NOT_UNDERSTOOD = "Sâu chưa hiểu phần mô tả thêm, bạn chọn thêm ở các mục bên trên nhé"
const REFINE_NOT_UNDERSTOOD = "Sâu chưa hiểu ý bạn, bạn thử: \"rẻ hơn\", \"thêm [sở thích]\", \"bỏ [tiêu chí]\" hoặc \"khắc tên\" nhé"

// Áp phần rút từ mô tả vào khảo sát: tag chưa có thì thêm vào noteTags; tuổi, ngân sách chỉ dùng khi form để trống
function applyNote(c, tagInfo) {
  const x = { ...c }
  const notes = []
  if (x.noteTags == null) {
    const ex = extractFromNote(x.note, tagInfo)
    const chosen = new Set([x.recipient, ...x.occasions, ...x.hobbies, ...x.personalities])
    x.noteTags = ex.tags.filter((k) => !chosen.has(k))
    if (x.ageMin == null && x.ageMax == null && ex.ageMin != null) {
      x.ageMin = ex.ageMin
      x.ageMax = ex.ageMax
    }
    if (x.budgetMax == null && ex.budgetMax != null) x.budgetMax = ex.budgetMax
    if (!ex.understood) notes.push(NOTE_NOT_UNDERSTOOD)
  }
  return { criteria: x, notes }
}

const round1000 = (n) => Math.round(n / 1000) * 1000

// 8a: hiểu câu tinh chỉnh bằng từ khóa. ctx.maxPrice: giá cao nhất trong kết quả trước (khi chưa đặt ngân sách)
function applyRefine(c, text, tagInfo, ctx = {}) {
  const x = { ...c, occasions: [...c.occasions], hobbies: [...c.hobbies], personalities: [...c.personalities], noteTags: [...(c.noteTags || [])] }
  const t = plain(String(text || "").slice(0, REFINE_MAX_CHARS))
  const actions = []
  if (/ (re hon|gia re|tiet kiem|mem hon|it tien|re thoi|re nhat) /.test(t)) {
    const base = x.budgetMax ?? ctx.maxPrice
    if (base) {
      x.budgetMax = round1000(base * CHEAPER_FACTOR)
      if (x.budgetMin > x.budgetMax) x.budgetMin = 0
      actions.push("cheaper")
    }
  } else if (/ (dat hon|cao cap|xin hon|sang hon|gia cao hon|mac hon) /.test(t)) {
    const base = x.budgetMax ?? ctx.maxPrice
    if (base) {
      x.budgetMin = round1000(base * CHEAPER_FACTOR)
      x.budgetMax = x.budgetMax != null ? round1000(x.budgetMax * PRICIER_FACTOR) : null
      actions.push("pricier")
    }
  }
  if (/ (khac ten|in ten|ca nhan hoa|khac chu|in chu|khac duoc|theu ten) /.test(t)) {
    x.preferPersonalized = true
    actions.push("personalized")
  }
  // "bỏ X", "không cần X": phần sau từ khóa là tiêu chí cần bỏ
  const cut = t.match(/ (bo|khong can|khong muon|khong lay|tru) (.+)$/)
  const removeKeys = cut ? tagsInText(cut[2], tagInfo) : []
  const addText = cut ? t.slice(0, t.indexOf(cut[0])) : t
  for (const k of removeKeys) {
    if (x.recipient === k) x.recipient = null
    for (const f of [...LIST_FIELDS, "noteTags"]) x[f] = x[f].filter((v) => v !== k)
    actions.push(`remove:${k}`)
  }
  for (const k of tagsInText(addText, tagInfo)) {
    const g = tagInfo.get(k).group
    if (g === "DOI_TUONG") x.recipient = k
    else {
      const field = LIST_FIELDS.find((f) => FIELD_GROUPS[f].includes(g)) || "noteTags"
      if (!x[field].includes(k)) x[field].push(k)
    }
    actions.push(`add:${k}`)
  }
  const age = t.match(/ (\d{1,2}) ?tuoi /)
  if (age) {
    x.ageMin = x.ageMax = Math.min(AGE_MAX, Math.max(AGE_MIN, Number(age[1])))
    actions.push("age")
  }
  return { criteria: x, understood: actions.length > 0, actions }
}

// ===== Lượt thử Guest: cookie sp_ai_trial + session, lấy số lớn hơn =====

function usedTrials(cookieValue, sessionValue) {
  const fromCookie = Number.parseInt(cookieValue, 10)
  return Math.max(Number.isFinite(fromCookie) && fromCookie > 0 ? fromCookie : 0, Number(sessionValue) > 0 ? Number(sessionValue) : 0)
}

const quotaOf = (isMember, used, limit) => (isMember ? { member: true, limit: null, remaining: null } : { member: false, limit, remaining: Math.max(0, limit - used) })

// ===== Bước 7: tóm tắt, chip tiêu chí =====

const nameOf = (k, tagInfo) => tagInfo.get(k)?.name || ""
const low = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s)
const joinVi = (arr) => (arr.length <= 1 ? arr.join("") : `${arr.slice(0, -1).join(", ")} và ${arr[arr.length - 1]}`)

// VD "Tìm quà sinh nhật cho bạn trai mê bóng đá và anime manga, tầm 200.000đ - 600.000đ"
function summaryOf(c, tagInfo) {
  let s = "Tìm quà"
  if (c.occasions.length) s += " " + joinVi(c.occasions.map((k) => low(nameOf(k, tagInfo))))
  if (c.recipient) s += " cho " + low(nameOf(c.recipient, tagInfo))
  const likes = [...c.hobbies, ...(c.noteTags || []).filter((k) => tagInfo.get(k)?.group === "SO_THICH")]
  if (likes.length) s += (c.recipient ? " mê " : " cho người mê ") + joinVi(likes.map((k) => low(nameOf(k, tagInfo))))
  if (c.personalities.length) s += ", " + joinVi(c.personalities.map((k) => low(nameOf(k, tagInfo))))
  if (c.ageMin != null || c.ageMax != null) s += ", " + ageText(c)
  const b = budgetText(c)
  if (b) s += ", " + (b.startsWith("dưới") || b.startsWith("từ") ? b : "tầm " + b)
  if (s === "Tìm quà") s += c.note ? " theo mô tả của bạn" : " phù hợp"
  return s
}

// Chip "Sâu đã hiểu": mỗi chip bấm "x" để bỏ (8c)
function chipsOf(c, tagInfo) {
  const chips = []
  if (c.recipient) chips.push({ key: `recipient:${c.recipient}`, type: "recipient", value: c.recipient, label: nameOf(c.recipient, tagInfo) })
  for (const [type, f] of [["occasions", "occasions"], ["hobbies", "hobbies"], ["personalities", "personalities"], ["noteTags", "noteTags"]]) {
    for (const k of c[f] || []) chips.push({ key: `${type}:${k}`, type, value: k, label: nameOf(k, tagInfo) })
  }
  if (c.ageMin != null || c.ageMax != null) chips.push({ key: "age", type: "age", value: null, label: ageText(c).replace(/^./, (m) => m.toUpperCase()) })
  const b = budgetText(c)
  if (b) chips.push({ key: "budget", type: "budget", value: null, label: b.replace(/^./, (m) => m.toUpperCase()) })
  return chips
}

// Khóa nhu cầu cho aiGaps: dễ đọc với nhân viên ở SCR-44 (VD "Bạn trai + Tốt nghiệp + Game PC + Dưới 100.000đ")
const gapKeyOf = (c, tagInfo) => chipsOf(c, tagInfo).map((x) => x.label).join(" + ") || "Chỉ có mô tả thêm"

// Khảo sát dạng slug để trả cho client và lưu aiSessions.input / criteria (06 Mục 5.1)
function toInput(c, tagInfo) {
  const slug = (k) => tagInfo.get(k)?.slug
  return {
    recipient: c.recipient ? slug(c.recipient) : c.otherRecipient ? "khac" : null,
    occasions: c.occasions.map(slug),
    hobbies: c.hobbies.map(slug),
    personalities: c.personalities.map(slug),
    noteTags: c.noteTags || [],
    ageMin: c.ageMin ?? null,
    ageMax: c.ageMax ?? null,
    budgetMin: c.budgetMin || 0,
    budgetMax: c.budgetMax ?? null,
    note: c.note || "",
    preferPersonalized: !!c.preferPersonalized,
  }
}

// Ngược lại của toInput (đọc lại aiSessions.criteria khi tinh chỉnh)
function fromInput(input, tagInfo) {
  const personalities = []
  for (const s of input.personalities || []) for (const g of FIELD_GROUPS.personalities) if (tagInfo.has(`${g}:${s}`)) personalities.push(`${g}:${s}`)
  return {
    recipient: input.recipient && input.recipient !== "khac" && tagInfo.has(`DOI_TUONG:${input.recipient}`) ? `DOI_TUONG:${input.recipient}` : null,
    otherRecipient: input.recipient === "khac",
    occasions: (input.occasions || []).map((s) => `DIP_TANG:${s}`).filter((k) => tagInfo.has(k)),
    hobbies: (input.hobbies || []).map((s) => `SO_THICH:${s}`).filter((k) => tagInfo.has(k)),
    personalities,
    noteTags: (input.noteTags || []).filter((k) => tagInfo.has(k)),
    ageMin: input.ageMin ?? null,
    ageMax: input.ageMax ?? null,
    budgetMin: input.budgetMin || 0,
    budgetMax: input.budgetMax ?? null,
    note: input.note || "",
    preferPersonalized: !!input.preferPersonalized,
  }
}

module.exports = {
  buildTagInfo, readCriteria, hasAnyField, extractFromNote, applyNote, applyRefine, tagsInText, readMoney, usedTrials, quotaOf,
  summaryOf, chipsOf, gapKeyOf, toInput, fromInput, keyOf, fmt, NOTE_NOT_UNDERSTOOD, REFINE_NOT_UNDERSTOOD, CHEAPER_FACTOR,
}
