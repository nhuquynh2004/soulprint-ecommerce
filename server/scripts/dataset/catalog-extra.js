// Catalog bổ sung cho dataset 1,5 năm, cùng cấu trúc data/seed/*.json.
// 24 sản phẩm mới (8 mỗi trục), bộ sticker, vật liệu và mẫu gói quà, bộ sưu tập.
// Gói Giáng sinh 2026 (BST, bộ sticker, mẫu gói quà, 3 sản phẩm Noel) cố ý không có ở đây để kịch bản kiểm thử
// cho nhân viên tự đưa lên. Vật liệu giấy đỏ Noel, thiệp Giáng sinh vẫn có sẵn trong kho.
// Viết gọn bằng đặc tả rồi mở rộng thành document seed ở cuối file.

const slugify = (s) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

const SIZE_AO = {
  columns: ["Size", "Ngực (cm)", "Dài áo (cm)", "Cân nặng gợi ý (kg)"],
  rows: [["M", "96-100", "70", "55-65"], ["L", "100-104", "72", "65-75"], ["XL", "104-108", "74", "75-85"]],
  note: "Đo vòng ngực ở chỗ rộng nhất. Nếu số đo nằm giữa hai size, chọn size lớn hơn.",
}
const SIZE_KHOAC = {
  columns: ["Size", "Ngực (cm)", "Dài áo (cm)", "Dài tay (cm)"],
  rows: [["M", "104", "68", "60"], ["L", "110", "70", "62"], ["XL", "116", "72", "64"]],
  note: "Áo khoác form rộng, mặc ngoài áo thun vừa vặn. Thích ôm người thì giảm 1 size.",
}
const THUONG = (maxChars = 20) => ({ allowed: true, types: ["IN_KHAC"], engrave: { mode: "THUONG", maxChars } })
const THIET_KE = { allowed: true, types: ["THIET_KE"] }
const CA_HAI = (maxChars = 20) => ({ allowed: true, types: ["IN_KHAC", "THIET_KE"], engrave: { mode: "THUONG", maxChars } })
const KHONG = { allowed: false, types: [] }

