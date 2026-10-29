// Thanh toán online qua cổng (UC-PAY-04 nhánh 5b, SEQ-01; 07_API_Spec.md API-38 bước 5, API-39, API-40, API-191).
// Đơn chỉ được tạo khi cổng báo thành công: API-38 lưu bản chụp đơn (order.prepare) vào giao dịch PENDING hạn 15 phút,
// kết quả thành công mới gọi order.place với bản chụp đó (S5 viết sẵn). Trạng thái giao dịch:
//   PENDING -> SUCCESS (tạo đơn) | FAILED (thất bại, khách hủy, hết hạn);  SUCCESS -> REFUNDED (tạo đơn lỗi, hoàn qua cổng)
// Mỗi bước chuyển là 1 lệnh cập nhật có điều kiện trạng thái cũ, nên kết quả gửi 2 lần chỉ xử lý 1 lần (AC6).
const { database, ObjectId } = require("../config/db")
const params = require("../config/params")
const HttpError = require("../utils/httpError")
const math = require("./checkoutMath")
const order = require("./order")
const { getStoreSettings } = require("./settings")
const { nextSequence } = require("./giftAdmin")
const { writeLog } = require("./adminLog")
const { gateway } = require("./paymentGateway")

const payments = () => database.collection("payments")

// Mã giao dịch GD + yyMMdd (giờ Việt Nam) + 4 số thứ tự trong ngày
function paymentCode(now, seq) {
  return "GD" + math.vnDate(now).slice(2).replace(/-/g, "") + String(seq).padStart(4, "0")
}

// Nội dung giao dịch hiện ở SCR-08
function describe(option, depositRate) {
  return option.key === "DEPOSIT_COD" ? `Đặt cọc ${Math.round(depositRate * 100)}% món cá nhân hóa` : "Thanh toán toàn bộ đơn hàng"
}

// Thông tin khách đã nhập ở SCR-07, giữ lại để "Thử lại" và điền sẵn khi quay về
const REQUEST_KEYS = [
  "contact", "recipientType", "shippingAddress", "setAsDefault", "deliveryDate", "deliveryWindow",
  "noteForShop", "noteForShipper", "voucherCodes", "acceptPolicy", "paymentChoice", "remainingMethod", "expectedTotal",
]
const pickRequest = (body) => Object.fromEntries(REQUEST_KEYS.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]))

// Giao dịch của phiên: phiên đã tạo, hoặc Member chủ giao dịch (API-39 "theo phiên tạo giao dịch")
function rememberPayment(req, id) {
  req.session.payments = [String(id), ...(req.session.payments || []).filter((x) => x !== String(id))].slice(0, 10)
}
// Liên kết thanh toán gửi từ đơn nháp (UC-OPS-02 6a) hoặc nhân viên gửi khi đổi sản phẩm: khách mở liên kết
// ở phiên khác nên liên kết chính là quyền xem
const owns = (req, p) =>
  !!p.draftCode || !!p.linkShared || (req.session.payments || []).includes(String(p._id)) || (!!req.user && !!p.userId && String(p.userId) === String(req.user._id))

async function load(req, id) {
  const p = ObjectId.isValid(String(id)) ? await payments().findOne({ _id: new ObjectId(String(id)) }) : null
  if (!p || !owns(req, p)) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy giao dịch")
  return expireIfDue(p)
}

// PENDING quá hạn thì coi là FAILED (06 Mục 4.4), cập nhật ngay khi đọc thay vì chờ việc định kỳ
async function expireIfDue(p, now = new Date()) {
  if (p.status !== "PENDING" || p.expiresAt > now) return p
  await payments().updateOne({ _id: p._id, status: "PENDING" }, { $set: { status: "FAILED", failReason: "HET_HAN", updatedAt: now } })
  return payments().findOne({ _id: p._id })
}

