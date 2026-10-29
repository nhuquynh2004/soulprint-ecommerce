// Thư viện sticker (07_API_Spec.md Mục 2.15 - UC-CAT-06): API-119 GET, API-120 POST, API-121 PUT (_id trong body),
// API-122 DELETE, API-171 thao tác hàng loạt (ẩn/hiện bộ hoặc sticker lẻ, lên lịch, xóa, đổi thứ tự).
const { database } = require("../config/db")
const HttpError = require("../utils/httpError")
const { writeLog } = require("../services/adminLog")
const { accentInsensitivePattern } = require("../utils/vnText")
const g = require("../services/giftAdmin")

const sets = () => database.collection("stickerSets")

// Số sản phẩm đang hiển thị, cho phép Thiết kế, nằm trong phạm vi của bộ ("Áp dụng: 18 sản phẩm")
async function scopeCounter() {
  const list = await database
    .collection("products")
    .find({ status: "DANG_HIEN_THI", "personalization.allowed": true, "personalization.types": "THIET_KE" })
    .project({ categoryId: 1, axis: 1 })
    .toArray()
  return (s) =>
    list.filter((p) => {
      const cats = s.categoryIds || []
      const axes = s.axes || []
      if (!cats.length && !axes.length) return true
      return cats.some((c) => p.categoryId && c.equals(p.categoryId)) || axes.includes(p.axis)
    }).length
}

const sortSets = (a, b) => (a.kind === "BST_MUA" ? 0 : 1) - (b.kind === "BST_MUA" ? 0 : 1) || (a.sortOrder || 0) - (b.sortOrder || 0)

// Đọc form bộ sticker (UC-CAT-06 bước 3, 5Ea, 5Eb); existing là bộ đang sửa
async function normalize(body, existing = null) {
  const fields = {}
  const pick = (k, d) => (body[k] !== undefined ? body[k] : existing && existing[k] !== undefined ? existing[k] : d)
  const doc = {
    name: g.str(pick("name", ""), 60),
    ...(await g.readSeason(body, existing, fields)),
    categoryIds: (Array.isArray(pick("categoryIds", [])) ? pick("categoryIds", []) : []).map(g.toId).filter(Boolean),
    axes: (Array.isArray(pick("axes", [])) ? pick("axes", []) : []).filter((a) => g.AXES.includes(a)),
    sortOrder: Number.isInteger(Number(pick("sortOrder", null))) && pick("sortOrder", null) !== null ? Number(pick("sortOrder")) : null,
    isActive: pick("isActive", true) !== false,
  }
  if (doc.name.length < 2) fields.name = "Tên bộ sticker cần 2-60 ký tự"
  if (doc.categoryIds.length) {
    const found = await database.collection("categories").countDocuments({ _id: { $in: doc.categoryIds } })
    if (found !== doc.categoryIds.length) fields.categoryIds = "Danh mục không tồn tại"
  }

  const input = Array.isArray(pick("stickers", [])) ? pick("stickers", []) : []
  if (!input.length) fields.stickers = "Bộ sticker cần ít nhất 1 sticker"
  const stickers = input.map((x, i) => ({
    code: g.str(x && x.code, 20).toUpperCase(),
    name: g.str(x && x.name, 40),
    image: g.str(x && x.image, 300),
    isActive: !x || x.isActive !== false,
    sortOrder: Number.isInteger(Number(x && x.sortOrder)) ? Number(x.sortOrder) : i + 1,
  }))
  stickers.forEach((x, i) => {
    if (!x.name) fields[`stickers.${i}.name`] = "Nhập tên sticker"
    if (!x.image || !g.imageOk(x.image)) fields[`stickers.${i}.image`] = "Tải ảnh PNG nền trong cho sticker"
    if (x.code && !/^[A-Z0-9-]{2,20}$/.test(x.code)) fields[`stickers.${i}.code`] = "Mã chỉ gồm chữ in hoa, số, dấu gạch"
  })
  g.assertNoErrors(fields)

  // Mã sticker duy nhất toàn hệ thống (06 Mục 2.10): kiểm tra trong form và với các bộ khác, sinh mã cho sticker chưa có
  const others = await sets()
    .find(existing ? { _id: { $ne: existing._id } } : {})
    .project({ "stickers.code": 1 })
    .toArray()
  const taken = new Set(others.flatMap((s) => (s.stickers || []).map((x) => x.code)))
  const seen = new Set()
  // Lỗi gắn vào đúng ô mã (stickers.<i>.code) để form hiện ngay dưới ô nhập
  const DUP = "Mã sticker đã tồn tại. Vui lòng sử dụng mã khác."
  const dupFields = {}
  stickers.forEach((x, i) => {
    if (!x.code) return
    if (taken.has(x.code) || seen.has(x.code)) dupFields[`stickers.${i}.code`] = DUP
    seen.add(x.code)
  })
  if (Object.keys(dupFields).length) throw new HttpError(409, "CONFLICT", DUP, { fields: dupFields })
  const prefix = `STK-${g.initials(doc.name)}`
  for (const x of stickers.filter((s) => !s.code)) {
    x.code = g.nextCode(prefix, new Set([...taken, ...seen]))
    seen.add(x.code)
  }
  doc.stickers = stickers.sort((a, b) => a.sortOrder - b.sortOrder).map((x, i) => ({ ...x, sortOrder: i + 1 }))
  return doc
}

