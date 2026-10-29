// Soulprint Restful API. Thứ tự khai báo theo slide Chương VI (6.7) và Chương VIII:
// morgan -> path, fs -> express.static -> cors -> body-parser -> cookie-parser -> express-session -> route -> listen.
const express = require("express")
const app = express()
const port = process.env.PORT || 3000
const isProduction = process.env.NODE_ENV === "production"

const morgan = require("morgan")
app.use(morgan("combined"))

const path = require("path")
const fs = require("fs")
// Thư mục ảnh mẫu (slide 6.7.1: http://localhost:3000/images/<tên tệp>). Tạo sẵn nếu chưa có.
fs.mkdirSync(path.join(__dirname, "public", "images"), { recursive: true })
app.use(express.static(path.join(__dirname, "public")))

const cors = require("cors")
// Khác slide (cors() mở cho mọi nơi): chỉ cho phép client Angular và cho gửi kèm cookie phiên (Chương VIII).
app.use(cors({ origin: process.env.CLIENT_ORIGIN || "http://localhost:4200", credentials: true }))

const bodyParser = require("body-parser")
// limit 50mb như slide vì ảnh gửi dạng base64 trong JSON.
app.use(bodyParser.json({ limit: "50mb" }))
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }))

const cookieParser = require("cookie-parser")
app.use(cookieParser())

const session = require("express-session")
const { MongoStore } = require("connect-mongo")
const { clientPromise, dbName } = require("./config/db")

if (isProduction && !process.env.SESSION_SECRET) {
  console.error("Thiếu SESSION_SECRET ở môi trường production.")
  process.exit(1)
}
// Render (và Vercel chuyển tiếp /api) đứng trước server: cần trust proxy để cookie Secure hoạt động.
if (isProduction) app.set("trust proxy", 1)

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000
app.use(
  session({
    name: "sid",
    secret: process.env.SESSION_SECRET || "dev-secret-chi-dung-o-may-ca-nhan",
    resave: false,
    saveUninitialized: false, // chỉ tạo phiên khi có dữ liệu (đăng nhập hoặc Guest thêm giỏ)
    // Khác slide (MemoryStore mặc định): lưu phiên trong MongoDB để không mất khi server khởi động lại
    // và để nhân viên xem, hủy phiên của mình.
    // stringify: false lưu phiên dạng object để truy vấn được theo session.userId (khóa tài khoản, đăng xuất thiết bị khác)
    store: MongoStore.create({ clientPromise, dbName, collectionName: "sessions", ttl: SEVEN_DAYS / 1000, touchAfter: 5 * 60, stringify: false }),
    cookie: { httpOnly: true, sameSite: "lax", secure: isProduction, maxAge: SEVEN_DAYS },
  })
)

app.get("/", (req, res) => {
  res.send("Soulprint Restful API")
})

// Đọc người dùng của phiên cho mọi API (kiểm tra lại trạng thái, quyền ở mỗi request - BR-34)
app.use("/api", require("./middlewares/auth").loadUser)
app.use("/api", require("./routes/health.routes"))
app.use("/api", require("./routes/catalog.routes"))
app.use("/api", require("./routes/auth.routes"))
app.use("/api", require("./routes/cart.routes"))
app.use("/api", require("./routes/order.routes"))
app.use("/api", require("./routes/chat.routes"))
app.use("/api", require("./routes/recommendation.routes"))
app.use("/api/admin", require("./routes/admin.routes"))

const { notFound, errorHandler } = require("./middlewares/errorHandler")
app.use(notFound)
app.use(errorHandler)

// Khác slide: chỉ mở cổng sau khi kết nối được MongoDB, vì mọi API và phiên đăng nhập đều cần CSDL.
clientPromise
  .then(() => {
    app.listen(port, () => {
      console.log(`Soulprint Server listening on port ${port}`)
    })
    require("./services/scheduler").startScheduler()
    require("./services/googleAuth").ensureUserIndexes().catch((err) => console.error("Đổi index users lỗi:", err.message))
  })
  .catch(() => process.exit(1))
