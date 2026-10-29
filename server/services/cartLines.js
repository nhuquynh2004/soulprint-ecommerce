// Phần tính toán thuần của giỏ hàng (không đọc CSDL) để unit test: khóa dòng, tổng tiền, gộp giỏ.
const params = require("../config/params")
const pz = require("./personalization")

// Cùng sản phẩm, cùng biến thể, cùng nội dung cá nhân hóa là 1 dòng (UC-CRT-01 8a)
const lineKey = (it) => `${it.productId}|${it.variantSku}|${pz.personalizationKey(it.personalization)}`

// Tổng tiền chỉ tính dòng được chọn và không có cảnh báo (02 Mục 3.1, UC-CRT-03 AC5, AC7).
// Chưa chọn dòng nào thì phí vận chuyển 0đ (SCR-05 trạng thái chưa chọn).
function totals(items, shippingFeeSetting) {
  const chosen = items.filter((it) => it.selected && !it.warning)
  const subtotal = chosen.reduce((s, it) => s + it.unitPrice * it.quantity, 0)
  const personalizationFee = chosen.reduce((s, it) => s + it.personalizationFeePerUnit * it.quantity, 0)
  const shippingFee = chosen.length ? shippingFeeSetting : 0
  return {
    selectedCount: chosen.length,
    selectedQuantity: chosen.reduce((s, it) => s + it.quantity, 0),
    hasPersonalization: chosen.some((it) => it.personalization),
    subtotal,
    personalizationFee,
    giftWrapFee: params.GIFT_WRAP_FEE,
    shippingFee,
    estimatedTotal: subtotal + personalizationFee + shippingFee,
  }
}

// Gộp giỏ Guest vào giỏ Member (02 Mục 2 ghi chú 2). stockOf(line) trả tồn hiện tại của biến thể trong dòng. Hàm thuần để viết unit test.
function mergeLines(memberItems, guestItems, stockOf) {
  const items = memberItems.map((it) => ({ ...it }))
  for (const g of guestItems) {
    const same = items.find((m) => lineKey(m) === lineKey(g))
    if (same) {
      same.quantity = Math.max(same.quantity, Math.min(same.quantity + g.quantity, stockOf(g), params.CART_MAX_QUANTITY))
      same.selected = true
    } else if (items.length < params.CART_MAX_ITEMS) {
      items.unshift({ ...g, selected: true })
    }
  }
  return items
}

module.exports = { lineKey, totals, mergeLines }
