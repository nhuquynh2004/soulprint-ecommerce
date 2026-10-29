// Đổi đơn trước khi xác nhận (BR-47): khách sửa đơn (UC-TRK-06, API-215, API-216), nhân viên đổi sản phẩm
// (UC-OPS-03 2d, API-96 DOI_SAN_PHAM). Một chỗ tính bù trừ để 2 phía giống nhau:
//   phải trả thêm  -> giao dịch ORDER_CHANGE, đơn chỉ đổi khi trả xong (orders.pendingChange giữ chỗ)
//   đã trả dư      -> hoàn phần dư chuyển khoản (refunds DOI_DON, preCounted) hoặc voucher nếu khách chọn
//   còn lại        -> số thu khi giao = tổng mới - đã trả
const { database, ObjectId } = require("../config/db")
const params = require("../config/params")
const HttpError = require("../utils/httpError")
const rules = require("./opsRules")
const ops = require("./orderOps")
const pz = require("./personalization")
const cart = require("./cart")
const voucherService = require("./voucher")
const { unitPrice } = require("./pricing")
const { fmt, deliveryRange } = require("./checkoutMath")
const { getStoreSettings } = require("./settings")

const orders = () => database.collection("orders")
const products = () => database.collection("products")
const DAY = 24 * 60 * 60 * 1000
const ASKING_TAG = "Đang hỏi khách"

// ===== Tính toán thuần (unit test ở tests/orderChange.test.js) =====

// Đơn đã chọn trả online toàn bộ (giao người nhận, hoặc khách chọn trả 100%)
const isFullPrepaid = (o) => o.paymentMethod === "ONLINE" && o.remainingMethod !== "COD"

// Tiền cọc BR-03 trên các món mới: chỉ đơn Giao cho tôi có món cá nhân hóa
function depositFor(items, recipientType, depositRate, total) {
  if (recipientType !== "SELF") return total
  const value = items.filter((it) => it.isPersonalized && (it.fulfillStatus || "BINH_THUONG") !== "DA_HOAN_TIEN").reduce((s, it) => s + it.lineValue, 0)
  return value > 0 ? Math.min(Math.ceil(value * depositRate), total) : 0
}

// Bù trừ BR-47. keepDeposit: đơn đã cọc chỉ đổi nội dung cá nhân hóa thì giữ số đã cọc (phần tăng cộng vào số thu khi giao);
// không giữ thì cọc tính lại theo BR-03 trên các món sau khi đổi
function settle(o, items, { depositRate, keepDeposit = false }) {
  const m = rules.recalcTotals(o, items)
  const paid = o.paidAmount || 0
  const refunded = o.refundedAmount || 0
  const net = paid - refunded
  let required
  if (isFullPrepaid(o)) required = m.total
  else if (keepDeposit) required = Math.min(net, m.total)
  else required = depositFor(items, o.recipientType, depositRate, m.total)
  const extra = Math.max(0, required - net)
  const surplus = extra > 0 ? 0 : Math.max(0, net - m.total)
  return {
    subtotal: m.subtotal, personalizationFee: m.personalizationFee, discount: m.discount, total: m.total,
    paid: net, required, extra, surplus,
    remainingAmount: Math.max(0, m.total - net - extra),
  }
}

// Trạng thái thanh toán sau khi đổi (05 Mục 2.2)
function paymentStatusOf(total, net, remainingMethod) {
  if (net <= 0) return "CHUA_THANH_TOAN"
  if (net >= total) return "DA_THANH_TOAN"
  return remainingMethod === "COD" ? "DA_COC" : "DA_THANH_TOAN"
}

// Khung so sánh hiện trước khi xác nhận (SCR-48, SCR-19)
const preview = (o, s) => ({
  before: { total: o.total, paid: (o.paidAmount || 0) - (o.refundedAmount || 0), remainingAmount: o.remainingAmount ?? Math.max(0, o.total - (o.paidAmount || 0)) },
  after: { total: s.total, remainingAmount: s.remainingAmount },
  settlement: { extra: s.extra, surplus: s.surplus },
})

// ===== Dòng sản phẩm mới =====

// Bản chụp cá nhân hóa trong đơn: Thiết kế lưu cả tên, ảnh sticker để đơn cũ vẫn hiển thị khi bộ sticker bị xóa
async function personalizationFor(p, input, now) {
  const allowed = pz.allowedTypes(p)
  const map = allowed.includes("THIET_KE") ? pz.stickerIndex(await pz.stickerSetsFor(p, now)) : new Map()
  const norm = pz.normalizePersonalization(input, p, map)
  if (!norm) return null
  if (norm.type !== "THIET_KE") return norm
  return { ...norm, stickers: norm.stickers.map((c) => { const x = map.get(c); return { code: c, name: x?.name || c, image: x?.image || null } }) }
}

// Dòng mới khi nhân viên đổi sang sản phẩm bất kỳ (UC-OPS-03 2d): sản phẩm đang bán, biến thể đang bán, số lượng 1-10
// sameProduct: giữ sản phẩm của dòng (đổi phân loại, số lượng, cá nhân hóa) thì không bắt sản phẩm còn hiển thị
async function buildLine(input, { now = new Date(), stickerFee, sameProduct = false }) {
  const id = String(input.productId || "")
  const p = ObjectId.isValid(id) ? await products().findOne({ _id: new ObjectId(id), ...(sameProduct ? {} : { status: "DANG_HIEN_THI" }) }) : null
  if (!p) throw new HttpError(422, "VALIDATION_ERROR", "Chọn sản phẩm đang bán", { fields: { productId: "Sản phẩm không hợp lệ" } })
  const variant = cart.findVariant(p, String(input.variantSku || ""))
  if (!variant || variant.isActive === false) throw new HttpError(422, "VALIDATION_ERROR", `Chọn phân loại cho ${p.name}`, { fields: { variantSku: "Chọn phân loại" } })
  const quantity = Number(input.quantity)
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) throw new HttpError(422, "VALIDATION_ERROR", "Số lượng từ 1 đến 10", { fields: { quantity: "Không hợp lệ" } })
  const personalization = await personalizationFor(p, input.personalization, now)
  const fee = pz.feePerUnit(personalization ? { ...personalization, stickers: (personalization.stickers || []).map((s) => s.code) } : null, stickerFee)
  const price = unitPrice(p, variant, now)
  return {
    _id: new ObjectId(), productId: p._id, sku: p.sku || null, variantSku: variant.sku, name: p.name, variantName: variant.name,
    image: cart.variantImage(p, variant), unitPrice: price, quantity, personalization, personalizationFeePerUnit: fee,
    isPersonalized: !!personalization, lineValue: (price + fee) * quantity, fulfillStatus: "BINH_THUONG", reviewed: false,
  }
}

