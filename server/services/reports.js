// Báo cáo tổng quan SCR-40 (UC-CAT-03; 07_API_Spec.md API-88, API-89). Chỉ đọc. Số liệu tính bằng aggregation
// pipeline của MongoDB (Chương VII): $match theo khoảng thời gian, $group, $unwind dòng sản phẩm, $lookup sản phẩm để lấy
// danh mục và trục đam mê. Quy tắc thuần (khoảng thời gian, % thay đổi, mức độ gợi ý, CSV) ở reportRules.js.
// Trường tài chính (doanh thu, tiền đã thu, giá trị đơn TB, tiền giảm, phí cá nhân hóa) chỉ trả khi có
// TONG_QUAN.XEM_DOANH_THU; thiếu quyền thì là null (AC7). Gợi ý hành động chỉ gồm mục thuộc quyền người xem.
const { database, ObjectId } = require("../config/db")
const params = require("../config/params")
const HttpError = require("../utils/httpError")
const r = require("./reportRules")
const st = require("./orderState")
const ops = require("./opsRules")
const after = require("./afterSalesRules")
const myOrders = require("./myOrders")
const { getStoreSettings } = require("./settings")
const { unitPrice } = require("./pricing")

const col = (name) => database.collection(name)
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const can = (req, code) => !!req.isFullAccess || req.permissions.has(code)
const canFinance = (req) => can(req, "TONG_QUAN.XEM_DOANH_THU")
const money = (req, x) => (canFinance(req) ? x : null)

// Thứ tự quy trình (bước 3)
const STATUS_ORDER = ["CHO_XAC_NHAN", "DANG_CA_NHAN_HOA", "DANG_CHUAN_BI", "DANG_VAN_CHUYEN", "DA_GIAO", "HOAN_THANH", "DA_HUY"]
const DONE = ["DA_GIAO", "HOAN_THANH"]
const AXIS_LABEL = { THE_THAO: "Thể thao", ANIME: "Anime", GAME: "Game" }
const inRange = (a, b) => ({ createdAt: { $gte: a, $lt: b } })
// Ngày giờ Việt Nam của createdAt trong pipeline
const vnDayExpr = { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "+07:00" } }
// Giá trị dòng còn tính doanh thu: bỏ dòng đã hoàn tiền (không thể thực hiện)
const liveItems = { "items.fulfillStatus": { $ne: "DA_HOAN_TIEN" } }

// ===== Phần vận hành và tài chính =====

async function kpisOf(a, b) {
  const [g] = await col("orders")
    .aggregate([
      { $match: inRange(a, b) },
      {
        $group: {
          _id: null,
          orders: { $sum: 1 },
          done: { $sum: { $cond: [{ $in: ["$orderStatus", DONE] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ["$orderStatus", "DA_HUY"] }, 1, 0] } },
          // Doanh thu: tổng total đơn Đã giao và Hoàn thành, trừ phần đã hoàn (bước 4, AC1)
          revenue: { $sum: { $cond: [{ $in: ["$orderStatus", DONE] }, { $subtract: ["$total", { $ifNull: ["$refundedAmount", 0] }] }, 0] } },
          // Tiền đã thu: mọi khoản khách đã trả (gồm cọc của đơn chưa giao), trừ phần đã hoàn
          collected: { $sum: { $subtract: [{ $ifNull: ["$paidAmount", 0] }, { $ifNull: ["$refundedAmount", 0] }] } },
          customers: { $addToSet: { $cond: [{ $ne: ["$orderStatus", "DA_HUY"] }, "$userId", "$$REMOVE"] } },
        },
      },
    ])
    .toArray()
  const x = g || { orders: 0, done: 0, cancelled: 0, revenue: 0, collected: 0, customers: [] }
  return {
    orders: x.orders, done: x.done, revenue: x.revenue, collected: x.collected, customers: x.customers.length,
    aov: x.done ? Math.round(x.revenue / x.done) : 0,
    completionRate: r.ratePct(x.done, x.orders), cancelRate: r.ratePct(x.cancelled, x.orders),
  }
}

async function statusCounts(range) {
  const rows = await col("orders").aggregate([{ $match: inRange(range.start, range.end) }, { $group: { _id: "$orderStatus", n: { $sum: 1 } } }]).toArray()
  const map = new Map(rows.map((x) => [x._id, x.n]))
  return STATUS_ORDER.map((s) => ({ status: s, label: st.ORDER_LABEL[s], count: map.get(s) || 0 }))
}

