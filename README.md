# Soulprint - "The Blueprint of Your Heart"

Soulprint là website thương mại điện tử B2C bán quà tặng cá nhân hóa cho nam giới thích thể thao, anime và game. Khách tìm quà theo 6 danh mục nhu cầu và 3 trục đam mê, in/khắc chữ hoặc chọn sticker lên sản phẩm và xem trước trước khi đặt. Khách đặt hàng được mà không cần tài khoản, trả tiền khi nhận hàng hoặc trả online (hàng cá nhân hóa phải đặt cọc). Mục Tư vấn quà dùng mô hình hồi quy Logistic để xếp hạng sản phẩm theo người nhận, dịp tặng, sở thích và ngân sách của từng lần tặng.

Đồ án nhóm 09, học phần Phát triển Web kinh doanh nâng cao (261BIE503102), giảng viên hướng dẫn TS. Trần Duy Thanh, Khoa Hệ thống thông tin, Trường Đại học Kinh tế - Luật, ĐHQG-HCM.

| Nội dung | Liên kết |
|---|---|
| Website | https://soulprint-shop.vercel.app |
| Trang nhân viên | https://soulprint-shop.vercel.app/quan-tri |
| RESTful API (kiểm tra trạng thái) | https://project-soulprint-ecomwebsite.onrender.com/api/health |
| Thiết kế giao diện (Figma) | https://www.figma.com/design/7wacD6Nn4VbIAjtzGFvKgX/Web2_UI |

Server chạy trên gói miễn phí của Render và tự tắt khi không có ai truy cập, nên lần mở đầu tiên có thể mất khoảng 1 phút.

## Chức năng chính

### Khách hàng

- Xem sản phẩm theo danh mục, trục đam mê, bộ sưu tập. Tìm kiếm gõ không dấu vẫn ra kết quả, lọc theo tag, giá, độ tuổi, đánh giá.
- Tư vấn quà: khách trả lời vài câu về người nhận, dịp, sở thích, ngân sách; hệ thống gợi ý sản phẩm và combo kèm lý do.
- Cá nhân hóa: In/Khắc (chế độ Thường hoặc Áo đấu), chọn 1 đến 3 sticker kèm lời nhắn, gói quà theo mẫu hoặc tự chọn vật liệu.
- Giỏ hàng dùng được khi chưa đăng nhập và tự gộp khi đăng nhập. Áp voucher, trả COD hoặc online qua cổng thanh toán giả lập, đặt cọc cho hàng cá nhân hóa, đặt gấp.
- Theo dõi đơn, tra cứu đơn bằng mã xác minh, sửa thông tin giao hàng khi đơn chưa được xác nhận, hủy đơn, nhận lại hàng, đổi trả, bảo hành, đánh giá.
- Tài khoản: đăng ký, đăng nhập bằng mật khẩu hoặc Google, lấy lại mật khẩu bằng mã 6 số, sổ địa chỉ, tài khoản nhận tiền hoàn, kho voucher.
- Chat với chatbot "Sâu Béo" hoặc với nhân viên chăm sóc khách hàng.

### Nhân viên

- Bảng việc cần làm xếp theo mức ưu tiên; báo cáo doanh thu, sản phẩm, khách hàng, voucher.
- Quản lý sản phẩm, biến thể, tồn kho, danh mục, tag, bộ sưu tập, trang chủ, sticker, gói quà, voucher, chính sách.
- Xử lý đơn theo State Machine: xác nhận, cá nhân hóa, đóng gói, giao hàng. Ngoại lệ gồm sửa sản phẩm, đổi kiểu nhận, hoàn tiền, hủy; có thêm đơn nháp, đơn gấp, hàng lưu kho.
- Hậu mãi (hoàn tiền, đổi trả, bảo hành) và chăm sóc khách hàng theo hội thoại, có nhãn tự gắn và nhắc trả lời.
- Quản lý nhân viên, vai trò và 60 quyền chi tiết. Ngoại lệ ảnh hưởng đến tiền cần quyền đặc biệt; nhân viên không có quyền thì gửi Quản trị duyệt.

## Công nghệ

