// Giỏ hàng (UC-CRT-01, CRT-03, CRT-04). Guest: req.session.cart; Member: collection carts. Cùng một cấu trúc
// (06 Mục 3.1) nên mọi API giỏ dùng chung các hàm ở đây, chỉ khác chỗ đọc/ghi (loadCart, saveCart).
// Giá không lưu trong giỏ: luôn tính lại từ products khi đọc (UC-CRT-03 bước 2, AC2).
const { database, ObjectId } = require("../config/db")
const params = require("../config/params")
const HttpError = require("../utils/httpError")
const { unitPrice, isOnSale } = require("./pricing")
const { getStoreSettings } = require("./settings")
const pz = require("./personalization")
const { lineKey, totals, mergeLines } = require("./cartLines")
const productStats = require("./productStats")

const products = () => database.collection("products")
const carts = () => database.collection("carts")
const toId = (v) => (v && ObjectId.isValid(String(v)) ? new ObjectId(String(v)) : null)

const isMember = (req) => !!(req.user && req.user.role === "member")
const emptyCart = () => ({ items: [], giftWrap: null })

// Trong session lưu id dạng chuỗi (phiên lưu bằng connect-mongo), trong carts lưu ObjectId
function toPlain(cart) {
  return {
    items: (cart.items || []).map((it) => ({ ...it, _id: String(it._id), productId: String(it.productId) })),
    giftWrap: cart.giftWrap ? { ...cart.giftWrap } : null,
  }
}

function toDb(cart) {
  return {
    items: cart.items.map((it) => ({ ...it, _id: toId(it._id), productId: toId(it.productId) })),
    giftWrap: cart.giftWrap,
  }
}

async function loadCart(req) {
  if (isMember(req)) {
    const doc = await carts().findOne({ userId: req.user._id })
    return doc ? toPlain(doc) : emptyCart()
  }
  return req.session.cart ? toPlain(req.session.cart) : emptyCart()
}

async function saveCart(req, cart) {
  if (isMember(req)) {
    await carts().updateOne(
      { userId: req.user._id },
      { $set: { ...toDb(cart), updatedAt: new Date() }, $setOnInsert: { userId: req.user._id, createdAt: new Date() } },
      { upsert: true },
    )
  } else if (cart.items.length || cart.giftWrap) {
    req.session.cart = toPlain(cart)
  } else if (req.session.cart) {
    delete req.session.cart
  }
}

// Sản phẩm khách mua được: đang hiển thị (06 Mục 2.4)
const sellable = (p) => !!p && p.status === "DANG_HIEN_THI"
const findVariant = (p, sku) => (p.variants || []).find((v) => v.sku === sku && v.isActive !== false) || null

// Ảnh theo biến thể (BR-39): ảnh đầu của giá trị thuộc nhóm gắn ảnh, không có thì ảnh đại diện
function variantImage(p, variant) {
  const g = (p.optionGroups || []).find((x) => x.hasImages)
  if (g && variant && variant.attributes) {
    const val = (g.values || []).find((x) => x.value === variant.attributes[g.name])
    if (val && val.images && val.images.length) return val.images[0]
  }
  return (p.images || [])[0] || null
}

// Biến thể mặc định khi thêm từ thẻ sản phẩm: sản phẩm chỉ có 1 biến thể đang bán
function defaultVariant(p) {
  const active = (p.variants || []).filter((v) => v.isActive !== false)
  return active.length === 1 ? active[0] : null
}

// Sticker áp dụng cho từng sản phẩm, dùng 1 lần đọc stickerSets
async function stickerLookup(productList, now) {
  const needs = productList.some((p) => pz.allowedTypes(p).includes("THIET_KE"))
  const allSets = needs ? await database.collection("stickerSets").find({ isActive: true }).toArray() : []
  const map = new Map()
  for (const p of productList) map.set(String(p._id), pz.stickerIndex(await pz.stickerSetsFor(p, now, allSets)))
  return map
}

// ===== Gói quà (BR-21, BR-33, BR-36) =====

