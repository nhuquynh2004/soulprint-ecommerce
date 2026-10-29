// Vai trò và quyền (07_API_Spec.md Mục 2.12): đủ 5 lệnh REST cho roles theo slide Chương VI
// API-178 GET danh sách, API-179 GET một, API-180 POST (tạo / nhân bản), API-181 PUT (_id trong body), API-182 DELETE;
// API-183 danh mục quyền để dựng ma trận. Chỉ vai trò Quản trị (requireAdminOnly). BR-37, BR-38.
const { database, ObjectId } = require("../config/db")
const HttpError = require("../utils/httpError")
const v = require("../utils/validators")
const { removeAccents } = require("../utils/vnText")
const { AREAS, ALL_PERMISSIONS, FULL_ACCESS_ROLE, DEFAULT_ROLES } = require("../config/permissions")
const { validateRolePermissions, splitOverrides } = require("../services/permissions")
const { writeLog } = require("../services/adminLog")

const roles = () => database.collection("roles")
const users = () => database.collection("users")
const vi = { locale: "vi", strength: 1 } // so tên không phân biệt hoa thường, dấu
const rule = (message, extra = {}) => new HttpError(422, "BUSINESS_RULE", message, { rule: "BR-37", ...extra })

const permissionCount = (r) => (r.isFullAccess ? ALL_PERMISSIONS.length : (r.permissions || []).length)

async function staffUsing(code) {
  return users()
    .find({ role: "admin", staffRoles: code })
    .project({ fullName: 1, status: 1, staffRoles: 1, permissionOverrides: 1 })
    .toArray()
}

function roleOut(r, extra = {}) {
  return {
    _id: r._id,
    code: r.code,
    name: r.name,
    description: r.description || "",
    type: r.type,
    isFullAccess: !!r.isFullAccess,
    permissions: r.isFullAccess ? [...ALL_PERMISSIONS] : r.permissions || [],
    permissionCount: permissionCount(r),
    updatedAt: r.updatedAt || null,
    ...extra,
  }
}

async function findRole(id) {
  if (!ObjectId.isValid(String(id))) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy vai trò")
  const role = await roles().findOne({ _id: new ObjectId(String(id)) })
  if (!role) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy vai trò")
  return role
}

// API-178 GET /api/admin/roles - Quản trị, Nhân viên bán hàng, Kho, rồi vai trò tùy chỉnh theo tên
async function listRoles(req, res) {
  const [list, counts, admins] = await Promise.all([
    roles().find({}).toArray(),
    users().aggregate([{ $match: { role: "admin" } }, { $unwind: "$staffRoles" }, { $group: { _id: "$staffRoles", n: { $sum: 1 } } }]).toArray(),
    users().find({ role: "admin" }).project({ fullName: 1 }).toArray(),
  ])
  const countOf = new Map(counts.map((c) => [c._id, c.n]))
  const nameOf = new Map(admins.map((a) => [String(a._id), a.fullName]))
  const rank = (r) => (DEFAULT_ROLES.includes(r.code) ? DEFAULT_ROLES.indexOf(r.code) : DEFAULT_ROLES.length)
  list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "vi"))
  res.send(list.map((r) => roleOut(r, { staffCount: countOf.get(r.code) || 0, updatedBy: r.updatedBy ? nameOf.get(String(r.updatedBy)) || null : null })))
}

// API-179 GET /api/admin/roles/:id - kèm nhân viên đang dùng (cảnh báo "áp dụng ngay cho N nhân viên")
async function getRole(req, res) {
  const role = await findRole(req.params["id"])
  const staff = await staffUsing(role.code)
  res.send(roleOut(role, { staff: staff.map((s) => ({ _id: s._id, fullName: s.fullName, status: s.status })) }))
}

function readName(value) {
  const name = v.str(value).replace(/\s+/g, " ")
  if (name.length < 3 || name.length > 40) throw rule("Tên vai trò cần 3-40 ký tự", { fields: { name: "Tên vai trò cần 3-40 ký tự" } })
  return name
}

function readDescription(value) {
  const description = v.str(value)
  if (description.length > 160) throw rule("Mô tả tối đa 160 ký tự", { fields: { description: "Mô tả tối đa 160 ký tự" } })
  return description
}

function readPermissions(value) {
  const list = [...new Set(Array.isArray(value) ? value.filter((p) => typeof p === "string") : [])]
  const errors = validateRolePermissions(list)
  if (errors.length) throw rule(errors[0], { fields: { permissions: errors[0] } })
  return ALL_PERMISSIONS.filter((p) => list.includes(p)) // giữ thứ tự của danh mục
}

async function assertNameFree(name, exceptId = null) {
  const found = await roles().findOne({ name, ...(exceptId ? { _id: { $ne: exceptId } } : {}) }, { collation: vi })
  if (found) throw new HttpError(409, "CONFLICT", "Tên vai trò đã tồn tại", { fields: { name: "Tên vai trò đã tồn tại" } })
}

// Mã vai trò tùy chỉnh: VT_ + tên không dấu viết hoa, thêm số nếu trùng (06 Mục 1.2)
async function newRoleCode(name) {
  const base = "VT_" + removeAccents(name).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "")
  let code = base
  for (let i = 2; await roles().findOne({ code }); i++) code = `${base}_${i}`
  return code
}

