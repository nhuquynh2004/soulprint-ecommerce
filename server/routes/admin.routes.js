// Khu quản trị - đăng nhập nhân viên, phiên, nhân viên, vai trò (07_API_Spec.md Mục 2.11, 2.12) - S2;
// catalog, bộ sưu tập, trang chủ, cài đặt (Mục 2.11, 2.17, 2.18, 2.19) - S3; cá nhân hóa và gói quà (Mục 2.14) - S4;
// voucher - S5; đơn hàng, đơn nháp, hàng lưu kho, khách hàng và đánh giá (Mục 2.12, 2.16, 2.18) - S8;
// yêu cầu hậu mãi - S9; hỗ trợ khách hàng - S11; báo cáo tổng quan - S12. Mọi route dưới /api/admin (trừ đăng nhập) kiểm tra quyền ở middleware (NFR-SEC-04).
const express = require("express")
const adminAuth = require("../controllers/admin-auth.controller")
const staff = require("../controllers/staff.controller")
const role = require("../controllers/role.controller")
const product = require("../controllers/admin-product.controller")
const file = require("../controllers/file.controller")
const category = require("../controllers/admin-category.controller")
const tag = require("../controllers/admin-tag.controller")
const collection = require("../controllers/admin-collection.controller")
const home = require("../controllers/admin-home.controller")
const setting = require("../controllers/admin-setting.controller")
const sticker = require("../controllers/admin-sticker.controller")
const giftwrap = require("../controllers/admin-giftwrap.controller")
const voucher = require("../controllers/admin-voucher.controller")
const customer = require("../controllers/admin-customer.controller")
const order = require("../controllers/admin-order.controller")
const request = require("../controllers/admin-request.controller")
const chat = require("../controllers/admin-chat.controller")
const report = require("../controllers/admin-report.controller")
const authCtl = require("../controllers/auth.controller")
const { requireStaff, requireAdminOnly, requirePermission } = require("../middlewares/auth")

const router = express.Router()

router.post("/auth/login", adminAuth.staffLogin) // API-131
router.post("/auth/logout", requireStaff, authCtl.logout) // API-212
router.get("/auth/me", authCtl.me) // API-213
router.get("/auth/sessions", requireStaff, adminAuth.listSessions) // API-132
router.delete("/auth/sessions/:id", requireStaff, adminAuth.deleteSession) // API-133

router.get("/staff", requireAdminOnly, staff.listStaff) // API-134
router.post("/staff", requireAdminOnly, staff.createStaff) // API-135
router.put("/staff", requireAdminOnly, staff.updateStaff) // API-136 (_id trong body)
router.post("/staff/:id/activation-link", requireAdminOnly, staff.resendActivation) // API-137

router.get("/roles", requireAdminOnly, role.listRoles) // API-178
router.get("/roles/:id", requireAdminOnly, role.getRole) // API-179
router.post("/roles", requireAdminOnly, role.createRole) // API-180
router.put("/roles", requireAdminOnly, role.updateRole) // API-181 (_id trong body)
router.delete("/roles/:id", requireAdminOnly, role.deleteRole) // API-182
router.get("/permissions", requireAdminOnly, role.listPermissions) // API-183

// Sản phẩm (Mục 2.11, 2.19) - S3. Đường dẫn cố định đứng trước /products/:id
router.get("/products", requirePermission("SAN_PHAM.XEM"), product.listProducts) // API-65
router.get("/products/export", requirePermission("SAN_PHAM.XEM"), product.exportProducts) // API-162
router.get("/products/next-sku", requirePermission("SAN_PHAM.XEM"), product.nextSku) // API-214
router.post("/products/bulk", requireStaff, product.bulkProducts) // API-161 (quyền theo action, kiểm trong controller)
router.put("/products/bulk-tags", requirePermission("TAGS.SUA"), tag.bulkTags) // API-79
router.get("/products/:id", requirePermission("SAN_PHAM.XEM"), product.getProduct) // API-66
router.post("/products", requirePermission("SAN_PHAM.TAO"), product.createProduct) // API-67
router.put("/products", requirePermission("SAN_PHAM.SUA", "SAN_PHAM.SUA_GIA", "SAN_PHAM.CAP_NHAT_TON"), product.updateProduct) // API-68 (quyền theo trường)
router.delete("/products/:id", requirePermission("SAN_PHAM.XOA"), product.deleteProduct) // API-69
router.post("/products/:id/duplicate", requirePermission("SAN_PHAM.TAO"), product.duplicateProduct) // API-163