// API-119 GET /api/admin/sticker-sets?kind=&status=&q=
async function listSets(req, res) {
  const filter = {}
  if (g.KINDS.includes(req.query.kind)) filter.kind = req.query.kind
  const q = g.str(req.query.q, 60)
  if (q) {
    const re = { $regex: accentInsensitivePattern(q), $options: "i" }
    filter.$or = [{ name: re }, { seasonLabel: re }, { "stickers.name": re }, { "stickers.code": re }]
  }
  const now = new Date()
  const [list, countScope] = await Promise.all([sets().find(filter).toArray(), scopeCounter()])
  const all = list.sort(sortSets).map((s) => ({ ...s, displayStatus: g.displayStatus(s, now), productCount: countScope(s) }))
  const status = req.query.status
  res.send(status ? all.filter((s) => s.displayStatus === status) : all)
}

// API-120 POST /api/admin/sticker-sets
async function createSet(req, res) {
  const doc = await normalize(req.body || {})
  if (doc.sortOrder === null) {
    const last = await sets().find({}).sort({ sortOrder: -1 }).limit(1).next()
    doc.sortOrder = (last?.sortOrder || 0) + 1
  }
  const now = new Date()
  Object.assign(doc, { createdBy: req.user._id, updatedBy: req.user._id, createdAt: now, updatedAt: now })
  doc._id = (await sets().insertOne(doc)).insertedId
  await writeLog({ adminId: req.user._id, action: "STICKER_SET_UPDATE", targetType: "stickerSets", targetId: doc._id, after: { name: doc.name, stickers: doc.stickers.length } })
  res.status(201).send({ ...doc, displayStatus: g.displayStatus(doc) })
}

// API-121 PUT /api/admin/sticker-sets - _id trong body, sửa một phần
async function updateSet(req, res) {
  const existing = await sets().findOne({ _id: g.toId(req.body && req.body._id) })
  if (!existing) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy bộ sticker")
  const doc = await normalize(req.body, existing)
  if (doc.sortOrder === null) doc.sortOrder = existing.sortOrder
  await sets().updateOne({ _id: existing._id }, { $set: { ...doc, updatedBy: req.user._id, updatedAt: new Date() } })
  await writeLog({
    adminId: req.user._id, action: "STICKER_SET_UPDATE", targetType: "stickerSets", targetId: existing._id,
    before: { name: existing.name, isActive: existing.isActive, stickers: (existing.stickers || []).length },
    after: { name: doc.name, isActive: doc.isActive, stickers: doc.stickers.length },
  })
  const fresh = await sets().findOne({ _id: existing._id })
  res.send({ ...fresh, displayStatus: g.displayStatus(fresh) })
}

// API-122 DELETE /api/admin/sticker-sets/:id - đơn đã đặt giữ bản chụp sticker (AC5)
async function deleteSet(req, res) {
  const s = await sets().findOne({ _id: g.toId(req.params["id"]) })
  if (!s) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy bộ sticker")
  await sets().deleteOne({ _id: s._id })
  await writeLog({ adminId: req.user._id, action: "STICKER_SET_UPDATE", targetType: "stickerSets", targetId: s._id, before: { name: s.name }, reason: "Xóa bộ sticker" })
  res.status(204).send()
}