// Doanh thu và số đơn theo ngày/tuần/tháng (biểu đồ). Ngày không có đơn vẫn là điểm 0
async function series(req, range, groupBy) {
  const rows = await col("orders")
    .aggregate([
      { $match: inRange(range.start, range.end) },
      {
        $group: {
          _id: vnDayExpr,
          orders: { $sum: 1 },
          revenue: { $sum: { $cond: [{ $in: ["$orderStatus", DONE] }, { $subtract: ["$total", { $ifNull: ["$refundedAmount", 0] }] }, 0] } },
        },
      },
    ])
    .toArray()
  const acc = new Map(r.buckets(range.from, range.to, groupBy).map((b) => [b, { orders: 0, revenue: 0 }]))
  for (const x of rows) {
    const b = acc.get(r.bucketOf(x._id, groupBy))
    if (b) {
      b.orders += x.orders
      b.revenue += x.revenue
    }
  }
  return [...acc].map(([key, v]) => ({ key, label: r.bucketLabel(key, groupBy), orders: v.orders, revenue: money(req, v.revenue) }))
}

const stockOf = (p) => (p.variants || []).filter((v) => v.isActive !== false).reduce((n, v) => n + (v.stock || 0), 0)
const lowStock = (p) => (p.variants || []).some((v) => v.isActive !== false && (v.stock || 0) <= (v.lowStockThreshold ?? 5))

// Top 10 bán chạy theo số lượng (bỏ đơn hủy, đơn thay thế 0đ, dòng đã hoàn tiền); kèm tồn kho cho người không xem doanh thu
async function topProducts(req, range, limit = 10) {
  const rows = await col("orders")
    .aggregate([
      { $match: { ...inRange(range.start, range.end), orderStatus: { $ne: "DA_HUY" }, replacementFor: { $exists: false } } },
      { $unwind: "$items" },
      { $match: liveItems },
      { $group: { _id: "$items.productId", name: { $first: "$items.name" }, sku: { $first: "$items.sku" }, quantity: { $sum: "$items.quantity" }, revenue: { $sum: "$items.lineValue" } } },
      { $sort: { quantity: -1, revenue: -1 } },
      { $limit: limit },
      { $lookup: { from: "products", localField: "_id", foreignField: "_id", as: "p" } },
    ])
    .toArray()
  return rows.map((x) => {
    const p = x.p[0]
    return {
      productId: String(x._id), name: p?.name || x.name, sku: x.sku, image: p?.images?.[0] || null,
      quantity: x.quantity, revenue: money(req, x.revenue), stock: p ? stockOf(p) : null, lowStock: p ? lowStock(p) : false,
    }
  })
}

// Doanh thu theo 3 trục đam mê và 6 danh mục: giá trị dòng của đơn Đã giao, Hoàn thành ($lookup sản phẩm)
async function revenueBy(range, field) {
  const rows = await col("orders")
    .aggregate([
      { $match: { ...inRange(range.start, range.end), orderStatus: { $in: DONE } } },
      { $unwind: "$items" },
      { $match: liveItems },
      { $lookup: { from: "products", localField: "items.productId", foreignField: "_id", as: "p" } },
      { $unwind: "$p" },
      { $group: { _id: `$p.${field}`, revenue: { $sum: "$items.lineValue" }, orders: { $addToSet: "$_id" } } },
    ])
    .toArray()
  return rows.map((x) => ({ key: x._id, revenue: x.revenue, orders: x.orders.length }))
}

async function axesAndCategories(req, range) {
  if (!canFinance(req)) return { axes: null, categories: null }
  const [axes, cats, catDocs] = await Promise.all([
    revenueBy(range, "axis"),
    revenueBy(range, "categoryId"),
    col("categories").find({}, { projection: { name: 1, sortOrder: 1 } }).sort({ sortOrder: 1 }).toArray(),
  ])
  const share = (list) => {
    const total = list.reduce((s, x) => s + x.revenue, 0)
    return list.map((x) => ({ ...x, pct: total ? Math.round((x.revenue / total) * 100) : 0 }))
  }
  const axisMap = new Map(axes.map((x) => [x.key, x]))
  const catMap = new Map(cats.map((x) => [String(x.key), x]))
  return {
    axes: share(Object.keys(AXIS_LABEL).map((k) => ({ key: k, label: AXIS_LABEL[k], revenue: axisMap.get(k)?.revenue || 0, orders: axisMap.get(k)?.orders || 0 }))),
    categories: share(catDocs.map((c) => ({ key: String(c._id), label: c.name, revenue: catMap.get(String(c._id))?.revenue || 0, orders: catMap.get(String(c._id))?.orders || 0 }))),
  }
}

// ===== Gợi ý hành động (3g) =====

function insight(type, message, detail, link, dueAt = null, now = new Date()) {
  const severity = r.SEVERITY_OF[type]
  return { type, message, detail, link, severity, severityLabel: r.SEVERITY_LABEL[severity], dueAt, due: r.dueText(dueAt, now) }
}