// API-38 bước 5: tạo giao dịch PENDING lưu bản chụp đơn, chưa tạo đơn
async function createForOrder(req, body, snap, retryOf = null) {
  const settings = await getStoreSettings()
  const now = new Date()
  const seq = await nextSequence("payment-" + math.vnDate(now).slice(2).replace(/-/g, ""))
  const payment = {
    _id: new ObjectId(),
    code: paymentCode(now, seq),
    purpose: "ORDER",
    provider: gateway.provider,
    amount: snap.option.amountDueNow,
    status: "PENDING",
    orderId: null,
    orderCode: null,
    checkoutSnapshot: snap,
    checkoutRequest: pickRequest(body),
    retryOf,
    description: describe(snap.option, settings.depositRate),
    userId: snap.memberId,
    sessionId: req.sessionID,
    expiresAt: new Date(now.getTime() + params.PAYMENT_TTL_MINUTES * 60 * 1000),
    createdAt: now,
    updatedAt: now,
  }
  let created
  try {
    created = await gateway.createPayment(payment)
  } catch (err) {
    console.error("Cổng thanh toán lỗi khi tạo giao dịch:", err.message)
    throw new HttpError(503, "GATEWAY_UNAVAILABLE", "Cổng thanh toán đang bận, vui lòng thử lại hoặc chọn COD (nếu đơn được phép)")
  }
  payment.providerTransId = created.providerTransId
  await payments().insertOne(payment)
  rememberPayment(req, payment._id)
  return { paymentId: String(payment._id), paymentUrl: created.paymentUrl, code: payment.code, amount: payment.amount }
}

// BR-47: phần trả thêm khi đơn đổi trước xác nhận. Nhân viên đổi sản phẩm thì gửi khách liên kết hạn 1 giờ
// (linkShared); khách tự sửa thì trả ngay, hạn 15 phút. Thay đổi chỉ áp dụng khi trả xong (orderChange.completePayment)
async function createForOrderChange(req, o, change, amount, { staff = false } = {}) {
  const now = new Date()
  const seq = await nextSequence("payment-" + math.vnDate(now).slice(2).replace(/-/g, ""))
  const ttl = staff ? params.PAYMENT_LINK_TTL_HOURS * 60 * 60 * 1000 : params.PAYMENT_TTL_MINUTES * 60 * 1000
  const payment = {
    _id: new ObjectId(), code: paymentCode(now, seq), purpose: "ORDER_CHANGE", provider: gateway.provider, amount, status: "PENDING",
    orderId: o._id, orderCode: o.code, change, linkShared: staff, payerName: o.customer?.fullName || null,
    // Nội dung chuyển khoản ngắn gọn; chi tiết thay đổi xem ở đơn
    description: `Thanh toán thêm đơn ${o.code}`, userId: staff ? o.userId : req.user._id, sessionId: staff ? null : req.sessionID,
    expiresAt: new Date(now.getTime() + ttl), createdAt: now, updatedAt: now,
  }
  const created = await gateway.createPayment(payment).catch(() => {
    throw new HttpError(503, "GATEWAY_UNAVAILABLE", "Cổng thanh toán đang bận, vui lòng thử lại")
  })
  payment.providerTransId = created.providerTransId
  await payments().insertOne(payment)
  if (!staff) rememberPayment(req, payment._id)
  return { paymentId: String(payment._id), paymentUrl: created.paymentUrl, code: payment.code, amount: payment.amount, expiresAt: payment.expiresAt }
}

// UC-CNL-04 bước 5: phí nhận lại hàng TH3 (phí vận chuyển mới + phần giá trị chưa thanh toán); đơn chỉ quay lại
// DANG_CHUAN_BI khi trả xong (redelivery.completePayment) - S9
async function createForRedelivery(req, o, { cost, shipping }) {
  const now = new Date()
  const seq = await nextSequence("payment-" + math.vnDate(now).slice(2).replace(/-/g, ""))
  const payment = {
    _id: new ObjectId(), code: paymentCode(now, seq), purpose: "REDELIVERY", provider: gateway.provider, amount: cost.total, status: "PENDING",
    orderId: o._id, orderCode: o.code, redelivery: { cost, shipping }, payerName: o.customer?.fullName || null,
    description: `Nhận lại hàng đơn ${o.code}: phí vận chuyển mới ${math.fmt(cost.shippingFee)} + giá trị còn lại ${math.fmt(cost.remaining)}`,
    userId: req.user._id, sessionId: req.sessionID,
    expiresAt: new Date(now.getTime() + params.PAYMENT_TTL_MINUTES * 60 * 1000), createdAt: now, updatedAt: now,
  }
  const created = await gateway.createPayment(payment).catch(() => {
    throw new HttpError(503, "GATEWAY_UNAVAILABLE", "Cổng thanh toán đang bận, vui lòng thử lại")
  })
  payment.providerTransId = created.providerTransId
  await payments().insertOne(payment)
  rememberPayment(req, payment._id)
  return { paymentId: String(payment._id), paymentUrl: created.paymentUrl, code: payment.code, amount: payment.amount }
}

