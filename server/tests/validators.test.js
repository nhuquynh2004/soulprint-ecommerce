const test = require("node:test")
const assert = require("node:assert")
const v = require("../utils/validators")

test("mật khẩu mạnh: ≥ 8 ký tự, chữ hoa, số, ký tự đặc biệt (NFR-SEC-02)", () => {
  assert.ok(v.isStrongPassword("Abc12345!"))
  assert.equal(v.isStrongPassword("abc12345!"), false)
  assert.equal(v.isStrongPassword("Abcdefgh!"), false)
  assert.equal(v.isStrongPassword("Abc12345"), false)
  assert.equal(v.isStrongPassword("Ab1!"), false)
})

test("đăng nhập bằng SĐT hoặc email; object lạ bị bỏ (NoSQL injection - NFR-SEC-08)", () => {
  assert.deepEqual(v.normalizeLogin("0901 234 567"), { phone: "0901234567" })
  assert.deepEqual(v.normalizeLogin("MinhAnh@Example.com"), { email: "minhanh@example.com" })
  assert.equal(v.normalizeLogin({ $ne: null }), null)
  assert.equal(v.normalizeLogin("12345"), null)
})

test("che email/SĐT khi hiển thị", () => {
  assert.equal(v.maskLogin({ phone: "0901234567" }), "0901 *** 567")
  assert.equal(v.maskLogin({ email: "minhanh@example.com" }), "mi***@example.com")
})
