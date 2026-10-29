// API-23 GET /api/home - trang chủ SCR-01 (UC-DIS-01): đọc siteSettings.home.published, dựng dữ liệu cho từng khối
// theo thứ tự Admin sắp xếp; khối ẩn hoặc không có dữ liệu bị bỏ (đảm bảo tối thiểu của UC-DIS-01).
// Xem trước bản nháp (?preview=draft, chỉ phiên nhân viên) làm ở S3 cùng trình chỉnh sửa trang chủ.
const { database } = require("../config/db")
const params = require("../config/params")
const { toCard } = require("../services/productView")
const { listProducts, isCollectionOpen, collectionScope } = require("../services/catalog")
const { parseListQuery, AXES, customerVisible, visible } = require("../services/productQuery")
const { hiddenName } = require("../services/afterSalesRules")

const DAY = 24 * 60 * 60 * 1000
const products = () => database.collection("products")

const AXIS_NAMES = { THE_THAO: "Thể thao", ANIME: "Anime", GAME: "Game" }

const cards = (list, now) => list.map((p) => toCard(p, now))

async function banners(now) {
  const list = await database.collection("homeBanners").find({ isActive: true }).sort({ sortOrder: 1 }).toArray()
  return list
    .filter((b) => (!b.startAt || b.startAt <= now) && (!b.endAt || b.endAt >= now))
    .map(({ _id, title, subtitle, imageDesktop, imageMobile, ctaLabel, ctaLink }) => ({
      _id, title, subtitle, imageDesktop, imageMobile, ctaLabel, ctaLink,
    }))
}

async function categories() {
  return database
    .collection("categories")
    .find({ isActive: true })
    .project({ name: 1, slug: 1, description: 1, image: 1 })
    .sort({ sortOrder: 1 })
    .toArray()
}

async function axes() {
  const counts = await products()
    .aggregate([{ $match: customerVisible() }, { $group: { _id: "$axis", n: { $sum: 1 } } }])
    .toArray()
  return Object.entries(AXES).map(([slug, code]) => ({
    code,
    slug,
    name: AXIS_NAMES[code],
    productCount: (counts.find((c) => c._id === code) || {}).n || 0,
  }))
}

async function recipientGroups() {
  return database
    .collection("tags")
    .find({ group: "DOI_TUONG", isFilter: true })
    .project({ name: 1, slug: 1 })
    .sort({ _id: 1 }) // giữ thứ tự nhập: Ba, Bạn trai, Chồng, Anh em trai, Sếp, Bạn bè (UC-DIS-01 bước 2)
    .toArray()
}

// 8 sản phẩm bán chạy nhất 30 ngày, tính từ đơn không bị hủy (dự phòng cho khối nổi bật).
async function bestSellingFromOrders(limit, now) {
  const rows = await database
    .collection("orders")
    .aggregate([
      { $match: { createdAt: { $gte: new Date(now.getTime() - params.BEST_SELLING_DAYS * DAY) }, orderStatus: { $ne: "DA_HUY" } } },
      { $unwind: "$items" },
      { $group: { _id: "$items.productId", qty: { $sum: "$items.quantity" } } },
      { $sort: { qty: -1 } },
      { $limit: limit * 2 },
    ])
    .toArray()
  if (!rows.length) return []
  const found = await products()
    .find(visible({ _id: { $in: rows.map((r) => r._id) } }))
    .toArray()
  const order = rows.map((r) => String(r._id))
  return found.sort((a, b) => order.indexOf(String(a._id)) - order.indexOf(String(b._id))).slice(0, limit)
}

async function featured(settings, now) {
  const limit = settings.limit || params.HOME_LIST_LIMIT
  const list = await products().find(visible({ isFeatured: true })).sort({ featuredOrder: 1 }).limit(limit).toArray()
  return cards(list.length ? list : await bestSellingFromOrders(limit, now), now)
}

async function collection(settings, now) {
  const c = await database.collection("collections").findOne({ _id: settings.collectionId })
  if (!isCollectionOpen(c, now)) return null
  const p = parseListQuery({ pageSize: settings.limit || params.HOME_LIST_LIMIT })
  const { items, total } = await listProducts(p, collectionScope(c, now), now)
  if (!items.length) return null
  return {
    collection: { _id: c._id, name: c.name, slug: c.slug, description: c.description || "", coverImage: c.coverImage || null, total },
    items,
  }
}

async function productList(settings, now) {
  const limit = settings.limit || params.HOME_LIST_LIMIT
  const { kind, id } = settings.source || {}
  const filter = {}
  let sort = { createdAt: -1, _id: 1 }
  if (kind === "BEST_SELLING") {
    filter.soldCount = { $gt: 0 }
    sort = { soldCount: -1, _id: 1 }
  } else if (kind === "CATEGORY") filter.categoryId = id
  else if (kind === "AXIS") filter.axis = id
  else if (kind === "TAG") filter.tagIds = id
  return cards(await products().find(visible(filter)).sort(sort).limit(limit).toArray(), now)
}