// UC-OPS-02 6a: liên kết thanh toán từ đơn nháp, hạn PAYMENT_LINK_TTL_HOURS (1 giờ); đơn tạo khi khách trả xong
// opts.ttlMinutes: đơn gấp khách tự thanh toán ngay dùng hạn như API-38 thay vì 24 giờ của liên kết gửi khách
async function createForDraft(snap, draft, opts = {}) {
  const settings = await getStoreSettings()
  const now = new Date()
  const seq = await nextSequence("payment-" + math.vnDate(now).slice(2).replace(/-/g, ""))
  const payment = {
    _id: new ObjectId(), code: paymentCode(now, seq), purpose: "ORDER", provider: gateway.provider, amount: snap.option.amountDueNow, status: "PENDING",
    orderId: null, orderCode: null, checkoutSnapshot: snap, checkoutRequest: null, draftCode: draft.code, retryOf: null,
    description: describe(snap.option, settings.depositRate), userId: snap.memberId || null, sessionId: snap.sessionId || null,
    expiresAt: new Date(now.getTime() + (opts.ttlMinutes ? opts.ttlMinutes * 60 * 1000 : params.PAYMENT_LINK_TTL_HOURS * 60 * 60 * 1000)), createdAt: now, updatedAt: now,
  }
  const created = await gateway.createPayment(payment).catch(() => {
    throw new HttpError(503, "GATEWAY_UNAVAILABLE", "Cổng thanh toán đang bận, vui lòng thử lại")
  })
  payment.providerTransId = created.providerTransId
  await payments().insertOne(payment)
  return { paymentId: String(payment._id), paymentUrl: created.paymentUrl, code: payment.code, amount: payment.amount, expiresAt: payment.expiresAt }
}

// Hủy giao dịch PENDING của đơn nháp khi sửa, xóa hoặc gửi liên kết mới (1a, 1b)
async function cancelPending(id) {
  if (!id) return 0
  const r = await payments().updateOne({ _id: new ObjectId(String(id)), status: "PENDING" }, { $set: { status: "FAILED", failReason: "KHACH_HUY", failMessage: "Liên kết đã bị hủy", updatedAt: new Date() } })
  return r.modifiedCount
}

// API-39: dữ liệu cho SCR-08 và trang thất bại SCR-09
function view(p) {
  const snap = p.checkoutSnapshot || null
  return {
    _id: String(p._id),
    code: p.code,
    amount: p.amount,
    purpose: p.purpose,
    status: p.status,
    expired: p.status === "FAILED" && p.failReason === "HET_HAN",
    expiresAt: p.expiresAt,
    serverTime: new Date(),
    failReason: p.failReason || null,
    failMessage: p.failMessage || null,
    orderCode: p.orderCode || null,
    description: p.description,
    payerName: snap ? snap.contact.fullName : p.payerName || null,
    total: snap ? snap.money.total : null,
    remainingAmount: snap && snap.option.key === "DEPOSIT_COD" ? snap.money.remainingAmount : 0,
    itemCount: snap ? snap.lines.reduce((n, l) => n + l.quantity, 0) : 0,
    checkout: p.purpose === "ORDER" ? p.checkoutRequest || null : null,
    // Liên kết từ đơn nháp (UC-OPS-02 6a) không có trang Thanh toán để quay về - S8
    draftCode: p.draftCode || null,
  }
}

