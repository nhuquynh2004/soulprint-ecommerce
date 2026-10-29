// Chuyển CSDL đang chạy: danh mục "Gấu ghiền" đổi tên thành "Mê mẩn" (đường dẫn me-man, mô tả mới),
// mã danh mục GGH đổi thành MMN, kéo theo SKU (TT-GGH-... thành TT-MMN-...) ở sản phẩm, biến thể và mọi chỗ đã chép SKU
// (đơn, giỏ, đơn nháp, nhật ký...), đường dẫn ảnh giữ chỗ /images/products/tt-ggh-... và tên, nguồn ảnh đã tải.
// Ảnh danh mục chỉ đổi khi vẫn là ảnh mặc định của seed (admin tự tải ảnh khác thì giữ).
// Chạy lại không đổi gì thêm.
//   node --env-file=.env scripts/migrations/2026-10-29-rename-category-me-man.js            xem trước
//   node --env-file=.env scripts/migrations/2026-10-29-rename-category-me-man.js --apply    ghi vào CSDL trong MONGODB_DB
const { client, database, dbName } = require("../../config/db")

const apply = process.argv.includes("--apply")
const SKIP = new Set(["sessions"])
const OLD = { slug: "gau-ghien", image: "/images/categories/gau-ghien.svg", code: "GGH" }
const NEW = {
  name: "Mê mẩn",
  slug: "me-man",
  description: "Những món anh ấy mê mẩn: mô hình, figure, dụng cụ thể thao, đồ chơi game",
  image: "/images/categories/me-man.svg",
  code: "MMN",
}

// SKU trong chuỗi bất kỳ (kể cả câu nhật ký), đường dẫn ảnh sản phẩm và ảnh danh mục
function convert(s) {
  return s
    .replace(/\b(TT|AN|GM)-GGH(?=-)/g, "$1-MMN")
    .replace(/\/images\/products\/(tt|an|gm)-ggh-/g, "/images/products/$1-mmn-")
    .replace(/\/images\/categories\/gau-ghien\b/g, "/images/categories/me-man")
}

// Tên file ảnh đã tải: an-ggh-004-1.jpg, gau-ghien.jpg
function convertFileName(s) {
  return s.replace(/^(tt|an|gm)-ggh-/, "$1-mmn-").replace(/^gau-ghien\./, "me-man.")
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
  const categories = database.collection("categories")

  // Danh mục: tên, đường dẫn, mô tả, mã
  const cur = await categories.findOne({ $or: [{ slug: OLD.slug }, { slug: NEW.slug }] })
  if (!cur) throw new Error(`Không có danh mục ${OLD.slug} hay ${NEW.slug}`)
  const set = {}
  for (const k of ["name", "slug", "description"]) if (cur[k] !== NEW[k] && cur.slug === OLD.slug) set[k] = NEW[k]
  if (cur.code !== NEW.code) {
    const dup = await categories.findOne({ code: NEW.code, _id: { $ne: cur._id } })
    if (dup) throw new Error(`Mã ${NEW.code} đã thuộc danh mục ${dup.name}`)
    set.code = NEW.code
  }
  if (set.slug) {
    const dup = await categories.findOne({ slug: NEW.slug, _id: { $ne: cur._id } })
    if (dup) throw new Error(`Đường dẫn ${NEW.slug} đã có danh mục khác (${dup.name})`)
  }
  if (!cur.image || cur.image === OLD.image) set.image = NEW.image
  report.push(Object.keys(set).length
    ? `Danh mục ${cur.name} (${cur.code}): đổi ${Object.entries(set).map(([k, v]) => `${k} = ${v}`).join("; ")}`
    : `Danh mục ${cur.name} (${cur.code}): không đổi`)
  if (apply && Object.keys(set).length) await categories.updateOne({ _id: cur._id }, { $set: { ...set, updatedAt: new Date() } })

  // SKU và đường dẫn ảnh ở mọi collection; files chỉ đổi tên và nguồn ảnh
  const names = (await database.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).filter((n) => !SKIP.has(n))
  const touched = {}
  for (const name of names) {
    const col = database.collection(name)
    const cursor = name === "files" ? col.find({}, { projection: { data: 0 } }) : col.find({})
    for await (const doc of cursor) {
      let update
      if (name === "files") {
        const fset = {}
        if (typeof doc.name === "string" && convertFileName(doc.name) !== doc.name) fset.name = convertFileName(doc.name)
        if (typeof doc.sourcePath === "string" && convert(doc.sourcePath) !== doc.sourcePath) fset.sourcePath = convert(doc.sourcePath)
        if (!Object.keys(fset).length) continue
        update = () => col.updateOne({ _id: doc._id }, { $set: fset })
      } else {
        if (name === "categories" && String(doc._id) === String(cur._id)) continue
        const next = mapStrings(doc, convert)
        if (next === doc) continue
        update = () => col.replaceOne({ _id: doc._id }, next)
      }
      touched[name] = (touched[name] || 0) + 1
      if (apply) await update()
    }
  }
  report.push("Document đổi SKU/ảnh: " + (Object.entries(touched).map(([k, n]) => `${k} ${n}`).join(", ") || "không có"))

  console.log(`CSDL ${dbName} | ${apply ? "ĐÃ GHI" : "XEM TRƯỚC (thêm --apply để ghi)"}`)
  console.log(report.join("\n"))
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => client.close())
