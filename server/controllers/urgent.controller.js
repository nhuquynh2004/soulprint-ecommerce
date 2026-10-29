// Đặt gấp phía khách (07_API_Spec.md API-201 đến API-204). Guest dùng được: quyền xem theo phiên đã gửi,
// tài khoản Member, hoặc token trong liên kết (?t=) gửi qua khung chat.
const urgent = require("../services/urgentOrders")

// API-201 POST /api/urgent-requests - body như API-38 (không cần paymentChoice, acceptPolicy) + deliveryDate mong muốn
async function create(req, res) {
  res.status(201).send(await urgent.create(req, req.body || {}))
}

// API-202 GET /api/urgent-requests/:code?t=
async function view(req, res) {
  res.send(await urgent.view(req, req.params["code"], req.query.t))
}

// API-203 POST /api/urgent-requests/:code/checkout - {version, paymentChoice, remainingMethod, acceptPolicy, t?}
async function checkout(req, res) {
  res.status(201).send(await urgent.checkout(req, req.params["code"], req.body || {}))
}

// API-204 POST /api/urgent-requests/:code/cancel - {reason?, t?}
async function cancel(req, res) {
  res.send(await urgent.cancel(req, req.params["code"], req.body || {}))
}

module.exports = { create, view, checkout, cancel }