async function getView(req, id) {
  const p = await load(req, id)
  const v = view(p)
  // Liên kết nhân viên gửi đã thất bại: còn thử lại được khi thay đổi vẫn đang chờ
  if (p.purpose === "ORDER_CHANGE") Object.assign(v, { linkShared: !!p.linkShared, canRetry: p.status === "FAILED" && !!(await pendingChangeOf(p)) })
  // Liên kết đơn nháp thất bại: còn hạn liên kết thì thử lại được như liên kết trả thêm
  if (isDraftLink(p)) {
    const d = await draftOf(p)
    const cur = d && d.paymentId ? await payments().findOne({ _id: d.paymentId }, { projection: { retryOf: 1 } }) : null
    Object.assign(v, { canRetry: draftRetryable(p, d, new Date(), cur), linkExpiresAt: d && d.paymentExpiresAt ? d.paymentExpiresAt : null })
  }
  return v
}

// API-40: khách bấm kết quả trên SCR-08. Cổng giả lập ký kết quả rồi gửi về handleResult như callback của cổng thật.
async function simulate(req, id, result) {
  if (!["success", "fail", "cancel"].includes(result)) {
    throw new HttpError(400, "VALIDATION_ERROR", "Kết quả mô phỏng phải là success, fail hoặc cancel", { fields: { result: "Không hợp lệ" } })
  }
  const p = await load(req, id)
  assertPending(p)
  return handleResult(req, gateway.resultFor(p, result))
}

function assertPending(p) {
  if (p.status === "PENDING") return
  if (p.status === "FAILED" && p.failReason === "HET_HAN") throw new HttpError(410, "EXPIRED", "Phiên thanh toán đã hết hạn", { status: p.status })
  throw new HttpError(409, "ALREADY_PROCESSED", "Giao dịch đã được xử lý", { status: p.status, orderCode: p.orderCode || null })
}

// Lệnh chuyển trạng thái không khớp: giao dịch đã được xử lý (hoặc vừa hết hạn)
async function rejectProcessed(id) {
  const p = await payments().findOne({ _id: id })
  if (!p) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy giao dịch")
  assertPending(await expireIfDue(p))
  throw new HttpError(409, "ALREADY_PROCESSED", "Giao dịch đang được xử lý", { status: p.status })
}

// Kết quả cổng gửi về: kiểm chữ ký, rồi chuyển trạng thái có điều kiện
async function handleResult(req, body) {
  const r = gateway.verifyCallback(body)
  if (!r) {
    // 5bEb: chữ ký sai thì không cập nhật gì, ghi log cảnh báo cho Admin (UC-OPS-03)
    await writeLog({ action: "PAYMENT_INVALID_SIGNATURE", targetType: "payments", reason: "Kết quả thanh toán có chữ ký không hợp lệ", after: { data: String(body?.data || "").slice(0, 500) } })
    throw new HttpError(400, "INVALID_SIGNATURE", "Kết quả thanh toán không hợp lệ")
  }
  const id = new ObjectId(r.paymentId)
  const now = new Date()
  if (r.result === "success") return succeed(req, id, r, now)

  const failReason = r.result === "cancel" ? "KHACH_HUY" : "THAT_BAI"
  const p = await payments().findOneAndUpdate(
    { _id: id, status: "PENDING", expiresAt: { $gt: now } },
    { $set: { status: "FAILED", failReason, updatedAt: now } },
    { returnDocument: "after" },
  )
  if (!p) await rejectProcessed(id)
  // Phần trả thêm khi khách tự sửa đơn: bỏ chỗ giữ, đơn giữ nguyên, khách sửa lại được ngay.
  // Liên kết nhân viên gửi: giữ thay đổi tới hết hạn để khách "Thử lại" bằng phiên mới, nhân viên vẫn hủy được
  if (p.purpose === "ORDER_CHANGE" && !p.linkShared) await require("./orderChange").clearPending({ _id: p.orderId }, { paymentId: p._id })
  // Nhận lại hàng, khách tự sửa đơn: về chi tiết đơn kèm kết quả để báo khách; liên kết đơn nháp, liên kết nhân viên gửi: ở lại trang kết quả giao dịch
  if ((p.purpose === "ORDER_CHANGE" && !p.linkShared) || p.purpose === "REDELIVERY") {
    return { status: "FAILED", failReason, redirectUrl: `/tai-khoan/don-hang/${p.orderCode}?thanhToan=${failReason === "KHACH_HUY" ? "huy" : "that-bai"}&gd=${id}` }
  }
  if (p.linkShared) return { status: "FAILED", failReason, redirectUrl: `/thanh-toan/giao-dich/${id}` }
  if (p.draftCode) return { status: "FAILED", failReason, redirectUrl: `/thanh-toan/giao-dich/${id}` }
  // Hủy: về SCR-07 điền sẵn; thất bại: trang "Thanh toán không thành công" (5bEa)
  return { status: "FAILED", failReason, redirectUrl: failReason === "KHACH_HUY" ? `/thanh-toan?gd=${id}` : `/thanh-toan/giao-dich/${id}` }
}

