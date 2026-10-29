// Nhân viên (07_API_Spec.md Mục 2.12): API-134 danh sách, API-135 thêm, API-136 sửa / khóa / mở khóa,
// API-137 gửi lại liên kết kích hoạt (UC-ACC-07, BR-34, BR-38). Chỉ vai trò Quản trị (requireAdminOnly).
// Nhân viên không có DELETE: nghỉ việc thì khóa, giữ adminLogs.
const { database, ObjectId } = require("../config/db")
const params = require("../config/params")
const HttpError = require("../utils/httpError")
const v = require("../utils/validators")
const { FULL_ACCESS_ROLE, PERMISSION_SET } = require("../config/permissions")
const { splitOverrides } = require("../services/permissions")
const { createToken } = require("../services/tokens")
const { notifier } = require("../services/notifier")
const { writeLog } = require("../services/adminLog")
const { destroyUserSessions } = require("../middlewares/auth")

const users = () => database.collection("users")
const roles = () => database.collection("roles")
const rule = (message, ruleCode, extra = {}) => new HttpError(422, "BUSINESS_RULE", message, { rule: ruleCode, ...extra })

// Dữ liệu 1 dòng của bảng Nhân viên (SCR-57)
function staffRow(u, roleMap) {
  const overrides = u.permissionOverrides || []
  return {
    _id: u._id,
    fullName: u.fullName,
    email: u.email || null,
    phone: u.phone,
    staffRoles: (u.staffRoles || []).map((code) => ({ code, name: roleMap.get(code)?.name || code })),
    extraCount: overrides.filter((o) => o.type === "CAP_THEM").length,
    revokedCount: overrides.filter((o) => o.type === "THU_HOI").length,
    overrides: overrides.map(({ permission, type, expiresAt }) => ({ permission, type, expiresAt: expiresAt || null })),
    status: u.status,
    lockReason: u.lockReason || null,
    lastLoginAt: u.lastLoginAt || null,
    createdAt: u.createdAt || null,
  }
}

async function roleMapOf() {
  const list = await roles().find({}).toArray()
  return new Map(list.map((r) => [r.code, r]))
}

// API-134 GET /api/admin/staff?q=&role=&status=
async function listStaff(req, res) {
  const filter = { role: "admin" }
  const q = v.str(req.query.q)
  if (q) {
    const re = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" }
    filter.$or = [{ fullName: re }, { email: re }, { phone: re }]
  }
  if (v.str(req.query.role)) filter.staffRoles = v.str(req.query.role)
  if (["HOAT_DONG", "CHO_KICH_HOAT", "BI_KHOA"].includes(req.query.status)) filter.status = req.query.status
  const [list, roleMap] = await Promise.all([users().find(filter).sort({ createdAt: 1 }).toArray(), roleMapOf()])
  res.send(list.map((u) => staffRow(u, roleMap)))
}

// staffRoles: 1-2 mã có trong roles (BR-34)
function readRoles(value, roleMap) {
  const codes = [...new Set(Array.isArray(value) ? value.filter((c) => typeof c === "string") : [])]
  if (codes.length < 1 || codes.length > params.MAX_ROLES_PER_STAFF) throw rule("Chọn 1 hoặc 2 vai trò", "BR-34", { fields: { staffRoles: "Chọn 1 hoặc 2 vai trò" } })
  const unknown = codes.filter((c) => !roleMap.has(c))
  if (unknown.length) throw rule("Vai trò không tồn tại: " + unknown.join(", "), "BR-34")
  return codes
}

// Ngày hết hạn "YYYY-MM-DD" -> 23:59:59 GMT+7 của ngày đó; phải sau hôm nay (BR-38)
function readExpiry(value) {
  if (value === null || value === undefined || value === "") return null
  const day = String(value).slice(0, 10)
  const date = new Date(`${day}T23:59:59+07:00`)
  const endOfToday = new Date(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }) + "T23:59:59+07:00")
  if (isNaN(date) || date <= endOfToday) throw rule("Ngày hết hạn phải sau hôm nay", "BR-38", { fields: { expiresAt: "Ngày hết hạn phải sau hôm nay" } })
  return date
}