// Tồn kho cần trừ và cộng trả khi thay các dòng cũ bằng các dòng mới: cộng dồn theo biến thể, chỉ tính phần chênh
function stockMoves(oldLines, newLines) {
  const net = new Map()
  const add = (it, sign) => {
    const k = `${it.productId}|${it.variantSku}`
    const m = net.get(k) || { productId: String(it.productId), sku: it.variantSku, qty: 0 }
    m.qty += sign * it.quantity
    net.set(k, m)
  }
  newLines.forEach((it) => add(it, 1))
  oldLines.forEach((it) => add(it, -1))
  const list = [...net.values()]
  return { take: list.filter((m) => m.qty > 0), release: list.filter((m) => m.qty < 0).map((m) => ({ ...m, qty: -m.qty })) }
}

// Trừ tồn có điều kiện từng dòng; thiếu thì trả lại phần đã trừ và báo hết hàng
async function takeStock(moves, names) {
  const done = []
  for (const m of moves) {
    const r = await products().updateOne(
      { _id: new ObjectId(m.productId), variants: { $elemMatch: { sku: m.sku, isActive: { $ne: false }, stock: { $gte: m.qty } } } },
      { $inc: { "variants.$.stock": -m.qty, soldCount: m.qty } },
    )
    if (!r.modifiedCount) {
      await releaseStock(done)
      throw new HttpError(409, "OUT_OF_STOCK", `${names[m.sku] || "Sản phẩm"} không đủ hàng`)
    }
    done.push(m)
  }
}
async function releaseStock(moves) {
  for (const m of moves) {
    await products().updateOne({ _id: new ObjectId(m.productId), "variants.sku": m.sku }, { $inc: { "variants.$.stock": m.qty, soldCount: -m.qty } }).catch((err) => console.error("Trả tồn lỗi:", err.message))
  }
}

// ===== Voucher hoàn phần dư (BR-47 b) =====

async function refundAsVoucher(o, amount, { by = null, now = new Date(), note }) {
  const doc = await createRefundVoucher(o, amount, { by, now })
  await database.collection("refunds").insertOne({
    orderId: o._id, orderCode: o.code, userId: o.userId, reason: "DOI_DON", amount, method: "VOUCHER", voucherCode: doc.code, bankInfo: null, preCounted: true,
    status: "DA_HOAN", slaDeadline: now, processedAt: now, processedBy: by, createdBy: by, note: note || null, createdAt: now, updatedAt: now,
  })
  return doc
}

// Phần dư hoàn chuyển khoản (mặc định): yêu cầu hoàn DOI_DON đã trừ vào đơn lúc đổi
async function refundAsTransfer(o, amount, { by = null, now = new Date(), note }) {
  return ops.openRefund(o, { reason: "DOI_DON", amount, by, note: note || null, preCounted: true, now })
}

// Voucher số tiền cố định cấp riêng cho khách (nguồn COMPENSATION)
async function createRefundVoucher(o, amount, { by = null, now = new Date() }) {
  const vouchers = database.collection("vouchers")
  let code = ""
  do code = "HOAN" + Math.random().toString(36).slice(2, 8).toUpperCase().replace(/[^A-Z0-9]/g, "7")
  while (await vouchers.findOne({ code }, { projection: { _id: 1 } }))
  const doc = {
    code, name: `Hoàn phần chênh đơn ${o.code}: giảm ${fmt(amount)}`, description: "Voucher hoàn phần đã trả dư khi đơn thay đổi", type: "FIXED", value: amount, maxDiscount: null,
    minOrderValue: 0, minItems: 0, scope: { kind: "ALL", ids: [], excludeProductIds: [] }, audience: "SELECTED", selectedUserIds: [o.userId], source: "COMPENSATION",
    totalQuantity: 1, perUserLimit: 1, maxBudget: null, startAt: now, endAt: new Date(now.getTime() + params.REFUND_VOUCHER_DAYS * DAY), validDays: null,
    showInWallet: true, autoOnSignup: false, status: "HOAT_DONG", usedCount: 0, discountGiven: 0, history: [], createdBy: by, createdAt: now, updatedAt: now,
  }
  doc._id = (await vouchers.insertOne(doc)).insertedId
  await voucherService.grantTo(doc, [o.userId], now)
  return doc
}

// API-219: khách đổi yêu cầu hoàn phần dư đang chờ chuyển khoản sang voucher dùng ngay (BR-47 b)
async function refundToVoucher(req, code) {
  const o = await myOrders().ownOrder(req.user, String(code || "").toUpperCase())
  const refunds = database.collection("refunds")
  const x = await refunds.findOne({ orderCode: o.code, reason: "DOI_DON", method: { $ne: "VOUCHER" }, status: { $in: ["CHO_XU_LY", "THAT_BAI"] } }, { sort: { createdAt: -1 } })
  if (!x) throw new HttpError(404, "NOT_FOUND", "Không có khoản hoàn phần chênh nào đang chờ")
  const now = new Date()
  // Giữ chỗ trước để nhân viên không chuyển khoản cùng lúc
  const r = await refunds.updateOne({ _id: x._id, status: x.status }, { $set: { status: "DA_HOAN", method: "VOUCHER", processedAt: now, updatedAt: now } })
  if (!r.modifiedCount) throw new HttpError(409, "ALREADY_PROCESSED", "Khoản hoàn này vừa được Soulprint xử lý, bạn tải lại trang")
  const v = await createRefundVoucher(o, x.amount, { now })
  await refunds.updateOne({ _id: x._id }, { $set: { voucherCode: v.code, note: [x.note, "Khách chọn nhận voucher"].filter(Boolean).join(". ") } })
  // Khoản trước đây chưa trừ vào đơn (không phải phần dư khi đổi) thì trừ lúc này
  if (!x.preCounted) await orders().updateOne({ _id: o._id }, { $inc: { refundedAmount: x.amount }, $set: { updatedAt: now } })
  await ops.notifyOwner(o, { type: "UU_DAI", title: `Đơn ${o.code}: đã hoàn ${fmt(x.amount)} vào Ưu đãi của tôi`, body: `Voucher ${v.code} giảm ${fmt(x.amount)}, dùng trong ${params.REFUND_VOUCHER_DAYS} ngày.`, link: "/tai-khoan/voucher" })
  return { voucher: { code: v.code, value: v.value } }
}

