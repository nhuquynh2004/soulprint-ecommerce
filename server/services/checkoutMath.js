// Phần tính toán thuần của đặt hàng (không đọc CSDL) để unit test: điều kiện voucher, số giảm, bảng tiền,
// phương thức thanh toán được phép. Công thức duy nhất ở 02_Actors_BusinessRules_Glossary.md Mục 3.
const params = require("../config/params")
const { removeAccents } = require("../utils/vnText")

const DAY = 24 * 60 * 60 * 1000

// ===== Voucher (BR-23) =====

// PERCENT, FIXED là voucher giảm giá; FREESHIP là voucher miễn phí vận chuyển. Mỗi đơn tối đa 1 voucher mỗi nhóm.
const kindOf = (type) => (type === "FREESHIP" ? "FREESHIP" : "DISCOUNT")

const usedUp = (v) => (v.totalQuantity != null && (v.usedCount || 0) >= v.totalQuantity) || (v.maxBudget != null && (v.discountGiven || 0) >= v.maxBudget)

// Trạng thái hiển thị tính từ status + thời gian + lượt (06 Mục 3.3)
function displayStatus(v, now = new Date()) {
  if (v.status === "BAN_NHAP") return "BAN_NHAP"
  if (v.status === "LUU_TRU") return "LUU_TRU"
  if (v.status === "TAM_NGUNG") return "TAM_NGUNG"
  if (v.endAt && new Date(v.endAt) < now) return "HET_HAN"
  if (usedUp(v)) return "HET_LUOT"
  if (v.startAt && new Date(v.startAt) > now) return "DA_LEN_LICH"
  return "DANG_HOAT_DONG"
}

// Dòng thuộc phạm vi voucher: toàn đơn, danh mục, sản phẩm; trừ sản phẩm bị loại trừ.
// line: {productId, categoryId, lineValue}; id so sánh dạng chuỗi.
function inScope(v, line) {
  const scope = v.scope || { kind: "ALL" }
  const excluded = (scope.excludeProductIds || []).map(String)
  if (excluded.includes(String(line.productId))) return false
  const ids = (scope.ids || []).map(String)
  if (scope.kind === "CATEGORY") return ids.includes(String(line.categoryId))
  if (scope.kind === "PRODUCT") return ids.includes(String(line.productId))
  return true
}

const eligibleValue = (v, lines) => lines.filter((l) => inScope(v, l)).reduce((s, l) => s + l.lineValue, 0)

// Số tiền giảm của 1 voucher (02 Mục 3.1). Không vượt ngân sách còn lại.
function discountOf(v, lines, shippingFee) {
  let amount
  if (v.type === "FREESHIP") amount = Math.min(v.value, shippingFee)
  else {
    const base = eligibleValue(v, lines)
    if (v.type === "PERCENT") {
      amount = Math.floor((base * v.value) / 100)
      if (v.maxDiscount) amount = Math.min(amount, v.maxDiscount)
    } else amount = Math.min(v.value, base)
  }
  if (v.maxBudget != null) amount = Math.min(amount, Math.max(0, v.maxBudget - (v.discountGiven || 0)))
  return Math.max(0, amount)
}

const fmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "đ"

