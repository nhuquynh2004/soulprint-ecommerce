# Dữ liệu mẫu (seed)

Dữ liệu demo cho MongoDB. Lệnh `npm run seed` ở `server/` đọc các file này, **xóa toàn bộ CSDL** đang trỏ tới (`MONGODB_DB`, kể cả đơn hàng và phiên đăng nhập) rồi nạp lại và tạo index.

| File | Collection | Số bản ghi | Ghi chú |
|---|---|---|---|
| `categories.json` | `categories` | 6 | 6 danh mục nhu cầu; trục đam mê nằm ở `products.axis` |
| `tagGroups.json` | `tagGroups` | 8 | Nhóm tag hệ thống: 6 nhóm danh sách + Độ tuổi, Ngân sách là nhóm khoảng |
| `tags.json` | `tags` | 49 | Tag của 8 nhóm; tag nhóm khoảng có `range {min, max}`. Tag Công dụng gắn vào sản phẩm theo danh mục |
| `products.json` | `products` | 36 | 12 sản phẩm mỗi trục đam mê, trải đều 6 danh mục; 4 sản phẩm nổi bật; nhóm biến thể theo BR-39 (20 sản phẩm không có nhóm, 15 có 1 nhóm, TT-DNC-SNBD-001 có 2 nhóm Màu sắc gắn ảnh x Size = 9 biến thể, màu Vàng chưa có ảnh, size XL chênh giá +20.000đ); TT-DNC-SNBD-001, AN-DNC-GCO-001, AN-DNC-GCO-002 có bảng size; có sản phẩm In/Khắc chế độ Thường và Áo đấu (TT-DNC-SNBD-001), Thiết kế (sticker lấy từ `stickerSets`), không cá nhân hóa; có giá sale; bảo hành 0/6/12 tháng |
| `vouchers.json` | `vouchers` | 3 | `SOULPRINT10` (chào mừng, 10%), `FREESHIP30` (miễn phí vận chuyển, công khai), `GAMER50K` (giảm 50.000đ, danh mục game) |
| `users.json` | `users` | 8 | 6 nhân viên (1 Quản trị, Ngọc Lan Bán hàng, Quốc Huy Bán hàng + Kho, Minh Khoa Kho có quyền riêng `KHACH_HANG.XEM`, Thảo Vy vai trò tùy chỉnh chờ kích hoạt, Gia Hưng Kho đã khóa), 2 Member |
| `roles.json` | `roles` | 4 | 3 vai trò mặc định với bộ quyền khởi tạo + vai trò tùy chỉnh "Chăm sóc khách hàng" 11 quyền |
| `giftWrapTemplates.json` | `giftWrapTemplates` | 5 | Mẫu gói quà gợi ý: 4 mẫu thường + "Đêm Halloween" theo mùa (nhãn Hot, 01/10-02/11/2026); có mã `GQ-...` và mô tả ngắn |
| `giftWrapMaterials.json` | `giftWrapMaterials` | 15 | Vật liệu cho tab Tạo mới: 5 giấy gói, 5 ruy băng, 5 thiệp; có mô tả ngắn và đơn vị tính |
| `stickerSets.json` | `stickerSets` | 4 | 3 bộ thường theo trục đam mê (Sân cỏ, Thế giới anime, Góc game thủ) + bộ "Halloween 2026" theo mùa (nhãn Mới) |
| `collections.json` | `collections` | 2 | Bộ sưu tập mẫu (liên kết bằng `productSkus`) |
| `homeBanners.json` | `homeBanners` | 2 | Banner trang chủ |
| `siteSettings.json` | `siteSettings` | 2 | `home`: các khối trang chủ (`draft`, `published`); `store`: phí, ngưỡng gợi ý, thông tin cửa hàng (BR-35) |
| `faqs.json` | `faqs` | 11 | Kho câu trả lời của chatbot "Sâu Béo" |
| `policies.json` | `policies` | 6 | Trang chính sách SCR-30 (đổi trả, bảo hành, thanh toán, vận chuyển, bảo mật, điều khoản), nội dung có biến `{{...}}` thay bằng giá trị trong Cài đặt cửa hàng (BR-35) |

Quy ước khi nạp:

- File dùng **slug/SKU** để liên kết (`categorySlug`, `tagSlugs`, `scope.slugs`, `productSkus`, `categorySlugs`, `collectionSlug`); script seed đổi sang `ObjectId` khi nạp.
- `users.json` dùng mã vai trò (`staffRoles`) khớp `roles.json`; `permissionOverrides[].grantedByEmail` được đổi sang `grantedBy` (ObjectId) khi nạp, `grantedAt` = thời điểm nạp.
- `users.json` chứa **mật khẩu demo dạng rõ** để script băm bằng `crypto.scrypt` khi nạp. Đây là tài khoản demo công khai, không phải bí mật; không dùng các mật khẩu này ở nơi khác.
- SKU sản phẩm theo BR-46: `<Trục>-<Mã danh mục>[-<Mã BST>]-<STT>`, VD `TT-MMN-001`, `TT-DNC-SNBD-001`; mã danh mục ở `categories.json` (`code`), mã BST chọn tay ở `collections.json` và catalog bổ sung.
- Ảnh là đường dẫn `/images/...` (ảnh mẫu tĩnh trong `server/public/images/`). Hiện là **82 ảnh giữ chỗ SVG** sinh bằng `node server/scripts/placeholders.js` (tên món, màu theo trục đam mê, nhãn "Ảnh minh họa"). Ảnh thật: đặt đúng tên ảnh giữ chỗ (chỉ đổi đuôi), rồi nhập vào MongoDB (collection `files`) bằng `node --env-file=.env scripts/import-images.js "<thư mục ảnh>"` (xem trước) và thêm `--apply` để ghi; script thay `/images/...` thành `/api/files/<id>` ở mọi collection. Seed lại thì chạy lại script. Ảnh giữ chỗ SVG vẫn giữ trong `server/public/images/` cho seed.
- Địa chỉ mẫu theo địa giới 2 cấp (tỉnh/thành - phường/xã), không có quận/huyện.
- `collectionSlug` trong khối `collection` của `siteSettings` được đổi thành `collectionId`.

Tài khoản demo:

| Vai trò | Đăng nhập | Mật khẩu |
|---|---|---|
| Quản trị | `admin@soulprint.vn` | `Admin@123` |
| Nhân viên bán hàng | `ngoclan@soulprint.vn` | `Staff@123` |
| Bán hàng + Kho | `quochuy@soulprint.vn` | `Staff@123` |
| Kho (có quyền riêng) | `minhkhoa@soulprint.vn` | `Staff@123` |
| Member | `minhanh@example.com` / `0901234567` | `Member@123` |
| Member | `quocbao@example.com` / `0912345678` | `Member@123` |
