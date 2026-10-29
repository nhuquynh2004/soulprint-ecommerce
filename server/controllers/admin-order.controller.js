// Đơn hàng phía quản trị (07_API_Spec.md Mục 2.17, 2.18) - S8: API-90 đến API-96, API-103, API-158 đến API-160,
// API-194; đơn nháp API-97, API-152 đến API-157, API-193. Quyền kiểm ở route (requirePermission) và trong service
// với thao tác cần quyền theo bước (API-92 theo vai trò, API-96 theo loại, API-159 theo action).
const staffMentions = require("../services/staffMentions")
const HttpError = require("../utils/httpError")
const adminOrders = require("../services/adminOrders")
const draftOrders = require("../services/draftOrders")
const payment = require("../services/payment")

// ===== Đơn hàng =====

// API-90 GET /api/admin/orders?view=&orderStatus=&paymentStatus=&paymentMethod=&personalized=&source=&carrier=&tag=&from=&to=&q=&sort=&page=&storage=
async function listOrders(req, res) {
  const need = req.query.view === "storage" ? "HANG_LUU_KHO.XEM" : "DON_HANG.XEM"
  if (!req.isFullAccess && !req.permissions.has(need)) throw new HttpError(403, "FORBIDDEN", "Bạn không có quyền xem mục này")
  res.send(await adminOrders.list(req, req.query))
}

// API-158 GET /api/admin/orders/stats?days=7|30
async function orderStats(req, res) {
  res.send(await adminOrders.stats(req.query))
}

// API-91 GET /api/admin/orders/:code
async function getOrder(req, res) {
  res.send(await adminOrders.detail(req, req.params["code"]))
}

// API-92 PUT /api/admin/orders/:code/status - {to, carrier?, trackingCode?, deliveredAt?, codCollected?, codDiscrepancyReason?, checks?}
async function changeStatus(req, res) {
  res.send(await adminOrders.changeStatus(req, req.params["code"], req.body || {}))
}

// API-93 PUT /api/admin/orders/:code/cod - {collectedAmount}
async function reconcileCod(req, res) {
  res.send(await adminOrders.reconcileCod(req, req.params["code"], req.body || {}))
}

// API-94 PUT /api/admin/orders/:code/unfulfillable - {action: ASK, itemIds, reasonCode, reason?, message, responseHours}
// | {action: CANCEL, message?, apologyVoucher} | {action: CLEAR, reason}
async function markUnfulfillable(req, res) {
  res.send(await adminOrders.unfulfillable(req, req.params["code"], req.body || {}))
}

// API-222 POST /api/admin/orders/:code/approval-requests - gửi Quản trị duyệt ngoại lệ đặc biệt (BR-48)
async function requestApproval(req, res) {
  res.status(201).send(await adminOrders.requestApproval(req, req.params["code"], req.body || {}))
}

// API-223 PUT /api/admin/approval-requests/:id - {decision: DUYET | TU_CHOI, reason?}
async function decideApproval(req, res) {
  res.send(await adminOrders.decideApproval(req, req.params["id"], req.body || {}))
}

// API-224 POST /api/admin/orders/:code/copy-to-draft - chép đơn vào đơn nháp
async function copyToDraft(req, res) {
  res.status(201).send(await draftOrders.copyFromOrder(req, req.params["code"]))
}

// API-225 GET /api/admin/draft-orders/:code/vouchers - voucher khách dùng được cho đơn nháp
async function draftVouchers(req, res) {
  res.send(await draftOrders.vouchersFor(req.params["code"]))
}

// API-225 POST /api/admin/draft-orders/vouchers - như trên nhưng theo nội dung form đang soạn (body như API-97)
async function draftVouchersForm(req, res) {
  res.send(await draftOrders.vouchersForForm(req.body || {}))
}

// API-230 GET /api/admin/orders/:code/version - phiên bản đơn
async function orderVersion(req, res) {
  res.send(await adminOrders.version(req.params["code"]))
}

// API-221 POST /api/admin/orders/:code/conversation - mở chat với khách của đơn, tin mở đầu điền sẵn
async function openConversation(req, res) {
  res.send(await adminOrders.openConversation(req, req.params["code"]))
}

// API-220 POST /api/admin/orders/:code/pending-change/resend - gửi lại liên kết thanh toán thêm đã hết hạn
async function resendPendingChange(req, res) {
  res.send(await adminOrders.resendPendingChange(req, req.params["code"]))
}

// API-218 DELETE /api/admin/orders/:code/pending-change - hủy thay đổi chờ khách trả thêm
async function cancelPendingChange(req, res) {
  res.send(await adminOrders.cancelPendingChange(req, req.params["code"]))
}

// API-217 POST /api/admin/payments/:code/confirm - nhân viên xác nhận khách đã trả với cổng giả lập
async function confirmPayment(req, res) {
  const can = (p) => req.isFullAccess || req.permissions.has(p)
  res.send(await payment.confirmByStaff(req, req.params["code"], can))
}

