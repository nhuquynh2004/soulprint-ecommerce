// Việc định kỳ (07_API_Spec.md Mục 3): runScheduledChecks chạy khi server khởi động và mỗi giờ (setInterval),
// không cài thư viện cron. Các slice sau thêm việc của mình vào đây (BR-26, BR-10, BR-30...).
// S6: giao dịch thanh toán PENDING quá 15 phút chuyển FAILED (06 Mục 4.4). S7: đơn DA_GIAO quá 72 giờ tự HOAN_THANH (BR-26).
// S8: hàng lưu kho quá 14 ngày chuyển HET_HAN_LUU_KHO (BR-10); sản phẩm chờ khách chọn quá 48 giờ tự hoàn tiền (BR-30).
const { database } = require("../config/db")
const params = require("../config/params")
const { writeLog } = require("./adminLog")
const payment = require("./payment")
const myOrders = require("./myOrders")
const orderOps = require("./orderOps")

// Gỡ quyền riêng hết hạn (BR-38), ghi adminLogs với người thực hiện = hệ thống (adminId null)
async function removeExpiredOverrides(now = new Date()) {
  const users = database.collection("users")
  const list = await users.find({ "permissionOverrides.expiresAt": { $lte: now } }).toArray()
  for (const u of list) {
    const expired = u.permissionOverrides.filter((o) => o.expiresAt && o.expiresAt <= now)
    await users.updateOne({ _id: u._id }, { $pull: { permissionOverrides: { expiresAt: { $lte: now } } } })
    await writeLog({
      action: "PERMISSION_OVERRIDE", targetType: "users", targetId: u._id, reason: "Hết hạn, hệ thống tự gỡ",
      before: expired.map(({ permission, type, expiresAt }) => ({ permission, type, expiresAt })), after: null,
    })
  }
  return list.length
}

// Collection không chứa đường dẫn tệp của nội dung: bỏ qua khi tìm tham chiếu
const NO_FILE_REFS = ["files", "sessions", "otps", "tokens", "adminLogs"]

// Mã tệp xuất hiện dạng /api/files/<id> trong 1 document (ảnh sản phẩm, banner, chính sách HTML, bằng chứng đổi trả...)
function fileIdsIn(doc, found = new Set()) {
  for (const m of JSON.stringify(doc).matchAll(/\/api\/files\/([a-f0-9]{24})/g)) found.add(m[1])
  return found
}

// Xóa tệp tải lên quá 24 giờ mà không document nào dùng (06 Mục 6.2): ảnh bỏ khỏi form, sản phẩm đã xóa.
// Quét mọi collection nội dung thay vì danh sách cố định để slice sau (đánh giá, đổi trả) không phải đăng ký thêm.
async function removeOrphanFiles(now = new Date()) {
  const files = database.collection("files")
  const cutoff = new Date(now.getTime() - params.ORPHAN_FILE_HOURS * 60 * 60 * 1000)
  const old = await files.find({ createdAt: { $lt: cutoff } }, { projection: { _id: 1 } }).toArray()
  if (!old.length) return 0
  const used = new Set()
  for (const { name } of await database.listCollections({}, { nameOnly: true }).toArray()) {
    if (NO_FILE_REFS.includes(name) || name.startsWith("system.")) continue
    for await (const doc of database.collection(name).find({})) fileIdsIn(doc, used)
  }
  const orphans = old.map((f) => f._id).filter((id) => !used.has(String(id)))
  if (orphans.length) await files.deleteMany({ _id: { $in: orphans } })
  return orphans.length
}

async function runScheduledChecks() {
  try {
    await removeExpiredOverrides()
    await removeOrphanFiles()
    await payment.expireStale()
    await myOrders.autoComplete()
    await orderOps.expireStorage()
  } catch (err) {
    console.error("Việc định kỳ lỗi:", err.message)
  }
}

function startScheduler() {
  runScheduledChecks()
  setInterval(runScheduledChecks, 60 * 60 * 1000).unref()
}

module.exports = { runScheduledChecks, startScheduler, removeExpiredOverrides, removeOrphanFiles, fileIdsIn }
