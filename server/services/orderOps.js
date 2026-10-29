// Thao tác ghi dùng chung cho xử lý đơn phía quản trị (S8) và phía khách chọn thay thế (UC-OPS-06 1b, 1c):
// yêu cầu hoàn tiền, thông báo chủ đơn, bắt đầu lưu kho TH3, dòng lịch sử đơn. Quy tắc thuần ở opsRules.js.
const { database } = require("../config/db")
const params = require("../config/params")
const { notifier } = require("./notifier")
const { nextSequence } = require("./giftAdmin")
const rules = require("./opsRules")

const orders = () => database.collection("orders")
const refunds = () => database.collection("refunds")
const HOUR = 60 * 60 * 1000

// Dòng statusHistory (06 Mục 4.1) - by: id nhân viên/khách, byRole: NHAN_VIEN | KHACH | HE_THONG
const historyEntry = (field, from, to, { by = null, byRole = "NHAN_VIEN", note = null, at = new Date() } = {}) => ({ field, from, to, at, by, byRole, note })

// Thông báo cho chủ đơn; lỗi không làm hỏng thao tác chính
async function notifyOwner(o, { type = "DON_HANG", title, body, link, highlight }) {
  try {
    const owner = await database.collection("users").findOne({ _id: o.userId }, { projection: { phone: 1 } })
    if (owner) await notifier.notify(owner, { type, title, body, link: link || `/tai-khoan/don-hang/${o.code}`, highlight })
  } catch (err) {
    console.error("Gửi thông báo đơn hàng lỗi:", err.message)
  }
}

// Câu xin lỗi kèm voucher và nội dung hộp nổi bật phía khách (BR-30)
const APOLOGY_LINE = "Để thay lời xin lỗi, Soulprint gửi bạn voucher giảm 10% cho đơn hàng tiếp theo."
const APOLOGY_POPUP = "Để thay lời xin lỗi vì đơn hàng không thể thực hiện được, Soulprint gửi bạn voucher giảm 10% cho bất kỳ đơn hàng nào."

// Câu nhắc thêm vào thông báo khi yêu cầu hoàn chưa có tài khoản nhận (khách chưa lưu tài khoản)
const refundAccountHint = (refund) =>
  refund && refund.method !== "GATEWAY" && !refund.bankInfo ? " Bạn mở đơn hàng và nhập tài khoản ngân hàng để Soulprint chuyển tiền." : ""

// Tạo yêu cầu hoàn tiền chuyển khoản CHO_XU_LY (06 Mục 4.5); đã có yêu cầu đang chờ cùng lý do thì cộng dồn số tiền
// (index orderCode_reason_open chỉ cho 1 yêu cầu mở mỗi lý do). Tài khoản nhận: tài khoản khách vừa nhập (bankInfo),
// không có thì tài khoản khách đã lưu, chưa có thì để trống để nhân viên liên hệ khách.
// preCounted: số tiền đã trừ vào orders.refundedAmount lúc tạo (phần dư khi đơn đổi - BR-47), hoàn xong không cộng lần nữa
async function openRefund(o, { reason, amount, by = null, note = null, bankInfo = null, preCounted = false, now = new Date() }) {
  if (!(amount > 0)) return null
  const open = await refunds().findOneAndUpdate(
    { orderCode: o.code, reason, status: "CHO_XU_LY" },
    { $inc: { amount }, $set: { updatedAt: now } },
    { returnDocument: "after" },
  )
  if (open) return open
  const owner = await database.collection("users").findOne({ _id: o.userId }, { projection: { refundAccount: 1 } })
  const acc = owner?.refundAccount
  const doc = {
    orderId: o._id, orderCode: o.code, userId: o.userId, reason, amount, method: "BANK_TRANSFER",
    bankInfo: bankInfo || (acc ? { bankName: acc.bankName, accountNumber: acc.accountNumber, accountName: acc.accountName } : null),
    status: "CHO_XU_LY", slaDeadline: new Date(now.getTime() + params.REFUND_SLA_HOURS * HOUR), createdBy: by, note, ...(preCounted ? { preCounted: true } : {}),
    createdAt: now, updatedAt: now,
  }
  doc._id = (await refunds().insertOne(doc)).insertedId
  return doc
}

// Trường lưu kho khi đơn TH3 bắt đầu lưu (OPS-04, OPS-03 hủy ngoại lệ sau khi cá nhân hóa): mã LK-MMdd-nn
async function storageFields(o, now = new Date()) {
  const out = rules.refusalOutcome(o, now)
  if (out.cancelCase !== "TH3") return { cancelCase: out.cancelCase }
  const vn = new Date(now.getTime() + 7 * HOUR).toISOString()
  const seq = await nextSequence(`storage-${vn.slice(5, 7)}${vn.slice(8, 10)}`)
  return {
    cancelCase: "TH3",
    storageStatus: out.storageStatus,
    storageDeadline: out.storageDeadline,
    storageCode: rules.storageCode(now, seq),
    storedAt: now,
  }
}

// BR-10: đơn DANG_LUU_KHO quá hạn chuyển HET_HAN_LUU_KHO và báo khách. Chạy mỗi giờ và khi đọc danh sách lưu kho.
async function expireStorage(now = new Date()) {
  const due = await orders().find({ storageStatus: "DANG_LUU_KHO", storageDeadline: { $lte: now } }, { projection: { code: 1, userId: 1 } }).toArray()
  for (const o of due) {
    const r = await orders().updateOne(
      { _id: o._id, storageStatus: "DANG_LUU_KHO" },
      {
        $set: { storageStatus: "HET_HAN_LUU_KHO", updatedAt: now },
        $push: { statusHistory: historyEntry("storageStatus", "DANG_LUU_KHO", "HET_HAN_LUU_KHO", { byRole: "HE_THONG", note: "Quá hạn lưu kho 14 ngày (BR-10)", at: now }) },
      },
    )
    if (r.modifiedCount) {
      await notifyOwner(o, { title: `Đơn ${o.code} quá hạn lưu kho`, body: "Quá hạn lưu kho 14 ngày, đơn hàng cá nhân hóa đã được chuyển xử lý." })
    }
  }
  return due.length
}

module.exports = { historyEntry, notifyOwner, openRefund, storageFields, expireStorage, refundAccountHint, APOLOGY_LINE, APOLOGY_POPUP }
