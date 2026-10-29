// Quy tắc chat "Sâu Béo" (UC-CSK-01 đến CSK-04). Hàm thuần, không đọc CSDL để unit test được:
// so khớp FAQ theo từ khóa không dấu, nhận biết câu hỏi về đơn và dấu hiệu khiếu nại, phương án nội bộ của
// AiProvider (mức gay gắt, chuyển ngữ, cảm xúc, tóm tắt), giờ hỗ trợ, hàng đợi, chọn nhân viên nhận bàn giao.
const params = require("../config/params")
const { removeAccents } = require("../utils/vnText")

// ===== Nhãn =====

const STATUS_LABEL = { BOT: "Sâu Béo", CHO_NHAN_VIEN: "Chờ nhân viên", DANG_HO_TRO: "Đang hỗ trợ", DA_DONG: "Đã đóng" }
// 3 mức của BA, nhãn theo thiết kế SCR-52
const SENTIMENT_LABEL = { TICH_CUC: "Tích cực", TRUNG_TINH: "Bình thường", TIEU_CUC: "Bực bội" }

// Nút gợi ý nhanh ở SCR-29 (UC-CSK-01 bước 2); "Gặp nhân viên" gọi API-63 thay vì gửi tin
const QUICK_TOPICS = ["Phí vận chuyển", "Chính sách đổi trả", "Cách cá nhân hóa", "Tra cứu đơn hàng"]

// ===== Chuẩn hóa chữ =====

// "Phí ship bao nhiêu?!" -> " phi ship bao nhieu " (có khoảng trắng 2 đầu để so khớp trọn từ)
const plain = (text) => " " + removeAccents(text).replace(/[^a-z0-9]+/g, " ").trim() + " "
// Giữ dấu, chữ thường: dùng cho từ điển gay gắt, cảm xúc (bỏ dấu thì "ngủ" thành "ngu", "hư" lẫn "hủ")
const lower = (text) => " " + String(text || "").normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim() + " "
const has = (padded, phrase) => padded.includes(" " + phrase + " ")

// ===== Trả lời của chatbot =====

// UC-CSK-01 bước 5: câu FAQ đang bật có tổng độ dài từ khóa khớp lớn nhất; hòa thì câu đứng trước (sortOrder)
function matchFaq(text, faqs) {
  const t = plain(text)
  let best = null
  for (const f of faqs) {
    if (f.isActive === false) continue
    const score = (f.keywords || []).filter((k) => k && has(t, plain(k).trim())).reduce((n, k) => n + k.length, 0)
    if (score > 0 && (!best || score > best.score)) best = { faq: f, score }
  }
  return best ? best.faq : null
}

// UC-CSK-01 5a: tin có dấu hiệu khiếu nại hoặc cần người thật thì chuyển nhân viên ngay
const ESCALATE_PHRASES = [
  "khieu nai", "lua dao", "hoan tien ngay", "boi thuong", "gap nhan vien", "nguoi that", "nhan vien that",
  "doi chu in", "sua chu in", "doi so ao", "doi noi dung in", "sua noi dung in",
]
const wantsHuman = (text) => ESCALATE_PHRASES.some((p) => has(plain(text), p))
// Đặt số lượng lớn, báo giá riêng: Sâu Béo không trả lời được, chuyển nhân viên (UC-CSK-01 5a)
const BULK_PHRASES = ["so luong lon", "bao gia", "dat si", "mua si", "don doan", "dat nhieu", "so luong nhieu", "cho ca doi", "cho ca team", "cho ca lop"]
const wantsBulk = (text) => BULK_PHRASES.some((p) => has(plain(text), p))

// Mã đơn trong tin (VD "SP2610150001")
const orderCodeIn = (text) => {
  const m = String(text || "").toUpperCase().match(/\bSP\d{10}\b/)
  return m ? m[0] : null
}
// Câu hỏi về tình trạng đơn (UC-CSK-01 bước 5)
const ORDER_PHRASES = ["don cua minh", "don cua toi", "don hang cua minh", "don hang cua toi", "tinh trang don", "don minh", "don toi", "chua toi", "chua nhan duoc", "giao chua", "dang o dau", "tra cuu don", "tra cuu don hang", "don tre", "giao tre", "giao cham", "tre hen"]
const asksOrder = (text) => !!orderCodeIn(text) || ORDER_PHRASES.some((p) => has(plain(text), p))

