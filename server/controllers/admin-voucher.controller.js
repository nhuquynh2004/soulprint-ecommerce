// Quản trị voucher (07_API_Spec.md Mục 2.13) - UC-CAT-02, BR-23.
// API-82 danh sách, API-83 chi tiết + thống kê, API-84 tạo, API-85 sửa/tạm ngừng/kích hoạt (_id trong body),
// API-86 xóa hoặc lưu trữ, API-87 nhân bản, API-165 hàng loạt, API-166 xuất CSV lượt dùng, API-190 khớp SĐT/email.
const { database, ObjectId } = require("../config/db")
const params = require("../config/params")
const HttpError = require("../utils/httpError")
const v = require("../utils/validators")
const { writeLog } = require("../services/adminLog")
const { accentInsensitivePattern } = require("../utils/vnText")
const math = require("../services/checkoutMath")
const voucherService = require("../services/voucher")

const vouchers = () => database.collection("vouchers")
const PAGE_SIZE = 20
const TYPES = ["PERCENT", "FIXED", "FREESHIP"]
const AUDIENCES = ["PUBLIC", "ALL_MEMBERS", "NEW_MEMBERS", "SELECTED"]
const SCOPES = ["ALL", "CATEGORY", "PRODUCT"]
const SOURCES = ["WELCOME", "CAMPAIGN", "COMPENSATION"]
const CODE_RE = /^[A-Z0-9]{4,16}$/
// Voucher đang hoạt động (đã bắt đầu hoặc đã có lượt dùng) chỉ sửa được các trường này (UC-CAT-02 1b, AC2)
const LIVE_EDITABLE = ["description", "endAt", "totalQuantity"]
const DAY = 24 * 60 * 60 * 1000

const toId = (x) => (x && ObjectId.isValid(String(x)) ? new ObjectId(String(x)) : null)
const str = (x, max) => (typeof x === "string" ? x.normalize("NFC").trim().slice(0, max) : "")
const can = (req, code) => req.isFullAccess || req.permissions.has(code)
const intOrNull = (x) => (x === null || x === undefined || x === "" ? null : Number(x))
const isInt = (n) => Number.isInteger(n)

// Có thể sửa toàn bộ: bản nháp, hoặc đã lên lịch mà chưa ai dùng (UC-CAT-02 1a)
const fullyEditable = (d, now = new Date()) => d.status === "BAN_NHAP" || (d.status === "HOAT_DONG" && d.startAt && new Date(d.startAt) > now && !(d.usedCount > 0))

