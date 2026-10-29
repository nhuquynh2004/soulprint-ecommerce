// Ghi nhật ký thao tác quản trị adminLogs (NFR-SEC-12, 06 Mục 6.1): ai, khi nào, lý do, trước/sau. Không sửa, không xóa.
const { database } = require("../config/db")

async function writeLog({ adminId = null, action, targetType, targetId = null, reason = null, before = null, after = null }) {
  await database.collection("adminLogs").insertOne({ adminId, action, targetType, targetId, reason, before, after, createdAt: new Date() })
}

module.exports = { writeLog }