// Kiểm tra 1 voucher theo thứ tự UC-PAY-03 bước 2. Trả null khi hợp lệ, không thì {status, code, message}.
// ctx: {now, user (Member đang đăng nhập hoặc null), grant (userVouchers của người đó với voucher này),
//       usedByUser (số đơn người này đã dùng mã), lines, shippingFee}
function voucherProblem(v, ctx) {
  const now = ctx.now || new Date()
  const bad = (status, code, message, extra = {}) => ({ status, code, message, ...extra })
  if (!v || !["HOAT_DONG"].includes(v.status)) return bad(404, "VOUCHER_INVALID", "Mã giảm giá không hợp lệ")
  if (v.startAt && new Date(v.startAt) > now) return bad(410, "VOUCHER_NOT_STARTED", "Mã giảm giá chưa đến thời gian áp dụng")
  if (v.endAt && new Date(v.endAt) < now) return bad(410, "VOUCHER_EXPIRED", "Mã giảm giá đã hết hạn sử dụng")
  if (ctx.grant && ctx.grant.expiresAt && new Date(ctx.grant.expiresAt) < now) return bad(410, "VOUCHER_EXPIRED", "Mã giảm giá đã hết hạn sử dụng")
  if (usedUp(v)) return bad(410, "VOUCHER_USED_UP", "Mã giảm giá đã hết lượt sử dụng")
  if (v.perUserLimit && (ctx.usedByUser || 0) >= v.perUserLimit) return bad(410, "VOUCHER_USED_UP", "Mã giảm giá đã hết lượt sử dụng")

  const scopeMsg = "Mã này không áp dụng cho tài khoản/sản phẩm trong giỏ của bạn"
  if (v.audience && v.audience !== "PUBLIC") {
    if (!ctx.user) return bad(422, "VOUCHER_AUDIENCE", scopeMsg, { loginHint: true })
    if (v.audience === "SELECTED" && !ctx.grant) return bad(422, "VOUCHER_AUDIENCE", scopeMsg)
    if (v.audience === "NEW_MEMBERS" && !ctx.grant) {
      const age = now - new Date(ctx.user.createdAt || 0)
      if (age > params.NEW_MEMBER_DAYS * DAY) return bad(422, "VOUCHER_AUDIENCE", scopeMsg)
    }
  }

  const lines = ctx.lines || []
  const orderValue = lines.reduce((s, l) => s + l.lineValue, 0)
  const quantity = lines.reduce((s, l) => s + (l.quantity || 0), 0)
  if (v.minOrderValue && orderValue < v.minOrderValue) {
    return bad(422, "VOUCHER_MIN_ORDER", `Đơn hàng cần tối thiểu ${fmt(v.minOrderValue)} để áp dụng mã này`, {
      hint: `Tạm tính hiện tại ${fmt(orderValue)}, thêm ${fmt(v.minOrderValue - orderValue)} nữa để dùng ${v.code}.`,
    })
  }
  if (v.minItems && quantity < v.minItems) return bad(422, "VOUCHER_MIN_ITEMS", `Đơn hàng cần tối thiểu ${v.minItems} sản phẩm để áp dụng mã này`)
  if (v.type !== "FREESHIP" && !lines.some((l) => inScope(v, l))) return bad(422, "VOUCHER_SCOPE", scopeMsg)
  if (discountOf(v, lines, ctx.shippingFee || 0) <= 0) {
    return v.type === "FREESHIP" ? bad(422, "VOUCHER_SCOPE", "Đơn hàng không có phí vận chuyển để giảm") : bad(410, "VOUCHER_USED_UP", "Mã giảm giá đã hết lượt sử dụng")
  }
  return null
}

// Danh sách mã khách gửi lên: chữ in hoa, bỏ trùng, tối đa 2 (BR-23)
function readCodes(value) {
  const list = Array.isArray(value) ? value : value ? [value] : []
  return [...new Set(list.filter((c) => typeof c === "string").map((c) => c.trim().toUpperCase()).filter(Boolean))].slice(0, 2)
}

// ===== Bảng tiền (02 Mục 3) =====

// lines: dòng được chọn {unitPrice, quantity, personalizationFeePerUnit, isPersonalized, lineValue}
// discounts: [{discount}] đã tính; settings: {shippingFee, depositRate, payments}
// urgentFee: phụ phí giao gấp nhân viên chốt với khách, không được giảm bởi voucher
function money(lines, { shippingFee, depositRate, discounts = [], recipientType = "SELF", urgentFee = 0 }) {
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0)
  const personalizationFee = lines.reduce((s, l) => s + l.personalizationFeePerUnit * l.quantity, 0)
  const giftWrapFee = params.GIFT_WRAP_FEE
  const discount = Math.min(discounts.reduce((s, d) => s + d.discount, 0), subtotal + personalizationFee + shippingFee)
  const total = subtotal + shippingFee + personalizationFee + giftWrapFee + urgentFee - discount
  const hasPersonalized = lines.some((l) => l.isPersonalized)
  // Cọc chỉ với đơn Giao cho tôi có món cá nhân hóa (BR-02 ưu tiên hơn BR-03)
  const personalizedValue = lines.filter((l) => l.isPersonalized).reduce((s, l) => s + l.lineValue, 0)
  const depositAmount = recipientType === "SELF" && hasPersonalized ? Math.min(Math.ceil(personalizedValue * depositRate), total) : 0
  return { subtotal, personalizationFee, giftWrapFee, shippingFee, urgentFee, discount, total, hasPersonalized, depositAmount, remainingAmount: total - depositAmount }
}

