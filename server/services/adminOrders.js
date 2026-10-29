// Vận hành đơn phía quản trị (UC-OPS-01, OPS-03, OPS-04, OPS-05, OPS-06; 07_API_Spec.md API-90 đến API-96, API-103,
// API-158 đến API-160, API-194). Quy tắc thuần ở opsRules.js. Mọi lần đổi trạng thái là updateOne có điều kiện trạng thái
// hiện tại (UC-OPS-01 ghi chú kỹ thuật): khách vừa hủy thì nhân viên bấm xác nhận trên trang cũ nhận 409 (AC4).
const { database, ObjectId } = require("../config/db")
const params = require("../config/params")
const HttpError = require("../utils/httpError")
const v = require("../utils/validators")
const staffMentions = require("./staffMentions")
const { accentInsensitivePattern, escapeRegex } = require("../utils/vnText")
const rules = require("./opsRules")
const st = require("./orderState")
const ops = require("./orderOps")
const myOrders = require("./myOrders")
const { writeLog } = require("./adminLog")
const { vnDate, fmt } = require("./checkoutMath")
const voucherService = require("./voucher")
const orderChange = require("./orderChange")
const { gateway } = require("./paymentGateway")
const { ASKING_TAG } = orderChange
const { decodeDataUrl } = require("../controllers/file.controller")
const afterSales = require("./afterSalesCommon")

const orders = () => database.collection("orders")
const users = () => database.collection("users")
const products = () => database.collection("products")
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const PAGE_SIZE = 20

const { CARRIERS } = rules
const SOURCES = { WEBSITE: "Website", DIEN_THOAI: "Điện thoại", ZALO: "Zalo", FACEBOOK: "Facebook", EMAIL: "Email", KHAC: "Khác" }
// Thẻ thanh toán ở SCR-47, 48: ghi rõ trạng thái, không lẫn với phương thức
const PAYMENT_BADGE = { CHUA_THANH_TOAN: "Chưa thanh toán", DA_COC: "Đã cọc", DA_THANH_TOAN: "Đã thanh toán", HOAN_TIEN_MOT_PHAN: "Hoàn một phần", DA_HOAN_TIEN: "Đã hoàn tiền" }

const canOf = (req) => (code) => !!req.isFullAccess || req.permissions.has(code)
const text = (x, max) => (typeof x === "string" ? x.normalize("NFC").trim().slice(0, max) : "")
const charCount = (s) => Array.from(s).length
// Ngày dd/MM/yyyy giờ Việt Nam cho câu thông báo
const vnDay = (d) => vnDate(new Date(d)).split("-").reverse().join("/")
// "20:03 27/10/2026", cùng cách ghi với thẻ trên đơn, không có giây
const vnHourDay = (d) => `${new Date(d).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", hour12: false })} ${vnDay(d)}`
const initials = (name) => String(name || "?").trim().split(/\s+/).slice(-2).map((w) => w[0]).join("").toUpperCase()

async function loadOrder(code) {
  const o = await orders().findOne({ code: String(code || "").toUpperCase() })
  if (!o) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy đơn hàng")
  return orderChange.expireIfDue(o) // thay đổi chờ thanh toán quá hạn thì bỏ
}

function forbid(req, code, message = "Bạn không có quyền thực hiện thao tác này") {
  if (!canOf(req)(code)) throw new HttpError(403, "FORBIDDEN", message)
}

// Bỏ tặng voucher xin lỗi phải có lý do ≥ 5 ký tự (BR-30 6a)
function assertSkipReason(body) {
  const g = body.apologyVoucher
  if (g && g.skip && charCount(text(g.reason, 300)) < 5) {
    throw new HttpError(422, "VALIDATION_ERROR", "Nhập lý do không tặng voucher (ít nhất 5 ký tự)", { fields: { "apologyVoucher.reason": "Nhập lý do" } })
  }
}

// BR-48: ngoại lệ đặc biệt mà thiếu quyền thì báo gửi Quản trị duyệt (API-222)
function needApproval(req, special) {
  if (special && !canOf(req)(rules.SPECIAL)) {
    throw new HttpError(403, "NEED_APPROVAL", `${rules.SPECIAL_LABELS[special]} cần Quản trị duyệt. Bạn bấm "Gửi Quản trị duyệt" để gửi yêu cầu`, { special })
  }
}

// Lỗi từ checkTransition -> HttpError
function throwRule(err) {
  if (err) throw new HttpError(err.status, err.code, err.message)
}

const itemPreview = (it) => ({
  _id: String(it._id), name: it.name, variantName: it.variantName, image: it.image, quantity: it.quantity,
  personalizationText: myOrders.personalizationText(it.personalization), isPersonalized: !!it.isPersonalized, fulfillStatus: it.fulfillStatus,
})

// ===== API-90 danh sách =====

// Bộ lọc Mongo từ ô tìm và chip bộ lọc (UC-OPS-01 bước 3); tab nhanh (view) lọc sau khi tính ưu tiên
function buildFilter(q) {
  const f = {}
  const list = (x) => String(x || "").split(",").map((s) => s.trim()).filter(Boolean)
  if (list(q.orderStatus).length) f.orderStatus = { $in: list(q.orderStatus) }
  if (list(q.paymentStatus).length) f.paymentStatus = { $in: list(q.paymentStatus) }
  if (["COD", "ONLINE"].includes(q.paymentMethod)) f.paymentMethod = q.paymentMethod
  if (q.personalized === "true") f.hasPersonalizedItems = true
  if (q.personalized === "false") f.hasPersonalizedItems = { $ne: true }
  if (list(q.source).length) f.source = { $in: list(q.source) }
  if (list(q.carrier).length) f.carrier = { $in: list(q.carrier) }
  // Lọc đúng thẻ, không phân biệt hoa thường
  if (q.tag) f.tags = { $regex: `^${escapeRegex(String(q.tag).normalize("NFC").trim())}$`, $options: "i" }
  const range = {}
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.from || "")) range.$gte = new Date(`${q.from}T00:00:00+07:00`)
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.to || "")) range.$lt = new Date(new Date(`${q.to}T00:00:00+07:00`).getTime() + DAY)
  if (Object.keys(range).length) f.createdAt = range
  const s = String(q.q || "").trim()
  if (s) {
    const digits = s.replace(/[\s.]/g, "")
    f.$or = [
      { code: { $regex: s.toUpperCase().replace(/[^A-Z0-9]/g, "") || "^$" } },
      ...(/^\d{3,11}$/.test(digits) ? [{ "customer.phone": { $regex: digits } }] : []),
      { "customer.fullName": { $regex: accentInsensitivePattern(s), $options: "i" } },
      { tags: { $regex: accentInsensitivePattern(s), $options: "i" } }, // tìm theo thẻ, VD "uu tien sang"
    ]
  }
  return f
}

// Đọc kèm yêu cầu hoàn tiền mới nhất và bảo hành đang chờ để tính ưu tiên; BR-26 và BR-10 chạy trước khi đọc (Render có thể đang ngủ)
async function withPriority(docs, now) {
  const codes = docs.map((o) => o.code)
  const refundMap = await myOrders.latestRefunds(codes)
  const warrantyWaiting = new Set(await database.collection("warrantyRequests").distinct("orderCode", { orderCode: { $in: codes }, status: "DANG_XEM_XET" }))
  return docs.map((o) => ({ ...o, priority: rules.priority(o, { now, refund: refundMap.get(o.code) || null, warrantyPending: warrantyWaiting.has(o.code) }) }))
}

// Trường đủ cho rules.priority, VIEWS, storageGroup và các kiểu sắp xếp của API-90. statusHistory chỉ lấy lần đầu tới
// DANG_CHUAN_BI (reachedAt dùng cho hạn đóng gói)
const LIGHT_FIELDS = {
  code: 1, createdAt: 1, updatedAt: 1, orderStatus: 1, total: 1, tags: 1, returnStatus: 1, codDiscrepancy: 1,
  urgentCode: 1, expectedDeliveryDate: 1, deliveryExtendedAt: 1, personalizationStartedAt: 1, storageStatus: 1, storageDeadline: 1, "disposal.at": 1,
  "unfulfillable.status": 1, "unfulfillable.slaDeadline": 1, "unfulfillable.responseDeadline": 1, "pendingChange.expiresAt": 1,
  "unfulfillable.outcome": 1, "unfulfillable.apologyVoucher": 1, approvalPending: 1,
  statusHistory: { $elemMatch: { field: "orderStatus", to: "DANG_CHUAN_BI" } },
}

// Thay bản nhẹ bằng bản đủ cho các dòng của trang, giữ thứ tự và mức ưu tiên đã tính
async function withFullDocs(list) {
  if (!list.length) return list
  const full = await orders().find({ code: { $in: list.map((o) => o.code) } }).toArray()
  const byCode = new Map(full.map((o) => [o.code, o]))
  return list.map((o) => ({ ...byCode.get(o.code), priority: o.priority }))
}

function listRow(o, now) {
  const p = o.priority
  return {
    code: o.code,
    createdAt: o.createdAt,
    customer: { fullName: o.customer?.fullName, phone: o.customer?.phone },
    itemCount: o.items.reduce((n, it) => n + (it.fulfillStatus === "DA_HOAN_TIEN" ? 0 : it.quantity), 0),
    itemsPreview: o.items.map(itemPreview),
    total: o.total,
    paymentStatus: o.paymentStatus,
    paymentBadge: PAYMENT_BADGE[o.paymentStatus] || o.paymentStatus,
    paymentMethod: o.paymentMethod,
    urgentCode: o.urgentCode || null,
    orderStatus: o.orderStatus,
    orderStatusLabel: st.ORDER_LABEL[o.orderStatus],
    carrier: o.carrier ? CARRIERS[o.carrier] : null,
    tags: o.tags || [],
    hasPersonalizedItems: !!o.hasPersonalizedItems,
    source: o.source,
    createdBy: o.createdBy,
    priority: p.level,
    priorityReason: p.reason,
    slaDeadline: p.deadline,
    slaRemaining: rules.remainingText(p.deadline, now),
    noteCount: (o.internalNotes || []).length,
  }
}

// Dòng của SCR-51 Hàng lưu kho (view=storage)
function storageRow(o, now) {
  const personalized = o.items.filter((it) => it.isPersonalized && it.fulfillStatus !== "DA_HOAN_TIEN")
  const deadline = o.storageDeadline ? new Date(o.storageDeadline) : null
  const daysLeft = deadline ? Math.ceil((deadline - now) / DAY) : null
  return {
    code: o.code,
    storageCode: o.storageCode || null,
    storageShelf: o.storageShelf || null,
    storageStatus: o.storageStatus,
    group: o.storageStatus === "DA_TIEU_HUY" ? "da-tieu-huy" : rules.storageGroup(o, now),
    disposal: o.disposal ? { method: rules.DISPOSAL_METHODS[o.disposal.method] || o.disposal.method, at: o.disposal.at, by: o.disposal.byName || null } : null,
    storageReason: rules.storageReason(o),
    storedAt: o.storedAt || o.cancelledAt || null,
    storageDeadline: o.storageDeadline || null,
    daysLeft,
    customer: { fullName: o.customer?.fullName, phone: o.customer?.phone },
    userId: o.userId ? String(o.userId) : null,
    items: personalized.map(itemPreview),
    paidAmount: o.paidAmount || 0,
    priority: o.priority.level,
  }
}

// Tên người tiêu hủy cho nhóm Đã tiêu hủy (disposal.by là _id nhân viên)
async function withDisposerNames(list) {
  const ids = [...new Set(list.map((o) => o.disposal?.by).filter(Boolean).map(String))]
  if (!ids.length) return
  const staff = await database.collection("users").find({ _id: { $in: ids.map((id) => new ObjectId(id)) } }, { projection: { fullName: 1 } }).toArray()
  const names = new Map(staff.map((u) => [String(u._id), u.fullName]))
  for (const o of list) if (o.disposal?.by) o.disposal.byName = names.get(String(o.disposal.by)) || null
}

// Đơn có thể không ở mức Bình thường không hạn (đủ các nhánh của rules.priority). Đơn còn lại luôn Bình thường, không hạn
// nên không cần đọc về để tính: Atlas đếm và phân trang thẳng (bản miễn phí chuyển dữ liệu chậm, khoảng 100 KB/s)
async function activeCondition() {
  const [refundCodes, warrantyCodes] = await Promise.all([
    database.collection("refunds").distinct("orderCode", { status: { $in: ["CHO_XU_LY", "THAT_BAI"] } }),
    database.collection("warrantyRequests").distinct("orderCode", { status: "DANG_XEM_XET" }),
  ])
  return [
    { orderStatus: { $in: ["CHO_XAC_NHAN", "DANG_CA_NHAN_HOA", "DANG_CHUAN_BI"] } },
    { returnStatus: "DANG_YEU_CAU" },
    { codDiscrepancy: { $exists: true, $nin: [null, false] } },
    { storageStatus: { $in: ["DANG_LUU_KHO", "HET_HAN_LUU_KHO"] } },
    { code: { $in: [...refundCodes, ...warrantyCodes] } },
    { "unfulfillable.apologyVoucher.pending": true }, // khách hủy khi đang hỏi, chờ quyết định voucher
    { approvalPending: true }, // yêu cầu duyệt ngoại lệ đặc biệt
  ]
}