// Quyền riêng gửi lên (danh sách đầy đủ): kiểm tra theo BR-38 với bộ quyền của các vai trò đã chọn
function readOverrides(value, codes, roleMap, adminId) {
  const list = Array.isArray(value) ? value : []
  if (!list.length) return []
  if (codes.includes(FULL_ACCESS_ROLE)) throw rule("Vai trò Quản trị đã có toàn quyền, không cần quyền riêng", "BR-38")
  const rolePerms = codes.flatMap((c) => roleMap.get(c)?.permissions || [])
  const seen = new Set()
  const out = []
  for (const raw of list) {
    const permission = v.str(raw && raw.permission)
    const type = v.str(raw && raw.type)
    if (!PERMISSION_SET.has(permission)) throw rule(`Quyền ${permission || "(trống)"} không tồn tại hoặc chỉ dành cho Quản trị`, "BR-38")
    if (!["CAP_THEM", "THU_HOI"].includes(type)) throw rule("Loại quyền riêng phải là Cấp thêm hoặc Thu hồi", "BR-38")
    if (seen.has(permission)) throw rule(`Quyền ${permission} bị trùng`, "BR-38")
    seen.add(permission)
    out.push({ permission, type, expiresAt: readExpiry(raw.expiresAt), grantedBy: adminId, grantedAt: new Date() })
  }
  const { removed } = splitOverrides(out, rolePerms)
  if (removed.length) {
    const o = removed[0]
    throw rule(o.type === "CAP_THEM" ? `Vai trò đã có quyền ${o.permission}, không cần cấp thêm` : `Vai trò không có quyền ${o.permission} để thu hồi`, "BR-38")
  }
  return out
}

async function assertUnique(email, phone, exceptId = null) {
  const or = [{ phone }]
  if (email) or.push({ email })
  const found = await users().find({ $or: or, ...(exceptId ? { _id: { $ne: exceptId } } : {}) }).toArray()
  const fields = {}
  for (const u of found) {
    if (email && u.email === email) fields.email = "Email đã được dùng cho một tài khoản khác"
    if (u.phone === phone) fields.phone = "SĐT đã được dùng cho một tài khoản khác"
  }
  if (Object.keys(fields).length) throw new HttpError(409, "CONFLICT", "Email/SĐT đã được dùng cho một tài khoản khác", { fields })
}

// Gửi liên kết đặt mật khẩu cho nhân viên mới (BR-25, hạn 24 giờ). DEMO_MODE trả devLink để hiện trên màn hình.
async function sendActivation(user) {
  const token = await createToken(user._id, "KICH_HOAT", params.ACTIVATION_TTL_HOURS * 60)
  const path = `/dat-mat-khau/${token}`
  const origin = process.env.CLIENT_ORIGIN || "http://localhost:4200"
  const sent = await notifier.sendLink(user, "Lời mời tham gia khu quản trị Soulprint", origin + path)
  return sent.devLink ? { devLink: path } : {}
}

// API-135 POST /api/admin/staff
async function createStaff(req, res) {
  const fullName = v.str(req.body.fullName)
  const email = v.str(req.body.email).toLowerCase()
  const phone = v.str(req.body.phone).replace(/[\s.]/g, "")
  v.assertFields({
    fullName: fullName.length >= 2 && fullName.length <= 60 ? "" : "Họ tên cần 2-60 ký tự",
    email: v.isEmail(email) ? "" : "Email không hợp lệ",
    phone: v.isPhone(phone) ? "" : "Số điện thoại cần 10 số, bắt đầu bằng 0",
  })
  const roleMap = await roleMapOf()
  const codes = readRoles(req.body.staffRoles, roleMap)
  const overrides = readOverrides(req.body.permissionOverrides, codes, roleMap, req.user._id)
  await assertUnique(email, phone)

  const now = new Date()
  const user = {
    fullName, email, phone, role: "admin", staffRoles: codes, permissionOverrides: overrides, status: "CHO_KICH_HOAT",
    addresses: [], wishlist: [], searchHistory: [], failedLogins: 0, lockedUntil: null, createdBy: req.user._id, createdAt: now, updatedAt: now,
  }
  user._id = (await users().insertOne(user)).insertedId
  await writeLog({ adminId: req.user._id, action: "STAFF_UPDATE", targetType: "users", targetId: user._id, after: { fullName, email, phone, staffRoles: codes, overrides } })
  const extra = await sendActivation(user)
  res.status(201).send({ staff: staffRow(user, roleMap), message: `Đã gửi lời mời cho ${fullName}`, ...extra })
}

