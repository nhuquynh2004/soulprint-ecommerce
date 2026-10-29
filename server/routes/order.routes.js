// Đặt hàng, thanh toán (07_API_Spec.md Mục 2.6), đơn của khách (Mục 2.6), Ưu đãi của tôi, thông báo (Mục 2.2), tra cứu đơn (Mục 2.7) - S5, S6, S7;
// nhận lại hàng, nhận tiền hoàn, đổi trả, bảo hành, đánh giá (Mục 2.6) - S9.
const express = require("express")
const checkout = require("../controllers/checkout.controller")
const orders = require("../controllers/orders.controller")
const urgent = require("../controllers/urgent.controller")
const { requireMember } = require("../middlewares/auth")

const router = express.Router()

// Nhân viên không mua hàng (BR-34)
function noStaff(req, res, next) {
  if (req.user && req.user.role === "admin") {
    return res.status(403).send({ error: { code: "FORBIDDEN", message: "Tài khoản nhân viên không mua hàng" } })
  }
  next()
}

router.post("/checkout/voucher", noStaff, checkout.checkVoucher) // API-36
router.post("/checkout/quote", noStaff, checkout.quote) // API-37
router.post("/orders", noStaff, checkout.createOrder) // API-38
// Đặt gấp
router.post("/urgent-requests", noStaff, urgent.create) // API-201
router.get("/urgent-requests/:code", noStaff, urgent.view) // API-202
router.post("/urgent-requests/:code/checkout", noStaff, urgent.checkout) // API-203
router.post("/urgent-requests/:code/cancel", noStaff, urgent.cancel) // API-204
router.get("/payments/:id", checkout.getPayment) // API-39
router.post("/payments/:id/simulate", checkout.simulatePayment) // API-40 (cổng giả lập)
router.post("/payments/:id/retry", noStaff, checkout.retryPayment) // API-191
router.get("/orders", requireMember, orders.listOrders) // API-42
router.get("/orders/:code", orders.getOrder) // API-43 (chủ đơn, phiên vừa đặt, phiên tra cứu)
router.get("/orders/:code/version", orders.getOrderVersion) // API-229
router.put("/orders/:code/cancel", requireMember, orders.cancelOrder) // API-44
router.put("/orders/:code/received", requireMember, orders.confirmReceived) // API-45
router.post("/orders/:code/reorder", requireMember, orders.reorder) // API-46
router.post("/orders/:code/redelivery", requireMember, orders.requestRedelivery) // API-47
router.post("/orders/:code/refund-request", requireMember, orders.requestRefund) // API-48
router.put("/orders/:code/items/:itemId/substitution", requireMember, orders.chooseSubstitution) // API-49 đã bỏ, trả 410
router.put("/orders/:code/shipping", requireMember, orders.updateShipping) // API-215
router.put("/orders/:code/items/:itemId/personalization", requireMember, orders.updatePersonalization) // API-216
router.post("/orders/:code/refunds/voucher", requireMember, orders.refundToVoucher) // API-219
router.post("/orders/:code/returns", requireMember, orders.createReturn) // API-50
router.delete("/returns/:id", requireMember, orders.cancelReturn) // API-51
router.post("/orders/:code/warranty", requireMember, orders.createWarranty) // API-52
router.post("/reviews", requireMember, orders.createReview) // API-53
router.put("/reviews", requireMember, orders.updateReview) // API-54 (_id trong body)
router.delete("/reviews/:id", requireMember, orders.deleteReview) // API-195

router.post("/lookup/otp", noStaff, orders.lookupOtp) // API-55
router.post("/lookup/verify", noStaff, orders.lookupVerify) // API-56
router.get("/lookup/orders", orders.lookupOrders) // API-57
router.post("/lookup/activation-link", orders.lookupActivation) // API-58

router.get("/notifications", requireMember, orders.listNotifications) // API-21
router.put("/notifications/read-all", requireMember, orders.readAllNotifications) // API-192
router.put("/notifications/:id/read", requireMember, orders.readNotification) // API-22
router.get("/account/vouchers", requireMember, checkout.myVouchers) // API-13

module.exports = router
