// Hỗ trợ khách hàng phía nhân viên (07_API_Spec.md API-104 đến API-107, API-176, API-177) - S11, UC-CSK-04.
const chatAdmin = require("../services/chatAdmin")

// API-104 GET /api/admin/chat/conversations?status=DA_DONG - mặc định: hàng đợi + hội thoại mình đang hỗ trợ
async function listConversations(req, res) {
  res.send(await chatAdmin.list(req, req.query))
}

// API-105 GET /api/admin/chat/conversations/:id?after= - lần đầu mở hội thoại đang chờ thì nhận luôn
async function getConversation(req, res) {
  res.send(await chatAdmin.detail(req, req.params["id"], req.query.after))
}

// API-106 POST /api/admin/chat/conversations/:id/messages - {text}
async function reply(req, res) {
  res.status(201).send(await chatAdmin.reply(req, req.params["id"], req.body || {}))
}

// API-107 PUT /api/admin/chat/conversations/:id/close
async function close(req, res) {
  res.send(await chatAdmin.close(req, req.params["id"]))
}

// API-176 POST /api/admin/chat/conversations/:id/notes - {text (1-500 ký tự)}
async function addNote(req, res) {
  res.status(201).send(await chatAdmin.addNote(req, req.params["id"], req.body || {}))
}

// API-177 PUT /api/admin/me/duty - {onDuty: true} | {onDuty: false, handover?: REASSIGN | FINISH_FIRST}
async function setDuty(req, res) {
  res.send(await chatAdmin.setDuty(req, req.body || {}))
}

// API-206 PUT /api/admin/chat/conversations/:id/labels - {labels: [mã]} hoặc {auto: true}
async function setLabels(req, res) {
  res.send(await chatAdmin.setLabels(req, req.params["id"], req.body || {}))
}

module.exports = { listConversations, getConversation, reply, close, addNote, setDuty, setLabels }