// Chuẩn hóa form 8 vùng. Trả {doc, fields} - fields là lỗi tại trường. existing: voucher đang sửa.
async function normalize(body, existing = null) {
  const pick = (k, d) => (body[k] !== undefined ? body[k] : existing && existing[k] !== undefined ? existing[k] : d)
  const scopeIn = pick("scope", { kind: "ALL", ids: [], excludeProductIds: [] }) || {}
  const doc = {
    code: str(pick("code", ""), 16).toUpperCase(),
    name: str(pick("name", ""), 120),
    description: str(pick("description", ""), 300),
    type: TYPES.includes(pick("type", "PERCENT")) ? pick("type", "PERCENT") : null,
    value: intOrNull(pick("value", null)),
    maxDiscount: intOrNull(pick("maxDiscount", null)),
    minOrderValue: intOrNull(pick("minOrderValue", 0)) || 0,
    minItems: intOrNull(pick("minItems", 0)) || 0,
    scope: {
      kind: SCOPES.includes(scopeIn.kind) ? scopeIn.kind : "ALL",
      ids: (Array.isArray(scopeIn.ids) ? scopeIn.ids : []).map(toId).filter(Boolean),
      excludeProductIds: (Array.isArray(scopeIn.excludeProductIds) ? scopeIn.excludeProductIds : []).map(toId).filter(Boolean),
    },
    audience: AUDIENCES.includes(pick("audience", "PUBLIC")) ? pick("audience", "PUBLIC") : "PUBLIC",
    selectedUserIds: (Array.isArray(pick("selectedUserIds", [])) ? pick("selectedUserIds", []) : []).map(toId).filter(Boolean),
    source: SOURCES.includes(pick("source", "CAMPAIGN")) ? pick("source", "CAMPAIGN") : "CAMPAIGN",
    totalQuantity: intOrNull(pick("totalQuantity", null)),
    perUserLimit: intOrNull(pick("perUserLimit", 1)),
    maxBudget: intOrNull(pick("maxBudget", null)),
    startAt: pick("startAt", null) ? new Date(pick("startAt")) : null,
    endAt: pick("endAt", null) ? new Date(pick("endAt")) : null,
    validDays: intOrNull(pick("validDays", null)),
    showInWallet: pick("showInWallet", true) !== false,
    autoOnSignup: pick("autoOnSignup", false) === true,
  }
  if (doc.scope.kind === "ALL") doc.scope.ids = []
  if (doc.audience !== "SELECTED") doc.selectedUserIds = []
  if (doc.type !== "PERCENT") doc.maxDiscount = null

  const f = {}
  if (!CODE_RE.test(doc.code)) f.code = "Mã chỉ gồm chữ in hoa không dấu và số, 4-16 ký tự"
  if (doc.name.length < 2) f.name = "Nhập tên hiển thị (2-120 ký tự)"
  if (!doc.type) f.type = "Chọn loại ưu đãi"
  if (doc.type === "PERCENT" && !(isInt(doc.value) && doc.value >= 1 && doc.value <= 100)) f.value = "Phần trăm giảm từ 1 đến 100"
  if (doc.type !== "PERCENT" && !(isInt(doc.value) && doc.value > 0)) f.value = "Số tiền giảm phải lớn hơn 0"
  if (doc.maxDiscount !== null && !(isInt(doc.maxDiscount) && doc.maxDiscount > 0)) f.maxDiscount = "Giảm tối đa phải lớn hơn 0"
  if (!(isInt(doc.minOrderValue) && doc.minOrderValue >= 0)) f.minOrderValue = "Giá trị đơn tối thiểu không hợp lệ"
  if (!(isInt(doc.minItems) && doc.minItems >= 0)) f.minItems = "Số lượng tối thiểu không hợp lệ"
  if (doc.type === "FIXED" && doc.minOrderValue > 0 && doc.value > doc.minOrderValue) f.value = "Số tiền giảm không được lớn hơn giá trị đơn tối thiểu"
  if (doc.totalQuantity !== null && !(isInt(doc.totalQuantity) && doc.totalQuantity > 0)) f.totalQuantity = "Tổng số lượt phải lớn hơn 0"
  if (doc.perUserLimit !== null && !(isInt(doc.perUserLimit) && doc.perUserLimit > 0)) f.perUserLimit = "Số lượt mỗi khách phải lớn hơn 0"
  else if (doc.perUserLimit !== null && doc.totalQuantity !== null && doc.perUserLimit > doc.totalQuantity) f.perUserLimit = "Số lượt mỗi khách không được lớn hơn tổng số lượt"
  if (doc.maxBudget !== null && !(isInt(doc.maxBudget) && doc.maxBudget > 0)) f.maxBudget = "Ngân sách tối đa phải lớn hơn 0"
  if (doc.validDays !== null && !(isInt(doc.validDays) && doc.validDays >= 1 && doc.validDays <= 365)) f.validDays = "Hạn dùng sau khi nhận từ 1 đến 365 ngày"
  if (doc.autoOnSignup && !["ALL_MEMBERS", "NEW_MEMBERS"].includes(doc.audience)) f.autoOnSignup = "Chỉ tặng khi đăng ký với đối tượng Mọi thành viên hoặc Thành viên mới"
  if ((doc.startAt && isNaN(doc.startAt)) || (doc.endAt && isNaN(doc.endAt))) f.startAt = "Thời gian không hợp lệ"
  else if (doc.startAt && doc.endAt && doc.endAt <= doc.startAt) f.endAt = "Thời gian hiệu lực không hợp lệ"

  // Phạm vi, đối tượng phải chọn cụ thể; sản phẩm áp dụng phải đang bán (5Ef)
  if (doc.scope.kind === "CATEGORY") {
    const n = doc.scope.ids.length ? await database.collection("categories").countDocuments({ _id: { $in: doc.scope.ids } }) : 0
    if (!n || n !== doc.scope.ids.length) f.scope = "Chọn danh mục áp dụng"
  }
  if (doc.scope.kind === "PRODUCT") {
    const n = doc.scope.ids.length ? await database.collection("products").countDocuments({ _id: { $in: doc.scope.ids }, status: "DANG_HIEN_THI" }) : 0
    if (!doc.scope.ids.length) f.scope = "Chọn sản phẩm áp dụng"
    else if (n !== doc.scope.ids.length) f.scope = "Có sản phẩm đã ẩn hoặc ngừng bán, vui lòng bỏ chọn"
  }
  if (doc.audience === "SELECTED" && !doc.selectedUserIds.length) f.audience = "Chọn khách hàng nhận voucher"
  return { doc, f }
}

