// Trình chỉnh sửa trang chủ và banner (07_API_Spec.md Mục 2.14) - UC-CAT-05 nhánh 1d, 1e, 1f.
// API-113 GET, API-114 PUT lưu bản nháp, API-170 xuất bản; banner API-115 POST, API-116 PUT (_id trong body), API-117 DELETE.
// Cấu hình khối lưu siteSettings (key "home") gồm draft và published; khách chỉ thấy published.
const { database, ObjectId } = require("../config/db")
const params = require("../config/params")
const HttpError = require("../utils/httpError")
const { writeLog } = require("../services/adminLog")
const { sanitizeHtml } = require("../utils/sanitizeHtml")
const { collectionsOnHome, withMissingCollections } = require("./home.controller")

const settings = () => database.collection("siteSettings")
const banners = () => database.collection("homeBanners")
const products = () => database.collection("products")
const toId = (v) => (v && ObjectId.isValid(String(v)) ? new ObjectId(String(v)) : null)
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "")
const dateOrNull = (v) => (v ? new Date(v) : null)

const TYPES = ["banners", "categories", "axes", "recipientGroups", "featured", "collection", "productList", "featuredReviews", "richText", "video"]
const SOURCES = ["NEW", "BEST_SELLING", "CATEGORY", "AXIS", "TAG"]
const isLink = (v) => !v || /^\/(?!\/)/.test(v) // đường dẫn nội bộ, VD /bo-suu-tap/qua-trung-thu

// Mã video YouTube (11 ký tự) từ đường dẫn watch?v=, youtu.be/, embed/, shorts/ hoặc chính mã (khối Video)
function youtubeId(input) {
  const v = String(input || "").trim()
  if (/^[\w-]{11}$/.test(v)) return v
  const m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/.exec(v)
  return m ? m[1] : null
}

// Chuẩn hóa cài đặt từng loại khối; chỉ giữ trường đã biết
function cleanSettings(type, s = {}) {
  const limit = Math.min(params.HOME_LIST_LIMIT * 3, Math.max(1, parseInt(s.limit) || params.HOME_LIST_LIMIT))
  const base = { title: str(s.title, 80), description: str(s.description, 200) }
  const showViewAll = s.showViewAll !== false // nút "Xem tất cả" của khối sản phẩm, bộ sưu tập
  if (type === "featured") return { ...base, limit: Math.min(limit, params.HOME_LIST_LIMIT), showViewAll } // tối đa 8 sản phẩm (1f)
  if (type === "collection") return { ...base, collectionId: toId(s.collectionId), limit, showViewAll } // 06 Mục 2.8
  if (type === "video") return { title: base.title, youtubeId: youtubeId(s.youtubeId || s.youtubeUrl), caption: str(s.caption, 200) }
  if (type === "productList") {
    const kind = SOURCES.includes(s.source?.kind) ? s.source.kind : "NEW"
    const source = { kind }
    if (["CATEGORY", "TAG"].includes(kind)) source.id = toId(s.source?.id)
    if (kind === "AXIS") source.id = ["THE_THAO", "ANIME", "GAME"].includes(s.source?.id) ? s.source.id : null
    return { ...base, source, limit, showViewAll }
  }
  if (type === "richText") {
    return { ...base, body: sanitizeHtml(str(s.body, 2000)), ctaLabel: str(s.ctaLabel, 40), ctaLink: str(s.ctaLink, 200) }
  }
  return base
}

