// Mẫu gói quà gợi ý, vật liệu gói quà và nhập xuất kho vật liệu (07_API_Spec.md Mục 2.15 - UC-CAT-06, BR-36):
// API-123..126 mẫu, API-127..130 vật liệu, API-172, API-173 hàng loạt, API-174 lịch sử, API-175 phiếu nhập / điều chỉnh.
const { database } = require("../config/db")
const HttpError = require("../utils/httpError")
const { writeLog } = require("../services/adminLog")
const { accentInsensitivePattern } = require("../utils/vnText")
const g = require("../services/giftAdmin")

const templates = () => database.collection("giftWrapTemplates")
const materials = () => database.collection("giftWrapMaterials")
const movements = () => database.collection("stockMovements")

const MATERIAL_KINDS = ["GIAY_GOI", "RUY_BANG", "THIEP"]
const SLOTS = { paper: "GIAY_GOI", ribbon: "RUY_BANG", card: "THIEP" }
const MOVEMENT_TYPES = ["NHAP", "DIEU_CHINH", "XUAT_DON", "HOAN_DON"]
const ADJUST_REASONS = ["HONG", "KIEM_KE", "KHAC"]
const DAY = 24 * 60 * 60 * 1000

// ===== Mẫu gói quà =====

async function readTemplate(body, existing = null) {
  const fields = {}
  const pick = (k, d) => (body[k] !== undefined ? body[k] : existing && existing[k] !== undefined ? existing[k] : d)
  const doc = {
    code: g.str(pick("code", ""), 20).toUpperCase(),
    name: g.str(pick("name", ""), 60),
    description: g.str(pick("description", ""), 60),
    image: g.str(pick("image", ""), 300),
    ...(await g.readSeason(body, existing, fields)),
    sortOrder: pick("sortOrder", null) !== null && Number.isInteger(Number(pick("sortOrder"))) ? Number(pick("sortOrder")) : null,
    isActive: pick("isActive", true) !== false,
  }
  if (doc.name.length < 2) fields.name = "Tên mẫu cần 2-60 ký tự"
  if (!g.imageOk(doc.image)) fields.image = "Ảnh không hợp lệ"
  if (doc.code && !/^[A-Z0-9-]{2,20}$/.test(doc.code)) fields.code = "Mã chỉ gồm chữ in hoa, số, dấu gạch"

  // Vật liệu: nhận paperCode/ribbonCode/cardCode (07 API-124), phải tồn tại và đang hiện (1dEa)
  const codes = {
    paper: g.str(body.paperCode ?? existing?.paper?.code, 30),
    ribbon: g.str(body.ribbonCode ?? existing?.ribbon?.code, 30),
    card: g.str(body.cardCode ?? existing?.card?.code, 30),
  }
  const found = new Map((await materials().find({ code: { $in: Object.values(codes).filter(Boolean) } }).toArray()).map((m) => [m.code, m]))
  for (const [slot, kind] of Object.entries(SLOTS)) {
    const m = found.get(codes[slot])
    const key = `${slot}Code`
    if (!codes[slot]) fields[key] = "Chọn vật liệu"
    else if (!m || m.kind !== kind) fields[key] = "Vật liệu không tồn tại"
    else if (m.isActive === false) fields[key] = `Vật liệu "${m.name}" đang ẩn, hãy hiện vật liệu hoặc chọn vật liệu khác`
    else doc[slot] = { code: m.code, name: m.name }
  }
  g.assertNoErrors(fields)

  const others = await templates()
    .find(existing ? { _id: { $ne: existing._id } } : {})
    .project({ code: 1 })
    .toArray()
  const taken = new Set(others.map((t) => t.code).filter(Boolean))
  if (doc.code && taken.has(doc.code)) throw new HttpError(409, "CONFLICT", "Mã mẫu đã tồn tại", { fields: { code: "Mã mẫu đã tồn tại" } })
  if (!doc.code) doc.code = g.nextCode(doc.kind === "BST_MUA" ? "GQ-MUA" : "GQ-TH", taken)
  return doc
}