// Lỗi khi lưu ở trạng thái hoạt động: phải có thời gian và giới hạn (5Eb)
function activeErrors(doc, f) {
  if (!doc.startAt) f.startAt = f.startAt || "Chọn thời gian bắt đầu"
  if (!doc.endAt) f.endAt = f.endAt || "Chọn thời gian kết thúc"
  return f
}

function assertFields(f) {
  if (Object.keys(f).length) throw new HttpError(422, "VALIDATION_ERROR", Object.values(f)[0], { fields: f })
}

async function assertCodeFree(code, exceptId = null) {
  const found = await vouchers().findOne({ code, ...(exceptId ? { _id: { $ne: exceptId } } : {}) }, { projection: { _id: 1 } })
  if (found) throw new HttpError(409, "CONFLICT", "Mã voucher đã tồn tại", { fields: { code: "Mã voucher đã tồn tại" } })
}

const withStatus = (d, now = new Date()) => ({ ...d, displayStatus: math.displayStatus(d, now) })

// API-82 GET /api/admin/vouchers?status=&type=&q=&sort=&page= - mặc định ẩn LUU_TRU
async function listVouchers(req, res) {
  const now = new Date()
  const filter = {}
  if (TYPES.includes(req.query.type)) filter.type = req.query.type
  const q = String(req.query.q || "").trim()
  if (q) filter.$or = [{ code: { $regex: q.toUpperCase().replace(/[^A-Z0-9]/g, ""), $options: "i" } }, { name: { $regex: accentInsensitivePattern(q), $options: "i" } }]
  const sort = { ma: { code: 1 }, "-dung": { usedCount: -1 }, "het-han": { endAt: 1 } }[req.query.sort] || { createdAt: -1, _id: -1 }
  const page = Math.max(1, parseInt(req.query.page) || 1)

  const all = (await vouchers().find(filter).sort(sort).toArray()).map((d) => withStatus(d, now))
  const status = String(req.query.status || "")
  const list = status ? all.filter((d) => d.displayStatus === status) : all.filter((d) => d.displayStatus !== "LUU_TRU")
  const counts = all.reduce((m, d) => ({ ...m, [d.displayStatus]: (m[d.displayStatus] || 0) + 1 }), { ALL: all.filter((d) => d.displayStatus !== "LUU_TRU").length })
  const items = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(({ history, selectedUserIds, ...d }) => ({ ...d, selectedCount: (selectedUserIds || []).length }))
  res.send({ items, page, pageSize: PAGE_SIZE, total: list.length, counts })
}

// Thống kê (UC-CAT-02 1e, SCR-46 cột phải): đã dùng, doanh thu đơn có mã, tổng tiền đã giảm, tỷ lệ dùng/nhận, 14 ngày qua
async function stats(d, now = new Date()) {
  const rows = await database
    .collection("orders")
    .aggregate([
      { $match: { "vouchers.voucherId": d._id, orderStatus: { $ne: "DA_HUY" } } },
      { $unwind: "$vouchers" },
      { $match: { "vouchers.voucherId": d._id } },
      { $project: { total: 1, discount: "$vouchers.discount", createdAt: 1 } },
    ])
    .toArray()
  const granted = await database.collection("userVouchers").countDocuments({ voucherId: d._id })
  const days = []
  const today = math.vnDate(now)
  for (let i = 13; i >= 0; i--) {
    const day = new Date(Date.parse(today + "T00:00:00Z") - i * DAY).toISOString().slice(0, 10)
    days.push({ date: day, count: rows.filter((r) => math.vnDate(new Date(r.createdAt)) === day).length })
  }
  return {
    used: d.usedCount || 0,
    totalQuantity: d.totalQuantity ?? null,
    revenue: rows.reduce((s, r) => s + r.total, 0),
    discountTotal: rows.reduce((s, r) => s + r.discount, 0),
    granted,
    useRate: granted ? Math.round((rows.length / granted) * 1000) / 10 : null,
    daily: days,
  }
}