const MATERIAL_KINDS = { paper: "GIAY_GOI", ribbon: "RUY_BANG", card: "THIEP" }
const templateLive = (t, now) => t.isActive !== false && (t.kind !== "BST_MUA" || ((!t.startAt || t.startAt <= now) && (!t.endAt || t.endAt >= now)))

async function materialMap(codes) {
  const list = await database.collection("giftWrapMaterials").find({ code: { $in: codes.filter(Boolean) } }).toArray()
  return new Map(list.map((m) => [m.code, m]))
}

// Vật liệu dùng được cho khách: đang hiện và còn tồn (BR-36)
const materialUsable = (m) => !!m && m.isActive !== false && (m.stock || 0) >= 1

// Đọc 3 mã vật liệu, kiểm tra đúng loại, đang hiện, còn tồn; trả {paper, ribbon, card} dạng {code, name, image}
async function resolveMaterials(codes, { requireStock = true } = {}) {
  const map = await materialMap(Object.values(codes))
  const out = {}
  for (const [slot, kind] of Object.entries(MATERIAL_KINDS)) {
    const m = map.get(codes[slot])
    if (!m || m.kind !== kind || m.isActive === false) {
      throw new HttpError(422, "BUSINESS_RULE", "Vật liệu gói quà không còn áp dụng, vui lòng chọn lại", { rule: "BR-33", fields: { [slot]: "Vật liệu không hợp lệ" } })
    }
    if (requireStock && !materialUsable(m)) {
      throw new HttpError(422, "BUSINESS_RULE", `${m.name} đã hết hàng, vui lòng chọn vật liệu khác`, { rule: "BR-36", fields: { [slot]: "Hết hàng" } })
    }
    out[slot] = { code: m.code, name: m.name, image: m.image || null }
  }
  return out
}

const giftMessage = (v) => (typeof v === "string" ? v.normalize("NFC").trim() : "")

function readGiftMessage(v) {
  const message = giftMessage(v)
  if (pz.charCount(message) > params.GIFT_MESSAGE_MAX_CHARS) {
    throw new HttpError(400, "VALIDATION_ERROR", `Lời nhắn tối đa ${params.GIFT_MESSAGE_MAX_CHARS} ký tự`, { fields: { message: `Lời nhắn tối đa ${params.GIFT_MESSAGE_MAX_CHARS} ký tự` } })
  }
  return message
}

// Chuẩn hóa yêu cầu API-35 thành giftWrap lưu trong giỏ. Trả undefined khi chỉ bật/tắt ô chọn.
async function buildGiftWrap(req, body) {
  if (body === null || body === undefined || (typeof body === "object" && body.source === null)) return null
  const source = body.source
  if (source === "GOI_Y") {
    const t = await database.collection("giftWrapTemplates").findOne({ _id: toId(body.templateId) })
    if (!t || !templateLive(t, new Date())) throw new HttpError(422, "BUSINESS_RULE", "Mẫu gói quà không còn áp dụng, vui lòng chọn mẫu khác", { rule: "BR-33" })
    await resolveMaterials({ paper: t.paper?.code, ribbon: t.ribbon?.code, card: t.card?.code })
    return { source, templateId: String(t._id), name: t.name, message: readGiftMessage(body.message), selected: true }
  }
  if (source === "CUA_TOI") {
    if (!isMember(req)) throw new HttpError(401, "UNAUTHENTICATED", "Đăng nhập để dùng mẫu đã lưu")
    const d = await database.collection("designs").findOne({ _id: toId(body.designId), userId: req.user._id })
    if (!d || (d.kind && d.kind !== "GOI_QUA")) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy mẫu gói quà")
    await resolveMaterials({ paper: d.paper, ribbon: d.ribbon, card: d.card })
    // Lời nhắn khách nhập lúc áp dụng thay lời nhắn đã lưu trong mẫu
    const message = body.message !== undefined ? readGiftMessage(body.message) : d.message || ""
    return { source, designId: String(d._id), name: d.name, custom: { paper: d.paper, ribbon: d.ribbon, card: d.card, message }, selected: true }
  }
  if (source === "TAO_MOI") {
    const c = body.custom || {}
    const message = readGiftMessage(c.message)
    await resolveMaterials({ paper: c.paper, ribbon: c.ribbon, card: c.card })
    // Giữ tên khi nhân viên dùng lại/sửa mẫu của khách ở đơn gấp; khách tự tạo thì tên mặc định
    const name = typeof body.name === "string" && body.name.normalize("NFC").trim() ? body.name.normalize("NFC").trim().slice(0, 60) : "Gói quà tự tạo"
    return { source, name, custom: { paper: c.paper, ribbon: c.ribbon, card: c.card, message }, selected: true }
  }
  throw new HttpError(400, "VALIDATION_ERROR", "Cách chọn gói quà không hợp lệ")
}