// ===== Áp dụng thay đổi đã đủ tiền =====

// change: {kind, items, set (trường khác: shippingAddress, noteForShop, expectedDeliveryDate), take, release, touchedItemIds (dòng cũ bị đổi, bỏ;
//   thay đổi cũ lưu replacedItemId), summary, keepDeposit,
//   refundMethod: BANK (mặc định) | VOUCHER - cách hoàn phần dư}
// paidExtra: số khách vừa trả qua giao dịch ORDER_CHANGE. Trả {order, surplusVoucher, surplusRefund, settlement}
async function apply(o, change, { paidExtra = 0, paymentId = null, by = null, byRole = "NHAN_VIEN", now = new Date() } = {}) {
  const settings = await getStoreSettings()
  // patch: trường đổi cùng cách trả (khách đổi sang Giao người nhận: trả online toàn bộ - BR-02)
  const base = { ...o, ...(change.patch || {}), paidAmount: (o.paidAmount || 0) + paidExtra }
  const s = settle(base, change.items, { depositRate: settings.depositRate, keepDeposit: !!change.keepDeposit })
  if (s.extra > 0) throw new HttpError(409, "PAYMENT_REQUIRED", `Đơn cần trả thêm ${fmt(s.extra)} trước khi đổi`)

  const names = Object.fromEntries(change.items.map((it) => [it.variantSku, it.name]))
  await takeStock(change.take || [], names)

  const net = s.paid - s.surplus
  let remainingMethod = base.remainingMethod || null
  let paymentMethod = base.paymentMethod
  // Đơn COD có thêm món cần cọc và vừa cọc xong: thành cọc online + COD phần còn lại
  if (paidExtra > 0 && paymentMethod === "COD") {
    paymentMethod = "ONLINE"
    remainingMethod = s.total - net > 0 ? "COD" : null
  }
  const set = {
    ...(change.set || {}),
    ...(change.patch || {}),
    items: change.items,
    hasPersonalizedItems: change.items.some((it) => it.isPersonalized && (it.fulfillStatus || "BINH_THUONG") !== "DA_HOAN_TIEN"),
    subtotal: s.subtotal, personalizationFee: s.personalizationFee, discount: s.discount, total: s.total,
    paidAmount: base.paidAmount, refundedAmount: (o.refundedAmount || 0) + s.surplus,
    remainingAmount: Math.max(0, s.total - net), paymentMethod, remainingMethod,
    paymentStatus: paymentStatusOf(s.total, net, remainingMethod),
    // Cọc tính lại (BR-47 T3): ghi số cọc mới khi cọc thêm; cọc mới thấp hơn thì giữ số đã cọc, phần dư nằm trong số thu khi giao
    ...(paidExtra > 0 && remainingMethod === "COD" ? { depositAmount: Math.max(o.depositAmount || 0, s.required) } : {}),
    updatedAt: now,
  }
  // Dòng đang được hỏi khách (UC-OPS-06 5a) đổi hoặc bỏ xong thì gỡ; hết dòng thì đóng "Đang hỏi khách"
  const asking = o.unfulfillable && o.unfulfillable.status === "DANG_HOI_KHACH"
  const unset = { pendingChange: "", lastExpiredChange: "" }
  // Khách tự sửa làm đổi tổng: tính 1 lượt (BR-47)
  const inc = change.kind === "KHACH_SUA" && s.total !== o.total ? { valueEditCount: 1 } : null
  let pull = null
  const touched = (change.touchedItemIds || (change.replacedItemId ? [change.replacedItemId] : [])).map(String)
  if (asking && touched.length) {
    const left = (o.unfulfillable.itemIds || []).map(String).filter((x) => !touched.includes(x))
    set["unfulfillable.itemIds"] = left
    if (!left.length) {
      Object.assign(set, { "unfulfillable.status": "DA_DONG", "unfulfillable.outcome": "DOI_SAN_PHAM", "unfulfillable.closedAt": now, "unfulfillable.closedBy": by })
      pull = { tags: ASKING_TAG }
    }
  }
  const cond = { _id: o._id, orderStatus: { $in: rules.changeStatuses(change.kind) }, total: o.total, ...(paymentId ? { "pendingChange.paymentId": paymentId } : { pendingChange: { $in: [null] } }) }
  const r = await orders().updateOne(cond, {
    $set: set, $unset: unset, ...(pull ? { $pull: pull } : {}), ...(inc ? { $inc: inc } : {}),
    $push: { statusHistory: ops.historyEntry("items", null, "DA_SUA_DON", { by, byRole, at: now, note: change.summary }) },
  })
  if (!r.modifiedCount) {
    await releaseStock(change.take || [])
    throw new HttpError(409, "INVALID_TRANSITION", "Đơn hàng đã được xử lý tiếp, không thể sửa")
  }
  await releaseStock(change.release || [])
  const toVoucher = change.refundMethod === "VOUCHER"
  const surplusVoucher = s.surplus > 0 && toVoucher ? await refundAsVoucher(o, s.surplus, { by, now, note: change.summary }) : null
  const surplusRefund = s.surplus > 0 && !toVoucher ? await refundAsTransfer(o, s.surplus, { by, now, note: change.summary }) : null
  return { order: await orders().findOne({ _id: o._id }), surplusVoucher, surplusRefund, settlement: s }
}

