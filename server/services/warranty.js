// Bảo hành (UC-TRK-05 phía khách, UC-OPS-07 nhánh 1a phía nhân viên; API-52, API-101). Hạn bảo hành tính từ
// deliveredAt (BR-17). Mỗi dòng sản phẩm chỉ có 1 yêu cầu chưa kết thúc (3Eb). Yêu cầu bị từ chối không đổi trạng thái đơn.
const { database, ObjectId } = require("../config/db")
const params = require("../config/params")
const HttpError = require("../utils/httpError")
const rules = require("./afterSalesRules")
const common = require("./afterSalesCommon")
const myOrders = require("./myOrders")
const ops = require("./orderOps")
const { CARRIERS } = require("./opsRules")
const { writeLog } = require("./adminLog")
const { getStoreSettings } = require("./settings")

const requests = () => database.collection("warrantyRequests")
const orders = () => database.collection("orders")
const products = () => database.collection("products")
const HOUR = 60 * 60 * 1000

const fail = (e) => new HttpError(e.status, e.code, e.message, { ...(e.fields ? { fields: e.fields } : {}), ...(e.rule ? { rule: e.rule } : {}) })
const canOf = (req) => (code) => !!req.isFullAccess || req.permissions.has(code)
function forbid(req, code) {
  if (!canOf(req)(code)) throw new HttpError(403, "FORBIDDEN", "Bạn không có quyền thực hiện thao tác này")
}
const loadById = async (id) => {
  const w = ObjectId.isValid(String(id)) ? await requests().findOne({ _id: new ObjectId(String(id)) }) : null
  if (!w) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy yêu cầu bảo hành")
  return w
}

// ===== Dữ liệu hiển thị =====

function view(w, o, { store = null, staff = false } = {}) {
  const it = (o?.items || []).find((i) => String(i._id) === String(w.orderItemId)) || {}
  return {
    kind: "WARRANTY",
    _id: String(w._id),
    code: w.code,
    orderCode: w.orderCode,
    status: w.status,
    statusLabel: rules.WARRANTY_STATUS[w.status] || w.status,
    item: { orderItemId: String(w.orderItemId), name: it.name || "", variantName: it.variantName || null, image: it.image || null, quantity: it.quantity || 1, personalizationText: myOrders.personalizationText(it.personalization) },
    symptom: w.symptom,
    symptomLabel: rules.WARRANTY_SYMPTOMS[w.symptom] || w.symptom,
    description: w.description,
    images: w.images || [],
    shippingMethod: w.shippingMethod,
    shippingMethodLabel: rules.SHIPPING_METHODS[w.shippingMethod] || w.shippingMethod,
    pickupAddress: w.pickupAddress || null,
    // "Tự gửi đến cửa hàng" thấy địa chỉ kho ngay khi gửi (UC-TRK-05 bước 2)
    returnAddress: w.shippingMethod === "TU_GUI" || staff || ["DA_DUYET", "DA_NHAN_HANG"].includes(w.status) ? store?.returnAddress || null : null,
    warrantyUntil: w.warrantyUntil,
    resolution: w.resolution || null,
    resolutionLabel: w.resolution ? rules.WARRANTY_RESOLUTIONS[w.resolution] : null,
    returnInstruction: w.returnInstruction || null,
    returnCarrier: w.returnCarrier || null,
    returnCarrierLabel: w.returnCarrier ? CARRIERS[w.returnCarrier] : null,
    returnTrackingCode: w.returnTrackingCode || null,
    progressNotes: (w.progressNotes || []).map((n) => ({ at: n.at, text: n.text })).sort((a, b) => new Date(b.at) - new Date(a.at)),
    reject: w.reject
      ? { reasonCode: w.reject.reasonCode, reasonLabel: rules.REJECT_REASONS[w.reject.reasonCode]?.label || w.reject.reasonCode, detail: w.reject.detail, evidence: w.reject.evidence || [], at: w.reject.at }
      : null,
    replacementOrderCode: w.replacementOrderCode && w.replacementOrderCode !== "DANG_TAO" ? w.replacementOrderCode : null,
    slaDeadline: w.slaDeadline,
    createdAt: w.createdAt,
    decidedAt: w.decidedAt || null,
    receivedAt: w.receivedAt || null,
    completedAt: w.completedAt || null,
    progress: rules.warrantyProgress(w),
  }
}

