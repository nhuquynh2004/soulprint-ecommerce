// Tài khoản (07_API_Spec.md Mục 2.2): API-07 thông tin cá nhân, API-08 đổi mật khẩu (khách và nhân viên),
// API-09 đến API-12 sổ địa chỉ (UC-ACC-03, BR-22). Đủ GET, POST, PUT (_id trong body - slide 6.7.4), DELETE.
const { database, ObjectId } = require("../config/db")
const HttpError = require("../utils/httpError")
const v = require("../utils/validators")
const { hashPassword, verifyPassword } = require("../utils/password")
const { publicUser } = require("../services/auth")
const st = require("../services/orderState")

const users = () => database.collection("users")
const GENDERS = ["NAM", "NU", "KHAC"]

// API-07 PUT /api/account/profile - email không sửa được (AC2)
async function updateProfile(req, res) {
  const fullName = v.str(req.body.fullName)
  const phone = v.str(req.body.phone).replace(/[\s.]/g, "")
  const gender = req.body.gender == null || req.body.gender === "" ? null : v.str(req.body.gender)
  const birthday = req.body.birthday ? new Date(req.body.birthday) : null
  v.assertFields({
    fullName: fullName.length >= 2 && fullName.length <= 60 ? "" : "Họ tên cần 2-60 ký tự",
    phone: v.isPhone(phone) ? "" : "Số điện thoại cần 10 số, bắt đầu bằng 0",
    gender: gender === null || GENDERS.includes(gender) ? "" : "Giới tính không hợp lệ",
    birthday: birthday === null || (!isNaN(birthday) && birthday < new Date() && birthday.getFullYear() > 1900) ? "" : "Ngày sinh không hợp lệ",
  })
  const taken = await users().findOne({ phone, _id: { $ne: req.user._id } })
  if (taken) throw new HttpError(409, "CONFLICT", "Số điện thoại này đã được sử dụng", { fields: { phone: "Số điện thoại này đã được sử dụng" } })

  const set = { fullName, phone, gender, birthday, updatedAt: new Date() }
  await users().updateOne({ _id: req.user._id }, { $set: set })
  res.send({ user: publicUser({ ...req.user, ...set }) })
}

// API-08 PUT /api/account/password
async function changePassword(req, res) {
  const { currentPassword, newPassword, confirmPassword } = req.body
  v.assertFields({
    newPassword: v.isStrongPassword(newPassword) ? "" : v.PASSWORD_HINT,
    confirmPassword: newPassword === confirmPassword ? "" : "Mật khẩu xác nhận không khớp",
  })
  // Tài khoản tạo bằng Google chưa có mật khẩu: "Đặt mật khẩu" không cần mật khẩu hiện tại
  const ok = !req.user.passwordHash || (typeof currentPassword === "string" && (await verifyPassword(currentPassword, req.user.passwordHash, req.user.passwordSalt)))
  if (!ok) {
    throw new HttpError(422, "BUSINESS_RULE", "Mật khẩu hiện tại không đúng", { fields: { currentPassword: "Mật khẩu hiện tại không đúng" } })
  }
  await users().updateOne({ _id: req.user._id }, { $set: { ...(await hashPassword(newPassword)), updatedAt: new Date() } })
  res.status(204).send()
}

// Kiểm tra 1 địa chỉ (địa giới 2 cấp tỉnh/thành - phường/xã)
function readAddress(body) {
  const a = {
    recipientName: v.str(body.recipientName),
    phone: v.str(body.phone).replace(/[\s.]/g, ""),
    province: v.str(body.province),
    ward: v.str(body.ward),
    street: v.str(body.street),
    isDefault: body.isDefault === true,
  }
  v.assertFields({
    recipientName: a.recipientName.length >= 2 && a.recipientName.length <= 60 ? "" : "Tên người nhận cần 2-60 ký tự",
    phone: v.isPhone(a.phone) ? "" : "Số điện thoại cần 10 số, bắt đầu bằng 0",
    province: a.province && a.province.length <= 60 ? "" : "Vui lòng chọn Tỉnh/Thành phố",
    ward: a.ward && a.ward.length <= 80 ? "" : "Vui lòng chọn Phường/Xã",
    street: a.street.length >= 3 && a.street.length <= 200 ? "" : "Nhập số nhà, tên đường (3-200 ký tự)",
  })
  return a
}

const sortAddresses = (list) => [...list].sort((x, y) => Number(y.isDefault) - Number(x.isDefault))

