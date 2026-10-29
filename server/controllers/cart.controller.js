// Giỏ hàng (07_API_Spec.md Mục 2.5): API-31 xem, API-32 thêm, API-33 sửa dòng, API-34 xóa dòng, API-35 gói quà,
// API-118 chọn dòng. Cùng API cho Guest (session) và Member (carts). Mẫu gói quà công khai API-30 (Mục 2.3).
const { database } = require("../config/db")
const cart = require("../services/cart")

// API-31 GET /api/cart
async function getCart(req, res) {
  res.send(await cart.getView(req))
}

// API-32 POST /api/cart/items?buyNow=true - {productId, variantSku, quantity, personalization?}
async function addItem(req, res) {
  const { view, itemId } = await cart.addItem(req, req.body || {}, { buyNow: req.query.buyNow === "true" })
  res.status(201).send({ ...view, addedItemId: itemId })
}

// API-33 PUT /api/cart/items/:itemId - {variantSku?, quantity?, personalization?, selected?}
async function updateItem(req, res) {
  res.send(await cart.updateItem(req, req.params["itemId"], req.body || {}))
}

// API-34 DELETE /api/cart/items/:itemId
async function removeItem(req, res) {
  res.send(await cart.removeItem(req, req.params["itemId"]))
}

// API-118 PUT /api/cart/selection - {all} hoặc {itemIds[], selected}
async function setSelection(req, res) {
  res.send(await cart.setSelection(req, req.body || {}))
}

// API-35 PUT /api/cart/gift-wrap - {source, ...}, {selected} hoặc null
async function setGiftWrap(req, res) {
  const body = req.body && Object.keys(req.body).length ? req.body : null
  res.send(await cart.setGiftWrap(req, body))
}

// API-30 GET /api/gift-wraps - mẫu gợi ý nhóm theo BST/mùa (nhóm BST_MUA đang hiển thị xếp trước) và vật liệu đang hiện.
// Mẫu có vật liệu hết tồn trả available = false ("Tạm hết"), vật liệu hết tồn trả available = false ("Hết hàng") - BR-36.
async function getGiftWraps(req, res) {
  const now = new Date()
  const [templates, materials] = await Promise.all([
    database.collection("giftWrapTemplates").find({ isActive: true }).sort({ sortOrder: 1, _id: 1 }).toArray(),
    database.collection("giftWrapMaterials").find({ isActive: true }).sort({ sortOrder: 1, _id: 1 }).toArray(),
  ])
  const usable = new Map(materials.map((m) => [m.code, cart.materialUsable(m)]))
  const byKind = { GIAY_GOI: [], RUY_BANG: [], THIEP: [] }
  for (const m of materials) {
    byKind[m.kind]?.push({ code: m.code, name: m.name, description: m.description || "", image: m.image || null, available: usable.get(m.code) })
  }

  const groups = new Map()
  for (const t of templates.filter((x) => cart.templateLive(x, now))) {
    const seasonal = t.kind === "BST_MUA"
    const key = seasonal ? `S|${t.seasonLabel}` : "THUONG"
    if (!groups.has(key)) groups.set(key, { seasonLabel: seasonal ? t.seasonLabel : null, badge: seasonal ? t.badge || null : null, kind: t.kind, templates: [] })
    groups.get(key).templates.push({
      _id: t._id,
      code: t.code || null,
      name: t.name,
      description: t.description || "",
      image: t.image || null,
      paper: t.paper,
      ribbon: t.ribbon,
      card: t.card,
      available: [t.paper, t.ribbon, t.card].every((m) => m && usable.get(m.code)),
    })
  }
  const suggested = [...groups.values()].sort((a, b) => (a.kind === "BST_MUA" ? 0 : 1) - (b.kind === "BST_MUA" ? 0 : 1))
  res.send({ suggested, materials: byKind })
}

module.exports = { getCart, addItem, updateItem, removeItem, setSelection, setGiftWrap, getGiftWraps }
