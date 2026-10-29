// Sinh bộ dữ liệu lịch sử 1,5 năm (19/04/2025 - 19/10/2026) để xem trước trước khi nạp.
// Chạy: node scripts/gen-dataset.js <thư mục ra>  -> dataset.json (dạng phẳng, dùng dựng Excel xem trước).
// Dùng hạt giống cố định nên mỗi lần chạy ra đúng một bộ dữ liệu.
const fs = require("fs")
const path = require("path")

const SEED_DIR = path.join(__dirname, "..", "..", "data", "seed")
const DVHC = require("../public/data/dvhc.json")
const baseProducts = require(path.join(SEED_DIR, "products.json"))

// ---------- Ngẫu nhiên có hạt giống ----------
let state = 20261019
function rnd() {
  state |= 0
  state = (state + 0x6d2b79f5) | 0
  let t = Math.imul(state ^ (state >>> 15), 1 | state)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1))
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
const chance = (p) => rnd() < p
function weighted(items, weightOf) {
  const total = items.reduce((s, x) => s + weightOf(x), 0)
  let r = rnd() * total
  for (const x of items) if ((r -= weightOf(x)) <= 0) return x
  return items[items.length - 1]
}

// ---------- Thời gian (giờ Việt Nam) ----------
const H = 3600 * 1000
const D = 24 * H
const vn = (s) => new Date(s + "+07:00")
const START = vn("2025-04-19T08:00:00")
const NOW = vn("2026-10-19T10:00:00")
const pad = (n, w = 2) => String(n).padStart(w, "0")
function vnParts(d) {
  const x = new Date(d.getTime() + 7 * H)
  return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate(), h: x.getUTCHours(), mi: x.getUTCMinutes() }
}
const fmt = (d) => {
  if (!d) return ""
  const p = vnParts(d)
  return `${pad(p.d)}/${pad(p.m)}/${p.y} ${pad(p.h)}:${pad(p.mi)}`
}
const ymd = (d) => {
  const p = vnParts(d)
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`
}
const yymmdd = (d) => {
  const p = vnParts(d)
  return `${String(p.y).slice(2)}${pad(p.m)}${pad(p.d)}`
}
const monthKey = (d) => {
  const p = vnParts(d)
  return `${p.y}-${pad(p.m)}`
}
// Giờ đặt hàng: nhiều vào trưa và tối
function atRandomHour(dayStart) {
  const hour = weighted([8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23], (h) => (h >= 19 && h <= 22 ? 3 : h === 12 || h === 13 ? 2 : 1))
  return new Date(dayStart.getTime() + (hour - 8) * H + int(0, 59) * 60000)
}

// ---------- Tên, địa chỉ ----------
const HO = ["Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Huỳnh", "Phan", "Vũ", "Võ", "Đặng", "Bùi", "Đỗ", "Hồ", "Ngô", "Dương", "Lý", "Trương", "Đinh", "Lâm", "Mai", "Tô", "Châu"]
const DEM_NU = ["Thị", "Ngọc", "Thanh", "Minh", "Thu", "Khánh", "Bảo", "Phương", "Hoài", "Mỹ", "Gia", "Diệu"]
const TEN_NU = ["Anh", "Linh", "Trang", "Hà", "Vy", "My", "Ngân", "Thảo", "Hương", "Nhi", "Quyên", "Yến", "Trâm", "Uyên", "Tiên", "Hạnh", "Ly", "Châu", "Duyên", "Giang", "Hân", "Khuê", "Như", "Thư"]
const DEM_NAM = ["Văn", "Minh", "Quốc", "Đức", "Hoàng", "Gia", "Thành", "Tuấn", "Anh", "Hữu", "Nhật", "Bảo"]
const TEN_NAM = ["Huy", "Khang", "Phúc", "Nam", "Long", "Tùng", "Dũng", "Khoa", "Hiếu", "Bảo", "Tài", "Thịnh", "Đạt", "Hưng", "Kiên", "Lộc", "Quân", "Sơn", "Trí", "Vinh", "Duy", "Hào", "Nhân", "Phong"]
const STREETS = ["Lê Lợi", "Nguyễn Huệ", "Trần Hưng Đạo", "Hai Bà Trưng", "Lý Thường Kiệt", "Nguyễn Trãi", "Điện Biên Phủ", "Cách Mạng Tháng Tám", "Võ Văn Tần", "Pasteur", "Lê Duẩn", "Phan Đình Phùng", "Nguyễn Văn Cừ", "Quang Trung", "Hoàng Văn Thụ", "Bạch Đằng", "Ngô Quyền", "Lạc Long Quân"]
const noAccent = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D")
function personName(gender) {
  const ho = pick(HO)
  return gender === "NAM" ? `${ho} ${pick(DEM_NAM)} ${pick(TEN_NAM)}` : `${ho} ${pick(DEM_NU)} ${pick(TEN_NU)}`
}
// Phân bố tỉnh: TP.HCM, Hà Nội chiếm phần lớn
const PROVINCE_WEIGHT = { "Thành phố Hồ Chí Minh": 38, "Thành phố Hà Nội": 22, "Thành phố Đà Nẵng": 6, "Thành phố Cần Thơ": 4, "Thành phố Đồng Nai": 4, "Thành phố Hải Phòng": 3, "Tỉnh Khánh Hòa": 2, "Tỉnh Lâm Đồng": 2 }
function address(name, phone) {
  const prov = weighted(DVHC, (p) => PROVINCE_WEIGHT[p.name] || 0.6)
  return { recipientName: name, phone, province: prov.name, ward: pick(prov.wards).name, street: `${int(1, 499)} ${pick(STREETS)}` }
}
const usedPhones = new Set(["0901234567", "0912345678"])
function phone() {
  for (;;) {
    const p = pick(["090", "091", "093", "094", "096", "097", "098", "086", "088", "070", "077", "079", "083", "085"]) + String(int(0, 9999999)).padStart(7, "0")
    if (!usedPhones.has(p)) return usedPhones.add(p), p
  }
}

// ---------- Nhân viên ----------
const TEAM = [
  ["Nguyễn Như Quỳnh", "quynhnnk24406h1@st.uel.edu.vn", ["QUAN_TRI"], "Thành viên nhóm (trưởng nhóm)"],
  ["Phan Ngọc Bảo Châu", "chaupnbk24406h@st.uel.edu.vn", ["BAN_HANG"], "Thành viên nhóm"],
  ["Huỳnh Nhật Đăng", "danghnk24406h@st.uel.edu.vn", ["QUAN_TRI"], "Thành viên nhóm (kiểm thử phần quản trị)"],
  ["Huỳnh Phúc Huy", "huyhpk24406h@st.uel.edu.vn", ["BAN_HANG", "KHO"], "Thành viên nhóm"],
  ["Trần Ái Quyên", "quyentak24406h@st.uel.edu.vn", ["BAN_HANG", "KHO"], "Thành viên nhóm (kiểm thử phần bán hàng)"],
]
const staff = [
  { fullName: "Quản trị Soulprint", email: "admin@soulprint.vn", phone: "0900000001", staffRoles: ["QUAN_TRI"], status: "HOAT_DONG", password: "Admin@123", kind: "Admin chung", joinedAt: START },
  { fullName: "Quản trị phụ Soulprint", email: "admin2@soulprint.vn", phone: "0900000002", staffRoles: ["QUAN_TRI"], status: "HOAT_DONG", password: "Admin@123", kind: "Admin chung phụ", joinedAt: START },
  ...TEAM.map(([fullName, email, staffRoles, kind]) => ({ fullName, email, phone: phone(), staffRoles, status: "HOAT_DONG", password: "Staff@123", kind, joinedAt: START })),
  { fullName: "Phan Ngọc Lan", email: "ngoclan@soulprint.vn", phone: "0905334128", staffRoles: ["BAN_HANG"], status: "HOAT_DONG", password: "Staff@123", kind: "Giả lập", joinedAt: START, onDuty: true },
  { fullName: "Lê Quốc Huy", email: "quochuy@soulprint.vn", phone: "0937210456", staffRoles: ["BAN_HANG", "KHO"], status: "HOAT_DONG", password: "Staff@123", kind: "Giả lập", joinedAt: vn("2025-09-01T08:00:00") },
  { fullName: "Đỗ Minh Khoa", email: "minhkhoa@soulprint.vn", phone: "0912778301", staffRoles: ["KHO"], status: "HOAT_DONG", password: "Staff@123", kind: "Giả lập (có quyền riêng KHACH_HANG.XEM)", joinedAt: vn("2025-06-01T08:00:00") },
  { fullName: "Vũ Thảo Vy", email: "thaovy@soulprint.vn", phone: "0976445902", staffRoles: ["VT_CHAM_SOC_KHACH_HANG"], status: "CHO_KICH_HOAT", password: "", kind: "Giả lập (chờ kích hoạt)", joinedAt: vn("2026-10-15T08:00:00") },
  { fullName: "Ngô Gia Hưng", email: "giahung@soulprint.vn", phone: "0868123777", staffRoles: ["KHO"], status: "BI_KHOA", password: "Staff@123", kind: "Giả lập (đã khóa, nghỉ việc 02/09/2026)", joinedAt: START, leftAt: vn("2026-09-02T08:00:00") },
]
const activeAt = (s, d) => s.status !== "CHO_KICH_HOAT" && s.joinedAt <= d && (!s.leftAt || s.leftAt > d)
const staffBy = (role, d) => {
  const list = staff.filter((s) => activeAt(s, d) && (s.staffRoles.includes(role) || (role !== "QUAN_TRI" && s.staffRoles.includes("QUAN_TRI") && chance(0.05))))
  return pick(list.length ? list : staff.slice(0, 1))
}

// ---------- Sản phẩm (36 có sẵn + 24 mới = 60) ----------
const extra = require("./dataset/catalog-extra")
const toProduct = (p, isNew) => ({
  sku: p.sku, name: p.name, categorySlug: p.categorySlug, axis: p.axis, price: p.price, salePrice: p.salePrice || null,
  saleStartAt: p.saleStartAt ? new Date(p.saleStartAt) : null, saleEndAt: p.saleEndAt ? new Date(p.saleEndAt) : null,
  personalization: p.personalization && p.personalization.allowed ? p.personalization.types.join(", ") : "",
  engrave: (p.personalization && p.personalization.engrave) || { mode: "THUONG", maxChars: 20 },
  warrantyMonths: p.warrantyMonths || 0, isFeatured: !!p.isFeatured,
  variants: p.variants.map((v) => ({ sku: v.sku, name: v.name, priceDelta: v.priceDelta || 0 })),
  createdAt: isNew ? new Date(p.launchedAt) : new Date(START.getTime() - int(1, 10) * D), isNew, status: p.status,
})
const products = [...baseProducts.map((p) => toProduct(p, false)), ...extra.products.map((p) => toProduct(p, true))]
// GM-VBL-005 ngừng bán từ 01/08/2026
const sellable = (p, d) => p.createdAt <= d && p.status !== "BAN_NHAP" && !(p.sku === "GM-VBL-005" && d >= vn("2026-08-01T00:00:00"))
// Độ phổ biến: nổi bật và giá vừa phải bán chạy hơn
const popularity = new Map(products.map((p) => [p.sku, (p.isFeatured ? 3 : 1) * (p.price <= 500000 ? 1.6 : p.price <= 1000000 ? 1 : 0.4) * (0.5 + rnd())]))

// ---------- Voucher ----------
const vouchers = [
  { code: "SOULPRINT10", name: "Chào mừng thành viên mới", type: "PERCENT", value: 10, maxDiscount: 50000, minOrderValue: 0, audience: "NEW_MEMBERS", source: "WELCOME", startAt: START, endAt: vn("2027-12-31T23:59:59"), totalQuantity: 10000, perUserLimit: 1, note: "Tự cấp khi đăng ký, hạn 30 ngày" },
  { code: "KHAITRUONG", name: "Mừng khai trương", type: "PERCENT", value: 15, maxDiscount: 60000, minOrderValue: 200000, audience: "PUBLIC", source: "CAMPAIGN", startAt: START, endAt: vn("2025-05-19T23:59:59"), totalQuantity: 300, perUserLimit: 1 },
  { code: "BOCUAEM25", name: "Ngày của Cha 2025", type: "FIXED", value: 30000, minOrderValue: 300000, audience: "PUBLIC", source: "CAMPAIGN", startAt: vn("2025-06-01T00:00:00"), endAt: vn("2025-06-15T23:59:59"), totalQuantity: 200, perUserLimit: 1 },
  { code: "BLACKFRI25", name: "Black Friday 2025", type: "PERCENT", value: 20, maxDiscount: 100000, minOrderValue: 400000, audience: "PUBLIC", source: "CAMPAIGN", startAt: vn("2025-11-24T00:00:00"), endAt: vn("2025-11-30T23:59:59"), totalQuantity: 300, perUserLimit: 1 },
  { code: "NOEL2025", name: "Giáng sinh ấm áp", type: "FIXED", value: 50000, minOrderValue: 500000, audience: "ALL_MEMBERS", source: "CAMPAIGN", startAt: vn("2025-12-10T00:00:00"), endAt: vn("2025-12-25T23:59:59"), totalQuantity: 300, perUserLimit: 1 },
  { code: "TET2026", name: "Quà Tết Bính Ngọ", type: "PERCENT", value: 10, maxDiscount: 80000, minOrderValue: 300000, audience: "PUBLIC", source: "CAMPAIGN", startAt: vn("2026-01-20T00:00:00"), endAt: vn("2026-02-14T23:59:59"), totalQuantity: 400, perUserLimit: 1 },
  { code: "VALEN26", name: "Valentine 2026", type: "FIXED", value: 40000, minOrderValue: 400000, audience: "PUBLIC", source: "CAMPAIGN", startAt: vn("2026-02-01T00:00:00"), endAt: vn("2026-02-14T23:59:59"), totalQuantity: 400, perUserLimit: 1 },
  { code: "BOCUAEM26", name: "Ngày của Cha 2026", type: "FIXED", value: 30000, minOrderValue: 300000, audience: "PUBLIC", source: "CAMPAIGN", startAt: vn("2026-06-01T00:00:00"), endAt: vn("2026-06-21T23:59:59"), totalQuantity: 300, perUserLimit: 1 },
  { code: "FREESHIP30", name: "Miễn phí vận chuyển", type: "FREESHIP", value: 30000, minOrderValue: 300000, audience: "PUBLIC", source: "CAMPAIGN", startAt: START, endAt: vn("2026-12-31T23:59:59"), totalQuantity: 2000, perUserLimit: 5 },
  { code: "GAMER50K", name: "Ưu đãi góc game thủ", type: "FIXED", value: 50000, minOrderValue: 500000, audience: "ALL_MEMBERS", source: "CAMPAIGN", startAt: vn("2026-10-01T00:00:00"), endAt: vn("2026-11-30T23:59:59"), totalQuantity: 200, perUserLimit: 1, scopeCats: ["vat-bat-ly-than", "me-man"] },
  { code: "BUDAP30K", name: "Bù đắp trải nghiệm", type: "FIXED", value: 30000, minOrderValue: 0, audience: "SELECTED", source: "COMPENSATION", startAt: START, endAt: vn("2027-06-30T23:59:59"), totalQuantity: 100, perUserLimit: 1, note: "Cấp cho khách có đơn giao trễ hoặc bị từ chối đổi trả" },
]
for (const v of vouchers) Object.assign(v, { usedCount: 0, discountGiven: 0 })

// ---------- Khách hàng ----------
const customers = []
const usedEmails = new Set()
function newCustomer(createdAt, opts = {}) {
  const gender = opts.gender || (chance(0.68) ? "NU" : "NAM")
  const fullName = opts.fullName || personName(gender)
  const ph = opts.phone || phone()
  const local = noAccent(fullName).toLowerCase().split(" ")
  const email = opts.email || (opts.guest && chance(0.5) ? "" : `${local[local.length - 1]}.${local[0]}${int(10, 999)}@example.com`)
  const c = {
    id: customers.length + 1, fullName, gender, phone: ph, email, createdAt,
    status: opts.guest ? "CHO_KICH_HOAT" : "HOAT_DONG", source: opts.guest ? "Guest Checkout" : chance(0.15) ? "Google" : "Đăng ký",
    addresses: [address(fullName, ph)], orders: 0, spent: 0, welcomeUsed: false, loyalty: opts.loyalty ?? Math.pow(rnd(), 2.2),
  }
  if (c.source === "Google" && !c.email) c.email = `${local[local.length - 1]}${int(100, 999)}@example.com`
  while (c.email && usedEmails.has(c.email)) c.email = c.email.replace("@", int(0, 9) + "@")
  if (c.email) usedEmails.add(c.email)
  customers.push(c)
  return c
}
// 2 Member demo có sẵn
const minhAnh = newCustomer(vn("2025-04-25T20:10:00"), { fullName: "Nguyễn Minh Anh", gender: "NU", phone: "0901234567", email: "minhanh@example.com", loyalty: 1 })
minhAnh.addresses = [{ recipientName: "Nguyễn Minh Anh", phone: "0901234567", province: "Thành phố Hồ Chí Minh", ward: "Phường Linh Xuân", street: "669 Đỗ Mười, Khu phố 3" }]
const quocBao = newCustomer(vn("2025-07-02T19:30:00"), { fullName: "Trần Quốc Bảo", gender: "NAM", phone: "0912345678", email: "quocbao@example.com", loyalty: 0.9 })
quocBao.addresses = [{ recipientName: "Trần Quốc Bảo", phone: "0912345678", province: "Thành phố Hà Nội", ward: "Phường Cầu Giấy", street: "144 Xuân Thủy" }]
minhAnh.demo = quocBao.demo = true

// ---------- Nhịp đơn theo ngày ----------
// Tăng dần từ ~1,2 đơn/ngày lên ~4,5 đơn/ngày; cộng các dịp tặng quà
function dayRate(d) {
  const t = (d - START) / (NOW - START)
  let r = 1.2 + 3.3 * Math.pow(t, 1.15)
  const { m, d: dd } = vnParts(d)
  if (m === 2 && dd <= 14) r *= 2.4 // Valentine
  if (m === 1 || (m === 2 && dd > 14 && dd <= 16)) r *= 1.35 // Tết
  if (m === 6 && dd <= 21) r *= 1.7 // Ngày của Cha
  if (m === 12 && dd <= 25) r *= 1.8 // Giáng sinh
  if (m === 11 && dd >= 24) r *= 1.9 // Black Friday
  if (m === 9 && dd <= 10) r *= 1.2 // khai giảng
  if (m === 10 && dd >= 15 && dd <= 31) r *= 1.2 // Halloween
  const dow = new Date(d.getTime() + 7 * H).getUTCDay()
  if (dow === 0 || dow === 6) r *= 1.25
  return r
}
function poisson(lambda) {
  let L = Math.exp(-lambda), k = 0, p = 1
  do { k++; p *= rnd() } while (p > L)
  return k - 1
}

// ---------- Đơn hàng ----------
const orders = []
const counters = {}
const nextCode = (prefix, d) => {
  const key = prefix + yymmdd(d)
  counters[key] = (counters[key] || 0) + 1
  return `${prefix}${yymmdd(d)}${pad(counters[key], 4)}`
}
const MSG = ["Chúc anh sinh nhật vui vẻ!", "Mãi bên nhau nhé", "Gửi bố yêu", "Chúc mừng tốt nghiệp", "Happy Valentine", "Merry Christmas", "Cố lên nha", "Tặng anh trai", "Kỷ niệm 1 năm", "Chúc mừng năm mới"]
const ENGRAVE = ["MINH KHANG", "HUY 10", "Tùng ơi", "Mãi yêu", "SON TUNG", "Gia Bảo", "KHOA 7", "Phúc An", "TEAM SOULPRINT", "Nam Phong", "23.04.2026", "Anh Hai"]
const STICKERS = { THE_THAO: ["TT-BONG", "TT-CUP", "TT-SO10"], ANIME: ["AN-SAO", "AN-MEO", "AN-KIEM"], GAME: ["GM-TAYCAM", "GM-PIXEL", "GM-GG"] }
// Sticker dùng được tại thời điểm đặt: bộ theo trục + bộ mùa đang chạy
const SEASONAL = [
  { codes: ["VAL-TIM", "VAL-THU", "VAL-HONG"], from: vn("2026-02-01T00:00:00"), to: vn("2026-02-15T23:59:59") },
  { codes: ["HLW-BINGO", "HLW-DOI", "HLW-BONGMA"], from: vn("2026-10-01T00:00:00"), to: vn("2026-11-02T23:59:59") },
]
function stickerPool(axis, d) {
  const pool = [...STICKERS[axis]]
  if (axis === "THE_THAO" && d >= vn("2026-05-20T00:00:00")) pool.push("TT-TA", "TT-LUA", "TT-NHIPTIM")
  for (const s of SEASONAL) if (d >= s.from && d <= s.to) pool.push(...s.codes, ...s.codes)
  return pool
}
const CARRIERS = ["GHN", "GHTK", "SPX", "VIETTEL_POST"]
const NOTES = ["", "", "", "", "Gói kín giúp mình, không để hóa đơn", "Giao giờ hành chính", "Gọi trước khi giao", "Bất ngờ cho người nhận nha shop", "Kiểm tra kỹ chữ khắc giúp mình"]
const CANCEL_REASONS = ["DOI_NOI_DUNG", "DOI_DIA_CHI", "DAT_TRUNG", "CHON_QUA_KHAC", "KHAC"]
const isHCM = (prov) => prov === "Thành phố Hồ Chí Minh"

function unitPriceOf(p, v, d) {
  const onSale = p.salePrice && p.saleStartAt && d >= p.saleStartAt && d <= p.saleEndAt
  return (onSale ? p.salePrice : p.price) + v.priceDelta
}
function pickVoucher(c, d, eligible, hasFreeship) {
  const list = []
  const active = vouchers.filter((v) => d >= v.startAt && d <= v.endAt && v.usedCount < v.totalQuantity)
  // Chào mừng: đơn đầu trong 30 ngày đầu
  const w = active.find((v) => v.code === "SOULPRINT10")
  if (w && c.status === "HOAT_DONG" && !c.welcomeUsed && c.orders === 0 && d - c.createdAt < 30 * D && chance(0.7)) list.push(w)
  else {
    const camp = active.filter((v) => v.source === "CAMPAIGN" && v.type !== "FREESHIP" && eligible >= v.minOrderValue && (v.audience === "PUBLIC" || c.status === "HOAT_DONG"))
    if (camp.length && chance(0.55)) list.push(pick(camp))
  }
  const fs = active.find((v) => v.code === "FREESHIP30")
  if (hasFreeship && fs && eligible >= fs.minOrderValue && chance(0.18)) list.push(fs)
  return list
}

function buildOrder(c, at, opt = {}) {
  const lines = []
  const nLines = opt.items ? opt.items.length : weighted([1, 2, 3], (n) => [70, 23, 7][n - 1])
  const avail = products.filter((p) => sellable(p, at))
  for (let i = 0; i < nLines; i++) {
    const p = opt.items ? products.find((x) => x.sku === opt.items[i]) : weighted(avail, (x) => popularity.get(x.sku) * (x.isNew && at - x.createdAt < 45 * D ? 2 : 1))
    if (lines.some((l) => l.sku === p.sku)) continue
    const v = pick(p.variants)
    const quantity = chance(0.9) ? 1 : 2
    let pers = null, fee = 0, pz = null
    const wantPers = opt.personalized ?? chance(0.55)
    if (p.personalization && wantPers) {
      if (p.personalization.includes("IN_KHAC") && (!p.personalization.includes("THIET_KE") || chance(0.6))) {
        // Nội dung khắc vừa giới hạn ký tự của sản phẩm (BR-18); áo đấu in tên + số áo
        const fits = ENGRAVE.filter((t) => Array.from(t).length <= (p.engrave.maxChars || p.engrave.topMaxChars || 20))
        const text = pick(fits.length ? fits : ENGRAVE)
        if (p.engrave.mode === "AO_DAU") {
          const top = noAccent(text).toUpperCase().slice(0, p.engrave.topMaxChars || 12)
          pz = { type: "IN_KHAC", mode: "AO_DAU", top, number: String((Array.from(text).length * 7) % 99 + 1), bottom: "" }
          pers = `In/Khắc: "${pz.top}" số ${pz.number}`
        } else {
          pz = { type: "IN_KHAC", mode: "THUONG", text }
          pers = `In/Khắc: "${text}"`
        }
      } else {
        const n = int(1, 3)
        const pool = stickerPool(p.axis, at)
        // Mỗi sticker chỉ chọn một lần (BR-20)
        const st = [...new Set(Array.from({ length: n }, () => pick(pool)))]
        const message = chance(0.5) ? pick(MSG) : ""
        pz = { type: "THIET_KE", stickers: st, message }
        pers = `Thiết kế: ${st.length} sticker (${st.join(", ")})${message ? `, lời nhắn "${message}"` : ""}`
        fee = 5000 * st.length
      }
    }
    const unitPrice = unitPriceOf(p, v, at)
    lines.push({ sku: p.sku, variantSku: v.sku, name: p.name, variantName: v.name, unitPrice, quantity, personalization: pers, pz, feePerUnit: fee, lineValue: (unitPrice + fee) * quantity, axis: p.axis, warrantyMonths: p.warrantyMonths, categorySlug: p.categorySlug })
  }
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0)
  const personalizationFee = lines.reduce((s, l) => s + l.feePerUnit * l.quantity, 0)
  const shippingFee = 30000
  const recipientType = opt.recipientType || (chance(0.3) ? "OTHER" : "SELF")
  const used = opt.noVoucher ? [] : pickVoucher(c, at, subtotal + personalizationFee, true)
  const vSnap = []
  for (const v of used) {
    let eligible = subtotal + personalizationFee
    if (v.scopeCats) eligible = lines.filter((l) => v.scopeCats.includes(l.categorySlug)).reduce((s, l) => s + l.lineValue, 0)
    let discount = v.type === "PERCENT" ? Math.min(Math.floor((eligible * v.value) / 100), v.maxDiscount) : v.type === "FIXED" ? Math.min(v.value, eligible) : Math.min(v.value, shippingFee)
    if (discount <= 0) continue
    vSnap.push({ code: v.code, discount })
    v.usedCount++
    v.discountGiven += discount
    if (v.code === "SOULPRINT10") c.welcomeUsed = true
  }
  const discount = vSnap.reduce((s, v) => s + v.discount, 0)
  const total = subtotal + shippingFee + personalizationFee - discount
  const hasPers = lines.some((l) => l.personalization)
  // Thanh toán theo 02 Mục 3.3
  let paymentMethod, remainingMethod = "", depositAmount = 0
  if (recipientType === "OTHER") paymentMethod = "ONLINE"
  else if (hasPers) {
    depositAmount = Math.min(Math.ceil(lines.filter((l) => l.personalization).reduce((s, l) => s + l.lineValue, 0) * 0.5), total)
    paymentMethod = "ONLINE"
    remainingMethod = opt.remainingMethod || (chance(0.72) ? "COD" : "ONLINE")
  } else paymentMethod = opt.paymentMethod || (chance(0.6) ? "COD" : "ONLINE")
  const upfront = recipientType === "OTHER" ? total : hasPers ? (remainingMethod === "ONLINE" ? total : depositAmount) : paymentMethod === "ONLINE" ? total : 0
  const ship = recipientType === "OTHER" ? address(personName("NAM"), phone()) : pick(c.addresses)
  const o = {
    code: nextCode("SP", at), createdAt: at, customerId: c.id, customerName: c.fullName, customerPhone: c.phone, accountType: c.status === "CHO_KICH_HOAT" ? "Guest" : "Member",
    createdBy: opt.createdBy || "KHACH", source: opt.source || "WEBSITE", lines, hasPers, recipientType, shipping: ship,
    giftWrap: chance(recipientType === "OTHER" ? 0.55 : 0.25) ? pick(["Gợi ý: Hộp kraft mộc", "Gợi ý: Sân cỏ xanh", "Gợi ý: Đêm anime", "Gợi ý: Neon game thủ", "Tạo mới: giấy kraft, ruy băng đỏ, thiệp trơn"]) : "",
    noteForShop: pick(NOTES), subtotal, personalizationFee, shippingFee, discount, total, vouchers: vSnap,
    depositAmount, remainingAmount: total - depositAmount, paymentMethod, remainingMethod, paidAmount: upfront, refundedAmount: 0,
    orderStatus: "CHO_XAC_NHAN", paymentStatus: upfront === 0 ? "CHUA_THANH_TOAN" : upfront < total ? "DA_COC" : "DA_THANH_TOAN", returnStatus: "KHONG_CO",
    history: [{ to: "CHO_XAC_NHAN", at, by: "Hệ thống" }], tags: [], scenario: opt.scenario || "", carrier: "", trackingCode: "",
  }
  if (o.recipientType === "OTHER") {
    const lead = (vnParts(at).h >= 12 ? 1 : 0) + (hasPers ? 3 : 0) + (isHCM(ship.province) ? 2 : 4)
    o.deliveryDate = ymd(new Date(at.getTime() + (lead + int(0, 4)) * D))
  }
  c.orders++
  orders.push(o)
  return o
}

// Tiến trình đơn tới thời điểm NOW, hoặc tới bước `stopAt` khi ép kịch bản
const STEPS = ["CHO_XAC_NHAN", "DANG_CA_NHAN_HOA", "DANG_CHUAN_BI", "DANG_VAN_CHUYEN", "DA_GIAO", "HOAN_THANH"]
function advance(o, opt = {}) {
  let t = o.createdAt
  const go = (to, after, by) => {
    const at = new Date(t.getTime() + after)
    if (at > NOW) return false
    o.history.push({ to, at, by })
    o.orderStatus = to
    t = at
    return true
  }
  const stop = opt.stopAt
  // Đơn kịch bản không bị hủy hay giữ lại ngẫu nhiên
  const free = !o.scenario && !stop && !opt.cancel
  const reached = (s) => stop && STEPS.indexOf(o.orderStatus) >= STEPS.indexOf(stop)
  // Hủy sớm bởi khách (TH1/TH2): khoảng 5%
  if (opt.cancel === "MEMBER" || (free && chance(0.05))) {
    const at = new Date(t.getTime() + int(10, 300) * 60000)
    if (at <= NOW) return cancel(o, at, "MEMBER")
  }
  // Đơn trong 36 giờ gần nhất phần lớn còn chờ xác nhận, để khu quản trị có việc khi demo
  if (free && NOW - o.createdAt < 36 * H && chance(0.7)) return
  const confirmBy = staffBy("BAN_HANG", t)
  if (!go(o.hasPers ? "DANG_CA_NHAN_HOA" : "DANG_CHUAN_BI", int(40, 1200) * 60000, confirmBy.fullName)) return
  if (o.hasPers) o.personalizationStartedAt = t
  if (reached()) return
  // Hủy ngoại lệ bởi nhân viên: khoảng 1,5%
  if (opt.cancel === "ADMIN" || (free && chance(0.015))) return cancel(o, new Date(t.getTime() + int(2, 20) * H), "ADMIN")
  if (o.hasPers && !go("DANG_CHUAN_BI", int(24, 72) * H, staffBy("KHO", t).fullName)) return
  if (reached()) return
  const shipBy = staffBy("KHO", t)
  if (!go("DANG_VAN_CHUYEN", int(4, 20) * H, shipBy.fullName)) return
  o.carrier = pick(CARRIERS)
  o.trackingCode = `${o.carrier.slice(0, 2)}${int(100000000, 999999999)}`
  if (reached()) return
  // Từ chối nhận hàng: khoảng 1,5%
  if (opt.cancel === "REFUSED" || (free && chance(0.015))) return cancel(o, new Date(t.getTime() + int(30, 80) * H), "REFUSED")
  const shipH = (isHCM(o.shipping.province) ? 2 : 4) * 24 - 30 + int(0, 30)
  if (!go("DA_GIAO", shipH * H, staffBy("BAN_HANG", t).fullName)) return
  o.deliveredAt = t
  if (o.paymentStatus !== "DA_THANH_TOAN") {
    o.codCollectedAt = t
    o.paidAmount = o.total
    o.paymentStatus = "DA_THANH_TOAN"
  }
  if (reached()) return
  const self = chance(0.45)
  if (!go("HOAN_THANH", self ? int(3, 48) * H : 72 * H, self ? "Khách" : "Hệ thống (72 giờ)")) return
  o.completedAt = t
}
function cancel(o, at, by) {
  if (at > NOW) return
  o.orderStatus = "DA_HUY"
  o.cancelledAt = at
  o.cancelBy = by
  o.history.push({ to: "DA_HUY", at, by: by === "MEMBER" ? "Khách" : by === "ADMIN" ? staffBy("BAN_HANG", at).fullName : "Shipper báo từ chối" })
  if (by === "MEMBER") o.cancelReason = pick(CANCEL_REASONS)
  if (by === "ADMIN") o.cancelReason = pick(["Hết vật liệu in khắc", "Khách yêu cầu qua hotline", "Nghi đơn ảo, không liên lạc được"])
  if (by === "REFUSED") {
    o.cancelReason = pick(["Không liên lạc được người nhận", "Người nhận đổi ý", "Sai địa chỉ"])
    o.refusedShippingFee = 30000
  }
  // BR-28: TH1 chưa trả, TH3 đã cá nhân hóa + đã trả, TH2 còn lại
  if (o.paidAmount === 0) o.cancelCase = "TH1"
  else if (o.hasPers && o.personalizationStartedAt) o.cancelCase = "TH3"
  else o.cancelCase = "TH2"
  if (o.cancelCase === "TH2") {
    o.refundedAmount = o.paidAmount - (by === "REFUSED" ? 30000 : 0)
    o.paymentStatus = o.refundedAmount === o.paidAmount ? "DA_HOAN_TIEN" : "HOAN_TIEN_MOT_PHAN"
    o.refund = { amount: o.refundedAmount, status: NOW - at > 3 * D ? "DA_HOAN" : "CHO_XU_LY" }
  }
  if (o.cancelCase === "TH3") {
    const persPaid = Math.min(o.paidAmount, o.lines.filter((l) => l.personalization).reduce((s, l) => s + l.lineValue, 0))
    o.refundedAmount = Math.max(0, o.paidAmount - persPaid - (by === "REFUSED" ? 30000 : 0))
    if (o.refundedAmount > 0) o.paymentStatus = "HOAN_TIEN_MOT_PHAN"
    const days = (NOW - at) / D
    o.storageStatus = days < 14 ? "DANG_LUU_KHO" : days < 30 ? "HET_HAN_LUU_KHO" : "DA_TIEU_HUY"
    o.storageDeadline = new Date(at.getTime() + 14 * D)
  }
}

// Sinh đơn ngẫu nhiên theo từng ngày
for (let day = new Date(START); day < NOW; day = new Date(day.getTime() + D)) {
  const n = poisson(dayRate(day))
  for (let i = 0; i < n; i++) {
    const at = atRandomHour(day)
    if (at > NOW) continue
    let c
    const returning = customers.filter((x) => x.createdAt < at && x.status === "HOAT_DONG" && !x.demo)
    if (returning.length > 20 && chance(0.52)) c = weighted(returning, (x) => 0.05 + x.loyalty)
    else if (chance(0.14)) c = newCustomer(at, { guest: true })
    else c = newCustomer(new Date(at.getTime() - int(0, 20) * D * (chance(0.5) ? 1 : 0) - int(5, 120) * 60000))
    advance(buildOrder(c, at))
  }
  // Member đăng ký mà chưa mua (khoảng 0,35 người/ngày)
  if (chance(0.35)) newCustomer(atRandomHour(day))
  // Guest đã kích hoạt tài khoản sau đó
}
for (const c of customers) if (c.status === "CHO_KICH_HOAT" && chance(0.35)) c.status = "HOAT_DONG", c.source = "Guest Checkout (đã kích hoạt)"

// ---------- Đơn kịch bản cho 2 Member demo ----------
const at = (s) => vn(s)
const demoOrders = [
  [minhAnh, "2025-05-02T20:15:00", { items: ["TT-DNC-SNBD-001"], personalized: true, recipientType: "SELF" }, {}, "Đơn đầu tiên, dùng SOULPRINT10"],
  [minhAnh, "2025-12-18T21:00:00", { items: ["GM-VBL-002", "GM-VBL-004"], recipientType: "OTHER" }, {}, "Quà Noel giao người nhận, đã đánh giá"],
  [minhAnh, "2026-02-10T12:40:00", { items: ["AN-KGC-VAL26-002"], personalized: true, recipientType: "SELF", remainingMethod: "ONLINE" }, {}, "Valentine, trả online 100%"],
  [minhAnh, "2026-10-09T19:20:00", { items: ["TT-TBN-001"], personalized: true, recipientType: "SELF" }, {}, "Đã giao 7 ngày trước, chưa đánh giá: demo Đánh giá"],
  [minhAnh, "2026-10-08T09:10:00", { items: ["AN-TBN-VAL26-001"], personalized: false, paymentMethod: "COD", recipientType: "SELF" }, {}, "Đổi trả đang chờ duyệt (hàng hư hỏng)"],
  [minhAnh, "2026-10-15T20:30:00", { items: ["GM-VBL-003"], personalized: false, paymentMethod: "ONLINE", recipientType: "SELF" }, { stopAt: "DANG_VAN_CHUYEN" }, "Đang giao: demo Theo dõi đơn"],
  [minhAnh, "2026-10-19T08:45:00", { items: ["TT-GBX-SNBD-001", "TT-MMN-SNBD-001"], personalized: true, recipientType: "SELF", remainingMethod: "COD" }, { stopAt: "CHO_XAC_NHAN" }, "Chờ xác nhận, đã cọc: demo Hủy đơn TH2"],
  [quocBao, "2025-07-05T21:10:00", { items: ["GM-VBL-001"], personalized: true, recipientType: "SELF" }, {}, "Bàn phím khắc tên, có bảo hành 12 tháng: demo Bảo hành"],
  [quocBao, "2026-06-14T10:00:00", { items: ["TT-VBL-001"], personalized: true, recipientType: "OTHER" }, {}, "Quà Ngày của Cha giao người nhận"],
  [quocBao, "2026-09-20T15:00:00", { items: ["GM-MMN-001"], personalized: false, paymentMethod: "COD", recipientType: "SELF" }, { cancel: "MEMBER" }, "Đã hủy TH1 (COD chưa trả): demo Đặt lại"],
  [quocBao, "2026-10-12T13:30:00", { items: ["AN-KGC-GCO-001", "AN-VBL-002"], personalized: true, recipientType: "SELF" }, { cancel: "REFUSED" }, "Từ chối nhận, TH3 đang lưu kho: demo Nhận lại hàng"],
  [quocBao, "2026-10-17T22:05:00", { items: ["GM-KGC-001"], personalized: true, recipientType: "SELF" }, { stopAt: "DANG_CA_NHAN_HOA" }, "Đang cá nhân hóa"],
]
for (const [c, when, opt, adv, scenario] of demoOrders) advance(buildOrder(c, at(when), { ...opt, scenario }), adv)

// ---------- Tình huống ngoại lệ cho khu quản trị ----------
const live = orders.filter((o) => o.createdAt > NOW - 12 * D && !o.scenario)
const tag = (o, s) => (o.scenario = s)
// Đơn kịch bản cho khách giả lập (không phụ thuộc đơn ngẫu nhiên nào có sẵn)
const scripted = (when, opt, adv, scenario) => {
  const c = newCustomer(new Date(vn(when).getTime() - 3 * D), { guest: opt.guest })
  const o = buildOrder(c, vn(when), { ...opt, scenario })
  advance(o, adv)
  return o
}
const cod = scripted("2026-10-13T11:20:00", { items: ["GM-KGC-005"], personalized: false, paymentMethod: "COD", recipientType: "SELF", noVoucher: true }, { stopAt: "DA_GIAO" }, "COD lệch tiền (thu thiếu 20.000đ): mức Khẩn cấp")
cod.codDiscrepancy = { expected: cod.total, collected: cod.total - 20000 }
const unf = scripted("2026-10-18T20:10:00", { items: ["TT-DNC-SNBD-001", "AN-VBL-003"], personalized: true, recipientType: "SELF", remainingMethod: "COD" }, { stopAt: "CHO_XAC_NHAN" }, "Móc khóa AN-VBL-003 hết hàng, chờ khách chọn thay thế (BR-30)")
const late = scripted("2026-10-11T09:30:00", { items: ["GM-KGC-008"], personalized: true, recipientType: "SELF", remainingMethod: "COD" }, { stopAt: "DANG_VAN_CHUYEN" }, "Gia hạn ngày giao (giao trễ), ghi chú nội bộ")
for (const [when, sku, pers] of [["2026-10-18T15:40:00", "TT-GBX-GGY-002", true], ["2026-10-19T07:50:00", "GM-MMN-002", false]]) {
  // Đơn gấp đã thanh toán tự xác nhận
  const o = scripted(when, { items: [sku], personalized: pers, recipientType: "OTHER", guest: true }, { stopAt: "CHO_XAC_NHAN" }, "Đơn gấp đã thanh toán, tự xác nhận (phụ phí 40.000đ)")
  o.tags.push("Đơn gấp")
  // Phụ phí gấp cộng vào tổng, đơn giao người nhận đã trả 100%
  o.urgentFee = 40000
  o.total += 40000
  o.remainingAmount = o.total
  o.paidAmount = o.total
  o.orderStatus = o.hasPers ? "DANG_CA_NHAN_HOA" : "DANG_CHUAN_BI"
  if (o.hasPers) o.personalizationStartedAt = o.createdAt
  o.history.push({ to: o.orderStatus, at: o.createdAt, by: "Tự xác nhận" })
}
const fromDraft = live.filter((o) => !o.scenario && o.orderStatus !== "DA_HUY").slice(0, 3)
fromDraft.forEach((o, i) => { o.createdBy = "ADMIN"; o.source = ["ZALO", "FACEBOOK", "DIEN_THOAI"][i]; tag(o, `Tạo từ đơn nháp (nguồn ${o.source})`) })

// ---------- Đổi trả, bảo hành ----------
const returns = []
const warranties = []
const RETURN_REASONS = [["HU_HONG", 30], ["LOI_IN_KHAC", 22], ["GIAO_SAI", 14], ["KHONG_DUNG_MO_TA", 18], ["DOI_Y", 16]]
const delivered = orders.filter((o) => o.deliveredAt)
for (const o of delivered) {
  const forced = o.scenario.startsWith("Đổi trả đang chờ duyệt")
  if (!forced && !chance(0.028)) continue
  const l = pick(o.lines)
  let reason = forced ? "HU_HONG" : weighted(RETURN_REASONS, (x) => x[1])[0]
  if (reason === "DOI_Y" && l.personalization) reason = "LOI_IN_KHAC"
  const createdAt = new Date(o.deliveredAt.getTime() + int(6, 6 * 24) * H)
  if (createdAt > NOW) continue
  const age = (NOW - createdAt) / D
  let status
  if (forced || age < 2) status = "DANG_YEU_CAU"
  else if (age < 5) status = pick(["DONG_Y", "DA_NHAN_HANG"])
  else status = weighted(["DA_HOAN_TAT", "TU_CHOI", "DA_HUY"], (s) => ({ DA_HOAN_TAT: 78, TU_CHOI: 14, DA_HUY: 8 })[s])
  const resolution = reason === "DOI_Y" || chance(0.4) ? "HOAN_TIEN" : "GIAO_LAI"
  const r = { code: nextCode("DT", createdAt), orderCode: o.code, customerName: o.customerName, createdAt, item: l.name, lineIndex: o.lines.indexOf(l), reason, resolution, value: l.lineValue, status, rejectReason: status === "TU_CHOI" ? pick(["ANH_KHONG_CHUNG_MINH", "DA_QUA_SU_DUNG", "LOI_DO_NGUOI_DUNG"]) : "", handledBy: status === "DANG_YEU_CAU" ? "" : staffBy("BAN_HANG", createdAt).fullName }
  returns.push(r)
  o.returnStatus = status === "DA_HUY" ? "KHONG_CO" : status
  if (status === "DA_HOAN_TAT" && resolution === "HOAN_TIEN") {
    // Hoàn giá trị món nhưng không vượt số khách thực trả (đơn có giảm giá)
    r.refundAmount = Math.min(l.lineValue, o.paidAmount - o.refundedAmount)
    o.refundedAmount += r.refundAmount
    o.paymentStatus = o.refundedAmount >= o.paidAmount ? "DA_HOAN_TIEN" : "HOAN_TIEN_MOT_PHAN"
  }
}
for (const o of delivered) {
  const forced = o.scenario.startsWith("Bàn phím khắc tên")
  const l = o.lines.find((x) => x.warrantyMonths > 0)
  if (!l || (!forced && !chance(0.012))) continue
  const createdAt = forced ? vn("2026-10-14T10:00:00") : new Date(o.deliveredAt.getTime() + int(20, l.warrantyMonths * 28) * D)
  if (createdAt > NOW) continue
  const age = (NOW - createdAt) / D
  const status = forced ? "DANG_XEM_XET" : age < 3 ? "DANG_XEM_XET" : age < 10 ? pick(["DA_DUYET", "DA_NHAN_HANG"]) : weighted(["HOAN_TAT", "TU_CHOI"], (s) => (s === "HOAN_TAT" ? 85 : 15))
  warranties.push({ code: nextCode("BH", createdAt), orderCode: o.code, customerName: o.customerName, createdAt, item: l.name, lineIndex: o.lines.indexOf(l), warrantyUntil: new Date(o.deliveredAt.getTime() + l.warrantyMonths * 30 * D), symptom: pick(["KHONG_HOAT_DONG", "CHAP_CHON", "HONG_MOT_PHAN", "BONG_MO_IN_KHAC"]), status, resolution: status === "HOAN_TAT" ? pick(["SUA_CHUA", "DOI_MOI"]) : "" })
}

// ---------- Đánh giá ----------
const COMMENTS = {
  5: ["Chữ khắc sắc nét, anh ấy rất thích!", "Đóng gói đẹp, giao nhanh hơn dự kiến.", "Đúng mô tả, chất lượng tốt so với giá.", "Hộp quà xinh xỉu, người nhận bất ngờ lắm.", "Lần thứ hai mua ở shop, vẫn hài lòng.", "Shop tư vấn nhiệt tình, sẽ ủng hộ tiếp.", ""],
  4: ["Sản phẩm ổn, giao hơi chậm một chút.", "Đẹp nhưng màu hơi khác ảnh.", "Tốt, mong shop có thêm mẫu sticker.", ""],
  3: ["Tạm được, hộp bị móp nhẹ.", "Chữ in hơi nhỏ so với mình nghĩ."],
  2: ["Giao trễ so với ngày hẹn, quà sinh nhật bị lỡ."],
  1: ["Sản phẩm lỗi, đã gửi yêu cầu đổi trả."],
}
const LIKES = ["CA_NHAN_HOA_DEP", "DONG_GOI_DEP", "GIAO_NHANH", "DUNG_MO_TA", "DANG_TIEN"]
const reviews = []
for (const o of orders.filter((x) => x.orderStatus === "HOAN_THANH")) {
  if (o.scenario.startsWith("Đã giao 7 ngày trước")) continue
  for (const l of o.lines) {
    if (!chance(o.scenario.includes("đã đánh giá") ? 1 : 0.42)) continue
    const rating = weighted([5, 4, 3, 2, 1], (r) => ({ 5: 62, 4: 25, 3: 8, 2: 3, 1: 2 })[r])
    const createdAt = new Date(o.deliveredAt.getTime() + int(4, 96) * H)
    if (createdAt > NOW) continue
    const likes = rating >= 4 ? LIKES.filter((k) => (k !== "CA_NHAN_HOA_DEP" || l.personalization) && chance(0.4)) : []
    reviews.push({ product: l.name, sku: l.sku, orderCode: o.code, lineIndex: o.lines.indexOf(l), customerName: o.customerName, rating, likes, comment: pick(COMMENTS[rating]), hasImages: chance(0.2), hideName: chance(0.15), createdAt, isHidden: false })
  }
}
// 2 đánh giá vi phạm đã ẩn (OPS-08)
reviews.filter((r) => r.rating <= 2).slice(0, 2).forEach((r) => { r.isHidden = true; r.hiddenReason = "Chứa số điện thoại / ngôn từ không phù hợp"; r.comment += " (liên hệ 09xx...)" })

// ---------- Hội thoại CSKH ----------
const TOPICS = [
  ["Hỏi phí vận chuyển và thời gian giao", "VAN_CHUYEN"], ["Đơn hàng đang ở đâu", "DON_HANG"], ["Đổi nội dung khắc sau khi đặt", "CA_NHAN_HOA"], ["Đổi địa chỉ nhận hàng", "DON_HANG"],
  ["Mã giảm giá không áp dụng được", "VOUCHER"], ["Tư vấn quà sinh nhật bạn trai mê game", "TU_VAN"], ["Hỏi chính sách đổi trả hàng khắc tên", "DOI_TRA"], ["Hỏi đặt gấp giao trong ngày", "DAT_GAP"],
]
const conversations = []
const memberCustomers = customers.filter((c) => c.status === "HOAT_DONG")
const cskh = () => staff.filter((s) => s.staffRoles.some((r) => r === "BAN_HANG" || r === "VT_CHAM_SOC_KHACH_HANG"))
for (let i = 0; i < 260; i++) {
  const createdAt = new Date(START.getTime() + Math.pow(rnd(), 0.6) * (NOW - START))
  const guest = chance(0.35)
  const c = guest ? null : pick(memberCustomers.filter((x) => x.createdAt < createdAt).concat([minhAnh]))
  const [topic, label] = pick(TOPICS)
  const age = (NOW - createdAt) / D
  const botOnly = chance(0.45)
  let status = botOnly ? (age < 0.2 ? "BOT" : "DA_DONG") : age < 0.15 ? pick(["CHO_NHAN_VIEN", "DANG_HO_TRO"]) : "DA_DONG"
  const agent = botOnly ? null : pick(cskh().filter((s) => activeAt(s, createdAt)))
  conversations.push({ createdAt, customerId: c ? c.id : null, customerName: c ? c.fullName : `Khách ${int(1000, 9999)}`, type: c ? "Member" : "Guest", topic, label, status, handledBy: agent ? agent.fullName : "Sâu Béo (chatbot)", messages: botOnly ? int(2, 6) : int(5, 18), sentiment: weighted(["TICH_CUC", "TRUNG_TINH", "TIEU_CUC"], (s) => ({ TICH_CUC: 30, TRUNG_TINH: 58, TIEU_CUC: 12 })[s]) })
}
// Bảo đảm có việc cho màn CSKH lúc demo
const recentConv = [
  ["CHO_NHAN_VIEN", "Đổi nội dung khắc sau khi đặt", "CA_NHAN_HOA", minhAnh.fullName, "TRUNG_TINH"],
  ["CHO_NHAN_VIEN", "Hỏi đặt gấp giao trong ngày", "DAT_GAP", "Khách 5821", "TRUNG_TINH"],
  ["DANG_HO_TRO", "Đơn hàng đang ở đâu", "DON_HANG", quocBao.fullName, "TIEU_CUC"],
]
recentConv.forEach(([status, topic, label, name, sentiment], i) => conversations.push({ createdAt: new Date(NOW.getTime() - (i + 1) * 25 * 60000), customerId: name === minhAnh.fullName ? minhAnh.id : name === quocBao.fullName ? quocBao.id : null, customerName: name, type: name.startsWith("Khách") ? "Guest" : "Member", topic, label, status, handledBy: status === "DANG_HO_TRO" ? "Phan Ngọc Bảo Châu" : "", messages: int(3, 8), sentiment }))
conversations.sort((a, b) => a.createdAt - b.createdAt)

// ---------- Đơn nháp ----------
const drafts = []
for (let i = 1; i <= 18; i++) {
  const createdAt = i <= 12 ? new Date(START.getTime() + (i / 13) * (NOW - START)) : new Date(NOW.getTime() - int(1, 72) * H)
  const status = i <= 12 ? "HOAN_TAT" : pick(["MO", "DA_GUI_LINK"])
  const c = pick(customers.filter((x) => x.createdAt < createdAt))
  drafts.push({ code: `D${i}`, createdAt, customerName: c.fullName, source: pick(["ZALO", "FACEBOOK", "DIEN_THOAI", "EMAIL"]), status, createdBy: staffBy("BAN_HANG", createdAt).fullName, note: status === "HOAN_TAT" ? "Đã thành đơn" : status === "MO" ? "Đang soạn, chờ khách chốt mẫu khắc" : "Đã gửi liên kết thanh toán (hạn 24 giờ)" })
}
const urgentDrafts = [
  { code: "DAT_GAP", note: "Yêu cầu đặt gấp chờ shop chốt phụ phí (Guest, giao ngày mai)" },
  { code: "DAT_GAP", note: "Yêu cầu đặt gấp đã chốt, chờ khách thanh toán" },
]

// ---------- AI tư vấn ----------
const aiByMonth = {}
for (let day = new Date(START); day < NOW; day = new Date(day.getTime() + D)) {
  const n = poisson(dayRate(day) * 1.6)
  aiByMonth[monthKey(day)] = (aiByMonth[monthKey(day)] || 0) + n
}

// ---------- Tổng hợp ----------
for (const o of orders) {
  const c = customers.find((x) => x.id === o.customerId)
  if (o.orderStatus === "HOAN_THANH" || o.orderStatus === "DA_GIAO") c.spent += o.total - o.refundedAmount
  c.lastOrderAt = !c.lastOrderAt || o.createdAt > c.lastOrderAt ? o.createdAt : c.lastOrderAt
}
const soldBySku = {}
for (const o of orders) if (o.orderStatus !== "DA_HUY") for (const l of o.lines) soldBySku[l.sku] = (soldBySku[l.sku] || 0) + l.quantity
for (const p of products) {
  const rs = reviews.filter((r) => r.sku === p.sku && !r.isHidden)
  p.soldCount = soldBySku[p.sku] || 0
  p.ratingCount = rs.length
  p.ratingAvg = rs.length ? Math.round((rs.reduce((s, r) => s + r.rating, 0) / rs.length) * 10) / 10 : 0
}

// ---------- Dùng lại khi nạp (scripts/seed-dataset.js) ----------
module.exports = { START, NOW, staff, customers, products, extra, orders, returns, warranties, reviews, conversations, drafts, vouchers, aiByMonth, minhAnh, quocBao, dayRate, popularity, sellable, rnd, int, pick, chance, poisson }

// ---------- Ghi ra bản xem trước ----------
function writePreview(out) {
  const iso = (d) => (d ? fmt(d) : "")
  const result = {
    meta: { start: fmt(START), now: fmt(NOW), generatedAt: new Date().toISOString() },
    staff: staff.map((s) => ({ ...s, joinedAt: iso(s.joinedAt), leftAt: iso(s.leftAt) })),
    customers: customers.map((c) => ({ ...c, createdAt: iso(c.createdAt), lastOrderAt: iso(c.lastOrderAt), month: monthKey(c.createdAt), province: c.addresses[0].province, addresses: undefined })),
    products: products.map((p) => ({ ...p, createdAt: iso(p.createdAt), saleStartAt: iso(p.saleStartAt), saleEndAt: iso(p.saleEndAt), variantCount: p.variants.length, variants: undefined })),
    orders: orders.sort((a, b) => a.createdAt - b.createdAt).map((o) => ({
      ...o, month: monthKey(o.createdAt), createdAt: iso(o.createdAt), deliveredAt: iso(o.deliveredAt), completedAt: iso(o.completedAt), cancelledAt: iso(o.cancelledAt), storageDeadline: iso(o.storageDeadline), personalizationStartedAt: iso(o.personalizationStartedAt), codCollectedAt: iso(o.codCollectedAt),
      province: o.shipping.province, recipient: o.shipping.recipientName,
      itemsText: o.lines.map((l) => `${l.name}${l.variantName !== "Mặc định" ? ` (${l.variantName})` : ""} x${l.quantity}${l.personalization ? ` [${l.personalization}]` : ""}`).join("; "),
      voucherText: o.vouchers.map((v) => `${v.code} -${v.discount.toLocaleString("vi-VN")}đ`).join(", "),
      historyText: o.history.map((h) => `${fmt(h.at)} ${h.to} (${h.by})`).join(" > "),
      lastBy: o.history[o.history.length - 1].by, lines: undefined, shipping: undefined, history: undefined,
    })),
    orderLines: orders.flatMap((o) => o.lines.map((l) => ({ orderCode: o.code, month: o.month, orderStatus: o.orderStatus, ...l }))),
    returns: returns.map((r) => ({ ...r, createdAt: iso(r.createdAt) })),
    warranties: warranties.map((w) => ({ ...w, createdAt: iso(w.createdAt), warrantyUntil: iso(w.warrantyUntil) })),
    reviews: reviews.sort((a, b) => a.createdAt - b.createdAt).map((r) => ({ ...r, createdAt: iso(r.createdAt), likes: r.likes.join(", ") })),
    vouchers: vouchers.map((v) => ({ ...v, startAt: iso(v.startAt), endAt: iso(v.endAt), scopeCats: (v.scopeCats || []).join(", ") })),
    conversations: conversations.map((c) => ({ ...c, createdAt: iso(c.createdAt) })),
    drafts: drafts.map((d) => ({ ...d, createdAt: iso(d.createdAt) })),
    urgentDrafts,
    aiByMonth,
    catalog: {
      categories: require(path.join(SEED_DIR, "categories.json")),
      tagGroups: require(path.join(SEED_DIR, "tagGroups.json")),
      tags: require(path.join(SEED_DIR, "tags.json")),
      products: [...baseProducts.map((p) => ({ ...p, isNew: false })), ...extra.products.map((p) => ({ ...p, isNew: true }))],
      stickerSets: [...require(path.join(SEED_DIR, "stickerSets.json")).map((x) => ({ ...x, isNew: false })), ...extra.stickerSets.map((x) => ({ ...x, isNew: true }))],
      giftWrapMaterials: [...require(path.join(SEED_DIR, "giftWrapMaterials.json")).map((x) => ({ ...x, isNew: false })), ...extra.giftWrapMaterials.map((x) => ({ ...x, isNew: true }))],
      giftWrapTemplates: [...require(path.join(SEED_DIR, "giftWrapTemplates.json")).map((x) => ({ ...x, isNew: false })), ...extra.giftWrapTemplates.map((x) => ({ ...x, isNew: true }))],
      collections: [...require(path.join(SEED_DIR, "collections.json")).map((x) => ({ ...x, isNew: false })), ...extra.collections.map((x) => ({ ...x, isNew: true }))],
      soldByVariant: orders.filter((o) => o.orderStatus !== "DA_HUY").flatMap((o) => o.lines).reduce((m, l) => ((m[l.variantSku] = (m[l.variantSku] || 0) + l.quantity), m), {}),
      stickerUse: orders.flatMap((o) => o.lines).reduce((m, l) => {
        for (const c of (l.personalization || "").match(/[A-Z]{2,3}-[A-Z0-9]+/g) || []) m[c] = (m[c] || 0) + l.quantity
        return m
      }, {}),
    },
  }
  fs.mkdirSync(out, { recursive: true })
  fs.writeFileSync(path.join(out, "dataset.json"), JSON.stringify(result))
  const cnt = (a, f) => a.filter(f).length
  console.log(`Khách ${customers.length} | Đơn ${orders.length} (hủy ${cnt(orders, (o) => o.orderStatus === "DA_HUY")}, đang xử lý ${cnt(orders, (o) => !["HOAN_THANH", "DA_HUY"].includes(o.orderStatus))}) | Đánh giá ${reviews.length} | Đổi trả ${returns.length} | Bảo hành ${warranties.length} | Hội thoại ${conversations.length}`)
  console.log(`Doanh thu (đơn hoàn thành/đã giao): ${orders.filter((o) => ["HOAN_THANH", "DA_GIAO"].includes(o.orderStatus)).reduce((s, o) => s + o.total - o.refundedAmount, 0).toLocaleString("vi-VN")}đ`)
}

if (require.main === module) writePreview(process.argv[2] || ".")
