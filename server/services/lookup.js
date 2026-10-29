// Tra cứu đơn bằng SĐT/Mã đơn (UC-TRK-01, BR-24; 07_API_Spec.md API-55 đến API-58). Không lộ có hay không có đơn
// trước khi OTP đúng: không tìm thấy vẫn trả cùng dạng, vẫn lưu một bản ghi OTP không thể khớp nên bước xác minh
// luôn báo sai mã và vẫn bị khóa sau 5 lần như trường hợp có đơn (4Ea, AC3).
const crypto = require("crypto")
const { database } = require("../config/db")
const params = require("../config/params")
const HttpError = require("../utils/httpError")
const st = require("./orderState")
const { sha256, newOtpCode } = require("./tokens")
const { notifier, isDemo } = require("./notifier")
const order = require("./order")

const otps = () => database.collection("otps")
const orders = () => database.collection("orders")
const MINUTE = 60 * 1000
const PURPOSE = "TRA_CUU_DON"

// SĐT 10 số bắt đầu bằng 0, hoặc mã đơn SP + 10 số (06 Mục 4.1)
function readTarget(value) {
  const raw = String(value || "").replace(/[\s.]/g, "").toUpperCase()
  if (/^0\d{9}$/.test(raw)) return { target: raw, kind: "PHONE" }
  if (/^SP\d{10}$/.test(raw)) return { target: raw, kind: "CODE" }
  throw new HttpError(400, "VALIDATION_ERROR", "Nhập số điện thoại (10 số) hoặc mã đơn dạng SP2610150001", { fields: { target: "Không đúng định dạng" } })
}

// SĐT nhận OTP: SĐT có ít nhất 1 đơn, hoặc SĐT người mua của mã đơn
async function phoneFor({ target, kind }) {
  if (kind === "PHONE") return (await orders().findOne({ "customer.phone": target }, { projection: { _id: 1 } })) ? target : null
  const o = await orders().findOne({ code: target }, { projection: { "customer.phone": 1 } })
  return o ? o.customer.phone : null
}

// Mã đơn không tồn tại: hiện một SĐT che cố định theo mã (không đổi giữa các lần gửi) để giống trường hợp có đơn
function fakeMasked(target) {
  const h = sha256("lookup:" + target)
  const digits = h.replace(/\D/g, "").padEnd(6, "0")
  return `09${digits[0]}${digits[1]} *** ${digits.slice(2, 5)}`
}

function lockedError(lockedUntil, now) {
  return new HttpError(423, "LOCKED", "Bạn đã nhập sai quá 5 lần, vui lòng thử lại sau 15 phút", { retryAfter: Math.ceil((lockedUntil - now) / 1000) })
}

// API-55 gửi OTP
async function sendOtp(body) {
  const t = readTarget(body.target)
  const now = new Date()
  const existing = await otps().findOne({ target: t.target, purpose: PURPOSE })
  if (existing?.lockedUntil > now) throw lockedError(existing.lockedUntil, now)
  // 6Ec: gửi lại sau 60 giây kể từ lần trước
  if (existing?.sentAt && now - existing.sentAt < params.OTP_RESEND_SECONDS * 1000) {
    const retryAfter = Math.ceil((params.OTP_RESEND_SECONDS * 1000 - (now - existing.sentAt)) / 1000)
    throw new HttpError(429, "QUOTA_EXCEEDED", `Vui lòng chờ ${retryAfter} giây trước khi gửi lại mã`, { retryAfter })
  }

  const phone = await phoneFor(t)
  const code = newOtpCode()
  await otps().updateOne(
    { target: t.target, purpose: PURPOSE },
    {
      $set: {
        phone,
        // Không có đơn: băm một chuỗi ngẫu nhiên, không mã 6 số nào khớp được
        codeHash: phone ? sha256(code) : sha256(crypto.randomBytes(16).toString("hex")),
        expiresAt: new Date(now.getTime() + params.OTP_TTL_MINUTES * MINUTE),
        attempts: 0,
        lockedUntil: null,
        sentAt: now,
        purgeAt: new Date(now.getTime() + 24 * 60 * MINUTE),
        createdAt: now,
      },
    },
    { upsert: true },
  )
  const masked = phone ? st.maskPhone(phone) : t.kind === "PHONE" ? st.maskPhone(t.target) : fakeMasked(t.target)
  const result = { maskedPhone: masked, expiresIn: params.OTP_TTL_MINUTES * 60, resendAfter: params.OTP_RESEND_SECONDS }
  if (phone) Object.assign(result, await notifier.sendOtp({ _id: null, phone }, code, "Mã tra cứu đơn hàng Soulprint"))
  // Chế độ demo hiện mã trên màn hình: không có đơn cũng hiện một mã (không khớp được) để phản hồi giống hệt (AC3)
  else if (isDemo()) result.devCode = code
  return result
}

