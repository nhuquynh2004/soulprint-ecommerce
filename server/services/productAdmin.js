// Xử lý dữ liệu sản phẩm phía quản trị (UC-CAT-01, BR-18, BR-19, BR-39, BR-41) - hàm thuần, không gọi CSDL,
// để viết unit test. Controller admin-product.controller.js dùng các hàm này rồi mới ghi MongoDB.
const params = require("../config/params")
const { removeAccents } = require("../utils/vnText")
const { sanitizeHtml } = require("../utils/sanitizeHtml")

const STATUSES = ["BAN_NHAP", "DANG_HIEN_THI", "DA_AN", "NGUNG_BAN"]
const AXES = ["THE_THAO", "ANIME", "GAME"]
const OUT_OF_STOCK = ["HIEN_TAM_HET", "AN_KHI_HET"]
const PERSONALIZE = ["IN_KHAC", "THIET_KE"]

// Vùng của form SCR-42 (để báo lỗi kèm số vùng, client nhảy tới đúng chỗ - UC-CAT-01 7Ea)
const AREA = {
  name: 1, sku: 1, slug: 1, brand: 1,
  price: 2, salePrice: 2, saleStartAt: 2, saleEndAt: 2, costPrice: 2, stock: 2,
  optionGroups: 3, variants: 3,
  images: 4,
  shortDescription: 5, description: 5,
  personalization: 7, // Vùng 6 Thông số, 7 Cá nhân hóa, 8 Gợi ý và tags
  specs: 6, warrantyMonths: 6, sizeChart: 6,
  tagIds: 8, ageMin: 8, ageMax: 8, aiEligible: 8,
  categoryId: 0, axis: 0, status: 0,
}

class ProductError extends Error {
  constructor(fields) {
    super(Object.values(fields)[0])
    this.fields = fields
  }
}

const str = (v, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "")
const intOrNull = (v) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Math.round(Number(v)) : NaN)
const dateOrNull = (v) => (v ? new Date(v) : null)

// "Áo đấu CLB" -> "ao-dau-clb"
function slugify(text) {
  return removeAccents(text)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
}

// "Xanh navy" -> "XANHNAVY" (mã giá trị dùng sinh SKU biến thể, 1-10 ký tự A-Z0-9)
function valueCode(value) {
  return removeAccents(value).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) || "X"
}

// Khóa tổ hợp của biến thể theo thứ tự nhóm: {"Màu sắc":"Đỏ đô","Size":"M"} -> "Đỏ đô|M"
const comboKey = (groups, attributes) => groups.map((g) => (attributes || {})[g.name] ?? "").join("|")

// Mọi tổ hợp giá trị không ẩn của các nhóm (BR-39). Không có nhóm thì 1 tổ hợp rỗng (biến thể "Mặc định").
function combinations(groups) {
  let list = [{}]
  for (const g of groups) {
    const values = g.values.filter((v) => !v.isHidden)
    list = list.flatMap((attrs) => values.map((v) => ({ ...attrs, [g.name]: v.value })))
  }
  return list
}

// BR-46: SKU sản phẩm <Trục>-<Mã danh mục>[-<Mã BST>]-<STT>. STT đánh tiếp theo cặp trục và danh mục,
// không phụ thuộc BST: lấy số lớn nhất trong các SKU đang có cùng tiền tố rồi cộng 1.
const AXIS_CODES = { THE_THAO: "TT", ANIME: "AN", GAME: "GM" }
function suggestSku({ axis, categoryCode, collectionCode = null, existingSkus = [] }) {
  const prefix = `${AXIS_CODES[axis]}-${categoryCode}`
  const re = new RegExp(`^${prefix}-(?:[A-Z0-9]{2,6}-)?([0-9]{3,})$`)
  const max = existingSkus.reduce((m, sku) => {
    const hit = re.exec(String(sku || "").toUpperCase())
    return hit ? Math.max(m, Number(hit[1])) : m
  }, 0)
  const next = max + 1
  return { prefix, next, sku: `${prefix}-${collectionCode ? collectionCode + "-" : ""}${String(next).padStart(3, "0")}` }
}

function variantSku(productSku, groups, attributes) {
  if (!productSku) return null
  const codes = groups.map((g) => g.values.find((v) => v.value === attributes[g.name])?.code).filter(Boolean)
  return codes.length ? `${productSku}-${codes.join("-")}` : productSku
}

