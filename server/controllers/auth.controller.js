// Xác thực phía khách (07_API_Spec.md Mục 2.1): API-01 đăng ký, API-02 đăng nhập, API-03 đăng xuất, API-04 tôi là ai,
// API-05 + API-185 quên mật khẩu bằng mã 6 số, API-06 đặt mật khẩu (đặt lại, kích hoạt).
const { database } = require("../config/db")
const params = require("../config/params")
const HttpError = require("../utils/httpError")
const { hashPassword, verifyPassword } = require("../utils/password")
const v = require("../utils/validators")
const auth = require("../services/auth")
const { sha256, createToken, findValidToken, tokenPurpose, markTokenUsed, newOtpCode } = require("../services/tokens")
const { notifier } = require("../services/notifier")
const { destroyUserSessions } = require("../middlewares/auth")
const google = require("../services/googleAuth")

const users = () => database.collection("users")
const MINUTE = 60 * 1000
const INVALID = "Email/Số điện thoại hoặc mật khẩu không chính xác"

// Kiểm tra form đăng ký/đặt mật khẩu (UC-ACC-01 bước 4)
function passwordErrors(password, confirmPassword) {
  return {
    password: v.isStrongPassword(password) ? "" : v.PASSWORD_HINT,
    confirmPassword: password === confirmPassword ? "" : "Mật khẩu xác nhận không khớp",
  }
}

// API-01 POST /api/auth/register
async function register(req, res) {
  const fullName = v.str(req.body.fullName)
  const email = v.str(req.body.email).toLowerCase()
  const phone = v.str(req.body.phone).replace(/[\s.]/g, "")
  const { password, confirmPassword } = req.body
  v.assertFields({
    fullName: fullName.length >= 2 && fullName.length <= 60 ? "" : "Họ tên cần 2-60 ký tự",
    email: v.isEmail(email) ? "" : "Email không hợp lệ",
    phone: v.isPhone(phone) ? "" : "Số điện thoại cần 10 số, bắt đầu bằng 0",
    ...passwordErrors(password, confirmPassword),
    acceptTerms: req.body.acceptTerms === true ? "" : "Vui lòng đồng ý Điều khoản sử dụng và Chính sách bảo mật",
  })

  const [byEmail, byPhone] = await Promise.all([users().findOne({ email }), users().findOne({ phone })])
  // SĐT của tài khoản chờ kích hoạt tạo từ Guest Checkout: hoàn tất tài khoản đó, giữ lịch sử đơn (nhánh 4a)
  const pending = byPhone && byPhone.status === "CHO_KICH_HOAT" && byPhone.role === "member" ? byPhone : null
  const fields = {}
  if (byEmail && !(pending && byEmail._id.equals(pending._id))) fields.email = "Email này đã được sử dụng"
  if (byPhone && !pending) fields.phone = "Số điện thoại này đã được sử dụng"
  if (Object.keys(fields).length) throw new HttpError(409, "CONFLICT", Object.values(fields)[0], { fields })

  const now = new Date()
  const data = { fullName, email, phone, ...(await hashPassword(password)), status: "HOAT_DONG", activatedAt: now, updatedAt: now }
  let user
  if (pending) {
    await users().updateOne({ _id: pending._id }, { $set: data })
    user = { ...pending, ...data }
  } else {
    user = {
      ...data, role: "member", staffRoles: [], permissionOverrides: [], addresses: [], wishlist: [], searchHistory: [],
      failedLogins: 0, lockedUntil: null, createdAt: now,
    }
    const result = await users().insertOne(user)
    user._id = result.insertedId
  }

  const welcomeVoucher = await auth.issueWelcomeVoucher(user._id)
  await auth.startSession(req, user)
  await auth.onLoginSuccess(user)
  const cartCount = await auth.mergeGuestCart(req, user._id)
  res.status(201).send({ user: auth.publicUser(user), welcomeVoucher, cartCount })
}