// Danh mục (Mục 2.11, 2.19)
router.get("/categories", requirePermission("DANH_MUC.XEM", "SAN_PHAM.XEM"), category.listCategories) // API-71
router.post("/categories/bulk", requireStaff, category.bulkCategories) // API-164 (quyền theo action)
router.post("/categories", requirePermission("DANH_MUC.TAO"), category.createCategory) // API-72
router.put("/categories", requirePermission("DANH_MUC.SUA"), category.updateCategory) // API-73
router.delete("/categories/:id", requirePermission("DANH_MUC.XOA"), category.deleteCategory) // API-74

// Tag, nhóm tag, nhu cầu chưa đáp ứng (Mục 2.11)
router.get("/tags", requirePermission("TAGS.XEM"), tag.listTags) // API-75
router.post("/tags", requirePermission("TAGS.TAO"), tag.createTag) // API-76
router.put("/tags", requirePermission("TAGS.SUA"), tag.updateTag) // API-77
router.delete("/tags/:id", requirePermission("TAGS.XOA"), tag.deleteTag) // API-78
router.get("/tag-groups", requirePermission("TAGS.XEM"), tag.listGroups) // API-186
router.post("/tag-groups", requirePermission("TAGS.TAO"), tag.createGroup) // API-187
router.put("/tag-groups", requirePermission("TAGS.SUA"), tag.updateGroup) // API-188
router.delete("/tag-groups/:code", requirePermission("TAGS.XOA"), tag.deleteGroup) // API-189
router.get("/ai/gaps", requirePermission("TAGS.XEM"), tag.listGaps) // API-80
router.put("/ai/gaps/:id", requirePermission("TAGS.SUA"), tag.updateGap) // API-81

// Bộ sưu tập (Mục 2.17, 2.19)
router.get("/collections", requirePermission("BO_SUU_TAP.XEM"), collection.listCollections) // API-109
router.post("/collections/bulk", requireStaff, collection.bulkCollections) // API-167 (quyền theo action)
router.post("/collections/rules-preview", requirePermission("BO_SUU_TAP.XEM"), collection.previewRules) // API-169
router.get("/collections/:id", requirePermission("BO_SUU_TAP.XEM"), collection.getCollection) // API-109 (một BST)
router.post("/collections", requirePermission("BO_SUU_TAP.TAO"), collection.createCollection) // API-110
router.put("/collections", requirePermission("BO_SUU_TAP.SUA"), collection.updateCollection) // API-111
router.delete("/collections/:id", requirePermission("BO_SUU_TAP.XOA"), collection.deleteCollection) // API-112
router.post("/collections/:id/duplicate", requirePermission("BO_SUU_TAP.TAO"), collection.duplicateCollection) // API-168

// Trang chủ và banner (Mục 2.17)
router.get("/home", requirePermission("TRANG_CHU.XEM"), home.getHomeAdmin) // API-113
router.put("/home", requirePermission("TRANG_CHU.SUA"), home.saveDraft) // API-114
router.post("/home/publish", requirePermission("TRANG_CHU.XUAT_BAN"), home.publishHome) // API-170
router.post("/banners", requirePermission("TRANG_CHU.SUA"), home.createBanner) // API-115
router.put("/banners", requirePermission("TRANG_CHU.SUA"), home.updateBanner) // API-116
router.delete("/banners/:id", requirePermission("TRANG_CHU.SUA"), home.deleteBanner) // API-117

