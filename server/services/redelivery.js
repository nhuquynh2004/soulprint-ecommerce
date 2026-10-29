// Sau hủy (S9): nhận lại hàng cá nhân hóa TH3 (UC-CNL-04, API-47, giao dịch REDELIVERY) và nhận tiền hoàn TH2 (UC-CNL-05,
// API-48). Nhận lại hàng: chi phí = phí vận chuyển mới + phần giá trị chưa thanh toán; đơn chỉ quay lại DANG_CHUAN_BI
// khi cổng báo thành công (mũi tên duy nhất ra khỏi DA_HUY - 05 Mục 2.1).
const { database } = require("../config/db")
const params = require("../config/params")
const HttpError = require("../utils/httpError")
const st = require("./orderState")
const myOrders = require("./myOrders")
const ops = require("./orderOps")
const common = require("./afterSalesCommon")
const { getStoreSettings } = require("./settings")
const { fmt } = require("./checkoutMath")

const orders = () => database.collection("orders")
const refunds = () => database.collection("refunds")
const users = () => database.collection("users")
const HOUR = 60 * 60 * 1000

// Bảng chi phí phát sinh (bước 4): "Phí vận chuyển mới [X]đ + Giá trị còn lại [Y]đ = [Tổng]đ"
async function costOf(o) {
  const shippingFee = (await getStoreSettings()).shippingFee
  const remaining = Math.max(0, (o.total || 0) - (o.paidAmount || 0))
  return { shippingFee, remaining, total: shippingFee + remaining }
}

function assertCanRedeliver(o, now = new Date()) {
  if (o.orderStatus !== "DA_HUY" || o.cancelCase !== "TH3") throw new HttpError(422, "BUSINESS_RULE", "Đơn hàng không thuộc trường hợp nhận lại hàng", { rule: "BR-28" })
  if ((o.redeliveryCount || 0) >= params.MAX_REDELIVERY) throw new HttpError(422, "BUSINESS_RULE", "Đơn hàng cá nhân hóa đã được xử lý do bị hủy 2 lần", { rule: "BR-11" })
  if (o.storageStatus !== "DANG_LUU_KHO" || !o.storageDeadline || new Date(o.storageDeadline) <= now) {
    throw new HttpError(422, "BUSINESS_RULE", `Đã quá ${params.REDELIVERY_WINDOW_DAYS} ngày lưu kho, không thể nhận lại hàng`, { rule: "BR-09" })
  }
}

// API-47 POST /api/orders/:code/redelivery - {recipientType, shippingAddress | addressId, deliveryWindow?}
async function request(req, code, body) {
  const o = await myOrders.ownOrder(req.user, code)
  await ops.expireStorage(new Date())
  const fresh = await orders().findOne({ _id: o._id })
  assertCanRedeliver(fresh)
  const recipientType = body.recipientType === "OTHER" ? "OTHER" : "SELF"
  const address = await common.readAddress(req.user, body, "shippingAddress")
  const deliveryWindow = body.deliveryWindow ? String(body.deliveryWindow) : null
  if (deliveryWindow && !params.DELIVERY_SLOTS.includes(deliveryWindow)) {
    throw new HttpError(400, "VALIDATION_ERROR", "Khung giờ nhận không hợp lệ", { fields: { deliveryWindow: "Chọn lại khung giờ" } })
  }
  const cost = await costOf(fresh)
  const payment = require("./payment")
  const created = await payment.createForRedelivery(req, fresh, {
    cost,
    shipping: { recipientType, shippingAddress: { ...address, ...(deliveryWindow ? { deliveryWindow } : {}), noteForShipper: "" } },
  })
  return { ...created, breakdown: cost }
}

// Cổng báo giao dịch REDELIVERY thành công (payment.succeed): đơn quay lại DANG_CHUAN_BI. Không còn điều kiện (đã hết hạn,
// đã nhận lại) thì lỗi để payment hoàn qua cổng.
async function completePayment(p) {
  const o = await orders().findOne({ code: p.orderCode })
  const intent = p.redelivery
  if (!o || !intent) throw new HttpError(409, "ALREADY_PROCESSED", "Không tìm thấy đơn của giao dịch")
  const now = new Date()
  assertCanRedeliver(o, now)
  const fee = intent.cost.shippingFee
  const total = (o.total || 0) + fee
  const paidAmount = (o.paidAmount || 0) + p.amount
  const r = await orders().updateOne(
    { _id: o._id, orderStatus: "DA_HUY", storageStatus: "DANG_LUU_KHO", redeliveryCount: { $in: [null, 0] } },
    {
      $set: {
        orderStatus: "DANG_CHUAN_BI", recipientType: intent.shipping.recipientType, shippingAddress: intent.shipping.shippingAddress,
        shippingFee: (o.shippingFee || 0) + fee, redeliveryFee: fee, total, paidAmount, remainingAmount: Math.max(0, total - paidAmount),
        paymentStatus: paidAmount >= total ? "DA_THANH_TOAN" : "DA_COC", redeliveryCount: 1, redeliveredAt: now,
        storageStatus: null, storageDeadline: null, updatedAt: now,
      },
      $push: {
        statusHistory: {
          $each: [
            ops.historyEntry("orderStatus", "DA_HUY", "DANG_CHUAN_BI", { by: p.userId, byRole: "KHACH", at: now, note: `Khách nhận lại hàng, đã trả ${fmt(p.amount)} (BR-09)` }),
            ops.historyEntry("paymentStatus", o.paymentStatus, paidAmount >= total ? "DA_THANH_TOAN" : "DA_COC", { by: p.userId, byRole: "KHACH", at: now }),
          ],
        },
      },
    },
  )
  if (!r.modifiedCount) throw new HttpError(409, "ALREADY_PROCESSED", "Đơn hàng đã được xử lý trước đó")
  await ops.notifyOwner(o, { title: `Đơn ${o.code} sẽ được giao lại`, body: `Đã nhận ${fmt(p.amount)}. Soulprint đang chuẩn bị giao lại đơn hàng cho bạn.` })
  return o.code
}