// API-83 GET /api/admin/vouchers/:id - kèm tên danh mục/sản phẩm/khách đã chọn để form hiển thị
async function getVoucher(req, res) {
  const d = await vouchers().findOne({ _id: toId(req.params["id"]) })
  if (!d) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy voucher")
  const brief = { projection: { name: 1, sku: 1, images: { $slice: 1 }, status: 1 } }
  const [scopeItems, excluded, selectedUsers, creator] = await Promise.all([
    d.scope?.kind === "CATEGORY"
      ? database.collection("categories").find({ _id: { $in: d.scope.ids } }, { projection: { name: 1 } }).toArray()
      : d.scope?.kind === "PRODUCT"
        ? database.collection("products").find({ _id: { $in: d.scope.ids } }, brief).toArray()
        : [],
    d.scope?.excludeProductIds?.length ? database.collection("products").find({ _id: { $in: d.scope.excludeProductIds } }, brief).toArray() : [],
    d.selectedUserIds?.length ? database.collection("users").find({ _id: { $in: d.selectedUserIds } }, { projection: { fullName: 1, phone: 1, email: 1 } }).toArray() : [],
    d.createdBy ? database.collection("users").findOne({ _id: d.createdBy }, { projection: { fullName: 1 } }) : null,
  ])
  res.send({
    ...withStatus(d),
    scopeItems, excludedProducts: excluded, selectedUsers,
    createdByName: creator ? creator.fullName : null,
    fullyEditable: fullyEditable(d),
    stats: await stats(d),
  })
}

// API-84 POST /api/admin/vouchers - {..., status: "BAN_NHAP" | "HOAT_DONG"}
async function createVoucher(req, res) {
  const { doc, f } = await normalize(req.body)
  doc.status = req.body.status === "BAN_NHAP" ? "BAN_NHAP" : "HOAT_DONG"
  if (doc.status === "HOAT_DONG") activeErrors(doc, f)
  assertFields(f)
  await assertCodeFree(doc.code)
  const now = new Date()
  Object.assign(doc, { usedCount: 0, discountGiven: 0, history: [], createdBy: req.user._id, updatedBy: req.user._id, createdAt: now, updatedAt: now })
  doc._id = (await vouchers().insertOne(doc)).insertedId
  const distributed = await voucherService.distribute(doc, now)
  await writeLog({ adminId: req.user._id, action: "VOUCHER_UPDATE", targetType: "vouchers", targetId: doc._id, after: { code: doc.code, status: doc.status, distributed } })
  res.status(201).send({ ...withStatus(doc, now), distributed })
}

// Kích hoạt lại khi còn hạn và còn lượt (1c)
function activationProblem(d, now = new Date()) {
  if (d.endAt && new Date(d.endAt) < now) return "đã hết hạn, không kích hoạt được"
  if (math.usedUp(d)) return "đã hết lượt, không kích hoạt được"
  if (d.status === "LUU_TRU") return "đã lưu trữ"
  return null
}