// Trạng thái tồn của mẫu: "Tạm hết" khi có vật liệu hết tồn hoặc đang ẩn (BR-36)
async function decorateTemplates(list, now = new Date()) {
  const mats = new Map((await materials().find({}).toArray()).map((m) => [m.code, m]))
  return list.map((t) => {
    const missing = Object.keys(SLOTS)
      .map((slot) => mats.get(t[slot]?.code))
      .filter((m) => !m || m.isActive === false || (m.stock || 0) < 1)
      .map((m) => (m ? m.name : "vật liệu đã xóa"))
    return { ...t, displayStatus: g.displayStatus(t, now), outOfStock: missing }
  })
}

// API-123 GET /api/admin/gift-wrap-templates?kind=&status=&q=
async function listTemplates(req, res) {
  const filter = {}
  if (g.KINDS.includes(req.query.kind)) filter.kind = req.query.kind
  const q = g.str(req.query.q, 60)
  if (q) {
    const re = { $regex: accentInsensitivePattern(q), $options: "i" }
    filter.$or = [{ name: re }, { code: re }, { seasonLabel: re }]
  }
  const list = await templates().find(filter).sort({ sortOrder: 1, _id: 1 }).toArray()
  const all = (await decorateTemplates(list)).sort((a, b) => (a.kind === "BST_MUA" ? 0 : 1) - (b.kind === "BST_MUA" ? 0 : 1) || (a.sortOrder || 0) - (b.sortOrder || 0))
  const status = req.query.status
  res.send(status ? all.filter((t) => t.displayStatus === status || (status === "TAM_HET" && t.outOfStock.length)) : all)
}

// API-124 POST /api/admin/gift-wrap-templates
async function createTemplate(req, res) {
  const doc = await readTemplate(req.body || {})
  if (doc.sortOrder === null) {
    const last = await templates().find({}).sort({ sortOrder: -1 }).limit(1).next()
    doc.sortOrder = (last?.sortOrder || 0) + 1
  }
  const now = new Date()
  Object.assign(doc, { createdBy: req.user._id, updatedBy: req.user._id, createdAt: now, updatedAt: now })
  doc._id = (await templates().insertOne(doc)).insertedId
  await writeLog({ adminId: req.user._id, action: "GIFT_TEMPLATE_UPDATE", targetType: "giftWrapTemplates", targetId: doc._id, after: { name: doc.name, code: doc.code } })
  res.status(201).send((await decorateTemplates([doc]))[0])
}

// API-125 PUT /api/admin/gift-wrap-templates - _id trong body, sửa một phần
async function updateTemplate(req, res) {
  const existing = await templates().findOne({ _id: g.toId(req.body && req.body._id) })
  if (!existing) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy mẫu gói quà")
  const doc = await readTemplate(req.body, existing)
  if (doc.sortOrder === null) doc.sortOrder = existing.sortOrder
  await templates().updateOne({ _id: existing._id }, { $set: { ...doc, updatedBy: req.user._id, updatedAt: new Date() } })
  await writeLog({
    adminId: req.user._id, action: "GIFT_TEMPLATE_UPDATE", targetType: "giftWrapTemplates", targetId: existing._id,
    before: { name: existing.name, isActive: existing.isActive }, after: { name: doc.name, isActive: doc.isActive },
  })
  res.send((await decorateTemplates([await templates().findOne({ _id: existing._id })]))[0])
}

// API-126 DELETE /api/admin/gift-wrap-templates/:id - đơn cũ giữ bản chụp gói quà
async function deleteTemplate(req, res) {
  const t = await templates().findOne({ _id: g.toId(req.params["id"]) })
  if (!t) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy mẫu gói quà")
  await templates().deleteOne({ _id: t._id })
  await writeLog({ adminId: req.user._id, action: "GIFT_TEMPLATE_UPDATE", targetType: "giftWrapTemplates", targetId: t._id, before: { name: t.name }, reason: "Xóa mẫu gói quà" })
  res.status(204).send()
}