async function forOrder(o, { store = null } = {}) {
  const list = await requests().find({ orderId: o._id }).sort({ createdAt: -1 }).toArray()
  const s = store || (await getStoreSettings()).store
  return list.map((w) => view(w, o, { store: s }))
}

// Thông tin bảo hành từng dòng cho chi tiết đơn (SCR-19 nút "Yêu cầu bảo hành", khung "Thông tin bảo hành" SCR-26)
async function itemStates(o, now = new Date()) {
  const ids = [...new Set(o.items.map((it) => String(it.productId)))].map((x) => new ObjectId(x))
  const months = new Map((await products().find({ _id: { $in: ids } }, { projection: { warrantyMonths: 1 } }).toArray()).map((p) => [String(p._id), p.warrantyMonths || 0]))
  const list = await requests().find({ orderId: o._id }, { projection: { orderItemId: 1, status: 1 } }).toArray()
  const out = new Map()
  for (const it of o.items) {
    const mine = list.filter((w) => String(w.orderItemId) === String(it._id))
    const s = rules.warrantyState(o, it, months.get(String(it.productId)) || 0, { openCount: mine.filter((w) => rules.WARRANTY_OPEN.includes(w.status)).length, now })
    out.set(String(it._id), { ...s, count: mine.filter((w) => w.status === "HOAN_TAT").length })
  }
  return out
}

// ===== API-52 gửi yêu cầu =====

async function create(user, code, body) {
  const now = new Date()
  const o = await myOrders.ownOrder(user, code)
  const it = o.items.find((i) => String(i._id) === String(body.orderItemId))
  if (!it) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy sản phẩm trong đơn")
  const state = (await itemStates(o, now)).get(String(it._id))
  if (!state.months) throw new HttpError(422, "BUSINESS_RULE", "Sản phẩm này không có bảo hành", { rule: "BR-17" })
  if (!["DA_GIAO", "HOAN_THANH"].includes(o.orderStatus) || state.expired) {
    const d = state.until ? new Date(state.until.getTime() + 7 * HOUR).toISOString().slice(0, 10).split("-").reverse().join("/") : ""
    throw new HttpError(422, "BUSINESS_RULE", state.expired ? `Sản phẩm đã hết thời hạn bảo hành từ ngày ${d}` : "Đơn hàng chưa được giao", { rule: "BR-17" })
  }
  if (state.open) throw new HttpError(409, "ALREADY_REQUESTED", "Sản phẩm đang có yêu cầu bảo hành chưa kết thúc")

  const images = Array.isArray(body.images) ? body.images : []
  const checked = rules.checkWarranty(body, { imageCount: images.length })
  if (checked.error) throw fail(checked.error)
  const v = checked.value
  const pickupAddress = v.shippingMethod === "SHIPPER_LAY" ? await common.readAddress(user, body) : null
  const urls = await common.saveFiles(images, { ownerUserId: user._id, uploadedBy: user._id, label: "Ảnh bảo hành" })
  const doc = {
    code: await common.requestCode("BH", "warranty", now),
    orderId: o._id,
    orderCode: o.code,
    orderItemId: it._id,
    productId: it.productId,
    userId: user._id,
    symptom: v.symptom,
    description: v.description,
    images: urls,
    shippingMethod: v.shippingMethod,
    pickupAddress,
    warrantyUntil: state.until,
    status: "DANG_XEM_XET",
    progressNotes: [],
    slaDeadline: new Date(now.getTime() + params.AFTERSALES_SLA_HOURS * HOUR),
    createdAt: now,
    updatedAt: now,
  }
  try {
    doc._id = (await requests().insertOne(doc)).insertedId
  } catch (err) {
    await common.removeFiles(urls)
    throw err
  }
  // 2 lần gửi cùng lúc: kiểm tra lại sau khi ghi, giữ yêu cầu đầu tiên
  const open = await requests().countDocuments({ orderItemId: it._id, status: { $in: rules.WARRANTY_OPEN } })
  if (open > 1) {
    await requests().deleteOne({ _id: doc._id })
    await common.removeFiles(urls)
    throw new HttpError(409, "ALREADY_REQUESTED", "Sản phẩm đang có yêu cầu bảo hành chưa kết thúc")
  }
  await ops.notifyOwner(o, { type: "BAO_HANH", title: `Đã tiếp nhận yêu cầu bảo hành ${doc.code}`, body: `${it.name}: Soulprint sẽ phản hồi trong 24-48 giờ làm việc.` })
  return { warrantyRequest: view(doc, o, { store: (await getStoreSettings()).store }) }
}