// Thông tin hiển thị gói quà; tự gỡ mẫu gợi ý đã hết mùa/bị ẩn (UC-CRT-03 2Ec), báo vật liệu hết (BR-36)
async function giftWrapView(gw, now, warnings) {
  if (!gw) return { view: null, changed: false }
  let codes
  let name = gw.name
  let image = null
  let message = ""
  if (gw.source === "GOI_Y") {
    const t = await database.collection("giftWrapTemplates").findOne({ _id: toId(gw.templateId) })
    if (!t || !templateLive(t, now)) {
      warnings.push({ code: "GOI_QUA_HET_MUA", message: `Mẫu gói quà ${gw.name} đã hết mùa, vui lòng chọn mẫu khác` })
      return { view: null, changed: true }
    }
    codes = { paper: t.paper?.code, ribbon: t.ribbon?.code, card: t.card?.code }
    name = t.name
    image = t.image || null
    message = gw.message || ""
  } else {
    codes = { paper: gw.custom?.paper, ribbon: gw.custom?.ribbon, card: gw.custom?.card }
    message = gw.custom?.message || ""
  }
  const map = await materialMap(Object.values(codes))
  const parts = {}
  const missing = []
  for (const slot of Object.keys(MATERIAL_KINDS)) {
    const m = map.get(codes[slot])
    parts[slot] = m ? { code: m.code, name: m.name, image: m.image || null } : { code: codes[slot], name: codes[slot], image: null }
    if (!materialUsable(m)) missing.push(m ? m.name : codes[slot])
  }
  const available = missing.length === 0
  if (!available) warnings.push({ code: "VAT_LIEU_HET", message: `Gói quà "${name}" tạm hết ${missing.join(", ")}, vui lòng chọn mẫu khác` })
  return {
    view: {
      source: gw.source,
      templateId: gw.templateId || null,
      designId: gw.designId || null,
      name,
      image,
      ...parts,
      message,
      selected: gw.selected !== false,
      available,
    },
    changed: false,
  }
}

// ===== Đọc giỏ (API-31) =====

const WARNING_TEXT = {
  NGUNG_BAN: "Sản phẩm đã ngừng kinh doanh, vui lòng xóa khỏi giỏ hàng",
  HET_HANG: "Sản phẩm này vừa hết hàng, vui lòng xóa hoặc đổi biến thể",
  STICKER: "Sticker đã chọn không còn áp dụng, vui lòng sửa thiết kế",
  CA_NHAN_HOA: "Nội dung cá nhân hóa không còn phù hợp với sản phẩm, vui lòng sửa",
}

