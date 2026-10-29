// Đăng nhập nhân viên và quản lý phiên (07_API_Spec.md Mục 2.11): API-131, API-132, API-133 (UC-ACC-02 nhánh 1a, 6b).
const { database } = require("../config/db")
const HttpError = require("../utils/httpError")
const v = require("../utils/validators")
const auth = require("../services/auth")
const { getEffectivePermissions } = require("../services/permissions")
const { checkCredentials } = require("./auth.controller")
const { destroyUserSessions } = require("../middlewares/auth")

const INVALID = "Email/Số điện thoại hoặc mật khẩu không chính xác"

// API-131 POST /api/admin/auth/login - chỉ nhận tài khoản nhân viên
async function staffLogin(req, res) {
  const { user, ok } = await checkCredentials(req.body)
  // Sai mật khẩu hoặc là tài khoản khách: cùng 1 thông báo, không lộ loại tài khoản (4Ed)
  if (!ok || user.role !== "admin") {
    if (!ok) await auth.recordFailedLogin(user)
    throw new HttpError(401, "INVALID_CREDENTIALS", INVALID)
  }
  if (user.status === "BI_KHOA") {
    throw new HttpError(403, "ACCOUNT_LOCKED", "Tài khoản đã bị khóa, vui lòng liên hệ Quản trị")
  }

  await auth.startSession(req, user)
  await auth.onLoginSuccess(user)
  auth.setRememberCookie(res, "remember_staff", v.str(req.body.login), req.body.rememberMe === true)

  const roles = await database.collection("roles").find({ code: { $in: user.staffRoles || [] } }).toArray()
  const eff = getEffectivePermissions(user, roles)
  res.send({
    user: {
      ...auth.publicUser(user),
      staffRoles: roles.map((r) => ({ code: r.code, name: r.name })),
      isFullAccess: eff.isFullAccess,
      permissions: eff.permissions,
    },
    // Mọi vai trò mặc định đều có Tổng quan; vai trò tùy chỉnh không có thì vào Hồ sơ quản trị (luôn được mở)
    landing: eff.isFullAccess || eff.permissions.includes("TONG_QUAN.XEM") ? "/quan-tri" : "/quan-tri/ho-so",
  })
}

// API-132 GET /api/admin/auth/sessions - phiên của chính người gọi
async function listSessions(req, res) {
  const rows = await database
    .collection("sessions")
    .find({ "session.staffId": String(req.user._id) })
    .toArray()
  const items = rows
    .map((r) => ({
      id: r._id,
      device: r.session.userAgent || "Thiết bị không rõ",
      ipMasked: auth.maskIp(r.session.ip),
      createdAt: r.session.createdAt || null,
      lastSeenAt: r.session.lastSeenAt || null,
      current: r._id === req.sessionID,
    }))
    .sort((a, b) => Number(b.current) - Number(a.current) || new Date(b.lastSeenAt) - new Date(a.lastSeenAt))
  res.send(items)
}

// API-133 DELETE /api/admin/auth/sessions/:id - đăng xuất 1 thiết bị, hoặc "others" = mọi thiết bị khác (AC8)
async function deleteSession(req, res) {
  const id = req.params["id"]
  if (id === "others") {
    await destroyUserSessions(req.user._id, req.sessionID)
    return res.status(204).send()
  }
  if (id === req.sessionID) {
    throw new HttpError(422, "BUSINESS_RULE", "Dùng Đăng xuất để thoát phiên hiện tại")
  }
  const result = await database.collection("sessions").deleteOne({ _id: String(id), "session.staffId": String(req.user._id) })
  if (!result.deletedCount) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy phiên đăng nhập")
  res.status(204).send()
}

module.exports = { staffLogin, listSessions, deleteSession }