// ===== Thay đổi chờ thanh toán (orders.pendingChange) =====

async function requestPayment(o, change, amount, { req, staff = false, now = new Date() }) {
  const payment = require("./payment")
  const link = await payment.createForOrderChange(req, o, change, amount, { staff })
  const pending = {
    kind: change.kind, paymentId: new ObjectId(link.paymentId), paymentCode: link.code, amount, expiresAt: link.expiresAt,
    paymentUrl: link.paymentUrl, summary: change.summary, ...(change.input ? { input: change.input } : {}), createdBy: req.user?._id || null, createdAt: now,
  }
  const r = await orders().updateOne(
    { _id: o._id, orderStatus: { $in: rules.changeStatuses(change.kind) }, total: o.total, pendingChange: { $in: [null] } },
    { $set: { pendingChange: pending, updatedAt: now } },
  )
  if (!r.modifiedCount) {
    await payment.cancelPending(link.paymentId)
    throw new HttpError(409, "INVALID_TRANSITION", "Đơn hàng đã được xử lý tiếp, không thể sửa")
  }
  return { ...link, pending }
}

// Giao dịch ORDER_CHANGE thành công (payment.succeed): áp dụng thay đổi đã chụp. Lỗi thì payment hoàn qua cổng
async function completePayment(p) {
  const o = await orders().findOne({ code: p.orderCode })
  if (!o || !o.pendingChange || String(o.pendingChange.paymentId) !== String(p._id)) throw new HttpError(409, "ALREADY_PROCESSED", "Thay đổi này đã bị hủy")
  if (!rules.changeStatuses(o.pendingChange.kind).includes(o.orderStatus)) throw new HttpError(409, "INVALID_TRANSITION", "Đơn hàng đã được xử lý tiếp, không thể sửa")
  const change = reviveChange(p.change)
  const { order } = await apply(o, change, { paidExtra: p.amount, paymentId: o.pendingChange.paymentId, by: p.userId || null, byRole: "KHACH" })
  await ops.notifyOwner(order, { title: `Đơn ${o.code} đã cập nhật`, body: `Đã nhận ${fmt(p.amount)}. ${change.summary}. Tổng đơn mới ${fmt(order.total)}.` })
  return o.code
}

// Giao dịch thất bại, hết hạn, nhân viên hủy: bỏ chỗ giữ, đơn giữ nguyên
async function clearPending(o, { paymentId = null } = {}) {
  const filter = { _id: o._id, pendingChange: { $exists: true, $ne: null } }
  if (paymentId) filter["pendingChange.paymentId"] = new ObjectId(String(paymentId))
  await orders().updateOne(filter, { $unset: { pendingChange: "" }, $set: { updatedAt: new Date() } })
}

// Đọc đơn: thay đổi quá hạn thanh toán thì bỏ (thay cho việc định kỳ riêng)
// Liên kết nhân viên gửi hết hạn: giữ thông số để "Gửi lại liên kết" (API-220) và báo khách đơn giữ nguyên
async function expireIfDue(o, now = new Date()) {
  if (!o || !o.pendingChange || new Date(o.pendingChange.expiresAt) > now) return o
  const pc = o.pendingChange
  await database.collection("payments").updateOne({ _id: pc.paymentId, status: "PENDING" }, { $set: { status: "FAILED", failReason: "HET_HAN", updatedAt: now } })
  const last = pc.kind === "DOI_SAN_PHAM" && pc.input ? { summary: pc.summary, amount: pc.amount, input: pc.input, expiredAt: now } : null
  const r = await orders().updateOne(
    { _id: o._id, "pendingChange.paymentId": pc.paymentId },
    { $unset: { pendingChange: "" }, $set: { updatedAt: now, ...(last ? { lastExpiredChange: last } : {}) } },
  )
  if (r.modifiedCount && last) {
    const full = o.userId ? o : await orders().findOne({ _id: o._id })
    await ops.notifyOwner(full, { title: `Đơn ${full.code}: liên kết thanh toán thêm đã hết hạn`, body: `${pc.summary}. Đơn giữ nguyên như trước. Bạn nhắn Soulprint nếu vẫn muốn đổi.` })
  }
  return { ...o, pendingChange: null, ...(last ? { lastExpiredChange: last } : {}) }
}

async function expireStale(now = new Date()) {
  const list = await orders().find({ "pendingChange.expiresAt": { $lte: now } }, { projection: { pendingChange: 1, code: 1, userId: 1 } }).toArray()
  for (const o of list) await expireIfDue(o, now)
  return list.length
}

// ObjectId trong bản chụp lưu ở payments đọc lại thành ObjectId
function reviveChange(c) {
  const id = (x) => (x && !(x instanceof ObjectId) && ObjectId.isValid(String(x)) ? new ObjectId(String(x)) : x)
  return { ...c, items: (c.items || []).map((it) => ({ ...it, _id: id(it._id), productId: id(it.productId) })) }
}

// Chỉ đổi nội dung cá nhân hóa của món đã cá nhân hóa: cùng sản phẩm, phân loại, số lượng (BR-47 T2)
const contentOnly = (old, line) =>
  String(old.productId) === String(line.productId) && old.variantSku === line.variantSku && old.quantity === line.quantity && !!old.isPersonalized && !!line.isPersonalized

// Đơn vừa có món cá nhân hóa thì cần thêm thời gian làm hàng (BR-42): Giao cho tôi dời ngày dự kiến;
// Giao người nhận mà ngày đã chọn sớm hơn ngày sớm nhất mới thì báo khách sửa ngày giao trước
function deliveryAfterChange(o, items, now = new Date()) {
  const personalized = items.some((it) => it.isPersonalized && (it.fulfillStatus || "BINH_THUONG") !== "DA_HOAN_TIEN")
  if (o.hasPersonalizedItems || !personalized) return {}
  const min = deliveryRange(now, { province: (o.shippingAddress && o.shippingAddress.province) || "", personalized: true }).min
  const dmy = (d) => d.split("-").reverse().slice(0, 2).join("/")
  if (o.recipientType === "OTHER") {
    const chosen = (o.shippingAddress && o.shippingAddress.deliveryDate) || ""
    if (chosen && chosen < min) throw new HttpError(422, "DELIVERY_TOO_EARLY", `Món cá nhân hóa cần giao từ ${dmy(min)}, bạn sửa ngày giao trước`)
    return {}
  }
  const cur = o.expectedDeliveryDate || ""
  return cur && cur >= min ? {} : { expectedDeliveryDate: min }
}