// Tính lại giỏ: giá mới nhất, cảnh báo từng dòng (dòng có cảnh báo tự bỏ chọn - UC-CRT-03 2Eb), tổng tiền
// chỉ tính dòng được chọn (02 Mục 3.1). Sửa giỏ khi cần (bỏ chọn dòng lỗi, gỡ gói quà hết mùa) rồi lưu;
// persist = false khi chỉ cần xem thử (kiểm tra trước khi chọn dòng).
async function buildView(req, cart, { now = new Date(), persist = true } = {}) {
  const settings = await getStoreSettings()
  const ids = [...new Set(cart.items.map((it) => it.productId))].map(toId).filter(Boolean)
  const list = ids.length ? await products().find({ _id: { $in: ids } }).toArray() : []
  const byId = new Map(list.map((p) => [String(p._id), p]))
  const stickersBy = await stickerLookup(list.filter(sellable), now)

  const warnings = []
  let changed = false
  const items = cart.items.map((it) => {
    const p = byId.get(it.productId)
    const variant = p ? findVariant(p, it.variantSku) : null
    let warning = null
    if (!sellable(p)) warning = { code: "NGUNG_BAN", message: WARNING_TEXT.NGUNG_BAN }
    else if (!variant || (variant.stock || 0) <= 0) warning = { code: "HET_HANG", message: WARNING_TEXT.HET_HANG }
    else if (it.quantity > variant.stock) warning = { code: "KHONG_DU", message: `Rất tiếc, sản phẩm chỉ còn ${variant.stock} sản phẩm, vui lòng giảm số lượng` }
    else {
      const bad = pz.revalidate(it.personalization, p, stickersBy.get(it.productId) || new Map())
      if (bad) warning = { code: bad, message: WARNING_TEXT[bad] }
    }
    if (warning && it.selected) {
      it.selected = false
      changed = true
    }
    if (warning) warnings.push({ itemId: it._id, ...warning })

    const price = p && variant ? unitPrice(p, variant, now) : 0
    const fee = pz.feePerUnit(it.personalization, settings.stickerFee)
    const stickerMap = stickersBy.get(it.productId) || new Map()
    return {
      _id: it._id,
      productId: it.productId,
      slug: p ? p.slug : null,
      name: p ? p.name : "Sản phẩm không còn tồn tại",
      image: p ? variantImage(p, variant) : null,
      variantSku: it.variantSku,
      variantName: variant ? variant.name : "",
      attributes: variant ? variant.attributes || {} : {},
      hasOptions: !!p && (p.variants || []).filter((v) => v.isActive !== false).length > 1,
      quantity: it.quantity,
      selected: !!it.selected,
      aiSessionId: it.aiSessionId || null, // dòng thêm từ thẻ gợi ý SCR-10, dùng ghi aiSessions.orderCodes khi đặt đơn
      personalization: it.personalization
        ? {
            ...it.personalization,
            ...(it.personalization.type === "THIET_KE"
              ? { stickerDetails: (it.personalization.stickers || []).map((c) => stickerMap.get(c) || { code: c, name: c, image: null }) }
              : {}),
          }
        : null,
      // Cấu hình để sửa tại chỗ / mở lại hộp thoại
      personalizationTypes: p ? pz.allowedTypes(p) : [],
      engrave: p && pz.allowedTypes(p).includes("IN_KHAC") ? pz.engraveConfig(p) : null,
      unitPrice: price,
      originalUnitPrice: p && variant && isOnSale(p, now) ? p.price + (variant.priceDelta || 0) : null,
      personalizationFeePerUnit: fee,
      lineValue: (price + fee) * it.quantity,
      // Dòng thêm từ "Đặt lại" mà giá khác đơn cũ: nhãn "Giá đã thay đổi" (UC-CNL-03 3a)
      priceChanged: it.priceAtOrder != null && !!p && !!variant && it.priceAtOrder !== price,
      stock: variant ? variant.stock || 0 : 0,
      warning,
    }
  })

  const gift = await giftWrapView(cart.giftWrap, now, warnings)
  if (gift.changed) {
    cart.giftWrap = null
    changed = true
  }
  if (changed && persist) await saveCart(req, cart)

  return { items, giftWrap: gift.view, count: items.length, ...totals(items, settings.shippingFee), stickerFee: settings.stickerFee, warnings }
}

async function getView(req) {
  return buildView(req, await loadCart(req))
}

// ===== Thêm, sửa, xóa dòng =====

function readQuantity(value) {
  const q = Number(value)
  if (!Number.isInteger(q) || q < 1 || q > params.CART_MAX_QUANTITY) {
    throw new HttpError(400, "VALIDATION_ERROR", `Số lượng từ 1 đến ${params.CART_MAX_QUANTITY}`, { fields: { quantity: "Số lượng không hợp lệ" } })
  }
  return q
}