// Tối đa 6 đánh giá 5 sao có nhận xét, mới nhất trước.
async function featuredReviews() {
  return database
    .collection("reviews")
    .aggregate([
      { $match: { rating: 5, isHidden: { $ne: true }, comment: { $nin: [null, ""] } } },
      { $sort: { createdAt: -1 } },
      { $limit: params.HOME_REVIEW_LIMIT },
      { $lookup: { from: "products", localField: "productId", foreignField: "_id", as: "product" } },
      { $unwind: "$product" },
      { $project: { userName: 1, hideName: 1, rating: 1, comment: 1, createdAt: 1, "product.name": 1, "product.slug": 1 } },
    ])
    .toArray()
    .then((list) => list.map(({ hideName, ...x }) => ({ ...x, userName: hideName ? hiddenName(x.userName) : x.userName })))
}

// Dữ liệu của 1 khối; trả null hoặc mảng rỗng thì khối bị bỏ.
async function sectionData(section, now) {
  const s = section.settings || {}
  switch (section.type) {
    case "banners":
      return { items: await banners(now) } // luôn có; không có banner thì client dùng banner mặc định
    case "categories":
      return { items: await categories() }
    case "axes":
      return { items: await axes() }
    case "recipientGroups":
      return { items: await recipientGroups() }
    case "featured":
      return { items: await featured(s, now) }
    case "collection":
      return collection(s, now)
    case "productList":
      return { items: await productList(s, now) }
    case "featuredReviews":
      return { items: await featuredReviews() }
    case "richText":
      return { items: [s] }
    case "video":
      return s.youtubeId ? { items: [s] } : null
    default:
      return null
  }
}

// BST đang bật "Trang chủ" (collections.showOnHome) theo thứ tự hiển thị
function collectionsOnHome() {
  return database.collection("collections").find({ showOnHome: true, status: "HIEN_THI" }, { projection: { _id: 1, sortOrder: 1 } }).sort({ sortOrder: 1, _id: 1 }).toArray()
}

// BST bật "Trang chủ" mà bố cục chưa có khối thì thêm khối ngay sau khối BST cuối (không có thì trước khối Đánh giá).
// Dùng chung cho trang khách và trình chỉnh sửa (API-113) để admin thấy và ẩn được đúng khối khách đang thấy.
function withMissingCollections(sections, onHome, ids = sections.filter((s) => s.type === "collection").map((s) => String(s.settings?.collectionId))) {
  const extra = onHome
    .filter((c) => !ids.includes(String(c._id)))
    .map((c) => ({ id: `bst-${c._id}`, type: "collection", visible: true, settings: { collectionId: c._id, limit: params.HOME_LIST_LIMIT, showViewAll: true } }))
  if (!extra.length) return sections
  const lastCol = sections.map((s) => s.type).lastIndexOf("collection")
  const reviews = sections.findIndex((s) => s.type === "featuredReviews")
  const at = lastCol >= 0 ? lastCol + 1 : reviews >= 0 ? reviews : sections.length
  return [...sections.slice(0, at), ...extra, ...sections.slice(at)]
}

// Khối BST hiện theo công tắc "Trang chủ" của BST thay cho cờ ẩn/hiện của khối
async function withCollectionSwitch(all) {
  const ids = all.filter((s) => s.type === "collection" && s.settings?.collectionId).map((s) => String(s.settings.collectionId))
  const onHome = await collectionsOnHome()
  const on = new Set(onHome.map((c) => String(c._id)))
  const sections = all.filter((s) => (s.type === "collection" ? on.has(String(s.settings?.collectionId)) : s.visible !== false))
  return withMissingCollections(sections, onHome, ids)
}

async function getHome(req, res) {
  const now = new Date()
  const home = await database.collection("siteSettings").findOne({ key: "home" })
  // Khung xem trước của trình chỉnh sửa (UC-CAT-05 1d): ?preview=draft chỉ có hiệu lực với phiên nhân viên có quyền xem Trang chủ
  const canPreview = !!req.staff && (req.isFullAccess || req.permissions.has("TRANG_CHU.XEM"))
  const layout = req.query.preview === "draft" && canPreview ? home && home.draft : home && home.published
  const sections = await withCollectionSwitch((layout && layout.sections) || [])

  const built = await Promise.all(
    sections.map(async (s) => ({ id: s.id, type: s.type, settings: s.settings || {}, data: await sectionData(s, now) }))
  )
  res.send({
    sections: built.filter((s) => s.type === "banners" || (s.data && s.data.items && s.data.items.length)),
  })
}

module.exports = { getHome, collectionsOnHome, withMissingCollections }
