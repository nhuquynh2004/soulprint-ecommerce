// Chat "Sâu Béo" (07_API_Spec.md Mục 2.9) - S11. Công khai theo phiên (Guest và Member).
const express = require("express")
const chat = require("../controllers/chat.controller")

const router = express.Router()

router.post("/chat/conversations", chat.openConversation) // API-60
router.get("/chat/conversations/:id/messages", chat.getMessages) // API-61
router.post("/chat/conversations/:id/messages", chat.sendMessage) // API-62
router.post("/chat/conversations/:id/escalate", chat.escalate) // API-63
router.post("/chat/conversations/:id/cancel-escalation", chat.cancelEscalation) // API-197
router.post("/chat/conversations/:id/back-to-bot", chat.backToBot) // API-208

module.exports = router
