// Chuyển CSDL đang chạy:
// (1) BR-18: sản phẩm In/Khắc chế độ Thường có giới hạn dưới 20 ký tự nâng lên ENGRAVE_MAX_CHARS (20); không hạ giới hạn cao hơn.
// (2) 6 trang chính sách viết lại theo quy tắc đã chốt: chép nội dung từ data/seed/policies.json theo slug.
// Chạy lại không đổi gì thêm.
//   node --env-file=.env scripts/migrations/2026-10-28-engrave-limit-policies.js            xem trước
//   node --env-file=.env scripts/migrations/2026-10-28-engrave-limit-policies.js --apply    ghi vào CSDL trong MONGODB_DB
const path = require("path")
const { client, database, dbName } = require("../../config/db")
const params = require("../../config/params")

const apply = process.argv.includes("--apply")
const MAX = params.ENGRAVE_MAX_CHARS

async function main() {
  await client.connect()
  const now = new Date()

  const products = database.collection("products")
  const low = await products
    .find({ "personalization.engrave.mode": "THUONG", "personalization.engrave.maxChars": { $lt: MAX } }, { projection: { sku: 1, name: 1, "personalization.engrave.maxChars": 1 } })
    .toArray()
  for (const p of low) console.log(`${p.sku} ${p.name}: ${p.personalization.engrave.maxChars} -> ${MAX} ký tự`)
  if (apply && low.length) {
    await products.updateMany({ _id: { $in: low.map((p) => p._id) } }, { $set: { "personalization.engrave.maxChars": MAX, updatedAt: now } })
  }
  console.log(`${apply ? "Đã ghi" : "Xem trước"} CSDL ${dbName}: ${low.length} sản phẩm ${apply ? "đã nâng" : "sẽ nâng"} giới hạn In/Khắc lên ${MAX} ký tự.`)

  const seed = require(path.join(__dirname, "../../../data/seed/policies.json"))
  const policies = database.collection("policies")
  let changed = 0
  for (const s of seed) {
    const cur = await policies.findOne({ slug: s.slug }, { projection: { content: 1 } })
    if (cur && cur.content === s.content) continue
    changed++
    console.log(`Chính sách ${s.slug}: ${cur ? "cập nhật nội dung" : "thêm mới"}`)
    if (apply) await policies.updateOne({ slug: s.slug }, { $set: { title: s.title, content: s.content, updatedAt: now }, $setOnInsert: { createdAt: now } }, { upsert: true })
  }
  console.log(`${apply ? "Đã ghi" : "Xem trước"}: ${changed} trang chính sách ${apply ? "đã cập nhật" : "sẽ cập nhật"}.`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => client.close())