async function insights(req, settings, now) {
  const out = []
  const stockoutDays = settings.insights?.stockoutDays ?? params.INSIGHT_STOCKOUT_DAYS ?? 7
  const expiryDays = settings.insights?.expiryDays ?? params.INSIGHT_EXPIRY_DAYS ?? 7
  const soon = new Date(now.getTime() + expiryDays * DAY)
  const fmtDay = (d) => r.ddMM(r.vnDay(d))

  // (1) Dự kiến hết hàng: tồn / bán TB mỗi ngày của 14 ngày gần nhất
  if (can(req, "SAN_PHAM.XEM")) {
    const sold = await col("orders")
      .aggregate([
        { $match: { createdAt: { $gte: new Date(now.getTime() - 14 * DAY) }, orderStatus: { $ne: "DA_HUY" } } },
        { $unwind: "$items" },
        { $match: liveItems },
        { $group: { _id: "$items.productId", q: { $sum: "$items.quantity" } } },
      ])
      .toArray()
    const ids = sold.map((x) => x._id)
    const prods = await col("products").find({ _id: { $in: ids }, status: "DANG_HIEN_THI" }, { projection: { name: 1, variants: 1 } }).toArray()
    const soldMap = new Map(sold.map((x) => [String(x._id), x.q]))
    for (const p of prods) {
      const stock = stockOf(p)
      const q = soldMap.get(String(p._id)) || 0
      const days = r.daysUntilStockout(stock, q)
      if (days === null || days > stockoutDays) continue
      const avg = Math.round((q / 14) * 10) / 10
      out.push(insight("STOCKOUT", `${p.name} dự kiến hết hàng trong khoảng ${days} ngày`, `Còn ${stock} sản phẩm, bán trung bình ${String(avg).replace(".", ",")} sản phẩm mỗi ngày`, `/quan-tri/san-pham/${p._id}`, new Date(now.getTime() + days * DAY), now))
    }
  }

  // (2) Bộ sưu tập, banner, bộ sticker, mẫu gói quà theo mùa sắp hết hạn
  const expiring = async (name, filter, label, link, perm) => {
    if (!can(req, perm)) return
    const list = await col(name).find({ ...filter, endAt: { $gte: now, $lte: soon } }).sort({ endAt: 1 }).limit(5).toArray()
    for (const x of list) {
      const days = r.daysLeft(x.endAt, now)
      out.push(insight("EXPIRING", `${label} "${x.name || x.title}" hết hạn sau ${days} ngày`, `Kết thúc ngày ${fmtDay(x.endAt)}; gia hạn hoặc chuẩn bị nội dung thay thế`, typeof link === "function" ? link(x) : link, x.endAt, now))
    }
  }
  await expiring("collections", { status: "HIEN_THI" }, "Bộ sưu tập", (x) => `/quan-tri/bo-suu-tap/${x._id}`, "BO_SUU_TAP.XEM")
  await expiring("homeBanners", { isActive: true }, "Banner", "/quan-tri/trang-chu", "TRANG_CHU.XEM")
  await expiring("stickerSets", { isActive: true }, "Bộ sticker", "/quan-tri/ca-nhan-hoa?tab=sticker", "GOI_QUA.XEM")
  await expiring("giftWrapTemplates", { isActive: true }, "Mẫu gói quà", "/quan-tri/ca-nhan-hoa?tab=mau", "GOI_QUA.XEM")

  // (3) Nhiều lượt xem, ít thêm giỏ trong 7 ngày qua
  if (can(req, "SAN_PHAM.XEM")) {
    const rows = await col("productDailyStats")
      .aggregate([
        { $match: { date: { $gte: r.addDays(r.vnDay(now), -6) } } },
        { $group: { _id: "$productId", views: { $sum: "$views" }, carts: { $sum: "$addToCarts" } } },
        { $match: { views: { $gte: 100 } } },
        { $lookup: { from: "products", localField: "_id", foreignField: "_id", as: "p" } },
      ])
      .toArray()
    for (const x of rows.filter((y) => r.lowConversion(y.views, y.carts) && y.p[0])) {
      out.push(insight("LOW_CONVERSION", `${x.p[0].name}: ${x.views} lượt xem nhưng chỉ ${x.carts} lượt thêm giỏ`, "Tỷ lệ thêm giỏ dưới 2% trong 7 ngày qua; xem lại giá, ảnh hoặc mô tả", `/quan-tri/san-pham/${x._id}`, null, now))
    }
  }

  // (4) Voucher còn dưới 10% lượt hoặc sắp hết hạn
  if (can(req, "VOUCHER.XEM")) {
    const list = await col("vouchers")
      .find({ status: "HOAT_DONG", source: { $ne: "COMPENSATION" }, $or: [{ endAt: { $gte: now, $lte: soon } }, { totalQuantity: { $gt: 0 } }] })
      .toArray()
    for (const v of list) {
      const ending = v.endAt && new Date(v.endAt) >= now && new Date(v.endAt) <= soon
      if (!ending && !r.voucherLow(v)) continue
      const left = v.totalQuantity ? v.totalQuantity - (v.usedCount || 0) : null
      const msg = r.voucherLow(v) ? `Voucher ${v.code} chỉ còn ${left} lượt dùng` : `Voucher ${v.code} hết hạn ngày ${fmtDay(v.endAt)}`
      out.push(insight("VOUCHER", msg, `${v.name || ""}${left !== null ? `, đã dùng ${v.usedCount || 0}/${v.totalQuantity}` : ""}`.replace(/^, /, ""), `/quan-tri/voucher/${v._id}`, ending ? v.endAt : null, now))
    }
  }

  // (5) Đơn và yêu cầu mức Khẩn cấp đang chờ (BR-32)
  if (can(req, "DON_HANG.XEM")) {
    const open = await col("orders").find({ orderStatus: { $nin: ["HOAN_THANH"] }, $or: [{ orderStatus: { $ne: "DA_HUY" } }, { codDiscrepancy: { $exists: true } }] }).toArray()
    const refunds = await myOrders.latestRefunds(open.map((o) => o.code))
    const urgent = open.map((o) => ops.priority(o, { now, refund: refunds.get(o.code) || null })).filter((p) => p.level === "KHAN_CAP")
    if (urgent.length) {
      const due = urgent.map((p) => p.deadline).filter(Boolean).sort((a, b) => a - b)[0] || null
      out.push(insight("URGENT_ORDERS", `${urgent.length} đơn ở mức Khẩn cấp đang chờ xử lý`, [...new Set(urgent.map((p) => p.reason))].slice(0, 2).join("; "), "/quan-tri/don-hang?view=urgent", due, now))
    }
  }
  if (can(req, "HAU_MAI.XEM")) {
    const [returns, refunds] = await Promise.all([
      col("returnRequests").find({ status: "DANG_YEU_CAU" }, { projection: { status: 1, slaDeadline: 1, createdAt: 1 } }).toArray(),
      col("refunds").find({ status: "CHO_XU_LY" }, { projection: { status: 1, slaDeadline: 1, bankInfo: 1, createdAt: 1 } }).toArray(),
    ])
    const list = [...returns.map((x) => after.requestPriority("RETURN", x, now)), ...refunds.map((x) => after.requestPriority("REFUND", x, now))].filter((p) => p && p.level === "KHAN_CAP")
    if (list.length) {
      const oldest = [...returns, ...refunds].map((x) => new Date(x.createdAt)).sort((a, b) => a - b)[0]
      const waited = oldest ? Math.floor((now - oldest) / HOUR) : 0
      out.push(insight("URGENT_REQUESTS", `${list.length} yêu cầu hậu mãi chờ xử lý`, `${returns.length} đổi trả chờ duyệt, ${refunds.length} hoàn tiền chờ chuyển khoản${waited >= 24 ? `; lâu nhất đã chờ ${waited} giờ` : ""}`, "/quan-tri/yeu-cau", oldest, now))
    }
  }

  // (6) Nhu cầu chưa đáp ứng mới từ Tư vấn AI
  if (can(req, "TAGS.XEM")) {
    const gaps = await col("aiGaps").find({ status: "MOI" }).sort({ count: -1 }).limit(3).toArray()
    const total = await col("aiGaps").countDocuments({ status: "MOI" })
    if (total) {
      const top = gaps[0]
      out.push(insight("AI_GAPS", `${total} nhu cầu chưa có sản phẩm phù hợp từ Tư vấn AI`, top ? `Nhiều nhất: ${top.criteriaKey} (${top.count} lượt)` : "", "/quan-tri/catalog-ai?tab=nhu-cau", null, now))
    }
  }

  // (7) Vật liệu gói quà dưới ngưỡng
  if (can(req, "GOI_QUA.XEM")) {
    const mats = await col("giftWrapMaterials").find({ isActive: true, $expr: { $lte: ["$stock", { $ifNull: ["$lowStockThreshold", 0] }] } }).toArray()
    if (mats.length) {
      out.push(insight("MATERIAL", mats.length === 1 ? `Vật liệu "${mats[0].name}" sắp hết` : `${mats.length} vật liệu gói quà sắp hết`, mats.slice(0, 3).map((m) => `${m.name}: còn ${m.stock} ${m.unit || "cái"}`).join("; "), "/quan-tri/ca-nhan-hoa?tab=vat-lieu", null, now))
    }
  }

  // (8) Đơn đã xác nhận chờ đóng gói quá 24 giờ
  if (can(req, "DON_HANG.XEM")) {
    const packing = await col("orders").find({ orderStatus: "DANG_CHUAN_BI" }, { projection: { statusHistory: 1, createdAt: 1, updatedAt: 1 } }).toArray()
    const late = packing.map((o) => ops.reachedAt(o, "DANG_CHUAN_BI") || new Date(o.updatedAt || o.createdAt)).filter((t) => now - t > DAY).sort((a, b) => a - b)
    if (late.length) out.push(insight("PACKING", `${late.length} đơn chờ đóng gói quá 24 giờ`, "Đơn đã xác nhận, cần đóng gói và giao cho vận chuyển", "/quan-tri/don-hang?view=to-pack", new Date(late[0].getTime() + DAY), now))
  }

  // (9) Đơn lưu kho sắp hết hạn giữ
  if (can(req, "HANG_LUU_KHO.XEM")) {
    const until = new Date(now.getTime() + params.INSIGHT_STORAGE_DAYS * DAY)
    const list = await col("orders").find({ storageStatus: "DANG_LUU_KHO", storageDeadline: { $gte: now, $lte: until } }).sort({ storageDeadline: 1 }).toArray()
    if (list.length) {
      const first = list[0].storageDeadline
      out.push(insight("STORAGE", `${list.length} đơn lưu kho sắp hết hạn giữ`, `Khách chưa nhận lại hàng, hạn giữ gần nhất ngày ${fmtDay(first)}`, "/quan-tri/luu-kho", first, now))
    }
  }
  return r.sortInsights(out)
}

