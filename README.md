# Soulprint - "The Blueprint of Your Heart"

Website thương mại điện tử B2C bán quà tặng cá nhân hóa cho nam giới yêu thích Thể thao, Anime và Game. Khách tìm quà theo 6 danh mục nhu cầu và 3 trục đam mê, cá nhân hóa sản phẩm bằng In/Khắc hoặc thiết kế sticker có xem trước, đặt hàng không cần tài khoản, thanh toán khi nhận hàng hoặc thanh toán online có đặt cọc, và nhận gợi ý quà từ mô hình Logistic Regression dựa trên thông tin của từng lần tặng.

Đồ án nhóm học phần **BIE5061 - Phát triển Web kinh doanh nâng cao**, Khoa Hệ thống thông tin, Trường Đại học Kinh tế - Luật, ĐHQG-HCM.

| | |
|---|---|
| Website | https://soulprint-shop.vercel.app |
| Trang quản trị | https://soulprint-shop.vercel.app/quan-tri |
| RESTful API | https://project-soulprint-ecomwebsite.onrender.com/api/health |

Máy chủ API chạy gói miễn phí của Render, tự ngủ khi không có truy cập: lần mở đầu tiên có thể mất khoảng 1 phút.

## Chức năng chính

**Phía khách hàng**

- Khám phá sản phẩm theo danh mục, trục đam mê, bộ sưu tập; tìm kiếm không dấu; bộ lọc theo tag, giá, độ tuổi, đánh giá.
- Tư vấn chọn quà: khảo sát người nhận, dịp, sở thích, ngân sách; mô hình gợi ý xếp hạng sản phẩm và combo.
- Cá nhân hóa: In/Khắc (chế độ Thường hoặc Áo đấu), thiết kế sticker kèm lời nhắn, gói quà theo mẫu hoặc tự chọn vật liệu.
- Giỏ hàng cho khách vãng lai và thành viên (tự gộp khi đăng nhập), voucher, đặt hàng COD hoặc thanh toán online qua cổng giả lập, đặt cọc cho hàng cá nhân hóa, đặt gấp.
- Theo dõi đơn, tra cứu đơn bằng mã xác minh, tự sửa thông tin giao hàng trước khi xác nhận, hủy đơn, nhận lại hàng, đổi trả, bảo hành, đánh giá.
- Tài khoản: đăng ký, đăng nhập bằng mật khẩu hoặc Google, quên mật khẩu bằng mã 6 số, sổ địa chỉ, tài khoản nhận tiền hoàn, kho voucher.
- Chat với chatbot "Sâu Béo" và nhân viên chăm sóc khách hàng.

**Phía quản trị**

- Bảng điều khiển việc cần làm theo mức ưu tiên, báo cáo doanh thu, sản phẩm, khách hàng, voucher.
- Quản lý sản phẩm, biến thể, tồn kho, danh mục, tag, bộ sưu tập, trang chủ, sticker, gói quà, voucher, chính sách.
- Xử lý đơn theo State Machine: xác nhận, cá nhân hóa, đóng gói, giao, ngoại lệ (sửa sản phẩm, đổi kiểu nhận, hoàn tiền, hủy), đơn nháp, đơn gấp, hàng lưu kho.
- Hậu mãi: hoàn tiền, đổi trả, bảo hành; chăm sóc khách hàng theo hội thoại, nhãn tự gắn, nhắc trả lời.
- Nhân viên, vai trò và 60 quyền chi tiết; ngoại lệ đặc biệt cần duyệt.

## Công nghệ

