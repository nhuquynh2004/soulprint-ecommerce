// Nhập ảnh thật của nhóm vào MongoDB (collection files, cùng cách API-70) và thay ảnh giữ chỗ /images/...
// bằng /api/files/<id> ở mọi nơi trong CSDL (sản phẩm, biến thể, danh mục, banner, bộ sưu tập, gói quà, sticker,
// ảnh chép trong đơn hàng, giỏ, đơn nháp, bố cục trang chủ).
//
// Thư mục ảnh chia giống server/public/images (products/, banners/, ...), tên tệp giữ đúng tên ảnh giữ chỗ, chỉ đổi đuôi:
// products/tt-dnc-snbd-001-1.svg -> products/tt-dnc-snbd-001-1.jpg. Nhận JPG, PNG, WebP, tối đa MAX_IMAGE_MB.
//
// Mặc định chỉ xem trước (không ghi gì). Ghi thật thêm --apply:
//   node --env-file=.env scripts/import-images.js "D:/Anh Soulprint"            xem trước
//   node --env-file=.env scripts/import-images.js "D:/Anh Soulprint" --apply    ghi vào CSDL trong MONGODB_DB
// Chạy lại được: ảnh không đổi thì giữ nguyên; ảnh sửa lại (khác nội dung) thì thay bản cũ ở mọi nơi rồi xóa bản cũ.
// Seed lại CSDL thì chạy lại script.
const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const { client, database } = require("../config/db")
const params = require("../config/params")

const EXT = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" }
const MAGIC = {
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (b) => b.slice(0, 4).toString() === "RIFF" && b.slice(8, 12).toString() === "WEBP",
}
const SKIP = new Set(["files", "sessions"]) // files chứa base64, sessions do connect-mongo quản lý
const MB = 1024 * 1024

const dir = process.argv[2]
const apply = process.argv.includes("--apply")
if (!dir || !fs.existsSync(dir)) {
  console.error('Cách dùng: node --env-file=.env scripts/import-images.js "<thư mục ảnh>" [--apply]')
  process.exit(1)
}

// Đọc thư mục ảnh: "/images/products/tt-dnc-snbd-001-1" (không đuôi) -> tệp
function readImages(root) {
  const found = new Map()
  const problems = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) { walk(full); continue }
      const rel = path.relative(root, full).split(path.sep).join("/")
      const ext = path.extname(e.name).toLowerCase()
      const mimeType = EXT[ext]
      if (!mimeType) { if (!e.name.startsWith(".") && e.name !== "desktop.ini") problems.push(`${rel}: không phải JPG, PNG, WebP`); continue }
      const buffer = fs.readFileSync(full)
      if (buffer.length > params.MAX_IMAGE_MB * MB) { problems.push(`${rel}: ${(buffer.length / MB).toFixed(1)}MB, quá ${params.MAX_IMAGE_MB}MB`); continue }
      if (!MAGIC[mimeType](buffer)) { problems.push(`${rel}: nội dung không khớp đuôi ${ext}`); continue }
      const key = "/images/" + rel.slice(0, -ext.length)
      if (found.has(key)) { problems.push(`${rel}: trùng tên với ${found.get(key).rel}`); continue }
      found.set(key, { rel, mimeType, buffer, sha256: crypto.createHash("sha256").update(buffer).digest("hex") })
    }
  }
  walk(root)
  return { found, problems }
}