// API-85 PUT /api/admin/vouchers - _id trong body. {_id, status: TAM_NGUNG|HOAT_DONG} để tạm ngừng/kích hoạt;
// còn lại là sửa form (bản nháp gửi status HOAT_DONG để xuất bản).
async function updateVoucher(req, res) {
  const existing = await vouchers().findOne({ _id: toId(req.body._id) })
  if (!existing) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy voucher")
  if (existing.status === "LUU_TRU") throw new HttpError(422, "BUSINESS_RULE", "Voucher đã lưu trữ, không sửa được")
  const now = new Date()
  const keys = Object.keys(req.body).filter((k) => k !== "_id")

  // Chỉ đổi trạng thái
  if (keys.length === 1 && keys[0] === "status" && existing.status !== "BAN_NHAP") {
    const to = req.body.status
    if (!["TAM_NGUNG", "HOAT_DONG"].includes(to)) throw new HttpError(400, "VALIDATION_ERROR", "Trạng thái không hợp lệ")
    if (to === "HOAT_DONG") {
      const problem = activationProblem(existing, now)
      if (problem) throw new HttpError(422, "BUSINESS_RULE", `${existing.code} ${problem}`)
    }
    await vouchers().updateOne({ _id: existing._id }, { $set: { status: to, updatedBy: req.user._id, updatedAt: now }, $push: { history: { at: now, by: req.user._id, changes: { status: [existing.status, to] } } } })
    if (to === "HOAT_DONG") await voucherService.distribute({ ...existing, status: to }, now)
    await writeLog({ adminId: req.user._id, action: "VOUCHER_UPDATE", targetType: "vouchers", targetId: existing._id, before: { status: existing.status }, after: { status: to } })
    return res.send(withStatus(await vouchers().findOne({ _id: existing._id })))
  }

  const { doc, f } = await normalize(req.body, existing)
  const status = existing.status === "BAN_NHAP" && req.body.status === "HOAT_DONG" ? "HOAT_DONG" : existing.status
  if (!fullyEditable(existing, now)) {
    // Đang hoạt động: chỉ mô tả, ngày kết thúc, số lượng phát hành (1b, AC2)
    const changed = Object.keys(doc).filter((k) => !LIVE_EDITABLE.includes(k) && JSON.stringify(doc[k]) !== JSON.stringify(existing[k] ?? doc[k]))
    if (changed.length) {
      throw new HttpError(422, "BUSINESS_RULE", "Voucher đang hoạt động chỉ sửa được mô tả, ngày kết thúc và số lượng phát hành", { fields: Object.fromEntries(changed.map((k) => [k, "Không sửa được khi voucher đang hoạt động"])) })
    }
    if (doc.totalQuantity !== null && doc.totalQuantity < (existing.usedCount || 0)) f.totalQuantity = `Tổng số lượt không nhỏ hơn số đã dùng (${existing.usedCount})`
  }
  if (status === "HOAT_DONG") activeErrors(doc, f)
  assertFields(f)
  await assertCodeFree(doc.code, existing._id)

  const changes = Object.fromEntries(Object.keys(doc).filter((k) => JSON.stringify(doc[k]) !== JSON.stringify(existing[k])).map((k) => [k, [existing[k] ?? null, doc[k]]]))
  if (status !== existing.status) changes.status = [existing.status, status]
  await vouchers().updateOne(
    { _id: existing._id },
    { $set: { ...doc, status, updatedBy: req.user._id, updatedAt: now }, $push: { history: { at: now, by: req.user._id, changes } } },
  )
  const fresh = await vouchers().findOne({ _id: existing._id })
  const distributed = await voucherService.distribute(fresh, now)
  await writeLog({ adminId: req.user._id, action: "VOUCHER_UPDATE", targetType: "vouchers", targetId: existing._id, before: { status: existing.status }, after: { status, fields: Object.keys(changes) } })
  res.send({ ...withStatus(fresh, now), distributed })
}

// Xóa thật khi bản nháp chưa phân phối, chưa có lượt; còn lại chuyển LUU_TRU (1f)
async function removeOrArchive(d, adminId) {
  const distributed = await database.collection("userVouchers").countDocuments({ voucherId: d._id }, { limit: 1 })
  if (d.status === "BAN_NHAP" && !distributed && !(d.usedCount > 0)) {
    await vouchers().deleteOne({ _id: d._id })
    await writeLog({ adminId, action: "VOUCHER_UPDATE", targetType: "vouchers", targetId: d._id, before: { code: d.code }, reason: "Xóa voucher" })
    return false
  }
  const now = new Date()
  await vouchers().updateOne({ _id: d._id }, { $set: { status: "LUU_TRU", updatedBy: adminId, updatedAt: now }, $push: { history: { at: now, by: adminId, changes: { status: [d.status, "LUU_TRU"] } } } })
  await writeLog({ adminId, action: "VOUCHER_UPDATE", targetType: "vouchers", targetId: d._id, before: { status: d.status }, after: { status: "LUU_TRU" }, reason: "Xóa voucher đã phân phối hoặc đã dùng: lưu trữ" })
  return true
}