| Tầng | Công nghệ |
|---|---|
| Client | Angular 22 (NgModule, routing, lazy loading), Bootstrap 5.3 + SCSS, giao diện Sáng/Tối, responsive |
| Server | Node.js 22+ và Express 5 theo mô hình MVC, RESTful API tiền tố `/api` |
| Cơ sở dữ liệu | MongoDB Atlas, driver `mongodb` (MongoClient) |
| Xác thực | `express-session` + cookie HttpOnly, phiên lưu trong MongoDB (`connect-mongo`), mật khẩu băm bằng `crypto.scrypt` |
| Học máy | Logistic Regression viết bằng JavaScript thuần (`server/ml/`), huấn luyện offline, hệ số lưu ở `server/ml/model.json` |
| Triển khai | Vercel (client), Render (server), MongoDB Atlas |

## Cấu trúc thư mục

```
├── client/                   Ứng dụng Angular
│   ├── src/app/
│   │   ├── classes/          Kiểu dữ liệu, hàm thuần dùng chung
│   │   ├── services/         Gọi API, trạng thái phiên, giỏ hàng (Signal)
│   │   ├── features/         Các trang theo khu vực (home, product-list, checkout, account, admin...)
│   │   ├── guards/           Chặn route khi chưa đăng nhập hoặc thiếu quyền
│   │   ├── layout/           Header, footer
│   │   └── shared/           Component, pipe, directive dùng chung
│   ├── src/proxy.conf.json   Chuyển /api sang server khi chạy ở máy
│   └── vercel.json           Cấu hình deploy, chuyển tiếp /api sang Render
├── server/                   API Express
│   ├── index.js              Khởi tạo app, middleware, session, route
│   ├── config/               Kết nối MongoDB, tham số nghiệp vụ, danh mục quyền
│   ├── routes/               Khai báo endpoint
│   ├── controllers/          Nhận request, kiểm tra đầu vào, trả response
│   ├── services/             Nghiệp vụ (đơn hàng, thanh toán, gợi ý, chat...) và adapter dịch vụ ngoài
│   ├── middlewares/          Nạp phiên, kiểm tra quyền
│   ├── ml/                   Mô hình gợi ý: sinh dữ liệu, huấn luyện, đánh giá
│   ├── scripts/              Seed, dataset demo, nhập ảnh, migrations
│   ├── tests/                Unit test (node:test) và Postman collection
│   └── public/images/        Ảnh mẫu dùng khi seed
└── data/
    ├── seed/                 Dữ liệu mẫu JSON (danh mục, sản phẩm, voucher, tài khoản demo...)
    └── images/               Ảnh thật của sản phẩm, banner, danh mục, bộ sưu tập, gói quà, sticker
```

## Chạy ở máy

Yêu cầu: Node.js 22.22 trở lên, một cụm MongoDB Atlas (gói M0 miễn phí là đủ) hoặc MongoDB chạy ở máy.

**1. Cài đặt**

```bash
git clone <địa chỉ repo này>
cd soulprint-ecommerce
cd server && npm install
cd ../client && npm install
```

**2. Cấu hình server**

Chép `server/.env.example` thành `server/.env` rồi điền:

| Biến | Ý nghĩa |
|---|---|
| `MONGODB_URI` | Chuỗi kết nối Atlas (Atlas > Database > Connect > Drivers). Ở Network Access cho phép IP của máy |
| `MONGODB_DB` | Tên CSDL, mặc định `soulprint` |
| `SESSION_SECRET` | Chuỗi ngẫu nhiên dài, tạo bằng `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `CLIENT_ORIGIN` | `http://localhost:4200` |
| `DEMO_MODE` | `true` để mã OTP và liên kết kích hoạt hiện ngay trên màn hình (không gửi email thật) |
| `GOOGLE_*` | Tùy chọn, đăng nhập Google; bỏ trống thì nút Google báo tạm ngưng |

Nếu gặp lỗi `querySrv ECONNREFUSED` hoặc `ETIMEOUT` trên Windows, thêm `DNS_SERVERS=8.8.8.8,1.1.1.1` (hoặc DNS của mạng đang dùng).

**3. Nạp dữ liệu**

