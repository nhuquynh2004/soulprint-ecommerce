// Xác thực và phân quyền (07_API_Spec.md Mục 1.1, BR-34, NFR-SEC-04).
// loadUser chạy cho mọi request /api: đọc lại tài khoản trong CSDL ở MỖI request, nên khóa tài khoản, đổi vai trò,
// sửa quyền có hiệu lực ngay ở request tiếp theo (không tin dữ liệu cũ trong phiên).
// Phiên tách 2 phía: /api/admin/* dùng phiên nhân viên (session.staffId), các API khác dùng phiên khách
// (session.userId). Nhân viên đang mở khu quản trị vẫn là khách chưa đăng nhập ở cửa hàng và ngược lại.
// req.staff luôn có khi phiên có nhân viên, cho vài chỗ ngoài /api/admin cần biết (ảnh riêng tư, xem trước trang chủ).
const { database, ObjectId } = require("../config/db")
const HttpError = require("../utils/httpError")
const { getEffectivePermissions } = require("../services/permissions")

const SEEN_EVERY = 5 * 60 * 1000 // cập nhật lastSeenAt tối đa 5 phút/lần (06 Mục 6.3)

const isAdminArea = (req) => req.originalUrl.startsWith("/api/admin/") || req.originalUrl.startsWith("/api/admin?")

// Đọc tài khoản ở 1 phía; tài khoản bị khóa/xóa hoặc sai loại thì bỏ phía đó khỏi phiên
async function readSide(req, key, role) {
  const id = req.session && req.session[key]
  if (!id || !ObjectId.isValid(id)) return null
  const user = await database.collection("users").findOne({ _id: new ObjectId(id) })
  if (user && user.status === "HOAT_DONG" && user.role === role) return user
  delete req.session[key]
  return null
}

async function loadUser(req, res, next) {
  if (!req.session) return next()
  const [member, staff] = await Promise.all([readSide(req, "userId", "member"), readSide(req, "staffId", "admin")])
  if (!req.session.userId && !req.session.staffId && (req.session.createdAt || req.session.role)) {
    // Phiên đăng nhập không còn ai (bị khóa, phiên dạng cũ): hủy phiên, request này coi như chưa đăng nhập
    await new Promise((resolve) => req.session.destroy(resolve))
    res.clearCookie("sid")
    return next()
  }

  if (staff) {
    const roles = await database
      .collection("roles")
      .find({ code: { $in: staff.staffRoles || [] } })
      .toArray()
    const eff = getEffectivePermissions(staff, roles)
    req.staff = staff
    req.isFullAccess = eff.isFullAccess
    req.permissions = new Set(eff.permissions)
    req.staffRoles = roles
  }
  const user = isAdminArea(req) ? staff : member
  if (user) req.user = user

  const now = Date.now()
  if ((member || staff) && (!req.session.lastSeenAt || now - new Date(req.session.lastSeenAt).getTime() > SEEN_EVERY)) {
    req.session.lastSeenAt = new Date(now)
  }
  next()
}

// 401 nếu chưa đăng nhập
function requireAuth(req, res, next) {
  if (!req.user) return next(new HttpError(401, "UNAUTHENTICATED", "Vui lòng đăng nhập để tiếp tục"))
  next()
}

// Chỉ tài khoản khách (Member)
function requireMember(req, res, next) {
  if (!req.user) return next(new HttpError(401, "UNAUTHENTICATED", "Vui lòng đăng nhập để tiếp tục"))
  if (req.user.role !== "member") return next(new HttpError(403, "FORBIDDEN", "Chức năng chỉ dành cho tài khoản khách hàng"))
  next()
}

// requireRole('admin'): mọi tài khoản nhân viên
function requireStaff(req, res, next) {
  // Chỉ có phiên khách (Member) mà gọi API quản trị: 403 như trước khi tách phiên (UC-ACC-02 AC4)
  if (!req.user && req.session && req.session.userId) return next(new HttpError(403, "FORBIDDEN", "Bạn không có quyền truy cập khu quản trị"))
  if (!req.user) return next(new HttpError(401, "UNAUTHENTICATED", "Vui lòng đăng nhập khu quản trị"))
  if (req.user.role !== "admin") return next(new HttpError(403, "FORBIDDEN", "Bạn không có quyền truy cập khu quản trị"))
  next()
}

// Cần ít nhất 1 mã quyền trong danh sách; vai trò Quản trị luôn qua (BR-34)
function requirePermission(...codes) {
  return (req, res, next) =>
    requireStaff(req, res, (err) => {
      if (err) return next(err)
      if (req.isFullAccess || codes.some((c) => req.permissions.has(c))) return next()
      next(new HttpError(403, "FORBIDDEN", "Bạn không có quyền thực hiện thao tác này"))
    })
}

// Chỉ vai trò Quản trị: nhân viên, vai trò, cài đặt (không cấp được bằng quyền riêng)
function requireAdminOnly(req, res, next) {
  requireStaff(req, res, (err) => {
    if (err) return next(err)
    if (req.isFullAccess) return next()
    next(new HttpError(403, "FORBIDDEN", "Chỉ vai trò Quản trị được thực hiện thao tác này"))
  })
}

// Xóa mọi phiên của 1 tài khoản (khóa tài khoản, "Đăng xuất tất cả thiết bị khác") - NFR-SEC-13.
// Tìm ở cả 2 phía của phiên.
async function destroyUserSessions(userId, exceptSessionId = null) {
  const filter = { $or: [{ "session.userId": String(userId) }, { "session.staffId": String(userId) }] }
  if (exceptSessionId) filter._id = { $ne: exceptSessionId }
  const result = await database.collection("sessions").deleteMany(filter)
  return result.deletedCount
}

module.exports = { loadUser, isAdminArea, requireAuth, requireMember, requireStaff, requirePermission, requireAdminOnly, destroyUserSessions }