// groups: [{name, hasImages, values: [[value, code, priceDelta?]]}]; stock: mảng theo thứ tự tổ hợp biến thể
const SPECS = [
  // ----- Thể thao -----
  { sku: "TT-DNC-002", name: "Áo khoác gió chạy bộ in tên", cat: "diem-nhan-ca-nhan", axis: "THE_THAO", price: 520000, launched: "2025-08-15", warranty: 0,
    pers: THUONG(), material: "Vải dù chống nước nhẹ", sizeChart: SIZE_KHOAC, age: [16, 40],
    groups: [{ name: "Màu sắc", hasImages: true, values: [["Đen", "DEN"], ["Xanh rêu", "XANHREU"]] }, { name: "Size", values: [["M", "M"], ["L", "L"], ["XL", "XL", 20000]] }],
    stock: [8, 10, 4, 6, 7, 0], tags: ["sinh-nhat", "chay-bo", "nang-dong", "ban-trai", "chong", "mang-theo-hang-ngay"],
    short: "Áo gió in tên sau lưng cho chàng mê chạy bộ" },
  { sku: "TT-VBL-GGY-003", name: "Túi trống tập gym có ngăn giày", cat: "vat-bat-ly-than", axis: "THE_THAO", price: 450000, launched: "2025-08-15", warranty: 12,
    pers: THUONG(), material: "Vải Oxford 600D", age: [16, 40],
    groups: [{ name: "Màu sắc", hasImages: true, values: [["Đen", "DEN"], ["Xám", "XAM"]] }],
    stock: [14, 9], tags: ["sinh-nhat", "gym", "thuc-te", "ban-trai", "chong", "mang-theo-hang-ngay"],
    short: "Túi trống 35L, ngăn giày riêng, khắc tên trên quai" },
  { sku: "TT-TBN-002", name: "Ly thủy tinh khắc logo đội bóng", cat: "tram-bu-nuoc", axis: "THE_THAO", price: 220000, launched: "2025-12-01", warranty: 0,
    pers: THUONG(), material: "Thủy tinh cường lực", age: [18, 40],
    groups: [{ name: "Dung tích", values: [["350ml", "350"], ["500ml", "500", 30000]] }],
    stock: [30, 18], tags: ["ngay-cua-cha", "ky-niem", "bong-da", "co-dien", "ba", "sep", "ban-be"],
    short: "Ly bia khắc logo và tên, hợp tặng ba, tặng sếp" },
  { sku: "TT-KGC-002", name: "Đèn ngủ sân vận động mini", cat: "khong-gian-chill", axis: "THE_THAO", price: 390000, launched: "2025-12-01", warranty: 6,
    pers: KHONG, material: "Nhựa ABS, đèn LED", age: [8, 35], groups: [], stock: [11],
    tags: ["sinh-nhat", "giang-sinh", "bong-da", "huong-noi", "anh-em-trai", "trang-tri"],
    short: "Mô hình sân bóng phát sáng, 3 chế độ đèn" },
  { sku: "TT-KGC-003", name: "Khung ảnh cầu thủ in chữ ký", cat: "khong-gian-chill", axis: "THE_THAO", price: 330000, launched: "2026-05-20", warranty: 0,
    pers: THIET_KE, material: "Giấy ảnh, khung gỗ thông", age: [10, 40],
    groups: [{ name: "Kích thước", values: [["A4", "A4"], ["A3", "A3", 60000]] }],
    stock: [16, 8], tags: ["sinh-nhat", "bong-da", "ca-tinh", "ban-trai", "anh-em-trai", "trang-tri", "suu-tam"],
    short: "Khung ảnh in chữ ký cầu thủ, thêm sticker tùy ý" },
  { sku: "TT-TBN-GGY-003", name: "Bình lắc protein 700ml khắc tên", cat: "tram-bu-nuoc", axis: "THE_THAO", price: 160000, launched: "2026-05-20", warranty: 0,
    pers: THUONG(), material: "Nhựa Tritan không BPA", age: [16, 40],
    groups: [{ name: "Màu sắc", hasImages: true, values: [["Đen", "DEN"], ["Trắng", "TRANG"], ["Xanh ngọc", "XANHNGOC"]] }],
    stock: [25, 20, 3], tags: ["gym", "thuc-te", "ban-trai", "ban-be", "mang-theo-hang-ngay"],
    short: "Bình lắc có lò xo trộn, khắc tên trên thân" },
  { sku: "TT-DNC-003", name: "Bộ băng đô và băng cổ tay thể thao", cat: "diem-nhan-ca-nhan", axis: "THE_THAO", price: 120000, launched: "2026-10-05", warranty: 0,
    pers: KHONG, material: "Cotton co giãn", age: [12, 35],
    groups: [{ name: "Màu sắc", values: [["Trắng", "TRANG"], ["Đen", "DEN"], ["Đỏ", "DO"]] }],
    stock: [40, 35, 30], tags: ["khai-giang", "bong-ro", "nang-dong", "ban-be", "anh-em-trai"],
    short: "Bộ 3 món thấm mồ hôi cho bóng rổ, tennis" },
  { sku: "TT-GBX-GGY-002", name: "Hộp quà gym (bình lắc, khăn, dây kháng lực)", cat: "giftbox", axis: "THE_THAO", price: 690000, salePrice: 619000, launched: "2026-10-05", warranty: 0,
    pers: THIET_KE, material: "Nhiều chất liệu", age: [16, 40], groups: [], stock: [10], featured: 5,
    tags: ["sinh-nhat", "valentine", "gym", "nang-dong", "ban-trai", "chong"],
    short: "Combo 3 món cho chàng chăm tập, trang trí sticker" },
  // ----- Anime -----
  { sku: "AN-TBN-002", name: "Bình giữ nhiệt in nhân vật anime", cat: "tram-bu-nuoc", axis: "ANIME", price: 280000, launched: "2025-08-15", warranty: 6,
    pers: THUONG(), material: "Inox 304", age: [10, 35],
    groups: [{ name: "Mẫu", hasImages: true, values: [["Ninja", "NINJA"], ["Hải tặc", "HAITAC"], ["Pháp sư", "PHAPSU"]] }],
    stock: [18, 15, 12], tags: ["khai-giang", "sinh-nhat", "anime-manga", "thuc-te", "ban-be", "giu-nhiet"],
    short: "Bình 500ml giữ nhiệt 12 giờ, in nhân vật và tên" },
  { sku: "AN-KGC-003", name: "Tranh canvas phong cảnh hoạt hình Nhật", cat: "khong-gian-chill", axis: "ANIME", price: 450000, launched: "2025-08-15", warranty: 0,
    pers: KHONG, material: "Vải canvas, khung gỗ", age: [14, 40],
    groups: [{ name: "Kích thước", values: [["40x60cm", "4060"], ["60x90cm", "6090", 200000]] }],
    stock: [9, 4], tags: ["anime-manga", "toi-gian", "huong-noi", "ban-trai", "trang-tri"],
    short: "Tranh phong cảnh tông màu dịu cho góc phòng" },
  { sku: "AN-VBL-003", name: "Móc khóa acrylic nhân vật in tên", cat: "vat-bat-ly-than", axis: "ANIME", price: 90000, launched: "2025-12-01", warranty: 0,
    pers: THUONG(), material: "Acrylic 3mm", age: [8, 30],
    groups: [{ name: "Mẫu", hasImages: true, values: [["Mèo chibi", "MEO"], ["Ninja", "NINJA"], ["Robot", "ROBOT"], ["Pháp sư", "PHAPSU"]] }],
    stock: [60, 45, 30, 0], tags: ["quoc-te-thieu-nhi", "khai-giang", "anime-manga", "hai-huoc", "ban-be", "mang-theo-hang-ngay"],
    short: "Móc khóa 2 mặt, in tên dưới chân nhân vật" },
  { sku: "AN-MMN-004", name: "Kiếm gỗ trang trí có giá đỡ khắc tên", cat: "me-man", axis: "ANIME", price: 750000, launched: "2025-12-01", warranty: 0,
    pers: THUONG(), material: "Gỗ sồi, giá đỡ gỗ óc chó", age: [16, 40], groups: [], stock: [5],
    tags: ["sinh-nhat", "ky-niem", "anime-manga", "suu-tam-mo-hinh", "ca-tinh", "ban-trai", "suu-tam"],
    short: "Kiếm gỗ 100cm trưng bày, khắc tên trên giá đỡ" },
  { sku: "AN-VBL-004", name: "Ví da khắc tên họa tiết manga", cat: "vat-bat-ly-than", axis: "ANIME", price: 320000, launched: "2026-05-20", warranty: 6,
    pers: THUONG(), material: "Da bò thật", age: [16, 40],
    groups: [{ name: "Màu sắc", hasImages: true, values: [["Nâu", "NAU"], ["Đen", "DEN"]] }],
    stock: [12, 15], tags: ["ngay-cua-cha", "tot-nghiep", "anime-manga", "co-dien", "ba", "chong", "mang-theo-hang-ngay"],
    short: "Ví gập đôi, họa tiết manga dập chìm, khắc tên" },
  { sku: "AN-KGC-004", name: "Gối ôm nhân vật chibi", cat: "khong-gian-chill", axis: "ANIME", price: 260000, launched: "2026-05-20", warranty: 0,
    pers: THIET_KE, material: "Vải nhung, bông gòn", age: [6, 30],
    groups: [{ name: "Kích thước", values: [["50cm", "50"], ["80cm", "80", 90000]] }],
    stock: [20, 10], tags: ["sinh-nhat", "quoc-te-thieu-nhi", "anime-manga", "hai-huoc", "anh-em-trai", "trang-tri"],
    short: "Gối mềm hình nhân vật, đính sticker vải theo ý" },
  { sku: "AN-DNC-004", name: "Áo khoác bomber thêu hình", cat: "diem-nhan-ca-nhan", axis: "ANIME", price: 620000, launched: "2026-10-05", warranty: 0,
    pers: KHONG, material: "Vải gió lót dù", sizeChart: SIZE_KHOAC, age: [14, 35],
    groups: [{ name: "Size", values: [["M", "M"], ["L", "L"], ["XL", "XL"]] }],
    stock: [0, 0, 0], tags: ["giang-sinh", "anime-manga", "ca-tinh", "ban-trai"],
    short: "Bomber thêu rồng sau lưng (đang soạn, chưa bán)" },
  { sku: "AN-GBX-002", name: "Hộp quà lễ hội anime (đèn, sổ, sticker)", cat: "giftbox", axis: "ANIME", price: 850000, launched: "2026-10-05", warranty: 0,
    pers: THIET_KE, material: "Nhiều chất liệu", age: [12, 35], groups: [], stock: [8], featured: 6,
    tags: ["giang-sinh", "sinh-nhat", "anime-manga", "sang-tao", "ban-trai", "anh-em-trai"],
    short: "Đèn ngủ, sổ tay và bộ sticker trong hộp quà lễ hội" },
  // ----- Game -----
  { sku: "GM-KGC-007", name: "Ghế gaming công thái học", cat: "khong-gian-chill", axis: "GAME", price: 3290000, salePrice: 2990000, launched: "2025-08-15", warranty: 12,
    pers: KHONG, material: "Da PU, khung thép, piston class 4", age: [16, 40],
    groups: [{ name: "Màu sắc", hasImages: true, values: [["Đen đỏ", "DENDO"], ["Đen trắng", "DENTRANG"]] }],
    stock: [3, 2], tags: ["tot-nghiep", "game-pc", "esports", "cong-nghe", "chong", "lam-viec"],
    short: "Ghế tựa lưng ngả 160 độ, gối cổ và gối lưng" },
  { sku: "GM-TBN-VAL26-001", name: "Ly giữ nhiệt hình tay cầm khắc tên", cat: "tram-bu-nuoc", axis: "GAME", price: 240000, launched: "2025-08-15", warranty: 0,
    pers: THUONG(), material: "Inox 304, vỏ nhựa", age: [10, 35],
    groups: [{ name: "Màu sắc", hasImages: true, values: [["Đen", "DEN"], ["Trắng", "TRANG"]] }],
    stock: [22, 18], tags: ["sinh-nhat", "game-pc", "game-mobile", "hai-huoc", "ban-be", "giu-nhiet"],
    short: "Ly 400ml tay cầm hình gamepad, khắc tên" },
  { sku: "GM-DNC-001", name: "Áo thun game thủ in nickname", cat: "diem-nhan-ca-nhan", axis: "GAME", price: 260000, launched: "2025-12-01", warranty: 0,
    pers: CA_HAI(), material: "Cotton 100%", sizeChart: SIZE_AO, age: [12, 35],
    groups: [{ name: "Màu sắc", hasImages: true, values: [["Đen", "DEN"], ["Trắng", "TRANG"]] }, { name: "Size", values: [["M", "M"], ["L", "L"], ["XL", "XL", 15000]] }],
    stock: [15, 18, 6, 12, 10, 5], tags: ["sinh-nhat", "khai-giang", "game-pc", "esports", "ca-tinh", "ban-trai", "anh-em-trai"],
    short: "In nickname in-game, thêm sticker game tùy chọn" },
  { sku: "GM-VBL-005", name: "Đế sạc tay cầm 2 cổng", cat: "vat-bat-ly-than", axis: "GAME", price: 350000, launched: "2025-12-01", warranty: 6,
    pers: KHONG, material: "Nhựa ABS", age: [10, 40], groups: [], stock: [0],
    tags: ["giang-sinh", "game-pc", "cong-nghe", "anh-em-trai"],
    short: "Sạc 2 tay cầm cùng lúc (ngừng bán từ 01/08/2026)" },
  { sku: "GM-MMN-002", name: "Mô hình nhân vật game 25cm", cat: "me-man", axis: "GAME", price: 980000, launched: "2026-05-20", warranty: 0,
    pers: KHONG, material: "Nhựa PVC", age: [12, 40],
    groups: [{ name: "Nhân vật", hasImages: true, values: [["Hiệp sĩ", "HIEPSI"], ["Xạ thủ", "XATHU"]] }],
    stock: [4, 6], tags: ["sinh-nhat", "game-pc", "suu-tam-mo-hinh", "huong-noi", "ban-trai", "suu-tam"],
    short: "Mô hình sơn tay, đế có tên nhân vật" },
  { sku: "GM-KGC-008", name: "Đèn neon tên riêng treo tường", cat: "khong-gian-chill", axis: "GAME", price: 650000, launched: "2026-05-20", warranty: 6,
    pers: THUONG(), material: "Ống LED neon silicone, tấm acrylic", age: [14, 40],
    groups: [{ name: "Màu đèn", values: [["Xanh dương", "XANH"], ["Hồng", "HONG"], ["Tím", "TIM"]] }],
    stock: [10, 8, 8], tags: ["sinh-nhat", "game-pc", "esports", "sang-tao", "ca-tinh", "ban-trai", "trang-tri"],
    short: "Uốn đèn neon theo tên hoặc nickname, tối đa 10 ký tự" },
  { sku: "GM-VBL-006", name: "Balo laptop gaming 17 inch thêu tên", cat: "vat-bat-ly-than", axis: "GAME", price: 790000, launched: "2026-10-05", warranty: 12,
    pers: THUONG(), material: "Vải Cordura, đệm chống sốc", age: [14, 40], groups: [], stock: [12],
    tags: ["khai-giang", "tot-nghiep", "game-pc", "cong-nghe", "thuc-te", "ban-trai", "mang-theo-hang-ngay", "lam-viec"],
    short: "Balo có cổng USB, ngăn laptop 17 inch, thêu tên" },
  { sku: "GM-GBX-002", name: "Hộp quà streamer (đèn, micro kẹp, lót chuột)", cat: "giftbox", axis: "GAME", price: 1290000, launched: "2026-10-05", warranty: 6,
    pers: THIET_KE, material: "Nhiều chất liệu", age: [14, 35], groups: [], stock: [6], featured: 7,
    tags: ["sinh-nhat", "giang-sinh", "game-pc", "esports", "cong-nghe", "ban-trai"],
    short: "Bộ khởi nghiệp streamer: đèn ring, micro kẹp áo, lót chuột" },
]