async function currentAddresses(userId) {
  const user = await users().findOne({ _id: userId }, { projection: { addresses: 1 } })
  return (user && user.addresses) || []
}

// API-09 GET /api/account/addresses
async function getAddresses(req, res) {
  res.send(sortAddresses(req.user.addresses || []))
}

// Chỉ 1 địa chỉ mặc định ("Địa chỉ của tôi" - AC3); chưa có địa chỉ nào thì địa chỉ đầu tiên thành mặc định
async function saveAddresses(userId, list) {
  await users().updateOne({ _id: userId }, { $set: { addresses: list, updatedAt: new Date() } })
}

// API-10 POST /api/account/addresses
async function addAddress(req, res) {
  const a = readAddress(req.body)
  let list = await currentAddresses(req.user._id)
  const address = { _id: new ObjectId(), ...a, isDefault: a.isDefault || list.length === 0 }
  if (address.isDefault) list = list.map((x) => ({ ...x, isDefault: false }))
  list.push(address)
  await saveAddresses(req.user._id, list)
  res.status(201).send({ address })
}

// API-11 PUT /api/account/addresses - _id trong body
async function updateAddress(req, res) {
  const id = v.str(req.body._id)
  if (!ObjectId.isValid(id)) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy địa chỉ")
  const a = readAddress(req.body)
  let list = await currentAddresses(req.user._id)
  const index = list.findIndex((x) => x._id.equals(new ObjectId(id)))
  if (index < 0) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy địa chỉ")
  // Bỏ chọn mặc định ở địa chỉ đang là mặc định thì vẫn giữ (luôn có 1 "Địa chỉ của tôi")
  const isDefault = a.isDefault || list[index].isDefault
  if (isDefault) list = list.map((x) => ({ ...x, isDefault: false }))
  list[index] = { ...list[index], ...a, isDefault }
  await saveAddresses(req.user._id, list)
  res.send({ address: list[index] })
}

// API-12 DELETE /api/account/addresses/:id
async function deleteAddress(req, res) {
  const id = req.params["id"]
  if (!ObjectId.isValid(id)) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy địa chỉ")
  let list = await currentAddresses(req.user._id)
  const removed = list.find((x) => x._id.equals(new ObjectId(id)))
  if (!removed) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy địa chỉ")
  list = list.filter((x) => x !== removed)
  // Xóa địa chỉ mặc định thì địa chỉ còn lại đầu tiên thành mặc định
  if (removed.isDefault && list.length) list[0] = { ...list[0], isDefault: true }
  await saveAddresses(req.user._id, list)
  res.status(204).send()
}

// ===== Tài khoản nhận tiền hoàn ở Thông tin cá nhân (UC-ACC-03 nhánh 1e) =====

const refundAccountView = (a) => (a ? { bankName: a.bankName, accountName: a.accountName, account: st.maskAccount(a.accountNumber), savedAt: a.savedAt || null } : null)

// API-226 GET /api/account/refund-account
async function getRefundAccount(req, res) {
  const u = await users().findOne({ _id: req.user._id }, { projection: { refundAccount: 1 } })
  res.send({ account: refundAccountView(u?.refundAccount) })
}

// API-227 PUT /api/account/refund-account - {bankName, accountNumber, accountName}; kiểm như khi hủy đơn (API-44)
async function saveRefundAccount(req, res) {
  const { account, errors } = st.readRefundAccount(req.body)
  const fields = Object.fromEntries(Object.entries(errors).filter(([, m]) => m))
  if (Object.keys(fields).length) throw new HttpError(400, "VALIDATION_ERROR", Object.values(fields)[0], { fields })
  const now = new Date()
  const refundAccount = { ...account, savedAt: now }
  await users().updateOne({ _id: req.user._id }, { $set: { refundAccount, updatedAt: now } })
  res.send({ account: refundAccountView(refundAccount) })
}

// API-228 DELETE /api/account/refund-account - yêu cầu hoàn đã tạo giữ bankInfo riêng nên không ảnh hưởng
async function deleteRefundAccount(req, res) {
  await users().updateOne({ _id: req.user._id }, { $unset: { refundAccount: "" }, $set: { updatedAt: new Date() } })
  res.status(204).send()
}

module.exports = {
  updateProfile, changePassword, getAddresses, addAddress, updateAddress, deleteAddress,
  getRefundAccount, saveRefundAccount, deleteRefundAccount,
}
