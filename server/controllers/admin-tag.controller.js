// Quản trị tag và nhóm tag (07_API_Spec.md Mục 2.13) - UC-CAT-04.
// Tag: API-75 GET, API-76 POST, API-77 PUT (_id trong body), API-78 DELETE, API-79 gắn tag hàng loạt.
// Nhóm tag: API-186 GET, API-187 POST, API-188 PUT (code trong body), API-189 DELETE.
// Nhu cầu chưa đáp ứng: API-80 GET, API-81 PUT (dữ liệu aiGaps do tư vấn AI ghi ở S10).
const { database, ObjectId } = require("../config/db")
const HttpError = require("../utils/httpError")
const { writeLog } = require("../services/adminLog")
const { slugify } = require("../services/productAdmin")
const { removeAccents, accentInsensitivePattern } = require("../utils/vnText")
const { basePrice } = require("../services/pricing")
const { customerVisible } = require("../services/productQuery")

const tags = () => database.collection("tags")
const groups = () => database.collection("tagGroups")
const products = () => database.collection("products")
const toId = (v) => (v && ObjectId.isValid(String(v)) ? new ObjectId(String(v)) : null)
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "")
const numOrNull = (v) => (v === null || v === undefined || v === "" ? null : Number(v))
const vi = { locale: "vi", strength: 1 } // so sánh tên không phân biệt hoa thường, dấu

// Sản phẩm khớp 1 tag khoảng: PRICE theo giá hiệu lực, AGE theo khoảng ageMin-ageMax giao với khoảng tag.
// Cùng cách lọc của API-26 (priceMin/priceMax, age) để số trên SCR-44 bằng số kết quả ở SCR-02 (AC5).
function matchesRange(product, field, range, now) {
  const max = range.max ?? Infinity
  if (field === "PRICE") {
    const price = basePrice(product, now)
    return price >= range.min && price <= max
  }
  const lo = product.ageMin ?? -Infinity
  const hi = product.ageMax ?? Infinity
  return lo <= max && hi >= range.min
}

// Số sản phẩm của từng tag: nhóm danh sách đếm sản phẩm đang gắn; nhóm khoảng đếm sản phẩm khách thấy khớp khoảng
async function countByTag(list, groupList) {
  const now = new Date()
  const kindOf = new Map(groupList.map((g) => [g.code, g]))
  const [used, visible] = await Promise.all([
    products().aggregate([{ $unwind: "$tagIds" }, { $group: { _id: "$tagIds", n: { $sum: 1 } } }]).toArray(),
    list.some((t) => kindOf.get(t.group)?.kind === "RANGE")
      ? products().find(customerVisible(), { projection: { price: 1, salePrice: 1, saleStartAt: 1, saleEndAt: 1, ageMin: 1, ageMax: 1 } }).toArray()
      : [],
  ])
  const usedMap = new Map(used.map((r) => [String(r._id), r.n]))
  return new Map(
    list.map((t) => {
      const g = kindOf.get(t.group)
      const n = g?.kind === "RANGE" && t.range ? visible.filter((p) => matchesRange(p, g.rangeField, t.range, now)).length : usedMap.get(String(t._id)) || 0
      return [String(t._id), n]
    }),
  )
}

// API-75 GET /api/admin/tags?group= - tag kèm số sản phẩm
async function listTags(req, res) {
  const filter = req.query.group ? { group: String(req.query.group) } : {}
  const [list, groupList] = await Promise.all([tags().find(filter).sort({ _id: 1 }).toArray(), groups().find({}).toArray()])
  const counts = await countByTag(list, groupList)
  res.send(list.map((t) => ({ ...t, productCount: counts.get(String(t._id)) || 0 })))
}