// Hết hàng / vượt tồn (UC-CRT-01 8Ea, AC5)
function assertStock(variant, quantity) {
  const stock = variant ? variant.stock || 0 : 0
  if (stock <= 0) throw new HttpError(409, "OUT_OF_STOCK", "Rất tiếc, sản phẩm vừa hết hàng", { available: 0 })
  if (quantity > stock) throw new HttpError(409, "OUT_OF_STOCK", `Rất tiếc, sản phẩm chỉ còn ${stock} sản phẩm`, { available: stock })
}

async function loadSellable(productId) {
  const p = await products().findOne({ _id: toId(productId) })
  if (!sellable(p)) throw new HttpError(404, "NOT_FOUND", "Sản phẩm không còn kinh doanh")
  return p
}

async function normalizeFor(p, personalization, now = new Date()) {
  const map = pz.allowedTypes(p).includes("THIET_KE") ? pz.stickerIndex(await pz.stickerSetsFor(p, now)) : new Map()
  return pz.normalizePersonalization(personalization, p, map)
}

// API-32: thêm dòng hoặc cộng dồn vào dòng trùng (UC-CRT-01 8a). buyNow: chỉ chọn dòng này.
async function addItem(req, body, { buyNow = false } = {}) {
  const p = await loadSellable(body.productId)
  const variant = body.variantSku ? findVariant(p, String(body.variantSku)) : defaultVariant(p)
  if (!variant) {
    throw new HttpError(422, "VALIDATION_ERROR", "Vui lòng chọn phân loại sản phẩm", { fields: { variantSku: "Vui lòng chọn phân loại" }, needOptions: true, slug: p.slug })
  }
  const quantity = readQuantity(body.quantity ?? 1)
  const personalization = await normalizeFor(p, body.personalization)

  const cart = await loadCart(req)
  const item = { productId: String(p._id), variantSku: variant.sku, personalization }
  const same = cart.items.find((it) => lineKey(it) === lineKey(item))
  const total = (same ? same.quantity : 0) + quantity
  assertStock(variant, total)
  if (total > params.CART_MAX_QUANTITY) throw new HttpError(422, "VALIDATION_ERROR", `Mỗi dòng tối đa ${params.CART_MAX_QUANTITY} sản phẩm`)
  // Thêm từ thẻ gợi ý SCR-10 (UC-DIS-05 AC5): lượt tư vấn phải thuộc người gọi, không hợp lệ thì bỏ qua
  const aiSessionId = body.aiSessionId ? await require("./recommendation").ownedSessionFor(req, body.aiSessionId, p._id) : null

  let itemId
  if (same) {
    same.quantity = total
    same.selected = true
    if (aiSessionId) same.aiSessionId = aiSessionId
    itemId = same._id
  } else {
    if (cart.items.length >= params.CART_MAX_ITEMS) throw new HttpError(422, "VALIDATION_ERROR", `Giỏ hàng tối đa ${params.CART_MAX_ITEMS} dòng sản phẩm`)
    itemId = String(new ObjectId())
    cart.items.unshift({ _id: itemId, ...item, quantity, selected: true, ...(aiSessionId ? { aiSessionId } : {}), addedAt: new Date() })
  }
  if (buyNow) for (const it of cart.items) it.selected = it._id === itemId
  await saveCart(req, cart)
  productStats.record(p._id, "addToCarts") // phễu theo ngày ở SCR-40
  if (aiSessionId) await require("./recommendation").recordClick(aiSessionId, p._id)
  return { view: await buildView(req, cart), itemId }
}

