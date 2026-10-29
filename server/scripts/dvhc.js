// Tải danh sách địa giới hành chính 2 cấp từ External API làm bản dự phòng cho client
// (07_API_Spec.md Mục 1.6): node scripts/dvhc.js -> public/data/dvhc.json.
// Cấu trúc giống API v2 (chỉ giữ code, name) để DvhcApiService đọc chung một kiểu IProvince, IWard.
const fs = require("fs")
const path = require("path")

const API = "https://provinces.open-api.vn/api/v2"
const OUT = path.join(__dirname, "..", "public", "data", "dvhc.json")

async function getJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`External API trả ${res.status} cho ${url}`)
  return res.json()
}

async function main() {
  // Danh sách tỉnh không kèm phường/xã, nên lấy chi tiết từng tỉnh (depth=2)
  const list = await getJson(`${API}/p/`)
  const provinces = []
  for (const p of list) {
    const detail = await getJson(`${API}/p/${p.code}?depth=2`)
    provinces.push({ code: p.code, name: p.name, wards: (detail.wards || []).map((w) => ({ code: w.code, name: w.name })) })
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(provinces))
  const wards = provinces.reduce((n, p) => n + p.wards.length, 0)
  console.log(`Đã lưu ${provinces.length} tỉnh/thành, ${wards} phường/xã vào public/data/dvhc.json`)
}

main().catch((err) => {
  console.error("Không tải được danh sách địa giới:", err.message)
  process.exitCode = 1
})
