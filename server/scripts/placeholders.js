// Tạo ảnh giữ chỗ SVG cho mọi đường dẫn /images/... trong data/seed (node scripts/placeholders.js).
// Ảnh có tên món hàng, màu theo trục đam mê và biểu tượng của bộ thiết kế. Khi có ảnh thật:
// chép ảnh vào server/public/images/ rồi đổi đường dẫn trong data/seed, không phải sửa code.
// Tệp ảnh đã tồn tại sẽ không bị ghi đè (để không xóa ảnh thật).
const fs = require("fs")
const path = require("path")

const ROOT = path.join(__dirname, "..", "..")
const SEED = path.join(ROOT, "data", "seed")
const OUT = path.join(__dirname, "..", "public")
const ICONS = path.join(ROOT, "client", "public", "assets", "icons")
// Gồm cả catalog bổ sung của dataset 1,5 năm (scripts/dataset/catalog-extra.js)
const extra = require("./dataset/catalog-extra")
const read = (f) => [...JSON.parse(fs.readFileSync(path.join(SEED, f + ".json"), "utf8")), ...(extra[f] || [])]

// Màu nền theo trục (giá trị dải gốc của design-tokens.md, chỉ dùng trong ảnh)
const TONES = {
  THE_THAO: ["#D0FBED", "#72F3C8", "#085E41"],
  ANIME: ["#DCCFFC", "#976EF7", "#310891"],
  GAME: ["#D5E0F6", "#80A3E5", "#112955"],
  DEFAULT: ["#F0F7D4", "#D2E77E", "#485610"],
}
const AXIS_ICON = { THE_THAO: "ball", ANIME: "shuriken", GAME: "gamepad" }

const jobs = new Map() // đường dẫn -> { label, axis, icon, w, h }
function add(p, label, opts = {}) {
  if (typeof p === "string" && p.startsWith("/images/") && !jobs.has(p)) jobs.set(p, { label, w: 800, h: 800, ...opts })
}

for (const p of read("products")) {
  const icon = AXIS_ICON[p.axis]
  ;(p.images || []).forEach((img, i) => add(img, p.name, { axis: p.axis, icon, sub: i ? `Ảnh ${i + 1}` : "" }))
  for (const g of p.optionGroups || [])
    for (const v of g.values || []) (v.images || []).forEach((img) => add(img, p.name, { axis: p.axis, icon, sub: v.value }))
}
for (const c of read("categories")) add(c.image, c.name, { icon: "gift" })
for (const c of read("collections")) add(c.coverImage, c.name, { icon: "layers", w: 1200, h: 600 })
for (const b of read("homeBanners")) {
  add(b.imageDesktop, b.title, { icon: "sparkle", w: 1440, h: 560 })
  add(b.imageMobile, b.title, { icon: "sparkle", w: 750, h: 750 })
}
for (const t of read("giftWrapTemplates")) add(t.image, t.name, { icon: "gift" })
for (const m of read("giftWrapMaterials")) add(m.image, m.name, { icon: { GIAY_GOI: "package", RUY_BANG: "gift", THIEP: "mail" }[m.kind], w: 400, h: 400 })
for (const s of read("stickerSets"))
  for (const st of s.stickers) add(st.image, st.name, { axis: (s.axes || [])[0], icon: "star", w: 240, h: 240 })

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

// Ngắt dòng tên theo số ký tự
function wrap(text, max) {
  const lines = []
  let line = ""
  for (const word of text.split(" ")) {
    if ((line + " " + word).trim().length > max && line) {
      lines.push(line)
      line = word
    } else line = (line + " " + word).trim()
  }
  if (line) lines.push(line)
  return lines.slice(0, 3)
}

// Phần ruột của tệp biểu tượng (bỏ thẻ <svg> ngoài; màu nét đặt ở thẻ <g> bọc ngoài)
function iconPaths(name) {
  const file = path.join(ICONS, (name || "gift") + ".svg")
  if (!fs.existsSync(file)) return ""
  return fs.readFileSync(file, "utf8").replace(/^\s*<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "")
}

function svg({ label, sub, axis, icon, w, h }) {
  const [bg1, bg2, ink] = TONES[axis] || TONES.DEFAULT
  const s = Math.min(w, h)
  const fontSize = Math.round(s / 14)
  const lines = wrap(label, Math.max(12, Math.round(w / fontSize / 0.62)))
  const iconSize = Math.round(s / 4)
  const lineHeight = fontSize * 1.25
  const blockHeight = iconSize + fontSize * 0.8 + lines.length * lineHeight + (sub ? fontSize : 0)
  const top = (h - blockHeight) / 2
  const textY = top + iconSize + fontSize * 0.8 + fontSize
  const text = lines
    .map((l, i) => `<text x="${w / 2}" y="${textY + i * lineHeight}" font-size="${fontSize}" font-weight="700">${esc(l)}</text>`)
    .join("")
  const subText = sub
    ? `<text x="${w / 2}" y="${textY + lines.length * lineHeight + fontSize * 0.2}" font-size="${Math.round(fontSize * 0.7)}">${esc(sub)}</text>`
    : ""
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label)}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient></defs>
<rect width="${w}" height="${h}" fill="url(#g)"/>
<g transform="translate(${w / 2 - iconSize / 2} ${top}) scale(${iconSize / 24})" fill="none" stroke="${ink}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${iconPaths(icon)}</g>
<g fill="${ink}" text-anchor="middle" font-family="Montserrat, Arial, sans-serif">${text}${subText}</g>
<text x="${w - 16}" y="${h - 16}" text-anchor="end" font-family="Montserrat, Arial, sans-serif" font-size="${Math.max(12, Math.round(s / 40))}" fill="${ink}" opacity=".7">Ảnh minh họa</text>
</svg>
`
}

let created = 0
for (const [p, job] of jobs) {
  const file = path.join(OUT, p)
  if (fs.existsSync(file)) continue
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, svg(job))
  created++
}
console.log(`Ảnh trong seed: ${jobs.size}, tạo mới: ${created}`)
