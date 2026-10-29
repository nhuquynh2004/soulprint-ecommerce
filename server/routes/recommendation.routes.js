// Tư vấn quà AI (07 Mục 2.4) - S10. Công khai: Guest giới hạn GUEST_AI_TRIALS lượt, Member không giới hạn.
const express = require("express")
const ctrl = require("../controllers/recommendation.controller")

const router = express.Router()

router.get("/recommendations/quota", ctrl.getQuota) // API-198
router.post("/recommendations", ctrl.recommend) // API-59

module.exports = router