// API-86 DELETE /api/admin/vouchers/:id
async function deleteVoucher(req, res) {
  const d = await vouchers().findOne({ _id: toId(req.params["id"]) })
  if (!d) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy voucher")
  if (await removeOrArchive(d, req.user._id)) return res.send({ archived: true })
  res.status(204).send()
}

// API-87 POST /api/admin/vouchers/:id/duplicate - {code}; không gửi thì tự đặt mã mới
async function duplicateVoucher(req, res) {
  const d = await vouchers().findOne({ _id: toId(req.params["id"]) })
  if (!d) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy voucher")
  let code = str(req.body.code, 16).toUpperCase()
  if (code) {
    if (!CODE_RE.test(code)) throw new HttpError(422, "VALIDATION_ERROR", "Mã chỉ gồm chữ in hoa không dấu và số, 4-16 ký tự", { fields: { code: "Mã không hợp lệ" } })
    await assertCodeFree(code)
  } else {
    for (let i = 2; ; i++) {
      code = (d.code.slice(0, 16 - String(i).length) + i).slice(0, 16)
      if (!(await vouchers().findOne({ code }, { projection: { _id: 1 } }))) break
    }
  }
  const { _id, history, ...copy } = d
  void _id
  void history
  const now = new Date()
  Object.assign(copy, {
    code, name: `${d.name} (bản sao)`.slice(0, 120), status: "BAN_NHAP", usedCount: 0, discountGiven: 0, history: [],
    createdBy: req.user._id, updatedBy: req.user._id, createdAt: now, updatedAt: now,
  })
  copy._id = (await vouchers().insertOne(copy)).insertedId
  await writeLog({ adminId: req.user._id, action: "VOUCHER_UPDATE", targetType: "vouchers", targetId: copy._id, reason: `Nhân bản từ ${d.code}` })
  res.status(201).send(withStatus(copy, now))
}

// API-165 POST /api/admin/vouchers/bulk - {ids[], action: PAUSE|ACTIVATE|DELETE}; voucher không đủ điều kiện bỏ qua kèm lý do (1g)
async function bulkVouchers(req, res) {
  const { action } = req.body
  if (!["PAUSE", "ACTIVATE", "DELETE"].includes(action)) throw new HttpError(400, "VALIDATION_ERROR", "Thao tác không hợp lệ")
  if (!can(req, action === "DELETE" ? "VOUCHER.XOA" : "VOUCHER.SUA")) throw new HttpError(403, "FORBIDDEN", "Bạn không có quyền thực hiện thao tác này")
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(toId).filter(Boolean)
  const list = await vouchers().find({ _id: { $in: ids } }).toArray()
  const now = new Date()
  const updated = []
  const archived = []
  const skipped = []
  for (const d of list) {
    if (action === "DELETE") {
      if (await removeOrArchive(d, req.user._id)) archived.push(d.code)
      updated.push(d.code)
      continue
    }
    const to = action === "PAUSE" ? "TAM_NGUNG" : "HOAT_DONG"
    const reason =
      action === "PAUSE"
        ? d.status === "HOAT_DONG" ? null : "chỉ tạm ngừng được voucher đang hoạt động"
        : ["TAM_NGUNG", "HOAT_DONG", "LUU_TRU"].includes(d.status)
          ? activationProblem(d, now) || (d.status === "HOAT_DONG" ? "đang hoạt động" : null)
          : "chưa xuất bản, mở form để kích hoạt"
    if (reason) {
      skipped.push({ code: d.code, reason: `${d.code}: ${reason}` })
      continue
    }
    await vouchers().updateOne({ _id: d._id }, { $set: { status: to, updatedBy: req.user._id, updatedAt: now }, $push: { history: { at: now, by: req.user._id, changes: { status: [d.status, to] } } } })
    if (to === "HOAT_DONG") await voucherService.distribute({ ...d, status: to }, now)
    updated.push(d.code)
  }
  await writeLog({ adminId: req.user._id, action: "BULK_ACTION", targetType: "vouchers", reason: action, after: { updated, skipped } })
  res.send({ updated: updated.length, archived, skipped })
}