// API-46 Đặt lại / Mua lại (UC-CNL-03): thêm các dòng còn bán, số lượng tối đa bằng tồn, gộp với dòng trùng;
// chỉ các dòng vừa thêm được chọn. Dòng ngừng bán, hết hàng, cá nhân hóa không còn hợp lệ thì bỏ qua (2Ea).
async function addLines(req, lines) {
  const c = await loadCart(req)
  const skipped = []
  const addedIds = new Set()
  for (const line of lines) {
    const p = await products().findOne({ _id: toId(line.productId) })
    const variant = sellable(p) ? findVariant(p, line.variantSku) : null
    if (!variant || (variant.stock || 0) <= 0) {
      skipped.push(line.name)
      continue
    }
    let personalization
    try {
      personalization = await normalizeFor(p, line.personalization)
    } catch {
      skipped.push(line.name)
      continue
    }
    const item = { productId: String(p._id), variantSku: variant.sku, personalization }
    const same = c.items.find((it) => lineKey(it) === lineKey(item))
    const room = Math.min(variant.stock, params.CART_MAX_QUANTITY) - (same ? same.quantity : 0)
    const quantity = Math.min(line.quantity, room)
    if (quantity <= 0 && !same) {
      skipped.push(line.name)
      continue
    }
    if (same) {
      same.quantity += Math.max(0, quantity)
      same.priceAtOrder = line.priceAtOrder
      addedIds.add(same._id)
    } else {
      if (c.items.length >= params.CART_MAX_ITEMS) {
        skipped.push(line.name)
        continue
      }
      const _id = String(new ObjectId())
      c.items.unshift({ _id, ...item, quantity, selected: true, priceAtOrder: line.priceAtOrder, addedAt: new Date() })
      addedIds.add(_id)
    }
  }
  if (addedIds.size) {
    for (const it of c.items) it.selected = addedIds.has(it._id)
    await saveCart(req, c)
  }
  return { view: await buildView(req, c), added: addedIds.size, skipped }
}

function findItem(cart, itemId) {
  const it = cart.items.find((x) => x._id === String(itemId))
  if (!it) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy sản phẩm trong giỏ")
  return it
}

// API-33: sửa biến thể, số lượng, cá nhân hóa, trạng thái chọn của 1 dòng. Lỗi thì dòng giữ nguyên (AC3).
async function updateItem(req, itemId, body) {
  const cart = await loadCart(req)
  const it = findItem(cart, itemId)
  const next = { ...it }

  const changesContent = body.variantSku !== undefined || body.quantity !== undefined || body.personalization !== undefined
  if (changesContent) {
    const p = await loadSellable(it.productId)
    if (body.variantSku !== undefined) {
      const v = findVariant(p, String(body.variantSku))
      if (!v) throw new HttpError(422, "VALIDATION_ERROR", "Phân loại không hợp lệ", { fields: { variantSku: "Phân loại không hợp lệ" } })
      next.variantSku = v.sku
    }
    if (body.quantity !== undefined) next.quantity = readQuantity(body.quantity)
    if (body.personalization !== undefined) next.personalization = await normalizeFor(p, body.personalization)
    assertStock(findVariant(p, next.variantSku), next.quantity)
  }

  if (body.selected !== undefined) {
    next.selected = body.selected === true
    if (next.selected) {
      const trial = { giftWrap: cart.giftWrap, items: cart.items.map((x) => ({ ...(x === it ? next : x) })) }
      const view = await buildView(req, trial, { persist: false })
      const line = view.items.find((x) => x._id === it._id)
      if (line && line.warning) {
        throw new HttpError(422, "ITEM_NOT_SELECTABLE", line.warning.message, { itemId: it._id })
      }
    }
  } else if (changesContent) {
    next.selected = true // sửa xong thì dòng được chọn lại (dòng lỗi đã sửa xong - UC-CRT-03 2Eb)
  }

  // Sửa xong trùng với 1 dòng khác (cùng biến thể, cùng nội dung) thì gộp vào dòng đó
  const twin = cart.items.find((x) => x !== it && lineKey(x) === lineKey(next))
  if (twin && changesContent) {
    const p = await loadSellable(it.productId)
    const total = twin.quantity + next.quantity
    assertStock(findVariant(p, next.variantSku), total)
    twin.quantity = Math.min(total, params.CART_MAX_QUANTITY)
    twin.selected = next.selected
    cart.items = cart.items.filter((x) => x !== it)
  } else {
    Object.assign(it, next)
  }
  await saveCart(req, cart)
  return buildView(req, cart)
}