// API-172 POST /api/admin/gift-wrap-templates/bulk - {ids[], action: SHOW|HIDE|SCHEDULE|DELETE|REORDER}
// SET_SEASON ("Sửa nhóm"): đặt tên BST/mùa, nhãn, thời gian cho các mẫu đã chọn
async function bulkTemplates(req, res) {
  const { action } = req.body || {}
  const need = { SHOW: "GOI_QUA.SUA", HIDE: "GOI_QUA.SUA", SCHEDULE: "GOI_QUA.SUA", REORDER: "GOI_QUA.SUA", SET_SEASON: "GOI_QUA.SUA", DELETE: "GOI_QUA.XOA" }[action]
  if (!need) throw new HttpError(400, "VALIDATION_ERROR", "Thao tác không hợp lệ")
  g.assertCan(req, need)
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(g.toId).filter(Boolean)
  const now = new Date()
  const updated = []
  const skipped = []
  if (action === "REORDER") {
    for (const [i, id] of ids.entries()) {
      await templates().updateOne({ _id: id }, { $set: { sortOrder: i + 1, updatedAt: now } })
      updated.push(id)
    }
  } else {
    let season = null
    if (action === "SET_SEASON") {
      const fields = {}
      season = await g.readSeason({ ...req.body, kind: "BST_MUA" }, null, fields)
      g.assertNoErrors(fields)
    }
    for (const t of await templates().find({ _id: { $in: ids } }).toArray()) {
      if (action === "DELETE") await templates().deleteOne({ _id: t._id })
      else if (action === "SHOW" || action === "HIDE") await templates().updateOne({ _id: t._id }, { $set: { isActive: action === "SHOW", updatedAt: now } })
      else if (action === "SET_SEASON") await templates().updateOne({ _id: t._id }, { $set: { ...season, updatedAt: now } })
      else if (action === "SCHEDULE") {
        const startAt = g.dateOrNull(req.body.startAt)
        const endAt = g.dateOrNull(req.body.endAt)
        if (t.kind !== "BST_MUA") {
          skipped.push({ id: t._id, name: t.name, reason: "Mẫu thường không có thời gian hiển thị" })
          continue
        }
        if (!startAt || !endAt || endAt <= startAt) throw new HttpError(422, "VALIDATION_ERROR", "Ngày kết thúc phải sau ngày bắt đầu", { fields: { endAt: "Ngày kết thúc phải sau ngày bắt đầu" } })
        await templates().updateOne({ _id: t._id }, { $set: { startAt, endAt, updatedAt: now } })
      }
      updated.push(t._id)
    }
  }
  await writeLog({ adminId: req.user._id, action: "BULK_ACTION", targetType: "giftWrapTemplates", reason: action, after: { updated, skipped } })
  res.send({ updated: updated.length, skipped })
}

// ===== Vật liệu gói quà =====

async function readMaterial(body, existing = null) {
  const fields = {}
  const pick = (k, d) => (body[k] !== undefined ? body[k] : existing && existing[k] !== undefined ? existing[k] : d)
  const doc = {
    kind: existing ? existing.kind : pick("kind", ""),
    code: existing ? existing.code : g.str(pick("code", ""), 20).toUpperCase(), // không đổi mã khi sửa (API-129)
    name: g.str(pick("name", ""), 60),
    description: g.str(pick("description", ""), 60),
    unit: g.str(pick("unit", ""), 15) || "cái",
    image: g.str(pick("image", ""), 300),
    sortOrder: pick("sortOrder", null) !== null && Number.isInteger(Number(pick("sortOrder"))) ? Number(pick("sortOrder")) : null,
    isActive: pick("isActive", true) !== false,
    lowStockThreshold: Number(pick("lowStockThreshold", 0)),
  }
  if (!MATERIAL_KINDS.includes(doc.kind)) fields.kind = "Chọn loại vật liệu"
  if (!/^[A-Z0-9-]{2,20}$/.test(doc.code)) fields.code = "Mã cần 2-20 ký tự: chữ in hoa, số, dấu gạch"
  if (doc.name.length < 2) fields.name = "Tên vật liệu cần 2-60 ký tự"
  if (!g.imageOk(doc.image)) fields.image = "Ảnh không hợp lệ"
  if (!Number.isInteger(doc.lowStockThreshold) || doc.lowStockThreshold < 0) fields.lowStockThreshold = "Ngưỡng sắp hết là số nguyên ≥ 0"
  g.assertNoErrors(fields)
  if (!existing && (await materials().findOne({ code: doc.code }))) {
    throw new HttpError(409, "CONFLICT", "Mã vật liệu đã tồn tại", { fields: { code: "Mã vật liệu đã tồn tại" } })
  }
  return doc
}

