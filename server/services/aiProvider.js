// Adapter AiProvider: chatbot gọi 4 hàm dưới đây, không gọi thẳng dịch vụ AI.
// Bản dùng là KeywordAiProvider - phương án nội bộ theo từ điển từ khóa (services/chatRules.js).
// Không dùng dịch vụ AI bên ngoài; muốn mở rộng thì viết adapter khác cùng 4 hàm (lỗi thì gọi lại bản nội bộ) rồi đổi
// biến `ai` ở cuối file; controller và service chat không phải sửa.
const rules = require("./chatRules")

const KeywordAiProvider = {
  name: "NOI_BO",
  // Tin có gay gắt không (UC-CSK-01 bước 4)
  async isHarsh(text) {
    return rules.isHarsh(text)
  },
  // Bản lịch sự hơn, null nếu không tạo được (UC-CSK-03 3Ea)
  async soften(text) {
    return rules.soften(text)
  },
  // {sentiment, sentimentScore} từ các tin của khách (UC-CSK-02 bước 3)
  async sentiment(texts) {
    return rules.sentiment(texts)
  },
  // Tóm tắt ngắn, null nếu không tạo được (UC-CSK-02 2Ea)
  async summarize(texts) {
    return rules.summarize(texts)
  },
}

const ai = KeywordAiProvider

module.exports = { ai }
