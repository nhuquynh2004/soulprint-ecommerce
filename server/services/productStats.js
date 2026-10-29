// Đếm lượt xem, yêu thích, thêm giỏ của từng sản phẩm theo ngày giờ Việt Nam (collection productDailyStats)
// cho phễu chuyển đổi và Gợi ý hành động ở SCR-40. $inc + upsert nên không cần đọc trước; ghi lỗi chỉ in ra console,
// không làm hỏng thao tác của khách.
const { database, ObjectId } = require("../config/db")
const { vnDay } = require("./reportRules")

const FIELDS = ["views", "wishlists", "addToCarts"]

function record(productId, field) {
  if (!FIELDS.includes(field) || !ObjectId.isValid(String(productId))) return Promise.resolve()
  return database
    .collection("productDailyStats")
    .updateOne({ productId: new ObjectId(String(productId)), date: vnDay(new Date()) }, { $inc: { [field]: 1 } }, { upsert: true })
    .catch((e) => console.error("productDailyStats:", e.message))
}

module.exports = { record }