// Cài đặt cửa hàng, chính sách, FAQ chatbot (Mục 2.18) - chỉ vai trò Quản trị
router.get("/settings", requireAdminOnly, setting.getSettings) // API-144
router.put("/settings", requireAdminOnly, setting.updateSettings) // API-145
router.get("/policies", requireAdminOnly, setting.listPolicies) // danh sách trang cho API-147
router.put("/policies", requireAdminOnly, setting.updatePolicy) // API-147
router.get("/faqs", requireAdminOnly, setting.listFaqs) // API-148
router.post("/faqs", requireAdminOnly, setting.createFaq) // API-149
router.put("/faqs", requireAdminOnly, setting.updateFaq) // API-150
router.delete("/faqs/:id", requireAdminOnly, setting.deleteFaq) // API-151

// Cá nhân hóa và gói quà (Mục 2.14, 2.19) - S4. Quyền theo 07 Mục 1.1: bulk kiểm theo action trong controller
router.get("/sticker-sets", requirePermission("GOI_QUA.XEM"), sticker.listSets) // API-119
router.post("/sticker-sets/bulk", requireStaff, sticker.bulkSets) // API-171
router.post("/sticker-sets", requirePermission("GOI_QUA.TAO"), sticker.createSet) // API-120
router.put("/sticker-sets", requirePermission("GOI_QUA.SUA"), sticker.updateSet) // API-121 (_id trong body)
router.delete("/sticker-sets/:id", requirePermission("GOI_QUA.XOA"), sticker.deleteSet) // API-122
router.get("/gift-wrap-templates", requirePermission("GOI_QUA.XEM"), giftwrap.listTemplates) // API-123
router.post("/gift-wrap-templates/bulk", requireStaff, giftwrap.bulkTemplates) // API-172
router.post("/gift-wrap-templates", requirePermission("GOI_QUA.TAO"), giftwrap.createTemplate) // API-124
router.put("/gift-wrap-templates", requirePermission("GOI_QUA.SUA"), giftwrap.updateTemplate) // API-125 (_id trong body)
router.delete("/gift-wrap-templates/:id", requirePermission("GOI_QUA.XOA"), giftwrap.deleteTemplate) // API-126
router.get("/gift-wrap-materials", requirePermission("GOI_QUA.XEM"), giftwrap.listMaterials) // API-127
router.post("/gift-wrap-materials/bulk", requirePermission("GOI_QUA.QUAN_LY_VAT_LIEU"), giftwrap.bulkMaterials) // API-173
router.post("/gift-wrap-materials", requirePermission("GOI_QUA.QUAN_LY_VAT_LIEU"), giftwrap.createMaterial) // API-128
router.put("/gift-wrap-materials", requirePermission("GOI_QUA.QUAN_LY_VAT_LIEU"), giftwrap.updateMaterial) // API-129 (_id trong body)
router.delete("/gift-wrap-materials/:id", requirePermission("GOI_QUA.QUAN_LY_VAT_LIEU"), giftwrap.deleteMaterial) // API-130
router.get("/stock-movements", requirePermission("GOI_QUA.NHAP_KHO"), giftwrap.listMovements) // API-174
router.post("/stock-movements", requirePermission("GOI_QUA.NHAP_KHO"), giftwrap.createMovement) // API-175

// Voucher (Mục 2.11, 2.19) - S5. API-165 kiểm quyền theo action trong controller
router.get("/vouchers", requirePermission("VOUCHER.XEM"), voucher.listVouchers) // API-82
router.get("/vouchers/usage-export", requirePermission("VOUCHER.XUAT_CSV"), voucher.exportUsage) // API-166
router.post("/vouchers/bulk", requireStaff, voucher.bulkVouchers) // API-165
router.post("/vouchers/match-customers", requirePermission("VOUCHER.TAO", "VOUCHER.SUA"), voucher.matchCustomers) // API-190
router.get("/vouchers/:id", requirePermission("VOUCHER.XEM"), voucher.getVoucher) // API-83
router.post("/vouchers", requirePermission("VOUCHER.TAO"), voucher.createVoucher) // API-84
router.put("/vouchers", requirePermission("VOUCHER.SUA"), voucher.updateVoucher) // API-85 (_id trong body)
router.delete("/vouchers/:id", requirePermission("VOUCHER.XOA"), voucher.deleteVoucher) // API-86
router.post("/vouchers/:id/duplicate", requirePermission("VOUCHER.TAO"), voucher.duplicateVoucher) // API-87