// Tổ hợp biến thể theo thứ tự nhóm (BR-39)
function combos(groups) {
  return groups.reduce((acc, g) => acc.flatMap((a) => g.values.map((v) => [...a, [g.name, v]])), [[]])
}

const products = SPECS.map((s) => {
  const lower = s.sku.toLowerCase()
  const variants = (s.groups.length ? combos(s.groups) : [[]]).map((c, i) => ({
    sku: c.length ? `${s.sku}-${c.map(([, v]) => v[1]).join("-")}` : `${s.sku}-1`,
    name: c.length ? c.map(([, v]) => v[0]).join(" / ") : "Mặc định",
    attributes: Object.fromEntries(c.map(([g, v]) => [g, v[0]])),
    priceDelta: c.reduce((sum, [, v]) => sum + (v[2] || 0), 0),
    stock: s.stock[i] ?? 0,
    lowStockThreshold: 5,
    isActive: true,
  }))
  return {
    sku: s.sku, name: s.name, slug: slugify(s.name), shortDescription: s.short,
    description: `<p>${s.name}. ${s.short}.</p><ul><li>Chất liệu: ${s.material}</li><li>Đóng gói hộp cứng, kèm thiệp Soulprint</li></ul>`,
    ...(s.sizeChart ? { sizeChart: s.sizeChart } : {}),
    brand: "Soulprint", categorySlug: s.cat, axis: s.axis,
    status: s.sku === "AN-DNC-004" ? "BAN_NHAP" : s.sku === "GM-VBL-005" ? "NGUNG_BAN" : "DANG_HIEN_THI",
    images: [`/images/products/${lower}-1.svg`, `/images/products/${lower}-2.svg`],
    price: s.price, salePrice: s.salePrice || null,
    saleStartAt: s.salePrice ? "2026-10-05T00:00:00+07:00" : null, saleEndAt: s.salePrice ? "2026-11-30T23:59:59+07:00" : null,
    costPrice: Math.round((s.price * (s.cat === "giftbox" ? 0.55 : 0.48)) / 1000) * 1000,
    variants, personalization: s.pers,
    specs: { material: s.material, origin: "Việt Nam" },
    warrantyMonths: s.warranty, outOfStockBehavior: "HIEN_TAM_HET",
    tagSlugs: s.tags, ageMin: s.age[0], ageMax: s.age[1],
    soldCount: 0, viewCount: 0, ratingAvg: 0, ratingCount: 0, hasOrders: false,
    isFeatured: !!s.featured, featuredOrder: s.featured || null, aiEligible: s.sku !== "GM-KGC-007",
    optionGroups: s.groups.map((g, gi) => ({
      name: g.name, sortOrder: gi + 1, hasImages: !!g.hasImages,
      values: g.values.map((v, vi) => ({ value: v[0], code: v[1], ...(g.hasImages ? { images: [`/images/products/${lower}-${v[1].toLowerCase()}.svg`] } : {}), sortOrder: vi + 1 })),
    })),
    launchedAt: `${s.launched}T09:00:00+07:00`, // chỉ dùng khi nạp để đặt createdAt
  }
})

