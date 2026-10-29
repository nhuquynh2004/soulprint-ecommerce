// Chuyển CSDL đang chạy sang SKU mới (BR-46) theo bảng scripts/migrations/data/sku-map.json:
// - thêm mã cho danh mục và BST chọn tay (theo slug), tạo index mã;
// - đổi SKU sản phẩm, SKU biến thể (SKU cũ + "-..."), SKU đã chép trong đơn, giỏ, đơn nháp, nhật ký...;
// - đổi đường dẫn ảnh giữ chỗ /images/products/<sku cũ>... sang tên mới (file ảnh đã đổi tên trong repo).
// Chỉ thay chuỗi khớp nguyên SKU hoặc nguyên đường dẫn ảnh, không sửa câu chữ tự do. Chạy lại không đổi gì thêm.
//   node --env-file=.env scripts/migrations/2026-10-24-sku-codes.js            xem trước
//   node --env-file=.env scripts/migrations/2026-10-24-sku-codes.js --apply    ghi vào CSDL trong MONGODB_DB
const { client, database } = require("../../config/db")
const MAP = require("./data/sku-map.json")

const apply = process.argv.includes("--apply")
const SKIP = new Set(["sessions"])
const OLD = Object.keys(MAP.products)
const skuRe = new RegExp(`^(${OLD.join("|")})(-[A-Z0-9-]+)?$`)
const imgRe = new RegExp(`^/images/products/(${OLD.map((s) => s.toLowerCase()).join("|")})([-.][^/]*)$`)

function convert(s) {
  let m = skuRe.exec(s)
  if (m) return MAP.products[m[1]] + (m[2] || "")
  m = imgRe.exec(s)
  if (m) return `/images/products/${MAP.products[m[1].toUpperCase()].toLowerCase()}${m[2]}`
  return s
}

// Đi qua mọi giá trị của document; trả về document mới nếu có chuỗi đổi
function mapStrings(value, fn) {
  if (typeof value === "string") return fn(value)
  if (Array.isArray(value)) {
    let changed = false
    const out = value.map((v) => { const n = mapStrings(v, fn); if (n !== v) changed = true; return n })
    return changed ? out : value
  }
  if (value && typeof value === "object" && value.constructor === Object) {
    let changed = false
    const out = {}
    for (const [k, v] of Object.entries(value)) { const n = mapStrings(v, fn); if (n !== v) changed = true; out[k] = n }
    return changed ? out : value
  }
  return value
}

async function main() {
  await client.connect()
  const report = []

  // Mã danh mục, mã BST
  for (const [name, codes, extra] of [["categories", MAP.categoryCodes, {}], ["collections", MAP.collectionCodes, { type: "THU_CONG" }]]) {
    let n = 0
    for (const [slug, code] of Object.entries(codes)) {
      const doc = await database.collection(name).findOne({ slug, ...extra })
      if (!doc || doc.code === code) continue
      const taken = await database.collection(name).findOne({ code, _id: { $ne: doc._id } })
      if (taken) { report.push(`BỎ QUA ${name} ${slug}: mã ${code} đã thuộc ${taken.slug}`); continue }
      n++
      if (apply) await database.collection(name).updateOne({ _id: doc._id }, { $set: { code } })
    }
    report.push(`${name}: thêm mã ${n}`)
  }

  // SKU và đường dẫn ảnh ở mọi collection (files chỉ có sourcePath của ảnh nhập bằng import-images.js)
  const names = (await database.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).filter((n) => !SKIP.has(n))
  const touched = {}
  for (const name of names) {
    const col = database.collection(name)
    const cursor = name === "files" ? col.find({ sourcePath: { $exists: true } }, { projection: { data: 0 } }) : col.find({})
    for await (const doc of cursor) {
      const next = name === "files"
        ? (() => { const p = doc.sourcePath; const c = convert(p + ".svg"); return c !== p + ".svg" ? { ...doc, sourcePath: c.slice(0, -4) } : doc })()
        : mapStrings(doc, convert)
      if (next === doc) continue
      touched[name] = (touched[name] || 0) + 1
      if (!apply) continue
      if (name === "files") await col.updateOne({ _id: doc._id }, { $set: { sourcePath: next.sourcePath } })
      else await col.replaceOne({ _id: doc._id }, next)
    }
  }
  report.push("Document đổi SKU/ảnh: " + (Object.entries(touched).map(([k, n]) => `${k} ${n}`).join(", ") || "không có"))

  // Sản phẩm còn SKU không theo quy tắc (VD nhân viên tự tạo), chỉ báo
  const odd = await database.collection("products").find({ sku: { $not: /^(TT|AN|GM)-[A-Z0-9]{2,6}(-[A-Z0-9]{2,6})?-[0-9]{3,}$/ } }, { projection: { sku: 1, name: 1 } }).toArray()
  report.push(`Sản phẩm có SKU khác quy tắc (giữ nguyên): ${odd.length}${odd.length ? " - " + odd.slice(0, 10).map((p) => `${p.sku || "(trống)"} ${p.name}`).join("; ") : ""}`)

  if (apply) {
    await database.collection("categories").createIndex({ code: 1 }, { unique: true, sparse: true })
    await database.collection("collections").createIndex({ code: 1 }, { unique: true, partialFilterExpression: { code: { $type: "string" } } })
    report.push("Đã tạo index mã danh mục, mã BST")
  }

  console.log(`CSDL: ${database.databaseName} | ${apply ? "ĐÃ GHI" : "XEM TRƯỚC (thêm --apply để ghi)"}`)
  console.log(report.join("\n"))
  await client.close()
}

main().catch(async (err) => {
  console.error(err)
  await client.close()
  process.exit(1)
})