const NORMAL = { level: "BINH_THUONG", reason: null, deadline: null }
const byNewest = (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
const SORTS = {
  "moi-nhat": [{ createdAt: -1 }, byNewest],
  "cu-nhat": [{ createdAt: 1 }, (a, b) => new Date(a.createdAt) - new Date(b.createdAt)],
  "tong-giam": [{ total: -1, createdAt: -1 }, (a, b) => b.total - a.total || byNewest(a, b)],
}

// Trộn 2 danh sách đã sắp theo cùng thứ tự
function mergeSorted(a, b, cmp) {
  const out = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) out.push(j >= b.length || (i < a.length && cmp(a[i], b[j]) <= 0) ? a[i++] : b[j++])
  return out
}

async function list(req, query) {
  const now = new Date()
  await myOrders.autoComplete({}, now)
  const view = Object.prototype.hasOwnProperty.call(rules.VIEWS, query.view) ? query.view : "all"
  if (view === "storage") await ops.expireStorage(now)

  const filter = buildFilter(query)
  const active = await activeCondition()
  const passiveFilter = { $and: [filter, { $nor: active }] }
  const [activeDocs, groups, tags, monthCount] = await Promise.all([
    orders().find({ $and: [filter, { $or: active }] }, { projection: LIGHT_FIELDS }).toArray(),
    orders().aggregate([{ $match: passiveFilter }, { $group: { _id: "$orderStatus", n: { $sum: 1 } } }]).toArray(),
    orders().distinct("tags", filter),
    orders().countDocuments({ $and: [filter, { createdAt: { $gte: new Date(now.getTime() - 30 * DAY) } }] }),
  ])
  const rows = (await withPriority(activeDocs, now)).sort(rules.comparePriority)
  // Nhóm trạng thái của đơn còn lại thuộc tab nào: chỉ tùy orderStatus vì luôn Bình thường, không lưu kho
  const passiveIn = (k) => groups.filter((g) => rules.VIEWS[k]({ orderStatus: g._id, priority: NORMAL }))
  const sum = (gs) => gs.reduce((n, g) => n + g.n, 0)
  const counts = Object.fromEntries(Object.keys(rules.VIEWS).map((k) => [k, rows.filter(rules.VIEWS[k]).length + sum(passiveIn(k))]))
  let picked = rows.filter(rules.VIEWS[view])

  const page = Math.max(1, parseInt(query.page, 10) || 1)
  const start = (page - 1) * PAGE_SIZE
  let total = picked.length
  let storageCounts = null
  let slice
  if (view === "storage") {
    // Nhóm "Đã tiêu hủy" chỉ để tra cứu: không tính vào số của tab Hàng lưu kho
    const destroyedFilter = { $and: [filter, { storageStatus: "DA_TIEU_HUY" }] }
    storageCounts = { "dang-luu": 0, "sap-het-han": 0, "cho-tieu-huy": 0, "da-tieu-huy": await orders().countDocuments(destroyedFilter) }
    for (const o of picked) storageCounts[rules.storageGroup(o, now)] += 1
    if (query.storage === "da-tieu-huy") {
      total = storageCounts["da-tieu-huy"]
      const docs = await orders().find(destroyedFilter, { projection: LIGHT_FIELDS }).sort({ "disposal.at": -1 }).skip(start).limit(PAGE_SIZE).toArray()
      slice = await withFullDocs(await withPriority(docs, now))
      await withDisposerNames(slice)
    } else {
      if (storageCounts[query.storage] !== undefined) picked = picked.filter((o) => rules.storageGroup(o, now) === query.storage)
      total = picked.length
      // Chờ tiêu hủy, sắp hết hạn lên đầu, rồi theo hạn lưu
      picked.sort((a, b) => new Date(a.storageDeadline || 0) - new Date(b.storageDeadline || 0))
    }
  } else {
    // Mặc định theo ưu tiên: đơn có mức cao hơn hoặc có hạn đứng đầu, phần sau theo mới nhất (rules.comparePriority)
    const custom = SORTS[query.sort]
    const [spec, cmp] = custom || SORTS["moi-nhat"]
    const ranked = (o) => o.priority.level !== "BINH_THUONG" || !!o.priority.deadline
    const head = custom ? [] : picked.filter(ranked)
    const tail = custom ? [...picked].sort(cmp) : picked.filter((o) => !ranked(o))
    const statuses = passiveIn(view).map((g) => g._id)
    total += sum(passiveIn(view))
    const need = start + PAGE_SIZE - head.length
    const passive = need > 0 && statuses.length
      ? await orders().find({ $and: [passiveFilter, { orderStatus: { $in: statuses } }] }, { projection: { code: 1, createdAt: 1, total: 1 } }).sort(spec).limit(need).toArray()
      : []
    picked = [...head, ...mergeSorted(tail, passive.map((o) => ({ ...o, priority: NORMAL })), cmp)]
  }

  if (!slice) slice = await withFullDocs(picked.slice(start, start + PAGE_SIZE))
  return {
    view, counts, storageCounts, tags: tags.filter(Boolean).sort(),
    items: slice.map((o) => (view === "storage" ? storageRow(o, now) : listRow(o, now))),
    page, pageSize: PAGE_SIZE, total, monthCount,
  }
}

// ===== API-158 thanh phân tích =====

async function stats(query) {
  const days = query.days === "30" || query.days === 30 ? 30 : 7
  const now = new Date()
  const start = new Date(now.getTime() - days * DAY)
  const prevStart = new Date(start.getTime() - days * DAY)
  const docs = await orders()
    .find({ $or: [{ createdAt: { $gte: prevStart } }, { updatedAt: { $gte: prevStart } }] }, { projection: { createdAt: 1, items: 1, statusHistory: 1, deliveredAt: 1 } })
    .toArray()
  const returnsIn = async (a, b) => database.collection("returnRequests").countDocuments({ createdAt: { $gte: a, $lt: b } })

  const firstAt = (o, statuses) => {
    const h = (o.statusHistory || []).find((x) => x.field === "orderStatus" && statuses.includes(x.to))
    return h ? new Date(h.at) : null
  }
  function measure(a, b) {
    const inWin = (d) => d && d >= a && d < b
    const created = docs.filter((o) => inWin(new Date(o.createdAt)))
    const shipped = docs.map((o) => ({ o, at: firstAt(o, ["DANG_VAN_CHUYEN"]) })).filter((x) => inWin(x.at))
    // Bỏ khoảng âm (dữ liệu thử sửa tay) để không làm lệch trung bình
    const hours = shipped.map((x) => (x.at - new Date(x.o.createdAt)) / HOUR).filter((h) => h >= 0)
    return {
      orders: created.length,
      items: created.reduce((n, o) => n + o.items.reduce((m, it) => m + it.quantity, 0), 0),
      processed: docs.filter((o) => inWin(firstAt(o, ["DANG_CA_NHAN_HOA", "DANG_CHUAN_BI"]))).length,
      delivered: docs.filter((o) => inWin(o.deliveredAt ? new Date(o.deliveredAt) : null)).length,
      avgHours: hours.length ? Math.round((hours.reduce((s, h) => s + h, 0) / hours.length) * 10) / 10 : 0,
    }
  }
  const cur = { ...measure(start, now), returns: await returnsIn(start, now) }
  const prev = { ...measure(prevStart, start), returns: await returnsIn(prevStart, start) }

  // Chuỗi theo ngày cho đường xu hướng nhỏ
  const series = (key) => Array.from({ length: days }, (_, i) => {
    const a = new Date(start.getTime() + i * DAY)
    return key === "returns" ? 0 : measure(a, new Date(a.getTime() + DAY))[key]
  })
  const metric = (key, label, unit = "") => {
    const change = key === "avgHours" ? Math.round((cur[key] - prev[key]) * 10) / 10 : prev[key] ? Math.round(((cur[key] - prev[key]) / prev[key]) * 1000) / 10 : null
    return { key, label, value: cur[key], previous: prev[key], change, unit, series: series(key) }
  }
  return {
    days,
    metrics: [
      metric("orders", "Tổng đơn"),
      metric("items", "Sản phẩm đã đặt"),
      metric("returns", "Đổi trả"),
      metric("processed", "Đơn đã xử lý"),
      metric("delivered", "Đơn đã giao"),
      metric("avgHours", "Thời gian xử lý TB", "giờ"),
    ],
  }
}

// ===== API-91 chi tiết =====

// Dòng thời gian "Lịch sử" (SCR-48): gộp statusHistory, internalNotes, adminLogs của đơn, mới nhất trước
async function activity(o) {
  const logs = await database.collection("adminLogs").find({ targetType: "orders", targetId: o._id }).sort({ createdAt: -1 }).limit(100).toArray()
  const ids = new Set()
  for (const h of o.statusHistory || []) if (h.by && h.byRole === "NHAN_VIEN") ids.add(String(h.by))
  for (const n of o.internalNotes || []) if (n.by) ids.add(String(n.by))
  for (const n of o.internalNotes || []) for (const m of n.mentions || []) ids.add(String(m))
  for (const l of logs) if (l.adminId) ids.add(String(l.adminId))
  const names = new Map(
    (await users().find({ _id: { $in: [...ids].map((x) => new ObjectId(x)) } }, { projection: { fullName: 1 } }).toArray()).map((u) => [String(u._id), u.fullName]),
  )
  const actor = (id, role) => {
    if (role === "HE_THONG" || (!id && role !== "KHACH")) return { name: "Hệ thống", initials: "HT", kind: "system" }
    if (role === "KHACH") return { name: "Khách hàng", initials: "KH", kind: "customer" }
    const name = names.get(String(id)) || "Nhân viên"
    return { name, initials: initials(name), kind: "staff" }
  }
  const out = []
  for (const h of o.statusHistory || []) {
    const label = st.statusLabel
    out.push({
      at: h.at, kind: "status", actor: actor(h.by, h.byRole),
      text: h.from ? `đổi trạng thái ${label(h.field, h.from)} → ${label(h.field, h.to)}` : h.field === "orderStatus" ? `đơn được tạo (${label(h.field, h.to)})` : label(h.field, h.to),
      detail: h.note || null, attachments: [],
    })
  }
  for (const n of o.internalNotes || []) {
    const mentioned = (n.mentions || []).map((m) => names.get(String(m))).filter(Boolean)
    out.push({ at: n.at, kind: "note", actor: actor(n.by, "NHAN_VIEN"), text: "thêm ghi chú nội bộ", detail: n.text, attachments: n.attachments || [], mentions: mentioned })
  }
  for (const l of logs) {
    if (["ORDER_STATUS", "ORDER_NOTE", "ORDER_COD"].includes(l.action)) continue
    out.push({ at: l.createdAt, kind: "log", actor: actor(l.adminId, l.adminId ? "NHAN_VIEN" : "HE_THONG"), text: l.after?.summary || l.action, detail: l.reason || null, attachments: [] })
  }
  return out.sort((a, b) => new Date(b.at) - new Date(a.at))
}

