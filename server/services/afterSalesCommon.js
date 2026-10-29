// Phần dùng chung của hậu mãi (S9): lưu ảnh/video base64 vào files, địa chỉ lấy hàng từ sổ địa chỉ hoặc
// nhập mới, mã yêu cầu DT/BH, đơn thay thế 0đ (UC-OPS-07 bước 6, 1a) và hoàn tất yêu cầu khi đơn thay thế được giao.
const { database, ObjectId } = require("../config/db")
const params = require("../config/params")
const HttpError = require("../utils/httpError")
const v = require("../utils/validators")
const { decodeDataUrl } = require("../controllers/file.controller")
const { nextSequence } = require("./giftAdmin")
const math = require("./checkoutMath")
const order = require("./order")
const ops = require("./orderOps")

const files = () => database.collection("files")
const users = () => database.collection("users")
const orders = () => database.collection("orders")

// Khách chỉ gửi ảnh JPG/PNG (BR-31: không video)
const IMAGE_TYPES = ["image/jpeg", "image/png"]
const EVIDENCE_TYPES = [...IMAGE_TYPES, "video/mp4"]

const isFileUrl = (x) => typeof x === "string" && /^\/api\/files\/[a-f0-9]{24}$/.test(x)
const fileIdOf = (url) => new ObjectId(url.slice("/api/files/".length))

// Lưu danh sách data URL thành tệp, trả đường dẫn /api/files/<id> (việc dọn tệp mồ côi tìm theo dạng này).
// Giải mã hết trước khi ghi để 1 tệp lỗi không để lại tệp dở.
async function saveFiles(list, { ownerUserId = null, uploadedBy = null, visibility = "RIENG_TU", types = IMAGE_TYPES, label = "Ảnh" } = {}) {
  const docs = (list || []).map((dataUrl, i) => ({
    ...decodeDataUrl(dataUrl, `${label} ${i + 1}`, { types, imageMaxMB: params.RETURN_MAX_IMAGE_MB }),
    name: `${label.toLowerCase().replace(/\s+/g, "-")}-${i + 1}`,
    visibility,
    ownerType: null,
    ownerId: null,
    ownerUserId,
    uploadedBy,
    createdAt: new Date(),
  }))
  if (!docs.length) return []
  const r = await files().insertMany(docs)
  return Object.values(r.insertedIds).map((id) => `/api/files/${id}`)
}

async function removeFiles(urls) {
  const ids = (urls || []).filter(isFileUrl).map(fileIdOf)
  if (ids.length) await files().deleteMany({ _id: { $in: ids } })
}