// ===== Nhân viên sửa sản phẩm trong đơn (UC-OPS-03 2d): đổi, thêm, bỏ nhiều món trong 1 lần =====

const isActive = (it) => (it.fulfillStatus || "BINH_THUONG") === "BINH_THUONG"
const sameKind = (a, b) => String(a.productId) === String(b.productId) && a.variantSku === b.variantSku && pz.personalizationKey(plain(a.personalization)) === pz.personalizationKey(plain(b.personalization))
const lineLabel = (it) => `${it.name}${it.variantName ? " " + it.variantName : ""} x${it.quantity}`

// changes.lines: toàn bộ dòng sau khi sửa của các món chưa hoàn tiền (có itemId: dòng cũ; không có: món thêm; dòng cũ không gửi: bỏ).
// Dạng cũ {itemId, productId?, ...} sửa 1 dòng, các dòng khác giữ nguyên
function editSpecs(active, changes) {
  if (Array.isArray(changes.lines)) return changes.lines.map((x) => x || {})
  if (!active.some((x) => String(x._id) === String(changes.itemId))) throw new HttpError(422, "VALIDATION_ERROR", "Chọn sản phẩm cần đổi", { fields: { itemId: "Chọn sản phẩm" } })
  return active.map((x) => (String(x._id) === String(changes.itemId) ? changes : { itemId: String(x._id) }))
}

// Dòng sau khi sửa: dòng cũ không đổi gì giữ nguyên (giá lúc đặt); dòng sửa, thêm tính theo giá hiện tại
async function editedLine(c, old, { now, stickerFee }) {
  // Không gửi sản phẩm mới thì giữ sản phẩm của dòng (đổi biến thể, số lượng, cá nhân hóa); không gửi cá nhân hóa thì giữ nội dung cũ
  const keepProduct = !!old && (!c.productId || String(c.productId) === String(old.productId))
  const input = {
    productId: c.productId || String(old ? old.productId : ""),
    variantSku: c.variantSku || (old ? old.variantSku : ""),
    quantity: c.quantity ?? (old ? old.quantity : undefined),
    personalization: c.personalization !== undefined ? c.personalization : keepProduct ? plain(old.personalization) : null,
  }
  const unchanged = (x) => keepProduct && sameKind(old, x) && Number(x.quantity) === old.quantity
  if (unchanged(input)) return old
  const line = await buildLine(input, { now, stickerFee, sameProduct: keepProduct })
  return unchanged(line) ? old : line
}