async function afterSalesOf(o) {
  const [rets, wars] = await Promise.all([
    database.collection("returnRequests").find({ orderId: o._id, status: { $ne: "DA_HUY" } }, { projection: { code: 1, status: 1, createdAt: 1 } }).toArray(),
    database.collection("warrantyRequests").find({ orderId: o._id }, { projection: { code: 1, status: 1, createdAt: 1 } }).toArray(),
  ])
  const { RETURN_STATUS, WARRANTY_STATUS } = require("./afterSalesRules")
  return [
    ...rets.map((x) => ({ kind: "returns", _id: String(x._id), code: x.code, status: x.status, statusLabel: RETURN_STATUS[x.status], createdAt: x.createdAt })),
    ...wars.map((x) => ({ kind: "warranty", _id: String(x._id), code: x.code, status: x.status, statusLabel: WARRANTY_STATUS[x.status], createdAt: x.createdAt })),
  ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
}

async function detail(req, code) {
  const now = new Date()
  await myOrders.autoComplete({ code: String(code).toUpperCase() }, now)
  const o = await loadOrder(code)
  const can = canOf(req)
  const [withP] = await withPriority([o], now)
  const refundList = await database.collection("refunds").find({ orderCode: o.code }).sort({ createdAt: -1 }).toArray()

  // Tồn còn lại từng dòng và vật liệu gói quà cho kiểm tra tự động (bước 6a)
  const ids = [...new Set(o.items.map((it) => String(it.productId)))].map((x) => new ObjectId(x))
  const prods = await products().find({ _id: { $in: ids } }, { projection: { slug: 1, variants: 1 } }).toArray()
  const stockOf = new Map()
  const slugOf = new Map()
  for (const p of prods) {
    slugOf.set(String(p._id), p.slug)
    for (const vr of p.variants || []) stockOf.set(`${p._id}|${vr.sku}`, vr.stock || 0)
  }
  const matCodes = o.giftWrap ? ["paper", "ribbon", "card"].map((k) => o.giftWrap[k]?.code).filter(Boolean) : []
  const mats = await database.collection("giftWrapMaterials").find({ code: { $in: matCodes } }, { projection: { code: 1, stock: 1, image: 1 } }).toArray()
  const materialStock = new Map(mats.map((m) => [m.code, m.stock || 0]))
  // Ảnh vật liệu để nhân viên đóng gói nhìn đúng mẫu
  const matImage = new Map(mats.map((m) => [m.code, m.image || null]))
  const withImage = (x) => (x ? { ...x, image: matImage.get(x.code) || null } : null)

  const owner = await users().findOne({ _id: o.userId }, { projection: { fullName: 1, status: 1, createdAt: 1, activatedAt: 1 } })
  const spent = await orders()
    .aggregate([{ $match: { userId: o.userId } }, { $group: { _id: null, n: { $sum: { $cond: [{ $eq: ["$orderStatus", "DA_HUY"] }, 0, 1] } }, total: { $sum: { $cond: [{ $eq: ["$orderStatus", "DA_HUY"] }, 0, "$total"] } }, first: { $min: "$createdAt" } } }])
    .toArray()
  const pays = await database.collection("payments").find({ orderCode: o.code, status: { $in: ["SUCCESS", "REFUNDED"] } }, { projection: { code: 1, amount: 1, paidAt: 1, purpose: 1, status: 1 } }).toArray()

  return {
    code: o.code,
    createdAt: o.createdAt,
    source: o.source,
    sourceLabel: SOURCES[o.source] || o.source,
    createdBy: o.createdBy,
    draftCode: o.draftCode || null,
    customer: o.customer,
    customerUser: owner ? { _id: String(owner._id), status: owner.status, ...st.membership(owner, spent[0]?.first), orderCount: spent[0]?.n || 0, totalSpent: spent[0]?.total || 0 } : null,
    items: o.items.map((it) => ({
      ...itemPreview(it), productId: String(it.productId), slug: slugOf.get(String(it.productId)) || null, sku: it.sku, variantSku: it.variantSku,
      unitPrice: it.unitPrice, lineValue: it.lineValue, personalization: it.personalization, personalizationFeePerUnit: it.personalizationFeePerUnit,
      stock: stockOf.get(`${it.productId}|${it.variantSku}`) ?? null, unfulfillable: it.unfulfillable || null, substitute: it.substitute || null,
    })),
    hasPersonalizedItems: !!o.hasPersonalizedItems,
    giftWrap: o.giftWrap ? { ...o.giftWrap, paper: withImage(o.giftWrap.paper), ribbon: withImage(o.giftWrap.ribbon), card: withImage(o.giftWrap.card) } : null,
    recipientType: o.recipientType,
    shippingAddress: o.shippingAddress,
    noteForShop: o.noteForShop || "",
    subtotal: o.subtotal, personalizationFee: o.personalizationFee, giftWrapFee: o.giftWrapFee, shippingFee: o.shippingFee, urgentFee: o.urgentFee || 0, urgentCode: o.urgentCode || null,
    discount: o.discount, vouchers: (o.vouchers || []).map(({ code: c, type, discount }) => ({ code: c, type, discount })),
    total: o.total, depositAmount: o.depositAmount, remainingAmount: o.remainingAmount, paidAmount: o.paidAmount || 0, refundedAmount: o.refundedAmount || 0,
    codDue: rules.codDue(o), codPaid: rules.codPaid(o), paymentMethod: o.paymentMethod, remainingMethod: o.remainingMethod,
    payments: pays.map((p) => ({ code: p.code, amount: p.amount, paidAt: p.paidAt, purpose: p.purpose, status: p.status })),
    orderStatus: o.orderStatus, orderStatusLabel: st.ORDER_LABEL[o.orderStatus],
    paymentStatus: o.paymentStatus, paymentBadge: PAYMENT_BADGE[o.paymentStatus],
    returnStatus: o.returnStatus || "KHONG_CO",
    priority: withP.priority.level, priorityReason: withP.priority.reason, slaDeadline: withP.priority.deadline, slaRemaining: rules.remainingText(withP.priority.deadline, now),
    timeline: st.timeline(o),
    carrier: o.carrier || null, carrierLabel: o.carrier ? CARRIERS[o.carrier] : null, trackingCode: o.trackingCode || null,
    deliveredAt: o.deliveredAt || null, codCollectedAt: o.codCollectedAt || null, codDiscrepancy: o.codDiscrepancy || null,
    expectedDeliveryDate: o.expectedDeliveryDate || null, deliveryExtended: !!o.deliveryExtendedAt, packingSlipPrintedAt: o.packingSlipPrintedAt || null,
    cancelledAt: o.cancelledAt || null, cancelBy: o.cancelBy || null, cancelCase: o.cancelCase || null,
    cancelReason: o.cancelReason ? st.cancelLabel(o.cancelReason) : null, cancelDetail: o.cancelDetail || null,
    refusalReason: o.refusalReason ? rules.REFUSAL_REASONS[o.refusalReason] : null, refusedShippingFee: o.refusedShippingFee || 0, refusalNote: o.refusalNote || null,
    storageStatus: o.storageStatus || null, storageDeadline: o.storageDeadline || null, storageCode: o.storageCode || null, storageShelf: o.storageShelf || null, disposal: o.disposal || null,
    // Đang hỏi khách (món, hạn, quá hạn) và thay đổi chờ khách trả thêm (mã QR, liên kết, nút xác nhận với cổng giả lập)
    unfulfillable: o.unfulfillable
      ? {
          ...o.unfulfillable, itemIds: (o.unfulfillable.itemIds || []).map(String),
          itemNames: o.items.filter((it) => (o.unfulfillable.itemIds || []).map(String).includes(String(it._id))).map((it) => it.name),
          overdue: o.unfulfillable.status === "DANG_HOI_KHACH" && !!o.unfulfillable.responseDeadline && new Date(o.unfulfillable.responseDeadline) <= now,
        }
      : null,
    pendingChange: o.pendingChange
      ? { ...o.pendingChange, paymentId: String(o.pendingChange.paymentId), createdBy: undefined, input: undefined, canConfirm: gateway.provider === "MOCK" }
      : null,
    approvalRequest: o.approvalPending ? await pendingApprovalView(o, can) : null,
    personalizationStartedAt: o.personalizationStartedAt || null, // để giao diện biết hủy đơn có cần duyệt không (BR-48)
    version: st.orderVersion(o, { staff: true }), // so với API-230 để tự tải lại
    lastExpiredChange: o.lastExpiredChange && o.orderStatus === "CHO_XAC_NHAN" ? { summary: o.lastExpiredChange.summary, amount: o.lastExpiredChange.amount, expiredAt: o.lastExpiredChange.expiredAt } : null,
    refunds: refundList.map((r) => ({ _id: String(r._id), reason: r.reason, amount: r.amount, status: r.status, method: r.method, voucherCode: r.voucherCode || null, hasAccount: !!r.bankInfo, createdAt: r.createdAt })),
    // Yêu cầu đổi trả, bảo hành của đơn để mở trang chi tiết yêu cầu (SCR-50, S9); đơn thay thế 0đ liên kết đơn gốc
    afterSales: await afterSalesOf(o),
    sourceOrderCode: o.sourceOrderCode || null,
    replacementFor: o.replacementFor ? { kind: o.replacementFor.kind, requestId: String(o.replacementFor.requestId), requestCode: o.replacementFor.requestCode } : null,
    tags: o.tags || [],
    adminActions: rules.adminActions(o, can),
    exceptionTypes: rules.exceptionTypes(o, can),
    refundable: rules.refundable(o),
    confirmChecks: o.orderStatus === "CHO_XAC_NHAN" ? rules.confirmChecks(o, { stockOf, materialStock }) : [],
    requiredChecks: o.orderStatus === "CHO_XAC_NHAN" ? rules.requiredChecks(o) : [],
    activity: await activity(o),
  }
}

// ===== API-92 đổi trạng thái =====

const STATUS_NOTICE = {
  DANG_CA_NHAN_HOA: (o) => ({ title: `Đơn ${o.code} đã được xác nhận`, body: "Soulprint đang cá nhân hóa sản phẩm của bạn. Từ bước này đơn không thể hủy." }),
  DANG_CHUAN_BI: (o, from) => ({ title: from === "DANG_CA_NHAN_HOA" ? `Đơn ${o.code} đã cá nhân hóa xong` : `Đơn ${o.code} đã được xác nhận`, body: "Soulprint đang đóng gói đơn hàng của bạn." }),
  DANG_VAN_CHUYEN: (o, from, set) => ({ title: `Đơn ${o.code} đang được giao`, body: `Đơn vị vận chuyển ${CARRIERS[set.carrier]}, mã vận đơn ${set.trackingCode}.` }),
  DA_GIAO: (o) => ({ title: `Đơn ${o.code} đã giao thành công`, body: "Cảm ơn bạn đã mua sắm tại Soulprint. Bấm \"Đã nhận hàng\" nếu bạn đã nhận đủ sản phẩm." }),
}

// Ngày giao nhập ở hộp thoại "Ghi nhận giao thành công": không sau hiện tại, không trước lúc giao cho vận chuyển
function readDeliveredAt(o, value, now) {
  if (value === undefined || value === null || value === "") return now
  const d = new Date(value)
  const shippedAt = rules.reachedAt(o, "DANG_VAN_CHUYEN")
  if (isNaN(d)) throw new HttpError(422, "VALIDATION_ERROR", "Ngày giao không hợp lệ", { fields: { deliveredAt: "Ngày giao không hợp lệ" } })
  if (d.getTime() > now.getTime() + 60 * 1000) throw new HttpError(422, "VALIDATION_ERROR", "Ngày giao không được sau thời điểm hiện tại", { fields: { deliveredAt: "Không được sau hiện tại" } })
  // Ô ngày giao chỉ tới phút: cùng phút với lúc giao vận chuyển thì lấy đúng lúc giao vận chuyển, không báo lỗi
  if (shippedAt && d.getTime() < Math.floor(shippedAt.getTime() / 60000) * 60000) throw new HttpError(422, "VALIDATION_ERROR", "Ngày giao không được trước lúc giao cho vận chuyển", { fields: { deliveredAt: "Trước lúc giao cho vận chuyển" } })
  return shippedAt && d < shippedAt ? new Date(shippedAt) : d
}

async function changeStatus(req, code, body) {
  const o = await loadOrder(code)
  const to = String(body.to || "")
  throwRule(rules.checkTransition(o, to, canOf(req)))
  const now = new Date()
  const set = { orderStatus: to, updatedAt: now }
  const push = [ops.historyEntry("orderStatus", o.orderStatus, to, { by: req.user._id, at: now })]

  if (o.orderStatus === "CHO_XAC_NHAN") {
    // 6a kiểm tra tự động + 6b ô tick bắt buộc (AC6, 422 khi thiếu)
    const ticked = Array.isArray(body.checks) ? body.checks : []
    const missing = rules.requiredChecks(o).filter((k) => !ticked.includes(k))
    if (missing.length) throw new HttpError(422, "CHECKS_REQUIRED", "Vui lòng tick đủ các mục kiểm tra trước khi xác nhận", { missing })
    const d = await detail(req, o.code)
    const failed = d.confirmChecks.filter((c) => !c.ok)
    if (failed.length) throw new HttpError(422, "CHECKS_FAILED", failed[0].label, { failed })
    if (to === "DANG_CA_NHAN_HOA") set.personalizationStartedAt = o.personalizationStartedAt || now
  }
  if (to === "DANG_VAN_CHUYEN") {
    const carrier = String(body.carrier || "")
    const trackingCode = String(body.trackingCode || "").trim().toUpperCase()
    const fields = {}
    if (!CARRIERS[carrier]) fields.carrier = "Chọn đơn vị vận chuyển"
    if (!/^[A-Z0-9-]{4,40}$/.test(trackingCode)) fields.trackingCode = "Nhập mã vận đơn (4-40 chữ, số)"
    // 8Ea: thiếu mã vận đơn hoặc ĐVVC thì không cho chuyển
    if (Object.keys(fields).length) throw new HttpError(422, "VALIDATION_ERROR", "Nhập đơn vị vận chuyển và mã vận đơn", { fields })
    Object.assign(set, { carrier, trackingCode })
  }
  let codNote = null
  if (to === "DA_GIAO") {
    set.deliveredAt = readDeliveredAt(o, body.deliveredAt, now)
    const due = rules.codDue(o)
    if (due > 0) {
      const collected = Number(body.codCollected)
      if (!Number.isInteger(collected) || collected < 0) throw new HttpError(422, "VALIDATION_ERROR", "Nhập số tiền COD đã thu", { fields: { codCollected: "Nhập số tiền đã thu" } })
      if (collected === due) {
        // 9a: khớp số phải thu
        Object.assign(set, { paidAmount: o.total, paymentStatus: "DA_THANH_TOAN", remainingAmount: 0, codCollectedAt: set.deliveredAt, codCollectedAmount: collected })
        push.push(ops.historyEntry("paymentStatus", o.paymentStatus, "DA_THANH_TOAN", { by: req.user._id, at: now, note: `Thu COD ${fmt(collected)}` }))
      } else {
        // 9Ea: bắt buộc lý do, đơn vẫn Đã giao, giữ paymentStatus, gắn Khẩn cấp "COD lệch tiền"
        const reason = text(body.codDiscrepancyReason, 300)
        if (charCount(reason) < 5) {
          throw new HttpError(422, "COD_MISMATCH", `Số tiền lệch ${fmt(collected - due)} so với số cần thu, vui lòng nhập lý do chênh lệch`, { fields: { codDiscrepancyReason: "Nhập lý do chênh lệch" }, due })
        }
        set.codDiscrepancy = { expected: due, collected, reason, at: now, by: req.user._id }
        codNote = `COD lệch ${fmt(collected - due)}: ${reason}`
      }
    }
  }
  if (codNote) push[0].note = codNote

  const r = await orders().updateOne({ _id: o._id, orderStatus: o.orderStatus }, { $set: set, $push: { statusHistory: { $each: push } } })
  if (!r.modifiedCount) throw new HttpError(409, "INVALID_TRANSITION", "Trạng thái đơn đã thay đổi, vui lòng tải lại")
  await writeLog({ adminId: req.user._id, action: "ORDER_STATUS", targetType: "orders", targetId: o._id, before: { orderStatus: o.orderStatus }, after: { orderStatus: to, summary: `đổi trạng thái sang ${st.ORDER_LABEL[to]}` } })
  const notice = STATUS_NOTICE[to](o, o.orderStatus, set)
  await ops.notifyOwner(o, notice)
  // Đơn thay thế 0đ được giao: yêu cầu đổi trả/bảo hành gốc hoàn tất (UC-OPS-07 3c, 1a - S9)
  if (to === "DA_GIAO" && o.replacementFor) await afterSales.completeByReplacement(o, now)
  return detail(req, o.code)
}

// ===== API-93 nhập lại COD sau đối soát (9b) =====

async function reconcileCod(req, code, body) {
  const o = await loadOrder(code)
  if (!o.codDiscrepancy || !["DA_GIAO", "HOAN_THANH"].includes(o.orderStatus)) throw new HttpError(409, "NO_COD_PENDING", "Đơn không có khoản COD chờ đối soát")
  const collected = Number(body.collectedAmount)
  if (!Number.isInteger(collected) || collected < 0) throw new HttpError(422, "VALIDATION_ERROR", "Nhập số tiền đã thu", { fields: { collectedAmount: "Nhập số tiền đã thu" } })
  const due = rules.codDue(o)
  const now = new Date()
  if (collected !== due) {
    await orders().updateOne({ _id: o._id }, { $set: { "codDiscrepancy.collected": collected, "codDiscrepancy.at": now, updatedAt: now } })
    throw new HttpError(422, "COD_MISMATCH", `Số tiền vẫn lệch ${fmt(collected - due)} so với số cần thu ${fmt(due)}`, { due })
  }
  const r = await orders().updateOne(
    { _id: o._id, codDiscrepancy: { $exists: true } },
    {
      $set: { paidAmount: o.total, paymentStatus: "DA_THANH_TOAN", remainingAmount: 0, codCollectedAt: now, codCollectedAmount: collected, updatedAt: now },
      $unset: { codDiscrepancy: "" },
      $push: { statusHistory: ops.historyEntry("paymentStatus", o.paymentStatus, "DA_THANH_TOAN", { by: req.user._id, at: now, note: `Đối soát xong, thu COD ${fmt(collected)}` }) },
    },
  )
  if (!r.modifiedCount) throw new HttpError(409, "NO_COD_PENDING", "Đơn không có khoản COD chờ đối soát")
  await writeLog({ adminId: req.user._id, action: "ORDER_COD", targetType: "orders", targetId: o._id, before: o.codDiscrepancy, after: { collected, summary: `đối soát COD xong, đã thu ${fmt(collected)}` } })
  return detail(req, o.code)
}

// ===== API-160 ghi chú nội bộ =====

async function addNote(req, code, body) {
  const o = await loadOrder(code)
  const note = text(body.text, 1000)
  if (!note) throw new HttpError(422, "VALIDATION_ERROR", "Nhập nội dung ghi chú (1-1000 ký tự)", { fields: { text: "Nhập nội dung ghi chú" } })
  if (charCount(String(body.text || "").trim()) > 1000) throw new HttpError(422, "VALIDATION_ERROR", "Ghi chú tối đa 1000 ký tự", { fields: { text: "Tối đa 1000 ký tự" } })
  const files = Array.isArray(body.files) ? body.files : []
  if (files.length > 3) throw new HttpError(422, "VALIDATION_ERROR", "Đính kèm tối đa 3 tệp")
  const tagged = await staffMentions.readMentions(req, body.mentions) // @nhân viên
  const now = new Date()
  const decoded = files.map((f, i) => {
    const name = String(f?.name || `tep-${i + 1}`).slice(0, 120)
    const d = decodeDataUrl(f?.dataUrl, name)
    if (d.mimeType === "image/webp") throw new HttpError(422, "VALIDATION_ERROR", `${name}: chỉ nhận ảnh JPG, PNG hoặc PDF`)
    return { ...d, name, visibility: "RIENG_TU", ownerType: "orders", ownerId: o._id, uploadedBy: req.user._id, createdAt: now }
  })
  const attachments = []
  if (decoded.length) {
    const r = await database.collection("files").insertMany(decoded)
    decoded.forEach((d, i) => attachments.push({ fileId: r.insertedIds[i], url: `/api/files/${r.insertedIds[i]}`, name: d.name, size: d.size, mimeType: d.mimeType }))
  }
  const entry = { _id: new ObjectId(), at: now, by: req.user._id, text: note, attachments, mentions: tagged.map((u) => u._id) }
  await orders().updateOne({ _id: o._id }, { $push: { internalNotes: entry }, $set: { updatedAt: now } })
  await staffMentions.record(req, { order: o, noteId: entry._id, text: note, staff: tagged, now })
  await writeLog({ adminId: req.user._id, action: "ORDER_NOTE", targetType: "orders", targetId: o._id, after: { summary: "thêm ghi chú nội bộ" } })
  return { at: now, kind: "note", actor: { name: req.user.fullName, initials: initials(req.user.fullName), kind: "staff" }, text: "thêm ghi chú nội bộ", detail: note, attachments, mentions: tagged.map((u) => u.fullName) }
}

// ===== API-159 thao tác hàng loạt =====

function slipOf(o) {
  return {
    code: o.code, createdAt: o.createdAt, customer: o.customer, recipientType: o.recipientType, shippingAddress: o.shippingAddress,
    noteForShop: o.noteForShop || "", giftWrap: o.giftWrap, carrier: o.carrier ? CARRIERS[o.carrier] : null, trackingCode: o.trackingCode || null,
    codDue: rules.codDue(o), total: o.total,
    items: o.items.filter((it) => it.fulfillStatus !== "DA_HOAN_TIEN").map((it) => ({
      name: it.fulfillStatus === "DA_THAY_THE" && it.substitute ? it.substitute.name : it.name,
      variantName: it.fulfillStatus === "DA_THAY_THE" && it.substitute ? it.substitute.variantName : it.variantName,
      sku: it.variantSku, quantity: it.quantity, personalizationText: myOrders.personalizationText(it.personalization), personalization: it.personalization,
    })),
  }
}

const csvCell = (x) => {
  const s = x === null || x === undefined ? "" : String(x)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const csv = (rows) => "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\n")

function ordersCsv(list) {
  const head = ["Mã đơn", "Ngày đặt", "Khách hàng", "SĐT", "Số sản phẩm", "Tổng tiền", "Thanh toán", "Trạng thái", "ĐVVC", "Mã vận đơn", "Thẻ", "Nguồn"]
  return csv([head, ...list.map((o) => [
    o.code, vnDate(new Date(o.createdAt)), o.customer?.fullName, o.customer?.phone, o.items.reduce((n, it) => n + it.quantity, 0), o.total,
    PAYMENT_BADGE[o.paymentStatus], st.ORDER_LABEL[o.orderStatus], o.carrier ? CARRIERS[o.carrier] : "", o.trackingCode || "", (o.tags || []).join("; "), SOURCES[o.source] || o.source,
  ])])
}

function storageCsv(list, now) {
  const head = ["Mã lưu", "Vị trí kệ", "Mã đơn", "Sản phẩm", "Nội dung In/Khắc", "Lý do", "Ngày nhập kho", "Hạn lưu", "Trạng thái"]
  const groupLabel = { "dang-luu": "Đang lưu", "sap-het-han": "Sắp hết hạn", "cho-tieu-huy": "Chờ tiêu hủy" }
  return csv([head, ...list.map((o) => {
    const ps = o.items.filter((it) => it.isPersonalized)
    return [o.storageCode || "", o.storageShelf || "", o.code, ps.map((it) => it.name).join("; "), ps.map((it) => myOrders.personalizationText(it.personalization)).join("; "),
      rules.storageReason(o), o.storedAt ? vnDate(new Date(o.storedAt)) : "", o.storageDeadline ? vnDate(new Date(o.storageDeadline)) : "", (o.storageStatus === "DA_TIEU_HUY" ? "Đã tiêu hủy" : groupLabel[rules.storageGroup(o, now)]) || o.storageStatus]
  })])
}

async function bulk(req, body) {
  const codes = [...new Set((Array.isArray(body.codes) ? body.codes : []).map((c) => String(c).toUpperCase()))]
  if (!codes.length || codes.length > 100) throw new HttpError(422, "VALIDATION_ERROR", "Chọn từ 1 đến 100 đơn")
  const action = String(body.action || "")
  const list = await orders().find({ code: { $in: codes } }).toArray()
  const failed = codes.filter((c) => !list.some((o) => o.code === c)).map((c) => ({ code: c, reason: "Không tìm thấy đơn" }))
  const now = new Date()

  if (action === "ADD_TAGS" || action === "REMOVE_TAGS") {
    forbid(req, "DON_HANG.XEM")
    const tags = rules.normalizeTags(body.tags)
    if (!tags.length) throw new HttpError(422, "VALIDATION_ERROR", "Nhập thẻ (1-30 ký tự)", { fields: { tags: "Nhập thẻ" } })
    let updated = 0
    for (const o of list) {
      const next = action === "ADD_TAGS" ? rules.normalizeTags([...(o.tags || []), ...tags]) : (o.tags || []).filter((t) => !tags.some((x) => x.toLowerCase() === t.toLowerCase()))
      if (next.length > 10) {
        failed.push({ code: o.code, reason: "Đơn đã đủ 10 thẻ" })
        continue
      }
      await orders().updateOne({ _id: o._id }, { $set: { tags: next, updatedAt: now } })
      updated += 1
    }
    await writeLog({ adminId: req.user._id, action: "BULK_ACTION", targetType: "orders", reason: null, after: { action, tags, targetIds: list.map((o) => o.code), failed } })
    return { updated, failed }
  }
  if (action === "PRINT_PACKING_SLIP") {
    forbid(req, "DON_HANG.IN_PHIEU")
    const ok = list.filter((o) => o.orderStatus !== "DA_HUY")
    for (const o of list) if (o.orderStatus === "DA_HUY") failed.push({ code: o.code, reason: "Đơn đã hủy" })
    await orders().updateMany({ _id: { $in: ok.map((o) => o._id) } }, { $set: { packingSlipPrintedAt: now } })
    for (const o of ok) await writeLog({ adminId: req.user._id, action: "ORDER_PRINT", targetType: "orders", targetId: o._id, after: { summary: "in phiếu đóng gói" } })
    return { updated: ok.length, failed, slips: ok.sort((a, b) => codes.indexOf(a.code) - codes.indexOf(b.code)).map(slipOf) }
  }
  if (action === "EXPORT_CSV") {
    forbid(req, body.kind === "storage" ? "HANG_LUU_KHO.XEM" : "DON_HANG.XEM")
    const sorted = list.sort((a, b) => codes.indexOf(a.code) - codes.indexOf(b.code))
    return { csv: body.kind === "storage" ? storageCsv(sorted, now) : ordersCsv(sorted) }
  }
  throw new HttpError(400, "VALIDATION_ERROR", "Thao tác không hợp lệ")
}

// Sửa thẻ của 1 đơn ở khối Thẻ (5d) - dùng lại API-159 với 1 mã đơn
async function setTags(req, code, body) {
  const o = await loadOrder(code)
  const tags = rules.normalizeTags(body.tags)
  if ((Array.isArray(body.tags) ? body.tags.length : 0) > 10 || tags.length > 10) throw new HttpError(422, "VALIDATION_ERROR", "Tối đa 10 thẻ, mỗi thẻ 1-30 ký tự")
  await orders().updateOne({ _id: o._id }, { $set: { tags, updatedAt: new Date() } })
  return { tags }
}

// ===== API-94 không thể thực hiện (UC-OPS-06) =====
// ASK: đánh dấu món không làm được, báo khách, đơn "Đang hỏi khách"; CANCEL: hủy toàn đơn, hoàn 100% đã trả, voucher xin lỗi;
// CLEAR: gỡ đánh dấu; APOLOGY: khách đã tự hủy khi đang hỏi, nhân viên chọn gửi hay không gửi voucher xin lỗi. Khách đồng ý đổi thì nhân viên dùng Đổi sản phẩm (API-96), đổi xong tự gỡ dòng đó.

// Voucher xin lỗi mặc định (BR-30): tạo khi chưa có để không cần chạy script trên CSDL đang dùng
async function apologyVoucher(now = new Date()) {
  const vouchers = database.collection("vouchers")
  const code = params.APOLOGY_VOUCHER_CODE
  const found = await vouchers.findOne({ code })
  if (found) return found
  const doc = {
    code, name: "Quà tặng 10% từ Soulprint", description: "Soulprint gửi bạn thay lời xin lỗi khi đơn hàng không thể thực hiện, giảm 10% cho bất kỳ đơn hàng nào", type: "PERCENT", value: 10, maxDiscount: null,
    minOrderValue: 0, minItems: 0, scope: { kind: "ALL", ids: [], excludeProductIds: [] }, audience: "SELECTED", selectedUserIds: [], source: "COMPENSATION",
    totalQuantity: null, perUserLimit: 1, maxBudget: null, startAt: now, endAt: null, validDays: 30,
    showInWallet: true, autoOnSignup: false, status: "HOAT_DONG", usedCount: 0, discountGiven: 0, history: [], createdBy: null, createdAt: now, updatedAt: now,
  }
  await vouchers.updateOne({ code }, { $setOnInsert: doc }, { upsert: true })
  return vouchers.findOne({ code })
}

// Voucher xin lỗi nhân viên chọn: {} hoặc {voucherId} thì tặng (mặc định QUATANG10), {skip, reason} thì bỏ tặng (lý do ≥ 5 ký tự)
async function pickApology(gift, now) {
  if (gift.skip) {
    if (charCount(text(gift.reason, 300)) < 5) throw new HttpError(422, "VALIDATION_ERROR", "Nhập lý do không tặng voucher (ít nhất 5 ký tự)", { fields: { "apologyVoucher.reason": "Nhập lý do" } })
    return null
  }
  const vch = gift.voucherId && ObjectId.isValid(String(gift.voucherId)) ? await database.collection("vouchers").findOne({ _id: new ObjectId(String(gift.voucherId)) }) : await apologyVoucher(now)
  if (!vch || vch.status !== "HOAT_DONG" || (vch.endAt && new Date(vch.endAt) < now)) {
    throw new HttpError(422, "VALIDATION_ERROR", "Voucher xin lỗi đã ngừng hoặc hết hạn, chọn voucher khác hoặc bỏ tặng", { fields: { "apologyVoucher.voucherId": "Chọn voucher khác" } })
  }
  return vch
}

// khách đã có voucher xin lỗi thì cộng 1 lượt (extraUses) và tính lại hạn từ lần nhận này
async function grantApology(o, vch, now) {
  if (vch.audience === "SELECTED") await database.collection("vouchers").updateOne({ _id: vch._id }, { $addToSet: { selectedUserIds: o.userId } })
  const added = await voucherService.grantTo({ ...vch, source: "COMPENSATION" }, [o.userId], now)
  if (!added) {
    await database.collection("userVouchers").updateOne(
      { userId: o.userId, voucherId: vch._id },
      { $inc: { extraUses: 1 }, $set: { expiresAt: voucherService.grantExpiry(vch, now) } },
    )
  }
}

// Thông báo nổi bật phía khách khi nhận voucher xin lỗi
const apologyNotice = (o, vch) => ({
  type: "UU_DAI", title: `Soulprint gửi bạn voucher ${vch.code}`, body: `${ops.APOLOGY_POPUP} Mã ${vch.code}, xem trong Ưu đãi của tôi.`,
  link: "/tai-khoan/voucher", highlight: "VOUCHER_XIN_LOI",
})

async function unfulfillable(req, code, body) {
  const o = await loadOrder(code)
  const action = String(body.action || "ASK")
  assertSkipReason(body)
  needApproval(req, rules.specialOf("UNFULFILLABLE", o, body))
  if (action === "APOLOGY") return apologyDecision(req, o, body)
  if (o.orderStatus !== "CHO_XAC_NHAN") throw new HttpError(409, "INVALID_TRANSITION", "Chỉ xử lý được đơn đang Chờ xác nhận")
  const asking = o.unfulfillable && o.unfulfillable.status === "DANG_HOI_KHACH"
  const now = new Date()

  if (action === "ASK") {
    if (o.pendingChange) throw new HttpError(409, "PENDING_CHANGE", "Đơn đang chờ khách trả thêm, hủy thay đổi cũ trước")
    const reasonCode = String(body.reasonCode || "")
    const reasonText = text(body.reason, 300)
    const message = text(body.message, 500)
    const active = o.items.filter((it) => (it.fulfillStatus || "BINH_THUONG") === "BINH_THUONG")
    const itemIds = (Array.isArray(body.itemIds) ? body.itemIds.map(String) : []).filter((id) => active.some((it) => String(it._id) === id))
    const fields = {}
    if (!itemIds.length) fields.itemIds = "Chọn sản phẩm không thể thực hiện"
    if (!rules.UNFULFILLABLE_REASONS[reasonCode]) fields.reasonCode = "Chọn lý do"
    if (reasonCode === "KHAC" && charCount(reasonText) < 5) fields.reason = "Nhập lý do (ít nhất 5 ký tự)"
    if (charCount(message) < 10) fields.message = "Nhập nội dung gửi khách (10-500 ký tự)"
    if (Object.keys(fields).length) throw new HttpError(422, "VALIDATION_ERROR", "Vui lòng chọn sản phẩm, lý do và nhập nội dung gửi khách", { fields })
    const reason = reasonCode === "KHAC" ? reasonText : rules.UNFULFILLABLE_REASONS[reasonCode]
    // Hạn khách trả lời 4, 24 hoặc 48 giờ, mặc định 48 giờ (BR-30)
    const responseHours = [4, 24, 48].includes(Number(body.responseHours)) ? Number(body.responseHours) : params.UNFULFILLABLE_RESPONSE_HOURS
    const mark = {
      status: "DANG_HOI_KHACH", itemIds, reasonCode, reason, message, at: now, by: req.user._id,
      slaDeadline: new Date(now.getTime() + params.UNFULFILLABLE_SLA_HOURS * HOUR), responseHours, responseDeadline: new Date(now.getTime() + responseHours * HOUR),
    }
    const names = o.items.filter((it) => itemIds.includes(String(it._id))).map((it) => it.name)
    const r = await orders().updateOne(
      { _id: o._id, orderStatus: "CHO_XAC_NHAN" },
      {
        $set: { unfulfillable: mark, tags: rules.normalizeTags([...(o.tags || []), ASKING_TAG]).slice(0, 10), updatedAt: now },
        $push: { statusHistory: ops.historyEntry("items", null, "DANG_HOI_KHACH", { by: req.user._id, at: now, note: `${names.join(", ")}: ${reason}` }) },
      },
    )
    if (!r.modifiedCount) throw new HttpError(409, "INVALID_TRANSITION", "Trạng thái đơn đã thay đổi, vui lòng tải lại")
    await writeLog({ adminId: req.user._id, action: "ORDER_UNFULFILLABLE", targetType: "orders", targetId: o._id, reason, after: { itemIds, responseHours, summary: `báo khách ${names.length} sản phẩm không thể thực hiện` } })
    await ops.notifyOwner(o, {
      title: `Đơn ${o.code}: Soulprint không thực hiện được ${names.join(", ")}`,
      body: `${message} Bạn nhắn Soulprint trước ${vnHourDay(mark.responseDeadline)} nếu muốn đổi sang sản phẩm khác nhé.`,
    })
    return detail(req, o.code)
  }

  if (!asking) throw new HttpError(409, "INVALID_TRANSITION", "Đơn không ở trạng thái Đang hỏi khách")

  if (action === "CLEAR") {
    const reason = text(body.reason, 300)
    if (charCount(reason) < 5) throw new HttpError(422, "VALIDATION_ERROR", "Nhập lý do gỡ đánh dấu (ít nhất 5 ký tự)", { fields: { reason: "Nhập lý do" } })
    await orders().updateOne(
      { _id: o._id, "unfulfillable.status": "DANG_HOI_KHACH" },
      {
        $set: { "unfulfillable.status": "DA_DONG", "unfulfillable.outcome": "GO_DANH_DAU", "unfulfillable.closedAt": now, "unfulfillable.closedBy": req.user._id, updatedAt: now },
        $pull: { tags: ASKING_TAG },
        $push: { statusHistory: ops.historyEntry("items", null, "DA_GO_DANH_DAU", { by: req.user._id, at: now, note: reason }) },
      },
    )
    await writeLog({ adminId: req.user._id, action: "ORDER_UNFULFILLABLE", targetType: "orders", targetId: o._id, reason, after: { summary: "gỡ đánh dấu không thể thực hiện" } })
    // Báo khách đơn đã ổn, thay cho thông báo "không thực hiện được" trước đó
    await ops.notifyOwner(o, { title: `Đơn ${o.code} được xử lý tiếp bình thường`, body: "Soulprint đã xử lý được sản phẩm trong đơn. Đơn hàng tiếp tục như bình thường, bạn không cần làm gì thêm." })
    return detail(req, o.code)
  }

  if (action !== "CANCEL") throw new HttpError(400, "VALIDATION_ERROR", "Thao tác không hợp lệ")
  // 6a: bỏ tặng voucher cần lý do (khách lạm dụng); không thì voucher chọn hoặc QUATANG10
  const gift = body.apologyVoucher || {}
  const vch = await pickApology(gift, now)
  const u = o.unfulfillable
  const reason = u.reason
  const cancelCase = st.cancelCase(o)
  const r = await orders().updateOne(
    { _id: o._id, orderStatus: "CHO_XAC_NHAN", "unfulfillable.status": "DANG_HOI_KHACH" },
    {
      $set: {
        orderStatus: "DA_HUY", cancelledAt: now, cancelBy: "ADMIN", cancelReason: "KHONG_THE_THUC_HIEN", cancelDetail: reason, cancelCase,
        "unfulfillable.status": "DA_DONG", "unfulfillable.outcome": "HUY_DON", "unfulfillable.closedAt": now, "unfulfillable.closedBy": req.user._id,
        "unfulfillable.apologyVoucher": vch ? { voucherId: vch._id, code: vch.code } : { skipped: true, reason: text(gift.reason, 300) },
        updatedAt: now,
      },
      $pull: { tags: ASKING_TAG },
      $push: { statusHistory: ops.historyEntry("orderStatus", "CHO_XAC_NHAN", "DA_HUY", { by: req.user._id, at: now, note: `Không thể thực hiện: ${reason}` }) },
    },
  )
  if (!r.modifiedCount) throw new HttpError(409, "INVALID_TRANSITION", "Trạng thái đơn đã thay đổi, vui lòng tải lại")
  await myOrders.closeApprovalsOnCancel(o, now)
  await myOrders.releaseStock(o, now).catch((err) => console.error("Trả tồn lỗi:", err.message))
  // BR-30: hoàn 100% đã trả, kể cả phần cá nhân hóa (ngoại lệ BR-08)
  const refund = await ops.openRefund(o, { reason: "KHONG_THE_THUC_HIEN", amount: rules.refundable(o), by: req.user._id, now })
  if (vch) await grantApology(o, vch, now)
  await writeLog({
    adminId: req.user._id, action: "ORDER_UNFULFILLABLE", targetType: "orders", targetId: o._id, reason: gift.skip ? text(gift.reason, 300) : reason,
    after: { outcome: "HUY_DON", refund: refund?.amount || 0, voucher: vch ? vch.code : null, summary: vch ? `hủy đơn không thể thực hiện, tặng ${vch.code}` : "hủy đơn không thể thực hiện, không tặng voucher" },
  })
  const msg = text(body.message, 500)
  await ops.notifyOwner(o, {
    type: refund ? "HOAN_TIEN" : "DON_HANG",
    title: `Đơn ${o.code} đã hủy`,
    body: `${msg || `Soulprint không thực hiện được đơn hàng: ${reason}.`}${refund ? ` Soulprint sẽ hoàn ${fmt(refund.amount)} cho bạn.${ops.refundAccountHint(refund)}` : ""}${vch ? ` ${ops.APOLOGY_LINE} Mã ${vch.code} trong Ưu đãi của tôi.` : ""}`,
  })
  if (vch) await ops.notifyOwner(o, apologyNotice(o, vch))
  return detail(req, o.code)
}

// API-94 APOLOGY: khách đã tự hủy khi đang được hỏi, nhân viên gửi hoặc không gửi voucher xin lỗi
async function apologyDecision(req, o, body) {
  const u = o.unfulfillable
  if (!u || u.outcome !== "KHACH_HUY" || !u.apologyVoucher || !u.apologyVoucher.pending) {
    throw new HttpError(409, "INVALID_TRANSITION", "Đơn không chờ quyết định voucher xin lỗi")
  }
  const now = new Date()
  const gift = body.apologyVoucher || {}
  const vch = await pickApology(gift, now)
  const r = await orders().updateOne(
    { _id: o._id, "unfulfillable.apologyVoucher.pending": true },
    { $set: { "unfulfillable.apologyVoucher": vch ? { voucherId: vch._id, code: vch.code, by: req.user._id } : { skipped: true, reason: text(gift.reason, 300), by: req.user._id }, updatedAt: now } },
  )
  if (!r.modifiedCount) throw new HttpError(409, "ALREADY_PROCESSED", "Đơn này vừa được nhân viên khác xử lý")
  if (vch) {
    await grantApology(o, vch, now)
    await ops.notifyOwner(o, apologyNotice(o, vch))
  }
  await writeLog({
    adminId: req.user._id, action: "ORDER_UNFULFILLABLE", targetType: "orders", targetId: o._id, reason: vch ? "Gửi voucher xin lỗi" : text(gift.reason, 300),
    after: { voucher: vch ? vch.code : null, summary: vch ? `khách hủy đơn không thể thực hiện, tặng ${vch.code}` : "khách hủy đơn không thể thực hiện, không tặng voucher" },
  })
  return detail(req, o.code)
}

// API-218 hủy thay đổi đang chờ khách trả thêm (UC-OPS-03 2d)
async function cancelPendingChange(req, code) {
  const o = await loadOrder(code)
  if (!o.pendingChange) throw new HttpError(409, "NO_PENDING_CHANGE", "Đơn không có thay đổi đang chờ thanh toán")
  await require("./payment").cancelPending(o.pendingChange.paymentId)
  await orderChange.clearPending(o, { paymentId: o.pendingChange.paymentId })
  await writeLog({ adminId: req.user._id, action: "ORDER_EXCEPTION", targetType: "orders", targetId: o._id, reason: "Hủy thay đổi chờ thanh toán", after: { summary: `hủy thay đổi: ${o.pendingChange.summary}` } })
  return detail(req, o.code)
}

// API-220 gửi lại liên kết thanh toán thêm đã hết hạn (UC-OPS-03 2d): dựng lại thay đổi với giá, tồn hiện tại
async function resendPendingChange(req, code) {
  const o = await loadOrder(code)
  const last = o.lastExpiredChange
  if (!last || !last.input || o.orderStatus !== "CHO_XAC_NHAN" || o.pendingChange) throw new HttpError(409, "NO_EXPIRED_CHANGE", "Đơn không có liên kết thanh toán thêm đã hết hạn để gửi lại")
  const { reason, ...changes } = last.input
  const r = await orderChange.staffEdit(req, o, changes, { reason: reason || "Gửi lại liên kết thanh toán thêm" })
  await orders().updateOne({ _id: o._id }, { $unset: { lastExpiredChange: "" } })
  await writeLog({
    adminId: req.user._id, action: "ORDER_EXCEPTION", targetType: "orders", targetId: o._id, reason: "Gửi lại liên kết thanh toán thêm",
    after: { summary: r.pending ? `gửi lại liên kết ${r.pending.paymentCode}: ${r.pending.summary}` : `đổi sản phẩm (không còn phải trả thêm): ${last.summary}` },
  })
  return detail(req, o.code)
}

// ===== Ngoại lệ đặc biệt cần duyệt (BR-48): API-222 gửi, API-223 duyệt hoặc từ chối =====

const approvals = () => database.collection("approvalRequests")
const APPROVAL_TAG = "Chờ duyệt ngoại lệ"

async function pendingApprovalView(o, can) {
  const x = await approvals().findOne({ orderCode: o.code, status: "CHO_DUYET" })
  if (!x) return null
  return { _id: String(x._id), type: x.type, label: rules.SPECIAL_LABELS[x.type], summary: x.summary, amount: x.amount || 0, requestedName: x.requestedName, createdAt: x.createdAt, canDecide: can(rules.SPECIAL) }
}

// Câu tóm tắt cho người duyệt
function approvalSummary(special, body, o) {
  const reason = text(body.reason || body.apologyVoucher?.reason || "", 300)
  // Bỏ tặng voucher xin lỗi: nêu thao tác sẽ thực hiện khi duyệt và lý do không tặng
  if (special === "BO_VOUCHER_XIN_LOI") {
    const skipReason = text(body.apologyVoucher?.reason || "", 300)
    const what = body.action === "APOLOGY" ? "Không gửi voucher xin lỗi cho khách đã tự hủy" : body.action === "CANCEL" ? `Hủy đơn không thể thực hiện (${text(o.unfulfillable?.reason || "", 200)})` : `Hủy đơn (lý do: ${text(body.reason, 200)})`
    return `${what} và không tặng voucher xin lỗi. Lý do không tặng: ${skipReason}`
  }
  if (special === "CAP_VOUCHER") return `Cấp voucher bồi hoàn ${fmt(Number(body.voucher?.value) || 0)}, hạn ${Number(body.voucher?.validDays) || 0} ngày. Lý do: ${reason}`
  if (special === "HOAN_TIEN") return `Hoàn ${fmt(Number(body.amount) || 0)} ngoài quy trình (${body.method === "GATEWAY" ? "qua cổng" : "chuyển khoản"}). Lý do: ${reason}`
  if (special === "HUY_DON") {
    const byShop = body.cause !== "KHACH"
    const money = byShop ? `hoàn 100% đã trả ${fmt(rules.refundable(o))}` : "khách không được hoàn phần cá nhân hóa (TH3)"
    const skip = byShop && body.apologyVoucher?.skip ? `, không tặng voucher xin lỗi (lý do: ${text(body.apologyVoucher.reason, 200)})` : ""
    // Tiêu đề thẻ đã ghi "Hủy đơn đã bắt đầu cá nhân hóa", câu tóm tắt không lặp lại; nhãn đã có "Đang" nên không thêm
    return `${byShop ? "Do Soulprint" : "Theo yêu cầu của khách"}, đơn ${st.ORDER_LABEL[o.orderStatus].toLowerCase()}: ${money}${skip}. Lý do hủy: ${text(body.reason, 300)}`
  }
  return `Không tặng voucher xin lỗi. Lý do: ${reason}`
}

async function requestApproval(req, code, body = {}) {
  const o = await loadOrder(code)
  const api = body.api === "UNFULFILLABLE" ? "UNFULFILLABLE" : "EXCEPTION"
  const payload = body.body && typeof body.body === "object" ? body.body : {}
  const special = rules.specialOf(api, o, payload)
  if (!special) throw new HttpError(422, "BUSINESS_RULE", "Thao tác này không cần Quản trị duyệt", { rule: "BR-48" })
  if (canOf(req)(rules.SPECIAL)) throw new HttpError(422, "BUSINESS_RULE", "Bạn có quyền thực hiện trực tiếp, không cần gửi duyệt", { rule: "BR-48" })
  const reason = text(payload.reason || payload.apologyVoucher?.reason || "", 500)
  if (charCount(reason) < 5) throw new HttpError(422, "VALIDATION_ERROR", "Nhập lý do (ít nhất 5 ký tự)", { fields: { reason: "Nhập lý do" } })
  const now = new Date()
  const r = await orders().updateOne(
    { _id: o._id, approvalPending: { $ne: true } },
    { $set: { approvalPending: true, tags: rules.normalizeTags([...(o.tags || []), APPROVAL_TAG]).slice(0, 10), updatedAt: now } },
  )
  if (!r.modifiedCount) throw new HttpError(409, "ALREADY_REQUESTED", "Đơn đang có yêu cầu chờ duyệt")
  const amount = special === "HOAN_TIEN" ? Number(payload.amount) || 0 : special === "CAP_VOUCHER" ? Number(payload.voucher?.value) || 0 : 0
  await approvals().insertOne({
    orderId: o._id, orderCode: o.code, api, type: special, body: payload, summary: approvalSummary(special, payload, o), amount, status: "CHO_DUYET",
    requestedBy: req.user._id, requestedName: req.user.fullName, createdAt: now,
  })
  await writeLog({ adminId: req.user._id, action: "ORDER_EXCEPTION", targetType: "orders", targetId: o._id, reason, after: { summary: `gửi duyệt: ${rules.SPECIAL_LABELS[special]}` } })
  return detail(req, o.code)
}

async function decideApproval(req, id, body = {}) {
  const x = ObjectId.isValid(String(id)) ? await approvals().findOne({ _id: new ObjectId(String(id)) }) : null
  if (!x) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy yêu cầu duyệt")
  if (x.status !== "CHO_DUYET") throw new HttpError(409, "ALREADY_PROCESSED", "Yêu cầu đã được xử lý")
  const approve = body.decision === "DUYET"
  const rejectReason = text(body.reason, 300)
  if (!approve && charCount(rejectReason) < 5) throw new HttpError(422, "VALIDATION_ERROR", "Nhập lý do từ chối (ít nhất 5 ký tự)", { fields: { reason: "Nhập lý do" } })
  // Duyệt: thực hiện đúng nội dung đã gửi dưới tên người duyệt; lỗi (đơn đã đổi trạng thái...) thì yêu cầu vẫn chờ
  if (approve) {
    if (x.api === "UNFULFILLABLE") await unfulfillable(req, x.orderCode, x.body)
    else await exception(req, x.orderCode, x.body)
  }
  const now = new Date()
  const r = await approvals().updateOne(
    { _id: x._id, status: "CHO_DUYET" },
    { $set: { status: approve ? "DA_DUYET" : "TU_CHOI", decidedBy: req.user._id, decidedName: req.user.fullName, decidedAt: now, ...(approve ? {} : { rejectReason }) } },
  )
  if (!r.modifiedCount) throw new HttpError(409, "ALREADY_PROCESSED", "Yêu cầu đã được xử lý")
  await orders().updateOne({ code: x.orderCode }, { $unset: { approvalPending: "" }, $pull: { tags: APPROVAL_TAG }, $set: { updatedAt: now } })
  // Người gửi nhận kết quả ở chuông "Nhắc đến bạn"
  const excerpt = `${approve ? "Đã duyệt" : "Từ chối"}: ${rules.SPECIAL_LABELS[x.type]}${approve ? "" : `. Lý do: ${rejectReason}`}`
  await database.collection("staffMentions").insertOne({
    adminId: x.requestedBy, byAdminId: req.user._id, byName: req.user.fullName, orderCode: x.orderCode, noteId: null,
    excerpt: excerpt.length > 120 ? excerpt.slice(0, 117) + "..." : excerpt, readAt: null, createdAt: now,
  })
  await writeLog({ adminId: req.user._id, action: "ORDER_EXCEPTION", targetType: "orders", targetId: x.orderId, reason: approve ? x.summary : rejectReason, after: { summary: `${approve ? "duyệt" : "từ chối"} yêu cầu của ${x.requestedName}: ${rules.SPECIAL_LABELS[x.type]}` } })
  return detail(req, x.orderCode)
}

// API-230: phiên bản đơn để SCR-48 tự tải lại khi đơn đổi ở nơi khác
async function version(code) {
  return { version: st.orderVersion(await loadOrder(code), { staff: true }) }
}

// API-221: nhân viên bấm "Chat với khách" ở đơn: mở hội thoại với đúng khách (đang mở thì nhận về mình nếu chưa ai
// hỗ trợ, chưa có thì tạo mới gắn mã đơn), trả tin mở đầu điền sẵn. Khách chưa kích hoạt không chat được: trả SĐT để sao chép.
async function openConversation(req, code) {
  const o = await loadOrder(code)
  const chat = require("./chat")
  const conversations = database.collection("conversations")
  const owner = o.userId ? await database.collection("users").findOne({ _id: o.userId }, { projection: { fullName: 1, phone: 1, status: 1 } }) : null
  const draft = openingText(o, req.user)
  if (!owner || owner.status !== "HOAT_DONG") return { conversationId: null, customerName: o.customer?.fullName || "Khách", phone: o.customer?.phone || owner?.phone || null, draft }
  const now = new Date()
  let conv = await conversations.find({ userId: o.userId, status: { $in: ["BOT", "CHO_NHAN_VIEN", "DANG_HO_TRO"] } }).sort({ lastMessageAt: -1 }).limit(1).next()
  if (!conv) {
    conv = {
      userId: o.userId, sessionId: null, customerName: owner.fullName, orderCode: o.code, status: "DANG_HO_TRO", summary: null, sentiment: null, sentimentScore: null,
      topic: null, contact: null, botMissCount: 0, assignedAdminId: req.user._id, assignedAt: now, escalatedAt: now, lastMessageAt: now, internalNotes: [], createdAt: now,
    }
    conv._id = (await conversations.insertOne(conv)).insertedId
    await chat.addMessage(conv, "HE_THONG", `${req.user.fullName} bắt đầu cuộc trò chuyện về đơn ${o.code}`)
  } else if (conv.status !== "DANG_HO_TRO") {
    // Đang ở Sâu Béo hoặc chờ nhân viên: nhận về mình
    const r = await conversations.updateOne(
      { _id: conv._id, status: conv.status },
      { $set: { status: "DANG_HO_TRO", assignedAdminId: req.user._id, assignedAt: now, escalatedAt: conv.escalatedAt || now, orderCode: o.code } },
    )
    if (r.modifiedCount) await chat.addMessage(conv, "HE_THONG", `${req.user.fullName} đã tham gia cuộc trò chuyện về đơn ${o.code}`)
  } else {
    await conversations.updateOne({ _id: conv._id }, { $set: { orderCode: o.code } })
  }
  return { conversationId: String(conv._id), customerName: owner.fullName, phone: owner.phone || null, draft }
}

// Tin mở đầu: đơn đang hỏi khách thì hỏi đổi sản phẩm, còn lại chào hỏi về đơn (UC-OPS-06 bước 4)
function openingText(o, staff) {
  const me = String(staff.fullName || "").trim().split(/\s+/).pop() || "nhân viên"
  const u = o.unfulfillable
  if (o.orderStatus === "CHO_XAC_NHAN" && u && u.status === "DANG_HOI_KHACH") {
    const names = o.items.filter((it) => (u.itemIds || []).map(String).includes(String(it._id))).map((it) => it.name).join(", ")
    const why = String(u.reason || "").trim()
    return `Chào bạn, mình là ${me} từ Soulprint. Mình nhắn để hỗ trợ bạn đổi sản phẩm ${names} cho đơn hàng ${o.code}${why ? `, vì ${why.charAt(0).toLowerCase()}${why.slice(1)}` : ""}. Bạn muốn đổi sang sản phẩm khác hay hủy đơn và nhận hoàn tiền 100%?`
  }
  return `Chào bạn, mình là ${me} từ Soulprint. Mình nhắn để hỗ trợ bạn về đơn hàng ${o.code}.`
}

// ===== API-95 từ chối nhận hàng (UC-OPS-04) =====

async function refused(req, code, body) {
  const o = await loadOrder(code)
  if (o.orderStatus !== "DANG_VAN_CHUYEN") throw new HttpError(409, "INVALID_TRANSITION", "Đơn không ở trạng thái Đang vận chuyển hoặc đã được ghi nhận")
  const reason = String(body.reason || "")
  if (!rules.REFUSAL_REASONS[reason]) throw new HttpError(422, "VALIDATION_ERROR", "Chọn lý do từ chối", { fields: { reason: "Chọn lý do" } })
  // 2a: sai địa chỉ do phía giao hàng thì phí phát sinh mặc định 0đ
  const fee = body.refusedShippingFee === undefined || body.refusedShippingFee === "" ? (reason === "SAI_DIA_CHI" ? 0 : params.SHIPPING_FEE) : Number(body.refusedShippingFee)
  if (!Number.isInteger(fee) || fee < 0 || fee > 1000000) throw new HttpError(422, "VALIDATION_ERROR", "Phí phát sinh từ 0 đến 1.000.000đ", { fields: { refusedShippingFee: "Không hợp lệ" } })
  const note = text(body.note, 300)
  const now = new Date()
  const extra = await ops.storageFields(o, now)
  const set = {
    orderStatus: "DA_HUY", cancelledAt: now, cancelBy: "REFUSED", cancelReason: "TU_CHOI_NHAN", cancelDetail: rules.REFUSAL_REASONS[reason],
    refusalReason: reason, refusedShippingFee: fee, refusalNote: note || null, updatedAt: now, ...extra,
  }
  const push = [ops.historyEntry("orderStatus", "DANG_VAN_CHUYEN", "DA_HUY", { by: req.user._id, at: now, note: `Từ chối nhận: ${rules.REFUSAL_REASONS[reason]}${reason === "SAI_DIA_CHI" ? " (lỗi phía giao hàng, không tính vào lịch sử từ chối của khách)" : ""}` })]
  if (extra.storageStatus) push.push(ops.historyEntry("storageStatus", null, extra.storageStatus, { by: req.user._id, at: now, note: extra.storageStatus === "HET_HAN_LUU_KHO" ? "Giao lại lần 2 bị từ chối (BR-11)" : `Lưu kho đến ${vnDay(extra.storageDeadline)}` }))
  const r = await orders().updateOne({ _id: o._id, orderStatus: "DANG_VAN_CHUYEN" }, { $set: set, $push: { statusHistory: { $each: push } } })
  if (!r.modifiedCount) throw new HttpError(409, "INVALID_TRANSITION", "Đơn không ở trạng thái Đang vận chuyển hoặc đã được ghi nhận")
  await myOrders.closeApprovalsOnCancel(o, now)

  // Cộng trả tồn hàng không cá nhân hóa; gói quà đã dùng nên không trả vật liệu (BR-36)
  await myOrders.releaseStock(o, now, { items: o.items.filter((it) => !it.isPersonalized), materials: false }).catch((err) => console.error("Trả tồn lỗi:", err.message))
  await writeLog({ adminId: req.user._id, action: "ORDER_REFUSED", targetType: "orders", targetId: o._id, reason: rules.REFUSAL_REASONS[reason], after: { fee, cancelCase: extra.cancelCase, summary: "ghi nhận từ chối nhận hàng" } })

  const after = { ...o, ...set }
  // Chỉ dựng câu của đúng trường hợp (TH2 không có hạn lưu kho)
  const notices = {
    TH1: () => "Bạn có thể đặt lại đơn bất cứ lúc nào.",
    TH2: () => `Bạn được hoàn ${fmt(st.refundOnCancel(after))} (đã trừ phí vận chuyển phát sinh ${fmt(fee)}). Mở đơn và bấm "Nhận tiền hoàn" để nhập tài khoản nhận tiền.`,
    TH3: () => extra.storageStatus === "HET_HAN_LUU_KHO"
      ? "Đây là lần giao lại thứ 2 nên sản phẩm cá nhân hóa được chuyển xử lý, không áp dụng nhận lại hàng (BR-11)."
      : `Sản phẩm cá nhân hóa được giữ đến ${vnDay(extra.storageDeadline)}. Bấm "Nhận lại hàng" và trả phí giao lại để nhận.`,
  }
  const notice = notices[extra.cancelCase]()
  await ops.notifyOwner(o, { type: extra.cancelCase === "TH2" ? "HOAN_TIEN" : "DON_HANG", title: `Đơn ${o.code} chưa giao được`, body: `Người nhận từ chối nhận hàng (${rules.REFUSAL_REASONS[reason]}). ${notice}` })
  return detail(req, o.code)
}

// ===== API-96 xử lý ngoại lệ (UC-OPS-03) =====

function readAddressChanges(o, changes) {
  const a = changes.shippingAddress || {}
  const c = changes.customer || {}
  const next = { ...o.shippingAddress }
  for (const k of ["recipientName", "province", "ward", "street", "noteForShipper"]) if (typeof a[k] === "string") next[k] = text(a[k], k === "street" ? 200 : 120)
  if (typeof a.phone === "string") next.phone = a.phone.replace(/[\s.]/g, "")
  const cust = { ...o.customer }
  if (typeof c.fullName === "string") cust.fullName = text(c.fullName, 60)
  if (typeof c.phone === "string") cust.phone = c.phone.replace(/[\s.]/g, "")
  if (typeof c.email === "string") cust.email = c.email.trim().toLowerCase()
  v.assertFields({
    "shippingAddress.recipientName": charCount(next.recipientName || "") >= 2 ? "" : "Nhập tên người nhận",
    "shippingAddress.phone": v.isPhone(next.phone) ? "" : "Số điện thoại cần 10 số, bắt đầu bằng 0",
    "shippingAddress.province": next.province ? "" : "Chọn Tỉnh/Thành phố",
    "shippingAddress.ward": next.ward ? "" : "Chọn Phường/Xã",
    "shippingAddress.street": charCount(next.street || "") >= 3 ? "" : "Nhập số nhà, tên đường",
    "customer.fullName": charCount(cust.fullName || "") >= 2 ? "" : "Nhập họ tên",
    "customer.phone": v.isPhone(cust.phone) ? "" : "Số điện thoại cần 10 số, bắt đầu bằng 0",
    "customer.email": !cust.email || v.isEmail(cust.email) ? "" : "Email không hợp lệ",
  })
  if (!cust.email) delete cust.email
  return { shippingAddress: next, customer: cust }
}

async function exception(req, code, body) {
  const o = await loadOrder(code)
  const type = String(body.type || "")
  const can = canOf(req)
  if (!rules.EXCEPTION_TYPES[type]) throw new HttpError(422, "VALIDATION_ERROR", "Chọn loại can thiệp", { fields: { type: "Chọn loại" } })
  // Khung so sánh tiền trước khi xác nhận đổi sản phẩm: chưa cần lý do, không ghi gì
  if (type === "DOI_SAN_PHAM" && body.preview === true) {
    forbid(req, "DON_HANG.SUA")
    return (await orderChange.staffEdit(req, o, body.changes || {}, { previewOnly: true })).preview
  }
  // Đổi kiểu nhận (2a): xem trước số khách phải trả thêm
  const toType = ["SELF", "OTHER"].includes(body.changes?.recipientType) ? body.changes.recipientType : o.recipientType
  if (type === "SUA_THONG_TIN" && body.preview === true) {
    forbid(req, "DON_HANG.SUA")
    if (toType === o.recipientType) throw new HttpError(422, "VALIDATION_ERROR", "Chọn kiểu nhận khác kiểu hiện tại", { fields: { recipientType: "Chọn kiểu nhận" } })
    return (await orderChange.staffRecipient(req, o, null, toType, {}, { previewOnly: true })).preview
  }
  const reason = text(body.reason, 500)
  // 3Ea: thiếu lý do
  if (charCount(reason) < 5) throw new HttpError(422, "VALIDATION_ERROR", "Nhập lý do can thiệp (ít nhất 5 ký tự)", { fields: { reason: "Nhập lý do" } })
  if (type === "HUY_DON") forbid(req, "DON_HANG.HUY_DON")
  else forbid(req, "DON_HANG.SUA")
  if (type === "HOAN_TIEN") forbid(req, "HAU_MAI.HOAN_TIEN")
  if (!rules.exceptionTypes(o, can).includes(type)) {
    throw new HttpError(409, "INVALID_TRANSITION", type === "DOI_SAN_PHAM" ? "Chỉ sửa sản phẩm khi đơn còn Chờ xác nhận" : "Loại can thiệp này không áp dụng với trạng thái đơn hiện tại")
  }
  // Kiểm hợp lệ trước, đòi duyệt sau (BR-48): thao tác không áp dụng hoặc thiếu lý do thì báo lỗi đó, không bảo gửi duyệt
  assertSkipReason(body)
  needApproval(req, rules.specialOf("EXCEPTION", o, body))
  const changes = body.changes || {}
  const now = new Date()
  const label = rules.EXCEPTION_TYPES[type]
  let before = null
  let after = {}
  let notice = null
  let apology = null // voucher xin lỗi khi hủy ngoại lệ do Soulprint

  if (type === "SUA_THONG_TIN" && toType !== o.recipientType) {
    // 2a: đổi Giao cho tôi <-> Giao người nhận tới trước khi giao vận chuyển; thiếu tiền thì chờ khách trả (pendingChange)
    const r = await orderChange.staffRecipient(req, o, () => readAddressChanges(o, changes), toType, changes, { reason, now })
    before = { recipientType: o.recipientType, shippingAddress: o.shippingAddress, customer: o.customer }
    after = r.pending
      ? { recipientType: toType, pendingPayment: r.pending.paymentCode, amount: r.pending.amount, summary: r.pending.summary }
      : { recipientType: toType, shippingAddress: r.order.shippingAddress, summary: r.order.statusHistory?.at(-1)?.note || null }
  } else if (type === "SUA_THONG_TIN") {
    const next = readAddressChanges(o, changes)
    before = { shippingAddress: o.shippingAddress, customer: o.customer }
    after = next
    await orders().updateOne({ _id: o._id }, { $set: { ...next, updatedAt: now } })
    notice = { title: `Đơn ${o.code} đã cập nhật thông tin giao hàng`, body: `Giao đến ${next.shippingAddress.recipientName}, ${next.shippingAddress.phone}, ${[next.shippingAddress.street, next.shippingAddress.ward, next.shippingAddress.province].filter(Boolean).join(", ")}.` }
  } else if (type === "DOI_SAN_PHAM") {
    // 2d : đổi, thêm, bỏ nhiều món trong 1 lần, bù trừ BR-47; phải trả thêm thì đơn chờ khách thanh toán (pendingChange)
    const r = await orderChange.staffEdit(req, o, changes, { reason, now })
    before = { items: o.items.map((x) => ({ name: x.name, variantName: x.variantName, quantity: x.quantity })), total: o.total }
    after = r.pending
      ? { pendingPayment: r.pending.paymentCode, amount: r.pending.amount, summary: r.pending.summary }
      : { total: r.order.total, summary: r.order.statusHistory?.at(-1)?.note || null, surplusVoucher: r.surplusVoucher ? r.surplusVoucher.code : null, surplusRefund: r.surplusRefund ? r.settlement.surplus : 0 }
  } else if (type === "HUY_DON") {
    // nguyên nhân do Soulprint thì mặc định tặng voucher xin lỗi; theo yêu cầu của khách thì không
    const byShop = body.cause !== "KHACH"
    apology = byShop ? await pickApology(body.apologyVoucher || {}, now) : null
    // do Soulprint thì hoàn 100% đã trả kể cả phần cá nhân hóa (ngoại lệ BR-08), không rơi vào TH3
    const cancelCase = byShop ? (o.paidAmount > 0 ? "TH2" : "TH1") : st.cancelCase(o)
    const extra = cancelCase === "TH3" ? await ops.storageFields(o, now) : { cancelCase }
    const r = await orders().updateOne(
      { _id: o._id, orderStatus: o.orderStatus },
      {
        $set: { orderStatus: "DA_HUY", cancelledAt: now, cancelBy: "ADMIN", cancelReason: "NGOAI_LE", cancelDetail: reason, cancelCause: byShop ? "SOULPRINT" : "KHACH", updatedAt: now, ...extra },
        $push: { statusHistory: ops.historyEntry("orderStatus", o.orderStatus, "DA_HUY", { by: req.user._id, at: now, note: `Hủy ngoại lệ: ${reason}` }) },
      },
    )
    if (!r.modifiedCount) throw new HttpError(409, "INVALID_TRANSITION", "Trạng thái đơn đã thay đổi, vui lòng tải lại")
    if (o.pendingChange) await myOrders.dropPendingChange(o)
    await myOrders.closeApprovalsOnCancel(o, now)
    // Món cá nhân hóa đã làm không về kho; vật liệu gói quà chưa dùng (chưa giao vận chuyển) được cộng trả
    await myOrders.releaseStock(o, now, { items: o.personalizationStartedAt ? o.items.filter((it) => !it.isPersonalized) : o.items }).catch((err) => console.error("Trả tồn lỗi:", err.message))
    const refund = cancelCase === "TH2" ? await ops.openRefund(o, { reason: "HUY_DON", amount: rules.refundable(o), by: req.user._id, note: reason, now }) : null
    before = { orderStatus: o.orderStatus }
    if (apology) await grantApology(o, apology, now)
    after = { orderStatus: "DA_HUY", cancelCase, refund: refund?.amount || 0, cause: byShop ? "SOULPRINT" : "KHACH", voucher: apology ? apology.code : null }
    notice = {
      type: refund ? "HOAN_TIEN" : "DON_HANG",
      title: `Đơn ${o.code} đã hủy`,
      // Hủy theo yêu cầu của khách thì không ghi "Soulprint đã hủy đơn"
      body: `${byShop ? "Soulprint đã hủy đơn" : "Đơn đã hủy theo yêu cầu của bạn"}: ${reason}.${refund ? ` Soulprint sẽ hoàn ${fmt(rules.refundable(o))} cho bạn.${ops.refundAccountHint(refund)}` : ""}${cancelCase === "TH3" ? ` Sản phẩm cá nhân hóa được giữ đến ${vnDay(extra.storageDeadline)}.` : ""}${apology ? ` ${ops.APOLOGY_LINE} Mã ${apology.code} trong Ưu đãi của tôi.` : ""}`,
    }
  } else if (type === "HOAN_TIEN") {
    const amount = Number(body.amount)
    const max = rules.refundable(o)
    // 4Ea, AC3: vượt số có thể hoàn
    if (!Number.isInteger(amount) || amount < 1 || amount > max) throw new HttpError(422, "VALIDATION_ERROR", `Số tiền hoàn từ 1đ đến ${fmt(max)}`, { fields: { amount: `Tối đa ${fmt(max)}` } })
    const method = body.method === "GATEWAY" ? "GATEWAY" : "BANK_TRANSFER"
    const refund = await ops.openRefund(o, { reason: "NGOAI_LE", amount, by: req.user._id, note: reason, now })
    if (method === "GATEWAY") await database.collection("refunds").updateOne({ _id: refund._id }, { $set: { method } })
    after = { amount, method }
    notice = { type: "HOAN_TIEN", title: `Đơn ${o.code}: Soulprint hoàn tiền cho bạn`, body: `Yêu cầu hoàn ${fmt(amount)} đã được tạo${method === "GATEWAY" ? ", tiền về tài khoản thanh toán trong 1 - 3 ngày làm việc." : refund.bankInfo ? ", tiền về trong 1 - 3 ngày làm việc." : `.${ops.refundAccountHint(refund)}`}` }
  } else if (type === "CAP_VOUCHER") {
    const vch = await compensationVoucher(o, body, req.user._id, now)
    after = { voucherCode: vch.code }
    notice = { type: "UU_DAI", title: "Soulprint tặng bạn voucher bồi hoàn", body: `Mã ${vch.code}: ${vch.name}. Xem trong "Ưu đãi của tôi".`, link: "/tai-khoan/voucher" }
  } else if (type === "GIA_HAN") {
    const d = String(body.expectedDeliveryDate || "")
    const today = vnDate(now)
    const max = vnDate(new Date(now.getTime() + 60 * DAY))
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d <= today || d > max) throw new HttpError(422, "VALIDATION_ERROR", "Chọn ngày giao dự kiến mới (sau hôm nay, trong 60 ngày)", { fields: { expectedDeliveryDate: "Ngày không hợp lệ" } })
    before = { expectedDeliveryDate: o.expectedDeliveryDate || null }
    after = { expectedDeliveryDate: d }
    await orders().updateOne({ _id: o._id }, { $set: { expectedDeliveryDate: d, deliveryExtendedAt: now, updatedAt: now } })
    const [y, m, dd] = d.split("-")
    notice = { title: `Đơn ${o.code} có ngày giao dự kiến mới`, body: `Đơn hàng dự kiến giao ngày ${dd}/${m}/${y}. Soulprint xin lỗi vì sự chậm trễ.` }
  }

  await writeLog({ adminId: req.user._id, action: "ORDER_EXCEPTION", targetType: "orders", targetId: o._id, reason, before, after: { type, ...after, summary: `can thiệp: ${label}` } })
  if (notice) await ops.notifyOwner(o, notice)
  if (type === "HUY_DON" && apology) await ops.notifyOwner(o, apologyNotice(o, apology))
  return detail(req, o.code)
}