// Chuẩn hóa nhóm biến thể; ném ProductError nếu sai BR-39
function normalizeGroups(input) {
  const errors = {}
  const groups = (Array.isArray(input) ? input : []).map((g, gi) => ({
    name: str(g && g.name, 30),
    sortOrder: gi + 1,
    hasImages: !!(g && g.hasImages),
    values: (Array.isArray(g && g.values) ? g.values : []).map((v, vi) => {
      const value = str(v && v.value, 30)
      const code = str(v && v.code, 10).toUpperCase() || valueCode(value)
      return {
        value,
        code,
        sortOrder: vi + 1,
        isHidden: !!(v && v.isHidden),
        ...(g && g.hasImages ? { images: (Array.isArray(v && v.images) ? v.images : []).filter((u) => typeof u === "string").slice(0, 10) } : {}),
      }
    }),
  }))
  if (groups.length > params.MAX_OPTION_GROUPS) errors.optionGroups = `Tối đa ${params.MAX_OPTION_GROUPS} nhóm biến thể`
  if (groups.filter((g) => g.hasImages).length > 1) errors.optionGroups = "Chỉ 1 nhóm được bật Gắn ảnh theo giá trị"
  const names = new Set()
  for (const g of groups) {
    if (!g.name) errors.optionGroups = "Tên nhóm biến thể không được trống"
    else if (names.has(g.name.toLowerCase())) errors.optionGroups = `Tên nhóm "${g.name}" bị trùng`
    names.add(g.name.toLowerCase())
    if (!g.values.length) errors.optionGroups = `Nhóm "${g.name}" cần ít nhất 1 giá trị`
    if (g.values.length > params.MAX_OPTION_VALUES) errors.optionGroups = `Tối đa ${params.MAX_OPTION_VALUES} giá trị mỗi nhóm`
    const values = new Set()
    const codes = new Set()
    for (const v of g.values) {
      if (!v.value) errors.optionGroups = `Giá trị của nhóm "${g.name}" không được trống`
      if (values.has(v.value.toLowerCase())) errors.optionGroups = `Giá trị "${v.value}" bị trùng trong nhóm "${g.name}"`
      if (!/^[A-Z0-9]{1,10}$/.test(v.code)) errors.optionGroups = `Mã giá trị "${v.code}" chỉ gồm A-Z, 0-9 (tối đa 10 ký tự)`
      if (codes.has(v.code)) errors.optionGroups = `Mã giá trị "${v.code}" bị trùng trong nhóm "${g.name}"`
      values.add(v.value.toLowerCase())
      codes.add(v.code)
    }
  }
  if (Object.keys(errors).length) throw new ProductError(errors)
  return groups
}

// Dựng lại danh sách biến thể khớp đủ tổ hợp (BR-39): giữ SKU, chênh giá, tồn của biến thể gửi lên/đã có
// theo tổ hợp; tổ hợp mới thì SKU tự sinh, tồn 0, chênh giá 0, đang bán. Biến thể của giá trị ẩn giữ lại ở trạng thái ngừng bán.
function buildVariants(groups, inputVariants, productSku, defaults = {}) {
  const errors = {}
  const given = new Map()
  for (const v of Array.isArray(inputVariants) ? inputVariants : []) given.set(comboKey(groups, v && v.attributes), v)

  const combos = combinations(groups)
  if (combos.length > params.MAX_VARIANTS) throw new ProductError({ variants: `Tối đa ${params.MAX_VARIANTS} biến thể mỗi sản phẩm` })

  const hiddenCombos = groups.length
    ? combinations(groups.map((g) => ({ ...g, values: g.values.map((v) => ({ ...v, isHidden: false })) }))).filter((a) =>
        groups.some((g) => g.values.find((v) => v.value === a[g.name])?.isHidden),
      )
    : []

  const make = (attributes, forcedInactive) => {
    const old = given.get(comboKey(groups, attributes)) || {}
    const priceDelta = intOrNull(old.priceDelta) ?? 0
    const stock = intOrNull(old.stock) ?? 0
    const lowStockThreshold = intOrNull(old.lowStockThreshold) ?? defaults.lowStockThreshold ?? 5
    if (!(priceDelta >= 0)) errors.variants = "Chênh giá biến thể không được âm"
    if (!(stock >= 0)) errors.variants = "Tồn kho không được âm"
    if (!(lowStockThreshold >= 0)) errors.variants = "Ngưỡng sắp hết không được âm"
    const sku = str(old.sku, 60).toUpperCase() || variantSku(productSku, groups, attributes)
    if (sku && !/^[A-Z0-9-]{2,60}$/.test(sku)) errors.variants = `SKU biến thể "${sku}" chỉ gồm A-Z, 0-9, dấu gạch`
    return {
      sku,
      name: groups.length ? groups.map((g) => attributes[g.name]).join(" / ") : "Mặc định",
      attributes,
      priceDelta,
      stock,
      lowStockThreshold,
      isActive: forcedInactive ? false : old.isActive !== false,
    }
  }
  const variants = [...combos.map((a) => make(a, false)), ...hiddenCombos.filter((a) => given.has(comboKey(groups, a))).map((a) => make(a, true))]
  const skus = variants.map((v) => v.sku).filter(Boolean)
  const dup = skus.find((s, i) => skus.indexOf(s) !== i)
  if (dup) errors.variants = `SKU biến thể "${dup}" bị trùng`
  if (Object.keys(errors).length) throw new ProductError(errors)
  return variants
}