const GREETINGS = ["chao", "xin chao", "hello", "hi", "alo", "chao shop", "chao sau"]
const THANKS = ["cam on", "thank", "thanks", "tks"]
const isGreeting = (text) => GREETINGS.includes(plain(text).trim())
const isThanks = (text) => THANKS.some((p) => has(plain(text), p))

// ===== Phương án nội bộ của AiProvider =====

// Từ ngữ nặng (giữ dấu) và từ thay thế trung tính khi chuyển ngữ (UC-CSK-03, AiProvider.soften)
const HARSH = [
  ["lừa đảo", "chưa đúng cam kết"], ["vô trách nhiệm", "chưa chu đáo"], ["bố láo", "chưa phù hợp"], ["tệ hại", "chưa tốt"],
  ["quá tệ", "chưa tốt"], ["cái quái gì", "gì"], ["khốn nạn", ""], ["chết tiệt", ""], ["đồ rác", "chưa đạt"], ["rác rưởi", "chưa đạt"],
  ["lừa", "chưa đúng cam kết với"], ["ngu", "chưa hợp lý"], ["dốt", "chưa hợp lý"], ["đéo", "không"], ["điên", "không vui"],
  ["đm", ""], ["dm", ""], ["vcl", ""], ["vl", ""], ["cút", ""],
]
const harshHits = (text) => HARSH.filter(([w]) => has(lower(text), w)).length

// UC-CSK-01 bước 4: gay gắt khi có từ nặng, hoặc vừa VIẾT HOA gần hết vừa nhiều dấu chấm than
function isHarsh(text) {
  const s = String(text || "")
  const letters = s.replace(/[^\p{L}]/gu, "")
  const shouting = letters.length >= 10 && letters === letters.toUpperCase() && /!{2,}/.test(s)
  return harshHits(s) > 0 || shouting
}

