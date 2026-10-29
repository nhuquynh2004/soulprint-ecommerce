const test = require("node:test")
const assert = require("node:assert")
const { hashPassword, verifyPassword } = require("../utils/password")

test("băm rồi kiểm tra đúng mật khẩu", async () => {
  const { passwordHash, passwordSalt } = await hashPassword("Member@123")
  assert.ok(await verifyPassword("Member@123", passwordHash, passwordSalt))
})

test("sai mật khẩu thì trả false", async () => {
  const { passwordHash, passwordSalt } = await hashPassword("Member@123")
  assert.equal(await verifyPassword("member@123", passwordHash, passwordSalt), false)
})

test("cùng mật khẩu nhưng 2 lần băm cho kết quả khác nhau (salt riêng)", async () => {
  const a = await hashPassword("Admin@123")
  const b = await hashPassword("Admin@123")
  assert.notEqual(a.passwordHash, b.passwordHash)
})

test("tài khoản chưa có mật khẩu (CHO_KICH_HOAT) luôn trả false", async () => {
  assert.equal(await verifyPassword("bat-ky", undefined, undefined), false)
})