// API-34
async function removeItem(req, itemId) {
  const cart = await loadCart(req)
  const it = findItem(cart, itemId)
  cart.items = cart.items.filter((x) => x !== it)
  if (!cart.items.length) cart.giftWrap = null // giỏ trống thì không còn gói quà (gói quà đi theo các dòng được chọn)
  await saveCart(req, cart)
  return buildView(req, cart)
}

// API-118: {all: true|false} hoặc {itemIds[], selected}; dòng đang có cảnh báo không được chọn
async function setSelection(req, body) {
  const cart = await loadCart(req)
  const view = await buildView(req, cart)
  const blocked = new Set(view.items.filter((x) => x.warning).map((x) => x._id))
  const ids = body.all !== undefined ? null : new Set((Array.isArray(body.itemIds) ? body.itemIds : []).map(String))
  const value = body.all !== undefined ? body.all === true : body.selected === true
  for (const it of cart.items) {
    if (ids && !ids.has(it._id)) continue
    it.selected = value && !blocked.has(it._id)
  }
  await saveCart(req, cart)
  return buildView(req, cart)
}

// API-35: chọn/đổi gói quà, bật/tắt ô chọn dòng gói quà hoặc gỡ hẳn (null)
async function setGiftWrap(req, body) {
  const cart = await loadCart(req)
  if (body && typeof body === "object" && body.source === undefined && typeof body.selected === "boolean") {
    if (!cart.giftWrap) throw new HttpError(404, "NOT_FOUND", "Giỏ hàng chưa có gói quà")
    cart.giftWrap.selected = body.selected
  } else {
    if (!cart.items.length && body && body.source) throw new HttpError(422, "BUSINESS_RULE", "Giỏ hàng trống, hãy thêm sản phẩm trước khi chọn gói quà")
    cart.giftWrap = await buildGiftWrap(req, body)
  }
  await saveCart(req, cart)
  return buildView(req, cart)
}

// ===== Gộp giỏ khi đăng nhập (02 Mục 2 ghi chú 2, UC-ACC-02 bước 5) =====
// Cùng sản phẩm, biến thể, nội dung thì cộng số lượng (không vượt tồn); khác thì thêm dòng; dòng gộp vào được chọn.
async function mergeInto(userId, guestCart) {
  const doc = await carts().findOne({ userId })
  const member = doc ? toPlain(doc) : emptyCart()
  const guest = guestCart ? toPlain(guestCart) : emptyCart()
  if (guest.items.length) {
    const ids = [...new Set(guest.items.map((it) => it.productId))].map(toId).filter(Boolean)
    const byId = new Map((await products().find({ _id: { $in: ids } }).toArray()).map((p) => [String(p._id), p]))
    const stockOf = (g) => {
      const p = byId.get(g.productId)
      const v = p ? findVariant(p, g.variantSku) : null
      return v ? v.stock || 0 : 0
    }
    member.items = mergeLines(member.items, guest.items, stockOf)
  }
  if (guest.giftWrap && !member.giftWrap) member.giftWrap = guest.giftWrap
  if (guest.items.length || guest.giftWrap) {
    await carts().updateOne(
      { userId },
      { $set: { ...toDb(member), updatedAt: new Date() }, $setOnInsert: { userId, createdAt: new Date() } },
      { upsert: true },
    )
  }
  return member.items.length
}

// Số dòng giỏ cho biểu tượng giỏ ở header
async function countFor(req) {
  return (await loadCart(req)).items.length
}

module.exports = {
  addLines,
  loadCart,
  saveCart,
  getView,
  buildView,
  addItem,
  updateItem,
  removeItem,
  setSelection,
  setGiftWrap,
  mergeInto,
  countFor,
  resolveMaterials,
  materialUsable,
  templateLive,
  variantImage,
  sellable,
  giftWrapView,
  // Đơn nháp (S8) kiểm tra cá nhân hóa, gói quà như khách tự thêm vào giỏ
  normalizeFor,
  buildGiftWrap,
  findVariant,
  readQuantity,
}
