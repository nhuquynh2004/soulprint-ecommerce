// Đăng nhập Google cho khách (UC-ACC-01 nhánh 2b, UC-ACC-02 nhánh 2b): OAuth 2.0 Authorization Code.
// Gọi Google bằng fetch + crypto có sẵn của Node, không SDK, không thêm gói. Phiên vẫn là express-session.
// Biến môi trường: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI (VD https://soulprint-shop.vercel.app/api/auth/google/callback).
const crypto = require("crypto")
const { database } = require("../config/db")

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
const TOKEN_URL = "https://oauth2.googleapis.com/token"
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"]
const STATE_TTL_MS = 10 * 60 * 1000

const users = () => database.collection("users")

function config() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    redirectUri: process.env.GOOGLE_REDIRECT_URI || `${process.env.CLIENT_ORIGIN || "http://localhost:4200"}/api/auth/google/callback`,
  }
}

const isConfigured = () => !!(config().clientId && config().clientSecret)

// Chỉ nhận đường dẫn nội bộ "/..." (không "//host", không "/\host") để chống chuyển hướng mở (NFR-SEC-01b)
function safeReturnUrl(value) {
  const s = typeof value === "string" ? value.trim() : ""
  if (!s.startsWith("/") || s.startsWith("//") || s.startsWith("/\\") || /[\r\n]/.test(s) || s.length > 500) return "/"
  return s
}

// URL trang chọn tài khoản Google; state ngẫu nhiên lưu trong phiên kèm returnUrl, hạn 10 phút
function buildAuthUrl(session, returnUrl) {
  const state = crypto.randomBytes(32).toString("hex")
  session.googleOAuth = { state, returnUrl: safeReturnUrl(returnUrl), at: Date.now() }
  const { clientId, redirectUri } = config()
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  })
  return `${AUTH_URL}?${q}`
}

// Lấy và xóa state trong phiên; sai hoặc quá hạn thì trả null
function consumeState(session, state) {
  const saved = session.googleOAuth
  delete session.googleOAuth
  if (!saved || typeof state !== "string" || !state) return null
  const a = Buffer.from(saved.state)
  const b = Buffer.from(state)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  if (Date.now() - saved.at > STATE_TTL_MS) return null
  return saved
}

// id_token nhận trực tiếp từ Google qua HTTPS (token endpoint) nên chỉ cần đọc phần thân và kiểm các trường
// (theo hướng dẫn OpenID Connect của Google); không tự nhận id_token từ trình duyệt.
function readIdToken(idToken, clientId, now = Date.now()) {
  const part = String(idToken || "").split(".")[1]
  if (!part) throw new Error("id_token rỗng")
  const claims = JSON.parse(Buffer.from(part, "base64url").toString("utf8"))
  if (claims.aud !== clientId) throw new Error("aud không khớp")
  if (!ISSUERS.includes(claims.iss)) throw new Error("iss không phải Google")
  if (!claims.exp || claims.exp * 1000 < now) throw new Error("id_token hết hạn")
  return {
    googleId: String(claims.sub || ""),
    email: String(claims.email || "").toLowerCase(),
    emailVerified: claims.email_verified === true || claims.email_verified === "true",
    fullName: String(claims.name || claims.given_name || "").trim().slice(0, 60),
  }
}

// Đổi mã một lần lấy id_token (fetch có sẵn của Node 18+)
async function exchangeCode(code) {
  const { clientId, clientSecret, redirectUri } = config()
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`Google token ${res.status}`)
  const data = await res.json()
  return readIdToken(data.id_token, clientId)
}

// Tìm tài khoản theo googleId rồi theo email (UC-ACC-02 nhánh 2b):
// khách đang hoạt động -> gắn googleId; chờ kích hoạt cùng email -> kích hoạt và gắn; chưa có -> tạo Member mới.
// Trả { user, created } hoặc { error: "staff" | "locked" }
async function findOrCreateUser(profile) {
  const now = new Date()
  let user = await users().findOne({ googleId: profile.googleId })
  if (!user) user = await users().findOne({ email: profile.email })
  if (user && user.role === "admin") return { error: "staff" }
  if (user && user.status === "BI_KHOA") return { error: "locked" }
  if (user) {
    const set = { googleId: profile.googleId, updatedAt: now }
    if (user.status === "CHO_KICH_HOAT") Object.assign(set, { status: "HOAT_DONG", activatedAt: now, email: profile.email })
    await users().updateOne({ _id: user._id }, { $set: set })
    return { user: { ...user, ...set }, created: false, activated: user.status === "CHO_KICH_HOAT" }
  }
  const fullName = profile.fullName.length >= 2 ? profile.fullName : profile.email.split("@")[0].slice(0, 60)
  const doc = {
    fullName, email: profile.email, googleId: profile.googleId, role: "member", status: "HOAT_DONG",
    staffRoles: [], permissionOverrides: [], addresses: [], wishlist: [], searchHistory: [],
    failedLogins: 0, lockedUntil: null, activatedAt: now, createdAt: now, updatedAt: now,
  }
  const result = await users().insertOne(doc)
  return { user: { ...doc, _id: result.insertedId }, created: true }
}

// Tài khoản tạo bằng Google chưa có SĐT: lấy SĐT người nhận của đơn đầu tiên nếu chưa thuộc tài khoản khác
async function fillMissingPhone(userId, phone) {
  if (!userId || !/^0\d{9}$/.test(String(phone || ""))) return
  const taken = await users().findOne({ phone }, { projection: { _id: 1 } })
  if (taken) return
  await users().updateOne({ _id: userId, phone: { $exists: false } }, { $set: { phone, updatedAt: new Date() } }).catch(() => {})
}

// Index SĐT cũ (unique không sparse) không cho nhiều tài khoản cùng thiếu SĐT: đổi sang partial một lần khi khởi động
// (06 Mục 1.1). CSDL nạp bằng seed đã có index mới thì bỏ qua.
async function ensureUserIndexes() {
  const col = users()
  const list = await col.indexes().catch(() => [])
  const phone = list.find((i) => i.name === "phone_1")
  if (phone && !phone.partialFilterExpression) await col.dropIndex("phone_1")
  if (!phone || !phone.partialFilterExpression) {
    await col.createIndex({ phone: 1 }, { name: "phone_1", unique: true, partialFilterExpression: { phone: { $type: "string" } } })
  }
  if (!list.find((i) => i.name === "googleId_1")) await col.createIndex({ googleId: 1 }, { name: "googleId_1", unique: true, sparse: true })
}

module.exports = { isConfigured, safeReturnUrl, buildAuthUrl, consumeState, readIdToken, exchangeCode, findOrCreateUser, fillMissingPhone, ensureUserIndexes }