// Số mẫu gói quà đang dùng từng vật liệu
async function templateUsage() {
  const list = await templates().find({}).project({ name: 1, paper: 1, ribbon: 1, card: 1 }).toArray()
  const map = new Map()
  for (const t of list) for (const slot of Object.keys(SLOTS)) {
    const code = t[slot]?.code
    if (code) map.set(code, [...(map.get(code) || []), t.name])
  }
  return map
}

// Bỏ giá vốn khi người xem không có GOI_QUA.NHAP_KHO (BR-34, BR-36)
const hideCost = (req, m) => {
  if (g.can(req, "GOI_QUA.NHAP_KHO")) return m
  const { avgCost, ...rest } = m
  void avgCost
  return rest
}

async function decorateMaterials(req, list) {
  const [usage, committed] = await Promise.all([templateUsage(), g.committedByCode()])
  return list.map((m) =>
    hideCost(req, {
      ...m,
      unit: m.unit || "cái",
      stock: m.stock || 0,
      committed: committed.get(m.code) || 0,
      stockStatus: g.stockStatus(m),
      templateCount: (usage.get(m.code) || []).length,
    }),
  )
}

// API-127 GET /api/admin/gift-wrap-materials?kind=&stockStatus=&q=
async function listMaterials(req, res) {
  const filter = {}
  if (MATERIAL_KINDS.includes(req.query.kind)) filter.kind = req.query.kind
  const q = g.str(req.query.q, 60)
  if (q) {
    const re = { $regex: accentInsensitivePattern(q), $options: "i" }
    filter.$or = [{ name: re }, { code: re }]
  }
  const list = await decorateMaterials(req, await materials().find(filter).sort({ kind: 1, sortOrder: 1, _id: 1 }).toArray())
  const status = req.query.stockStatus
  res.send(status ? list.filter((m) => m.stockStatus === status) : list)
}

// API-128 POST /api/admin/gift-wrap-materials - tồn ban đầu 0, nhập qua API-175
async function createMaterial(req, res) {
  const doc = await readMaterial(req.body || {})
  if (doc.sortOrder === null) {
    const last = await materials().find({ kind: doc.kind }).sort({ sortOrder: -1 }).limit(1).next()
    doc.sortOrder = (last?.sortOrder || 0) + 1
  }
  const now = new Date()
  Object.assign(doc, { stock: 0, avgCost: 0, createdAt: now, updatedAt: now })
  doc._id = (await materials().insertOne(doc)).insertedId
  await writeLog({ adminId: req.user._id, action: "MATERIAL_UPDATE", targetType: "giftWrapMaterials", targetId: doc._id, after: { code: doc.code, name: doc.name } })
  res.status(201).send((await decorateMaterials(req, [doc]))[0])
}

