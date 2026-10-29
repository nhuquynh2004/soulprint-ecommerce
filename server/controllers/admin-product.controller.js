// Quản trị sản phẩm (07_API_Spec.md Mục 2.13): đủ 5 lệnh REST theo slide Chương VI
// API-65 GET danh sách, API-66 GET một, API-67 POST, API-68 PUT (_id trong body), API-69 DELETE;
// API-161 thao tác hàng loạt, API-162 xuất CSV, API-163 nhân bản, API-214 gợi ý SKU. UC-CAT-01, BR-34, BR-39, BR-41, BR-46.
const { database, ObjectId } = require("../config/db")
const HttpError = require("../utils/httpError")
const { accentInsensitivePattern, VI_COLLATION } = require("../utils/vnText")
const { writeLog } = require("../services/adminLog")
const pa = require("../services/productAdmin")

const products = () => database.collection("products")
const PAGE_SIZE = 20
const can = (req, code) => req.isFullAccess || req.permissions.has(code)
const toId = (v) => (v && ObjectId.isValid(String(v)) ? new ObjectId(String(v)) : null)

// Lỗi kiểm tra dữ liệu -> 422 kèm từng trường và số vùng của form (client nhảy tới vùng lỗi)
function productError(err) {
  if (!(err instanceof pa.ProductError)) return err
  return new HttpError(422, "VALIDATION_ERROR", err.message, { fields: err.fields, missing: pa.withAreas(err.fields) })
}

// Sản phẩm trong CSDL -> dạng đầu vào của normalizeProduct (ObjectId, Date thành chuỗi)
function asInput(p) {
  return {
    ...p,
    categoryId: p.categoryId ? String(p.categoryId) : null,
    tagIds: (p.tagIds || []).map(String),
    saleStartAt: p.saleStartAt ? new Date(p.saleStartAt).toISOString() : null,
    saleEndAt: p.saleEndAt ? new Date(p.saleEndAt).toISOString() : null,
  }
}

// Trả cho client: bỏ giá vốn nếu không có quyền SUA_GIA (BR-34, NFR-SEC-15)
function out(req, p) {
  const { costPrice, ...rest } = p
  return { ...rest, ...(can(req, "SAN_PHAM.SUA_GIA") ? { costPrice: costPrice ?? null } : {}), ...pa.stockInfo(p.variants) }
}

// Vừa bật "Sản phẩm nổi bật" ở form (chưa nổi bật trước đó): đứng đầu khối Sản phẩm nổi bật, thứ tự = nhỏ nhất - 1.
// Trước đây thứ tự để trống nên vị trí phụ thuộc cách MongoDB xếp giá trị null, trình chỉnh sửa trang chủ không thấy rõ.
async function placeFeatured(doc, wasFeatured) {
  if (!doc.isFeatured) {
    doc.featuredOrder = null
    return
  }
  if (wasFeatured && doc.featuredOrder !== null) return
  const first = await products().find({ isFeatured: true, featuredOrder: { $type: "number" } }).sort({ featuredOrder: 1 }).limit(1).next()
  doc.featuredOrder = first ? first.featuredOrder - 1 : 1
}

// Kiểm tra trùng SKU, đường dẫn, SKU biến thể với sản phẩm khác -> 409 theo trường
async function assertUnique(doc, exceptId = null) {
  const not = exceptId ? { _id: { $ne: exceptId } } : {}
  const fields = {}
  if (doc.sku && (await products().findOne({ ...not, sku: doc.sku }))) fields.sku = "Mã sản phẩm đã tồn tại. Vui lòng sử dụng mã khác."
  if (doc.slug && (await products().findOne({ ...not, slug: doc.slug }))) fields.slug = "Đường dẫn đã tồn tại"
  const skus = doc.variants.map((v) => v.sku).filter(Boolean)
  if (skus.length) {
    const other = await products().findOne({ ...not, "variants.sku": { $in: skus } }, { projection: { "variants.sku": 1, name: 1 } })
    if (other) {
      const taken = other.variants.map((v) => v.sku).find((s) => skus.includes(s))
      fields.variants = `SKU biến thể "${taken}" đã dùng ở sản phẩm "${other.name}"`
    }
  }
  if (Object.keys(fields).length) throw new HttpError(409, "CONFLICT", Object.values(fields)[0], { fields, missing: pa.withAreas(fields) })
}