async function succeed(req, id, r, now) {
  const p = await payments().findOneAndUpdate(
    { _id: id, status: "PENDING", expiresAt: { $gt: now } },
    { $set: { status: "SUCCESS", paidAt: now, providerTransId: r.providerTransId, updatedAt: now } },
    { returnDocument: "after" },
  )
  if (!p) await rejectProcessed(id)

  if (p.purpose === "ORDER_CHANGE" || p.purpose === "REDELIVERY") return succeedForOrder(p, id)
  const snap = p.checkoutSnapshot
  try {
    // Đơn nháp: không đụng giỏ của người mở liên kết; đơn gấp do chính khách đặt thì xóa các dòng đã đặt khỏi giỏ
    const { order: created, owner, accountCreated } = await order.place(snap, { req: snap.draftCode && !snap.urgentCode ? null : req, paidAmount: p.amount })
    await payments().updateOne({ _id: id }, { $set: { orderId: created._id, orderCode: created.code, updatedAt: new Date() } })
    if (snap.draftCode) await database.collection("draftOrders").updateOne({ code: snap.draftCode }, { $set: { status: "HOAN_TAT", orderCode: created.code, updatedAt: new Date() } })
    order.rememberOrder(req, created.code)
    const activation = await order.activationFor(snap, owner, accountCreated)
    return { status: "SUCCESS", orderCode: created.code, total: created.total, activation, redirectUrl: `/dat-hang/${created.code}/ket-qua` }
  } catch (err) {
    // 5bEc: đã thu tiền mà không tạo được đơn (hết hàng, voucher hết lượt...) thì hoàn tiền qua cổng
    if (!(err instanceof HttpError)) console.error("Tạo đơn sau thanh toán lỗi:", err.message)
    const refund = await gateway.refund(p, p.amount)
    const failMessage = (err instanceof HttpError ? err.message.replace(/, vui lòng cập nhật giỏ hàng$/, "") : "Không tạo được đơn hàng") + ". Số tiền đã được hoàn lại"
    await payments().updateOne(
      { _id: id, status: "SUCCESS" },
      { $set: { status: "REFUNDED", refundedAt: new Date(), refundTransId: refund.refundTransId, failReason: err.code || "LOI_HE_THONG", failMessage, updatedAt: new Date() } },
    )
    return { status: "REFUNDED", failMessage, redirectUrl: `/thanh-toan/giao-dich/${id}` }
  }
}

