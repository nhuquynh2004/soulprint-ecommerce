// Kết nối MongoDB theo mẫu slide Chương VII: MongoClient -> client.db(...) -> database.collection(...)
// Khác slide: chuỗi kết nối lấy từ biến môi trường MONGODB_URI (Atlas) thay vì viết cứng localhost,
// để không lộ mật khẩu trong code.
const dns = require("dns")
const { MongoClient, ObjectId } = require("mongodb")

// Một số máy Windows: Node đọc sai DNS (127.0.0.1) nên không tra được bản ghi SRV của mongodb+srv://.
// Khi đó đặt DNS_SERVERS=8.8.8.8,1.1.1.1 trong .env để Node dùng DNS chỉ định.
if (process.env.DNS_SERVERS) {
  dns.setServers(process.env.DNS_SERVERS.split(",").map((s) => s.trim()))
}

const uri = process.env.MONGODB_URI
const dbName = process.env.MONGODB_DB || "soulprint"

if (!uri) {
  console.error("Thiếu MONGODB_URI. Chép server/.env.example thành server/.env rồi điền chuỗi kết nối Atlas.")
  process.exit(1)
}

const client = new MongoClient(uri)

// Một kết nối dùng chung cho cả ứng dụng và connect-mongo (lưu phiên).
const clientPromise = client.connect()
clientPromise.catch((err) => {
  console.error("Không kết nối được MongoDB:", err.message)
  console.error("Kiểm tra MONGODB_URI và Network Access của Atlas (cho phép IP của máy này hoặc 0.0.0.0/0).")
})

const database = client.db(dbName)

module.exports = { client, clientPromise, database, dbName, ObjectId }
