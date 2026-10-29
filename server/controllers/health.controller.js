// Controller kiểm tra sức khỏe hệ thống: server đang chạy và MongoDB có trả lời không.
// Dùng khi deploy (Render gọi để biết dịch vụ đã sẵn sàng) và khi demo (mở trước để đánh thức Render).
const { database } = require("../config/db")

async function getHealth(req, res) {
  let db = "ok"
  try {
    await database.command({ ping: 1 })
  } catch {
    db = "error"
  }
  res.status(db === "ok" ? 200 : 503).send({ status: db === "ok" ? "ok" : "degraded", db, time: new Date().toISOString() })
}

module.exports = { getHealth }
