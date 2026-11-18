# Dump CSDL MongoDB

Thư mục này chứa bản sao đầy đủ CSDL `soulprint` xuất bằng `mongodump` (BSON nén gzip), để chấm thi có thể khôi phục toàn bộ dữ liệu demo (sản phẩm, đơn hàng, ảnh, tài khoản, hội thoại chat, phiên AI, mô hình gợi ý) mà không cần chạy các lệnh `npm run seed`.

- Thời điểm xuất: 18/11/2026
- Nguồn: MongoDB Atlas, cụm `cluster0.sin5bta.mongodb.net`, CSDL `soulprint` (ở chế độ production)
- Loại trừ: collection `sessions` (cookie phiên đăng nhập hiện tại, không có ý nghĩa với bản sao)
- Dung lượng: khoảng 26 MB, 39 collection, ảnh sản phẩm nằm trong `files.bson.gz`

## Khôi phục

Cần công cụ `mongorestore` trong bộ MongoDB Database Tools. Tải ở https://www.mongodb.com/try/download/database-tools.

### Khôi phục vào MongoDB cài trên máy

```bash
mongorestore --uri="mongodb://localhost:27017" \
             --nsInclude="soulprint.*" \
             --gzip \
             --drop \
             data/dump
```

### Khôi phục vào MongoDB Atlas

```bash
mongorestore --uri="mongodb+srv://<user>:<pass>@<cluster>/?appName=<appName>" \
             --nsInclude="soulprint.*" \
             --gzip \
             --drop \
             data/dump
```

Nếu muốn khôi phục sang tên CSDL khác (ví dụ `soulprint_restore`), thêm `--nsFrom="soulprint.*" --nsTo="soulprint_restore.*"` và sửa biến `MONGODB_DB` trong `server/.env` cho đồng bộ.

Cờ `--drop` xóa collection đích trước khi nạp lại, tránh dữ liệu cũ lẫn lộn. Bỏ cờ này nếu muốn gộp dữ liệu.

## Thay thế cho lệnh seed

Khôi phục từ dump và chạy `npm run seed` là hai cách độc lập để có CSDL demo. Chọn một trong hai:

| Cách | Khi nào dùng |
|---|---|
| `mongorestore` từ thư mục này | Muốn dữ liệu đầy đủ sát với bản deploy (ảnh thật, 1878 đơn hàng, 3122 phiên AI, báo cáo đầy đủ) |
| `npm run seed` hoặc `npm run seed:dataset` | Muốn tự sinh lại dữ liệu từ JSON và script |

Sau khi khôi phục, chạy `cd server && npm start` là dùng được.

## Danh sách collection trong dump

adminLogs, aiGaps, aiSessions, approvalRequests, carts, categories, collections, conversations, counters, designs, draftOrders, faqs, files, giftWrapMaterials, giftWrapTemplates, homeBanners, messages, notifications, orders, otps, payments, policies, productDailyStats, products, refunds, returnRequests, reviews, roles, siteSettings, staffMentions, stickerSets, stockMovements, tagGroups, tags, tokens, userVouchers, users, vouchers, warrantyRequests.
