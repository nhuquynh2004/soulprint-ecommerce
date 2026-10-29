// Giỏ hàng (07_API_Spec.md Mục 2.5), mẫu gói quà công khai (Mục 2.3), thiết kế đã lưu và yêu thích (Mục 2.2) - S4.
const express = require("express")
const cart = require("../controllers/cart.controller")
const design = require("../controllers/design.controller")
const wishlist = require("../controllers/wishlist.controller")
const { requireMember } = require("../middlewares/auth")

const router = express.Router()

// Nhân viên không mua hàng (BR-34): giỏ chỉ dành cho Guest và Member
function noStaff(req, res, next) {
  if (req.user && req.user.role === "admin") {
    return res.status(403).send({ error: { code: "FORBIDDEN", message: "Tài khoản nhân viên không mua hàng" } })
  }
  next()
}

router.get("/gift-wraps", cart.getGiftWraps) // API-30
router.get("/cart", noStaff, cart.getCart) // API-31
router.post("/cart/items", noStaff, cart.addItem) // API-32
router.put("/cart/items/:itemId", noStaff, cart.updateItem) // API-33
router.delete("/cart/items/:itemId", noStaff, cart.removeItem) // API-34
router.put("/cart/gift-wrap", noStaff, cart.setGiftWrap) // API-35
router.put("/cart/selection", noStaff, cart.setSelection) // API-118

router.get("/account/designs", requireMember, design.listDesigns) // API-14
router.post("/account/designs", requireMember, design.createDesign) // API-15
router.put("/account/designs", requireMember, design.updateDesign) // API-16 (_id trong body)
router.delete("/account/designs/:id", requireMember, design.deleteDesign) // API-17

router.get("/account/wishlist", requireMember, wishlist.getWishlist) // API-18
router.post("/account/wishlist", requireMember, wishlist.addToWishlist) // API-19
router.delete("/account/wishlist/:productId", requireMember, wishlist.removeFromWishlist) // API-20

module.exports = router
