// Chuyển CSDL đang chạy (BR-18): sản phẩm chế độ Áo đấu nâng giới hạn lên dòng trên 20, dòng dưới 20,
// số áo 3 chữ số. Chỉ nâng giá trị đang thấp hơn mặc định mới, không hạ giới hạn Admin đã đặt cao hơn. Chạy lại không đổi gì thêm.
// Tắt 4 nhóm tag trên bộ lọc SCR-02 (Sở thích, Phong cách, Tính cách, Công dụng); tag vẫn giữ cho AI.
// Voucher xin lỗi QUATANG10 tự tạo khi dùng lần đầu nên không cần chuyển.
//   node --env-file=.env scripts/migrations/2026-10-26-jersey-limits-filters.js            xem trước
//   node --env-file=.env scripts/migrations/2026-10-26-jersey-limits-filters.js --apply    ghi vào CSDL trong MONGODB_DB
const { client, database, dbName } = require("../../config/db")
const params = require("../../config/params")

const apply = process.argv.includes("--apply")
const D = params.ENGRAVE_JERSEY_DEFAULTS
const HIDDEN_FILTER_GROUPS = ["SO_THICH", "PHONG_CACH", "TINH_CACH", "CONG_DUNG"]

async function main() {
  await client.connect()
  const products = database.collection("products")
  const list = await products.find({ "personalization.engrave.mode": "AO_DAU" }, { projection: { sku: 1, name: 1, "personalization.engrave": 1 } }).toArray()
  let changed = 0
  for (const p of list) {
    const e = p.personalization.engrave
    const next = {
      topMaxChars: Math.max(e.topMaxChars || 0, D.topMaxChars),
      bottomMaxChars: Math.max(e.bottomMaxChars || 0, D.bottomMaxChars),
      numberMaxDigits: Math.max(e.numberMaxDigits || 0, D.numberMaxDigits),
    }
    if (next.topMaxChars === e.topMaxChars && next.bottomMaxChars === e.bottomMaxChars && next.numberMaxDigits === e.numberMaxDigits) continue
    changed++
    console.log(`${p.sku} ${p.name}: ${e.topMaxChars}/${e.bottomMaxChars}/${e.numberMaxDigits} -> ${next.topMaxChars}/${next.bottomMaxChars}/${next.numberMaxDigits}`)
    if (apply) {
      await products.updateOne(
        { _id: p._id },
        { $set: { "personalization.engrave.topMaxChars": next.topMaxChars, "personalization.engrave.bottomMaxChars": next.bottomMaxChars, "personalization.engrave.numberMaxDigits": next.numberMaxDigits, updatedAt: new Date() } },
      )
    }
  }
  console.log(`${apply ? "Đã ghi" : "Xem trước"} CSDL ${dbName}: ${list.length} sản phẩm áo đấu, ${changed} sản phẩm ${apply ? "đã nâng" : "sẽ nâng"} giới hạn.`)

  const groups = database.collection("tagGroups")
  const shown = await groups.find({ code: { $in: HIDDEN_FILTER_GROUPS }, isFilter: true }, { projection: { code: 1, name: 1 } }).toArray()
  for (const g of shown) console.log(`Nhóm tag ${g.code} ${g.name}: tắt trên bộ lọc`)
  if (apply && shown.length) await groups.updateMany({ _id: { $in: shown.map((g) => g._id) } }, { $set: { isFilter: false, updatedAt: new Date() } })
  console.log(`${shown.length} nhóm tag ${apply ? "đã tắt" : "sẽ tắt"} trên bộ lọc.`)
  await client.close()
}

main().catch(async (err) => {
  console.error(err)
  await client.close()
  process.exit(1)
})