// Khách hàng và đánh giá (Mục 2.16) - S8. API-98 còn là ô tìm khách của voucher (S5) và đơn nháp
router.get("/customers", requirePermission("KHACH_HANG.XEM", "DON_NHAP.XEM", "VOUCHER.TAO", "VOUCHER.SUA"), customer.listCustomers) // API-98
router.get("/customers/:id", requirePermission("KHACH_HANG.XEM"), customer.getCustomer) // API-138
router.put("/customers/:id", requirePermission("KHACH_HANG.SUA", "KHACH_HANG.KHOA_TAI_KHOAN"), customer.updateCustomer) // API-139 (quyền theo thao tác)
router.post("/customers/:id/activation-link", requirePermission("KHACH_HANG.SUA"), customer.resendActivation) // API-140
router.get("/reviews", requirePermission("KHACH_HANG.XEM"), customer.listReviews) // API-141
router.put("/reviews/visibility", requirePermission("KHACH_HANG.AN_DANH_GIA"), customer.setReviewVisibility) // API-142
router.put("/reviews/reply", requirePermission("KHACH_HANG.AN_DANH_GIA"), customer.replyReview) // API-233

// Đơn hàng (Mục 2.12, 2.18) - S8. Đường dẫn cố định đứng trước /orders/:code. API-92, API-96, API-159 kiểm quyền
// theo bước/loại/action trong service (07 Mục 1.1).
router.get("/orders", requirePermission("DON_HANG.XEM", "HANG_LUU_KHO.XEM"), order.listOrders) // API-90 (view=storage cần HANG_LUU_KHO.XEM)
router.get("/orders/stats", requirePermission("DON_HANG.XEM"), order.orderStats) // API-158
router.post("/orders/bulk", requireStaff, order.bulkOrders) // API-159
router.get("/orders/:code", requirePermission("DON_HANG.XEM", "HANG_LUU_KHO.XEM"), order.getOrder) // API-91
router.get("/orders/:code/version", requirePermission("DON_HANG.XEM", "HANG_LUU_KHO.XEM"), order.orderVersion) // API-230
router.put("/orders/:code/status", requireStaff, order.changeStatus) // API-92
router.put("/orders/:code/cod", requirePermission("DON_HANG.SUA"), order.reconcileCod) // API-93
router.put("/orders/:code/unfulfillable", requirePermission("DON_HANG.SUA"), order.markUnfulfillable) // API-94
router.put("/orders/:code/refused", requirePermission("DON_HANG.SUA"), order.markRefused) // API-95
router.post("/orders/:code/exceptions", requireStaff, order.addException) // API-96
router.delete("/orders/:code/pending-change", requirePermission("DON_HANG.SUA"), order.cancelPendingChange) // API-218
router.post("/orders/:code/pending-change/resend", requirePermission("DON_HANG.SUA"), order.resendPendingChange) // API-220
router.post("/orders/:code/conversation", requirePermission("HO_TRO.TRA_LOI"), order.openConversation) // API-221
router.post("/orders/:code/approval-requests", requirePermission("DON_HANG.SUA"), order.requestApproval) // API-222
router.put("/approval-requests/:id", requirePermission("DON_HANG.NGOAI_LE_DAC_BIET"), order.decideApproval) // API-223
router.post("/orders/:code/copy-to-draft", requirePermission("DON_NHAP.TAO"), order.copyToDraft) // API-224
router.post("/payments/:code/confirm", requireStaff, order.confirmPayment) // API-217 (quyền theo loại giao dịch)
router.put("/orders/:code/dispose", requirePermission("HANG_LUU_KHO.TIEU_HUY"), order.dispose) // API-103
router.put("/orders/:code/storage", requirePermission("HANG_LUU_KHO.SUA"), order.setShelf) // API-194
router.put("/orders/:code/tags", requirePermission("DON_HANG.XEM"), order.setTags) // API-231 khối Thẻ (UC-OPS-01 5d)
router.post("/orders/:code/notes", requirePermission("DON_HANG.XEM"), order.addNote) // API-160
router.get("/staff/mentionable", requirePermission("DON_HANG.XEM"), order.mentionable) // API-209
router.get("/mentions", requireStaff, order.myMentions) // API-210
router.put("/mentions/read", requireStaff, order.readMentions) // API-211