// ===== Thiết lập cửa hàng (chỉ Quản trị) =====

async function setup(req, store) {
  if (!req.isFullAccess) return null
  const [home, stickers, templates, policies, faqs, staff] = await Promise.all([
    col("siteSettings").findOne({ key: "home" }, { projection: { publishedAt: 1 } }),
    col("stickerSets").countDocuments({ isActive: true }),
    col("giftWrapTemplates").countDocuments({ isActive: true }),
    col("policies").countDocuments({}),
    col("faqs").countDocuments({ isActive: { $ne: false } }),
    col("users").countDocuments({ role: "admin", status: "HOAT_DONG", _id: { $ne: req.user._id } }),
  ])
  return r.setupCards({
    homePublished: !!home?.publishedAt, feesSaved: !!store?.updatedBy, activeStickerSets: stickers, activeTemplates: templates,
    policyCount: policies, activeFaqs: faqs, otherActiveStaff: staff,
  })
}

// ===== Các nhóm bên dưới (3a, 3b, 3c, 3d, 3f) =====

async function customersSection(req, range, settings, now) {
  const [funnel] = await col("productDailyStats")
    .aggregate([{ $match: { date: { $gte: range.from, $lte: range.to } } }, { $group: { _id: null, views: { $sum: "$views" }, wishlists: { $sum: "$wishlists" }, addToCarts: { $sum: "$addToCarts" } } }])
    .toArray()
  const topViewed = await col("productDailyStats")
    .aggregate([
      { $match: { date: { $gte: range.from, $lte: range.to } } },
      { $group: { _id: "$productId", views: { $sum: "$views" }, addToCarts: { $sum: "$addToCarts" } } },
      { $sort: { views: -1 } },
      { $limit: 5 },
      { $lookup: { from: "products", localField: "_id", foreignField: "_id", as: "p" } },
    ])
    .toArray()
  const orders = await col("orders").countDocuments(inRange(range.start, range.end))

  // Giỏ bỏ quên: dòng trong giỏ Member quá số ngày cấu hình chưa đặt
  const days = settings.insights?.abandonedCartDays ?? 7
  const cutoff = new Date(now.getTime() - days * DAY)
  const carts = await col("carts").find({ "items.addedAt": { $lt: cutoff } }, { projection: { items: 1 } }).toArray()
  const lines = carts.flatMap((c) => c.items.filter((it) => it.addedAt && new Date(it.addedAt) < cutoff))
  const ids = [...new Set(lines.map((it) => String(it.productId)))]
  const prods = await col("products").find({ _id: { $in: ids.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id)) } }, { projection: { name: 1, price: 1, salePrice: 1, saleStartAt: 1, saleEndAt: 1, variants: 1 } }).toArray()
  const pmap = new Map(prods.map((p) => [String(p._id), p]))
  let value = 0
  const counts = new Map()
  for (const it of lines) {
    const p = pmap.get(String(it.productId))
    if (!p) continue
    value += unitPrice(p, p.variants.find((v) => v.sku === it.variantSku), now) * it.quantity
    counts.set(String(it.productId), (counts.get(String(it.productId)) || 0) + 1)
  }
  return {
    funnel: { views: funnel?.views || 0, wishlists: funnel?.wishlists || 0, addToCarts: funnel?.addToCarts || 0, orders },
    topViewed: topViewed.filter((x) => x.p[0]).map((x) => ({ productId: String(x._id), name: x.p[0].name, views: x.views, addToCarts: x.addToCarts, rate: r.ratePct(x.addToCarts, x.views) })),
    abandoned: {
      days, carts: carts.filter((c) => c.items.some((it) => it.addedAt && new Date(it.addedAt) < cutoff)).length, lines: lines.length, value: money(req, value),
      topProducts: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, n]) => ({ productId: id, name: pmap.get(id)?.name || "", count: n })),
    },
  }
}