// API-129 PUT /api/admin/gift-wrap-materials - _id trong body, không đổi code, không sửa tồn (tồn đi qua API-175)
async function updateMaterial(req, res) {
  const existing = await materials().findOne({ _id: g.toId(req.body && req.body._id) })
  if (!existing) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy vật liệu")
  const doc = await readMaterial(req.body, existing)
  if (doc.sortOrder === null) doc.sortOrder = existing.sortOrder
  await materials().updateOne({ _id: existing._id }, { $set: { ...doc, updatedAt: new Date() } })
  // Đổi tên vật liệu thì cập nhật tên chép trong mẫu gói quà
  if (doc.name !== existing.name) {
    for (const slot of Object.keys(SLOTS)) await templates().updateMany({ [`${slot}.code`]: existing.code }, { $set: { [`${slot}.name`]: doc.name } })
  }
  await writeLog({
    adminId: req.user._id, action: "MATERIAL_UPDATE", targetType: "giftWrapMaterials", targetId: existing._id,
    before: { name: existing.name, isActive: existing.isActive, lowStockThreshold: existing.lowStockThreshold },
    after: { name: doc.name, isActive: doc.isActive, lowStockThreshold: doc.lowStockThreshold },
  })
  res.send((await decorateMaterials(req, [await materials().findOne({ _id: existing._id })]))[0])
}

// Lý do không xóa được vật liệu (1eEa), null nếu xóa được
async function materialBlocker(m, usage) {
  const used = usage.get(m.code) || []
  if (used.length) return `Vật liệu đang dùng trong mẫu ${used.join(", ")}`
  if (await movements().findOne({ materialId: m._id, type: "NHAP" }, { projection: { _id: 1 } })) return "Vật liệu đã có lịch sử nhập kho, chỉ ẩn được"
  return null
}

// API-130 DELETE /api/admin/gift-wrap-materials/:id
async function deleteMaterial(req, res) {
  const m = await materials().findOne({ _id: g.toId(req.params["id"]) })
  if (!m) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy vật liệu")
  const reason = await materialBlocker(m, await templateUsage())
  if (reason) throw new HttpError(409, "CONFLICT", reason)
  await materials().deleteOne({ _id: m._id })
  await writeLog({ adminId: req.user._id, action: "MATERIAL_UPDATE", targetType: "giftWrapMaterials", targetId: m._id, before: { code: m.code, name: m.name }, reason: "Xóa vật liệu" })
  res.status(204).send()
}

// API-173 POST /api/admin/gift-wrap-materials/bulk - {ids[], action: SHOW|HIDE|SET_THRESHOLD|DELETE|REORDER, lowStockThreshold?}
async function bulkMaterials(req, res) {
  const { action } = req.body || {}
  if (!["SHOW", "HIDE", "SET_THRESHOLD", "DELETE", "REORDER"].includes(action)) throw new HttpError(400, "VALIDATION_ERROR", "Thao tác không hợp lệ")
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(g.toId).filter(Boolean)
  const now = new Date()
  const updated = []
  const skipped = []
  if (action === "REORDER") {
    for (const [i, id] of ids.entries()) {
      await materials().updateOne({ _id: id }, { $set: { sortOrder: i + 1, updatedAt: now } })
      updated.push(id)
    }
  } else {
    const threshold = Number(req.body.lowStockThreshold)
    if (action === "SET_THRESHOLD" && (!Number.isInteger(threshold) || threshold < 0)) {
      throw new HttpError(422, "VALIDATION_ERROR", "Ngưỡng sắp hết là số nguyên ≥ 0", { fields: { lowStockThreshold: "Ngưỡng sắp hết là số nguyên ≥ 0" } })
    }
    const usage = action === "DELETE" ? await templateUsage() : null
    for (const m of await materials().find({ _id: { $in: ids } }).toArray()) {
      if (action === "DELETE") {
        const reason = await materialBlocker(m, usage)
        if (reason) {
          skipped.push({ id: m._id, name: m.name, reason })
          continue
        }
        await materials().deleteOne({ _id: m._id })
      } else if (action === "SET_THRESHOLD") {
        await materials().updateOne({ _id: m._id }, { $set: { lowStockThreshold: threshold, updatedAt: now } })
      } else {
        await materials().updateOne({ _id: m._id }, { $set: { isActive: action === "SHOW", updatedAt: now } })
      }
      updated.push(m._id)
    }
  }
  await writeLog({ adminId: req.user._id, action: "BULK_ACTION", targetType: "giftWrapMaterials", reason: action, after: { updated, skipped } })
  res.send({ updated: updated.length, skipped })
}