// Kiểm tra Email/SĐT + mật khẩu, dùng chung cho đăng nhập khách và nhân viên.
// Sai thì luôn cùng 1 thông báo, không nói trường nào sai, không lộ tài khoản có tồn tại (NFR-SEC-06).
async function checkCredentials(body) {
  const login = v.normalizeLogin(body.login)
  const password = typeof body.password === "string" ? body.password : ""
  if (!login || !password) throw new HttpError(401, "INVALID_CREDENTIALS", INVALID)
  const user = await users().findOne(v.loginQuery(login))
  auth.assertNotLocked(user)
  const ok = user && (await verifyPassword(password, user.passwordHash, user.passwordSalt))
  return { login, user, ok }
}

// API-02 POST /api/auth/login - chỉ nhận tài khoản khách
async function login(req, res) {
  const { user, ok } = await checkCredentials(req.body)
  if (!ok) {
    await auth.recordFailedLogin(user)
    // Tài khoản chờ kích hoạt: gợi ý kích hoạt qua Tra cứu đơn hàng (4Ec)
    const hint = user && user.status === "CHO_KICH_HOAT" && user.role === "member"
      ? "Nếu bạn từng đặt hàng không cần tài khoản, hãy kích hoạt qua Tra cứu đơn hàng" : undefined
    throw new HttpError(401, "INVALID_CREDENTIALS", INVALID, hint ? { hint } : {})
  }
  if (user.role === "admin") {
    throw new HttpError(403, "USE_ADMIN_LOGIN", "Đây là tài khoản nhân viên, vui lòng đăng nhập ở trang quản trị")
  }
  if (user.status === "BI_KHOA") {
    throw new HttpError(403, "ACCOUNT_LOCKED", "Tài khoản đã bị khóa, vui lòng liên hệ Soulprint để được hỗ trợ")
  }

  await auth.startSession(req, user)
  await auth.onLoginSuccess(user)
  auth.setRememberCookie(res, "remember_user", v.str(req.body.login), req.body.rememberMe === true)
  const cartCount = await auth.mergeGuestCart(req, user._id)
  res.send({ user: auth.publicUser(user), cartCount })
}

// API-03 POST /api/auth/logout (khách) và API-212 POST /api/admin/auth/logout (nhân viên): chỉ thoát phía đang gọi,
// phía còn lại trên cùng trình duyệt vẫn đăng nhập. Không còn ai thì hủy phiên, xóa cookie.
async function logout(req, res) {
  const { isAdminArea } = require("../middlewares/auth")
  delete req.session[isAdminArea(req) ? "staffId" : "userId"]
  if (req.session.userId || req.session.staffId) {
    await new Promise((resolve, reject) => req.session.save((e) => (e ? reject(e) : resolve())))
  } else {
    await new Promise((resolve) => req.session.destroy(resolve))
    res.clearCookie("sid")
  }
  res.status(204).send()
}

// API-04 GET /api/auth/me (cửa hàng) và API-213 GET /api/admin/auth/me (khu quản trị) -
// Angular dùng cho guard, thanh điều hướng, ẩn/khóa nút
async function me(req, res) {
  if (!req.user) return res.send({ user: null })
  const user = auth.publicUser(req.user)
  user.hasPassword = !!req.user.passwordHash // Tài khoản tạo bằng Google chưa đặt mật khẩu
  user.googleLinked = !!req.user.googleId
  if (req.user.role === "admin") {
    user.staffRoles = (req.staffRoles || []).map((r) => ({ code: r.code, name: r.name }))
    user.isFullAccess = !!req.isFullAccess
    user.permissions = [...req.permissions]
  }
  res.send({ user })
}