```bash
cd server
npm run seed            # dữ liệu mẫu gọn: 36 sản phẩm, tài khoản demo bên dưới
# hoặc
npm run seed:dataset    # dữ liệu 1,5 năm: 60 sản phẩm, khoảng 1.800 đơn, dùng cho báo cáo và mô hình gợi ý
```

Cả hai lệnh **xóa toàn bộ CSDL** trong `MONGODB_DB` rồi nạp lại, với ảnh giữ chỗ dạng SVG. Để dùng ảnh thật, chạy tiếp:

```bash
npm run seed:images     # nạp 173 ảnh trong data/images vào MongoDB (collection files), thay ảnh giữ chỗ
```

Seed lại thì chạy lại lệnh này.

**4. Chạy**

```bash
cd server && npm start      # API ở http://localhost:3000 (nodemon)
cd client && npm start      # Website ở http://localhost:4200
```

Khu quản trị: http://localhost:4200/quan-tri

## Tài khoản demo (sau `npm run seed`)

| Vai trò | Đăng nhập | Mật khẩu |
|---|---|---|
| Quản trị | `admin@soulprint.vn` | `Admin@123` |
| Nhân viên bán hàng | `ngoclan@soulprint.vn` | `Staff@123` |
| Bán hàng + Kho | `quochuy@soulprint.vn` | `Staff@123` |
| Kho (có quyền riêng) | `minhkhoa@soulprint.vn` | `Staff@123` |
| Khách thành viên | `minhanh@example.com` hoặc `0901234567` | `Member@123` |
| Khách thành viên | `quocbao@example.com` hoặc `0912345678` | `Member@123` |

Thanh toán online dùng cổng giả lập nội bộ: trang cổng có nút Thành công, Thất bại, Hủy để thử từng trường hợp.

## Kiểm thử

```bash
cd server && npm test                 # 225 unit test nghiệp vụ (tính tiền, trạng thái đơn, quyền, gợi ý...)
cd client && npm test                 # 76 unit test phía client
cd client && npm run build            # build production
```

Kiểm thử API bằng Postman: import `server/tests/postman/soulprint.postman_collection.json`, chạy server trên CSDL vừa `npm run seed`, rồi chạy cả collection (biến `baseUrl` mặc định `http://localhost:3000`). Bằng Postman CLI:

```bash
postman collection run server/tests/postman/soulprint.postman_collection.json
```

## Mô hình gợi ý quà

```bash
cd server
npm run train       # sinh dữ liệu giả lập, chia train/test 80/20, huấn luyện, ghi ml/model.json
npm run evaluate    # accuracy, precision, recall, F1 trên tập test; Precision@5 trên 30 kịch bản, so với cosine trên tag
```

Kết quả hiện tại: accuracy 0,8678, F1 0,7262; Precision@5 0,7733 so với 0,7000 của phương án cosine. Thiếu `model.json` thì hệ thống tự dùng phương án cosine.

## Triển khai

- **Server (Render)**: Web Service, Root Directory `server`, Build `npm install`, Start `npm run prod`; biến môi trường như `.env` với `NODE_ENV=production`, `CLIENT_ORIGIN` là địa chỉ Vercel.
- **Client (Vercel)**: Root Directory `client`, framework Angular; `vercel.json` chuyển tiếp `/api`, `/images`, `/data` sang Render nên trình duyệt chỉ làm việc với một tên miền và cookie phiên hoạt động như ở máy.
- **MongoDB Atlas**: Network Access cho phép `0.0.0.0/0` để Render kết nối được.

## Nhóm thực hiện

| Thành viên | Vai trò |
|---|---|
| Trần Ái Quyên | Trưởng nhóm, BA quản lý đơn hàng, UI quản trị, front-end |
| Nguyễn Như Quỳnh | Lead BA, back-end, mô hình gợi ý |
| Phan Ngọc Bảo Châu | BA và UI khu khách hàng, back-end |
| Huỳnh Phúc Huy | BA và UI khu khách hàng, front-end |
| Huỳnh Nhật Đăng | BA và UI khu quản trị, front-end |