// API-171 POST /api/admin/sticker-sets/bulk - {setIds[], stickerCodes[], action, startAt?, endAt?}; REORDER {setId, codes[]} hoặc {setIds[]}
async function bulkSets(req, res) {
  const { action } = req.body || {}
  const need = { SHOW: "GOI_QUA.SUA", HIDE: "GOI_QUA.SUA", SCHEDULE: "GOI_QUA.SUA", REORDER: "GOI_QUA.SUA", DELETE: "GOI_QUA.XOA" }[action]
  if (!need) throw new HttpError(400, "VALIDATION_ERROR", "Thao tác không hợp lệ")
  g.assertCan(req, need)
  const setIds = (Array.isArray(req.body.setIds) ? req.body.setIds : []).map(g.toId).filter(Boolean)
  const codes = new Set((Array.isArray(req.body.stickerCodes) ? req.body.stickerCodes : []).filter((c) => typeof c === "string"))
  const now = new Date()
  const updated = []
  const skipped = []

  if (action === "REORDER") {
    const setId = g.toId(req.body.setId)
    if (setId) {
      // Đổi thứ tự sticker trong 1 bộ (UC-CAT-06 1c)
      const s = await sets().findOne({ _id: setId })
      if (!s) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy bộ sticker")
      const order = (Array.isArray(req.body.codes) ? req.body.codes : []).filter((c) => typeof c === "string")
      const rank = (c) => (order.indexOf(c) < 0 ? order.length : order.indexOf(c))
      const stickers = [...(s.stickers || [])].sort((a, b) => rank(a.code) - rank(b.code) || a.sortOrder - b.sortOrder).map((x, i) => ({ ...x, sortOrder: i + 1 }))
      await sets().updateOne({ _id: setId }, { $set: { stickers, updatedBy: req.user._id, updatedAt: now } })
      updated.push(setId)
    } else {
      // Đổi thứ tự các bộ (bộ BST/mùa vẫn luôn xếp trên khi hiển thị)
      for (const [i, id] of setIds.entries()) {
        await sets().updateOne({ _id: id }, { $set: { sortOrder: i + 1, updatedAt: now } })
        updated.push(id)
      }
    }
  } else {
    const docs = await sets().find({ $or: [{ _id: { $in: setIds } }, { "stickers.code": { $in: [...codes] } }] }).toArray()
    const chosenSet = new Set(setIds.map(String))
    for (const s of docs) {
      const whole = chosenSet.has(String(s._id))
      if (action === "SCHEDULE") {
        if (!whole) continue
        const startAt = g.dateOrNull(req.body.startAt)
        const endAt = g.dateOrNull(req.body.endAt)
        if (s.kind !== "BST_MUA") {
          skipped.push({ id: s._id, name: s.name, reason: "Bộ thường không có thời gian hiển thị" })
          continue
        }
        if (!startAt || !endAt || endAt <= startAt) throw new HttpError(422, "VALIDATION_ERROR", "Ngày kết thúc phải sau ngày bắt đầu", { fields: { endAt: "Ngày kết thúc phải sau ngày bắt đầu" } })
        await sets().updateOne({ _id: s._id }, { $set: { startAt, endAt, updatedAt: now } })
        updated.push(s._id)
      } else if (action === "SHOW" || action === "HIDE") {
        const on = action === "SHOW"
        if (whole) {
          // Ẩn cả nhóm thì mọi sticker trong nhóm không còn hiện ở SCR-04 (AC9)
          await sets().updateOne({ _id: s._id }, { $set: { isActive: on, updatedAt: now } })
        } else {
          const stickers = s.stickers.map((x) => (codes.has(x.code) ? { ...x, isActive: on } : x))
          await sets().updateOne({ _id: s._id }, { $set: { stickers, updatedAt: now } })
        }
        updated.push(s._id)
      } else if (action === "DELETE") {
        if (whole) {
          await sets().deleteOne({ _id: s._id })
          updated.push(s._id)
          continue
        }
        const stickers = s.stickers.filter((x) => !codes.has(x.code))
        if (!stickers.length) {
          skipped.push({ id: s._id, name: s.name, reason: "Bộ sticker cần ít nhất 1 sticker, hãy xóa cả bộ" })
          continue
        }
        await sets().updateOne({ _id: s._id }, { $set: { stickers, updatedAt: now } })
        updated.push(s._id)
      }
    }
  }
  await writeLog({ adminId: req.user._id, action: "BULK_ACTION", targetType: "stickerSets", reason: action, after: { updated, skipped, stickerCodes: [...codes] } })
  res.send({ updated: updated.length, skipped })
}

module.exports = { listSets, createSet, updateSet, deleteSet, bulkSets }