async function vouchersSection(req, range) {
  const rows = await col("orders")
    .aggregate([
      { $match: { ...inRange(range.start, range.end), orderStatus: { $ne: "DA_HUY" } } },
      { $unwind: "$vouchers" },
      { $group: { _id: "$vouchers.code", type: { $first: "$vouchers.type" }, uses: { $sum: 1 }, discount: { $sum: "$vouchers.discount" } } },
      { $sort: { uses: -1 } },
      { $limit: 10 },
    ])
    .toArray()
  return {
    totalUses: rows.reduce((n, x) => n + x.uses, 0),
    totalDiscount: money(req, rows.reduce((n, x) => n + x.discount, 0)),
    items: rows.map((x) => ({ code: x._id, type: x.type, uses: x.uses, discount: money(req, x.discount) })),
  }
}

async function reviewsSection(range) {
  const rows = await col("reviews")
    .aggregate([
      { $match: { ...inRange(range.start, range.end), isHidden: { $ne: true } } },
      { $group: { _id: "$productId", n: { $sum: 1 }, avg: { $avg: "$rating" } } },
      { $lookup: { from: "products", localField: "_id", foreignField: "_id", as: "p" } },
    ])
    .toArray()
  const count = rows.reduce((n, x) => n + x.n, 0)
  const avg = count ? Math.round((rows.reduce((s, x) => s + x.avg * x.n, 0) / count) * 10) / 10 : null
  const list = rows.filter((x) => x.p[0]).map((x) => ({ productId: String(x._id), name: x.p[0].name, count: x.n, avg: Math.round(x.avg * 10) / 10 }))
  const byAvg = [...list].sort((a, b) => b.avg - a.avg || b.count - a.count)
  return { count, avg, best: byAvg.slice(0, 3), worst: byAvg.length > 3 ? byAvg.slice(-3).reverse() : [] }
}

