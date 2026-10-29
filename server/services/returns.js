// Đổi trả (UC-TRK-04 phía khách, UC-OPS-07 phía nhân viên; API-50, API-51, API-100). Quy tắc thuần ở
// afterSalesRules.js. Trạng thái yêu cầu và returnStatus của đơn đi cùng nhau theo 05 Mục 2.3; mỗi bước là updateOne có
// điều kiện trạng thái hiện tại để 2 nhân viên bấm cùng lúc chỉ 1 người thành công.
const { database, ObjectId } = require("../config/db")
const params = require("../config/params")
const HttpError = require("../utils/httpError")
const rules = require("./afterSalesRules")
const common = require("./afterSalesCommon")
const myOrders = require("./myOrders")
const ops = require("./orderOps")
const st = require("./orderState")
const { CARRIERS } = require("./opsRules")
const { writeLog } = require("./adminLog")
const { fmt } = require("./checkoutMath")
const { getStoreSettings } = require("./settings")

const requests = () => database.collection("returnRequests")
const orders = () => database.collection("orders")
const users = () => database.collection("users")
const HOUR = 60 * 60 * 1000

const fail = (e) => new HttpError(e.status, e.code, e.message, { ...(e.fields && Object.keys(e.fields).length ? { fields: e.fields } : {}), ...(e.rule ? { rule: e.rule } : {}) })
const canOf = (req) => (code) => !!req.isFullAccess || req.permissions.has(code)
function forbid(req, code) {
  if (!canOf(req)(code)) throw new HttpError(403, "FORBIDDEN", "Bạn không có quyền thực hiện thao tác này")
}
const loadById = async (id) => {
  const r = ObjectId.isValid(String(id)) ? await requests().findOne({ _id: new ObjectId(String(id)) }) : null
  if (!r) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy yêu cầu đổi trả")
  return r
}

// returnStatus của đơn theo trạng thái yêu cầu; hủy hoặc từ chối cho gửi lại thì về KHONG_CO (05 Mục 2.3)
const orderStatusOf = (status) => (status === "DA_HUY" ? "KHONG_CO" : status)

// Đổi trạng thái yêu cầu và đơn cùng lúc. orderTo khác mặc định khi từ chối cho gửi lại.
async function move(r, to, { set = {}, by = null, byRole = "NHAN_VIEN", note = null, orderTo = orderStatusOf(to), now = new Date() } = {}) {
  const u = await requests().updateOne({ _id: r._id, status: r.status }, { $set: { status: to, ...set, updatedAt: now } })
  if (!u.modifiedCount) throw new HttpError(409, "INVALID_TRANSITION", "Yêu cầu đã được xử lý, vui lòng tải lại")
  const from = orderStatusOf(r.status)
  if (from !== orderTo) {
    await orders().updateOne(
      { _id: r.orderId, returnStatus: from },
      { $set: { returnStatus: orderTo, updatedAt: now }, $push: { statusHistory: ops.historyEntry("returnStatus", from, orderTo, { by, byRole, at: now, note: note || `Yêu cầu ${r.code}` }) } },
    )
  }
}

// ===== Dữ liệu hiển thị =====

const maskBank = (b) => (b ? { bankName: b.bankName, accountName: b.accountName, account: st.maskAccount(b.accountNumber) } : null)