// Giao dịch ORDER_CHANGE thành công: áp dụng thay đổi đơn; REDELIVERY: đơn quay lại DANG_CHUAN_BI. Không áp dụng
// được (đơn đã xác nhận, hết hàng, thay đổi đã bị hủy, hết hạn lưu kho) thì hoàn qua cổng
async function succeedForOrder(p, id) {
  const handler = p.purpose === "REDELIVERY" ? require("./redelivery") : require("./orderChange")
  const back = (code) => (p.linkShared ? `/thanh-toan/giao-dich/${id}` : `/tai-khoan/don-hang/${code}`)
  try {
    const code = await handler.completePayment(p)
    return { status: "SUCCESS", orderCode: code, redirectUrl: back(code) }
  } catch (err) {
    if (!(err instanceof HttpError)) console.error("Áp dụng sản phẩm thay thế lỗi:", err.message)
    const refund = await gateway.refund(p, p.amount)
    const failMessage = (err instanceof HttpError ? err.message : p.purpose === "REDELIVERY" ? "Không nhận lại được hàng" : "Không cập nhật được đơn") + ". Số tiền đã được hoàn lại"
    await payments().updateOne({ _id: id, status: "SUCCESS" }, { $set: { status: "REFUNDED", refundedAt: new Date(), refundTransId: refund.refundTransId, failReason: err.code || "LOI_HE_THONG", failMessage, updatedAt: new Date() } })
    if (p.purpose === "ORDER_CHANGE") await require("./orderChange").clearPending({ _id: p.orderId }, { paymentId: p._id })
    return { status: "REFUNDED", failMessage, redirectUrl: p.linkShared ? `/thanh-toan/giao-dich/${id}` : `/tai-khoan/don-hang/${p.orderCode}` }
  }
}

// API-191: "Thử lại" / "Tạo phiên thanh toán mới" - kiểm tra lại như API-38 từ thông tin đã lưu, tạo giao dịch mới
// Thay đổi đơn đang chờ của liên kết nhân viên gửi: còn hạn và vẫn là thay đổi của giao dịch này (hoặc lần thử lại của nó)
async function pendingChangeOf(p, now = new Date()) {
  if (p.purpose !== "ORDER_CHANGE" || !p.linkShared) return null
  const o = await database.collection("orders").findOne({ _id: p.orderId }, { projection: { orderStatus: 1, pendingChange: 1 } })
  const pc = o && o.pendingChange && require("./opsRules").changeStatuses(o.pendingChange.kind).includes(o.orderStatus) ? o.pendingChange : null
  if (!pc || new Date(pc.expiresAt) <= now) return null
  const root = String(p.retryOf || p._id)
  const cur = await payments().findOne({ _id: pc.paymentId }, { projection: { retryOf: 1 } })
  return cur && (String(cur._id) === String(p._id) || String(cur.retryOf || cur._id) === root) ? { ...pc, current: cur } : null
}

// Thử lại phần trả thêm: phiên mới cùng thay đổi, cùng hạn của thay đổi đang chờ; bấm 2 lần dùng lại phiên còn hạn
async function retryOrderChange(p) {
  const now = new Date()
  const pc = await pendingChangeOf(p, now)
  if (!pc) throw new HttpError(409, "NOT_RETRYABLE", "Yêu cầu thanh toán thêm đã hết hạn hoặc đã được hủy. Bạn liên hệ Soulprint để được gửi liên kết mới", { orderCode: p.orderCode })
  const cur = await payments().findOne({ _id: pc.paymentId })
  if (cur.status === "PENDING" && cur.expiresAt > now) return { paymentId: String(cur._id), paymentUrl: `/cong-thanh-toan/${cur._id}`, code: cur.code, amount: cur.amount }
  const seq = await nextSequence("payment-" + math.vnDate(now).slice(2).replace(/-/g, ""))
  const { _id, code, status, failReason, failMessage, providerTransId, createdAt, updatedAt, ...rest } = cur
  const next = { ...rest, _id: new ObjectId(), code: paymentCode(now, seq), status: "PENDING", retryOf: cur.retryOf || cur._id, expiresAt: new Date(pc.expiresAt), createdAt: now, updatedAt: now }
  const created = await gateway.createPayment(next).catch(() => {
    throw new HttpError(503, "GATEWAY_UNAVAILABLE", "Cổng thanh toán đang bận, vui lòng thử lại")
  })
  next.providerTransId = created.providerTransId
  await payments().insertOne(next)
  const r = await database.collection("orders").updateOne(
    { _id: p.orderId, "pendingChange.paymentId": cur._id },
    { $set: { "pendingChange.paymentId": next._id, "pendingChange.paymentCode": next.code, "pendingChange.paymentUrl": created.paymentUrl, updatedAt: now } },
  )
  if (!r.modifiedCount) {
    await cancelPending(next._id)
    throw new HttpError(409, "NOT_RETRYABLE", "Đơn hàng vừa thay đổi, bạn tải lại trang để xem mới nhất", { orderCode: p.orderCode })
  }
  return { paymentId: String(next._id), paymentUrl: created.paymentUrl, code: next.code, amount: next.amount }
}

