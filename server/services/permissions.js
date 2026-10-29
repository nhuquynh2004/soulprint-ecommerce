// Quyền thực tế của 1 nhân viên (02 Mục 2.4, BR-34, BR-38) - dùng chung cho middleware requirePermission và API-04.
// Hàm thuần, không gọi CSDL: nhận user và danh sách vai trò đã đọc sẵn để viết unit test được.
const { ALL_PERMISSIONS, PERMISSION_SET, FULL_ACCESS_ROLE } = require("../config/permissions")

const areaOf = (code) => code.split(".")[0]

// Quyền riêng còn hiệu lực: không thời hạn, hoặc hạn chưa qua (việc định kỳ sẽ gỡ hẳn sau)
const isActiveOverride = (o, now) => !o.expiresAt || new Date(o.expiresAt) > now

// Bỏ mọi quyền của khu vực không còn quyền Xem
function keepViewable(set) {
  return new Set([...set].filter((code) => set.has(`${areaOf(code)}.XEM`)))
}

// user: { role, staffRoles[], permissionOverrides[] }; roles: [{ code, isFullAccess, permissions[] }]
// Trả { isFullAccess, permissions: [mã quyền] } (Quản trị: toàn bộ 59 quyền)
function getEffectivePermissions(user, roles, now = new Date()) {
  if (!user || user.role !== "admin") return { isFullAccess: false, permissions: [] }
  const mine = roles.filter((r) => (user.staffRoles || []).includes(r.code))
  if (mine.some((r) => r.isFullAccess || r.code === FULL_ACCESS_ROLE)) {
    return { isFullAccess: true, permissions: [...ALL_PERMISSIONS] }
  }

  const set = new Set(mine.flatMap((r) => r.permissions || []))
  const overrides = (user.permissionOverrides || []).filter((o) => isActiveOverride(o, now))
  for (const o of overrides) {
    if (o.type === "CAP_THEM") {
      set.add(o.permission)
      set.add(`${areaOf(o.permission)}.XEM`) // cấp một hành động khi chưa có Xem thì cấp kèm Xem (BR-38)
    }
  }
  for (const o of overrides) if (o.type === "THU_HOI") set.delete(o.permission)

  const result = keepViewable(set)
  return { isFullAccess: false, permissions: ALL_PERMISSIONS.filter((p) => result.has(p)) }
}

// Kiểm tra bộ quyền của vai trò (BR-37): mã hợp lệ, ≥ 1 quyền, khu vực nào có quyền thì phải có .XEM.
// Trả danh sách lỗi (rỗng = hợp lệ).
function validateRolePermissions(permissions) {
  const errors = []
  if (!Array.isArray(permissions) || !permissions.length) return ["Vai trò cần ít nhất 1 quyền"]
  const unknown = permissions.filter((p) => !PERMISSION_SET.has(p))
  if (unknown.length) errors.push("Mã quyền không tồn tại hoặc chỉ dành cho Quản trị: " + unknown.join(", "))
  const set = new Set(permissions)
  const missingView = [...new Set(permissions.map(areaOf))].filter((a) => PERMISSION_SET.has(`${a}.XEM`) && !set.has(`${a}.XEM`))
  if (missingView.length) errors.push("Thiếu quyền Xem của khu vực: " + missingView.join(", "))
  return errors
}

// Quyền riêng hợp lệ với vai trò hiện có (BR-38). Trả { valid[], removed[] }:
// removed là quyền riêng không còn tác dụng (Cấp thêm quyền vai trò đã có, Thu hồi quyền vai trò không có).
function splitOverrides(overrides, rolePermissions) {
  const has = new Set(rolePermissions)
  const valid = []
  const removed = []
  for (const o of overrides || []) {
    const ok = PERMISSION_SET.has(o.permission) && (o.type === "CAP_THEM" ? !has.has(o.permission) : o.type === "THU_HOI" && has.has(o.permission))
    ;(ok ? valid : removed).push(o)
  }
  return { valid, removed }
}

module.exports = { getEffectivePermissions, validateRolePermissions, splitOverrides, isActiveOverride, areaOf }