// ===== Nhập xuất kho vật liệu =====

// API-174 GET /api/admin/stock-movements?materialId=&type=&from=&to=&page= - mới nhất trước.
// Có materialId thì kèm summary (số đơn dùng 30 ngày gần nhất) cho ngăn chi tiết vật liệu.
async function listMovements(req, res) {
  const filter = {}
  const materialId = g.toId(req.query.materialId)
  if (materialId) filter.materialId = materialId
  if (MOVEMENT_TYPES.includes(req.query.type)) filter.type = req.query.type
  const from = g.dateOrNull(req.query.from)
  const to = g.dateOrNull(req.query.to)
  if (from || to) filter.createdAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) }
  const page = Math.max(1, parseInt(req.query.page) || 1)
  const pageSize = 20
  const [items, total, used30] = await Promise.all([
    movements().find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).toArray(),
    movements().countDocuments(filter),
    materialId ? movements().countDocuments({ materialId, type: "XUAT_DON", createdAt: { $gte: new Date(Date.now() - 30 * DAY) } }) : null,
  ])
  const showCost = g.can(req, "GOI_QUA.NHAP_KHO")
  res.send({
    items: items.map((x) => (showCost ? x : { ...x, unitCost: undefined })),
    page,
    pageSize,
    total,
    ...(materialId ? { summary: { ordersLast30Days: used30 } } : {}),
  })
}

