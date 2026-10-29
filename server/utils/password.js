// Băm và kiểm tra mật khẩu bằng crypto.scrypt có sẵn của Node (không cài bcrypt).
// Mỗi mật khẩu có salt riêng; lưu passwordHash và passwordSalt dạng hex (06_DataModel.md Mục 1.1).
const crypto = require("crypto")
const { promisify } = require("util")

const scrypt = promisify(crypto.scrypt)
const KEY_LENGTH = 64

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex")
  const hash = await scrypt(password, salt, KEY_LENGTH)
  return { passwordHash: hash.toString("hex"), passwordSalt: salt }
}

async function verifyPassword(password, passwordHash, passwordSalt) {
  if (!passwordHash || !passwordSalt) return false
  const hash = await scrypt(password, passwordSalt, KEY_LENGTH)
  const stored = Buffer.from(passwordHash, "hex")
  // So sánh thời gian cố định để không lộ thông tin qua thời gian phản hồi.
  return stored.length === hash.length && crypto.timingSafeEqual(stored, hash)
}

module.exports = { hashPassword, verifyPassword }