// API-95 PUT /api/admin/orders/:code/refused - {reason, refusedShippingFee, note?}
async function markRefused(req, res) {
  res.send(await adminOrders.refused(req, req.params["code"], req.body || {}))
}

// API-96 POST /api/admin/orders/:code/exceptions - {type, reason, changes?, amount?, method?, voucherId?, voucher?, expectedDeliveryDate?}
async function addException(req, res) {
  const body = req.body || {}
  // DOI_SAN_PHAM preview: chỉ tính trước, không ghi gì nên trả 200
  res.status(body.preview === true ? 200 : 201).send(await adminOrders.exception(req, req.params["code"], body))
}

// API-103 PUT /api/admin/orders/:code/dispose - {confirm, method, checked}
async function dispose(req, res) {
  res.send(await adminOrders.dispose(req, req.params["code"], req.body || {}))
}

// API-194 PUT /api/admin/orders/:code/storage - {shelf}
async function setShelf(req, res) {
  res.send(await adminOrders.setShelf(req, req.params["code"], req.body || {}))
}

// API-159 POST /api/admin/orders/bulk - {codes[], action, tags?, kind?}; EXPORT_CSV trả tệp CSV
async function bulkOrders(req, res) {
  const r = await adminOrders.bulk(req, req.body || {})
  if (r.csv !== undefined) {
    res.set("Content-Type", "text/csv; charset=utf-8")
    return res.send(r.csv)
  }
  res.send(r)
}

// Khối Thẻ ở SCR-48 (UC-OPS-01 5d): ghi lại cả danh sách thẻ của 1 đơn
async function setTags(req, res) {
  res.send(await adminOrders.setTags(req, req.params["code"], req.body || {}))
}

// API-160 POST /api/admin/orders/:code/notes - {text, files?: [{name, dataUrl}]}
async function addNote(req, res) {
  res.status(201).send(await adminOrders.addNote(req, req.params["code"], req.body || {}))
}

// ===== Đơn nháp =====

// API-152 GET /api/admin/draft-orders?status=&q=&tag=&source=&page=
async function listDrafts(req, res) {
  res.send(await draftOrders.list(req.query))
}

// API-97 POST /api/admin/draft-orders/quote - dữ liệu đơn nháp đang soạn
async function quoteDraft(req, res) {
  res.send(await draftOrders.quote(req.body || {}))
}

// API-154 GET /api/admin/draft-orders/:code
async function getDraft(req, res) {
  res.send(await draftOrders.get(req.params["code"]))
}

// API-153 POST /api/admin/draft-orders
async function createDraft(req, res) {
  res.status(201).send(await draftOrders.create(req, req.body || {}))
}

// API-155 PUT /api/admin/draft-orders - code trong body
async function updateDraft(req, res) {
  res.send(await draftOrders.update(req, req.body || {}))
}

// API-156 DELETE /api/admin/draft-orders/:code
async function deleteDraft(req, res) {
  await draftOrders.remove(req, req.params["code"])
  res.status(204).end()
}

// API-157 POST /api/admin/draft-orders/:code/complete - {mode: CREATE_ORDER | PAYMENT_LINK}
async function completeDraft(req, res) {
  res.status(201).send(await draftOrders.complete(req, req.params["code"], req.body || {}))
}

// API-193 POST /api/admin/draft-orders/bulk - {codes[], action: COMPLETE | RESEND_LINK | ADD_TAGS | DELETE, tags?}
async function bulkDrafts(req, res) {
  res.send(await draftOrders.bulk(req, req.body || {}))
}

// API-205 POST /api/admin/draft-orders/:code/urgent - {action: CONFIRM | REOPEN | REJECT, reason?}
async function urgentAction(req, res) {
  res.send(await require("../services/urgentOrders").staffAction(req, req.params["code"], req.body || {}))
}

// API-209 GET /api/admin/staff/mentionable, API-210 GET /api/admin/mentions, API-211 PUT /api/admin/mentions/read
async function mentionable(req, res) {
  res.send(await staffMentions.mentionable(req))
}

async function myMentions(req, res) {
  res.send(await staffMentions.mine(req))
}

async function readMentions(req, res) {
  res.send(await staffMentions.markRead(req, req.body || {}))
}

module.exports = {
  mentionable, myMentions, readMentions,
  listOrders, orderStats, getOrder, changeStatus, reconcileCod, markUnfulfillable, cancelPendingChange, resendPendingChange, openConversation, requestApproval, decideApproval, copyToDraft, draftVouchers, draftVouchersForm, orderVersion, confirmPayment, markRefused, addException, dispose, setShelf, bulkOrders, setTags, addNote,
  listDrafts, quoteDraft, getDraft, createDraft, updateDraft, deleteDraft, completeDraft, bulkDrafts, urgentAction,
}