// API-05 POST /api/auth/forgot-password - gửi mã 6 số. Luôn trả cùng thông báo.
async function forgotPassword(req, res) {
  const login = v.normalizeLogin(req.body.login)
  v.assertFields({ login: login ? "" : "Nhập email hoặc số điện thoại hợp lệ" })

  // Chặn gửi liên tục: ghi thời điểm gửi trong phiên, áp dụng như nhau dù tài khoản có hay không
  const key = login.phone || login.email
  const sent = (req.session.resetSentAt || {})[key]
  if (sent && Date.now() - sent < params.OTP_RESEND_SECONDS * 1000) {
    const retryAfter = Math.ceil((params.OTP_RESEND_SECONDS * 1000 - (Date.now() - sent)) / 1000)
    throw new HttpError(429, "QUOTA_EXCEEDED", `Vui lòng chờ ${retryAfter} giây trước khi gửi lại mã`, { retryAfter })
  }
  req.session.resetSentAt = { ...(req.session.resetSentAt || {}), [key]: Date.now() }

  const result = {
    message: "Nếu tài khoản tồn tại, mã xác minh 6 số đã được gửi",
    maskedTarget: v.maskLogin(login),
    resendAfter: params.OTP_RESEND_SECONDS,
  }
  const user = await users().findOne({ ...v.loginQuery(login), status: "HOAT_DONG" })
  if (user) {
    const code = newOtpCode()
    const now = new Date()
    const otps = database.collection("otps")
    const existing = await otps.findOne({ target: String(user._id), purpose: "DAT_LAI_MAT_KHAU" })
    await otps.updateOne(
      { target: String(user._id), purpose: "DAT_LAI_MAT_KHAU" },
      {
        $set: {
          codeHash: sha256(code),
          expiresAt: new Date(now.getTime() + params.OTP_TTL_MINUTES * MINUTE),
          attempts: 0,
          // Đang bị khóa xác minh thì gửi mã mới cũng không mở khóa
          lockedUntil: existing && existing.lockedUntil > now ? existing.lockedUntil : null,
          purgeAt: new Date(now.getTime() + 24 * 60 * MINUTE),
          createdAt: now,
        },
      },
      { upsert: true }
    )
    Object.assign(result, await notifier.sendOtp(user, code, "Mã xác minh đặt lại mật khẩu"))
  }
  res.send(result)
}

// API-185 POST /api/auth/verify-reset-code - đúng mã thì trả token đặt lại hạn 15 phút
async function verifyResetCode(req, res) {
  const login = v.normalizeLogin(req.body.login)
  const code = v.str(req.body.code)
  v.assertFields({ code: /^\d{6}$/.test(code) ? "" : "Mã xác minh gồm 6 chữ số" })
  const expired = () => new HttpError(410, "EXPIRED", "Mã đã hết hạn. Bấm Gửi lại mã để nhận mã mới")

  const user = login && (await users().findOne({ ...v.loginQuery(login), status: "HOAT_DONG" }))
  const otps = database.collection("otps")
  const otp = user && (await otps.findOne({ target: String(user._id), purpose: "DAT_LAI_MAT_KHAU" }))
  if (!otp) throw expired()

  const now = new Date()
  if (otp.lockedUntil && otp.lockedUntil > now) {
    const retryAfter = Math.ceil((otp.lockedUntil - now) / 1000)
    throw new HttpError(423, "LOCKED", "Bạn đã nhập sai quá 5 lần, vui lòng thử lại sau 15 phút", { retryAfter })
  }
  if (otp.expiresAt < now) throw expired()

  if (sha256(code) !== otp.codeHash) {
    const attempts = (otp.attempts || 0) + 1
    if (attempts >= params.OTP_MAX_ATTEMPTS) {
      const lockedUntil = new Date(now.getTime() + params.OTP_LOCK_MINUTES * MINUTE)
      await otps.updateOne({ _id: otp._id }, { $set: { attempts: 0, lockedUntil, expiresAt: now } })
      throw new HttpError(423, "LOCKED", "Bạn đã nhập sai quá 5 lần, vui lòng thử lại sau 15 phút", {
        retryAfter: params.OTP_LOCK_MINUTES * 60,
      })
    }
    await otps.updateOne({ _id: otp._id }, { $set: { attempts } })
    const attemptsLeft = params.OTP_MAX_ATTEMPTS - attempts
    throw new HttpError(400, "VALIDATION_ERROR", `Mã xác minh không đúng, bạn còn ${attemptsLeft} lần thử`, {
      fields: { code: "Mã xác minh không đúng" },
      attemptsLeft,
    })
  }

  await otps.deleteOne({ _id: otp._id }) // mã dùng 1 lần
  const resetToken = await createToken(user._id, "DAT_LAI_MAT_KHAU", params.RESET_TOKEN_TTL_MINUTES)
  res.send({ resetToken })
}