// Còn Quản trị nào khác đang hoạt động không (BR-34: luôn còn ít nhất 1)
async function otherActiveAdmins(exceptId) {
  return users().countDocuments({ _id: { $ne: exceptId }, role: "admin", status: "HOAT_DONG", staffRoles: FULL_ACCESS_ROLE })
}

// API-136 PUT /api/admin/staff - _id trong body
async function updateStaff(req, res) {
  const id = v.str(req.body._id)
  if (!ObjectId.isValid(id)) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy nhân viên")
  const staff = await users().findOne({ _id: new ObjectId(id), role: "admin" })
  if (!staff) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy nhân viên")
  const isSelf = staff._id.equals(req.user._id)
  const isAdmin = (staff.staffRoles || []).includes(FULL_ACCESS_ROLE)
  const roleMap = await roleMapOf()

  // Khóa / mở khóa (nhánh 1b)
  if (req.body.status !== undefined) {
    if (req.body.status === "BI_KHOA") {
      if (isSelf) throw rule("Bạn không thể tự gỡ quyền/khóa chính mình", "BR-34")
      if (isAdmin && staff.status === "HOAT_DONG" && !(await otherActiveAdmins(staff._id))) throw rule("Hệ thống cần ít nhất 1 Quản trị đang hoạt động", "BR-34")
      const reason = v.str(req.body.reason)
      v.assertFields({ reason: reason.length >= 3 && reason.length <= 500 ? "" : "Nhập lý do khóa (3-500 ký tự)" })
      await users().updateOne({ _id: staff._id }, { $set: { status: "BI_KHOA", lockReason: reason, lockedBy: req.user._id, lockedAt: new Date(), updatedAt: new Date() } })
      await destroyUserSessions(staff._id) // request tiếp theo của người đó nhận 401 (AC4)
      await writeLog({ adminId: req.user._id, action: "STAFF_UPDATE", targetType: "users", targetId: staff._id, reason, before: { status: staff.status }, after: { status: "BI_KHOA" } })
    } else if (req.body.status === "HOAT_DONG") {
      if (staff.status !== "BI_KHOA") throw rule("Tài khoản không ở trạng thái bị khóa", "BR-34")
      // Chưa từng đặt mật khẩu thì về Chờ kích hoạt
      const status = staff.passwordHash ? "HOAT_DONG" : "CHO_KICH_HOAT"
      await users().updateOne({ _id: staff._id }, { $set: { status, lockReason: null, lockedBy: null, lockedAt: null, updatedAt: new Date() } })
      await writeLog({ adminId: req.user._id, action: "STAFF_UPDATE", targetType: "users", targetId: staff._id, before: { status: "BI_KHOA" }, after: { status } })
    } else {
      throw new HttpError(400, "VALIDATION_ERROR", "Trạng thái không hợp lệ")
    }
    const fresh = await users().findOne({ _id: staff._id })
    return res.send({ staff: staffRow(fresh, roleMap), removedOverrides: [] })
  }

  // Sửa thông tin, vai trò, quyền riêng (nhánh 1a, 1d)
  const set = { updatedAt: new Date() }
  if (req.body.fullName !== undefined) {
    const fullName = v.str(req.body.fullName)
    v.assertFields({ fullName: fullName.length >= 2 && fullName.length <= 60 ? "" : "Họ tên cần 2-60 ký tự" })
    set.fullName = fullName
  }
  if (req.body.phone !== undefined) {
    const phone = v.str(req.body.phone).replace(/[\s.]/g, "")
    v.assertFields({ phone: v.isPhone(phone) ? "" : "Số điện thoại cần 10 số, bắt đầu bằng 0" })
    await assertUnique(null, phone, staff._id)
    set.phone = phone
  }

  let codes = staff.staffRoles || []
  if (req.body.staffRoles !== undefined) {
    codes = readRoles(req.body.staffRoles, roleMap)
    if (isAdmin && !codes.includes(FULL_ACCESS_ROLE)) {
      if (isSelf) throw rule("Bạn không thể tự gỡ quyền/khóa chính mình", "BR-34")
      if (staff.status === "HOAT_DONG" && !(await otherActiveAdmins(staff._id))) throw rule("Hệ thống cần ít nhất 1 Quản trị đang hoạt động", "BR-34")
    }
    set.staffRoles = codes
  }

  let removedOverrides = []
  const before = { fullName: staff.fullName, phone: staff.phone, staffRoles: staff.staffRoles, overrides: staff.permissionOverrides || [] }
  if (req.body.permissionOverrides !== undefined) {
    if (isSelf) throw rule("Bạn không thể tự gỡ quyền/khóa chính mình", "BR-34")
    // Giữ người cấp và thời điểm cấp của quyền riêng đã có
    const old = new Map((staff.permissionOverrides || []).map((o) => [o.permission + o.type, o]))
    set.permissionOverrides = readOverrides(req.body.permissionOverrides, codes, roleMap, req.user._id).map((o) => {
      const prev = old.get(o.permission + o.type)
      return prev ? { ...o, grantedBy: prev.grantedBy, grantedAt: prev.grantedAt } : o
    })
  } else if (set.staffRoles) {
    // Đổi vai trò: tự gỡ quyền riêng không còn tác dụng (BR-38) và báo lại
    const rolePerms = codes.includes(FULL_ACCESS_ROLE) ? null : codes.flatMap((c) => roleMap.get(c)?.permissions || [])
    const current = staff.permissionOverrides || []
    const split = rolePerms ? splitOverrides(current, rolePerms) : { valid: [], removed: current }
    set.permissionOverrides = split.valid
    removedOverrides = split.removed.map(({ permission, type }) => ({ permission, type }))
  }

  await users().updateOne({ _id: staff._id }, { $set: set })
  const fresh = await users().findOne({ _id: staff._id })
  await writeLog({
    adminId: req.user._id, action: "STAFF_UPDATE", targetType: "users", targetId: staff._id, before,
    after: { fullName: fresh.fullName, phone: fresh.phone, staffRoles: fresh.staffRoles, overrides: fresh.permissionOverrides },
  })
  if (set.permissionOverrides) {
    await writeLog({ adminId: req.user._id, action: "PERMISSION_OVERRIDE", targetType: "users", targetId: staff._id, before: before.overrides, after: fresh.permissionOverrides, reason: removedOverrides.length ? "Tự gỡ khi đổi vai trò" : null })
  }
  res.send({ staff: staffRow(fresh, roleMap), removedOverrides })
}

// API-137 POST /api/admin/staff/:id/activation-link
async function resendActivation(req, res) {
  const id = req.params["id"]
  if (!ObjectId.isValid(id)) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy nhân viên")
  const staff = await users().findOne({ _id: new ObjectId(id), role: "admin" })
  if (!staff) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy nhân viên")
  if (staff.status !== "CHO_KICH_HOAT") throw new HttpError(409, "CONFLICT", "Tài khoản đã kích hoạt")
  const extra = await sendActivation(staff)
  res.send({ message: `Đã gửi lại liên kết cho ${staff.fullName}`, ...extra })
}

module.exports = { listStaff, createStaff, updateStaff, resendActivation }