| Tầng | Công nghệ |
|---|---|
| Client | Angular 22 (NgModule, routing, lazy loading), Bootstrap 5.3 + SCSS, giao diện Sáng/Tối, responsive |
| Server | Node.js và Express 5 theo mô hình MVC, RESTful API tiền tố `/api` |
| Cơ sở dữ liệu | MongoDB Atlas, driver `mongodb` (MongoClient) |
| Xác thực | `express-session` + cookie HttpOnly, phiên lưu trong MongoDB (`connect-mongo`), mật khẩu băm bằng `crypto.scrypt` |
| Học máy | Hồi quy Logistic viết bằng JavaScript thuần (`server/ml/`), huấn luyện offline, hệ số lưu ở `server/ml/model.json` |
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
│   ├── utils/                Băm mật khẩu, kiểm tra dữ liệu, xử lý chữ tiếng Việt
│   ├── ml/                   Mô hình gợi ý: sinh dữ liệu, huấn luyện, đánh giá
│   ├── scripts/              Seed, dataset demo, nhập ảnh, migrations
│   ├── tests/                Unit test (node:test) và Postman collection
│   └── public/               Ảnh giữ chỗ SVG, dữ liệu địa giới hành chính
└── data/
    ├── seed/                 Dữ liệu mẫu JSON (danh mục, sản phẩm, voucher, tài khoản demo...)
    └── images/               Ảnh thật của sản phẩm, banner, danh mục, bộ sưu tập, gói quà, sticker
```

## Chạy ở máy

Cần Node.js 22.22.3 trở lên và một cụm MongoDB Atlas (gói M0 miễn phí là đủ) hoặc MongoDB cài trên máy.

### 1. Cài đặt

```bash
git clone https://github.com/nhuquynh2004/soulprint-ecommerce.git
cd soulprint-ecommerce
cd server && npm install
cd ../client && npm install
```

### 2. Cấu hình server

Chép `server/.env.example` thành `server/.env` rồi điền các biến sau:

| Biến | Ý nghĩa |
|---|---|
| `MONGODB_URI` | Chuỗi kết nối Atlas (Atlas > Database > Connect > Drivers). Ở Network Access, cho phép IP của máy |
| `MONGODB_DB` | Tên CSDL, mặc định `soulprint` |
| `SESSION_SECRET` | Chuỗi ngẫu nhiên dài, tạo bằng `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `CLIENT_ORIGIN` | `http://localhost:4200` |
| `DEMO_MODE` | `true` thì mã OTP và liên kết kích hoạt hiện ngay trên màn hình, không gửi email thật |
| `GOOGLE_*` | Không bắt buộc, dùng cho đăng nhập Google. Để trống thì nút Google báo tạm ngưng |

Trên Windows, nếu gặp lỗi `querySrv ECONNREFUSED` hoặc `ETIMEOUT`, thêm `DNS_SERVERS=8.8.8.8,1.1.1.1` (hoặc DNS của mạng đang dùng).

### 3. Nạp dữ liệu

Chọn một trong hai cách bên dưới.