// ----- Sticker -----
const sticker = (code, name, i) => ({ code, name, image: `/images/stickers/${code.toLowerCase()}.svg`, isActive: true, sortOrder: i + 1 })
const stickerSets = [
  { name: "Phòng gym", kind: "THUONG", seasonLabel: null, collectionSlug: "goc-gym-cua-anh", badge: "MOI", categorySlugs: [], axes: ["THE_THAO"], startAt: null, endAt: null,
    stickers: [["TT-TA", "Quả tạ"], ["TT-LUA", "Ngọn lửa"], ["TT-NHIPTIM", "Nhịp tim"]].map(([c, n], i) => sticker(c, n, i)), sortOrder: 5, isActive: true },
  { name: "Valentine 2026", kind: "BST_MUA", seasonLabel: "Valentine 2026", collectionSlug: "valentine-2026", badge: "HOT", categorySlugs: [], axes: [],
    startAt: "2026-02-01T00:00:00+07:00", endAt: "2026-02-15T23:59:59+07:00",
    stickers: [["VAL-TIM", "Trái tim"], ["VAL-THU", "Lá thư tình"], ["VAL-HONG", "Hoa hồng"]].map(([c, n], i) => sticker(c, n, i)), sortOrder: 6, isActive: true },
]

// ----- Gói quà -----
const mat = (kind, code, name, description, unit, stock, avgCost, i) => ({ kind, code, name, description, unit, image: `/images/giftwrap/materials/${code.toLowerCase()}.svg`, sortOrder: 10 + i, isActive: true, stock, lowStockThreshold: 10, avgCost })
const giftWrapMaterials = [
  mat("GIAY_GOI", "HONG-PASTEL", "Giấy hồng pastel", "Ngọt ngào cho Valentine, kỷ niệm", "tờ", 6, 4500, 1),
  mat("GIAY_GOI", "DO-NOEL", "Giấy đỏ Noel", "Đỏ ấm, họa tiết bông tuyết", "tờ", 80, 4500, 2),
  mat("RUY_BANG", "RUY-DO", "Ruy băng đỏ nhung", "Nhung mềm, nơ to", "cuộn", 40, 9000, 3),
  mat("THIEP", "THIEP-TIM", "Thiệp trái tim", "Thiệp gập hình trái tim", "cái", 0, 3000, 4),
  mat("THIEP", "THIEP-NOEL", "Thiệp Giáng sinh", "Thiệp cây thông nổi 3D", "cái", 60, 3500, 5),
]
const tmpl = (code, name, description, paper, ribbon, card, extra) => ({ code, name, description, image: `/images/giftwrap/${slugify(name)}.svg`, paper, ribbon, card, ...extra })
const giftWrapTemplates = [
  tmpl("GQ-MUA-02", "Valentine ngọt ngào", "Hồng pastel, nơ đỏ, thiệp tim", { code: "HONG-PASTEL", name: "Giấy hồng pastel" }, { code: "RUY-DO", name: "Ruy băng đỏ nhung" }, { code: "THIEP-TIM", name: "Thiệp trái tim" },
    { kind: "BST_MUA", seasonLabel: "Valentine 2026", collectionSlug: "valentine-2026", badge: "HOT", startAt: "2026-02-01T00:00:00+07:00", endAt: "2026-02-15T23:59:59+07:00", sortOrder: 6, isActive: true }),
  tmpl("GQ-TH-05", "Lịch lãm tặng ba", "Kraft nâu, ruy băng đen, thiệp trơn", { code: "KRAFT", name: "Giấy kraft nâu" }, { code: "RUY-DEN", name: "Ruy băng đen" }, { code: "THIEP-TRON", name: "Thiệp trơn" },
    { kind: "THUONG", seasonLabel: null, collectionSlug: null, badge: null, startAt: null, endAt: null, sortOrder: 8, isActive: true }),
]