async function staffEdit(req, o, changes, { reason, previewOnly = false, now = new Date() }) {
  o = await expireIfDue(o, now)
  if (o.orderStatus !== "CHO_XAC_NHAN") throw new HttpError(409, "INVALID_TRANSITION", "Chỉ sửa sản phẩm khi đơn còn Chờ xác nhận")
  if (o.pendingChange) throw new HttpError(409, "PENDING_CHANGE", "Đơn đang chờ khách trả thêm, hủy thay đổi cũ trước")
  const active = o.items.filter(isActive)
  const specs = editSpecs(active, changes)
  // 2dEc: bỏ hết món thì dùng Hủy đơn ngoại lệ
  if (!specs.length) throw new HttpError(422, "VALIDATION_ERROR", "Đơn cần còn ít nhất 1 sản phẩm, muốn bỏ hết thì dùng Hủy đơn ngoại lệ")
  if (specs.length > params.CART_MAX_ITEMS) throw new HttpError(422, "VALIDATION_ERROR", `Đơn tối đa ${params.CART_MAX_ITEMS} dòng sản phẩm`)
  const settings = await getStoreSettings()

  // Dòng mới theo thứ tự gửi lên; gộp dòng trùng sản phẩm, phân loại, cá nhân hóa vào dòng đứng trước (2dEd: tối đa 10)
  const seen = new Set()
  const entries = [] // {from: dòng cũ gộp vào, line}
  for (const c of specs) {
    const old = c.itemId ? active.find((x) => String(x._id) === String(c.itemId)) : null
    if (c.itemId && (!old || seen.has(String(old._id)))) throw new HttpError(422, "VALIDATION_ERROR", "Sản phẩm cần sửa không còn trong đơn, bạn tải lại đơn", { fields: { itemId: "Không hợp lệ" } })
    if (old) seen.add(String(old._id))
    const line = await editedLine(c, old, { now, stickerFee: settings.stickerFee })
    const host = entries.find((e) => sameKind(e.line, line))
    if (!host) {
      entries.push({ from: old ? [old] : [], line })
      continue
    }
    const quantity = host.line.quantity + line.quantity
    if (quantity > 10) throw new HttpError(422, "VALIDATION_ERROR", `Số lượng từ 1 đến 10 (${line.name})`, { fields: { quantity: "Không hợp lệ" } })
    // Dòng gộp tính theo giá hiện tại như khi sửa số lượng
    const base = host.from.includes(host.line) ? line : host.line
    host.line = { ...base, _id: host.line._id, quantity, lineValue: (base.unitPrice + base.personalizationFeePerUnit) * quantity }
    if (old) host.from.push(old)
  }
  const changed = entries.filter((e) => !(e.from.length === 1 && e.line === e.from[0]))
  const removed = active.filter((x) => !entries.some((e) => e.from.includes(x)))
  if (!changed.length && !removed.length) throw new HttpError(422, "VALIDATION_ERROR", "Chưa có thay đổi nào")

  // Giữ thứ tự dòng cũ; món thêm nằm cuối; món đã hoàn tiền giữ nguyên
  const byFirst = new Map(entries.filter((e) => e.from.length).map((e) => [String(e.from[0]._id), e.line]))
  const items = [
    ...o.items.flatMap((x) => (!isActive(x) ? [x] : byFirst.has(String(x._id)) ? [byFirst.get(String(x._id))] : [])),
    ...entries.filter((e) => !e.from.length).map((e) => e.line),
  ]
  // Đơn đã cọc chỉ đổi nội dung cá nhân hóa (VD thêm sticker) thì giữ cọc; đổi sản phẩm, phân loại, số lượng, thêm, bỏ món hoặc
  // món thường thêm cá nhân hóa thì cọc tính lại theo BR-03; đơn COD chưa trả gì vẫn cọc theo BR-03 (BR-47)
  const onlyContent = !removed.length && changed.every((e) => e.from.length === 1 && contentOnly(e.from[0], e.line))
  const keepDeposit = !isFullPrepaid(o) && (o.paidAmount || 0) - (o.refundedAmount || 0) > 0 && onlyContent
  const dates = deliveryAfterChange(o, items, now)
  const s = settle(o, items, { depositRate: settings.depositRate, keepDeposit })
  if (previewOnly) return { preview: preview(o, s) }

  const touched = active.filter((x) => !entries.some((e) => e.line === x))
  const moves = stockMoves(touched, changed.map((e) => e.line))
  const summary = [
    ...changed.filter((e) => e.from.length).map((e) => `Đổi ${e.from.map(lineLabel).join(" + ")} sang ${lineLabel(e.line)}`),
    ...changed.filter((e) => !e.from.length).map((e) => `Thêm ${lineLabel(e.line)}`),
    ...removed.map((x) => `Bỏ ${lineLabel(x)}`),
  ].join("; ")
  const change = {
    kind: "DOI_SAN_PHAM", items, set: dates, take: moves.take, release: moves.release, touchedItemIds: touched.map((x) => String(x._id)), keepDeposit,
    summary, reason,
    // Thông số để "Gửi lại liên kết" khi hết hạn (API-220) dựng lại với giá, tồn lúc đó
    input: {
      lines: entries.map((e) => ({ ...(e.from.length ? { itemId: String(e.from[0]._id) } : {}), productId: String(e.line.productId), variantSku: e.line.variantSku, quantity: e.line.quantity, personalization: plain(e.line.personalization) })),
      reason,
    },
  }
  if (s.extra > 0) {
    // Giữ hàng ngay khi tạo giao dịch? Không: trừ tồn khi khách trả xong (hết hàng lúc đó thì hoàn qua cổng - 2dEa)
    const link = await requestPayment(o, change, s.extra, { req, staff: true, now })
    await ops.notifyOwner(o, { title: `Đơn ${o.code}: cần thanh toán thêm ${fmt(s.extra)}`, body: `${change.summary}. Bạn thanh toán phần chênh để Soulprint cập nhật đơn.` })
    return { pending: link.pending, settlement: s }
  }
  const r = await apply(o, change, { by: req.user._id, now })
  await ops.notifyOwner(o, {
    title: `Đơn ${o.code} đã cập nhật sản phẩm theo yêu cầu`,
    body: `${change.summary}. Tổng đơn mới ${fmt(r.order.total)}.${r.surplusRefund ? ` Soulprint hoàn ${fmt(r.settlement.surplus)} phần chênh về tài khoản ngân hàng của bạn${r.surplusRefund.bankInfo ? "" : " (bạn nhập tài khoản ở chi tiết đơn)"}, hoặc bạn chọn nhận voucher dùng ngay ở chi tiết đơn.` : ""}`,
  })
  return { order: r.order, settlement: s, surplusVoucher: r.surplusVoucher, surplusRefund: r.surplusRefund }
}

// ===== Nhân viên đổi kiểu nhận (UC-OPS-03 2a) =====

// next(): trả {shippingAddress, customer} đã kiểm (adminOrders.readAddressChanges); body: {deliveryDate, deliveryWindow} khi sang Giao người nhận.
// Giao cho tôi -> Giao người nhận: trả online đủ 100% (BR-02), thiếu thì gửi khách liên kết, mã QR; đơn chỉ đổi khi khách trả xong.
// Giao người nhận -> Giao cho tôi: khách đã trả đủ nên không thu, không hoàn. Đổi được tới trước khi giao vận chuyển, cả khi đã xác nhận
// previewOnly: chỉ tính số trả thêm, chưa kiểm địa chỉ, ngày giao (hộp thoại hiện số tiền ngay khi chọn kiểu nhận)
async function staffRecipient(req, o, next, toType, body, { reason, previewOnly = false, now = new Date() }) {
  o = await expireIfDue(o, now)
  if (!rules.BEFORE_SHIPPING.includes(o.orderStatus)) throw new HttpError(409, "INVALID_TRANSITION", "Chỉ đổi kiểu nhận trước khi giao cho đơn vị vận chuyển")
  if (o.urgentCode) throw new HttpError(409, "BUSINESS_RULE", "Đơn gấp đã chốt cách giao với khách, không đổi kiểu nhận")
  if (o.pendingChange) throw new HttpError(409, "PENDING_CHANGE", "Đơn đang chờ khách trả thêm, hủy thay đổi cũ trước")
  const toOther = toType === "OTHER"
  const patch = toOther ? { recipientType: "OTHER", paymentMethod: "ONLINE", remainingMethod: null, depositAmount: 0 } : { recipientType: "SELF" }
  const settings = await getStoreSettings()
  const s = settle({ ...o, ...patch }, o.items, { depositRate: settings.depositRate })
  if (previewOnly) return { preview: preview(o, s) }

  const nx = next()
  const { deliveryDate: _d, deliveryWindow: _w, ...address } = nx.shippingAddress
  let expectedDeliveryDate = o.expectedDeliveryDate || null
  if (toOther) {
    // Món cá nhân hóa chưa làm xong thì ngày giao sớm nhất tính cả thời gian làm (BR-42)
    const range = deliveryRange(now, { province: address.province, personalized: !!o.hasPersonalizedItems && o.orderStatus !== "DANG_CHUAN_BI" })
    const d = String(body.deliveryDate || "")
    const w = String(body.deliveryWindow || "")
    const fields = {}
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < range.min || d > range.max) fields.deliveryDate = `Chọn ngày giao từ ${range.min.split("-").reverse().join("/")}`
    if (!range.slots.includes(w)) fields.deliveryWindow = "Chọn khung giờ"
    if (Object.keys(fields).length) throw new HttpError(422, "VALIDATION_ERROR", Object.values(fields)[0], { fields })
    Object.assign(address, { deliveryDate: d, deliveryWindow: w })
    expectedDeliveryDate = d
  }
  const summary = `Đổi sang ${toOther ? "Giao người nhận" : "Giao cho tôi"}: ${[receiver(address), addressLine(address), receiveTime(address)].filter(Boolean).join(", ")}`
  const change = {
    kind: "DOI_KIEU_NHAN", items: o.items, patch, take: [], release: [], summary, reason,
    set: { shippingAddress: address, customer: nx.customer, ...(expectedDeliveryDate ? { expectedDeliveryDate } : {}) },
  }
  if (s.extra > 0) {
    const link = await requestPayment(o, change, s.extra, { req, staff: true, now })
    await ops.notifyOwner(o, { title: `Đơn ${o.code}: cần thanh toán thêm ${fmt(s.extra)}`, body: `${summary}. Đơn giao người nhận cần thanh toán online đủ 100% để shipper không thu tiền người được tặng, bạn thanh toán phần còn lại để Soulprint cập nhật đơn.` })
    return { pending: link.pending, settlement: s }
  }
  const r = await apply(o, change, { by: req.user._id, now })
  await ops.notifyOwner(o, { title: `Đơn ${o.code} đã đổi cách nhận hàng`, body: `${summary}.` })
  return { order: r.order, settlement: s }
}