// ===== API-101 nhân viên xử lý =====

async function move(w, to, set, now) {
  const u = await requests().updateOne({ _id: w._id, status: w.status }, { $set: { status: to, ...set, updatedAt: now } })
  if (!u.modifiedCount) throw new HttpError(409, "INVALID_TRANSITION", "Yêu cầu đã được xử lý, vui lòng tải lại")
}

async function adminUpdate(req, id, body) {
  const w = await loadById(id)
  const o = await orders().findOne({ _id: w.orderId })
  if (!o) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy đơn hàng của yêu cầu")
  const allowed = rules.warrantyActions(w, canOf(req))
  const by = req.user._id
  const now = new Date()
  let summary
  let notice

  if (body.decision === "DA_DUYET") {
    forbid(req, "HAU_MAI.DUYET_TU_CHOI")
    if (!allowed.approve) throw new HttpError(409, "INVALID_TRANSITION", "Chỉ duyệt được yêu cầu đang xem xét")
    const resolution = String(body.resolution || "")
    if (!rules.WARRANTY_RESOLUTIONS[resolution]) throw new HttpError(422, "VALIDATION_ERROR", "Chọn Sửa chữa hoặc Đổi sản phẩm mới", { fields: { resolution: "Chọn cách xử lý" } })
    const instruction = rules.text(body.returnInstruction, 1000)
    const carrier = body.returnCarrier ? String(body.returnCarrier) : null
    if (carrier && !CARRIERS[carrier]) throw new HttpError(422, "VALIDATION_ERROR", "Đơn vị vận chuyển không hợp lệ", { fields: { returnCarrier: "Chọn lại" } })
    const tracking = String(body.returnTrackingCode || "").trim().toUpperCase()
    if (tracking && !/^[A-Z0-9-]{4,40}$/.test(tracking)) throw new HttpError(422, "VALIDATION_ERROR", "Mã vận đơn 4-40 chữ, số", { fields: { returnTrackingCode: "Mã vận đơn không hợp lệ" } })
    await move(w, "DA_DUYET", { resolution, returnInstruction: instruction || null, returnCarrier: carrier, returnTrackingCode: tracking || null, decidedAt: now, decidedBy: by }, now)
    summary = `duyệt: ${rules.WARRANTY_RESOLUTIONS[resolution]}`
    notice = { title: `Yêu cầu bảo hành ${w.code} đã được duyệt`, body: `Cách xử lý: ${rules.WARRANTY_RESOLUTIONS[resolution]}. ${w.shippingMethod === "TU_GUI" ? "Vui lòng gửi sản phẩm về địa chỉ cửa hàng." : "Shipper sẽ liên hệ lấy sản phẩm."}` }
  } else if (body.received === true) {
    forbid(req, "HAU_MAI.XAC_NHAN_NHAN_HANG")
    if (!allowed.received) throw new HttpError(409, "INVALID_TRANSITION", "Yêu cầu chưa ở bước chờ nhận sản phẩm")
    await move(w, "DA_NHAN_HANG", { receivedAt: now, receivedBy: by }, now)
    summary = "xác nhận đã nhận sản phẩm"
    notice = { title: `Soulprint đã nhận sản phẩm bảo hành ${w.code}`, body: "Sản phẩm đang được kiểm tra, sửa chữa." }
  } else if (typeof body.progressNote === "string") {
    forbid(req, "HAU_MAI.SUA")
    if (!allowed.progressNote) throw new HttpError(409, "INVALID_TRANSITION", "Yêu cầu đã kết thúc")
    const note = rules.text(body.progressNote, 1000)
    if (!note || rules.charCount(note) > params.AFTERSALES_TEXT_MAX) throw new HttpError(422, "VALIDATION_ERROR", `Nhập tiến độ (1-${params.AFTERSALES_TEXT_MAX} ký tự)`, { fields: { progressNote: "Nhập tiến độ" } })
    await requests().updateOne({ _id: w._id }, { $push: { progressNotes: { at: now, text: note, by } }, $set: { updatedAt: now } })
    summary = "cập nhật tiến độ"
    notice = { title: `Cập nhật bảo hành ${w.code}`, body: note }
  } else if (body.complete === true) {
    forbid(req, "HAU_MAI.HOAN_TIEN")
    if (!allowed.complete) throw new HttpError(409, "INVALID_TRANSITION", "Chỉ hoàn tất được yêu cầu đã nhận sản phẩm")
    if (w.resolution === "DOI_MOI") {
      const claim = await requests().updateOne({ _id: w._id, status: "DA_NHAN_HANG", replacementOrderCode: null }, { $set: { replacementOrderCode: "DANG_TAO" } })
      if (!claim.modifiedCount) throw new HttpError(409, "INVALID_TRANSITION", "Yêu cầu đã được xử lý, vui lòng tải lại")
      let rep
      try {
        const item = o.items.find((i) => String(i._id) === String(w.orderItemId))
        rep = await common.createReplacement(o, [{ item, quantity: 1 }], { kind: "BAO_HANH", request: w, address: w.pickupAddress || o.shippingAddress, by, now })
      } catch (err) {
        await requests().updateOne({ _id: w._id }, { $set: { replacementOrderCode: null } })
        throw err
      }
      await requests().updateOne({ _id: w._id }, { $set: { replacementOrderCode: rep.code, updatedAt: now }, $push: { progressNotes: { at: now, text: `Đã tạo đơn sản phẩm mới ${rep.code}`, by } } })
      summary = `tạo đơn sản phẩm mới ${rep.code}`
      notice = { title: `Bảo hành ${w.code}: Soulprint đổi sản phẩm mới`, body: `Đơn ${rep.code} (0đ) đã được tạo, bạn theo dõi như đơn hàng thường.`, link: `/tai-khoan/don-hang/${rep.code}` }
    } else {
      await move(w, "HOAN_TAT", { completedAt: now }, now)
      summary = "hoàn tất sửa chữa"
      notice = { title: `Bảo hành ${w.code} đã hoàn tất`, body: "Sản phẩm đã sửa xong và được giao trả cho bạn." }
    }
  } else if (body.decision === "TU_CHOI") {
    forbid(req, "HAU_MAI.DUYET_TU_CHOI")
    if (!allowed.reject) throw new HttpError(409, "INVALID_TRANSITION", "Không thể từ chối yêu cầu ở bước này")
    const reasonCode = String(body.reasonCode || "")
    if (!rules.REJECT_REASONS[reasonCode]) throw new HttpError(422, "VALIDATION_ERROR", "Chọn lý do từ chối", { fields: { reasonCode: "Chọn lý do" } })
    const detail = rules.text(body.detail, 2000)
    const n = rules.charCount(detail)
    if (n < params.REJECT_REASON_MIN || n > params.REJECT_REASON_MAX) {
      throw new HttpError(422, "VALIDATION_ERROR", n < params.REJECT_REASON_MIN ? `Vui lòng nhập tối thiểu ${params.REJECT_REASON_MIN} ký tự` : `Tối đa ${params.REJECT_REASON_MAX} ký tự`, { fields: { detail: "Độ dài chưa đúng" } })
    }
    const evidence = await common.saveEvidence(body.evidence, { ownerUserId: w.userId, uploadedBy: by })
    try {
      await move(w, "TU_CHOI", { reject: { reasonCode, detail, evidence, allowResubmit: false, at: now, by }, decidedAt: w.decidedAt || now, decidedBy: w.decidedBy || by }, now)
    } catch (err) {
      await common.removeFiles(evidence)
      throw err
    }
    summary = `từ chối: ${rules.REJECT_REASONS[reasonCode].label}`
    notice = { title: `Yêu cầu bảo hành ${w.code} chưa được chấp nhận`, body: `${rules.REJECT_REASONS[reasonCode].label}. Xem chi tiết lý do trong đơn hàng.` }
  } else {
    throw new HttpError(400, "VALIDATION_ERROR", "Thao tác không hợp lệ")
  }

  await writeLog({ adminId: by, action: "WARRANTY_UPDATE", targetType: "warrantyRequests", targetId: w._id, before: { status: w.status }, after: { summary: `Bảo hành ${w.code}: ${summary}` } })
  await ops.notifyOwner(o, { type: "BAO_HANH", ...notice })
}

module.exports = { view, forOrder, itemStates, create, adminUpdate, loadById }