// Kiểm tra danh sách khối của bản nháp (API-114 422)
async function normalizeSections(input) {
  if (!Array.isArray(input)) throw new HttpError(422, "VALIDATION_ERROR", "Danh sách khối không hợp lệ")
  const ids = new Set()
  const sections = []
  for (const [i, raw] of input.entries()) {
    const type = raw && raw.type
    if (!TYPES.includes(type)) throw new HttpError(422, "VALIDATION_ERROR", `Khối thứ ${i + 1} không hợp lệ`)
    let id = str(raw.id, 80) || `${type}-${Date.now().toString(36)}-${i}`
    while (ids.has(id)) id = `${id}-${i}`
    ids.add(id)
    sections.push({ id, type, visible: raw.visible !== false, settings: cleanSettings(type, raw.settings) })
  }
  if (sections.filter((s) => s.type === "banners").length > 1) throw new HttpError(422, "VALIDATION_ERROR", "Chỉ có 1 khối Banner")
  if (!sections.some((s) => s.visible && s.type !== "banners")) {
    throw new HttpError(422, "VALIDATION_ERROR", "Trang chủ cần ít nhất 1 khối đang hiện ngoài Banner")
  }
  const wanted = sections.filter((s) => s.type === "collection")
  if (wanted.some((s) => !s.settings.collectionId)) throw new HttpError(422, "VALIDATION_ERROR", "Khối Bộ sưu tập chưa chọn bộ sưu tập")
  if (wanted.length) {
    const ids = wanted.map((s) => s.settings.collectionId)
    const found = await database.collection("collections").find({ _id: { $in: ids } }, { projection: { _id: 1 } }).toArray()
    if (ids.some((id) => !found.some((c) => c._id.equals(id)))) throw new HttpError(422, "VALIDATION_ERROR", "Khối Bộ sưu tập trỏ tới bộ sưu tập không tồn tại")
  }
  for (const s of sections) {
    if (s.type === "productList" && ["CATEGORY", "TAG", "AXIS"].includes(s.settings.source.kind) && !s.settings.source.id) {
      throw new HttpError(422, "VALIDATION_ERROR", "Khối Danh sách sản phẩm chưa chọn nguồn dữ liệu")
    }
    if (s.type === "video" && !s.settings.youtubeId) {
      throw new HttpError(422, "VALIDATION_ERROR", "Khối Video cần đường dẫn YouTube hợp lệ (VD https://www.youtube.com/watch?v=...)")
    }
    if (s.type === "richText" && s.settings.ctaLink && !isLink(s.settings.ctaLink)) {
      throw new HttpError(422, "VALIDATION_ERROR", "Đường dẫn nút của Khối chữ phải là đường dẫn trong website (bắt đầu bằng /)")
    }
  }
  return sections
}

// Sản phẩm nổi bật hiện tại theo thứ tự (khối con 1f)
async function featuredList() {
  return products()
    .find({ isFeatured: true }, { projection: { name: 1, sku: 1, images: { $slice: 1 }, price: 1, salePrice: 1, status: 1, featuredOrder: 1 } })
    .sort({ featuredOrder: 1, _id: 1 })
    .toArray()
}

async function homeDoc() {
  return (await settings().findOne({ key: "home" })) || { key: "home", draft: { sections: [] }, published: { sections: [] } }
}

const sameLayout = (a, b) => JSON.stringify(a?.sections || []) === JSON.stringify(b?.sections || [])

// Ẩn/hiện khối BST là công tắc "Trang chủ" của BST: trình chỉnh sửa hiện đúng trạng thái đang áp dụng, kể cả
// khối trang khách tự thêm cho BST bật "Trang chủ" ở SCR-41 mà bố cục chưa có (trước đây không hiện nên không ẩn được)
async function withCollectionVisibility(layout) {
  const sections = (layout && layout.sections) || []
  const ids = sections.filter((s) => s.type === "collection" && s.settings?.collectionId).map((s) => s.settings.collectionId)
  const on = new Set((await database.collection("collections").find({ _id: { $in: ids }, showOnHome: true }, { projection: { _id: 1 } }).toArray()).map((c) => String(c._id)))
  const marked = sections.map((s) => (s.type === "collection" ? { ...s, visible: on.has(String(s.settings?.collectionId)) } : s))
  return { ...layout, sections: withMissingCollections(marked, await collectionsOnHome()) }
}

// API-113 GET /api/admin/home
async function getHomeAdmin(req, res) {
  const [home, bannerList, featured] = await Promise.all([homeDoc(), banners().find({}).sort({ sortOrder: 1, _id: 1 }).toArray(), featuredList()])
  res.send({
    draft: await withCollectionVisibility(home.draft),
    published: home.published || { sections: [] },
    publishedAt: home.publishedAt || null,
    banners: bannerList,
    featured,
    hasUnpublishedChanges: !sameLayout(home.draft, home.published),
  })
}