// Đơn nháp (Mục 2.18) - S8
router.get("/draft-orders", requirePermission("DON_NHAP.XEM"), order.listDrafts) // API-152
router.post("/draft-orders/quote", requirePermission("DON_NHAP.XEM"), order.quoteDraft) // API-97
router.post("/draft-orders/bulk", requireStaff, order.bulkDrafts) // API-193 (quyền theo action)
router.post("/draft-orders/vouchers", requirePermission("DON_NHAP.XEM"), order.draftVouchersForm) // API-225 theo form đang soạn
router.get("/draft-orders/:code", requirePermission("DON_NHAP.XEM"), order.getDraft) // API-154
router.get("/draft-orders/:code/vouchers", requirePermission("DON_NHAP.XEM"), order.draftVouchers) // API-225
router.post("/draft-orders", requirePermission("DON_NHAP.TAO"), order.createDraft) // API-153
router.put("/draft-orders", requirePermission("DON_NHAP.SUA"), order.updateDraft) // API-155 (code trong body)
router.delete("/draft-orders/:code", requirePermission("DON_NHAP.XOA"), order.deleteDraft) // API-156
router.post("/draft-orders/:code/complete", requirePermission("DON_NHAP.KICH_HOAT"), order.completeDraft) // API-157
router.post("/draft-orders/:code/urgent", requirePermission("DON_NHAP.SUA"), order.urgentAction) // API-205 chốt, mở lại, từ chối đơn gấp

// Yêu cầu hậu mãi (Mục 2.12) - S9. API-100, API-101 kiểm quyền theo thao tác trong service
router.get("/requests", requirePermission("HAU_MAI.XEM"), request.listRequests) // API-99
router.get("/requests/:kind/:id", requirePermission("HAU_MAI.XEM"), request.getRequest) // API-196
router.put("/returns/:id", requireStaff, request.updateReturn) // API-100
router.put("/warranty/:id", requireStaff, request.updateWarranty) // API-101
router.put("/refunds/:id", requirePermission("HAU_MAI.HOAN_TIEN"), request.updateRefund) // API-102

// Hỗ trợ khách hàng (Mục 2.12, 2.19) - S11
router.get("/chat/conversations", requirePermission("HO_TRO.XEM"), chat.listConversations) // API-104
router.get("/chat/conversations/:id", requirePermission("HO_TRO.XEM"), chat.getConversation) // API-105 (nhận hội thoại khi có HO_TRO.TRA_LOI)
router.post("/chat/conversations/:id/messages", requirePermission("HO_TRO.TRA_LOI"), chat.reply) // API-106
router.put("/chat/conversations/:id/close", requirePermission("HO_TRO.TRA_LOI"), chat.close) // API-107
router.post("/chat/conversations/:id/notes", requirePermission("HO_TRO.TRA_LOI"), chat.addNote) // API-176
router.put("/chat/conversations/:id/labels", requirePermission("HO_TRO.TRA_LOI"), chat.setLabels) // API-206
router.put("/me/duty", requirePermission("HO_TRO.TRA_LOI"), chat.setDuty) // API-177

// Báo cáo tổng quan (Mục 2.11) - S12. Trường tài chính lọc ở service theo TONG_QUAN.XEM_DOANH_THU
router.get("/reports", requirePermission("TONG_QUAN.XEM"), report.getReport) // API-88
router.get("/reports/export", requirePermission("TONG_QUAN.XEM"), report.exportReport) // API-89

// Tải ảnh base64 - API-70
const UPLOAD_PERMS = ["SAN_PHAM", "DANH_MUC", "BO_SUU_TAP", "GOI_QUA"].flatMap((a) => [`${a}.TAO`, `${a}.SUA`])
router.post("/uploads", requirePermission(...UPLOAD_PERMS, "TRANG_CHU.SUA", "GOI_QUA.QUAN_LY_VAT_LIEU"), file.upload) // API-70

module.exports = router