// API-166 GET /api/admin/vouchers/usage-export?ids=&from=&to= - CSV lượt dùng (mã voucher, mã đơn, khách, ngày, số tiền giảm).
// from, to (yyyy-MM-dd, giờ Việt Nam): khối Voucher ở Báo cáo tổng quan xuất theo khoảng đang xem
async function exportUsage(req, res) {
  const ids = String(req.query.ids || "").split(",").map(toId).filter(Boolean)
  const match = ids.length ? { "vouchers.voucherId": { $in: ids } } : { "vouchers.0": { $exists: true } }
  const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null)
  const from = day(req.query.from)
  const to = day(req.query.to)
  if (from || to) {
    match.createdAt = {}
    if (from) match.createdAt.$gte = new Date(`${from}T00:00:00+07:00`)
    if (to) match.createdAt.$lt = new Date(new Date(`${to}T00:00:00+07:00`).getTime() + 24 * 60 * 60 * 1000)
  }
  const list = await database.collection("orders").find(match, { projection: { code: 1, customer: 1, createdAt: 1, vouchers: 1, orderStatus: 1 } }).sort({ createdAt: -1 }).toArray()
  const idSet = new Set(ids.map(String))
  const esc = (x) => `"${String(x ?? "").replace(/"/g, '""')}"`
  const rows = [["Mã voucher", "Mã đơn", "Khách hàng", "SĐT", "Ngày đặt", "Số tiền giảm", "Trạng thái đơn"]]
  for (const o of list) {
    for (const x of o.vouchers) {
      if (ids.length && !idSet.has(String(x.voucherId))) continue
      rows.push([x.code, o.code, o.customer?.fullName, o.customer?.phone, new Date(o.createdAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }), x.discount, o.orderStatus])
    }
  }
  res.set("Content-Type", "text/csv; charset=utf-8")
  res.set("Content-Disposition", `attachment; filename="luot-dung-voucher-${math.vnDate()}.csv"`)
  res.send("﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n"))
}

// API-190 POST /api/admin/vouchers/match-customers - {contacts: [SĐT hoặc email]} từ tệp (5Eh)
async function matchCustomers(req, res) {
  const raw = Array.isArray(req.body.contacts) ? req.body.contacts : []
  const contacts = [...new Set(raw.filter((c) => typeof c === "string").map((c) => c.trim()).filter(Boolean))]
  if (!contacts.length || contacts.length > params.VOUCHER_CONTACTS_MAX) {
    throw new HttpError(422, "VALIDATION_ERROR", `Tệp không hợp lệ, cần .csv hoặc .txt, tối đa ${params.VOUCHER_CONTACTS_MAX} dòng`)
  }
  const phones = new Map()
  const emails = new Map()
  for (const c of contacts) {
    const login = v.normalizeLogin(c)
    if (login && login.phone) phones.set(login.phone, c)
    else if (login && login.email) emails.set(login.email, c)
  }
  const found = await database
    .collection("users")
    .find({ role: "member", status: "HOAT_DONG", $or: [{ phone: { $in: [...phones.keys()] } }, { email: { $in: [...emails.keys()] } }] }, { projection: { fullName: 1, phone: 1, email: 1 } })
    .toArray()
  const hit = new Set()
  for (const u of found) {
    if (phones.has(u.phone)) hit.add(phones.get(u.phone))
    if (u.email && emails.has(u.email)) hit.add(emails.get(u.email))
  }
  res.send({ matched: found, unmatched: contacts.filter((c) => !hit.has(c)) })
}

module.exports = { listVouchers, getVoucher, createVoucher, updateVoucher, deleteVoucher, duplicateVoucher, bulkVouchers, exportUsage, matchCustomers, normalize }