// Kiểm tra và chuẩn hóa tag; existing là tag đang sửa (null khi thêm). Nhóm không đổi khi sửa.
async function normalizeTag(body, existing = null) {
  const fields = {}
  const groupCode = existing ? existing.group : str(body.group, 40)
  const group = await groups().findOne({ code: groupCode })
  if (!group) throw new HttpError(422, "VALIDATION_ERROR", "Nhóm tag không tồn tại", { fields: { group: "Chọn nhóm tag" } })
  const doc = {
    name: str(body.name ?? existing?.name, 40),
    slug: str(body.slug ?? existing?.slug, 60).toLowerCase(),
    group: group.code,
    synonyms: (Array.isArray(body.synonyms) ? body.synonyms : existing?.synonyms || []).map((s) => str(s, 40)).filter(Boolean).slice(0, 20),
    isFilter: body.isFilter !== undefined ? !!body.isFilter : (existing?.isFilter ?? true),
    description: str(body.description ?? existing?.description ?? "", 160),
  }
  if (doc.name.length < 1) fields.name = "Nhập tên tag"
  if (!doc.slug) doc.slug = slugify(doc.name)
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(doc.slug)) fields.slug = "Đường dẫn chỉ gồm chữ thường không dấu, số và dấu gạch"

  if (group.kind === "RANGE") {
    const r = body.range ?? existing?.range ?? {}
    const min = numOrNull(r.min)
    const max = numOrNull(r.max)
    if (min === null || !Number.isFinite(min) || min < 0) fields.range = "Nhập giá trị \"từ\" không âm"
    else if (max !== null && !(Number.isFinite(max) && max >= min)) fields.range = "Giá trị \"từ\" phải nhỏ hơn hoặc bằng \"đến\""
    else doc.range = { min, max }
  }
  if (Object.keys(fields).length) throw new HttpError(422, "VALIDATION_ERROR", Object.values(fields)[0], { fields })

  const not = existing ? { _id: { $ne: existing._id } } : {}
  if (await tags().findOne({ ...not, group: doc.group, name: doc.name }, { collation: vi })) {
    throw new HttpError(409, "CONFLICT", `Tag "${doc.name}" đã có trong nhóm ${group.name}`, { fields: { name: "Tên tag bị trùng trong nhóm" } })
  }
  if (await tags().findOne({ ...not, group: doc.group, slug: doc.slug })) {
    throw new HttpError(409, "CONFLICT", "Đường dẫn tag bị trùng trong nhóm", { fields: { slug: "Đường dẫn bị trùng" } })
  }
  return doc
}

// API-76 POST /api/admin/tags
async function createTag(req, res) {
  const doc = await normalizeTag(req.body)
  const now = new Date()
  Object.assign(doc, { createdAt: now, updatedAt: now })
  doc._id = (await tags().insertOne(doc)).insertedId
  await writeLog({ adminId: req.user._id, action: "TAG_UPDATE", targetType: "tags", targetId: doc._id, after: { name: doc.name, group: doc.group } })
  res.status(201).send(doc)
}

// API-77 PUT /api/admin/tags
async function updateTag(req, res) {
  const existing = await tags().findOne({ _id: toId(req.body._id) })
  if (!existing) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy tag")
  const doc = await normalizeTag(req.body, existing)
  await tags().updateOne({ _id: existing._id }, { $set: { ...doc, updatedAt: new Date() } })
  await writeLog({ adminId: req.user._id, action: "TAG_UPDATE", targetType: "tags", targetId: existing._id, before: { name: existing.name }, after: { name: doc.name } })
  res.send(await tags().findOne({ _id: existing._id }))
}

// API-78 DELETE /api/admin/tags/:id - gỡ tag khỏi mọi sản phẩm
async function deleteTag(req, res) {
  const t = await tags().findOne({ _id: toId(req.params["id"]) })
  if (!t) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy tag")
  await products().updateMany({ tagIds: t._id }, { $pull: { tagIds: t._id } })
  await tags().deleteOne({ _id: t._id })
  await writeLog({ adminId: req.user._id, action: "TAG_UPDATE", targetType: "tags", targetId: t._id, before: { name: t.name, group: t.group }, reason: "Xóa tag" })
  res.status(204).send()
}