async function personalizationSection(req, range) {
  const docs = await col("orders")
    .find(inRange(range.start, range.end), { projection: { hasPersonalizedItems: 1, personalizationFee: 1, giftWrap: 1, items: 1, orderStatus: 1 } })
    .toArray()
  const total = docs.length
  const withP = docs.filter((o) => o.hasPersonalizedItems).length
  let inKhac = 0
  let thietKe = 0
  const stickers = new Map()
  for (const o of docs) {
    for (const it of o.items || []) {
      const p = it.personalization
      if (!p) continue
      if (p.type === "IN_KHAC") inKhac += it.quantity
      if (p.type === "THIET_KE") {
        thietKe += it.quantity
        for (const s of p.stickers || []) {
          const code = typeof s === "string" ? s : s.code
          const cur = stickers.get(code) || { code, name: s.name || code, uses: 0 }
          cur.uses += it.quantity
          stickers.set(code, cur)
        }
      }
    }
  }
  // Bộ sticker của từng mã, và loại thường / BST-mùa để so sánh
  const sets = await col("stickerSets").find({}, { projection: { name: 1, kind: 1, "stickers.code": 1 } }).toArray()
  const setOf = new Map(sets.flatMap((s) => s.stickers.map((x) => [x.code, s])))
  const bySet = new Map()
  const byKind = { THUONG: 0, BST_MUA: 0 }
  for (const s of stickers.values()) {
    const set = setOf.get(s.code)
    if (!set) continue
    bySet.set(String(set._id), { name: set.name, kind: set.kind, uses: (bySet.get(String(set._id))?.uses || 0) + s.uses })
    byKind[set.kind === "BST_MUA" ? "BST_MUA" : "THUONG"] += s.uses
  }
  const wrapped = docs.filter((o) => o.giftWrap)
  const src = { GOI_Y: 0, CUA_TOI: 0, TAO_MOI: 0 }
  const templates = new Map()
  for (const o of wrapped) {
    if (src[o.giftWrap.source] !== undefined) src[o.giftWrap.source]++
    if (o.giftWrap.source === "GOI_Y" && o.giftWrap.name) templates.set(o.giftWrap.name, (templates.get(o.giftWrap.name) || 0) + 1)
  }
  const tplDocs = await col("giftWrapTemplates").find({ name: { $in: [...templates.keys()] } }, { projection: { name: 1, kind: 1 } }).toArray()
  const tplKind = new Map(tplDocs.map((t) => [t.name, t.kind]))
  const wrapKind = { THUONG: 0, BST_MUA: 0 }
  for (const [name, n] of templates) wrapKind[tplKind.get(name) === "BST_MUA" ? "BST_MUA" : "THUONG"] += n
  return {
    orders: total, personalizedOrders: withP, personalizedRate: r.ratePct(withP, total), // AC6
    fee: money(req, docs.filter((o) => DONE.includes(o.orderStatus)).reduce((s, o) => s + (o.personalizationFee || 0), 0)),
    engraveItems: inKhac, designItems: thietKe,
    topStickers: [...stickers.values()].sort((a, b) => b.uses - a.uses).slice(0, 10),
    topStickerSets: [...bySet.values()].sort((a, b) => b.uses - a.uses).slice(0, 10),
    stickerKinds: byKind,
    giftWrapOrders: wrapped.length, giftWrapRate: r.ratePct(wrapped.length, total),
    giftWrapSources: src,
    topTemplates: [...templates].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, n]) => ({ name, uses: n, kind: tplKind.get(name) || "THUONG" })),
    templateKinds: wrapKind,
  }
}