// 2c: chọn voucher đang hoạt động để cấp riêng, hoặc tạo nhanh voucher giảm số tiền nguồn COMPENSATION
async function compensationVoucher(o, body, adminId, now) {
  const vouchers = database.collection("vouchers")
  if (body.voucherId) {
    const vch = ObjectId.isValid(String(body.voucherId)) ? await vouchers.findOne({ _id: new ObjectId(String(body.voucherId)), status: "HOAT_DONG" }) : null
    if (!vch || (vch.endAt && new Date(vch.endAt) < now)) throw new HttpError(422, "VALIDATION_ERROR", "Voucher không còn hoạt động", { fields: { voucherId: "Chọn voucher khác" } })
    if (vch.audience === "SELECTED") await vouchers.updateOne({ _id: vch._id }, { $addToSet: { selectedUserIds: o.userId } })
    await voucherService.grantTo({ ...vch, source: "COMPENSATION" }, [o.userId], now)
    return vch
  }
  const value = Number(body.voucher?.value)
  const validDays = Number(body.voucher?.validDays || 30)
  if (!Number.isInteger(value) || value < 10000 || value > 1000000) throw new HttpError(422, "VALIDATION_ERROR", "Giá trị voucher từ 10.000đ đến 1.000.000đ", { fields: { "voucher.value": "Không hợp lệ" } })
  if (!Number.isInteger(validDays) || validDays < 1 || validDays > 365) throw new HttpError(422, "VALIDATION_ERROR", "Hạn dùng từ 1 đến 365 ngày", { fields: { "voucher.validDays": "Không hợp lệ" } })
  let codeTry = ""
  do codeTry = "BH" + Math.random().toString(36).slice(2, 8).toUpperCase().replace(/[^A-Z0-9]/g, "7")
  while (await vouchers.findOne({ code: codeTry }, { projection: { _id: 1 } }))
  const doc = {
    code: codeTry, name: `Bồi hoàn đơn ${o.code}: giảm ${fmt(value)}`, description: "Voucher bồi hoàn cấp riêng", type: "FIXED", value, maxDiscount: null,
    minOrderValue: 0, minItems: 0, scope: { kind: "ALL", ids: [], excludeProductIds: [] }, audience: "SELECTED", selectedUserIds: [o.userId], source: "COMPENSATION",
    totalQuantity: 1, perUserLimit: 1, maxBudget: null, startAt: now, endAt: new Date(now.getTime() + validDays * DAY), validDays: null,
    showInWallet: true, autoOnSignup: false, status: "HOAT_DONG", usedCount: 0, discountGiven: 0, history: [], createdBy: adminId, createdAt: now, updatedAt: now,
  }
  doc._id = (await vouchers.insertOne(doc)).insertedId
  await voucherService.grantTo(doc, [o.userId], now)
  return doc
}