// Bằng chứng từ chối (UC-OPS-07 3a): tối đa 5 ảnh 10MB và 1 video MP4 8MB; khách chủ yêu cầu xem được
async function saveEvidence(list, { ownerUserId, uploadedBy }) {
  const items = Array.isArray(list) ? list : []
  const videos = items.filter((x) => /^data:video\//.test(String(x)))
  if (items.length - videos.length > params.RETURN_MAX_IMAGES || videos.length > 1) {
    throw new HttpError(422, "VALIDATION_ERROR", `Tối đa ${params.RETURN_MAX_IMAGES} ảnh và 1 video`, { fields: { evidence: "Quá số tệp cho phép" } })
  }
  return saveFiles(items, { ownerUserId, uploadedBy, types: EVIDENCE_TYPES, label: "Bằng chứng" })
}

// ===== Địa chỉ lấy hàng / giao lại =====

const ADDRESS_KEYS = ["recipientName", "phone", "province", "ward", "street"]

// Địa chỉ từ sổ (addressId) hoặc nhập mới; địa chỉ mới tự lưu vào sổ như UC-PAY-02 (BR-22). prefix: tên trường báo lỗi.
async function readAddress(user, body, prefix = "pickupAddress") {
  if (body.addressId) {
    const u = await users().findOne({ _id: user._id }, { projection: { addresses: 1 } })
    const a = (u?.addresses || []).find((x) => String(x._id) === String(body.addressId))
    if (!a) throw new HttpError(400, "VALIDATION_ERROR", "Địa chỉ không còn trong sổ địa chỉ", { fields: { addressId: "Chọn lại địa chỉ" } })
    return Object.fromEntries(ADDRESS_KEYS.map((k) => [k, a[k]]))
  }
  const x = body[prefix] || {}
  const a = {
    recipientName: v.str(x.recipientName).normalize("NFC").slice(0, 60),
    phone: v.str(x.phone).replace(/[\s.]/g, ""),
    province: v.str(x.province).slice(0, 60),
    ward: v.str(x.ward).slice(0, 80),
    street: v.str(x.street).normalize("NFC").slice(0, 200),
  }
  v.assertFields({
    [`${prefix}.recipientName`]: a.recipientName.length >= 2 ? "" : "Vui lòng nhập tên người nhận",
    [`${prefix}.phone`]: v.isPhone(a.phone) ? "" : "Số điện thoại cần 10 số, bắt đầu bằng 0",
    [`${prefix}.province`]: a.province ? "" : "Vui lòng chọn Tỉnh/Thành phố",
    [`${prefix}.ward`]: a.ward ? "" : "Vui lòng chọn Phường/Xã",
    [`${prefix}.street`]: a.street.length >= 3 ? "" : "Nhập số nhà, tên đường",
  })
  await saveToBook(user._id, a)
  return a
}

async function saveToBook(userId, a) {
  try {
    const u = await users().findOne({ _id: userId }, { projection: { addresses: 1 } })
    const list = u?.addresses || []
    if (list.some((x) => order.sameAddress(x, a))) return
    list.push({ _id: new ObjectId(), ...a, isDefault: list.length === 0 })
    await users().updateOne({ _id: userId }, { $set: { addresses: list, updatedAt: new Date() } })
  } catch (err) {
    console.error("Lưu sổ địa chỉ lỗi:", err.message)
  }
}

// ===== Mã yêu cầu =====

// DT/BH + yyMMdd (giờ Việt Nam) + 4 số, counters return-yyMMdd / warranty-yyMMdd (06 Mục 4.6, 4.7)
async function requestCode(prefix, counter, now = new Date()) {
  const day = math.vnDate(now).slice(2).replace(/-/g, "")
  const seq = await nextSequence(`${counter}-${day}`)
  return prefix + day + String(seq).padStart(4, "0")
}

// ===== Đơn thay thế 0đ =====

// lines: [{item (dòng của đơn gốc), quantity}]. Trừ tồn như đơn mới; không đủ hàng thì 409 để nhân viên chọn hoàn tiền.
async function createReplacement(o, lines, { kind, request, address, by, now = new Date() }) {
  const undo = []
  const rollback = async () => {
    for (const fn of undo.reverse()) await fn().catch(() => null)
  }
  try {
    await order.reserveStock(lines.map(({ item, quantity }) => ({ productId: String(item.productId), variantSku: item.variantSku, name: item.name, quantity })), undo)
  } catch (err) {
    await rollback()
    if (err instanceof HttpError && err.code === "OUT_OF_STOCK") {
      throw new HttpError(409, "OUT_OF_STOCK", `${lines.map(({ item }) => item.name).join(", ")} không đủ hàng để giao lại, bạn có thể chọn "Hoàn tiền ngay"`)
    }
    throw err
  }
  try {
    const seq = await nextSequence("order-" + math.vnDate(now).slice(2).replace(/-/g, ""))
    const label = kind === "DOI_TRA" ? "đổi trả" : "bảo hành"
    const doc = {
      code: math.orderCode(now, seq),
      userId: o.userId,
      customer: o.customer,
      createdBy: "NHAN_VIEN",
      source: o.source || "WEBSITE",
      tags: ["Đơn thay thế"],
      items: lines.map(({ item, quantity }) => ({
        _id: new ObjectId(), productId: item.productId, sku: item.sku, variantSku: item.variantSku, name: item.name, variantName: item.variantName,
        image: item.image, unitPrice: 0, quantity, personalization: item.personalization || null, personalizationFeePerUnit: 0,
        isPersonalized: !!item.isPersonalized, lineValue: 0, fulfillStatus: "BINH_THUONG", reviewed: true,
      })),
      hasPersonalizedItems: lines.some(({ item }) => item.isPersonalized),
      giftWrap: null,
      recipientType: "SELF",
      shippingAddress: { ...(address || o.shippingAddress), noteForShipper: "" },
      noteForShop: `Đơn thay thế cho yêu cầu ${label} ${request.code} của đơn ${o.code}`,
      subtotal: 0, personalizationFee: 0, giftWrapFee: 0, shippingFee: 0, discount: 0, total: 0, vouchers: [],
      depositAmount: 0, remainingAmount: 0, paymentMethod: "COD", remainingMethod: null, paidAmount: 0, refundedAmount: 0,
      orderStatus: "CHO_XAC_NHAN",
      paymentStatus: "DA_THANH_TOAN",
      returnStatus: "KHONG_CO",
      sourceOrderCode: o.code,
      replacementFor: { kind, requestId: request._id, requestCode: request.code },
      statusHistory: [{ field: "orderStatus", from: null, to: "CHO_XAC_NHAN", at: now, by, byRole: "NHAN_VIEN", note: `Đơn thay thế 0đ cho yêu cầu ${label} ${request.code}` }],
      redeliveryCount: 0,
      internalNotes: [],
      createdAt: now,
      updatedAt: now,
    }
    doc._id = (await orders().insertOne(doc)).insertedId
    return doc
  } catch (err) {
    await rollback()
    throw err
  }
}

// Đơn thay thế tới DA_GIAO (API-92): yêu cầu gốc hoàn tất (06 orders.replacementFor). Lỗi không làm hỏng việc giao.
async function completeByReplacement(replacement, now = new Date()) {
  const f = replacement.replacementFor
  if (!f) return
  try {
    if (f.kind === "DOI_TRA") {
      const r = await database.collection("returnRequests").findOneAndUpdate(
        { _id: f.requestId, status: "DA_NHAN_HANG" },
        { $set: { status: "DA_HOAN_TAT", completedAt: now, updatedAt: now } },
        { returnDocument: "after" },
      )
      if (!r) return
      const o = await orders().findOne({ _id: r.orderId })
      await orders().updateOne(
        { _id: r.orderId, returnStatus: "DA_NHAN_HANG" },
        { $set: { returnStatus: "DA_HOAN_TAT", updatedAt: now }, $push: { statusHistory: ops.historyEntry("returnStatus", "DA_NHAN_HANG", "DA_HOAN_TAT", { byRole: "HE_THONG", at: now, note: `Đơn thay thế ${replacement.code} đã giao` }) } },
      )
      if (o) await ops.notifyOwner(o, { type: "DOI_TRA", title: `Yêu cầu đổi trả ${r.code} đã hoàn tất`, body: `Đơn thay thế ${replacement.code} đã được giao thành công.` })
    } else {
      const w = await database.collection("warrantyRequests").findOneAndUpdate(
        { _id: f.requestId, status: "DA_NHAN_HANG" },
        { $set: { status: "HOAN_TAT", completedAt: now, updatedAt: now }, $push: { progressNotes: { at: now, text: `Đã giao sản phẩm mới (đơn ${replacement.code})`, by: null } } },
        { returnDocument: "after" },
      )
      if (!w) return
      const o = await orders().findOne({ _id: w.orderId })
      if (o) await ops.notifyOwner(o, { type: "BAO_HANH", title: `Yêu cầu bảo hành ${w.code} đã hoàn tất`, body: `Sản phẩm mới (đơn ${replacement.code}) đã được giao thành công.` })
    }
  } catch (err) {
    console.error("Hoàn tất yêu cầu theo đơn thay thế lỗi:", err.message)
  }
}

module.exports = { IMAGE_TYPES, isFileUrl, saveFiles, removeFiles, saveEvidence, readAddress, requestCode, createReplacement, completeByReplacement }