// Đổi tham chiếu sang ObjectId và kiểm tra tồn tại (danh mục, tag nhóm danh sách)
async function resolveRefs(doc) {
  const fields = {}
  if (doc.categoryId) {
    const cat = await database.collection("categories").findOne({ _id: toId(doc.categoryId) })
    if (!cat) fields.categoryId = "Danh mục không tồn tại"
    doc.categoryId = cat ? cat._id : null
  }
  const ids = doc.tagIds.map(toId).filter(Boolean)
  const rangeGroups = (await database.collection("tagGroups").find({ kind: "RANGE" }).toArray()).map((g) => g.code)
  const tags = ids.length ? await database.collection("tags").find({ _id: { $in: ids }, group: { $nin: rangeGroups } }).toArray() : []
  doc.tagIds = tags.map((t) => t._id) // tag nhóm khoảng không gắn tay
  if (Object.keys(fields).length) throw new HttpError(422, "VALIDATION_ERROR", Object.values(fields)[0], { fields, missing: pa.withAreas(fields) })
}

// Cảnh báo không chặn: bật Thiết kế khi chưa có bộ sticker áp dụng (UC-CAT-01 5Ec)
async function stickerWarning(doc) {
  if (!doc.personalization.types.includes("THIET_KE")) return []
  const sets = await database.collection("stickerSets").find({ isActive: true }).toArray()
  const ok = sets.some((s) => (!s.categoryIds?.length && !s.axes?.length) || s.categoryIds?.some((c) => doc.categoryId && c.equals(doc.categoryId)) || s.axes?.includes(doc.axis))
  return ok ? [] : ["Chưa có sticker cho sản phẩm này, khách chỉ thêm được lời nhắn"]
}