// ===== API-103 tiêu hủy, API-194 vị trí kệ (UC-OPS-05) =====

async function dispose(req, code, body) {
  const o = await loadOrder(code)
  const method = String(body.method || "")
  if (!rules.DISPOSAL_METHODS[method] || body.checked !== true || body.confirm !== true) {
    throw new HttpError(422, "VALIDATION_ERROR", "Chọn hình thức tiêu hủy và xác nhận đã kiểm tra mã lưu, vị trí kệ", { fields: { method: rules.DISPOSAL_METHODS[method] ? "" : "Chọn hình thức", checked: body.checked === true ? "" : "Tick xác nhận" } })
  }
  // AC2: chỉ tiêu hủy khi đã hết hạn lưu kho, luôn cần nhân viên xác nhận
  if (o.storageStatus !== "HET_HAN_LUU_KHO") throw new HttpError(409, "INVALID_TRANSITION", "Chỉ tiêu hủy hàng đã hết hạn lưu kho")
  const now = new Date()
  const r = await orders().updateOne(
    { _id: o._id, storageStatus: "HET_HAN_LUU_KHO" },
    {
      $set: { storageStatus: "DA_TIEU_HUY", disposal: { method, at: now, by: req.user._id }, updatedAt: now },
      $push: { statusHistory: ops.historyEntry("storageStatus", "HET_HAN_LUU_KHO", "DA_TIEU_HUY", { by: req.user._id, at: now, note: `Tiêu hủy (${rules.DISPOSAL_METHODS[method]})` }) },
    },
  )
  if (!r.modifiedCount) throw new HttpError(409, "INVALID_TRANSITION", "Chỉ tiêu hủy hàng đã hết hạn lưu kho")
  // Bước 7, AC3: phần hàng không cá nhân hóa đã trả được hoàn (BR-08); tồn của phần đó đã cộng trả lúc từ chối/hủy
  const personalizedValue = o.items.filter((it) => it.isPersonalized && it.fulfillStatus !== "DA_HOAN_TIEN").reduce((s, it) => s + it.lineValue, 0)
  const plainValue = o.items.filter((it) => !it.isPersonalized && it.fulfillStatus !== "DA_HOAN_TIEN").reduce((s, it) => s + it.lineValue, 0)
  const amount = Math.min(plainValue, Math.max(0, rules.refundable(o) - personalizedValue))
  const refund = await ops.openRefund(o, { reason: o.cancelBy === "REFUSED" ? "TU_CHOI_NHAN" : "HUY_DON", amount, by: req.user._id, note: "Hoàn phần hàng không cá nhân hóa khi tiêu hủy (BR-08)", now })
  await writeLog({ adminId: req.user._id, action: "DISPOSE", targetType: "orders", targetId: o._id, reason: rules.DISPOSAL_METHODS[method], after: { storageCode: o.storageCode, refund: refund?.amount || 0, summary: `xác nhận tiêu hủy hàng lưu kho ${o.storageCode || ""}`.trim() } })
  await ops.notifyOwner(o, { type: refund ? "HOAN_TIEN" : "DON_HANG", title: `Đơn ${o.code}: sản phẩm cá nhân hóa đã được xử lý`, body: `Quá hạn nhận lại nên sản phẩm cá nhân hóa đã được tiêu hủy theo chính sách.${refund ? ` Phần hàng không cá nhân hóa ${fmt(amount)} sẽ được hoàn cho bạn.${ops.refundAccountHint(refund)}` : ""}` })
  return { code: o.code, storageStatus: "DA_TIEU_HUY", refund: refund ? refund.amount : 0 }
}