// UC-CSK-03 bước 3: thay từ nặng, bỏ chấm than dồn dập, hạ chữ hoa, thêm lời nhờ nhẹ nhàng. Không đổi được gì thì null (3Ea)
function soften(text) {
  let s = String(text || "").normalize("NFC")
  const letters = s.replace(/[^\p{L}]/gu, "")
  if (letters.length >= 10 && letters === letters.toUpperCase()) s = s.toLowerCase()
  for (const [word, repl] of HARSH) {
    s = s.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${word}(?=$|[^\\p{L}\\p{N}])`, "giu"), (all, pre) => pre + repl)
  }
  s = s.replace(/!+/g, ".").replace(/\?{2,}/g, "?").replace(/\s+([.,?])/g, "$1").replace(/([.,?])\1+/g, "$1")
  s = s.replace(/\s{2,}/g, " ").replace(/^[\s.,]+/, "").trim()
  if (!s) return null
  s = s.charAt(0).toUpperCase() + s.slice(1)
  if (!/[.?]$/.test(s)) s += "."
  s += " Bạn kiểm tra giúp mình nhé."
  return s === String(text).trim() ? null : s
}

const POSITIVE = ["cảm ơn", "cám ơn", "tuyệt", "tuyệt vời", "đẹp", "thích", "hài lòng", "tốt quá", "dễ thương", "xinh", "nhanh quá", "ok", "oke", "yêu"]
const NEGATIVE = [
  "chưa tới", "chưa nhận", "chưa nhận được", "trễ", "chậm", "hỏng", "hư", "bể", "vỡ", "móp", "sai", "lỗi", "thất vọng",
  "không hài lòng", "bực", "bực mình", "tức", "khiếu nại", "hoàn tiền ngay", "lo", "lo lắng", "mãi", "không ai", "tệ", "chán",
]

// UC-CSK-02 bước 3 (AiProvider.sentiment): điểm -1..1 trung bình trên các tin của khách; từ nặng tính gấp đôi
function sentiment(texts) {
  const scores = []
  for (const t of texts) {
    const l = lower(t)
    const pos = POSITIVE.filter((w) => has(l, w)).length
    const neg = NEGATIVE.filter((w) => has(l, w)).length + 2 * harshHits(t)
    if (pos + neg > 0) scores.push((pos - neg) / (pos + neg))
  }
  const score = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100 : 0
  const label = score <= -0.25 ? "TIEU_CUC" : score >= 0.25 ? "TICH_CUC" : "TRUNG_TINH"
  return { sentiment: label, sentimentScore: score }
}

// Tin "có nội dung" của khách: bỏ chào hỏi, cảm ơn, chữ của nút gợi ý nhanh
const meaningful = (texts) =>
  texts.map((t) => String(t || "").trim()).filter((t) => t.length >= 6 && !isGreeting(t) && !QUICK_TOPICS.includes(t) && t !== "Gặp nhân viên")
const cut = (s, n) => (s.length > n ? s.slice(0, n - 3).trimEnd() + "..." : s)

// UC-CSK-02 bước 2 (AiProvider.summarize): ghép tối đa 3 câu hỏi chính gần nhất; không có thì null (2Ea)
function summarize(texts) {
  const list = [...new Set(meaningful(texts))].slice(-3)
  if (!list.length) return null
  return cut("Khách hỏi: " + list.map((t) => `"${cut(t, 120)}"`).join("; ") + ".", 400)
}

// Chủ đề 1 dòng ở hàng đợi SCR-52: câu có nội dung đầu tiên của khách
function topicOf(texts) {
  const first = meaningful(texts)[0]
  return first ? cut(first, 120) : "Khách muốn gặp nhân viên"
}

// ===== Giờ hỗ trợ, hàng đợi =====

// Giờ Việt Nam (UTC+7) của một thời điểm, vì server Render chạy giờ UTC
const vnHour = (now) => (now.getUTCHours() + 7) % 24

function isSupportHours(now = new Date()) {
  const h = vnHour(now)
  return h >= params.SUPPORT_HOURS.start && h < params.SUPPORT_HOURS.end
}

const hoursText = () => `${params.SUPPORT_HOURS.start}:00 - ${params.SUPPORT_HOURS.end}:00`

// Câu hẹn phản hồi khi khách để lại lời nhắn (UC-CSK-02 4Ea): ngoài giờ hẹn trước 9:00, trong giờ mà chưa ai trực thì "sớm nhất"
function replyPromise(now = new Date(), inHours = isSupportHours(now)) {
  if (inHours) return "Nhân viên sẽ phản hồi bạn sớm nhất."
  const day = vnHour(now) < params.SUPPORT_HOURS.start ? "sáng nay" : "sáng mai"
  return `Nhân viên phản hồi trước ${params.SUPPORT_HOURS.start + 1}:00 ${day}.`
}

const waitMinutes = (position) => Math.max(1, position) * params.CHAT_WAIT_MINUTES_PER_POSITION

// ===== Nhãn hội thoại =====

// Thứ tự ưu tiên khi hiện tối đa 2 nhãn ở danh sách; một hội thoại có thể nhiều nhãn (khách vừa đặt gấp vừa đổi trả)
const LABELS = { DAT_GAP: "Đơn gấp", KHIEU_NAI: "Khiếu nại", DOI_TRA: "Đổi trả, bảo hành", DON_HANG: "Đơn hàng", TU_VAN: "Tư vấn" }
const LABEL_ORDER = Object.keys(LABELS)
const RETURN_PHRASES = ["doi tra", "doi hang", "tra hang", "hoan tien", "bao hanh", "doi size", "doi mau", "bi loi", "bi hong", "bi vo", "giao sai", "thieu hang"]
const COMPLAINT_PHRASES = ["khieu nai", "lua dao", "boi thuong", "that vong", "khong hai long", "qua te", "te qua", "bao cong an", "boc phot"]

// Nhãn tự gắn từ tin của khách, cảm xúc và yêu cầu đặt gấp đang mở. Không khớp gì thì "Tư vấn".
function autoLabels({ texts = [], sentiment = null, urgentOpen = false } = {}) {
  const all = plain(texts.join(" . "))
  const found = new Set()
  if (urgentOpen) found.add("DAT_GAP")
  if (sentiment === "TIEU_CUC" || COMPLAINT_PHRASES.some((p) => has(all, p)) || texts.some(isHarsh)) found.add("KHIEU_NAI")
  if (RETURN_PHRASES.some((p) => has(all, p))) found.add("DOI_TRA")
  if (texts.some(asksOrder)) found.add("DON_HANG")
  if (!found.size) found.add("TU_VAN")
  return sortLabels([...found])
}

const sortLabels = (codes) => [...new Set(codes)].filter((c) => LABELS[c]).sort((a, b) => LABEL_ORDER.indexOf(a) - LABEL_ORDER.indexOf(b))

// Nhân viên đã xem tin cuối của khách mà quá số phút chưa trả lời thì nhắc
function replyReminder({ lastCustomerAt, lastStaffAt, staffSeenAt, now = new Date(), minutes = params.CHAT_REPLY_REMIND_MINUTES }) {
  if (!lastCustomerAt) return { needsReply: false, unread: false, remindMinutes: 0 }
  const customer = new Date(lastCustomerAt)
  const needsReply = !lastStaffAt || new Date(lastStaffAt) < customer
  const seen = !!staffSeenAt && new Date(staffSeenAt) >= customer
  const waited = Math.floor((now - customer) / 60000)
  return { needsReply, unread: needsReply && !seen, remindMinutes: needsReply && seen && waited >= minutes ? waited : 0 }
}

// UC-CSK-04 bước 2: đơn gấp lên đầu, rồi chỉ báo đỏ, rồi chờ lâu trước
function sortQueue(list) {
  const rank = (c) => (c.urgentOpen ? 0 : c.sentiment === "TIEU_CUC" ? 1 : 2)
  return [...list].sort((a, b) => rank(a) - rank(b) || new Date(a.escalatedAt) - new Date(b.escalatedAt))
}

// UC-CSK-04 1a: chia từng hội thoại cho người đang trực ít việc nhất (load tăng dần sau mỗi lần giao)
function planHandover(conversationIds, staff) {
  const pool = staff.map((s) => ({ ...s }))
  return conversationIds.map((id) => {
    if (!pool.length) return { id, to: null }
    pool.sort((a, b) => a.load - b.load || String(a._id).localeCompare(String(b._id)))
    pool[0].load += 1
    return { id, to: pool[0] }
  })
}

// Liên hệ để lại ngoài giờ: SĐT 10 số bắt đầu bằng 0, hoặc email
function validContact(contact) {
  const c = String(contact || "").trim()
  if (c.includes("@")) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c) && c.length <= 100 ? c.toLowerCase() : null
  const phone = c.replace(/[\s.-]/g, "")
  return /^0\d{9}$/.test(phone) ? phone : null
}

// Kiểm tra độ dài tin nhắn, lời nhắn, ghi chú; trả thông báo lỗi hoặc null
function textError(text, max, what = "Tin nhắn") {
  const t = String(text ?? "").trim()
  if (!t) return `${what} không được để trống`
  if (t.length > max) return `${what} tối đa ${max} ký tự`
  return null
}

module.exports = {
  STATUS_LABEL, SENTIMENT_LABEL, QUICK_TOPICS,
  plain, matchFaq, wantsHuman, wantsBulk, orderCodeIn, asksOrder, isGreeting, isThanks,
  isHarsh, soften, sentiment, summarize, topicOf,
  isSupportHours, hoursText, replyPromise, waitMinutes, sortQueue, planHandover, validContact, textError,
  LABELS, autoLabels, sortLabels, replyReminder,
}
