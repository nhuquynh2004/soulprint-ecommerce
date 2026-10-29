// Adapter PaymentGateway (07_API_Spec.md Mục 1.5) - bản MockGateway: cổng thanh toán giả lập nội bộ.
// Không kết nối ngân hàng, không trừ tiền thật. Trang SCR-08 đóng vai trang của cổng; khi khách bấm một kết quả,
// "cổng" ký kết quả bằng HMAC-SHA256 rồi gửi về hệ thống, hệ thống kiểm chữ ký trước khi xử lý (UC-PAY-04 5bEb).
// Gắn cổng thật (VD ZaloPay) sau này chỉ cần viết adapter khác cùng các hàm, không sửa services/payment.js.
const crypto = require("crypto")

const key = () => process.env.PAYMENT_MOCK_KEY || process.env.SESSION_SECRET || "soulprint-mock-gateway"
const sign = (data) => crypto.createHmac("sha256", key()).update(data).digest("hex")

const MockGateway = {
  provider: "MOCK",

  // Tạo giao dịch phía cổng: trả đường dẫn trang thanh toán và mã giao dịch của cổng
  async createPayment(payment) {
    return { paymentUrl: `/cong-thanh-toan/${payment._id}`, providerTransId: "MOCK-" + payment.code }
  },

  // Cổng giả lập gửi kết quả về hệ thống: {data, mac} giống cách ZaloPay gửi callback
  resultFor(payment, result, now = new Date()) {
    const data = JSON.stringify({ paymentId: String(payment._id), result, providerTransId: payment.providerTransId, at: now.toISOString() })
    return { data, mac: sign(data) }
  },

  // Kiểm chữ ký; sai thì trả null (không cập nhật gì)
  verifyCallback(body) {
    const data = body && typeof body.data === "string" ? body.data : ""
    const mac = body && typeof body.mac === "string" ? body.mac : ""
    const expected = sign(data)
    if (!data || mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null
    try {
      const d = JSON.parse(data)
      return { paymentId: d.paymentId, result: d.result, providerTransId: d.providerTransId }
    } catch {
      return null
    }
  },

  // Hoàn tiền qua cổng (5bEc): cổng giả lập luôn thành công
  async refund(payment, amount) {
    return { ok: true, refundTransId: `MOCK-RF-${payment.code}`, amount }
  },
}

module.exports = { gateway: MockGateway, sign }