// Kiểm tra và chuẩn hóa toàn bộ dữ liệu form sản phẩm. Bản nháp chỉ bắt buộc tên (UC-CAT-01 bước 5).
// Trả { doc, warnings }; ném ProductError({field: message}).
// opts.requireStock = false khi sửa sản phẩm đang hiển thị: bán hết hàng là bình thường, chỉ kiểm tồn lúc xuất bản.
function normalizeProduct(body, now = new Date(), opts = {}) {
  const e = {}
  const doc = {}
  doc.name = str(body.name, 120)
  if (doc.name.length < 2) e.name = "Tên sản phẩm cần 2-120 ký tự"
  doc.sku = str(body.sku, 40).toUpperCase() || null
  if (doc.sku && !/^[A-Z0-9-]{2,40}$/.test(doc.sku)) e.sku = "SKU chỉ gồm A-Z, 0-9 và dấu gạch (2-40 ký tự)"
  doc.slug = str(body.slug, 120).toLowerCase() || (doc.sku || body.status === "DANG_HIEN_THI" ? slugify(doc.name) : null) || null
  if (doc.slug && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(doc.slug)) e.slug = "Đường dẫn chỉ gồm chữ thường không dấu, số và dấu gạch"
  doc.brand = str(body.brand, 60)
  doc.shortDescription = str(body.shortDescription, 300)
  doc.description = sanitizeHtml(str(body.description, 20000))
  doc.status = STATUSES.includes(body.status) ? body.status : "BAN_NHAP"
  doc.categoryId = body.categoryId || null
  doc.axis = AXES.includes(body.axis) ? body.axis : null
  doc.isFeatured = !!body.isFeatured
  doc.aiEligible = body.aiEligible !== false // Mặc định cho Tư vấn AI gợi ý
  doc.featuredOrder = intOrNull(body.featuredOrder)
  doc.outOfStockBehavior = OUT_OF_STOCK.includes(body.outOfStockBehavior) ? body.outOfStockBehavior : "HIEN_TAM_HET"
  doc.images = (Array.isArray(body.images) ? body.images : []).filter((u) => typeof u === "string" && /^\/(api\/files|images)\//.test(u)).slice(0, 10)

  // Giá (BR-17 không liên quan; giá đã gồm VAT)
  doc.price = intOrNull(body.price)
  doc.salePrice = intOrNull(body.salePrice)
  doc.costPrice = intOrNull(body.costPrice)
  doc.saleStartAt = dateOrNull(body.saleStartAt)
  doc.saleEndAt = dateOrNull(body.saleEndAt)
  if (doc.price !== null && !(doc.price > 0)) e.price = "Giá bán phải lớn hơn 0"
  if (doc.salePrice !== null && !(doc.salePrice > 0 && doc.price !== null && doc.salePrice < doc.price)) e.salePrice = "Giá sale phải nhỏ hơn giá gốc"
  if (doc.costPrice !== null && !(doc.costPrice >= 0)) e.costPrice = "Giá vốn không được âm"
  if ((doc.saleStartAt && isNaN(doc.saleStartAt)) || (doc.saleEndAt && isNaN(doc.saleEndAt))) e.saleStartAt = "Thời gian sale không hợp lệ"
  else if (doc.saleStartAt && doc.saleEndAt && doc.saleEndAt <= doc.saleStartAt) e.saleEndAt = "Thời gian kết thúc sale phải sau thời gian bắt đầu"

  // Cá nhân hóa (BR-18, BR-19)
  const p = body.personalization || {}
  doc.personalization = { allowed: !!p.allowed, types: (Array.isArray(p.types) ? p.types : []).filter((t) => PERSONALIZE.includes(t)) }
  if (doc.personalization.allowed && !doc.personalization.types.length) e.personalization = "Chọn ít nhất 1 hình thức cá nhân hóa"
  if (doc.personalization.types.includes("IN_KHAC")) {
    const en = p.engrave || {}
    if (en.mode === "AO_DAU") {
      const t = intOrNull(en.topMaxChars) ?? params.ENGRAVE_JERSEY_DEFAULTS.topMaxChars
      const b = intOrNull(en.bottomMaxChars) ?? params.ENGRAVE_JERSEY_DEFAULTS.bottomMaxChars
      const n = intOrNull(en.numberMaxDigits) ?? params.ENGRAVE_JERSEY_DEFAULTS.numberMaxDigits
      if (!(t >= 1 && t <= 30 && b >= 1 && b <= 30)) e.personalization = "Giới hạn ký tự dòng trên, dòng dưới phải từ 1 đến 30"
      if (!(n >= 1 && n <= 3)) e.personalization = "Số chữ số của số áo phải từ 1 đến 3"
      doc.personalization.engrave = { mode: "AO_DAU", topMaxChars: t, bottomMaxChars: b, numberMaxDigits: n }
    } else {
      const m = intOrNull(en.maxChars) ?? params.ENGRAVE_MAX_CHARS
      if (!(m >= 1 && m <= 30)) e.personalization = "Giới hạn ký tự In/Khắc phải từ 1 đến 30"
      doc.personalization.engrave = { mode: "THUONG", maxChars: m }
    }
  }

  // Thông số, bảng size
  const s = body.specs || {}
  doc.specs = { material: str(s.material, 120), size: str(s.size, 120), weight: str(s.weight, 60), origin: str(s.origin, 60), care: str(s.care, 300) }
  doc.warrantyMonths = intOrNull(body.warrantyMonths) ?? 0
  if (![0, 6, 12].includes(doc.warrantyMonths)) e.warrantyMonths = "Bảo hành chỉ chọn 0, 6 hoặc 12 tháng"
  const sc = body.sizeChart
  if (sc && Array.isArray(sc.columns) && sc.columns.some((c) => str(c))) {
    const columns = sc.columns.map((c) => str(c, 40)).slice(0, 8)
    const rows = (Array.isArray(sc.rows) ? sc.rows : []).slice(0, 20).map((r) => columns.map((_, i) => str(Array.isArray(r) ? r[i] : "", 40)))
    doc.sizeChart = { columns, rows: rows.filter((r) => r.some(Boolean)), note: str(sc.note, 300) }
  } else doc.sizeChart = null

  // Tags, độ tuổi
  doc.tagIds = (Array.isArray(body.tagIds) ? body.tagIds : []).filter((t) => typeof t === "string")
  doc.ageMin = intOrNull(body.ageMin)
  doc.ageMax = intOrNull(body.ageMax)
  if ((doc.ageMin !== null && !(doc.ageMin >= 0 && doc.ageMin <= 99)) || (doc.ageMax !== null && !(doc.ageMax >= 0 && doc.ageMax <= 99))) e.ageMin = "Độ tuổi từ 0 đến 99"
  else if (doc.ageMin !== null && doc.ageMax !== null && doc.ageMin > doc.ageMax) e.ageMax = "Tuổi tối đa phải lớn hơn hoặc bằng tuổi tối thiểu"

  // Biến thể (BR-39)
  try {
    doc.optionGroups = normalizeGroups(body.optionGroups)
    doc.variants = buildVariants(doc.optionGroups, body.variants, doc.sku, { lowStockThreshold: intOrNull(body.lowStockThreshold) ?? undefined })
  } catch (err) {
    if (!(err instanceof ProductError)) throw err
    Object.assign(e, err.fields)
    doc.optionGroups = []
    doc.variants = []
  }

  if (Object.keys(e).length) throw new ProductError(e)

  // Xuất bản: đủ trường bắt buộc (UC-CAT-01 bước 7)
  if (doc.status === "DANG_HIEN_THI") {
    const missing = publishMissing(doc, opts)
    if (Object.keys(missing).length) throw new ProductError(missing)
  }

  // Cảnh báo không chặn: giá trị của nhóm gắn ảnh chưa có ảnh (BR-39, AC12)
  const warnings = []
  const imgGroup = doc.optionGroups.find((g) => g.hasImages)
  if (imgGroup) for (const v of imgGroup.values) if (!v.isHidden && !(v.images || []).length) warnings.push(`${v.value}: chưa có ảnh`)
  return { doc, warnings, now }
}

function publishMissing(doc, { requireStock = true } = {}) {
  const m = {}
  if (!doc.sku) m.sku = "Nhập SKU"
  if (!doc.slug) m.slug = "Nhập đường dẫn"
  if (!doc.categoryId) m.categoryId = "Chọn danh mục"
  if (!doc.axis) m.axis = "Chọn trục đam mê"
  if (!doc.images.length) m.images = "Thêm ít nhất 1 ảnh đại diện"
  if (!(doc.price > 0)) m.price = "Nhập giá bán"
  if (requireStock && !doc.variants.some((v) => v.isActive && v.stock > 0)) m.variants = "Cần ít nhất 1 biến thể đang bán có tồn kho"
  return m
}

// Danh sách trường thiếu kèm số vùng (để banner lỗi liệt kê "4: Hình ảnh")
function withAreas(fields) {
  return Object.entries(fields).map(([field, message]) => ({ field, message, area: AREA[field] ?? 0 }))
}

// Tổng tồn và tình trạng tồn của 1 sản phẩm (cột Tồn kho SCR-41)
function stockInfo(variants = []) {
  const active = variants.filter((v) => v.isActive !== false)
  const total = active.reduce((n, v) => n + (v.stock || 0), 0)
  const low = active.some((v) => (v.stock || 0) <= (v.lowStockThreshold ?? 5))
  return { totalStock: total, stockStatus: total === 0 ? "HET_HANG" : low ? "SAP_HET" : "CON_HANG" }
}

// Nhóm trường theo quyền cần có khi sửa (07 Mục 1.1, API-68, BR-34)
const PRICE_FIELDS = ["price", "salePrice", "saleStartAt", "saleEndAt", "costPrice"]

// So sánh sản phẩm cũ và mới (cả hai đã qua normalizeProduct để cùng dạng), trả tập mã quyền cần có.
// Kho chỉ đổi tồn/ngưỡng thì chỉ cần CAP_NHAT_TON.
function requiredPermissions(before, after) {
  const need = new Set()
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  const norm = (d) => (d instanceof Date ? d.toISOString() : d)
  for (const f of PRICE_FIELDS) if (!same(norm(before[f]), norm(after[f]))) need.add("SAN_PHAM.SUA_GIA")
  const content = ["name", "sku", "slug", "brand", "shortDescription", "description", "status", "categoryId", "axis", "isFeatured", "featuredOrder", "outOfStockBehavior", "images", "optionGroups", "personalization", "specs", "warrantyMonths", "sizeChart", "tagIds", "ageMin", "ageMax", "aiEligible"]
  for (const f of content) if (!same(before[f], after[f])) need.add("SAN_PHAM.SUA")
  const key = (v) => JSON.stringify(v.attributes || {})
  const oldMap = new Map((before.variants || []).map((v) => [key(v), v]))
  if ((before.variants || []).length !== (after.variants || []).length) need.add("SAN_PHAM.SUA")
  for (const v of after.variants || []) {
    const o = oldMap.get(key(v))
    if (!o) {
      need.add("SAN_PHAM.SUA")
      continue
    }
    if ((o.priceDelta || 0) !== (v.priceDelta || 0)) need.add("SAN_PHAM.SUA_GIA")
    if ((o.stock || 0) !== (v.stock || 0) || (o.lowStockThreshold ?? 5) !== (v.lowStockThreshold ?? 5)) need.add("SAN_PHAM.CAP_NHAT_TON")
    if (o.sku !== v.sku || (o.isActive !== false) !== (v.isActive !== false)) need.add("SAN_PHAM.SUA")
  }
  return need
}

module.exports = {
  ProductError, AREA, STATUSES, slugify, valueCode, combinations, normalizeGroups, buildVariants,
  normalizeProduct, publishMissing, withAreas, stockInfo, requiredPermissions, PRICE_FIELDS, AXIS_CODES, suggestSku,
}
