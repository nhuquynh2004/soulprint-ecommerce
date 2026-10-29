// Khách hàng phía quản trị (07_API_Spec.md API-98, API-138 đến API-142). S5 làm phần tìm khách cho đối tượng
// "Danh sách chọn" của voucher (UC-CAT-02 bước 3 vùng 4); S8 (UC-OPS-08) bổ sung số đơn, tổng chi tiêu, đơn gần nhất,
// lọc, sắp xếp, hồ sơ, khóa/mở khóa và đánh giá.
const customers = require("../services/customersAdmin")

// API-98 GET /api/admin/customers?q=&status=&hasOrders=&sort=&page=&pageSize=
async function listCustomers(req, res) {
  res.send(await customers.list(req.query))
}

// API-138 GET /api/admin/customers/:id
async function getCustomer(req, res) {
  res.send(await customers.detail(req.params["id"]))
}

// API-139 PUT /api/admin/customers/:id - {status, reason} | {unlockLogin: true} | {unlockLookup: true}
async function updateCustomer(req, res) {
  res.send(await customers.update(req, req.params["id"], req.body || {}))
}

// API-140 POST /api/admin/customers/:id/activation-link
async function resendActivation(req, res) {
  res.send(await customers.resendActivation(req, req.params["id"]))
}

// API-141 GET /api/admin/reviews?rating=&hidden=&productId=&q=&page=
async function listReviews(req, res) {
  res.send(await customers.listReviews(req.query))
}

// API-142 PUT /api/admin/reviews/visibility - {reviewIds[], isHidden, reason}
async function setReviewVisibility(req, res) {
  res.send(await customers.setVisibility(req, req.body || {}))
}

// API-233 PUT /api/admin/reviews/reply - {_id, text}; text rỗng là xóa câu trả lời
async function replyReview(req, res) {
  res.send(await customers.replyReview(req, req.body || {}))
}

module.exports = { listCustomers, getCustomer, updateCustomer, resendActivation, listReviews, setReviewVisibility, replyReview }