// Lựa chọn thanh toán được phép theo BR-02 > BR-03/BR-04 > BR-05 và BR-40 (02 Mục 3.3). Mỗi lựa chọn là
// {paymentChoice, remainingMethod} khớp API-38: COD toàn bộ, cọc online + COD phần còn lại, online 100%.
function paymentOptions(m, recipientType, payments) {
  const on = { onlineFull: true, depositCod: true, codFull: true, ...(payments || {}) }
  const options = []
  const full = { key: "ONLINE", paymentChoice: "ONLINE", remainingMethod: null, amountDueNow: m.total }
  if (recipientType === "OTHER") {
    if (on.onlineFull) options.push(full)
  } else if (m.hasPersonalized) {
    if (on.depositCod) options.push({ key: "DEPOSIT_COD", paymentChoice: "ONLINE", remainingMethod: "COD", amountDueNow: m.depositAmount })
    if (on.onlineFull) options.push(full)
  } else {
    if (on.codFull) options.push({ key: "COD", paymentChoice: "COD", remainingMethod: null, amountDueNow: 0 })
    if (on.onlineFull) options.push(full)
  }
  // Tổng 0đ (voucher lớn) thì không có gì để trả online: chỉ còn đặt hàng thẳng
  if (m.total === 0) return [{ key: "COD", paymentChoice: "COD", remainingMethod: null, amountDueNow: 0 }]
  return options
}

// Chọn lựa chọn khớp yêu cầu của khách; không khớp thì null (API-38 trả 422)
function pickOption(options, paymentChoice, remainingMethod) {
  return (
    options.find((o) => o.paymentChoice === paymentChoice && (o.paymentChoice === "COD" || (o.remainingMethod || "ONLINE") === (remainingMethod || "ONLINE"))) || null
  )
}

// ===== Giao hàng (UC-PAY-02) =====

// Ngày theo giờ Việt Nam dạng yyyy-MM-dd
function vnDate(d = new Date()) {
  return new Date(d.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

const addDays = (ymd, n) => new Date(Date.parse(ymd + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10)

// Giờ Việt Nam của một thời điểm (server Render chạy UTC)
const vnHour = (d) => (d.getUTCHours() + 7) % 24

// Địa chỉ trong TP. Hồ Chí Minh: "Thành phố Hồ Chí Minh", "TP.HCM", "Hồ Chí Minh"...
function isHcm(province) {
  const p = " " + removeAccents(province || "").replace(/[^a-z0-9]+/g, " ").trim() + " "
  return p.includes(" ho chi minh ") || p.includes(" hcm ") || p.includes(" tphcm ")
}

// Ngày giao sớm nhất: ngày đặt + 1 nếu đặt từ 12:00 + 3 nếu có cá nhân hóa + vận chuyển (TP.HCM 2, tỉnh khác 4).
// VD đặt 13:00 18/10 có cá nhân hóa, giao TP.HCM: 18 + 1 + 3 + 2 = 24/10. Trả kèm các phần để client giải thích.
function earliestDelivery({ now = new Date(), province = "", personalized = false } = {}) {
  const afterCutoff = vnHour(now) >= params.DELIVERY_CUTOFF_HOUR ? 1 : 0
  const personalizationDays = personalized ? params.PERSONALIZATION_DAYS : 0
  const hcm = isHcm(province)
  const shippingDays = province ? (hcm ? params.SHIPPING_DAYS_HCM : params.SHIPPING_DAYS_OTHER) : params.SHIPPING_DAYS_OTHER
  const date = addDays(vnDate(now), afterCutoff + personalizationDays + shippingDays)
  return { date, afterCutoff: !!afterCutoff, personalizationDays, shippingDays, inHcm: hcm, knownProvince: !!province }
}

// Khoảng ngày giao chọn được: từ ngày sớm nhất đến DELIVERY_MAX_DAYS ngày sau đó. Đặt gấp chọn được từ ngày mai
// đến trước ngày sớm nhất (urgentMin). Không có tỉnh thì tính như tỉnh khác (lâu nhất).
function deliveryRange(now = new Date(), { province = "", personalized = false } = {}) {
  const earliest = earliestDelivery({ now, province, personalized })
  const today = vnDate(now)
  // urgentMax: ngày cuối còn tính là gấp; câu mời đặt gấp, lịch chọn ngày và trang yêu cầu cùng đọc min ở đây
  return { min: earliest.date, max: addDays(earliest.date, params.DELIVERY_MAX_DAYS), urgentMin: addDays(today, 1), urgentMax: addDays(earliest.date, -1), slots: params.DELIVERY_SLOTS, earliest }
}

// Mã đơn SP + yyMMdd (giờ Việt Nam) + 4 số thứ tự trong ngày (06 Mục 4.1)
function orderCode(now, seq) {
  return "SP" + vnDate(now).slice(2).replace(/-/g, "") + String(seq).padStart(4, "0")
}

module.exports = {
  kindOf, displayStatus, inScope, eligibleValue, discountOf, voucherProblem, readCodes, usedUp,
  money, paymentOptions, pickOption, vnDate, addDays, deliveryRange, earliestDelivery, isHcm, orderCode, fmt,
}
