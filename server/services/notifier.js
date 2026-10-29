// Adapter NotificationProvider (07_API_Spec.md Mục 1.5) - bản mô phỏng SimulatedNotifier:
// không gửi SMS/email thật (không tốn phí), chỉ ghi collection notifications và in ra console.
// Khi DEMO_MODE=true, API trả kèm devCode/devLink để hiện trên màn hình demo.
// Muốn gửi thật sau này chỉ cần viết adapter khác cùng 3 hàm, không sửa controller.
const { database } = require("../config/db")

const isDemo = () => process.env.DEMO_MODE === "true"

// highlight: thông báo cần hộp nổi bật giữa màn hình phía khách, hiện 1 lần (VD VOUCHER_XIN_LOI)
async function save(userId, phone, type, title, body, link, highlight = null) {
  await database.collection("notifications").insertOne({
    userId: userId || null, phone: phone || null, type, title, body, link: link || null, readAt: null, createdAt: new Date(),
    ...(highlight ? { highlight, highlightSeenAt: null } : {}),
  })
}

const SimulatedNotifier = {
  // Mã xác minh 6 số (quên mật khẩu, tra cứu đơn - BR-24)
  async sendOtp(user, code, purposeLabel) {
    console.log(`[Thông báo mô phỏng] ${purposeLabel} gửi ${user.phone || user.email}: ${code}`)
    await save(user._id, user.phone, "TAI_KHOAN", purposeLabel, "Mã xác minh đã được gửi (bản mô phỏng không lưu mã).")
    return isDemo() ? { devCode: code } : {}
  },

  // Liên kết kích hoạt tài khoản (ACC-04, ACC-07)
  async sendLink(user, purposeLabel, url) {
    console.log(`[Thông báo mô phỏng] ${purposeLabel} gửi ${user.phone || user.email}: ${url}`)
    await save(user._id, user.phone, "TAI_KHOAN", purposeLabel, "Liên kết có hiệu lực 24 giờ.", url)
    return isDemo() ? { devLink: url } : {}
  },

  async notify(user, { type, title, body, link, highlight }) {
    await save(user._id, user.phone, type, title, body, link, highlight)
  },
}

module.exports = { notifier: SimulatedNotifier, isDemo }