// Dùng cho khách (API-43, API-42 tab đổi trả) và nhân viên (API-196); staff = true thì thêm số tài khoản đầy đủ
function view(r, o, { store = null, staff = false } = {}) {
  const items = (r.items || []).map((x) => {
    const it = (o?.items || []).find((i) => String(i._id) === String(x.orderItemId)) || {}
    return {
      orderItemId: String(x.orderItemId), name: it.name || "", variantName: it.variantName || null, image: it.image || null, isPersonalized: !!it.isPersonalized,
      personalizationText: myOrders.personalizationText(it.personalization), quantity: x.quantity, unitPrice: it.unitPrice || 0, lineValue: x.lineValue,
      reason: x.reason, reasonLabel: rules.RETURN_REASONS[x.reason]?.label || x.reason, reasonShort: rules.RETURN_REASONS[x.reason]?.short || x.reason,
    }
  })
  return {
    kind: "RETURN",
    _id: String(r._id),
    code: r.code,
    orderCode: r.orderCode,
    status: r.status,
    statusLabel: rules.RETURN_STATUS[r.status] || r.status,
    resolution: r.resolution,
    resolutionLabel: rules.RESOLUTIONS[r.resolution] || r.resolution,
    items,
    value: rules.returnValue(r),
    description: r.description || "",
    images: r.images || [],
    conditionConfirmed: !!r.conditionConfirmed,
    pickupAddress: r.pickupAddress || null,
    bankInfo: staff && r.bankInfo ? { ...r.bankInfo } : maskBank(r.bankInfo),
    returnInstruction: r.returnInstruction || null,
    returnAddress: ["DONG_Y", "DA_NHAN_HANG"].includes(r.status) || staff ? store?.returnAddress || null : null,
    returnCarrier: r.returnCarrier || null,
    returnCarrierLabel: r.returnCarrier ? CARRIERS[r.returnCarrier] : null,
    returnTrackingCode: r.returnTrackingCode || null,
    reject: r.reject
      ? { reasonCode: r.reject.reasonCode, reasonLabel: rules.REJECT_REASONS[r.reject.reasonCode]?.label || r.reject.reasonCode, detail: r.reject.detail, evidence: r.reject.evidence || [], allowResubmit: !!r.reject.allowResubmit, at: r.reject.at }
      : null,
    refundWithoutReturn: !!r.refundWithoutReturn,
    refundWithoutReturnReason: staff ? r.refundWithoutReturnReason || null : null,
    refundAmount: r.refundAmount ?? null,
    replacementOrderCode: r.replacementOrderCode && r.replacementOrderCode !== "DANG_TAO" ? r.replacementOrderCode : null,
    slaDeadline: r.slaDeadline,
    createdAt: r.createdAt,
    decidedAt: r.decidedAt || null,
    receivedAt: r.receivedAt || null,
    completedAt: r.completedAt || null,
    progress: rules.returnProgress(r),
    canCancel: r.status === "DANG_YEU_CAU",
  }
}

async function forOrder(o, { store = null } = {}) {
  const list = await requests().find({ orderId: o._id }).sort({ createdAt: -1 }).toArray()
  const s = store || (await getStoreSettings()).store
  return list.map((r) => view(r, o, { store: s }))
}

// ===== API-50 gửi yêu cầu =====

async function create(user, code, body) {
  const now = new Date()
  const o = await myOrders.ownOrder(user, code)
  const images = Array.isArray(body.images) ? body.images : []
  const checked = rules.checkReturn(o, body, { imageCount: images.length, now })
  if (checked.error) throw fail(checked.error)
  const v = checked.value

  const pickupAddress = await common.readAddress(user, body)
  const refundTo = v.resolution === "HOAN_TIEN" ? await myOrders.chooseRefundAccount(user, body) : null
  const urls = await common.saveFiles(images, { ownerUserId: user._id, uploadedBy: user._id, label: "Ảnh đổi trả" })

  // Giữ chỗ trên đơn trước (2 lần bấm gửi cùng lúc chỉ 1 lần qua)
  const claim = await orders().updateOne({ _id: o._id, returnStatus: { $in: [null, "KHONG_CO"] } }, { $set: { returnStatus: "DANG_YEU_CAU", updatedAt: now } })
  if (!claim.modifiedCount) {
    await common.removeFiles(urls)
    throw new HttpError(409, "ALREADY_REQUESTED", "Đơn hàng đang có yêu cầu đổi trả")
  }
  const doc = {
    code: await common.requestCode("DT", "return", now),
    orderId: o._id,
    orderCode: o.code,
    userId: user._id,
    items: v.items,
    resolution: v.resolution,
    description: v.description,
    images: urls,
    pickupAddress,
    bankInfo: refundTo ? refundTo.account : null,
    conditionConfirmed: v.conditionConfirmed,
    status: "DANG_YEU_CAU",
    slaDeadline: new Date(now.getTime() + params.AFTERSALES_SLA_HOURS * HOUR),
    createdAt: now,
    updatedAt: now,
  }
  try {
    doc._id = (await requests().insertOne(doc)).insertedId
  } catch (err) {
    await orders().updateOne({ _id: o._id, returnStatus: "DANG_YEU_CAU" }, { $set: { returnStatus: "KHONG_CO" } })
    await common.removeFiles(urls)
    throw err
  }
  await orders().updateOne({ _id: o._id }, { $push: { statusHistory: ops.historyEntry("returnStatus", "KHONG_CO", "DANG_YEU_CAU", { by: user._id, byRole: "KHACH", at: now, note: `Yêu cầu ${doc.code}` }) } })
  if (refundTo?.save) await users().updateOne({ _id: user._id }, { $set: { refundAccount: { ...refundTo.account, savedAt: now }, updatedAt: now } })
  await ops.notifyOwner(o, {
    type: "DOI_TRA",
    title: `Đã gửi yêu cầu đổi trả ${doc.code}`,
    body: "Soulprint sẽ phản hồi trong 24-48 giờ làm việc và chịu phí vận chuyển trả hàng.",
  })
  return { returnRequest: view(doc, o, { store: (await getStoreSettings()).store }) }
}

