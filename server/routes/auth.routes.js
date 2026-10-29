// Xác thực phía khách (07_API_Spec.md Mục 2.1) và tài khoản (Mục 2.2) - S2.
const express = require("express")
const authCtl = require("../controllers/auth.controller")
const account = require("../controllers/account.controller")
const { requireAuth, requireMember } = require("../middlewares/auth")

const router = express.Router()

router.post("/auth/register", authCtl.register) // API-01
router.post("/auth/login", authCtl.login) // API-02
router.post("/auth/logout", requireAuth, authCtl.logout) // API-03
router.get("/auth/me", authCtl.me) // API-04
router.post("/auth/forgot-password", authCtl.forgotPassword) // API-05
router.post("/auth/verify-reset-code", authCtl.verifyResetCode) // API-185
router.get("/auth/set-password/:token", authCtl.setPasswordInfo) // API-06 (đọc thông tin cho SCR-14)
router.post("/auth/set-password", authCtl.setPassword) // API-06
router.get("/auth/google", authCtl.googleStart) // API-199
router.get("/auth/google/callback", authCtl.googleCallback) // API-200

router.put("/account/profile", requireAuth, account.updateProfile) // API-07
router.put("/account/password", requireAuth, account.changePassword) // API-08
router.get("/account/addresses", requireMember, account.getAddresses) // API-09
router.post("/account/addresses", requireMember, account.addAddress) // API-10
router.put("/account/addresses", requireMember, account.updateAddress) // API-11 (_id trong body)
router.delete("/account/addresses/:id", requireMember, account.deleteAddress) // API-12
router.get("/account/refund-account", requireMember, account.getRefundAccount) // API-226
router.put("/account/refund-account", requireMember, account.saveRefundAccount) // API-227
router.delete("/account/refund-account", requireMember, account.deleteRefundAccount) // API-228

module.exports = router