// API-180 POST /api/admin/roles - tạo mới {name, description, permissions} hoặc nhân bản {fromRoleId, name?}
async function createRole(req, res) {
  let name
  let description
  let permissions
  if (req.body.fromRoleId) {
    const source = await findRole(req.body.fromRoleId)
    name = readName(req.body.name || `${source.name} (bản sao)`)
    description = readDescription(req.body.description ?? source.description)
    permissions = source.isFullAccess ? [...ALL_PERMISSIONS] : source.permissions || []
  } else {
    name = readName(req.body.name)
    description = readDescription(req.body.description)
    permissions = readPermissions(req.body.permissions)
  }
  await assertNameFree(name)

  const now = new Date()
  const role = {
    code: await newRoleCode(name), name, description, type: "TUY_CHINH", isFullAccess: false, permissions,
    createdBy: req.user._id, updatedBy: req.user._id, createdAt: now, updatedAt: now,
  }
  role._id = (await roles().insertOne(role)).insertedId
  await writeLog({ adminId: req.user._id, action: "ROLE_CREATE", targetType: "roles", targetId: role._id, after: { name, description, permissions } })
  res.status(201).send(roleOut(role, { staffCount: 0 }))
}

// API-181 PUT /api/admin/roles - _id trong body. Áp dụng ngay cho mọi nhân viên có vai trò này.
async function updateRole(req, res) {
  const role = await findRole(req.body._id)
  if (role.code === FULL_ACCESS_ROLE) throw new HttpError(403, "FORBIDDEN", "Vai trò Quản trị luôn có toàn quyền, không sửa được")

  const set = { updatedBy: req.user._id, updatedAt: new Date() }
  if (req.body.name !== undefined) {
    const name = readName(req.body.name)
    if (role.type === "MAC_DINH" && name !== role.name) throw rule("Không đổi tên vai trò mặc định")
    if (name !== role.name) await assertNameFree(name, role._id)
    set.name = name
  }
  if (req.body.description !== undefined) set.description = readDescription(req.body.description)
  if (req.body.permissions !== undefined) set.permissions = readPermissions(req.body.permissions)

  await roles().updateOne({ _id: role._id }, { $set: set })
  const fresh = await roles().findOne({ _id: role._id })
  const staff = await staffUsing(role.code)
  await writeLog({
    adminId: req.user._id, action: "ROLE_UPDATE", targetType: "roles", targetId: role._id,
    before: { name: role.name, description: role.description, permissions: role.permissions },
    after: { name: fresh.name, description: fresh.description, permissions: fresh.permissions },
  })
  // Quyền riêng đã cấp cho từng người giữ nguyên (UC-ACC-07 nhánh 1f)
  res.send({ role: roleOut(fresh, { staffCount: staff.length }), affectedStaff: staff.map((s) => ({ _id: s._id, fullName: s.fullName })) })
}

// API-182 DELETE /api/admin/roles/:id?replacementRoleId= - chuyển nhân viên sang vai trò thay thế rồi xóa
async function deleteRole(req, res) {
  const role = await findRole(req.params["id"])
  if (role.type === "MAC_DINH") throw new HttpError(403, "FORBIDDEN", "Không xóa được vai trò mặc định")

  const staff = await staffUsing(role.code)
  let replacement = null
  if (staff.length) {
    const rid = v.str(req.query.replacementRoleId)
    if (!rid) {
      throw new HttpError(422, "REPLACEMENT_REQUIRED", "Chọn vai trò để chuyển nhân viên đang dùng vai trò này", {
        rule: "BR-37",
        staff: staff.map((s) => ({ _id: s._id, fullName: s.fullName })),
      })
    }
    replacement = await findRole(rid)
    if (replacement._id.equals(role._id)) throw new HttpError(422, "REPLACEMENT_REQUIRED", "Vai trò thay thế phải khác vai trò bị xóa", { rule: "BR-37" })
  }

  const allRoles = await roles().find({}).toArray()
  const permsOf = (codes) => allRoles.filter((r) => codes.includes(r.code)).flatMap((r) => (r.isFullAccess ? ALL_PERMISSIONS : r.permissions || []))
  for (const s of staff) {
    // Đã có sẵn vai trò thay thế thì chỉ bỏ vai trò bị xóa
    const codes = [...new Set(s.staffRoles.map((c) => (c === role.code ? replacement.code : c)))]
    const full = codes.includes(FULL_ACCESS_ROLE)
    const { valid, removed } = full ? { valid: [], removed: s.permissionOverrides || [] } : splitOverrides(s.permissionOverrides, permsOf(codes))
    await users().updateOne({ _id: s._id }, { $set: { staffRoles: codes, permissionOverrides: valid, updatedAt: new Date() } })
    await writeLog({
      adminId: req.user._id, action: "STAFF_UPDATE", targetType: "users", targetId: s._id, reason: `Xóa vai trò ${role.name}`,
      before: { staffRoles: s.staffRoles }, after: { staffRoles: codes, removedOverrides: removed.map((o) => o.permission) },
    })
  }

  await roles().deleteOne({ _id: role._id })
  await writeLog({ adminId: req.user._id, action: "ROLE_DELETE", targetType: "roles", targetId: role._id, before: { name: role.name, permissions: role.permissions }, after: replacement ? { replacement: replacement.code, staffMoved: staff.length } : null })
  res.status(204).send()
}

// API-183 GET /api/admin/permissions - danh mục quyền để dựng ma trận (02 Mục 2.3)
async function listPermissions(req, res) {
  res.send(
    AREAS.map((a) => ({
      group: a.group,
      area: a.area,
      areaLabel: a.areaLabel,
      screens: a.screens,
      adminOnly: !!a.adminOnly,
      actions: a.actions.map((x) => ({ code: `${a.area}.${x.action}`, label: x.label, column: x.column })),
    }))
  )
}

module.exports = { listRoles, getRole, createRole, updateRole, deleteRole, listPermissions }