// API-65 GET /api/admin/products?q=&category=&axis=&status=&stockStatus=&tag=&sort=&page=
async function listProducts(req, res) {
  const and = []
  const q = String(req.query.q || "").trim()
  if (q) {
    const re = { $regex: accentInsensitivePattern(q), $options: "i" }
    // SKU khớp một phần, không phân biệt hoa thường, bỏ qua dấu gạch/khoảng trắng: "gmkgc007", "GM KGC 007" ra GM-KGC-007
    const chars = q.replace(/[^A-Za-z0-9]/g, "")
    const skuRe = chars.length >= 2 ? { $regex: chars.split("").join("[-\\s._]*"), $options: "i" } : re
    and.push({ $or: [{ name: re }, { sku: re }, { "variants.sku": re }, { sku: skuRe }, { "variants.sku": skuRe }] })
  }
  if (toId(req.query.category)) and.push({ categoryId: toId(req.query.category) })
  if (["THE_THAO", "ANIME", "GAME"].includes(req.query.axis)) and.push({ axis: req.query.axis })
  if (toId(req.query.tag)) and.push({ tagIds: toId(req.query.tag) })
  const base = and.length ? { $and: and } : {}
  const status = pa.STATUSES.includes(req.query.status) ? req.query.status : null
  const stockStatus = ["CON_HANG", "SAP_HET", "HET_HANG"].includes(req.query.stockStatus) ? req.query.stockStatus : null
  const page = Math.max(1, parseInt(req.query.page) || 1)
  const sortKey = String(req.query.sort || "")
  const dir = sortKey.startsWith("-") ? -1 : 1
  const sort = { ten: { name: dir }, gia: { price: dir }, ton: { totalStock: dir } }[sortKey.replace(/^-/, "")] || { updatedAt: -1 }

  const active = { $filter: { input: "$variants", as: "v", cond: { $ne: ["$$v.isActive", false] } } }
  const [result] = await products()
    .aggregate([
      { $match: base },
      {
        $addFields: {
          totalStock: { $sum: { $map: { input: active, as: "v", in: "$$v.stock" } } },
          anyLow: { $anyElementTrue: [{ $map: { input: active, as: "v", in: { $lte: ["$$v.stock", { $ifNull: ["$$v.lowStockThreshold", 5] }] } } }] },
        },
      },
      { $addFields: { stockStatus: { $cond: [{ $eq: ["$totalStock", 0] }, "HET_HANG", { $cond: ["$anyLow", "SAP_HET", "CON_HANG"] }] } } },
      {
        $facet: {
          counts: [{ $group: { _id: "$status", n: { $sum: 1 } } }],
          stock: [{ $group: { _id: "$stockStatus", n: { $sum: 1 } } }],
          items: [
            { $match: { ...(status ? { status } : {}), ...(stockStatus ? { stockStatus } : {}) } },
            { $sort: { ...sort, _id: 1 } },
            { $skip: (page - 1) * PAGE_SIZE },
            { $limit: PAGE_SIZE },
            { $lookup: { from: "categories", localField: "categoryId", foreignField: "_id", as: "category" } },
            {
              $project: {
                name: 1, sku: 1, slug: 1, images: { $slice: ["$images", 1] }, price: 1, salePrice: 1, status: 1, axis: 1, totalStock: 1, stockStatus: 1,
                hasOrders: 1, isFeatured: 1, updatedAt: 1, category: { $arrayElemAt: ["$category.name", 0] },
                variants: { $map: { input: "$variants", as: "v", in: { sku: "$$v.sku", name: "$$v.name", stock: "$$v.stock", isActive: "$$v.isActive", lowStockThreshold: "$$v.lowStockThreshold" } } },
              },
            },
          ],
          total: [{ $match: { ...(status ? { status } : {}), ...(stockStatus ? { stockStatus } : {}) } }, { $count: "n" }],
        },
      },
    ], { collation: VI_COLLATION })
    .toArray()
  const counts = Object.fromEntries(result.counts.map((c) => [c._id, c.n]))
  res.send({
    items: result.items.map((p) => ({ ...p, image: (p.images || [])[0] || null })),
    page,
    pageSize: PAGE_SIZE,
    total: result.total[0]?.n || 0,
    counts: { ALL: result.counts.reduce((n, c) => n + c.n, 0), ...counts },
    stockCounts: Object.fromEntries(result.stock.map((c) => [c._id, c.n])),
  })
}

// API-66 GET /api/admin/products/:id
async function getProduct(req, res) {
  const p = await products().findOne({ _id: toId(req.params["id"]) })
  if (!p) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy sản phẩm")
  res.send(out(req, p))
}

// API-67 POST /api/admin/products - bản nháp chỉ cần tên; xuất bản cần đủ trường (UC-CAT-01 bước 5, 7)
async function createProduct(req, res) {
  if (!can(req, "SAN_PHAM.SUA_GIA") && pa.PRICE_FIELDS.some((f) => f !== "price" && req.body[f] != null && req.body[f] !== "")) {
    throw new HttpError(403, "FORBIDDEN", "Bạn không có quyền đặt giá sale, giá vốn", { fields: { costPrice: "Cần quyền Sửa giá" } })
  }
  let result
  try {
    result = pa.normalizeProduct(req.body)
  } catch (err) {
    throw productError(err)
  }
  const { doc } = result
  await resolveRefs(doc)
  await assertUnique(doc)
  await placeFeatured(doc, false)
  const now = new Date()
  Object.assign(doc, { soldCount: 0, viewCount: 0, ratingAvg: 0, ratingCount: 0, hasOrders: false, createdBy: req.user._id, updatedBy: req.user._id, createdAt: now, updatedAt: now })
  doc._id = (await products().insertOne(doc)).insertedId
  await writeLog({ adminId: req.user._id, action: "PRODUCT_UPDATE", targetType: "products", targetId: doc._id, after: { name: doc.name, status: doc.status } })
  res.status(201).send({ product: out(req, doc), warnings: [...result.warnings, ...(await stickerWarning(doc))] })
}