// ===== Khách sửa đơn trước khi xác nhận (UC-TRK-06) =====

const canEdit = (o) => o.orderStatus === "CHO_XAC_NHAN" && !o.pendingChange && !o.urgentCode
async function ownEditable(req, code) {
  const o = await expireIfDue(await myOrders().ownOrder(req.user, String(code || "").toUpperCase()))
  if (!canEdit(o)) throw new HttpError(409, "INVALID_TRANSITION", "Đơn hàng đã được xử lý tiếp, không thể sửa")
  return o
}
const myOrders = () => require("./myOrders") // nạp lúc chạy: myOrders không phụ thuộc file này nhưng tránh vòng nạp qua payment

// Dòng lịch sử khi khách sửa giao hàng: nêu cũ và mới của từng phần đã đổi để nhân viên đối chiếu
const addressLine = (a) => [a.street, a.ward, a.province].filter(Boolean).join(", ")
const receiver = (a) => [a.recipientName, a.phone].filter(Boolean).join(" ")
const receiveTime = (a) => [a.deliveryDate ? a.deliveryDate.split("-").reverse().join("/") : "", a.deliveryWindow].filter(Boolean).join(" ")
function shippingChangeNote(before = {}, after = {}) {
  const parts = []
  if (receiver(before) !== receiver(after)) parts.push(`người nhận ${receiver(before) || "trống"} → ${receiver(after)}`)
  if (addressLine(before) !== addressLine(after)) parts.push(`địa chỉ ${addressLine(before) || "trống"} → ${addressLine(after)}`)
  if (receiveTime(before) !== receiveTime(after)) parts.push(`ngày nhận ${receiveTime(before) || "chưa chọn"} → ${receiveTime(after) || "chưa chọn"}`)
  if ((before.noteForShipper || "") !== (after.noteForShipper || "")) parts.push("ghi chú cho shipper")
  return parts.length ? `Khách sửa thông tin giao hàng: ${parts.join("; ")}` : "Khách sửa thông tin giao hàng"
}

// API-215: sửa thông tin giao hàng như SCR-07. Phí vận chuyển đồng giá nên tổng không đổi.
// recipientType "OTHER" ở đơn Giao cho tôi: đổi sang Giao người nhận, trả online cho đủ 100% (BR-02, UC-TRK-06 2a);
// đơn Giao người nhận không đổi ngược lại
async function customerShipping(req, code, body) {
  const o = await ownEditable(req, code)
  const toOther = body.recipientType === "OTHER" && o.recipientType === "SELF"
  const recipientType = toOther ? "OTHER" : o.recipientType
  const { readShipping } = require("./order")
  const r = readShipping(body, recipientType, o.customer, { personalized: !!o.hasPersonalizedItems })
  const now = new Date()
  const set = {
    shippingAddress: r.shippingAddress, noteForShop: r.noteForShop,
    // Giao người nhận: ngày khách chọn; Giao cho tôi giữ ngày dự kiến cũ (nhân viên có thể đã gia hạn)
    expectedDeliveryDate: recipientType === "OTHER" ? r.expectedDeliveryDate : o.expectedDeliveryDate || r.expectedDeliveryDate,
  }
  const note = shippingChangeNote(o.shippingAddress || {}, r.shippingAddress)
  if (toOther) {
    const settings = await getStoreSettings()
    const change = {
      kind: "KHACH_SUA", items: o.items, set, patch: { recipientType: "OTHER", paymentMethod: "ONLINE", remainingMethod: null, depositAmount: 0 },
      take: [], release: [], summary: note.replace("Khách sửa thông tin giao hàng", "Khách đổi sang Giao người nhận"),
    }
    const s = settle({ ...o, ...change.patch }, o.items, { depositRate: settings.depositRate })
    if (body.preview) return { preview: { ...preview(o, s), valueChanged: false, editsLeft: editsLeftOf(o) } }
    if (s.extra > 0) {
      const link = await requestPayment(o, change, s.extra, { req, staff: false, now })
      return { status: 202, payment: { paymentId: link.paymentId, paymentUrl: link.paymentUrl, amount: link.amount } }
    }
    const done = await apply(o, change, { by: req.user._id, byRole: "KHACH", now })
    return { order: await myOrders().detail(done.order, "owner") }
  }
  const u = await orders().updateOne(
    { _id: o._id, orderStatus: "CHO_XAC_NHAN", pendingChange: { $in: [null] } },
    { $set: { ...set, updatedAt: now }, $push: { statusHistory: ops.historyEntry("items", null, "DA_SUA_DON", { by: req.user._id, byRole: "KHACH", at: now, note }) } },
  )
  if (!u.modifiedCount) throw new HttpError(409, "INVALID_TRANSITION", "Đơn hàng đã được xử lý tiếp, không thể sửa")
  return { order: await myOrders().detail(await orders().findOne({ _id: o._id }), "owner") }
}

