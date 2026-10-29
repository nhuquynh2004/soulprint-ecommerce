// Quản trị bộ sưu tập (07_API_Spec.md Mục 2.14) - UC-CAT-05.
// API-109 GET danh sách, API-110 POST, API-111 PUT (_id trong body), API-112 DELETE,
// API-167 thao tác hàng loạt, API-168 nhân bản, API-169 xem trước BST tự động.
const { database, ObjectId } = require("../config/db")
const HttpError = require("../utils/httpError")
const { writeLog } = require("../services/adminLog")
const { slugify } = require("../services/productAdmin")
const { accentInsensitivePattern, VI_COLLATION } = require("../utils/vnText")
const { parseListQuery } = require("../services/productQuery")
const { listProducts, collectionScope } = require("../services/catalog")

const collections = () => database.collection("collections")
const PAGE_SIZE = 20
const STATUSES = ["BAN_NHAP", "HIEN_THI", "AN"]
const SORTS = ["THU_CONG", "LIEN_QUAN", "BAN_CHAY", "MOI_NHAT", "TEN_AZ", "TEN_ZA", "GIA_TANG", "GIA_GIAM"]
const RULE_OPERATORS = {
  CATEGORY: ["EQ", "NE"], AXIS: ["EQ", "NE"], TAG: ["EQ", "NE"], PRICE: ["LT", "GT"],
  CREATED_WITHIN_DAYS: ["EQ"], IN_STOCK: ["EQ"], ON_SALE: ["EQ"],
}
const toId = (v) => (v && ObjectId.isValid(String(v)) ? new ObjectId(String(v)) : null)
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "")
const dateOrNull = (v) => (v ? new Date(v) : null)
const can = (req, code) => req.isFullAccess || req.permissions.has(code)

// Trạng thái hiển thị tính từ status và thời gian (06 Mục 2.6): Bản nháp / Ẩn / Đã lên lịch / Hết hạn / Đang hiện
function displayStatus(c, now = new Date()) {
  if (c.status !== "HIEN_THI") return c.status
  if (c.startAt && new Date(c.startAt) > now) return "DA_LEN_LICH"
  if (c.endAt && new Date(c.endAt) < now) return "HET_HAN"
  return "DANG_HIEN"
}

// Kiểm tra điều kiện BST tự động, trả danh sách đã chuẩn hóa hoặc ném lỗi tại trường rules
function normalizeRules(input) {
  const rules = []
  for (const r of Array.isArray(input) ? input : []) {
    const field = r && r.field
    const ops = RULE_OPERATORS[field]
    if (!ops) throw new HttpError(422, "VALIDATION_ERROR", "Điều kiện không hợp lệ", { fields: { rules: "Điều kiện không hợp lệ" } })
    const operator = ops.includes(r.operator) ? r.operator : ops[0]
    let value = r.value
    if (["CATEGORY", "TAG"].includes(field) && !toId(value)) value = null
    if (field === "AXIS" && !["THE_THAO", "ANIME", "GAME"].includes(value)) value = null
    if (["PRICE", "CREATED_WITHIN_DAYS"].includes(field)) value = Number(value) > 0 ? Number(value) : null
    if (["IN_STOCK", "ON_SALE"].includes(field)) value = value !== false && value !== "false"
    if (value === null) throw new HttpError(422, "VALIDATION_ERROR", "Điều kiện chưa có giá trị hợp lệ", { fields: { rules: "Điều kiện chưa có giá trị hợp lệ" } })
    rules.push({ field, operator, value: ["CATEGORY", "TAG"].includes(field) ? String(value) : value })
  }
  return rules
}

