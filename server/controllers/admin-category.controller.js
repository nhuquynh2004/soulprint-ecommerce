// Quản trị danh mục (07_API_Spec.md Mục 2.13): API-71 GET, API-72 POST, API-73 PUT (_id trong body),
// API-74 DELETE, API-164 thao tác hàng loạt. UC-CAT-01 nhánh 1e, 1f. Tối đa 2 cấp (06 Mục 2.1).
const { database, ObjectId } = require("../config/db")
const HttpError = require("../utils/httpError")
const { writeLog } = require("../services/adminLog")
const { slugify } = require("../services/productAdmin")

const categories = () => database.collection("categories")
const toId = (v) => (v && ObjectId.isValid(String(v)) ? new ObjectId(String(v)) : null)
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "")

// Số sản phẩm (mọi trạng thái) và số danh mục con của từng danh mục
async function usage() {
  const [prod, kids] = await Promise.all([
    database.collection("products").aggregate([{ $group: { _id: "$categoryId", n: { $sum: 1 } } }]).toArray(),
    categories().aggregate([{ $match: { parentId: { $ne: null } } }, { $group: { _id: "$parentId", n: { $sum: 1 } } }]).toArray(),
  ])
  return { products: new Map(prod.map((r) => [String(r._id), r.n])), children: new Map(kids.map((r) => [String(r._id), r.n])) }
}

// Kiểm tra và chuẩn hóa dữ liệu form; existing là danh mục đang sửa (null khi thêm)
async function normalize(body, existing = null) {
  const fields = {}
  const doc = {
    name: str(body.name ?? existing?.name, 60),
    slug: str(body.slug ?? existing?.slug, 80).toLowerCase(),
    code: str(body.code ?? existing?.code ?? "", 6).toUpperCase(), // mã trong SKU sản phẩm (BR-46)
    description: str(body.description ?? existing?.description ?? "", 300),
    image: str(body.image ?? existing?.image ?? "", 300),
    parentId: body.parentId !== undefined ? toId(body.parentId) : (existing?.parentId ?? null),
    sortOrder: Number.isInteger(Number(body.sortOrder)) && body.sortOrder !== null && body.sortOrder !== "" ? Number(body.sortOrder) : (existing?.sortOrder ?? null),
    isActive: body.isActive !== undefined ? !!body.isActive : (existing?.isActive ?? true),
  }
  if (doc.name.length < 2) fields.name = "Tên danh mục cần 2-60 ký tự"
  if (!doc.slug) doc.slug = slugify(doc.name)
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(doc.slug)) fields.slug = "Đường dẫn chỉ gồm chữ thường không dấu, số và dấu gạch"
  if (doc.image && !/^\/(api\/files|images)\//.test(doc.image)) fields.image = "Ảnh không hợp lệ"
  // Danh mục cũ chưa có mã vẫn kéo thả thứ tự được; thêm mới hoặc gửi ô mã thì bắt buộc
  if (doc.code ? !/^[A-Z0-9]{2,6}$/.test(doc.code) : !existing || body.code !== undefined) fields.code = "Mã danh mục cần 2-6 ký tự A-Z, 0-9"
  if (!doc.code) delete doc.code

  if (doc.parentId) {
    const parent = await categories().findOne({ _id: doc.parentId })
    if (!parent) fields.parentId = "Danh mục cha không tồn tại"
    else if (parent.parentId) fields.parentId = "Chỉ chọn danh mục cấp 1 làm danh mục cha (tối đa 2 cấp)"
    else if (existing && parent._id.equals(existing._id)) fields.parentId = "Không chọn chính danh mục này làm danh mục cha"
    else if (existing && (await categories().findOne({ parentId: existing._id }))) fields.parentId = "Danh mục đang có danh mục con nên không thể là danh mục con"
  }
  if (Object.keys(fields).length) throw new HttpError(422, "VALIDATION_ERROR", Object.values(fields)[0], { fields })

  const dup = await categories().findOne({ slug: doc.slug, ...(existing ? { _id: { $ne: existing._id } } : {}) })
  if (dup) throw new HttpError(409, "CONFLICT", "Đường dẫn đã tồn tại", { fields: { slug: "Đường dẫn đã tồn tại" } })
  if (doc.code && (await categories().findOne({ code: doc.code, ...(existing ? { _id: { $ne: existing._id } } : {}) }))) {
    throw new HttpError(409, "CONFLICT", "Mã danh mục đã tồn tại", { fields: { code: "Mã danh mục đã tồn tại" } })
  }
  return doc
}

