// Kiểm tra dữ liệu vào ở server (NFR-SEC-08): chỉ nhận chuỗi, cắt khoảng trắng, đúng định dạng.
// Không đưa thẳng object từ request vào truy vấn MongoDB để chặn NoSQL injection ({"$ne": null}).
const HttpError = require("./httpError")

// Lấy chuỗi từ body; không phải chuỗi (VD object {"$ne": null}) thì coi như rỗng
const str = (value) => (typeof value === "string" ? value.trim() : "")

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) && v.length <= 120
const isPhone = (v) => /^0\d{9}$/.test(v) // 10 số, bắt đầu bằng 0
const PASSWORD_HINT = "Mật khẩu cần tối thiểu 8 ký tự, gồm chữ hoa, số và ký tự đặc biệt"
// NFR-SEC-02: ≥ 8 ký tự, có chữ hoa, chữ số, ký tự đặc biệt
const isStrongPassword = (v) => typeof v === "string" && v.length >= 8 && v.length <= 72 && /[A-Z]/.test(v) && /\d/.test(v) && /[^A-Za-z0-9]/.test(v)

// Email hoặc SĐT dùng để đăng nhập: SĐT bỏ khoảng trắng, dấu chấm; email viết thường
function normalizeLogin(value) {
  const v = str(value)
  const phone = v.replace(/[\s.-]/g, "")
  if (isPhone(phone)) return { phone }
  if (isEmail(v.toLowerCase())) return { email: v.toLowerCase() }
  return null
}

// Câu truy vấn tìm tài khoản theo email hoặc SĐT (giá trị đã chuẩn hóa nên an toàn)
const loginQuery = (login) => (login.phone ? { phone: login.phone } : { email: login.email })

// Che bớt để hiển thị: "0901234567" -> "0901 *** 567", "minhanh@example.com" -> "mi***@example.com"
function maskLogin(login) {
  if (login.phone) return `${login.phone.slice(0, 4)} *** ${login.phone.slice(-3)}`
  const [name, domain] = login.email.split("@")
  return `${name.slice(0, 2)}***@${domain}`
}

// Gom lỗi theo trường rồi ném 400 VALIDATION_ERROR (07 Mục 1.2)
function assertFields(fields) {
  const errors = Object.fromEntries(Object.entries(fields).filter(([, msg]) => msg))
  if (Object.keys(errors).length) {
    throw new HttpError(400, "VALIDATION_ERROR", Object.values(errors)[0], { fields: errors })
  }
}

module.exports = { str, isEmail, isPhone, isStrongPassword, PASSWORD_HINT, normalizeLogin, loginQuery, maskLogin, assertFields }
