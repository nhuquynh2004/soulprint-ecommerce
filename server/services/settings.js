// Cài đặt cửa hàng đang áp dụng (siteSettings key "store", BR-35). Thiếu trường nào thì lấy mặc định ở config/params.js.
const { database } = require("../config/db")
const params = require("../config/params")

async function getStoreSettings() {
  const doc = (await database.collection("siteSettings").findOne({ key: "store" })) || {}
  const fees = doc.fees || {}
  const info = doc.info || {}
  return {
    shippingFee: fees.shippingFee ?? params.SHIPPING_FEE,
    depositRate: fees.depositRate ?? params.DEPOSIT_RATE,
    stickerFee: fees.stickerFee ?? params.STICKER_FEE,
    // Phương thức thanh toán đang bật (BR-40); thiếu thì coi như bật
    payments: { onlineFull: true, depositCod: true, codFull: true, ...(doc.payments || {}) },
    store: {
      storeName: info.storeName || "Soulprint",
      hotline: info.hotline || "",
      email: info.email || "",
      workingHours: info.workingHours || "",
      returnAddress: info.returnAddress || "", // địa chỉ kho nhận hàng trả về (UC-OPS-07 bước 3)
      social: info.social || {},
    },
  }
}

// 30000 -> "30.000đ"
const formatVnd = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "đ"

// Biến dùng trong nội dung chính sách và câu trả lời FAQ (UC-CAT-07 1b, BR-35): {{phi_van_chuyen}} -> "30.000đ"
const VARIABLES = {
  phi_van_chuyen: "Phí vận chuyển",
  ty_le_coc: "Tỷ lệ cọc",
  phi_sticker: "Phí sticker",
  so_ngay_doi_tra: "Số ngày đổi trả",
  hotline: "Hotline",
}
const VARIABLE_RE = /\{\{\s*(\w+)\s*\}\}/g

function variableValues(s) {
  return {
    phi_van_chuyen: formatVnd(s.shippingFee),
    ty_le_coc: Math.round(s.depositRate * 100) + "%",
    phi_sticker: formatVnd(s.stickerFee),
    so_ngay_doi_tra: String(params.RETURN_WINDOW_DAYS),
    hotline: s.store.hotline,
  }
}

const fillVariables = (text, values) => String(text || "").replace(VARIABLE_RE, (all, key) => values[key] ?? all)

// Tên biến không có trong VARIABLES (để báo lỗi 1bEa)
const unknownVariables = (text) => [...String(text || "").matchAll(VARIABLE_RE)].map((m) => m[1]).filter((k) => !VARIABLES[k])

module.exports = { getStoreSettings, formatVnd, VARIABLES, variableValues, fillVariables, unknownVariables }