// API-71 GET /api/admin/categories - cây danh mục: cấp 1 theo sortOrder, mỗi mục có children
async function listCategories(req, res) {
  const [list, use] = await Promise.all([categories().find({}).sort({ sortOrder: 1, _id: 1 }).toArray(), usage()])
  const withCount = list.map((c) => ({ ...c, productCount: use.products.get(String(c._id)) || 0 }))
  res.send(
    withCount
      .filter((c) => !c.parentId)
      .map((c) => ({ ...c, children: withCount.filter((k) => k.parentId && k.parentId.equals(c._id)) })),
  )
}

// API-72 POST /api/admin/categories
async function createCategory(req, res) {
  const doc = await normalize(req.body)
  if (doc.sortOrder === null) {
    const last = await categories().find({ parentId: doc.parentId }).sort({ sortOrder: -1 }).limit(1).next()
    doc.sortOrder = (last?.sortOrder || 0) + 1
  }
  const now = new Date()
  Object.assign(doc, { createdAt: now, updatedAt: now })
  doc._id = (await categories().insertOne(doc)).insertedId
  await writeLog({ adminId: req.user._id, action: "CATEGORY_UPDATE", targetType: "categories", targetId: doc._id, after: { name: doc.name } })
  res.status(201).send(doc)
}

// API-73 PUT /api/admin/categories - _id trong body; dùng cả cho kéo thả thứ tự ({_id, sortOrder})
async function updateCategory(req, res) {
  const existing = await categories().findOne({ _id: toId(req.body._id) })
  if (!existing) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy danh mục")
  const doc = await normalize(req.body, existing)
  await categories().updateOne({ _id: existing._id }, { $set: { ...doc, updatedAt: new Date() } })
  await writeLog({
    adminId: req.user._id, action: "CATEGORY_UPDATE", targetType: "categories", targetId: existing._id,
    before: { name: existing.name, isActive: existing.isActive, sortOrder: existing.sortOrder }, after: { name: doc.name, isActive: doc.isActive, sortOrder: doc.sortOrder },
  })
  res.send(await categories().findOne({ _id: existing._id }))
}

// Lý do không xóa được (còn sản phẩm hoặc danh mục con), null nếu xóa được
function deleteBlocker(c, use) {
  const p = use.products.get(String(c._id)) || 0
  const k = use.children.get(String(c._id)) || 0
  if (p) return `còn ${p} sản phẩm`
  if (k) return `còn ${k} danh mục con`
  return null
}

// API-74 DELETE /api/admin/categories/:id
async function deleteCategory(req, res) {
  const c = await categories().findOne({ _id: toId(req.params["id"]) })
  if (!c) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy danh mục")
  const reason = deleteBlocker(c, await usage())
  if (reason) throw new HttpError(409, "CONFLICT", `Không xóa được danh mục "${c.name}": ${reason}`)
  await categories().deleteOne({ _id: c._id })
  await writeLog({ adminId: req.user._id, action: "CATEGORY_UPDATE", targetType: "categories", targetId: c._id, before: { name: c.name }, reason: "Xóa danh mục" })
  res.status(204).send()
}

// API-164 POST /api/admin/categories/bulk - {ids[], action: SHOW|HIDE|DELETE}
async function bulkCategories(req, res) {
  const { action } = req.body
  const need = { SHOW: "DANH_MUC.SUA", HIDE: "DANH_MUC.SUA", DELETE: "DANH_MUC.XOA" }[action]
  if (!need) throw new HttpError(400, "VALIDATION_ERROR", "Thao tác không hợp lệ")
  if (!(req.isFullAccess || req.permissions.has(need))) throw new HttpError(403, "FORBIDDEN", "Bạn không có quyền thực hiện thao tác này")
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(toId).filter(Boolean)
  // Danh mục con xử lý trước để chọn cả cha lẫn con thì xóa được cả hai
  const list = (await categories().find({ _id: { $in: ids } }).toArray()).sort((a, b) => (b.parentId ? 1 : 0) - (a.parentId ? 1 : 0))
  const use = action === "DELETE" ? await usage() : null
  const updated = []
  const skipped = []
  for (const c of list) {
    if (action === "DELETE") {
      const reason = deleteBlocker(c, use)
      if (reason) {
        skipped.push({ id: c._id, name: c.name, reason })
        continue
      }
      await categories().deleteOne({ _id: c._id })
      if (c.parentId) use.children.set(String(c.parentId), (use.children.get(String(c.parentId)) || 1) - 1)
    } else {
      await categories().updateOne({ _id: c._id }, { $set: { isActive: action === "SHOW", updatedAt: new Date() } })
    }
    updated.push(c._id)
  }
  await writeLog({ adminId: req.user._id, action: "BULK_ACTION", targetType: "categories", reason: action, after: { updated, skipped } })
  res.send({ updated: updated.length, skipped })
}

module.exports = { listCategories, createCategory, updateCategory, deleteCategory, bulkCategories }