// Liên kết đơn nháp (UC-OPS-02 6a, không phải đơn gấp khách tự đặt): thử lại khi giao dịch thất bại, đơn nháp vẫn đang chờ
// đúng chuỗi giao dịch này và liên kết còn hạn; khách hủy giữa chừng cũng thử lại được, nhân viên hủy liên kết thì không
const isDraftLink = (p) => p.purpose === "ORDER" && !!p.draftCode && !(p.checkoutSnapshot && p.checkoutSnapshot.urgentCode)
const draftOf = (p) => database.collection("draftOrders").findOne({ code: p.draftCode }, { projection: { status: 1, paymentId: 1, paymentExpiresAt: 1 } })
const rootOf = (p) => String(p.retryOf || p._id)

function draftRetryable(p, d, now = new Date(), current = null) {
  if (!isDraftLink(p) || p.status !== "FAILED" || p.failReason === "HET_HAN" || p.failMessage === "Liên kết đã bị hủy") return false
  if (!d || d.status !== "DA_GUI_LINK" || !d.paymentExpiresAt || new Date(d.paymentExpiresAt) <= now) return false
  if (String(d.paymentId) === String(p._id)) return true
  // Đã thử lại: liên kết cũ mở lại vẫn dẫn tới phiên mới cùng chuỗi
  return !!current && rootOf(current) === rootOf(p)
}

async function retryDraft(p) {
  const now = new Date()
  const d = await draftOf(p)
  const cur = d && d.paymentId ? await payments().findOne({ _id: d.paymentId }) : null
  if (!draftRetryable(p, d, now, cur)) {
    throw new HttpError(409, "NOT_RETRYABLE", "Liên kết thanh toán đã hết hạn hoặc đã được thay bằng liên kết mới. Bạn liên hệ Soulprint để nhận liên kết mới", { orderCode: p.orderCode || null })
  }
  // Bấm 2 lần hoặc mở lại liên kết cũ: dùng lại phiên còn hạn
  if (cur.status === "PENDING" && cur.expiresAt > now) return { paymentId: String(cur._id), paymentUrl: `/cong-thanh-toan/${cur._id}`, code: cur.code, amount: cur.amount }
  if (cur.status === "SUCCESS") throw new HttpError(409, "NOT_RETRYABLE", "Giao dịch đã được thanh toán ở lần thử lại", { status: cur.status, orderCode: cur.orderCode || null })
  const seq = await nextSequence("payment-" + math.vnDate(now).slice(2).replace(/-/g, ""))
  const { _id, code, status, failReason, failMessage, providerTransId, paidAt, createdAt, updatedAt, ...rest } = cur
  // Cùng hạn với liên kết đã gửi khách (1 giờ), không gia hạn thêm
  const next = { ...rest, _id: new ObjectId(), code: paymentCode(now, seq), status: "PENDING", retryOf: cur.retryOf || cur._id, expiresAt: new Date(d.paymentExpiresAt), createdAt: now, updatedAt: now }
  const created = await gateway.createPayment(next).catch(() => {
    throw new HttpError(503, "GATEWAY_UNAVAILABLE", "Cổng thanh toán đang bận, vui lòng thử lại")
  })
  next.providerTransId = created.providerTransId
  await payments().insertOne(next)
  const r = await database.collection("draftOrders").updateOne(
    { _id: d._id, status: "DA_GUI_LINK", paymentId: cur._id },
    { $set: { paymentId: next._id, paymentUrl: created.paymentUrl, payFailedAt: null, updatedAt: now } },
  )
  if (!r.modifiedCount) {
    await cancelPending(next._id)
    throw new HttpError(409, "NOT_RETRYABLE", "Liên kết thanh toán vừa được thay đổi. Bạn liên hệ Soulprint để nhận liên kết mới")
  }
  return { paymentId: String(next._id), paymentUrl: created.paymentUrl, code: next.code, amount: next.amount }
}