// ===== API-51 hủy yêu cầu =====

async function cancel(user, id) {
  const r = await loadById(id)
  if (String(r.userId) !== String(user._id)) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy yêu cầu đổi trả")
  if (r.status !== "DANG_YEU_CAU") throw new HttpError(409, "INVALID_TRANSITION", "Yêu cầu đã được xử lý, không thể hủy")
  await move(r, "DA_HUY", { by: user._id, byRole: "KHACH", note: `Khách hủy yêu cầu ${r.code}` })
}

// ===== API-100 nhân viên xử lý =====

const reasonText = (x, label) => {
  const s = rules.text(x, 2000)
  const n = rules.charCount(s)
  if (n < params.REJECT_REASON_MIN) throw new HttpError(422, "VALIDATION_ERROR", `Vui lòng nhập tối thiểu ${params.REJECT_REASON_MIN} ký tự`, { fields: { [label]: `Tối thiểu ${params.REJECT_REASON_MIN} ký tự` } })
  if (n > params.REJECT_REASON_MAX) throw new HttpError(422, "VALIDATION_ERROR", `Tối đa ${params.REJECT_REASON_MAX} ký tự`, { fields: { [label]: `Tối đa ${params.REJECT_REASON_MAX} ký tự` } })
  return s
}

function readAmount(value, max, fallback) {
  const amount = value === undefined || value === null || value === "" ? fallback : Number(value)
  if (max <= 0) return 0
  if (!Number.isInteger(amount) || amount < 1 || amount > max) {
    throw new HttpError(422, "VALIDATION_ERROR", `Số tiền hoàn từ 1đ đến ${fmt(max)}`, { fields: { refundAmount: `Tối đa ${fmt(max)}` } })
  }
  return amount
}

// Tạo yêu cầu hoàn tiền chuyển khoản tới tài khoản khách đã nhập (UC-OPS-07 bước 7)
async function openReturnRefund(r, o, amount, { by, now }) {
  if (!(amount > 0)) return null
  return ops.openRefund(o, { reason: "DOI_TRA", amount, by, bankInfo: r.bankInfo || null, note: `Yêu cầu đổi trả ${r.code}`, now })
}

