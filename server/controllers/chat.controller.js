// Chat "Sâu Béo" phía khách (07_API_Spec.md Mục 2.9) - S11: API-60 đến API-63, API-197.
// Công khai theo phiên: service kiểm tra hội thoại thuộc phiên (hoặc Member) đang gọi.
const chat = require("../services/chat")

// API-60 POST /api/chat/conversations - {customerName?}; dùng lại hội thoại đang mở của phiên
async function openConversation(req, res) {
  res.status(201).send(await chat.open(req, req.body || {}))
}

// API-61 GET /api/chat/conversations/:id/messages?after=<messageId>
async function getMessages(req, res) {
  res.send(await chat.poll(req, req.params["id"], req.query.after))
}

// API-62 POST /api/chat/conversations/:id/messages - {text, confirmSoftened?: SOFTENED | ORIGINAL}
async function sendMessage(req, res) {
  res.send(await chat.send(req, req.params["id"], req.body || {}))
}

// API-63 POST /api/chat/conversations/:id/escalate - {contact?, text?} khi ngoài giờ
async function escalate(req, res) {
  res.send(await chat.escalate(req, req.params["id"], req.body || {}))
}

// API-197 POST /api/chat/conversations/:id/cancel-escalation
async function cancelEscalation(req, res) {
  res.send(await chat.cancelEscalation(req, req.params["id"]))
}

// API-208 POST /api/chat/conversations/:id/back-to-bot - đang chat với nhân viên thì quay lại Sâu Béo
async function backToBot(req, res) {
  res.send(await chat.backToBot(req, req.params["id"]))
}

module.exports = { openConversation, getMessages, sendMessage, escalate, cancelEscalation, backToBot }