// API-216: sửa nội dung cá nhân hóa của 1 món đã cá nhân hóa, hoặc thêm cá nhân hóa cho món thường của sản phẩm có hỗ trợ
// (UC-TRK-06 1a, 1b); SCR-04 như lúc đặt, không bỏ hẳn cá nhân hóa
async function customerPersonalization(req, code, itemId, body) {
  const o = await ownEditable(req, code)
  const it = o.items.find((x) => String(x._id) === String(itemId))
  if (!it || (it.fulfillStatus || "BINH_THUONG") !== "BINH_THUONG") throw new HttpError(422, "BUSINESS_RULE", "Sản phẩm này không sửa cá nhân hóa được")
  if (!body.personalization || !body.personalization.type) throw new HttpError(400, "VALIDATION_ERROR", "Chọn In/Khắc hoặc Thiết kế", { fields: { personalization: "Chọn nội dung" } })
  const p = await products().findOne({ _id: it.productId })
  if (!p) throw new HttpError(404, "NOT_FOUND", "Sản phẩm không còn tồn tại")
  const adding = !it.isPersonalized
  if (adding && !pz.allowedTypes(p).length) throw new HttpError(422, "BUSINESS_RULE", "Sản phẩm này không hỗ trợ cá nhân hóa")
  const now = new Date()
  const settings = await getStoreSettings()
  const pers = await personalizationFor(p, body.personalization, now)
  if (pz.personalizationKey(plain(pers)) === pz.personalizationKey(plain(it.personalization))) {
    throw new HttpError(422, "VALIDATION_ERROR", "Chưa có thay đổi nào")
  }
  const fee = pz.feePerUnit(plain(pers), settings.stickerFee)
  const line = { ...it, personalization: pers, personalizationFeePerUnit: fee, lineValue: (it.unitPrice + fee) * it.quantity, isPersonalized: true }
  const items = o.items.map((x) => (x === it ? line : x))
  // Đơn đã cọc sửa nội dung: giữ cọc, phần tăng cộng vào số thu khi giao (BR-47 T2);
  // thêm cá nhân hóa cho món thường: cọc tính lại theo BR-03, đơn COD chưa trả gì phải cọc (T3, T4)
  const keepDeposit = !isFullPrepaid(o) && !adding && (o.paidAmount || 0) - (o.refundedAmount || 0) > 0
  const refundMethod = body.refundMethod === "VOUCHER" ? "VOUCHER" : "BANK"
  const set = deliveryAfterChange(o, items, now)
  const change = { kind: "KHACH_SUA", items, set, keepDeposit, refundMethod, take: [], release: [], summary: `${adding ? "Khách thêm cá nhân hóa" : "Khách sửa cá nhân hóa"} ${it.name}` }
  const s = settle(o, items, { depositRate: settings.depositRate, keepDeposit: change.keepDeposit })
  // Sửa làm đổi tổng chỉ được ORDER_VALUE_EDIT_MAX lần (BR-47); hộp xác nhận lấy số liệu bằng preview
  const valueChanged = s.total !== o.total
  const editsLeft = editsLeftOf(o)
  if (body.preview) return { preview: { ...preview(o, s), valueChanged, editsLeft, deposit: adding ? s.required : null } }
  if (valueChanged && editsLeft <= 0) {
    throw new HttpError(422, "VALUE_EDIT_LIMIT", `Mỗi đơn chỉ được sửa làm thay đổi giá trị ${params.ORDER_VALUE_EDIT_MAX} lần. Bạn liên hệ Soulprint để được hỗ trợ`)
  }
  if (s.extra > 0) {
    const link = await requestPayment(o, change, s.extra, { req, staff: false, now })
    return { status: 202, payment: { paymentId: link.paymentId, paymentUrl: link.paymentUrl, amount: link.amount } }
  }
  const r = await apply(o, change, { by: req.user._id, byRole: "KHACH", now })
  if (r.surplusVoucher) {
    await ops.notifyOwner(o, { type: "UU_DAI", title: `Đơn ${o.code}: hoàn ${fmt(r.settlement.surplus)} vào Ưu đãi của tôi`, body: `Phần chênh sau khi sửa cá nhân hóa được hoàn bằng voucher ${r.surplusVoucher.code}.`, link: "/tai-khoan/voucher" })
  }
  return {
    order: await myOrders().detail(r.order, "owner"),
    refundVoucher: r.surplusVoucher ? { code: r.surplusVoucher.code, value: r.surplusVoucher.value } : null,
    refund: r.surplusRefund ? { amount: r.settlement.surplus, needsAccount: !r.surplusRefund.bankInfo } : null,
  }
}

// Lượt sửa làm đổi giá trị còn lại của khách (BR-47)
const editsLeftOf = (o) => Math.max(0, params.ORDER_VALUE_EDIT_MAX - (o.valueEditCount || 0))

// Nội dung cá nhân hóa để so sánh (Thiết kế trong đơn lưu sticker dạng object)
const plain = (p) => (p && p.type === "THIET_KE" ? { ...p, stickers: (p.stickers || []).map((x) => (typeof x === "string" ? x : x.code)) } : p)

module.exports = {
  ASKING_TAG, isFullPrepaid, depositFor, settle, paymentStatusOf, preview, stockMoves,
  personalizationFor, buildLine, apply, requestPayment, completePayment, clearPending, expireIfDue, expireStale, reviveChange, staffEdit, staffRecipient, refundAsVoucher, refundAsTransfer, refundToVoucher, plain,
  canEdit, customerShipping, customerPersonalization, editsLeftOf, shippingChangeNote, contentOnly, deliveryAfterChange,
}