// Đi qua mọi giá trị của document, gọi fn với từng chuỗi; trả về document mới nếu có thay đổi
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
  const { found, problems } = readImages(dir)
  await client.connect()
  const collections = (await database.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).filter((n) => !SKIP.has(n))

  // Ảnh giữ chỗ đang dùng trong CSDL: "/images/products/tt-dnc-snbd-001-1.svg" -> key không đuôi
  const used = new Map() // đường dẫn đang dùng -> key
  const stripExt = (p) => p.replace(/\.(svg|png|jpe?g|webp)$/i, "")
  for (const name of collections) {
    for await (const doc of database.collection(name).find({})) {
      mapStrings(doc, (s) => { if (/^\/images\/[\w/.-]+\.(svg|png|jpe?g|webp)$/i.test(s)) used.set(s, stripExt(s)); return s })
    }
  }
  // Ảnh đã nhập ở lần chạy trước: /api/files/<id> -> key, để thay khi ảnh được sửa lại
  const imported = await database.collection("files").find({ sourcePath: { $exists: true } }, { projection: { sourcePath: 1, sha256: 1 } }).toArray()
  const latest = new Map() // key -> { id, sha256 }
  for (const f of imported) {
    used.set(`/api/files/${f._id}`, f.sourcePath)
    latest.set(f.sourcePath, { id: f._id, sha256: f.sha256 })
  }

  const neededKeys = new Set([...used.values()])
  const unknown = [...found.keys()].filter((k) => !neededKeys.has(k))
  const missing = [...new Set([...used.entries()].filter(([p]) => p.startsWith("/images/")).map(([, k]) => k))].filter((k) => !found.has(k)).sort()

  // Nhập ảnh: giống bản đã nhập thì dùng lại, khác thì thêm bản mới
  const urlOf = new Map() // key -> /api/files/<id>
  let added = 0
  let same = 0
  const superseded = [] // bản cũ của ảnh vừa sửa, xóa sau khi mọi nơi đã trỏ sang bản mới
  for (const [key, img] of found) {
    if (!neededKeys.has(key)) continue
    const prev = latest.get(key)
    if (prev && prev.sha256 === img.sha256) { urlOf.set(key, `/api/files/${prev.id}`); same++; continue }
    added++
    if (prev) superseded.push(prev.id)
    if (!apply) { urlOf.set(key, "/api/files/(mới)"); continue }
    const r = await database.collection("files").insertOne({
      mimeType: img.mimeType, data: img.buffer.toString("base64"), size: img.buffer.length, name: path.basename(img.rel),
      visibility: "CONG_KHAI", ownerType: null, ownerId: null, uploadedBy: null, createdAt: new Date(),
      sourcePath: key, sha256: img.sha256, // chỉ có ở ảnh nhập bằng script này
    })
    urlOf.set(key, `/api/files/${r.insertedId}`)
  }

  // Thay đường dẫn ở mọi collection
  const replaceFor = (s) => { const key = used.get(s); const url = key && urlOf.get(key); return url && url !== s ? url : s }
  const touched = {}
  for (const name of collections) {
    const col = database.collection(name)
    for await (const doc of col.find({})) {
      const next = mapStrings(doc, replaceFor)
      if (next === doc) continue
      touched[name] = (touched[name] || 0) + 1
      if (apply) await col.replaceOne({ _id: doc._id }, next)
    }
  }

  if (apply && superseded.length) await database.collection("files").deleteMany({ _id: { $in: superseded } })

  console.log(`CSDL: ${database.databaseName} | ${apply ? "ĐÃ GHI" : "XEM TRƯỚC (thêm --apply để ghi)"}`)
  console.log(`Ảnh trong thư mục: ${found.size} | nhập mới hoặc thay: ${added} (xóa ${superseded.length} bản cũ) | giữ nguyên: ${same}`)
  console.log(`Document được đổi đường dẫn: ${Object.entries(touched).map(([k, n]) => `${k} ${n}`).join(", ") || "không có"}`)
  if (problems.length) console.log(`\nTệp bị bỏ qua (${problems.length}):\n  ` + problems.join("\n  "))
  if (unknown.length) console.log(`\nTên tệp không khớp ảnh nào trong CSDL (${unknown.length}), kiểm tra lại tên:\n  ` + unknown.map((k) => k.slice(8)).join("\n  "))
  console.log(`\nẢnh giữ chỗ còn thiếu ảnh thật: ${missing.length}`)
  if (missing.length && missing.length <= 200) console.log("  " + missing.map((k) => k.slice(8)).join("\n  "))
  await client.close()
}

main().catch(async (err) => {
  console.error(err)
  await client.close()
  process.exit(1)
})
