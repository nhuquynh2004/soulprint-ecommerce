// Cá nhân hóa của một dòng giỏ / thiết kế đã lưu (BR-18, BR-19, BR-20, BR-33).
// Viết một lần ở đây để thêm giỏ (API-32), sửa dòng giỏ (API-33), lưu thiết kế (API-15) và đọc giỏ (API-31)
// kiểm tra giống nhau, tính phí giống nhau.
const params = require("../config/params")
const HttpError = require("../utils/httpError")

// Đếm theo ký tự hiển thị sau khi bỏ khoảng trắng đầu/cuối (BR-18): chuẩn hóa NFC để "ế" gõ tổ hợp vẫn tính 1 ký tự
const clean = (v) => (typeof v === "string" ? v.normalize("NFC").trim() : "")
const charCount = (s) => Array.from(s).length

const ruleError = (rule, message, field) => new HttpError(422, "BUSINESS_RULE", message, { rule, ...(field ? { fields: { [field]: message } } : {}) })

// Cấu hình In/Khắc của sản phẩm, điền mặc định khi Admin bỏ trống (02 Mục 5)
function engraveConfig(product) {
  const e = (product.personalization && product.personalization.engrave) || {}
  if (e.mode === "AO_DAU") {
    const d = params.ENGRAVE_JERSEY_DEFAULTS
    return {
      mode: "AO_DAU",
      topMaxChars: e.topMaxChars || d.topMaxChars,
      bottomMaxChars: e.bottomMaxChars || d.bottomMaxChars,
      numberMaxDigits: e.numberMaxDigits || d.numberMaxDigits,
    }
  }
  return { mode: "THUONG", maxChars: e.maxChars || params.ENGRAVE_MAX_CHARS }
}

const allowedTypes = (product) =>
  product.personalization && product.personalization.allowed ? product.personalization.types || [] : []

// Bộ sticker đang hiển thị (BR-33): bộ BST_MUA chỉ trong thời gian hiển thị
const setLive = (s, now) => s.isActive !== false && (s.kind !== "BST_MUA" || ((!s.startAt || s.startAt <= now) && (!s.endAt || s.endAt >= now)))

// Bộ hợp với sản phẩm: cả danh mục lẫn trục để trống = mọi sản phẩm; có thì khớp danh mục HOẶC trục (06 Mục 2.10)
function setMatches(s, product) {
  const cats = s.categoryIds || []
  const axes = s.axes || []
  if (!cats.length && !axes.length) return true
  return cats.some((id) => product.categoryId && id.equals(product.categoryId)) || axes.includes(product.axis)
}

// Bộ sticker áp dụng cho sản phẩm cho phép Thiết kế, bộ BST_MUA xếp trước (BR-19, BR-33). allSets truyền vào
// khi cần xét nhiều sản phẩm một lúc (đọc giỏ) để không truy vấn lặp.
async function stickerSetsFor(product, now = new Date(), allSets = null) {
  if (!allowedTypes(product).includes("THIET_KE")) return []
  // Nạp CSDL khi cần để unit test các hàm kiểm tra không phải kết nối MongoDB
  const sets = allSets || (await require("../config/db").database.collection("stickerSets").find({ isActive: true }).toArray())
  return sets
    .filter((s) => setLive(s, now) && setMatches(s, product))
    .sort((a, b) => (a.kind === "BST_MUA" ? 0 : 1) - (b.kind === "BST_MUA" ? 0 : 1) || (a.sortOrder || 0) - (b.sortOrder || 0))
    .map((s) => ({
      _id: s._id,
      name: s.name,
      kind: s.kind,
      seasonLabel: s.seasonLabel || null,
      badge: s.badge || null,
      stickers: (s.stickers || [])
        .filter((x) => x.isActive !== false)
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
        .map(({ code, name, image }) => ({ code, name, image })),
    }))
}

// Map mã sticker -> {code, name, image} của các bộ áp dụng
const stickerIndex = (sets) => new Map(sets.flatMap((s) => s.stickers.map((x) => [x.code, x])))

