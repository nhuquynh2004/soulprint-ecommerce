// Yêu cầu hậu mãi phía quản trị (07_API_Spec.md Mục 2.19) - S9: API-99, API-196, API-100, API-101, API-102.
// API-100, API-101 kiểm quyền theo thao tác trong service (duyệt/từ chối, nhận hàng, hoàn tiền, cập nhật tiến độ).
const afterSalesAdmin = require("../services/afterSalesAdmin")
const returns = require("../services/returns")
const warranty = require("../services/warranty")

// API-99 GET /api/admin/requests?type=RETURN|WARRANTY|REFUND&stage=&q=&page=
async function listRequests(req, res) {
  res.send(await afterSalesAdmin.list(req, req.query))
}

// API-196 GET /api/admin/requests/:kind/:id - kind: returns | warranty | refunds
async function getRequest(req, res) {
  res.send(await afterSalesAdmin.detail(req, String(req.params["kind"]), String(req.params["id"])))
}

// API-100 PUT /api/admin/returns/:id - trả chi tiết sau khi xử lý
async function updateReturn(req, res) {
  await returns.adminUpdate(req, req.params["id"], req.body || {})
  res.send(await afterSalesAdmin.detail(req, "returns", String(req.params["id"])))
}

// API-101 PUT /api/admin/warranty/:id
async function updateWarranty(req, res) {
  await warranty.adminUpdate(req, req.params["id"], req.body || {})
  res.send(await afterSalesAdmin.detail(req, "warranty", String(req.params["id"])))
}

// API-102 PUT /api/admin/refunds/:id - {status: DA_HOAN | THAT_BAI, note}
async function updateRefund(req, res) {
  await afterSalesAdmin.updateRefund(req, req.params["id"], req.body || {})
  res.send(await afterSalesAdmin.detail(req, "refunds", String(req.params["id"])))
}

module.exports = { listRequests, getRequest, updateReturn, updateWarranty, updateRefund }