// ----- Bộ sưu tập -----
const collections = [
  { name: "Góc gym của anh", slug: "goc-gym-cua-anh", code: "GGY", description: "Đồ tập và phụ kiện cho chàng chăm chỉ đến phòng gym", coverImage: "/images/collections/goc-gym.svg",
    type: "THU_CONG", productSkus: ["TT-GBX-GGY-002", "TT-VBL-GGY-003", "TT-TBN-GGY-003", "TT-MMN-GGY-004", "TT-MMN-GGY-006", "TT-KGC-GGY-001"], matchMode: null, rules: [], sortBy: "THU_CONG",
    startAt: "2026-05-20T00:00:00+07:00", endAt: null, status: "HIEN_THI", showOnHome: true, sortOrder: 3 },
  { name: "Setup bàn game", slug: "setup-ban-game", description: "Đèn, ghế, lót chuột cho góc chơi game thật chất", coverImage: "/images/collections/setup-ban-game.svg",
    type: "TU_DONG", productSkus: [], matchMode: "ALL", rules: [{ field: "AXIS", operator: "EQ", value: "GAME" }, { field: "CATEGORY", operator: "EQ", value: "khong-gian-chill" }], sortBy: "LIEN_QUAN",
    startAt: "2025-12-01T00:00:00+07:00", endAt: null, status: "HIEN_THI", showOnHome: false, sortOrder: 4 },
  { name: "Hàng mới về", slug: "hang-moi-ve", description: "Sản phẩm lên kệ trong 30 ngày gần đây", coverImage: "/images/collections/hang-moi-ve.svg",
    type: "TU_DONG", productSkus: [], matchMode: "ALL", rules: [{ field: "CREATED_WITHIN_DAYS", operator: "LT", value: 30 }], sortBy: "MOI_NHAT",
    startAt: null, endAt: null, status: "HIEN_THI", showOnHome: false, sortOrder: 5 },
  { name: "Valentine 2026", slug: "valentine-2026", code: "VAL26", description: "Quà Valentine cho anh ấy, kèm sticker và gói quà mùa yêu", coverImage: "/images/collections/valentine-2026.svg",
    type: "THU_CONG", productSkus: ["TT-GBX-SNBD-001", "AN-GBX-VAL26-001", "GM-GBX-VAL26-001", "AN-TBN-VAL26-001", "AN-KGC-VAL26-002", "GM-TBN-VAL26-001"], matchMode: null, rules: [], sortBy: "THU_CONG",
    startAt: "2026-02-01T00:00:00+07:00", endAt: "2026-02-15T23:59:59+07:00", status: "HIEN_THI", showOnHome: false, sortOrder: 6 },
  { name: "Quà Ngày của Cha 2026", slug: "qua-ngay-cua-cha-2026", description: "Ly khắc tên, ví da, đồng hồ cho ba", coverImage: "/images/collections/ngay-cua-cha.svg",
    type: "TU_DONG", productSkus: [], matchMode: "ANY", rules: [{ field: "TAG", operator: "EQ", value: "ngay-cua-cha" }, { field: "TAG", operator: "EQ", value: "ba" }], sortBy: "BAN_CHAY",
    startAt: "2026-06-01T00:00:00+07:00", endAt: "2026-06-21T23:59:59+07:00", status: "HIEN_THI", showOnHome: false, sortOrder: 7 },
]

module.exports = { products, stickerSets, giftWrapMaterials, giftWrapTemplates, collections }