// API-114 PUT /api/admin/home - {sections[], featured?: [{productId, order}]} lưu bản nháp.
// Sản phẩm nổi bật là dữ liệu sản phẩm nên có hiệu lực ngay (07 API-114).
async function saveDraft(req, res) {
  const sections = await normalizeSections(req.body.sections)
  if (Array.isArray(req.body.featured)) {
    const list = req.body.featured.map((f) => ({ id: toId(f && f.productId), order: Number(f && f.order) || 0 })).filter((f) => f.id)
    if (list.length > params.HOME_LIST_LIMIT) throw new HttpError(422, "VALIDATION_ERROR", `Tối đa ${params.HOME_LIST_LIMIT} sản phẩm nổi bật`)
    const found = await products().find({ _id: { $in: list.map((f) => f.id) } }, { projection: { name: 1, status: 1 } }).toArray()
    const hidden = found.find((p) => p.status !== "DANG_HIEN_THI")
    if (hidden) throw new HttpError(422, "VALIDATION_ERROR", `Sản phẩm "${hidden.name}" không ở trạng thái Đang hiển thị`)
    if (found.length !== list.length) throw new HttpError(422, "VALIDATION_ERROR", "Có sản phẩm nổi bật không tồn tại")
    await products().updateMany({ isFeatured: true, _id: { $nin: list.map((f) => f.id) } }, { $set: { isFeatured: false, featuredOrder: null } })
    for (const f of list) await products().updateOne({ _id: f.id }, { $set: { isFeatured: true, featuredOrder: f.order } })
  }
  // Ẩn/hiện khối BST ghi luôn công tắc "Trang chủ" của BST, có hiệu lực ngay như sản phẩm nổi bật
  const colBlocks = sections.filter((x) => x.type === "collection")
  for (const s of colBlocks) {
    await database.collection("collections").updateOne({ _id: s.settings.collectionId }, { $set: { showOnHome: s.visible, updatedAt: new Date() } })
  }
  // Xóa khối BST thì tắt luôn "Trang chủ" của BST, nếu không trang khách lại tự thêm khối đó
  await database.collection("collections").updateMany(
    { showOnHome: true, status: "HIEN_THI", _id: { $nin: colBlocks.map((s) => s.settings.collectionId) } },
    { $set: { showOnHome: false, updatedAt: new Date() } },
  )
  await settings().updateOne({ key: "home" }, { $set: { "draft.sections": sections, updatedAt: new Date(), updatedBy: req.user._id } }, { upsert: true })
  await writeLog({ adminId: req.user._id, action: "HOME_UPDATE", targetType: "siteSettings", reason: "Lưu nháp trang chủ", after: { sections: sections.map((s) => s.id) } })
  const home = await homeDoc()
  res.send({ draft: await withCollectionVisibility(home.draft), hasUnpublishedChanges: !sameLayout(home.draft, home.published), featured: await featuredList() })
}

// API-170 POST /api/admin/home/publish - chép draft sang published
async function publishHome(req, res) {
  const home = await homeDoc()
  const sections = await normalizeSections(home.draft?.sections || [])
  const publishedAt = new Date()
  await settings().updateOne({ key: "home" }, { $set: { "published.sections": sections, publishedAt, publishedBy: req.user._id } }, { upsert: true })
  await writeLog({
    adminId: req.user._id, action: "HOME_PUBLISH", targetType: "siteSettings",
    before: { sections: (home.published?.sections || []).map((s) => s.id) }, after: { sections: sections.map((s) => s.id) },
  })
  res.send({ publishedAt, hasUnpublishedChanges: false })
}