// Biến thể của các giá trị bị bỏ: đã có đơn thì ẩn giá trị và ngừng bán biến thể, chưa có đơn thì xóa (BR-39, AC13)
async function keepValuesWithOrders(existing, body) {
  const warnings = []
  const groups = Array.isArray(body.optionGroups) ? body.optionGroups.map((g) => ({ ...g, values: [...(g.values || [])] })) : null
  if (!groups) return { body, warnings }
  const variants = Array.isArray(body.variants) ? [...body.variants] : [...(existing.variants || [])]
  for (const og of existing.optionGroups || []) {
    const g = groups.find((x) => x.name === og.name)
    if (!g) continue
    for (const ov of og.values) {
      if (g.values.some((v) => v.value === ov.value)) continue
      const skus = (existing.variants || []).filter((v) => v.attributes?.[og.name] === ov.value).map((v) => v.sku)
      const used = skus.length && (await database.collection("orders").findOne({ "items.variantSku": { $in: skus } }, { projection: { _id: 1 } }))
      if (used) {
        g.values.push({ ...ov, isHidden: true })
        for (const v of existing.variants) if (v.attributes?.[og.name] === ov.value && !variants.some((x) => x.sku === v.sku)) variants.push(v)
        warnings.push(`Giá trị ${ov.value} đã có đơn hàng nên được ẩn và các biến thể chuyển Ngừng bán, không xóa`)
      }
    }
  }
  return { body: { ...body, optionGroups: groups, variants }, warnings }
}

// API-68 PUT /api/admin/products - _id trong body. Trường không gửi thì giữ nguyên.
// Quyền theo trường (07 Mục 1.1): nội dung cần SUA, giá cần SUA_GIA, tồn kho cần CAP_NHAT_TON.
async function updateProduct(req, res) {
  const existing = await products().findOne({ _id: toId(req.body._id) })
  if (!existing) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy sản phẩm")
  const body = { ...req.body }
  delete body._id
  if (!can(req, "SAN_PHAM.SUA_GIA")) delete body.costPrice // người không thấy giá vốn thì giữ giá cũ

  const kept = await keepValuesWithOrders(existing, body)
  let before, after
  try {
    before = pa.normalizeProduct({ ...asInput(existing), status: "BAN_NHAP" }).doc
    after = pa.normalizeProduct({ ...asInput(existing), ...kept.body }, new Date(), { requireStock: existing.status !== "DANG_HIEN_THI" })
  } catch (err) {
    throw productError(err)
  }
  const need = pa.requiredPermissions({ ...before, status: existing.status }, after.doc)
  const missing = [...need].filter((c) => !can(req, c))
  if (missing.length) {
    throw new HttpError(403, "FORBIDDEN", "Bạn không có quyền sửa một số trường", { fields: Object.fromEntries(missing.map((c) => [c, "Cần quyền " + c])) })
  }
  const doc = after.doc
  await resolveRefs(doc)
  await assertUnique(doc, existing._id)
  await placeFeatured(doc, !!existing.isFeatured)

  const warnings = [...kept.warnings, ...after.warnings, ...(await stickerWarning(doc))]
  if (doc.status === "NGUNG_BAN" && existing.status !== "NGUNG_BAN") {
    const open = await database.collection("orders").findOne({ "items.productId": existing._id, orderStatus: { $nin: ["HOAN_THANH", "DA_HUY"] } })
    if (open) warnings.push("Sản phẩm đang có đơn chưa xong, đơn vẫn được xử lý bình thường")
  }
  await products().updateOne({ _id: existing._id }, { $set: { ...doc, updatedBy: req.user._id, updatedAt: new Date() } })
  const fresh = await products().findOne({ _id: existing._id })
  await writeLog({
    adminId: req.user._id, action: need.has("SAN_PHAM.SUA") || need.has("SAN_PHAM.SUA_GIA") ? "PRODUCT_UPDATE" : "STOCK_UPDATE", targetType: "products", targetId: existing._id,
    before: { status: existing.status, price: existing.price, stock: pa.stockInfo(existing.variants).totalStock },
    after: { status: fresh.status, price: fresh.price, stock: pa.stockInfo(fresh.variants).totalStock },
  })
  res.send({ product: out(req, fresh), warnings })
}