// API-56 xác minh OTP: đúng thì ghi session.lookup (hiệu lực 30 phút)
async function verify(req, body) {
  const t = readTarget(body.target)
  const code = String(body.otp || "")
  if (!/^\d{6}$/.test(code)) throw new HttpError(400, "VALIDATION_ERROR", "Mã OTP gồm 6 chữ số", { fields: { otp: "Mã OTP gồm 6 chữ số" } })
  const now = new Date()
  const otp = await otps().findOne({ target: t.target, purpose: PURPOSE })
  if (!otp) throw new HttpError(410, "EXPIRED", "Mã OTP đã hết hạn, vui lòng gửi lại mã")
  if (otp.lockedUntil > now) throw lockedError(otp.lockedUntil, now)
  if (otp.expiresAt < now) throw new HttpError(410, "EXPIRED", "Mã OTP đã hết hạn, vui lòng gửi lại mã")

  if (sha256(code) !== otp.codeHash || !otp.phone) {
    const attempts = (otp.attempts || 0) + 1
    // 6Eb: sai 5 lần thì khóa tra cứu với SĐT/Mã đơn đó 15 phút, kể cả nhập đúng sau đó (AC2)
    if (attempts >= params.OTP_MAX_ATTEMPTS) {
      const lockedUntil = new Date(now.getTime() + params.OTP_LOCK_MINUTES * MINUTE)
      await otps().updateOne({ _id: otp._id }, { $set: { attempts: 0, lockedUntil, expiresAt: now } })
      throw lockedError(lockedUntil, now)
    }
    await otps().updateOne({ _id: otp._id }, { $set: { attempts } })
    const attemptsLeft = params.OTP_MAX_ATTEMPTS - attempts
    throw new HttpError(400, "VALIDATION_ERROR", `Mã OTP không đúng, còn ${attemptsLeft} lần thử`, { fields: { otp: "Mã OTP không đúng" }, attemptsLeft })
  }

  await otps().deleteOne({ _id: otp._id }) // mã dùng 1 lần
  req.session.lookup = { phone: otp.phone, until: now.getTime() + params.LOOKUP_SESSION_MINUTES * MINUTE }
  return { maskedPhone: st.maskPhoneShort(otp.phone), expiresIn: params.LOOKUP_SESSION_MINUTES * 60 }
}

// SĐT đã xác thực trong phiên (còn hạn), không có thì null
function lookupPhone(req) {
  const l = req.session.lookup
  if (!l || l.until < Date.now()) return null
  return l.phone
}

function requireLookup(req) {
  const phone = lookupPhone(req)
  if (!phone) throw new HttpError(401, "UNAUTHORIZED", "Phiên tra cứu đã hết hạn, vui lòng xác minh lại")
  return phone
}

// API-57 danh sách đơn của SĐT; kèm trạng thái tài khoản để hiện "Gửi lại liên kết kích hoạt" (7a)
async function list(req) {
  const phone = requireLookup(req)
  const docs = await orders().find({ "customer.phone": phone }).sort({ createdAt: -1 }).limit(50).toArray()
  const user = await database.collection("users").findOne({ phone, role: "member" }, { projection: { status: 1 } })
  return {
    maskedPhone: st.maskPhoneShort(phone), // Che cả 3 số cuối như thông tin đơn
    accountStatus: user ? user.status : null,
    items: docs.map((o) => ({
      code: o.code, createdAt: o.createdAt, total: o.total, orderStatus: o.orderStatus, paymentStatus: o.paymentStatus,
      itemCount: o.items.length, firstItem: { name: o.items[0]?.name, image: o.items[0]?.image },
    })),
  }
}

// API-58 gửi lại liên kết kích hoạt (UC-ACC-04 1b): liên kết mới, liên kết cũ bị vô hiệu
async function resendActivation(req) {
  const phone = requireLookup(req)
  const user = await database.collection("users").findOne({ phone, role: "member" })
  if (!user || user.status !== "CHO_KICH_HOAT") throw new HttpError(409, "CONFLICT", "Tài khoản đã được kích hoạt, vui lòng đăng nhập")
  const devLink = await order.sendActivation(user)
  return { sent: true, maskedPhone: st.maskPhone(phone), devLink }
}

module.exports = { readTarget, sendOtp, verify, lookupPhone, list, resendActivation }