// API-79 PUT /api/admin/products/bulk-tags - {productIds[], addTagIds[], removeTagIds[]}; tag nhóm khoảng không gắn tay
async function bulkTags(req, res) {
  const ids = (Array.isArray(req.body.productIds) ? req.body.productIds : []).map(toId).filter(Boolean)
  if (!ids.length) throw new HttpError(400, "VALIDATION_ERROR", "Chọn ít nhất 1 sản phẩm")
  const rangeCodes = (await groups().find({ kind: "RANGE" }).toArray()).map((g) => g.code)
  const listTagIds = async (arr) => {
    const want = (Array.isArray(arr) ? arr : []).map(toId).filter(Boolean)
    return want.length ? (await tags().find({ _id: { $in: want }, group: { $nin: rangeCodes } }).toArray()).map((t) => t._id) : []
  }
  const add = await listTagIds(req.body.addTagIds)
  const remove = await listTagIds(req.body.removeTagIds)
  if (!add.length && !remove.length) throw new HttpError(400, "VALIDATION_ERROR", "Chọn tag cần thêm hoặc bớt")

  const found = (await products().find({ _id: { $in: ids } }, { projection: { _id: 1 } }).toArray()).map((p) => p._id)
  const failed = ids.filter((id) => !found.some((f) => f.equals(id))).map((id) => ({ id, reason: "Không tìm thấy sản phẩm" }))
  const now = new Date()
  // 2 lệnh riêng vì MongoDB không cho $addToSet và $pull cùng một trường trong 1 lệnh
  if (add.length) await products().updateMany({ _id: { $in: found } }, { $addToSet: { tagIds: { $each: add } }, $set: { updatedAt: now, updatedBy: req.user._id } })
  if (remove.length) await products().updateMany({ _id: { $in: found } }, { $pull: { tagIds: { $in: remove } }, $set: { updatedAt: now, updatedBy: req.user._id } })
  await writeLog({ adminId: req.user._id, action: "BULK_ACTION", targetType: "products", reason: "BULK_TAGS", after: { products: found.length, add, remove } })
  res.send({ updated: found.length, failed })
}

// API-186 GET /api/admin/tag-groups - nhóm theo thứ tự kèm số tag
async function listGroups(req, res) {
  const [list, counts] = await Promise.all([
    groups().find({}).sort({ sortOrder: 1, _id: 1 }).toArray(),
    tags().aggregate([{ $group: { _id: "$group", n: { $sum: 1 } } }]).toArray(),
  ])
  const n = new Map(counts.map((c) => [c._id, c.n]))
  res.send(list.map((g) => ({ ...g, tagCount: n.get(g.code) || 0 })))
}

function groupFields(body, existing = null) {
  const fields = {}
  const doc = {
    name: str(body.name ?? existing?.name, 40),
    description: str(body.description ?? existing?.description ?? "", 160),
    isFilter: body.isFilter !== undefined ? !!body.isFilter : (existing?.isFilter ?? true),
  }
  if (doc.name.length < 2) fields.name = "Tên nhóm cần 2-40 ký tự"
  return { doc, fields }
}

async function assertGroupName(name, exceptCode = null) {
  const dup = await groups().findOne({ name, ...(exceptCode ? { code: { $ne: exceptCode } } : {}) }, { collation: vi })
  if (dup) throw new HttpError(409, "CONFLICT", `Nhóm "${name}" đã tồn tại`, { fields: { name: "Tên nhóm bị trùng" } })
}

// API-187 POST /api/admin/tag-groups - {name, description, kind, rangeField?, isFilter}
async function createGroup(req, res) {
  const { doc, fields } = groupFields(req.body)
  doc.kind = req.body.kind === "RANGE" ? "RANGE" : "LIST"
  doc.rangeField = doc.kind === "RANGE" ? (["PRICE", "AGE"].includes(req.body.rangeField) ? req.body.rangeField : null) : null
  if (doc.kind === "RANGE" && !doc.rangeField) fields.rangeField = "Chọn khoảng theo Giá hoặc Độ tuổi"
  if (Object.keys(fields).length) throw new HttpError(422, "VALIDATION_ERROR", Object.values(fields)[0], { fields })
  await assertGroupName(doc.name)

  // Mã nhóm: NT_ + tên không dấu viết hoa (06 Mục 2.2); trùng thì thêm số
  const base = "NT_" + (removeAccents(doc.name).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || "NHOM")
  let code = base
  for (let i = 2; await groups().findOne({ code }); i++) code = `${base}_${i}`
  const last = await groups().find({}).sort({ sortOrder: -1 }).limit(1).next()
  const now = new Date()
  Object.assign(doc, { code, isSystem: false, sortOrder: (last?.sortOrder || 0) + 1, createdAt: now, updatedAt: now })
  doc._id = (await groups().insertOne(doc)).insertedId
  await writeLog({ adminId: req.user._id, action: "TAG_UPDATE", targetType: "tagGroups", targetId: doc._id, after: { code, name: doc.name } })
  res.status(201).send({ ...doc, tagCount: 0 })
}

