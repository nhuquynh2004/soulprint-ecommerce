// Đăng nhập Google: các hàm thuần của services/googleAuth.js - không gọi Google, không cần CSDL.
process.env.MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost/test"
const test = require("node:test")
const assert = require("node:assert")
const google = require("../services/googleAuth")

const CLIENT = "123.apps.googleusercontent.com"
const token = (claims) => ["x", Buffer.from(JSON.stringify(claims)).toString("base64url"), "sig"].join(".")
const valid = { aud: CLIENT, iss: "https://accounts.google.com", exp: Math.floor(Date.now() / 1000) + 600, sub: "1001", email: "Minh@Gmail.com", email_verified: true, name: "Minh Anh" }

test("returnUrl chỉ nhận đường dẫn nội bộ (NFR-SEC-01b)", () => {
  assert.strictEqual(google.safeReturnUrl("/gio-hang?x=1"), "/gio-hang?x=1")
  assert.strictEqual(google.safeReturnUrl("https://evil.com"), "/")
  assert.strictEqual(google.safeReturnUrl("//evil.com"), "/")
  assert.strictEqual(google.safeReturnUrl("/\\evil.com"), "/")
  assert.strictEqual(google.safeReturnUrl(undefined), "/")
})

test("đọc id_token: lấy email chữ thường, googleId, họ tên", () => {
  const p = google.readIdToken(token(valid), CLIENT)
  assert.deepStrictEqual(p, { googleId: "1001", email: "minh@gmail.com", emailVerified: true, fullName: "Minh Anh" })
})

test("id_token sai aud, sai iss hoặc hết hạn thì từ chối", () => {
  assert.throws(() => google.readIdToken(token({ ...valid, aud: "khac" }), CLIENT), /aud/)
  assert.throws(() => google.readIdToken(token({ ...valid, iss: "https://evil.com" }), CLIENT), /iss/)
  assert.throws(() => google.readIdToken(token({ ...valid, exp: 1 }), CLIENT), /hết hạn/)
})

test("state: đúng trả returnUrl, dùng lại lần 2 thì null, sai hoặc quá 10 phút thì null (AC12)", () => {
  process.env.GOOGLE_CLIENT_ID = CLIENT
  const s1 = {}
  const url = new URL(google.buildAuthUrl(s1, "/tai-khoan"))
  assert.strictEqual(url.searchParams.get("scope"), "openid email profile")
  const st1 = url.searchParams.get("state")
  assert.strictEqual(google.consumeState(s1, st1).returnUrl, "/tai-khoan")
  assert.strictEqual(google.consumeState(s1, st1), null)
  const s2 = {}
  const st2 = new URL(google.buildAuthUrl(s2, "/")).searchParams.get("state")
  assert.strictEqual(google.consumeState(s2, st2 + "x"), null)
  const s3 = {}
  const st3 = new URL(google.buildAuthUrl(s3, "/")).searchParams.get("state")
  s3.googleOAuth.at -= 11 * 60 * 1000
  assert.strictEqual(google.consumeState(s3, st3), null)
})