async function retry(req, id) {
  const p = await load(req, id)
  if (p.purpose === "ORDER_CHANGE" && p.linkShared && p.status === "FAILED") return retryOrderChange(p)
  if (isDraftLink(p) && p.status === "FAILED") return retryDraft(p)
  if (p.purpose !== "ORDER" || p.draftCode || p.status !== "FAILED") {
    throw new HttpError(409, "NOT_RETRYABLE", "Giao dịch này không thể thử lại", { status: p.status, orderCode: p.orderCode || null })
  }
  const later = await payments().find({ retryOf: p._id, status: { $in: ["PENDING", "SUCCESS"] } }).sort({ createdAt: -1 }).limit(1).next()
  if (later && later.status === "SUCCESS") {
    throw new HttpError(409, "NOT_RETRYABLE", "Giao dịch đã được thanh toán ở lần thử lại", { status: later.status, orderCode: later.orderCode || null })
  }
  // Bấm 2 lần: dùng lại giao dịch thử lại còn hạn
  if (later && later.expiresAt > new Date()) return { paymentId: String(later._id), paymentUrl: `/cong-thanh-toan/${later._id}`, code: later.code, amount: later.amount }

  const snap = await order.prepare(req, p.checkoutRequest || {})
  if (snap.option.amountDueNow <= 0) throw new HttpError(409, "NOT_RETRYABLE", "Đơn này không cần thanh toán online, vui lòng đặt lại ở trang Thanh toán")
  return createForOrder(req, p.checkoutRequest, snap, p._id)
}

// Việc định kỳ: chuyển các giao dịch PENDING quá hạn sang FAILED; thay đổi đơn chờ thanh toán quá hạn thì bỏ
async function expireStale(now = new Date()) {
  const r = await payments().updateMany({ status: "PENDING", expiresAt: { $lte: now } }, { $set: { status: "FAILED", failReason: "HET_HAN", updatedAt: now } })
  await require("./orderChange").expireStale(now)
  return r.modifiedCount
}

// API-217: cổng giả lập không có callback thật, khách báo đã trả thì nhân viên xác nhận thay. Chỉ cổng MOCK, chỉ
// giao dịch đơn nháp (tạo đơn) và ORDER_CHANGE (áp dụng thay đổi); xử lý như cổng báo thành công
async function confirmByStaff(req, code, can) {
  const p = await payments().findOne({ code: String(code || "").toUpperCase() })
  if (!p) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy giao dịch")
  if (p.provider !== "MOCK" || gateway.provider !== "MOCK") throw new HttpError(409, "NOT_MOCK", "Chỉ xác nhận tay được với cổng thanh toán giả lập")
  const isDraft = p.purpose === "ORDER" && !!p.draftCode && !(p.checkoutSnapshot && p.checkoutSnapshot.urgentCode)
  if (!isDraft && p.purpose !== "ORDER_CHANGE") throw new HttpError(409, "NOT_CONFIRMABLE", "Giao dịch này không xác nhận tay được")
  if (!can(isDraft ? "DON_NHAP.KICH_HOAT" : "DON_HANG.SUA")) throw new HttpError(403, "FORBIDDEN", "Bạn không có quyền thực hiện thao tác này")
  assertPending(await expireIfDue(p))
  // Phiên tạm để order.rememberOrder không ghi đơn của khách vào phiên quản trị
  const shim = { session: {}, sessionID: null, user: null }
  const result = await handleResult(shim, gateway.resultFor(p, "success"))
  await writeLog({ adminId: req.user._id, action: "PAYMENT_CONFIRM", targetType: "payments", targetId: p._id, reason: "Xác nhận tay với cổng giả lập", after: { code: p.code, amount: p.amount, status: result.status, orderCode: result.orderCode || p.orderCode || null, summary: `xác nhận thanh toán ${p.code}` } })
  return result
}

module.exports = {
  createForOrder, createForOrderChange, createForRedelivery, createForDraft, confirmByStaff, cancelPending, getView, simulate, handleResult, retry, expireStale,
  paymentCode, describe, pickRequest, view, rememberPayment, draftRetryable,
}