// API-188 PUT /api/admin/tag-groups - code trong body; kind, rangeField không đổi; isFilter áp cho mọi tag trong nhóm
async function updateGroup(req, res) {
  const existing = await groups().findOne({ code: String(req.body.code || "") })
  if (!existing) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy nhóm tag")
  const { doc, fields } = groupFields(req.body, existing)
  if (req.body.sortOrder !== undefined) {
    const s = Number(req.body.sortOrder)
    if (!Number.isInteger(s) || s < 0) fields.sortOrder = "Thứ tự phải là số nguyên không âm"
    else doc.sortOrder = s
  }
  if (Object.keys(fields).length) throw new HttpError(422, "VALIDATION_ERROR", Object.values(fields)[0], { fields })
  await assertGroupName(doc.name, existing.code)
  await groups().updateOne({ _id: existing._id }, { $set: { ...doc, updatedAt: new Date() } })
  if (req.body.isFilter !== undefined && doc.isFilter !== existing.isFilter) {
    await tags().updateMany({ group: existing.code }, { $set: { isFilter: doc.isFilter, updatedAt: new Date() } })
  }
  await writeLog({
    adminId: req.user._id, action: "TAG_UPDATE", targetType: "tagGroups", targetId: existing._id,
    before: { name: existing.name, isFilter: existing.isFilter }, after: { name: doc.name, isFilter: doc.isFilter },
  })
  res.send(await groups().findOne({ _id: existing._id }))
}

// API-189 DELETE /api/admin/tag-groups/:code - xóa tag của nhóm và gỡ khỏi sản phẩm; nhóm hệ thống không xóa được
async function deleteGroup(req, res) {
  const g = await groups().findOne({ code: req.params["code"] })
  if (!g) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy nhóm tag")
  if (g.isSystem) throw new HttpError(403, "FORBIDDEN", "Nhóm hệ thống không xóa được (bộ lọc và tư vấn AI dựa vào nhóm này)")
  const ids = (await tags().find({ group: g.code }, { projection: { _id: 1 } }).toArray()).map((t) => t._id)
  if (ids.length) await products().updateMany({ tagIds: { $in: ids } }, { $pull: { tagIds: { $in: ids } } })
  await tags().deleteMany({ group: g.code })
  await groups().deleteOne({ _id: g._id })
  await writeLog({ adminId: req.user._id, action: "TAG_UPDATE", targetType: "tagGroups", targetId: g._id, before: { code: g.code, name: g.name, tags: ids.length }, reason: "Xóa nhóm tag" })
  res.status(204).send()
}

// API-80 GET /api/admin/ai/gaps?status=&q= - nhu cầu chưa đáp ứng, nhiều lần nhất trước.
// counts đếm trên toàn bộ dữ liệu: trước đây client đếm trên 200 dòng đã tải nên nhu cầu mới không làm tăng số trên tab.
async function listGaps(req, res) {
  const gaps = database.collection("aiGaps")
  const filter = ["MOI", "DA_XU_LY"].includes(req.query.status) ? { status: req.query.status } : {}
  const q = String(req.query.q || "").trim().slice(0, 100)
  if (q) {
    const re = { $regex: accentInsensitivePattern(q), $options: "i" }
    filter.$or = [{ criteriaKey: re }, { sampleInput: re }]
  }
  const [items, MOI, DA_XU_LY] = await Promise.all([
    gaps.find(filter).sort({ count: -1, lastSeenAt: -1 }).limit(200).toArray(),
    gaps.countDocuments({ status: "MOI" }),
    gaps.countDocuments({ status: "DA_XU_LY" }),
  ])
  res.send({ items, counts: { MOI, DA_XU_LY } })
}

// API-81 PUT /api/admin/ai/gaps/:id - {status: "DA_XU_LY"}
async function updateGap(req, res) {
  if (req.body.status !== "DA_XU_LY") throw new HttpError(400, "VALIDATION_ERROR", "Trạng thái không hợp lệ")
  const r = await database.collection("aiGaps").findOneAndUpdate(
    { _id: toId(req.params["id"]) },
    { $set: { status: "DA_XU_LY", handledBy: req.user._id } },
    { returnDocument: "after" },
  )
  if (!r) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy nhu cầu")
  res.send(r)
}

module.exports = { listTags, createTag, updateTag, deleteTag, bulkTags, listGroups, createGroup, updateGroup, deleteGroup, listGaps, updateGap, matchesRange }
