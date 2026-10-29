// Đặt hàng (07_API_Spec.md Mục 2.6 và 2.7): API-36 kiểm tra voucher / kho ưu đãi, API-37 tính tiền, API-38 đặt hàng,
// Ưu đãi của tôi API-13. API-43 xem đơn chuyển sang orders.controller.js (S7).
const order = require("../services/order")
const voucher = require("../services/voucher")
const payment = require("../services/payment")

// API-36 POST /api/checkout/voucher - {code, appliedCodes?}; không có code thì trả kho ưu đãi
async function checkVoucher(req, res) {
  res.send(await order.checkVoucher(req, req.body || {}))
}

// API-37 POST /api/checkout/quote
async function quote(req, res) {
  res.send(await order.quote(req, req.body || {}))
}

// API-38 POST /api/orders. Không phải trả trước (COD): tạo đơn ngay. Cần trả online (cọc hoặc 100%): tạo giao dịch
// PENDING, trả paymentUrl tới cổng thanh toán giả lập SCR-08; đơn chỉ được tạo khi cổng báo thành công (SEQ-01).
async function createOrder(req, res) {
  const body = req.body || {}
  const snap = await order.prepare(req, body)
  if (snap.option.amountDueNow > 0) return res.status(201).send(await payment.createForOrder(req, body, snap))

  const { order: created, owner, accountCreated } = await order.place(snap, { req })
  order.rememberOrder(req, created.code)
  res.status(201).send({ orderCode: created.code, total: created.total, activation: await order.activationFor(snap, owner, accountCreated) })
}

// API-39 GET /api/payments/:id
async function getPayment(req, res) {
  res.send(await payment.getView(req, req.params["id"]))
}

// API-40 POST /api/payments/:id/simulate - {result: success|fail|cancel}
async function simulatePayment(req, res) {
  res.send(await payment.simulate(req, req.params["id"], (req.body || {}).result))
}

// API-191 POST /api/payments/:id/retry
async function retryPayment(req, res) {
  res.status(201).send(await payment.retry(req, req.params["id"]))
}

// API-13 GET /api/account/vouchers?tab=CO_THE_DUNG|SAP_HET_HAN|DA_DUNG_HET_HAN
async function myVouchers(req, res) {
  res.send(await voucher.accountVouchers(req.user, String(req.query.tab || "CO_THE_DUNG")))
}

module.exports = { checkVoucher, quote, createOrder, getPayment, simulatePayment, retryPayment, myVouchers }