// Chuẩn hóa form BST; existing là BST đang sửa (null khi tạo). Trường không gửi giữ giá trị cũ (API-111 "một phần").
async function normalize(body, existing = null) {
  const pick = (k, d) => (body[k] !== undefined ? body[k] : existing ? existing[k] : d)
  const fields = {}
  const doc = {
    name: str(pick("name", ""), 120),
    slug: str(pick("slug", ""), 120).toLowerCase(),
    description: str(pick("description", ""), 300),
    coverImage: str(pick("coverImage", ""), 300) || null,
    type: pick("type", "THU_CONG") === "TU_DONG" ? "TU_DONG" : "THU_CONG",
    code: str(pick("code", "") || "", 6).toUpperCase() || null, // mã BST trong SKU sản phẩm, chỉ BST chọn tay (BR-46)
    status: STATUSES.includes(pick("status", "BAN_NHAP")) ? pick("status", "BAN_NHAP") : "BAN_NHAP",
    showOnHome: !!pick("showOnHome", false),
    startAt: dateOrNull(pick("startAt", null)),
    endAt: dateOrNull(pick("endAt", null)),
  }
  doc.sortBy = SORTS.includes(pick("sortBy", null)) ? pick("sortBy") : doc.type === "THU_CONG" ? "THU_CONG" : "BAN_CHAY"
  if (doc.type === "TU_DONG" && doc.sortBy === "THU_CONG") doc.sortBy = "BAN_CHAY" // Thủ công chỉ dành cho chọn tay
  if (doc.type === "THU_CONG" && doc.sortBy === "LIEN_QUAN") doc.sortBy = "THU_CONG" // Liên quan nhất chỉ dành cho tự động
  const sortOrder = pick("sortOrder", null)
  doc.sortOrder = Number.isInteger(Number(sortOrder)) && sortOrder !== null && sortOrder !== "" ? Number(sortOrder) : null

  if (doc.name.length < 2) fields.name = "Nhập tên bộ sưu tập (2-120 ký tự)"
  if (!doc.slug) doc.slug = slugify(doc.name)
  if (doc.slug && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(doc.slug)) fields.slug = "Đường dẫn chỉ gồm chữ thường không dấu, số và dấu gạch"
  if (doc.coverImage && !/^\/(api\/files|images)\//.test(doc.coverImage)) fields.coverImage = "Ảnh bìa không hợp lệ"
  if (doc.type === "TU_DONG") doc.code = null
  else if (doc.code && !/^[A-Z0-9]{2,6}$/.test(doc.code)) fields.code = "Mã BST cần 2-6 ký tự A-Z, 0-9"
  if ((doc.startAt && isNaN(doc.startAt)) || (doc.endAt && isNaN(doc.endAt))) fields.startAt = "Thời gian không hợp lệ"
  else if (doc.startAt && doc.endAt && doc.endAt <= doc.startAt) fields.endAt = "Ngày kết thúc phải sau ngày bắt đầu"

  // Chọn tay: productIds theo thứ tự hiển thị, chỉ giữ sản phẩm có thật. Tự động: rules + matchMode, không lưu productIds.
  if (doc.type === "THU_CONG") {
    const ids = [...new Set((pick("productIds", []) || []).map(String))].map(toId).filter(Boolean)
    const found = await database.collection("products").find({ _id: { $in: ids } }, { projection: { _id: 1 } }).toArray()
    doc.productIds = ids.filter((id) => found.some((f) => f._id.equals(id)))
    doc.rules = []
    doc.matchMode = null
  } else {
    doc.productIds = []
    try {
      doc.rules = normalizeRules(pick("rules", []))
    } catch (err) {
      Object.assign(fields, err.extra.fields)
      doc.rules = []
    }
    doc.matchMode = pick("matchMode", "ALL") === "ANY" ? "ANY" : "ALL"
  }
  if (doc.status !== "BAN_NHAP" && !fields.rules && !(doc.type === "THU_CONG" ? doc.productIds.length : doc.rules.length)) {
    fields[doc.type === "THU_CONG" ? "productIds" : "rules"] = "Bộ sưu tập cần ít nhất 1 sản phẩm (chọn tay) hoặc 1 điều kiện (tự động)"
  }
  if (Object.keys(fields).length) throw new HttpError(422, "VALIDATION_ERROR", Object.values(fields)[0], { fields })

  const dup = await collections().findOne({ slug: doc.slug, ...(existing ? { _id: { $ne: existing._id } } : {}) })
  if (dup) throw new HttpError(409, "CONFLICT", "Đường dẫn đã tồn tại", { fields: { slug: "Đường dẫn đã tồn tại" } })
  if (doc.code && (await collections().findOne({ code: doc.code, ...(existing ? { _id: { $ne: existing._id } } : {}) }))) {
    throw new HttpError(409, "CONFLICT", "Mã BST đã tồn tại", { fields: { code: "Mã BST đã tồn tại" } })
  }
  return doc
}

// Số sản phẩm khách thấy trong BST (cùng cách đếm với trang SCR-32)
async function productCount(c, now) {
  const r = await listProducts(parseListQuery({ pageSize: 1 }), collectionScope(c, now), now)
  return r.total
}

// API-109 GET /api/admin/collections?status=&type=&showOnHome=&q=&sort=&page=
// status nhận cả trạng thái hiển thị tính sẵn: DANG_HIEN, DA_LEN_LICH, HET_HAN
async function listCollections(req, res) {
  const now = new Date()
  const filter = {}
  if (["THU_CONG", "TU_DONG"].includes(req.query.type)) filter.type = req.query.type
  if (req.query.showOnHome === "true") filter.showOnHome = true
  if (req.query.showOnHome === "false") filter.showOnHome = { $ne: true }
  const q = String(req.query.q || "").trim()
  if (q) filter.name = { $regex: accentInsensitivePattern(q), $options: "i" }
  const sort = { ten: { name: 1 }, "-ten": { name: -1 }, moi: { createdAt: -1 } }[req.query.sort] || { sortOrder: 1, _id: 1 }
  const page = Math.max(1, parseInt(req.query.page) || 1)

  const all = (await collections().find(filter, { collation: VI_COLLATION }).sort(sort).toArray()).map((c) => ({ ...c, displayStatus: displayStatus(c, now) }))
  const status = String(req.query.status || "")
  const list = status ? all.filter((c) => c.displayStatus === status || c.status === status) : all
  const items = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  for (const c of items) c.productCount = await productCount(c, now)
  const counts = all.reduce((m, c) => ({ ...m, [c.displayStatus]: (m[c.displayStatus] || 0) + 1 }), { ALL: all.length })
  res.send({ items, page, pageSize: PAGE_SIZE, total: list.length, counts })
}

// GET /api/admin/collections/:id - đọc 1 BST để mở form sửa (dùng chung quyền API-109)
async function getCollection(req, res) {
  const c = await collections().findOne({ _id: toId(req.params["id"]) })
  if (!c) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy bộ sưu tập")
  const products = c.productIds?.length
    ? await database.collection("products").find({ _id: { $in: c.productIds } }, { projection: { name: 1, sku: 1, images: { $slice: 1 }, price: 1, salePrice: 1, status: 1 } }).toArray()
    : []
  const byId = new Map(products.map((p) => [String(p._id), p]))
  res.send({ ...c, displayStatus: displayStatus(c), products: c.productIds.map((id) => byId.get(String(id))).filter(Boolean) })
}

// API-110 POST /api/admin/collections
async function createCollection(req, res) {
  const doc = await normalize(req.body)
  if (doc.sortOrder === null) {
    const last = await collections().find({}).sort({ sortOrder: -1 }).limit(1).next()
    doc.sortOrder = (last?.sortOrder || 0) + 1
  }
  const now = new Date()
  Object.assign(doc, { createdBy: req.user._id, updatedBy: req.user._id, createdAt: now, updatedAt: now })
  doc._id = (await collections().insertOne(doc)).insertedId
  await writeLog({ adminId: req.user._id, action: "COLLECTION_UPDATE", targetType: "collections", targetId: doc._id, after: { name: doc.name, status: doc.status } })
  res.status(201).send({ ...doc, displayStatus: displayStatus(doc, now) })
}

// API-111 PUT /api/admin/collections - _id trong body, gửi một phần (VD {_id, status: "AN"})
async function updateCollection(req, res) {
  const existing = await collections().findOne({ _id: toId(req.body._id) })
  if (!existing) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy bộ sưu tập")
  const doc = await normalize(req.body, existing)
  if (doc.sortOrder === null) doc.sortOrder = existing.sortOrder ?? 0
  await collections().updateOne({ _id: existing._id }, { $set: { ...doc, updatedBy: req.user._id, updatedAt: new Date() } })
  await writeLog({
    adminId: req.user._id, action: "COLLECTION_UPDATE", targetType: "collections", targetId: existing._id,
    before: { name: existing.name, status: existing.status, showOnHome: existing.showOnHome }, after: { name: doc.name, status: doc.status, showOnHome: doc.showOnHome },
  })
  const fresh = await collections().findOne({ _id: existing._id })
  res.send({ ...fresh, displayStatus: displayStatus(fresh) })
}

// API-112 DELETE /api/admin/collections/:id - sản phẩm không bị ảnh hưởng
async function deleteCollection(req, res) {
  const c = await collections().findOne({ _id: toId(req.params["id"]) })
  if (!c) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy bộ sưu tập")
  await collections().deleteOne({ _id: c._id })
  await writeLog({ adminId: req.user._id, action: "COLLECTION_UPDATE", targetType: "collections", targetId: c._id, before: { name: c.name, slug: c.slug }, reason: "Xóa bộ sưu tập" })
  res.status(204).send()
}

// API-167 POST /api/admin/collections/bulk - {ids[], action: SHOW|HIDE|ADD_TO_HOME|REMOVE_FROM_HOME|DELETE}
async function bulkCollections(req, res) {
  const { action } = req.body
  const set = { SHOW: { status: "HIEN_THI" }, HIDE: { status: "AN" }, ADD_TO_HOME: { showOnHome: true }, REMOVE_FROM_HOME: { showOnHome: false } }[action]
  if (!set && action !== "DELETE") throw new HttpError(400, "VALIDATION_ERROR", "Thao tác không hợp lệ")
  if (!can(req, action === "DELETE" ? "BO_SUU_TAP.XOA" : "BO_SUU_TAP.SUA")) throw new HttpError(403, "FORBIDDEN", "Bạn không có quyền thực hiện thao tác này")
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(toId).filter(Boolean)
  const list = await collections().find({ _id: { $in: ids } }).toArray()
  const updated = []
  const skipped = []
  for (const c of list) {
    if (action === "DELETE") await collections().deleteOne({ _id: c._id })
    else {
      // Hiện BST chưa có sản phẩm/điều kiện thì bỏ qua (cùng luật 5Ea)
      if (action === "SHOW" && !(c.type === "THU_CONG" ? c.productIds?.length : c.rules?.length)) {
        skipped.push({ id: c._id, name: c.name, reason: "chưa có sản phẩm hoặc điều kiện" })
        continue
      }
      await collections().updateOne({ _id: c._id }, { $set: { ...set, updatedBy: req.user._id, updatedAt: new Date() } })
    }
    updated.push(c._id)
  }
  await writeLog({ adminId: req.user._id, action: "BULK_ACTION", targetType: "collections", reason: action, after: { updated, skipped } })
  res.send({ updated: updated.length, skipped })
}

// API-168 POST /api/admin/collections/:id/duplicate - bản nháp, xóa thời gian, slug thêm hậu tố
async function duplicateCollection(req, res) {
  const c = await collections().findOne({ _id: toId(req.params["id"]) })
  if (!c) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy bộ sưu tập")
  let slug = `${c.slug}-ban-sao`
  for (let i = 2; await collections().findOne({ slug }); i++) slug = `${c.slug}-ban-sao-${i}`
  const { _id, ...copy } = c
  void _id
  const now = new Date()
  const last = await collections().find({}).sort({ sortOrder: -1 }).limit(1).next()
  Object.assign(copy, {
    name: `${c.name} (bản sao)`.slice(0, 120), slug, status: "BAN_NHAP", showOnHome: false, startAt: null, endAt: null,
    sortOrder: (last?.sortOrder || 0) + 1, createdBy: req.user._id, updatedBy: req.user._id, createdAt: now, updatedAt: now,
  })
  copy._id = (await collections().insertOne(copy)).insertedId
  await writeLog({ adminId: req.user._id, action: "COLLECTION_UPDATE", targetType: "collections", targetId: copy._id, reason: `Nhân bản từ ${c.slug}` })
  res.status(201).send({ ...copy, displayStatus: "BAN_NHAP" })
}

// API-169 POST /api/admin/collections/rules-preview - {rules[], matchMode, sortBy} -> {count, items[] 12 sản phẩm đầu}
async function previewRules(req, res) {
  const rules = normalizeRules(req.body.rules)
  if (!rules.length) return res.send({ count: 0, items: [] })
  const now = new Date()
  const c = { type: "TU_DONG", rules, matchMode: req.body.matchMode === "ANY" ? "ANY" : "ALL", sortBy: SORTS.includes(req.body.sortBy) ? req.body.sortBy : "BAN_CHAY" }
  const r = await listProducts(parseListQuery({ pageSize: 12 }), collectionScope(c, now), now)
  res.send({ count: r.total, items: r.items })
}

module.exports = {
  listCollections, getCollection, createCollection, updateCollection, deleteCollection, bulkCollections, duplicateCollection, previewRules, displayStatus,
}