async function aiSection(range) {
  const [g] = await col("aiSessions")
    .aggregate([
      { $match: inRange(range.start, range.end) },
      {
        $group: {
          _id: null,
          sessions: { $sum: 1 },
          suggested: { $sum: { $size: { $ifNull: ["$results", []] } } },
          clicks: { $sum: { $size: { $ifNull: ["$clickedProductIds", []] } } },
          orders: { $sum: { $size: { $ifNull: ["$orderCodes", []] } } },
          unmatched: { $sum: { $cond: [{ $eq: ["$matchedAll", false] }, 1, 0] } },
        },
      },
    ])
    .toArray()
  const x = g || { sessions: 0, suggested: 0, clicks: 0, orders: 0, unmatched: 0 }
  return { sessions: x.sessions, suggested: x.suggested, clicks: x.clicks, orders: x.orders, gapRate: r.ratePct(x.unmatched, x.sessions) }
}

// ===== API-88 =====

const SECTIONS = ["overview", "customers", "vouchers", "reviews", "personalization", "ai"]

async function report(req, query = {}) {
  const now = new Date()
  const range = r.resolveRange(query, now)
  const section = SECTIONS.includes(query.section) ? query.section : "overview"
  const head = { range: { preset: range.preset, from: range.from, to: range.to, days: range.days, label: range.label, prevFrom: range.prev.from, prevTo: range.prev.to }, canFinance: canFinance(req) }
  const settings = await getStoreSettings()

  if (section === "customers") return { ...head, customers: await customersSection(req, range, settings, now) }
  if (section === "vouchers") return { ...head, vouchers: await vouchersSection(req, range) }
  if (section === "reviews") return { ...head, reviews: await reviewsSection(range) }
  if (section === "personalization") return { ...head, personalization: await personalizationSection(req, range) }
  if (section === "ai") return { ...head, ai: await aiSection(range) }

  const groupBy = r.pickGroupBy(query.groupBy, range.days)
  const [cur, prev, statuses, chart, top, split, list, store, first, packing] = await Promise.all([
    kpisOf(range.start, range.end),
    kpisOf(range.prev.start, range.prev.end),
    statusCounts(range),
    series(req, range, groupBy),
    topProducts(req, range),
    axesAndCategories(req, range),
    insights(req, settings, now),
    col("siteSettings").findOne({ key: "store" }, { projection: { updatedBy: 1 } }),
    col("orders").find({}, { projection: { createdAt: 1 } }).sort({ createdAt: 1 }).limit(1).next(),
    can(req, "DON_HANG.GIAO_VAN_CHUYEN") ? col("orders").countDocuments({ orderStatus: "DANG_CHUAN_BI" }) : null,
  ])
  const fin = canFinance(req)
  return {
    ...head,
    groupBy,
    kpis: {
      revenue: fin ? r.metric(cur.revenue, prev.revenue) : null,
      collected: fin ? r.metric(cur.collected, prev.collected) : null,
      aov: fin ? r.metric(cur.aov, prev.aov) : null,
      customers: r.metric(cur.customers, prev.customers),
      orders: r.metric(cur.orders, prev.orders),
      completionRate: r.metric(cur.completionRate, prev.completionRate, "points"),
      cancelRate: r.metric(cur.cancelRate, prev.cancelRate, "points"),
      // Thẻ "Cần đóng gói" cho người có quyền ghi nhận đóng gói (Kho), không phụ thuộc khoảng thời gian
      packingCount: can(req, "DON_HANG.GIAO_VAN_CHUYEN") ? packing : null,
    },
    series: chart,
    statuses,
    topProducts: top,
    axes: split.axes,
    categories: split.categories,
    insights: list,
    setup: await setup(req, store),
    firstOrderAt: first ? first.createdAt : null,
  }
}

// ===== API-89 xuất CSV (5a) =====

const DATASETS = ["orders", "revenue", "top-products", "personalization"]