// API-69 DELETE /api/admin/products/:id - chỉ sản phẩm chưa có đơn (AC3)
async function deleteProduct(req, res) {
  const p = await products().findOne({ _id: toId(req.params["id"]) })
  if (!p) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy sản phẩm")
  if (p.hasOrders) throw new HttpError(409, "CONFLICT", "Sản phẩm đã có đơn hàng, chỉ lưu trữ được")
  await products().deleteOne({ _id: p._id })
  await writeLog({ adminId: req.user._id, action: "PRODUCT_UPDATE", targetType: "products", targetId: p._id, before: { name: p.name, sku: p.sku }, reason: "Xóa sản phẩm" })
  res.status(204).send()
}

// API-163 POST /api/admin/products/:id/duplicate - bản nháp, tồn 0, SKU và đường dẫn để trống (nhánh 1g)
async function duplicateProduct(req, res) {
  const p = await products().findOne({ _id: toId(req.params["id"]) })
  if (!p) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy sản phẩm")
  const now = new Date()
  const { _id, ...copy } = p
  void _id
  Object.assign(copy, {
    name: `${p.name} (bản sao)`.slice(0, 120), sku: null, slug: null, status: "BAN_NHAP", isFeatured: false,
    variants: p.variants.map((v) => ({ ...v, sku: null, stock: 0 })),
    soldCount: 0, viewCount: 0, ratingAvg: 0, ratingCount: 0, hasOrders: false, createdBy: req.user._id, updatedBy: req.user._id, createdAt: now, updatedAt: now,
  })
  copy._id = (await products().insertOne(copy)).insertedId
  await writeLog({ adminId: req.user._id, action: "PRODUCT_UPDATE", targetType: "products", targetId: copy._id, reason: `Nhân bản từ ${p.sku || p.name}` })
  res.status(201).send({ product: out(req, copy), warnings: [] })
}

// API-161 POST /api/admin/products/bulk - xử lý từng sản phẩm, mục không đủ điều kiện bỏ qua kèm lý do (nhánh 1f)
async function bulkProducts(req, res) {
  const { action } = req.body
  const need = { SHOW: "SAN_PHAM.SUA", HIDE: "SAN_PHAM.SUA", ARCHIVE: "SAN_PHAM.XOA", DELETE: "SAN_PHAM.XOA", UPDATE_STOCK: "SAN_PHAM.CAP_NHAT_TON" }[action]
  if (!need) throw new HttpError(400, "VALIDATION_ERROR", "Thao tác không hợp lệ")
  if (!can(req, need)) throw new HttpError(403, "FORBIDDEN", "Bạn không có quyền thực hiện thao tác này")
  const updated = []
  const skipped = []

  if (action === "UPDATE_STOCK") {
    const items = Array.isArray(req.body.items) ? req.body.items : []
    for (const it of items) {
      const stock = Number(it.stock)
      if (!Number.isInteger(stock) || stock < 0) {
        skipped.push({ id: it.variantSku, reason: "Tồn kho phải là số nguyên không âm" })
        continue
      }
      const set = { "variants.$.stock": stock }
      if (it.lowStockThreshold !== undefined && Number.isInteger(Number(it.lowStockThreshold)) && Number(it.lowStockThreshold) >= 0) set["variants.$.lowStockThreshold"] = Number(it.lowStockThreshold)
      const r = await products().updateOne({ "variants.sku": String(it.variantSku) }, { $set: { ...set, updatedAt: new Date(), updatedBy: req.user._id } })
      r.matchedCount ? updated.push(it.variantSku) : skipped.push({ id: it.variantSku, reason: "Không tìm thấy biến thể" })
    }
  } else {
    const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(toId).filter(Boolean)
    const list = await products().find({ _id: { $in: ids } }).toArray()
    for (const p of list) {
      if (action === "DELETE") {
        if (p.hasOrders) {
          skipped.push({ id: p._id, name: p.name, reason: "đã có đơn, chỉ lưu trữ được" })
          continue
        }
        await products().deleteOne({ _id: p._id })
      } else {
        const status = { SHOW: "DANG_HIEN_THI", HIDE: "DA_AN", ARCHIVE: "NGUNG_BAN" }[action]
        if (status === "DANG_HIEN_THI") {
          const missing = pa.publishMissing({ ...p, images: p.images || [], variants: p.variants || [] })
          if (Object.keys(missing).length) {
            skipped.push({ id: p._id, name: p.name, reason: "thiếu " + Object.values(missing).join(", ").toLowerCase() })
            continue
          }
        }
        await products().updateOne({ _id: p._id }, { $set: { status, updatedAt: new Date(), updatedBy: req.user._id } })
      }
      updated.push(p._id)
    }
  }
  await writeLog({ adminId: req.user._id, action: "BULK_ACTION", targetType: "products", reason: action, after: { updated, skipped } })
  res.send({ updated: updated.length, skipped })
}

