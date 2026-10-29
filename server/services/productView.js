// Đổi document products thành dữ liệu trả cho khách (không lộ costPrice, người tạo, biến thể đã tắt...).
// toCard: thẻ sản phẩm ở danh sách, trang chủ, "Có thể bạn quan tâm".
// toDetail: trang chi tiết SCR-03 (API-28, BR-39).
const params = require("../config/params")
const { isOnSale, basePrice } = require("./pricing")

const DAY = 24 * 60 * 60 * 1000

// Nhãn hiển thị trên thẻ và trang chi tiết (07 Mục 2.3, "Cách hiểu tham số của API-26").
function labelsOf(p, now) {
  const created = p.createdAt ? new Date(p.createdAt).getTime() : 0
  return {
    isNew: created >= now.getTime() - params.NEW_PRODUCT_DAYS * DAY,
    isBestSeller: (p.soldCount || 0) >= params.BEST_SELLER_MIN_SOLD,
    personalization: p.personalization && p.personalization.allowed ? p.personalization.types || [] : [],
  }
}

const hasStock = (p) => (p.variants || []).some((v) => v.isActive !== false && v.stock > 0)

function priceInfo(p, now) {
  const onSale = isOnSale(p, now)
  const finalPrice = basePrice(p, now)
  return {
    price: p.price,
    finalPrice,
    onSale,
    discountPercent: onSale ? Math.round((1 - p.salePrice / p.price) * 100) : 0,
    saleEndAt: onSale ? p.saleEndAt || null : null,
  }
}

function toCard(p, now = new Date()) {
  return {
    _id: p._id,
    name: p.name,
    slug: p.slug,
    image: (p.images || [])[0] || null,
    ...priceInfo(p, now),
    axis: p.axis,
    ratingAvg: p.ratingAvg || 0,
    ratingCount: p.ratingCount || 0,
    labels: labelsOf(p, now),
    inStock: hasStock(p),
  }
}

// Chi tiết sản phẩm theo BR-39: chỉ biến thể đang bán, chỉ giá trị không ẩn và còn ít nhất 1 biến thể đang bán;
// ảnh theo giá trị chỉ trả cho nhóm gắn ảnh.
function toDetail(p, now = new Date(), refs = {}) {
  const variants = (p.variants || [])
    .filter((v) => v.isActive !== false)
    .map(({ sku, name, attributes, priceDelta, stock }) => ({
      sku,
      name,
      attributes: attributes || {},
      priceDelta: priceDelta || 0,
      stock: stock || 0,
    }))

  const optionGroups = (p.optionGroups || [])
    .slice()
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
    .map((g) => ({
      name: g.name,
      hasImages: !!g.hasImages,
      values: (g.values || [])
        .filter((v) => !v.isHidden && variants.some((x) => x.attributes[g.name] === v.value))
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
        .map((v) => ({ value: v.value, code: v.code, ...(g.hasImages ? { images: v.images || [] } : {}) })),
    }))
    .filter((g) => g.values.length)

  return {
    _id: p._id,
    sku: p.sku,
    name: p.name,
    slug: p.slug,
    shortDescription: p.shortDescription || "",
    description: p.description || "",
    sizeChart: p.sizeChart || null,
    brand: p.brand || "",
    axis: p.axis,
    images: p.images || [],
    ...priceInfo(p, now),
    optionGroups,
    variants,
    personalization: p.personalization || { allowed: false, types: [] },
    specs: p.specs || {},
    warrantyMonths: p.warrantyMonths || 0,
    ageMin: p.ageMin ?? null,
    ageMax: p.ageMax ?? null,
    ratingAvg: p.ratingAvg || 0,
    ratingCount: p.ratingCount || 0,
    labels: labelsOf(p, now),
    inStock: hasStock(p),
    category: refs.category || null,
    tags: refs.tags || [],
  }
}

module.exports = { toCard, toDetail, labelsOf }