async function setShelf(req, code, body) {
  const o = await loadOrder(code)
  const shelf = text(body.shelf, 40)
  if (!shelf || charCount(shelf) > 20) throw new HttpError(422, "VALIDATION_ERROR", "Nhập vị trí kệ (1-20 ký tự)", { fields: { shelf: "1-20 ký tự" } })
  if (!["DANG_LUU_KHO", "HET_HAN_LUU_KHO"].includes(o.storageStatus)) throw new HttpError(409, "INVALID_TRANSITION", "Đơn không có hàng đang lưu kho")
  await orders().updateOne({ _id: o._id }, { $set: { storageShelf: shelf, updatedAt: new Date() } })
  await writeLog({ adminId: req.user._id, action: "STORAGE_SHELF", targetType: "orders", targetId: o._id, before: { shelf: o.storageShelf || null }, after: { shelf, summary: `ghi vị trí kệ ${shelf}` } })
  return { code: o.code, storageShelf: shelf }
}

module.exports = {
  list, stats, detail, changeStatus, reconcileCod, addNote, bulk, setTags, unfulfillable, cancelPendingChange, resendPendingChange, openConversation, requestApproval, decideApproval, version, apologyVoucher, refused, exception, dispose, setShelf,
  CARRIERS, SOURCES, buildFilter, loadOrder,
}
