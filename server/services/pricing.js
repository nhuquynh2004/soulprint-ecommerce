// Giá hiệu lực (06_DataModel.md Mục 2.4):
// giá 1 đơn vị = (salePrice nếu đang trong thời gian sale, không thì price) + variant.priceDelta.
// Viết một lần ở đây để trang sản phẩm, giỏ hàng, đặt hàng dùng chung, không tính lệch nhau.

function isOnSale(product, now = new Date()) {
  if (product.salePrice == null || !(product.salePrice < product.price)) return false
  if (product.saleStartAt && new Date(product.saleStartAt) > now) return false
  if (product.saleEndAt && new Date(product.saleEndAt) < now) return false
  return true
}

// Giá sản phẩm chưa cộng chênh giá biến thể (dùng để lọc, sắp xếp, hiện trên thẻ sản phẩm).
function basePrice(product, now = new Date()) {
  return isOnSale(product, now) ? product.salePrice : product.price
}

function unitPrice(product, variant, now = new Date()) {
  return basePrice(product, now) + ((variant && variant.priceDelta) || 0)
}

// Cùng công thức nhưng viết bằng biểu thức aggregation để MongoDB lọc, sắp xếp theo giá hiệu lực.
function onSaleExpr(now) {
  return {
    $and: [
      { $ne: [{ $ifNull: ["$salePrice", null] }, null] },
      { $lt: ["$salePrice", "$price"] },
      { $lte: [{ $ifNull: ["$saleStartAt", now] }, now] },
      { $gte: [{ $ifNull: ["$saleEndAt", now] }, now] },
    ],
  }
}

function basePriceExpr(now) {
  return { $cond: [onSaleExpr(now), "$salePrice", "$price"] }
}

module.exports = { isOnSale, basePrice, unitPrice, onSaleExpr, basePriceExpr }