// API-48 POST /api/orders/:code/refund-request - {refundAccount | useSavedAccount, saveAccount?}.
// (1) Đơn TH2 chưa có yêu cầu hoàn: tạo yêu cầu (UC-CNL-05 bước 4). (2) Yêu cầu hoàn đang chờ tài khoản hoặc chuyển khoản
// thất bại: nhập lại tài khoản, yêu cầu quay lại CHO_XU_LY (nhánh 5a; UC-OPS-07 1b "Chờ khách nhập tài khoản").
async function refundRequest(user, code, body) {
  const o = await myOrders.ownOrder(user, code)
  const now = new Date()
  const pending = await refunds()
    .find({ orderCode: o.code, method: { $ne: "GATEWAY" }, $or: [{ status: "THAT_BAI" }, { status: "CHO_XU_LY", bankInfo: null }] })
    .sort({ createdAt: -1 })
    .limit(1)
    .next()
  const refundTo = await myOrders.chooseRefundAccount(user, body)
  let refund
  if (pending) {
    // Đã có yêu cầu khác cùng lý do đang mở thì không mở lại yêu cầu thất bại (index orderCode_reason_open)
    try {
      await refunds().updateOne(
        { _id: pending._id, status: pending.status },
        { $set: { bankInfo: refundTo.account, status: "CHO_XU_LY", slaDeadline: new Date(now.getTime() + params.REFUND_SLA_HOURS * HOUR), updatedAt: now } },
      )
    } catch (err) {
      if (err.code === 11000) throw new HttpError(409, "ALREADY_REQUESTED", "Đơn hàng đang có yêu cầu hoàn tiền")
      throw err
    }
    refund = await refunds().findOne({ _id: pending._id })
  } else {
    if (o.orderStatus !== "DA_HUY" || o.cancelCase !== "TH2") throw new HttpError(422, "BUSINESS_RULE", "Đơn hàng không thuộc trường hợp nhận tiền hoàn", { rule: "BR-28" })
    const amount = st.refundOnCancel(o)
    const open = await refunds().countDocuments({ orderCode: o.code, status: { $in: ["CHO_XU_LY", "DA_HOAN"] } })
    // 1Ea, AC2: đã hoàn đủ hoặc đang có yêu cầu
    if (!(amount > 0) || open) throw new HttpError(409, "ALREADY_REQUESTED", "Đơn hàng đã có yêu cầu hoàn tiền")
    const reason = o.cancelBy === "REFUSED" ? "TU_CHOI_NHAN" : "HUY_DON"
    refund = {
      orderId: o._id, orderCode: o.code, userId: user._id, reason, amount, method: "BANK_TRANSFER", bankInfo: refundTo.account,
      status: "CHO_XU_LY", slaDeadline: new Date(now.getTime() + params.REFUND_SLA_HOURS * HOUR), createdAt: now, updatedAt: now,
    }
    try {
      refund._id = (await refunds().insertOne(refund)).insertedId
    } catch (err) {
      if (err.code === 11000) throw new HttpError(409, "ALREADY_REQUESTED", "Đơn hàng đã có yêu cầu hoàn tiền")
      throw err
    }
  }
  if (refundTo.save) await users().updateOne({ _id: user._id }, { $set: { refundAccount: { ...refundTo.account, savedAt: now }, updatedAt: now } })
  await ops.notifyOwner(o, {
    type: "HOAN_TIEN",
    title: `Đơn ${o.code}: đã ghi nhận yêu cầu hoàn tiền`,
    body: `Yêu cầu hoàn ${fmt(refund.amount)} về ${refund.bankInfo.bankName} ${st.maskAccount(refund.bankInfo.accountNumber)} đã được ghi nhận, tiền về tài khoản của bạn trong 1 - 3 ngày làm việc.`,
  })
  return { refund: myOrders.refundView(refund) }
}

module.exports = { costOf, request, completePayment, refundRequest }