// Kiểm tra và chuẩn hóa nội dung cá nhân hóa theo cấu hình sản phẩm.
// input rỗng/null = không cá nhân hóa (cá nhân hóa không bắt buộc). stickers: Map mã -> sticker đang áp dụng.
// Trả null hoặc object đúng cấu trúc 06 Mục 3.1; sai thì ném 422 kèm mã BR.
function normalizePersonalization(input, product, stickers) {
  if (input == null || input === "" || (typeof input === "object" && !input.type)) return null
  if (typeof input !== "object") throw ruleError("BR-19", "Hình thức cá nhân hóa không hợp lệ")
  const types = allowedTypes(product)
  if (!["IN_KHAC", "THIET_KE"].includes(input.type) || !types.includes(input.type)) {
    throw ruleError("BR-19", "Sản phẩm không hỗ trợ hình thức cá nhân hóa này")
  }

  if (input.type === "IN_KHAC") {
    const cfg = engraveConfig(product)
    if (input.mode && input.mode !== cfg.mode) throw ruleError("BR-18", "Chế độ In/Khắc không khớp với sản phẩm")
    if (cfg.mode === "THUONG") {
      const text = clean(input.text)
      if (!text) throw ruleError("BR-18", "Nhập nội dung in/khắc hoặc chọn Không cá nhân hóa", "text")
      if (charCount(text) > cfg.maxChars) throw ruleError("BR-18", `Nội dung in/khắc tối đa ${cfg.maxChars} ký tự`, "text")
      return { type: "IN_KHAC", mode: "THUONG", text }
    }
    const top = clean(input.top)
    const number = clean(input.number)
    const bottom = clean(input.bottom)
    if (!top && !number && !bottom) throw ruleError("BR-18", "Nhập nội dung in/khắc hoặc chọn Không cá nhân hóa", "top")
    if (charCount(top) > cfg.topMaxChars) throw ruleError("BR-18", `Dòng trên tối đa ${cfg.topMaxChars} ký tự`, "top")
    if (charCount(bottom) > cfg.bottomMaxChars) throw ruleError("BR-18", `Dòng dưới tối đa ${cfg.bottomMaxChars} ký tự`, "bottom")
    if (number && !/^\d+$/.test(number)) throw ruleError("BR-18", "Số áo chỉ gồm chữ số", "number")
    if (number.length > cfg.numberMaxDigits) throw ruleError("BR-18", `Số áo tối đa ${cfg.numberMaxDigits} chữ số`, "number")
    return { type: "IN_KHAC", mode: "AO_DAU", top, number, bottom }
  }

  // THIET_KE (BR-20): 1 đến 3 sticker khác nhau đang áp dụng. Không còn lời nhắn in trên sản phẩm: nội dung gửi kèm lời nhắn thì bỏ qua lời nhắn
  const codes = Array.isArray(input.stickers) ? input.stickers.filter((c) => typeof c === "string") : []
  const unique = [...new Set(codes)]
  if (unique.length !== codes.length) throw ruleError("BR-20", "Mỗi sticker chỉ chọn một lần", "stickers")
  if (unique.length > params.STICKER_MAX) throw ruleError("BR-20", `Tối đa ${params.STICKER_MAX} sticker`, "stickers")
  const gone = unique.filter((c) => !stickers.has(c))
  if (gone.length) throw ruleError("BR-33", "Sticker đã chọn không còn áp dụng, vui lòng chọn lại", "stickers")
  if (!unique.length) throw ruleError("BR-20", "Chọn ít nhất 1 sticker", "stickers")
  return { type: "THIET_KE", stickers: unique }
}

// Phí cá nhân hóa mỗi đơn vị (BR-20): In/Khắc 0đ, Thiết kế = số sticker × phí sticker
function feePerUnit(p, stickerFee) {
  if (!p || p.type !== "THIET_KE") return 0
  return (p.stickers || []).length * stickerFee
}

// Khóa so sánh 2 nội dung cá nhân hóa (UC-CRT-01 8a: cùng sản phẩm, biến thể, nội dung thì cộng dồn)
function personalizationKey(p) {
  if (!p) return ""
  if (p.type === "IN_KHAC") return p.mode === "AO_DAU" ? `IK|A|${p.top}|${p.number}|${p.bottom}` : `IK|T|${p.text}`
  return `TK|${[...(p.stickers || [])].sort().join(",")}|${p.message || ""}`
}

// Kiểm tra lại nội dung đã lưu (dòng giỏ, thiết kế đã lưu) theo cấu hình hiện tại; trả lý do không hợp lệ hoặc null
function revalidate(p, product, stickers) {
  if (!p) return null
  try {
    normalizePersonalization(p, product, stickers)
    return null
  } catch (err) {
    if (err.extra && err.extra.rule === "BR-33") return "STICKER"
    return "CA_NHAN_HOA"
  }
}

// Tên gợi ý khi lưu thiết kế In/Khắc (UC-CRT-01 5a): "Áo đấu - MINH ANH 10", "Lót chuột - 2 sticker"
function suggestDesignName(product, p) {
  const short = String(product.name || "").split(" ").slice(0, 2).join(" ")
  let detail = ""
  if (p.type === "IN_KHAC") detail = p.mode === "AO_DAU" ? [p.top, p.number, p.bottom].filter(Boolean).join(" ") : p.text
  else detail = `${p.stickers.length} sticker`
  return `${short} - ${detail}`.slice(0, 60)
}

module.exports = {
  engraveConfig,
  allowedTypes,
  stickerSetsFor,
  stickerIndex,
  normalizePersonalization,
  feePerUnit,
  personalizationKey,
  revalidate,
  suggestDesignName,
  charCount,
}
