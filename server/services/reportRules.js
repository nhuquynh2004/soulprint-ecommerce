// Quy tắc báo cáo tổng quan (UC-CAT-03). Hàm thuần, không đọc CSDL để unit test được: khoảng thời gian theo
// giờ Việt Nam, kỳ trước cùng độ dài, phần trăm thay đổi, nhóm ngày/tuần/tháng, dự kiến hết hàng, mức độ và thứ tự
// của "Gợi ý hành động", trạng thái "Thiết lập cửa hàng", tạo file CSV mở được bằng Excel.
const HttpError = require("../utils/httpError")

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const VN = 7 * HOUR

// ===== Ngày theo giờ Việt Nam =====

// "yyyy-MM-dd" theo giờ Việt Nam của một thời điểm
const vnDay = (d) => new Date(new Date(d).getTime() + VN).toISOString().slice(0, 10)
// 0:00 giờ Việt Nam của ngày "yyyy-MM-dd" (là 17:00 UTC hôm trước)
const startOfVnDay = (ymd) => new Date(Date.parse(ymd + "T00:00:00Z") - VN)
const addDays = (ymd, n) => new Date(Date.parse(ymd + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10)
const ddMM = (ymd) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`
const ddMMyyyy = (ymd) => `${ddMM(ymd)}/${ymd.slice(0, 4)}`

const PRESETS = {
  "hom-nay": "Hôm nay",
  "7-ngay": "7 ngày gần nhất",
  "30-ngay": "30 ngày gần nhất",
  "thang-nay": "Tháng này",
  "thang-truoc": "Tháng trước",
}
const YMD = /^\d{4}-\d{2}-\d{2}$/
const validYmd = (s) => YMD.test(s || "") && vnDay(startOfVnDay(s)) === s

// Khoảng [from, to] (ngày, gồm cả 2 đầu) theo preset hoặc Tùy chọn; mặc định 30 ngày gần nhất (bước 1).
// Kỳ trước: cùng số ngày, liền trước. start/end là thời điểm UTC để truy vấn [start, end).
function resolveRange(query = {}, now = new Date()) {
  const today = vnDay(now)
  let from
  let to = today
  let preset = PRESETS[query.preset] ? query.preset : null
  if (!preset && (query.from || query.to)) {
    if (!validYmd(query.from) || !validYmd(query.to)) throw new HttpError(422, "VALIDATION_ERROR", "Ngày không hợp lệ", { fields: { from: "Chọn ngày dạng dd/MM/yyyy" } })
    if (query.to < query.from) throw new HttpError(422, "VALIDATION_ERROR", "Ngày kết thúc phải sau ngày bắt đầu", { fields: { to: "Ngày kết thúc phải sau ngày bắt đầu" } }) // 4Ea
    from = query.from
    to = query.to
  } else {
    preset = preset || "30-ngay"
    if (preset === "hom-nay") from = today
    if (preset === "7-ngay") from = addDays(today, -6) // AC8: 15/10 -> 09/10 đến 15/10
    if (preset === "30-ngay") from = addDays(today, -29)
    if (preset === "thang-nay") from = today.slice(0, 8) + "01"
    if (preset === "thang-truoc") {
      const firstThis = today.slice(0, 8) + "01"
      to = addDays(firstThis, -1)
      from = to.slice(0, 8) + "01"
    }
  }
  const days = Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1
  const prevTo = addDays(from, -1)
  const prevFrom = addDays(from, -days)
  return {
    preset: preset || "tuy-chon",
    from, to, days,
    start: startOfVnDay(from),
    end: startOfVnDay(addDays(to, 1)),
    prev: { from: prevFrom, to: prevTo, start: startOfVnDay(prevFrom), end: startOfVnDay(from) },
    label: `${ddMM(from)} - ${ddMMyyyy(to)}`,
  }
}

// Cách nhóm của biểu đồ: Tùy người chọn; không chọn thì ≤ 31 ngày theo ngày, ≤ 120 ngày theo tuần, còn lại theo tháng
const pickGroupBy = (groupBy, days) => (["day", "week", "month"].includes(groupBy) ? groupBy : days <= 31 ? "day" : days <= 120 ? "week" : "month")

// Khóa nhóm của một ngày: ngày, thứ Hai đầu tuần, hoặc ngày 1 của tháng
function bucketOf(ymd, groupBy) {
  if (groupBy === "month") return ymd.slice(0, 8) + "01"
  if (groupBy === "week") {
    const dow = new Date(ymd + "T00:00:00Z").getUTCDay() // 0 = Chủ nhật
    return addDays(ymd, -((dow + 6) % 7))
  }
  return ymd
}

// Danh sách nhóm liên tục từ from đến to (để ngày không có đơn vẫn là điểm 0 trên biểu đồ)
function buckets(from, to, groupBy) {
  const out = []
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const b = bucketOf(d, groupBy)
    if (out[out.length - 1] !== b) out.push(b)
  }
  return out
}

const bucketLabel = (b, groupBy) => (groupBy === "month" ? `${b.slice(5, 7)}/${b.slice(0, 4)}` : groupBy === "week" ? `Tuần ${ddMM(b)}` : ddMM(b))

// ===== So với kỳ trước =====

// % thay đổi (1 chữ số thập phân); kỳ trước bằng 0 thì không so được (null)
const changePct = (cur, prev) => (cur == null || prev == null || !prev ? null : Math.round(((cur - prev) / prev) * 1000) / 10)
// Tỷ lệ (%, 1 chữ số); không có đơn thì null để giao diện hiện "-" (5Ea)
const ratePct = (part, total) => (total ? Math.round((part / total) * 1000) / 10 : null)
// Tỷ lệ so kỳ trước tính bằng "điểm %"
const changePoints = (cur, prev) => (cur == null || prev == null ? null : Math.round((cur - prev) * 10) / 10)

const metric = (value, previous, kind = "pct") => ({
  value, previous,
  change: kind === "points" ? changePoints(value, previous) : changePct(value, previous),
  changeKind: kind,
})

// ===== Gợi ý hành động =====

// Dự kiến hết hàng (3g quy tắc 1): tồn kho / bán trung bình mỗi ngày của 14 ngày; không bán thì không dự kiến (null)
function daysUntilStockout(stock, soldLast14) {
  const avg = soldLast14 / 14
  if (avg <= 0) return null
  return Math.floor(stock / avg)
}

const SEVERITY_RANK = { KHAN_CAP: 0, CAN_CHU_Y: 1, BINH_THUONG: 2 }
// Mức độ theo quy tắc: Khẩn cấp (5), Cần chú ý (1, 2, 4, 7, 8, 9), Bình thường (3, 6)
const SEVERITY_OF = {
  STOCKOUT: "CAN_CHU_Y", EXPIRING: "CAN_CHU_Y", LOW_CONVERSION: "BINH_THUONG", VOUCHER: "CAN_CHU_Y", URGENT_ORDERS: "KHAN_CAP",
  URGENT_REQUESTS: "KHAN_CAP", AI_GAPS: "BINH_THUONG", MATERIAL: "CAN_CHU_Y", PACKING: "CAN_CHU_Y", STORAGE: "CAN_CHU_Y",
}
const SEVERITY_LABEL = { KHAN_CAP: "Khẩn cấp", CAN_CHU_Y: "Cần chú ý", BINH_THUONG: "Bình thường" }

// Khẩn cấp lên đầu; cùng mức thì hạn gần trước; không hạn đứng sau
function sortInsights(list) {
  return [...list].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || (a.dueAt ? new Date(a.dueAt).getTime() : Infinity) - (b.dueAt ? new Date(b.dueAt).getTime() : Infinity))
}

// Số ngày còn lại làm tròn gần nhất (câu gợi ý và chữ hạn dùng chung để không lệch nhau)
const daysLeft = (dueAt, now = new Date()) => Math.max(0, Math.round((new Date(dueAt).getTime() - now.getTime()) / DAY))

// Chữ hạn ngắn: "còn 2 ngày", "còn 5 giờ", "hôm nay"; quá hạn thì "chờ 26 giờ"
function dueText(dueAt, now = new Date()) {
  if (!dueAt) return null
  const ms = new Date(dueAt).getTime() - now.getTime()
  if (ms < 0) {
    const h = Math.floor(-ms / HOUR)
    return h >= 48 ? `chờ ${Math.floor(h / 24)} ngày` : `chờ ${Math.max(1, h)} giờ`
  }
  const h = Math.floor(ms / HOUR)
  if (h < 1) return "dưới 1 giờ"
  if (h < 24) return `còn ${h} giờ`
  return `còn ${daysLeft(dueAt, now)} ngày`
}

// Khách đã xem đủ nhiều nhưng ít thêm giỏ (quy tắc 3): ≥ 100 lượt xem, tỷ lệ thêm giỏ < 2%
const lowConversion = (views, addToCarts) => views >= 100 && addToCarts / views < 0.02

// Voucher còn dưới 10% lượt (quy tắc 4); không giới hạn lượt thì không xét
const voucherLow = (v) => !!v.totalQuantity && v.totalQuantity - (v.usedCount || 0) < v.totalQuantity * 0.1

// ===== Thiết lập cửa hàng =====

const SETUP_CARDS = [
  { key: "home", title: "Trang chủ", description: "Banner, khối nổi bật, bộ sưu tập", link: "/quan-tri/trang-chu" },
  { key: "fees", title: "Phí và thanh toán", description: "Phí vận chuyển, tỷ lệ cọc, phương thức thanh toán", link: "/quan-tri/cai-dat" },
  { key: "personalization", title: "Cá nhân hóa và gói quà", description: "Bộ sticker, mẫu gói quà, vật liệu", link: "/quan-tri/ca-nhan-hoa" },
  { key: "policies", title: "Chính sách và chatbot", description: "Trang chính sách, câu trả lời của Sâu Béo", link: "/quan-tri/cai-dat" },
  { key: "staff", title: "Nhân viên", description: "Mời nhân viên, gán vai trò", link: "/quan-tri/nhan-vien" },
]

// facts: {homePublished, feesSaved, activeStickerSets, activeTemplates, policyCount, activeFaqs, otherActiveStaff}
function setupCards(facts) {
  const done = {
    home: !!facts.homePublished,
    fees: !!facts.feesSaved,
    personalization: facts.activeStickerSets + facts.activeTemplates > 0,
    policies: facts.policyCount > 0 && facts.activeFaqs > 0,
    staff: facts.otherActiveStaff > 0,
  }
  const cards = SETUP_CARDS.map((c) => ({ ...c, done: done[c.key] }))
  return { cards, doneCount: cards.filter((c) => c.done).length, total: cards.length }
}

// ===== CSV =====

const csvCell = (x) => {
  const s = x === null || x === undefined ? "" : String(x)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
// BOM UTF-8 đầu file để Excel nhận đúng tiếng Việt (AC2)
const toCsv = (rows) => "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n")

module.exports = {
  PRESETS, vnDay, startOfVnDay, addDays, ddMM, ddMMyyyy, resolveRange, pickGroupBy, bucketOf, buckets, bucketLabel,
  changePct, ratePct, changePoints, metric,
  daysUntilStockout, daysLeft, SEVERITY_OF, SEVERITY_LABEL, sortInsights, dueText, lowConversion, voucherLow,
  SETUP_CARDS, setupCards, toCsv,
}