async function tokenInfo(token) {
  const doc = await findValidToken(token)
  // Kèm mục đích token để SCR-14 hiện "nhận liên kết mới tại Tra cứu đơn hàng" cho liên kết kích hoạt (UC-ACC-04 2Ea)
  if (!doc) throw new HttpError(410, "EXPIRED", "Liên kết hoặc phiên đặt mật khẩu đã hết hạn", { purpose: await tokenPurpose(token) })
  const user = await users().findOne({ _id: doc.userId })
  if (!user || user.status === "BI_KHOA") throw new HttpError(410, "EXPIRED", "Liên kết hoặc phiên đặt mật khẩu đã hết hạn", { purpose: doc.purpose })
  return { doc, user }
}

// API-06 GET /api/auth/set-password/:token - thông tin chỉ đọc cho SCR-14
async function setPasswordInfo(req, res) {
  const { doc, user } = await tokenInfo(req.params["token"])
  res.send({ purpose: doc.purpose, fullName: user.fullName, phone: v.maskLogin({ phone: user.phone }), role: user.role })
}

// API-06 POST /api/auth/set-password - đặt lại mật khẩu (token từ API-185) hoặc kích hoạt tài khoản (token trong liên kết)
async function setPassword(req, res) {
  const { password, confirmPassword } = req.body
  const { doc, user } = await tokenInfo(req.body.token)
  v.assertFields(passwordErrors(password, confirmPassword))

  const set = { ...(await hashPassword(password)), failedLogins: 0, lockedUntil: null, updatedAt: new Date() }
  if (doc.purpose === "KICH_HOAT") {
    set.status = "HOAT_DONG"
    set.activatedAt = new Date()
  }
  await users().updateOne({ _id: user._id }, { $set: set })
  await markTokenUsed(doc)

  if (doc.purpose === "DAT_LAI_MAT_KHAU" && req.body.logoutOthers === true) await destroyUserSessions(user._id)

  // Kích hoạt tài khoản khách: cấp voucher chào mừng và đăng nhập ngay (UC-ACC-04 bước 4).
  // Nhân viên mới tự đăng nhập ở trang quản trị (UC-ACC-07 bước 6).
  let loggedIn = false
  if (doc.purpose === "KICH_HOAT" && user.role === "member") {
    await auth.issueWelcomeVoucher(user._id)
    await auth.startSession(req, user)
    await auth.onLoginSuccess(user)
    await auth.mergeGuestCart(req, user._id)
    loggedIn = true
  }
  res.send({ purpose: doc.purpose, role: user.role, fullName: user.fullName, loggedIn })
}

// API-199 GET /api/auth/google?returnUrl= - chuyển sang trang chọn tài khoản Google
function googleStart(req, res) {
  if (!google.isConfigured()) return res.redirect(clientUrl("/dang-nhap?google=unavailable"))
  res.redirect(google.buildAuthUrl(req.session, req.query.returnUrl))
}

// API-200 GET /api/auth/google/callback?code&state - Google gọi về qua trình duyệt (UC-ACC-02 nhánh 2b)
async function googleCallback(req, res) {
  const fail = (code) => res.redirect(clientUrl(`/dang-nhap?google=${code}`))
  const saved = google.consumeState(req.session, req.query.state)
  if (!saved || req.query.error || typeof req.query.code !== "string") return fail("failed")
  let profile
  try {
    profile = await google.exchangeCode(req.query.code)
  } catch (err) {
    console.error("Đăng nhập Google lỗi:", err.message)
    return fail("failed")
  }
  if (!profile.emailVerified || !profile.email || !profile.googleId) return fail("unverified")
  const found = await google.findOrCreateUser(profile)
  if (found.error) return fail(found.error)

  const welcome = found.created || found.activated ? await auth.issueWelcomeVoucher(found.user._id) : null
  await auth.startSession(req, found.user)
  await auth.onLoginSuccess(found.user)
  await auth.mergeGuestCart(req, found.user._id)
  const target = saved.returnUrl
  res.redirect(clientUrl(welcome ? target + (target.includes("?") ? "&" : "?") + "welcome=1" : target))
}

// Chuyển về Angular: CLIENT_ORIGIN trong môi trường (Vercel), đường dẫn đã qua safeReturnUrl
const clientUrl = (path) => (process.env.CLIENT_ORIGIN || "http://localhost:4200") + path

module.exports = { register, login, checkCredentials, logout, me, forgotPassword, verifyResetCode, setPasswordInfo, setPassword, googleStart, googleCallback }
