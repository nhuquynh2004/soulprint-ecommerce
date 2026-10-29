const test = require("node:test")
const assert = require("node:assert")
const { getEffectivePermissions, validateRolePermissions, splitOverrides } = require("../services/permissions")
const { ALL_PERMISSIONS } = require("../config/permissions")
const roles = require("../../data/seed/roles.json")

const now = new Date("2026-10-15T10:00:00+07:00")
const staff = (staffRoles, permissionOverrides = []) => ({ role: "admin", staffRoles, permissionOverrides })
const perms = (user) => getEffectivePermissions(user, roles, now).permissions

test("danh mục có đúng 60 quyền cấp được (02 Mục 2.3)", () => {
  assert.equal(ALL_PERMISSIONS.length, 60)
  assert.equal(new Set(ALL_PERMISSIONS).size, 60)
})

test("bộ quyền seed của vai trò mặc định hợp lệ theo BR-37", () => {
  for (const r of roles.filter((x) => !x.isFullAccess)) assert.deepEqual(validateRolePermissions(r.permissions), [], r.code)
})

test("Quản trị có toàn quyền, bỏ qua quyền riêng", () => {
  const eff = getEffectivePermissions(staff(["QUAN_TRI"], [{ permission: "TONG_QUAN.XEM", type: "THU_HOI" }]), roles, now)
  assert.equal(eff.isFullAccess, true)
  assert.equal(eff.permissions.length, 60)
})

test("2 vai trò Bán hàng + Kho có hợp quyền của cả hai (UC-ACC-07 AC2)", () => {
  const p = perms(staff(["BAN_HANG", "KHO"]))
  assert.ok(p.includes("DON_HANG.SUA") && p.includes("DON_HANG.DONG_GOI"))
})

test("Kho được cấp thêm KHACH_HANG.XEM: xem được Khách hàng (02 Mục 2.4)", () => {
  const p = perms(staff(["KHO"], [{ permission: "KHACH_HANG.XEM", type: "CAP_THEM", expiresAt: null }]))
  assert.ok(p.includes("KHACH_HANG.XEM"))
  assert.ok(!p.includes("KHACH_HANG.SUA"))
})

test("cấp thêm một hành động khi chưa có Xem thì được kèm Xem (BR-38)", () => {
  const p = perms(staff(["KHO"], [{ permission: "VOUCHER.XUAT_CSV", type: "CAP_THEM" }]))
  assert.ok(p.includes("VOUCHER.XEM") && p.includes("VOUCHER.XUAT_CSV"))
})

test("thu hồi IN_PHIEU: không in phiếu được nhưng vẫn đóng gói (UC-ACC-07 AC9)", () => {
  const p = perms(staff(["KHO"], [{ permission: "DON_HANG.IN_PHIEU", type: "THU_HOI" }]))
  assert.ok(!p.includes("DON_HANG.IN_PHIEU"))
  assert.ok(p.includes("DON_HANG.DONG_GOI"))
})

test("thu hồi Xem thì mất mọi quyền khác của khu vực", () => {
  const p = perms(staff(["KHO"], [{ permission: "DON_HANG.XEM", type: "THU_HOI" }]))
  assert.ok(!p.some((x) => x.startsWith("DON_HANG.")))
})

test("quyền riêng hết hạn không còn tác dụng (UC-ACC-07 AC8)", () => {
  const o = { permission: "KHACH_HANG.XEM", type: "CAP_THEM", expiresAt: new Date("2026-10-14T23:59:59+07:00") }
  assert.ok(!perms(staff(["KHO"], [o])).includes("KHACH_HANG.XEM"))
  assert.ok(getEffectivePermissions(staff(["KHO"], [o]), roles, new Date("2026-10-14T20:00:00+07:00")).permissions.includes("KHACH_HANG.XEM"))
})

test("tài khoản khách không có quyền quản trị", () => {
  assert.deepEqual(getEffectivePermissions({ role: "member" }, roles, now), { isFullAccess: false, permissions: [] })
})

test("kiểm tra bộ quyền vai trò: rỗng, thiếu Xem, quyền chỉ Quản trị (BR-37)", () => {
  assert.ok(validateRolePermissions([]).length)
  assert.match(validateRolePermissions(["HO_TRO.TRA_LOI"])[0], /Xem/)
  assert.ok(validateRolePermissions(["NHAN_VIEN.XEM"]).length)
  assert.deepEqual(validateRolePermissions(["HO_TRO.XEM", "HO_TRO.TRA_LOI"]), [])
})

test("đổi vai trò: tự gỡ quyền riêng không còn tác dụng (BR-38)", () => {
  const overrides = [
    { permission: "KHACH_HANG.XEM", type: "CAP_THEM" },
    { permission: "DON_HANG.IN_PHIEU", type: "THU_HOI" },
  ]
  const banHang = roles.find((r) => r.code === "BAN_HANG").permissions
  const { valid, removed } = splitOverrides(overrides, banHang)
  assert.deepEqual(removed.map((o) => o.permission), ["KHACH_HANG.XEM"]) // Bán hàng đã có sẵn
  assert.deepEqual(valid.map((o) => o.permission), ["DON_HANG.IN_PHIEU"])
})