**Cách 1 - Khôi phục từ dump (khuyên dùng để chấm thi).** Thư mục `data/dump` chứa dump BSON gzip của CSDL `soulprint` ở bản deploy (26 MB, kèm ảnh thật, 1.878 đơn, 3.122 phiên AI). Cần `mongorestore` trong bộ MongoDB Database Tools (https://www.mongodb.com/try/download/database-tools), rồi:

```bash
mongorestore --uri="$MONGODB_URI" --nsInclude="soulprint.*" --gzip --drop data/dump
```

Xem `data/dump/README.md` để có hướng dẫn chi tiết, kể cả khi đổi tên CSDL.

**Cách 2 - Sinh lại từ script.**

```bash
cd server
npm run seed            # dữ liệu mẫu gọn: 36 sản phẩm và các tài khoản demo bên dưới
# hoặc
npm run seed:dataset    # dữ liệu 1,5 năm (04/2025 - 10/2026): 60 sản phẩm, 1.815 đơn, dùng cho báo cáo và mô hình gợi ý
```

Cả hai lệnh đều **xóa toàn bộ CSDL** `MONGODB_DB` rồi nạp lại, sản phẩm dùng ảnh giữ chỗ SVG. Muốn có ảnh thật thì chạy thêm:

```bash
npm run seed:images     # nạp 173 ảnh trong data/images vào MongoDB (collection files), thay ảnh giữ chỗ
```

Mỗi lần seed lại phải chạy lại lệnh này.

### 4. Chạy

```bash
cd server && npm start      # API ở http://localhost:3000 (nodemon)
cd client && npm start      # Website ở http://localhost:4200
```

Trang nhân viên ở http://localhost:4200/quan-tri.

## Tài khoản demo (sau `npm run seed`)

| Vai trò | Đăng nhập | Mật khẩu |
|---|---|---|
| Quản trị | `admin@soulprint.vn` | `Admin@123` |
| Bán hàng | `ngoclan@soulprint.vn` | `Staff@123` |
| Bán hàng + Kho | `quochuy@soulprint.vn` | `Staff@123` |
| Kho, có cấp thêm quyền riêng | `minhkhoa@soulprint.vn` | `Staff@123` |
| Khách thành viên | `minhanh@example.com` hoặc `0901234567` | `Member@123` |
| Khách thành viên | `quocbao@example.com` hoặc `0912345678` | `Member@123` |

Thanh toán online đi qua cổng giả lập nội bộ. Trang cổng có ba nút Thành công, Thất bại, Hủy để thử từng trường hợp.

## Kiểm thử

```bash
cd server && npm test                 # 225 unit test nghiệp vụ (tính tiền, trạng thái đơn, quyền, gợi ý...)
cd client && npm test                 # 76 unit test phía client
cd client && npm run build            # build production
```

Kiểm thử API bằng Postman: seed lại CSDL bằng `npm run seed`, chạy server, import `server/tests/postman/soulprint.postman_collection.json` rồi chạy cả collection. Biến `baseUrl` mặc định là `http://localhost:3000`. Nếu dùng Postman CLI:

```bash
postman collection run server/tests/postman/soulprint.postman_collection.json
```

## Mô hình gợi ý quà

```bash
cd server
npm run train       # sinh dữ liệu giả lập, chia train/test 80/20, huấn luyện, ghi ml/model.json
npm run evaluate    # accuracy, precision, recall, F1 trên tập test; Precision@5 trên 30 kịch bản, so với cosine trên tag
```

Trên tập test, mô hình đạt accuracy 0,8678 và F1 0,7262. Precision@5 là 0,7733, cao hơn 0,7000 của cách so khớp cosine trên tag. Nếu không có `model.json`, hệ thống dùng cosine để gợi ý.

## Triển khai

Server deploy lên Render dạng Web Service: Root Directory `server`, Build `npm install`, Start `npm run prod`. Biến môi trường giống `.env`, thêm `NODE_ENV=production`, còn `CLIENT_ORIGIN` là địa chỉ Vercel.

Client deploy lên Vercel: Root Directory `client`, framework Angular. `vercel.json` chuyển tiếp `/api`, `/images`, `/data` sang Render, nên trình duyệt chỉ làm việc với một tên miền và cookie phiên chạy giống như ở máy.

Ở MongoDB Atlas, mục Network Access cần cho phép `0.0.0.0/0` để Render kết nối được.

## Nhóm thực hiện

| Thành viên | Công việc chính |
|---|---|
| Trần Ái Quyên | Trưởng nhóm (Product Owner, Scrum Master); BA, UI, kiểm thử mảng Bán hàng; thiết kế hệ thống giao diện; front-end khu quản trị |
| Nguyễn Như Quỳnh | BA chính, điều phối kiểm thử; BA, UI, kiểm thử mảng Đơn hàng và Xử lý ngoại lệ; front-end khu khách hàng; triển khai |
| Phan Ngọc Bảo Châu | Điều phối back-end: thiết kế dữ liệu, API, lập trình server, bộ Postman; BA, UI, kiểm thử mảng Mua hàng; triển khai |
| Huỳnh Phúc Huy | Điều phối mô hình gợi ý; BA, UI, kiểm thử mảng Trải nghiệm khách hàng; front-end khu khách hàng |
| Huỳnh Nhật Đăng | Điều phối front-end: khung Angular, cách gọi API dùng chung; BA, UI, kiểm thử mảng Quản trị còn lại; front-end khu quản trị |