// Chuẩn hóa banner (API-115, 116); existing là banner đang sửa
function normalizeBanner(body, existing = null) {
  const pick = (k, d) => (body[k] !== undefined ? body[k] : existing ? existing[k] : d)
  const fields = {}
  const doc = {
    title: str(pick("title", ""), 100),
    subtitle: str(pick("subtitle", ""), 200),
    imageDesktop: str(pick("imageDesktop", ""), 300),
    imageMobile: str(pick("imageMobile", ""), 300),
    ctaLabel: str(pick("ctaLabel", ""), 40),
    ctaLink: str(pick("ctaLink", ""), 200),
    startAt: dateOrNull(pick("startAt", null)),
    endAt: dateOrNull(pick("endAt", null)),
    isActive: !!pick("isActive", true),
  }
  const so = pick("sortOrder", null)
  doc.sortOrder = Number.isInteger(Number(so)) && so !== null && so !== "" ? Number(so) : null
  const img = /^\/(api\/files|images)\//
  if (!doc.title) fields.title = "Nhập tiêu đề banner"
  if (!img.test(doc.imageDesktop)) fields.imageDesktop = "Tải ảnh Desktop"
  if (doc.imageMobile && !img.test(doc.imageMobile)) fields.imageMobile = "Ảnh Mobile không hợp lệ"
  if (!isLink(doc.ctaLink)) fields.ctaLink = "Đường dẫn nút phải là đường dẫn trong website (bắt đầu bằng /)"
  if (doc.ctaLabel && !doc.ctaLink) fields.ctaLink = "Nhập đường dẫn cho nút"
  if ((doc.startAt && isNaN(doc.startAt)) || (doc.endAt && isNaN(doc.endAt))) fields.startAt = "Thời gian không hợp lệ"
  else if (doc.startAt && doc.endAt && doc.endAt <= doc.startAt) fields.endAt = "Thời gian kết thúc phải sau thời gian bắt đầu"
  if (Object.keys(fields).length) throw new HttpError(422, "VALIDATION_ERROR", Object.values(fields)[0], { fields })
  return doc
}

// API-115 POST /api/admin/banners
async function createBanner(req, res) {
  const doc = normalizeBanner(req.body)
  if (doc.sortOrder === null) {
    const last = await banners().find({}).sort({ sortOrder: -1 }).limit(1).next()
    doc.sortOrder = (last?.sortOrder || 0) + 1
  }
  const now = new Date()
  Object.assign(doc, { createdAt: now, updatedAt: now })
  doc._id = (await banners().insertOne(doc)).insertedId
  await writeLog({ adminId: req.user._id, action: "BANNER_UPDATE", targetType: "homeBanners", targetId: doc._id, after: { title: doc.title } })
  res.status(201).send(doc)
}

// API-116 PUT /api/admin/banners - _id trong body, gửi một phần (VD kéo thả {_id, sortOrder}, bật/tắt {_id, isActive})
async function updateBanner(req, res) {
  const existing = await banners().findOne({ _id: toId(req.body._id) })
  if (!existing) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy banner")
  const doc = normalizeBanner(req.body, existing)
  if (doc.sortOrder === null) doc.sortOrder = existing.sortOrder ?? 0
  await banners().updateOne({ _id: existing._id }, { $set: { ...doc, updatedAt: new Date() } })
  await writeLog({ adminId: req.user._id, action: "BANNER_UPDATE", targetType: "homeBanners", targetId: existing._id, before: { title: existing.title, isActive: existing.isActive }, after: { title: doc.title, isActive: doc.isActive } })
  res.send(await banners().findOne({ _id: existing._id }))
}

// API-117 DELETE /api/admin/banners/:id - hết banner thì client hiện banner mặc định
async function deleteBanner(req, res) {
  const b = await banners().findOne({ _id: toId(req.params["id"]) })
  if (!b) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy banner")
  await banners().deleteOne({ _id: b._id })
  await writeLog({ adminId: req.user._id, action: "BANNER_UPDATE", targetType: "homeBanners", targetId: b._id, before: { title: b.title }, reason: "Xóa banner" })
  res.status(204).send()
}

module.exports = { getHomeAdmin, saveDraft, publishHome, createBanner, updateBanner, deleteBanner, normalizeSections, youtubeId }