async function adminUpdate(req, id, body) {
  const r = await loadById(id)
  const o = await orders().findOne({ _id: r.orderId })
  if (!o) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy đơn hàng của yêu cầu")
  const can = canOf(req)
  const allowed = rules.returnActions(r, can)
  const by = req.user._id
  const now = new Date()
  let summary
  let notice = null

  if (body.decision === "DONG_Y") {
    forbid(req, "HAU_MAI.DUYET_TU_CHOI")
    if (!allowed.approve) throw new HttpError(409, "INVALID_TRANSITION", "Chỉ duyệt được yêu cầu đang chờ duyệt")
    const instruction = rules.text(body.returnInstruction, 1000)
    if (rules.charCount(instruction) < 10) throw new HttpError(422, "VALIDATION_ERROR", "Nhập hướng dẫn gửi hàng cho khách", { fields: { returnInstruction: "Nhập hướng dẫn gửi hàng" } })
    const carrier = body.returnCarrier ? String(body.returnCarrier) : null
    if (carrier && !CARRIERS[carrier]) throw new HttpError(422, "VALIDATION_ERROR", "Đơn vị vận chuyển không hợp lệ", { fields: { returnCarrier: "Chọn lại" } })
    const tracking = String(body.returnTrackingCode || "").trim().toUpperCase()
    if (tracking && !/^[A-Z0-9-]{4,40}$/.test(tracking)) throw new HttpError(422, "VALIDATION_ERROR", "Mã vận đơn 4-40 chữ, số", { fields: { returnTrackingCode: "Mã vận đơn không hợp lệ" } })
    await move(r, "DONG_Y", { by, now, set: { returnInstruction: instruction, returnCarrier: carrier, returnTrackingCode: tracking || null, decidedAt: now, decidedBy: by } })
    summary = "duyệt, gửi hướng dẫn thu hồi hàng"
    notice = { title: `Yêu cầu đổi trả ${r.code} đã được duyệt`, body: "Vui lòng đóng gói sản phẩm theo hướng dẫn. Soulprint chịu phí vận chuyển gửi về." }
  } else if (body.received === true) {
    forbid(req, "HAU_MAI.XAC_NHAN_NHAN_HANG")
    if (!allowed.received) throw new HttpError(409, "INVALID_TRANSITION", "Yêu cầu chưa ở bước chờ gửi hàng về")
    await move(r, "DA_NHAN_HANG", { by, now, set: { receivedAt: now, receivedBy: by } })
    summary = "xác nhận đã nhận hàng trả về"
    notice = { title: `Soulprint đã nhận hàng của yêu cầu ${r.code}`, body: "Sản phẩm đang được kiểm tra, Soulprint sẽ báo kết quả sớm." }
  } else if (body.complete === true) {
    forbid(req, "HAU_MAI.HOAN_TIEN")
    if (!allowed.complete) throw new HttpError(409, "INVALID_TRANSITION", "Chỉ hoàn tất được yêu cầu đã nhận hàng")
    if (r.resolution === "GIAO_LAI") {
      // Giữ chỗ để không tạo 2 đơn thay thế khi bấm 2 lần
      const claim = await requests().updateOne({ _id: r._id, status: "DA_NHAN_HANG", replacementOrderCode: null }, { $set: { replacementOrderCode: "DANG_TAO" } })
      if (!claim.modifiedCount) throw new HttpError(409, "INVALID_TRANSITION", "Yêu cầu đã được xử lý, vui lòng tải lại")
      let rep
      try {
        const lines = r.items.map((x) => ({ item: o.items.find((i) => String(i._id) === String(x.orderItemId)), quantity: x.quantity })).filter((l) => l.item)
        rep = await common.createReplacement(o, lines, { kind: "DOI_TRA", request: r, address: r.pickupAddress, by, now })
      } catch (err) {
        await requests().updateOne({ _id: r._id }, { $set: { replacementOrderCode: null } })
        throw err
      }
      await requests().updateOne({ _id: r._id }, { $set: { replacementOrderCode: rep.code, updatedAt: now } })
      summary = `tạo đơn thay thế ${rep.code}`
      notice = { title: `Yêu cầu đổi trả ${r.code}: Soulprint giao hàng lại`, body: `Đơn thay thế ${rep.code} (0đ) đã được tạo, bạn theo dõi như đơn hàng thường.`, link: `/tai-khoan/don-hang/${rep.code}` }
    } else {
      const amount = readAmount(body.refundAmount, rules.refundableOf(o), rules.defaultRefund(r, o))
      await move(r, "DA_HOAN_TAT", { by, now, set: { refundAmount: amount, completedAt: now } })
      const refund = await openReturnRefund(r, o, amount, { by, now })
      if (refund) await requests().updateOne({ _id: r._id }, { $set: { refundId: refund._id } })
      summary = `hoàn tất, hoàn ${fmt(amount)}`
      notice = { type: "HOAN_TIEN", title: `Yêu cầu đổi trả ${r.code} đã hoàn tất`, body: amount > 0 ? `Soulprint sẽ chuyển khoản ${fmt(amount)} cho bạn, tối đa 5 ngày làm việc.` : "Cảm ơn bạn đã gửi trả sản phẩm." }
    }
  } else if (body.refundWithoutReturn === true) {
    forbid(req, "HAU_MAI.HOAN_TIEN")
    if (!allowed.refundNow) throw new HttpError(409, "INVALID_TRANSITION", "Không thể hoàn tiền ngay ở bước này")
    const reason = reasonText(body.reason, "reason")
    const amount = readAmount(body.refundAmount, rules.refundableOf(o), rules.defaultRefund(r, o))
    await move(r, "DA_HOAN_TAT", { by, now, note: `Hoàn tiền không cần trả hàng: ${reason}`, set: { refundWithoutReturn: true, refundWithoutReturnReason: reason, refundAmount: amount, decidedAt: r.decidedAt || now, decidedBy: r.decidedBy || by, completedAt: now } })
    const refund = await openReturnRefund(r, o, amount, { by, now })
    if (refund) await requests().updateOne({ _id: r._id }, { $set: { refundId: refund._id } })
    summary = `hoàn tiền ngay ${fmt(amount)}`
    notice = { type: "HOAN_TIEN", title: `Yêu cầu đổi trả ${r.code}: Soulprint hoàn tiền cho bạn`, body: `Bạn không cần gửi trả hàng. Soulprint sẽ chuyển khoản ${fmt(amount)}, tối đa 5 ngày làm việc.` }
  } else if (body.decision === "TU_CHOI") {
    forbid(req, "HAU_MAI.DUYET_TU_CHOI")
    if (!allowed.reject) throw new HttpError(409, "INVALID_TRANSITION", "Không thể từ chối yêu cầu ở bước này")
    const reasonCode = String(body.reasonCode || "")
    if (!rules.REJECT_REASONS[reasonCode]) throw new HttpError(422, "VALIDATION_ERROR", "Chọn lý do từ chối", { fields: { reasonCode: "Chọn lý do" } })
    const detail = reasonText(body.detail, "detail")
    const evidence = await common.saveEvidence(body.evidence, { ownerUserId: r.userId, uploadedBy: by })
    const allowResubmit = body.allowResubmit === true
    const reopen = allowResubmit && rules.withinReturnWindow(o, now)
    try {
      await move(r, "TU_CHOI", {
        by, now, note: `Từ chối: ${rules.REJECT_REASONS[reasonCode].label}`, orderTo: reopen ? "KHONG_CO" : "TU_CHOI",
        set: { reject: { reasonCode, detail, evidence, allowResubmit, at: now, by }, decidedAt: r.decidedAt || now, decidedBy: r.decidedBy || by },
      })
    } catch (err) {
      await common.removeFiles(evidence)
      throw err
    }
    summary = `từ chối: ${rules.REJECT_REASONS[reasonCode].label}`
    notice = {
      title: `Yêu cầu đổi trả ${r.code} chưa được chấp nhận`,
      body: `${rules.REJECT_REASONS[reasonCode].label}. ${reopen ? "Bạn có thể gửi lại yêu cầu với ảnh mới." : "Xem chi tiết lý do trong đơn hàng."}`,
    }
  } else {
    throw new HttpError(400, "VALIDATION_ERROR", "Thao tác không hợp lệ")
  }

  await writeLog({ adminId: by, action: "RETURN_UPDATE", targetType: "returnRequests", targetId: r._id, before: { status: r.status }, after: { summary: `Đổi trả ${r.code}: ${summary}` } })
  if (notice) await ops.notifyOwner(o, { type: "DOI_TRA", ...notice })
}

module.exports = { view, forOrder, create, cancel, adminUpdate, loadById }
