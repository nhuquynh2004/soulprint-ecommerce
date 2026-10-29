// Token liên kết (kích hoạt, đặt lại mật khẩu) và mã OTP - lưu dạng băm SHA-256, có hạn (NFR-SEC-07, BR-25).
const crypto = require("crypto")
const { database } = require("../config/db")

const sha256 = (text) => crypto.createHash("sha256").update(String(text)).digest("hex")
const MINUTE = 60 * 1000

// Tạo token mới cho tài khoản, vô hiệu token cũ cùng mục đích. Trả token gốc (chỉ gửi cho người dùng, không lưu).
async function createToken(userId, purpose, ttlMinutes) {
  const tokens = database.collection("tokens")
  await tokens.updateMany({ userId, purpose, usedAt: null }, { $set: { usedAt: new Date() } })
  const token = crypto.randomBytes(32).toString("base64url")
  await tokens.insertOne({
    userId, purpose, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMinutes * MINUTE), usedAt: null, createdAt: new Date(),
  })
  return token
}

// Tìm token còn hạn, chưa dùng. Không có thì null.
async function findValidToken(token) {
  if (typeof token !== "string" || token.length < 20) return null
  return database.collection("tokens").findOne({ tokenHash: sha256(token), usedAt: null, expiresAt: { $gt: new Date() } })
}

// Mục đích của token kể cả khi đã dùng hoặc hết hạn: SCR-14 hiện đúng lời nhắn (UC-ACC-04 2Ea, UC-ACC-02)
async function tokenPurpose(token) {
  if (typeof token !== "string" || token.length < 20) return null
  const doc = await database.collection("tokens").findOne({ tokenHash: sha256(token) }, { projection: { purpose: 1 } })
  return doc ? doc.purpose : null
}

async function markTokenUsed(doc) {
  await database.collection("tokens").updateOne({ _id: doc._id }, { $set: { usedAt: new Date() } })
}

// Mã 6 số ngẫu nhiên (crypto, không dùng Math.random)
const newOtpCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, "0")

module.exports = { sha256, createToken, findValidToken, tokenPurpose, markTokenUsed, newOtpCode }