// API-175 POST /api/admin/stock-movements
// Phiếu nhập {type: NHAP, supplier, receivedAt?, note?, lines: [{materialId, quantity > 0, unitCost ≥ 0}]}: cấp mã PN chung
// Nhập kho: cộng tồn, tính giá vốn bình quân gia quyền (AC7). Điều chỉnh {type: DIEU_CHINH, reason, note?, lines: [{materialId, quantity}]}:
// tồn sau điều chỉnh không âm (1eEb).
async function createMovement(req, res) {
  const body = req.body || {}
  const type = body.type
  if (!["NHAP", "DIEU_CHINH"].includes(type)) throw new HttpError(400, "VALIDATION_ERROR", "Loại phiếu không hợp lệ")
  const fields = {}
  const supplier = g.str(body.supplier, 100)
  const note = g.str(body.note, 200)
  const reason = g.str(body.reason, 20)
  const receivedAt = g.dateOrNull(body.receivedAt) || new Date()
  if (type === "NHAP" && !supplier) fields.supplier = "Nhập tên nhà cung cấp"
  if (type === "DIEU_CHINH" && !ADJUST_REASONS.includes(reason)) fields.reason = "Chọn lý do điều chỉnh"
  if (type === "DIEU_CHINH" && reason === "KHAC" && !note) fields.note = "Ghi rõ lý do điều chỉnh"

  const raw = Array.isArray(body.lines) ? body.lines : []
  if (!raw.length) fields.lines = "Chọn ít nhất 1 vật liệu"
  const lines = raw.map((l) => ({ materialId: g.toId(l && l.materialId), quantity: Number(l && l.quantity), unitCost: Number(l && l.unitCost) }))
  lines.forEach((l, i) => {
    if (!l.materialId) fields[`lines.${i}.materialId`] = "Vật liệu không hợp lệ"
    if (!Number.isInteger(l.quantity) || (type === "NHAP" ? l.quantity <= 0 : l.quantity === 0)) {
      fields[`lines.${i}.quantity`] = type === "NHAP" ? "Số lượng nhập phải lớn hơn 0" : "Số lượng điều chỉnh khác 0"
    }
    if (type === "NHAP" && (!Number.isInteger(l.unitCost) || l.unitCost < 0)) fields[`lines.${i}.unitCost`] = "Giá vốn là số nguyên ≥ 0"
  })
  if (new Set(lines.map((l) => String(l.materialId))).size !== lines.length) fields.lines = "Mỗi vật liệu chỉ một dòng trong phiếu"
  g.assertNoErrors(fields)

  const docs = await materials().find({ _id: { $in: lines.map((l) => l.materialId) } }).toArray()
  const byId = new Map(docs.map((m) => [String(m._id), m]))
  for (const [i, l] of lines.entries()) {
    const m = byId.get(String(l.materialId))
    if (!m) fields[`lines.${i}.materialId`] = "Vật liệu không tồn tại"
    else if (type === "DIEU_CHINH" && (m.stock || 0) + l.quantity < 0) fields[`lines.${i}.quantity`] = `Tồn sau điều chỉnh không được âm (đang có ${m.stock || 0})`
  }
  if (Object.keys(fields).length) throw new HttpError(422, "BUSINESS_RULE", Object.values(fields)[0], { fields, rule: "BR-36" })

  const receiptCode = type === "NHAP" ? `PN-${String(await g.nextSequence("stock-receipt")).padStart(4, "0")}` : null
  const now = new Date()
  const applied = []
  const created = []
  try {
    for (const l of lines) {
      let after
      if (type === "NHAP") {
        // Bình quân gia quyền: (tồn × giá vốn cũ + số nhập × giá nhập) / (tồn + số nhập), làm tròn đồng
        after = await materials().findOneAndUpdate(
          { _id: l.materialId },
          [
            {
              $set: {
                avgCost: {
                  $round: [{ $divide: [{ $add: [{ $multiply: [{ $max: ["$stock", 0] }, { $ifNull: ["$avgCost", 0] }] }, l.quantity * l.unitCost] }, { $add: [{ $max: ["$stock", 0] }, l.quantity] }] }, 0],
                },
                stock: { $add: [{ $ifNull: ["$stock", 0] }, l.quantity] },
                updatedAt: now,
              },
            },
          ],
          { returnDocument: "after" },
        )
      } else {
        // Trừ có điều kiện để tồn không âm kể cả khi 2 người điều chỉnh cùng lúc
        after = await materials().findOneAndUpdate(
          { _id: l.materialId, ...(l.quantity < 0 ? { stock: { $gte: -l.quantity } } : {}) },
          { $inc: { stock: l.quantity }, $set: { updatedAt: now } },
          { returnDocument: "after" },
        )
        if (!after) throw new HttpError(422, "BUSINESS_RULE", "Tồn sau điều chỉnh không được âm", { rule: "BR-36" })
      }
      applied.push(l)
      created.push({
        materialId: after._id,
        materialCode: after.code,
        type,
        quantity: l.quantity,
        unitCost: type === "NHAP" ? l.unitCost : null,
        supplier: type === "NHAP" ? supplier : null,
        receiptCode,
        receivedAt: type === "NHAP" ? receivedAt : null,
        note: note || null,
        reason: type === "DIEU_CHINH" ? reason : null,
        orderCode: null,
        stockAfter: after.stock,
        by: req.user._id,
        createdAt: now,
      })
    }
  } catch (err) {
    // Hoàn lại các dòng đã cộng/trừ để phiếu không áp dụng nửa chừng
    for (const l of applied) await materials().updateOne({ _id: l.materialId }, { $inc: { stock: -l.quantity } })
    throw err
  }
  await movements().insertMany(created)
  await writeLog({ adminId: req.user._id, action: type === "NHAP" ? "STOCK_RECEIPT" : "STOCK_ADJUST", targetType: "giftWrapMaterials", reason: receiptCode || reason, after: { lines: created.map((c) => ({ code: c.materialCode, quantity: c.quantity, stockAfter: c.stockAfter })) } })
  res.status(201).send({ receiptCode, movements: created })
}

module.exports = {
  listTemplates, createTemplate, updateTemplate, deleteTemplate, bulkTemplates,
  listMaterials, createMaterial, updateMaterial, deleteMaterial, bulkMaterials,
  listMovements, createMovement,
}
