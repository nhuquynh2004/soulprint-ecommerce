// Tham số nghiệp vụ, khai báo một lần (02_Actors_BusinessRules_Glossary.md Mục 5).
// Tham số "Quản trị đổi = Có" chỉ là giá trị khởi tạo: giá trị đang áp dụng đọc từ siteSettings (key "store"), BR-35.
module.exports = {
  // Quản trị đổi ở Cài đặt cửa hàng
  DEPOSIT_RATE: 0.5, // BR-03, cho phép 10-100%
  SHIPPING_FEE: 30000, // đồng giá toàn quốc
  STICKER_FEE: 5000, // BR-20
  INSIGHT_STOCKOUT_DAYS: 7, // UC-CAT-03
  INSIGHT_EXPIRY_DAYS: 7,
  ABANDONED_CART_DAYS: 7,
  INSIGHT_STORAGE_DAYS: 3, // đơn lưu kho còn từ 3 ngày giữ trở xuống vào Gợi ý hành động

  // Chỉ đổi qua Change Request
  GIFT_WRAP_FEE: 0, // BR-21
  ENGRAVE_MAX_CHARS: 20, // BR-18 chế độ Thường
  ENGRAVE_JERSEY_DEFAULTS: { topMaxChars: 20, bottomMaxChars: 20, numberMaxDigits: 3 }, // BR-18 (20/20/3)
  STICKER_MAX: 3, // BR-20: tối đa 3 sticker mỗi sản phẩm
  DESIGN_MESSAGE_MAX_CHARS: 150, // BR-20: lời nhắn in trên sản phẩm của Thiết kế, miễn phí
  GIFT_MESSAGE_MAX_CHARS: 200, // UC-CRT-04 2b: lời nhắn trên thiệp gói quà
  CART_MAX_QUANTITY: 99, // 06 Mục 3.1: quantity 1-99
  CART_MAX_ITEMS: 50, // giới hạn kỹ thuật: số dòng tối đa trong 1 giỏ (session nhỏ gọn)
  SAVED_DESIGNS_MAX: 50, // giới hạn kỹ thuật: số thiết kế đã lưu của 1 Member
  NOTE_MAX_CHARS: 200,
  REDELIVERY_WINDOW_DAYS: 14, // BR-09, BR-10
  MAX_REDELIVERY: 1, // BR-11
  RETURN_WINDOW_DAYS: 7, // BR-12
  RETURN_MAX_IMAGES: 5, // BR-31
  RETURN_MAX_IMAGE_MB: 10,
  REJECT_REASON_MIN: 10, // BR-16
  REJECT_REASON_MAX: 500,
  EVIDENCE_MAX_VIDEO_MB: 8,
  AFTERSALES_TEXT_MAX: 500, // Mô tả đổi trả, bảo hành, nhận xét đánh giá
  REVIEW_EDIT_HOURS: 24, // UC-TRK-03: sửa đánh giá trong 24 giờ
  AFTERSALES_SLA_HOURS: 48, // BR-16: hạn xử lý yêu cầu đổi trả, bảo hành
  OTP_TTL_MINUTES: 5, // BR-24
  OTP_MAX_ATTEMPTS: 5,
  OTP_LOCK_MINUTES: 15,
  ACTIVATION_TTL_HOURS: 24, // BR-25
  OTP_RESEND_SECONDS: 60, // BR-25: gửi lại mã quên mật khẩu
  RESET_TOKEN_TTL_MINUTES: 15, // BR-25: thời gian đặt mật khẩu mới sau khi xác minh mã
  LOGIN_MAX_FAILS: 5, // UC-ACC-02 4Eb, NFR-SEC-06
  LOGIN_LOCK_MINUTES: 15,
  REMEMBER_DAYS: 30, // cookie remember_user / remember_staff (slide 8.2)
  // Voucher chào mừng: voucher bật autoOnSignup, hạn theo validDays của voucher (thay WELCOME_VOUCHER_CODE)
  VOUCHER_EXPIRING_DAYS: 3, // UC-ACC-05 tab "Sắp hết hạn"
  NEW_MEMBER_DAYS: 30, // đối tượng "Thành viên mới"
  VOUCHER_CONTACTS_MAX: 1000, // UC-CAT-02 5Eh: số dòng tối đa của tệp SĐT/email
  DELIVERY_SLOTS: ["08:00 - 12:00", "14:00 - 18:00", "18:00 - 21:00"], // UC-PAY-02 2a
  DELIVERY_LEAD_DAYS: 2,
  DELIVERY_MAX_DAYS: 14, // chọn ngày giao tối đa sau ngày sớm nhất
  // Ngày giao sớm nhất (Quỳnh chốt 18/10/2026): ngày đặt + 1 nếu đặt từ 12:00 + 3 nếu có cá nhân hóa + vận chuyển.
  // Chưa trừ Chủ nhật, ngày lễ.
  DELIVERY_CUTOFF_HOUR: 12,
  PERSONALIZATION_DAYS: 3,
  SHIPPING_DAYS_HCM: 2,
  SHIPPING_DAYS_OTHER: 4,
  // Đặt gấp: số yêu cầu đang mở tối đa mỗi SĐT, phụ phí tối đa nhân viên nhập
  URGENT_OPEN_MAX: 3,
  URGENT_FEE_MAX: 2000000,
  // CSKH: nhân viên đã xem tin khách mà quá số phút chưa trả lời thì nhắc
  CHAT_REPLY_REMIND_MINUTES: 5,
  AUTO_COMPLETE_HOURS: 72, // BR-26
  UNFULFILLABLE_SLA_HOURS: 2, // BR-29
  REFUND_SLA_HOURS: 48, // BR-16: hạn xử lý yêu cầu hoàn tiền (06 refunds.slaDeadline)
  LOOKUP_SESSION_MINUTES: 30, // UC-TRK-01: phiên đã xác thực tra cứu đơn
  UNFULFILLABLE_RESPONSE_HOURS: 48, // BR-30: hạn khách trả lời khi đang hỏi khách (nhân viên chọn 4, 24, 48)
  APOLOGY_VOUCHER_CODE: "QUATANG10", // BR-30: voucher xin lỗi mặc định khi hủy đơn không thể thực hiện (mã cũ XINLOI10)
  REFUND_VOUCHER_DAYS: 90, // BR-47: hạn dùng voucher hoàn phần đã trả dư
  GUEST_AI_TRIALS: 3, // UC-DIS-05: lượt thử Guest mỗi thiết bị; tinh chỉnh không tính lượt
  PAYMENT_TTL_MINUTES: 15, // UC-PAY-04 nhánh 5b
  PAYMENT_LINK_TTL_HOURS: 1, // UC-OPS-02, UC-OPS-03 2d: liên kết nhân viên gửi 
  ORDER_VALUE_EDIT_MAX: 1, // BR-47: số lần khách tự sửa làm đổi tổng đơn
  // Chăm sóc khách hàng (UC-CSK-01 đến CSK-04)
  SUPPORT_HOURS: { start: 8, end: 22 }, // 8:00 - 22:00 giờ Việt Nam
  CHAT_MESSAGE_MAX: 1000, // tin nhắn, lời nhắn ngoài giờ (UC-CSK-01 3Ea)
  CHAT_NOTE_MAX: 500, // ghi chú nội bộ (UC-CSK-04 4c)
  CHAT_WAIT_MINUTES_PER_POSITION: 3, // thời gian chờ dự kiến = vị trí × 3 phút
  CHAT_BOT_MISS_LIMIT: 2, // không hiểu 2 câu liên tiếp thì chuyển nhân viên (UC-CSK-01 5a)
  CHAT_QUICK_REPLIES: [
    { label: "Chào bạn", text: "Chào bạn, mình là nhân viên hỗ trợ của Soulprint. Mình đã đọc nội dung bạn trao đổi với Sâu Béo, mình hỗ trợ ngay nhé." },
    { label: "Đang kiểm tra đơn", text: "Bạn chờ mình một chút, mình đang kiểm tra đơn hàng của bạn nhé." },
    { label: "Hẹn ngày giao", text: "Đơn của bạn dự kiến được giao vào ngày ..., Soulprint sẽ báo bạn ngay khi đơn rời kho nhé." },
    { label: "Cảm ơn bạn", text: "Cảm ơn bạn đã liên hệ Soulprint. Nếu cần thêm gì, bạn cứ nhắn cho Sâu Béo nhé!" },
  ],
  MAX_ROLES_PER_STAFF: 2, // BR-34
  ROLE_NAME_MIN: 3, // BR-37
  ROLE_NAME_MAX: 40,
  MAX_OPTION_GROUPS: 3, // BR-39
  MAX_OPTION_VALUES: 20,
  MAX_VARIANTS: 100,

  // Khám phá sản phẩm (S1, 07_API_Spec.md Mục 2.3 "Cách hiểu tham số của API-26")
  NEW_PRODUCT_DAYS: 30, // nhãn "Mới", chip "Mới"
  BEST_SELLER_MIN_SOLD: 10, // nhãn "Bán chạy"
  HIGH_RATING_MIN: 4, // chip "Đánh giá cao"
  PRODUCT_PAGE_SIZE: 12, // UC-DIS-04 bước 5
  MAX_PAGE_SIZE: 48,
  SEARCH_MIN_CHARS: 2, // UC-DIS-03 bước 2
  SUGGEST_LIMIT: 5, // UC-DIS-03 bước 3
  RELATED_LIMIT: 8, // API-28 "Có thể bạn quan tâm"
  HOME_LIST_LIMIT: 8, // khối sản phẩm trang chủ
  HOME_REVIEW_LIMIT: 6, // khối đánh giá trang chủ
  BEST_SELLING_DAYS: 30, // khối nổi bật dự phòng (UC-DIS-01 bước 2)
  REVIEW_PAGE_SIZE: 10,

  // Giới hạn tệp tải lên sau khi giải mã base64 (07_API_Spec.md Mục 1.2)
  MAX_IMAGE_MB: 2,
  MAX_VIDEO_MB: 8,
  MAX_PDF_MB: 5,
  ORPHAN_FILE_HOURS: 24, // tệp không còn được tham chiếu bị xóa sau 24 giờ (06 Mục 6.2)
}