// API-162 GET /api/admin/products/export - CSV UTF-8 có BOM (mở được bằng Excel)
// API-214 GET /api/admin/products/next-sku?axis&categoryId&collectionId - SKU kế tiếp theo BR-46
async function nextSku(req, res) {
  const axis = String(req.query.axis || "")
  if (!pa.AXIS_CODES[axis]) throw new HttpError(422, "VALIDATION_ERROR", "Chọn trục đam mê trước", { fields: { axis: "Chọn trục đam mê" } })
  const category = await database.collection("categories").findOne({ _id: toId(req.query.categoryId) }, { projection: { code: 1 } })
  if (!category) throw new HttpError(422, "VALIDATION_ERROR", "Chọn danh mục trước", { fields: { categoryId: "Chọn danh mục" } })
  if (!category.code) throw new HttpError(422, "VALIDATION_ERROR", "Danh mục chưa có mã, thêm mã ở trang Danh mục", { fields: { categoryId: "Danh mục chưa có mã" } })
  let collectionCode = null
  if (req.query.collectionId) {
    const col = await database.collection("collections").findOne({ _id: toId(req.query.collectionId), type: "THU_CONG" }, { projection: { code: 1 } })
    collectionCode = col?.code || null
  }
  const prefix = `${pa.AXIS_CODES[axis]}-${category.code}-`
  const rows = await products().find({ sku: { $regex: "^" + prefix } }, { projection: { sku: 1 } }).toArray()
  res.send(pa.suggestSku({ axis, categoryCode: category.code, collectionCode, existingSkus: rows.map((r) => r.sku) }))
}

async function exportProducts(req, res) {
  const ids = String(req.query.ids || "").split(",").map(toId).filter(Boolean)
  const filter = ids.length ? { _id: { $in: ids } } : {}
  const [list, cats] = await Promise.all([products().find(filter, { collation: VI_COLLATION }).sort({ name: 1 }).toArray(), database.collection("categories").find({}).toArray()])
  const catName = new Map(cats.map((c) => [String(c._id), c.name]))
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`
  const rows = [["SKU", "Tên", "Danh mục", "Trục", "Giá", "Giá sale", "SKU biến thể", "Biến thể", "Tồn", "Đang bán", "Trạng thái"]]
  for (const p of list) {
    for (const v of p.variants || []) {
      rows.push([p.sku, p.name, catName.get(String(p.categoryId)), p.axis, p.price, p.salePrice, v.sku, v.name, v.stock, v.isActive === false ? "Không" : "Có", p.status])
    }
  }
  res.set("Content-Type", "text/csv; charset=utf-8")
  res.set("Content-Disposition", `attachment; filename="san-pham-${new Date().toISOString().slice(0, 10)}.csv"`)
  res.send("﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n"))
}

module.exports = { listProducts, getProduct, createProduct, updateProduct, deleteProduct, duplicateProduct, bulkProducts, exportProducts, nextSku }
