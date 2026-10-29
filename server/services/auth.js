// Việc dùng chung của đăng nhập khách và nhân viên: tạo phiên, khóa khi sai nhiều lần, cookie ghi nhớ, voucher chào mừng.
const { database } = require("../config/db")
const params = require("../config/params")
const HttpError = require("../utils/httpError")

const MINUTE = 60 * 1000
const isProduction = () => process.env.NODE_ENV === "production"

// Dữ liệu tài khoản trả cho client (không có mật khẩu, bộ đếm sai...)
function publicUser(u) {
  return {
    _id: u._id,
    fullName: u.fullName,
    email: u.email || null,
    phone: u.phone,
    role: u.role,
    gender: u.gender || null,
    birthday: u.birthday || null,
    status: u.status,
  }
}

// "Mozilla/5.0 (Windows NT 10.0...) Chrome/140" -> "Chrome trên Windows" (06 Mục 6.3)
function shortUserAgent(ua = "") {
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Postman/.test(ua) ? "Postman" : "Trình duyệt khác"
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "thiết bị khác"
  return `${browser} trên ${os}`
}

// "113.161.45.12" -> "113.161.x.x"
function maskIp(ip = "") {
  const v4 = String(ip).replace(/^::ffff:/, "")
  const parts = v4.split(".")
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.x.x`
  return v4.split(":").slice(0, 2).join(":") + ":…"
}

// Tài khoản đang bị khóa đăng nhập 15 phút? Ném 423 kèm số giây còn lại (UC-ACC-02 4Eb)
function assertNotLocked(user) {
  if (user && user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
    const retryAfter = Math.ceil((new Date(user.lockedUntil) - Date.now()) / 1000)
    throw new HttpError(423, "LOCKED", "Bạn đã nhập sai quá 5 lần, vui lòng thử lại sau 15 phút hoặc dùng Quên mật khẩu", { retryAfter })
  }
}

// Ghi 1 lần sai; đủ 5 lần thì khóa 15 phút và ném 423
async function recordFailedLogin(user) {
  if (!user) return
  const fails = (user.failedLogins || 0) + 1
  if (fails >= params.LOGIN_MAX_FAILS) {
    const lockedUntil = new Date(Date.now() + params.LOGIN_LOCK_MINUTES * MINUTE)
    await database.collection("users").updateOne({ _id: user._id }, { $set: { failedLogins: 0, lockedUntil } })
    assertNotLocked({ lockedUntil })
  }
  await database.collection("users").updateOne({ _id: user._id }, { $set: { failedLogins: fails } })
}

// Phiên tách 2 phía: userId là tài khoản khách ở cửa hàng, staffId là nhân viên ở khu quản trị.
// Đăng nhập phía này không làm mất phiên phía kia trên cùng trình duyệt.
const sessionKey = (user) => (user.role === "admin" ? "staffId" : "userId")

// Tạo phiên mới sau khi đăng nhập: regenerate đổi mã phiên (NFR-SEC-03), lưu người dùng, thiết bị, IP.
// regenerate xóa dữ liệu phiên cũ nên:
// - khách đăng nhập: giữ giỏ Guest ở req.guestCart để gộp sau (mergeGuestCart), giữ staffId nếu có;
// - nhân viên đăng nhập: giữ nguyên dữ liệu phía cửa hàng (userId, giỏ Guest, chat vãng lai).
function startSession(req, user) {
  const key = sessionKey(user)
  const { cookie, staffId, ...store } = req.session
  let keep
  if (key === "userId") {
    req.guestCart = req.session.cart || null
    req.guestChatId = req.session.chatConversationId || null // hội thoại chat vãng lai, gộp vào tài khoản sau
    keep = staffId ? { staffId } : {}
  } else {
    keep = store
  }
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err)
      const now = new Date()
      Object.assign(req.session, keep)
      req.session[key] = String(user._id)
      req.session.userAgent = shortUserAgent(req.get("user-agent"))
      req.session.ip = req.ip
      req.session.createdAt = now
      req.session.lastSeenAt = now
      req.session.save((e) => (e ? reject(e) : resolve()))
    })
  })
}

async function onLoginSuccess(user) {
  await database
    .collection("users")
    .updateOne({ _id: user._id }, { $set: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } })
}

// Cookie "Ghi nhớ đăng nhập" theo slide 8.2: chỉ lưu Email/SĐT, không lưu mật khẩu; không HttpOnly để Angular đọc
// bằng ngx-cookie-service và điền sẵn ô đăng nhập
function setRememberCookie(res, name, login, remember) {
  if (remember) {
    res.cookie(name, login, {
      maxAge: params.REMEMBER_DAYS * 24 * 60 * MINUTE,
      httpOnly: false,
      secure: isProduction(),
      sameSite: "lax",
    })
  } else {
    res.clearCookie(name)
  }
}

// Cấp voucher chào mừng (UC-ACC-01 bước 6, UC-ACC-04 bước 4): mọi voucher bật "Tặng tự động khi đăng ký",
// hạn theo validDays của voucher (SOULPRINT10 30 ngày). Đã có thì thôi.
async function issueWelcomeVoucher(userId) {
  return require("./voucher").issueSignupVouchers(userId)
}

// Gộp giỏ Guest (session) vào giỏ Member (UC-ACC-01 bước 5, UC-ACC-02 bước 5).
// Trả số dòng trong giỏ để client hiện ở biểu tượng giỏ.
// Cùng lúc gộp hội thoại chat vãng lai của thiết bị vào tài khoản (UC-CSK-01); lỗi chat không chặn đăng nhập.
async function mergeGuestCart(req, userId) {
  const count = await require("./cart").mergeInto(userId, req.guestCart)
  req.guestCart = null
  const user = await database.collection("users").findOne({ _id: userId }, { projection: { fullName: 1 } })
  if (user) await require("./chat").adoptGuestConversation(req, user).catch((err) => console.error("Gộp hội thoại chat lỗi:", err.message))
  return count
}

module.exports = {
  sessionKey,
  publicUser, shortUserAgent, maskIp, assertNotLocked, recordFailedLogin, startSession, onLoginSuccess,
  setRememberCookie, issueWelcomeVoucher, mergeGuestCart,
}