async function exportCsv(req, query = {}) {
  const dataset = DATASETS.includes(query.dataset) ? query.dataset : null
  if (!dataset) throw new HttpError(422, "VALIDATION_ERROR", "Chọn loại dữ liệu cần xuất")
  if (dataset === "revenue" && !canFinance(req)) throw new HttpError(403, "FORBIDDEN", "Chỉ người xem được doanh thu mới xuất được dữ liệu doanh thu")
  const range = r.resolveRange(query, new Date())
  const fin = canFinance(req)
  const file = (name) => `${name}-${range.from}-${range.to}.csv`

  if (dataset === "orders") {
    const docs = await col("orders").find(inRange(range.start, range.end)).sort({ createdAt: 1 }).toArray()
    const head = ["Mã đơn", "Ngày đặt", "Khách hàng", "Số sản phẩm", "Trạng thái đơn", "Thanh toán", "Cá nhân hóa", ...(fin ? ["Tổng tiền", "Đã thu", "Đã hoàn"] : [])]
    return {
      filename: file("don-hang"),
      body: r.toCsv([head, ...docs.map((o) => [
        o.code, r.ddMMyyyy(r.vnDay(o.createdAt)), o.customer?.fullName || "", o.items.reduce((n, it) => n + it.quantity, 0), st.ORDER_LABEL[o.orderStatus], st.statusLabel("paymentStatus", o.paymentStatus),
        o.hasPersonalizedItems ? "Có" : "Không", ...(fin ? [o.total, o.paidAmount || 0, o.refundedAmount || 0] : []),
      ])]),
    }
  }

  if (dataset === "revenue") {
    const kind = ["day", "product", "axis"].includes(query.kind) ? query.kind : "day"
    if (kind === "product") {
      const rows = await topProducts(req, range, 1000)
      return { filename: file("doanh-thu-san-pham"), body: r.toCsv([["Sản phẩm", "SKU", "Số lượng bán", "Doanh thu"], ...rows.map((x) => [x.name, x.sku, x.quantity, x.revenue])]) }
    }
    if (kind === "axis") {
      const { axes } = await axesAndCategories(req, range)
      return { filename: file("doanh-thu-truc"), body: r.toCsv([["Trục", "Số đơn", "Doanh thu", "Tỷ trọng (%)"], ...axes.map((x) => [x.label, x.orders, x.revenue, x.pct])]) }
    }
    const rows = await col("orders")
      .aggregate([
        { $match: inRange(range.start, range.end) },
        {
          $group: {
            _id: vnDayExpr,
            orders: { $sum: 1 },
            revenue: { $sum: { $cond: [{ $in: ["$orderStatus", DONE] }, { $subtract: ["$total", { $ifNull: ["$refundedAmount", 0] }] }, 0] } },
            collected: { $sum: { $ifNull: ["$paidAmount", 0] } },
            refunded: { $sum: { $ifNull: ["$refundedAmount", 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .toArray()
    return { filename: file("doanh-thu-theo-ngay"), body: r.toCsv([["Ngày", "Số đơn", "Doanh thu", "Tiền đã thu", "Tiền đã hoàn"], ...rows.map((x) => [r.ddMMyyyy(x._id), x.orders, x.revenue, x.collected, x.refunded])]) }
  }

  if (dataset === "top-products") {
    const rows = await topProducts(req, range, 50)
    return { filename: file("san-pham-ban-chay"), body: r.toCsv([["Hạng", "Sản phẩm", "SKU", "Đã bán", "Tồn kho", ...(fin ? ["Doanh thu"] : [])], ...rows.map((x, i) => [i + 1, x.name, x.sku, x.quantity, x.stock, ...(fin ? [x.revenue] : [])])]) }
  }

  // personalization: mỗi dòng sản phẩm có cá nhân hóa
  const docs = await col("orders").find({ ...inRange(range.start, range.end), hasPersonalizedItems: true }).sort({ createdAt: 1 }).toArray()
  const head = ["Mã đơn", "Ngày đặt", "Sản phẩm", "Số lượng", "Hình thức", "Nội dung", "Trạng thái đơn", ...(fin ? ["Phí cá nhân hóa"] : [])]
  const rows = docs.flatMap((o) => o.items.filter((it) => it.personalization).map((it) => [
    o.code, r.ddMMyyyy(r.vnDay(o.createdAt)), it.name, it.quantity, it.personalization.type === "IN_KHAC" ? "In/Khắc" : "Thiết kế",
    myOrders.personalizationText(it.personalization), st.ORDER_LABEL[o.orderStatus], ...(fin ? [(it.personalizationFeePerUnit || 0) * it.quantity] : []),
  ]))
  return { filename: file("ca-nhan-hoa"), body: r.toCsv([head, ...rows]) }
}

module.exports = { report, exportCsv, STATUS_ORDER }
