// Thiết kế đã lưu của Member (07_API_Spec.md Mục 2.2, UC-ACC-06): API-14 GET, API-15 POST, API-16 PUT (_id trong
// body), API-17 DELETE. 2 loại: GOI_QUA (mẫu gói quà tự tạo) và CA_NHAN_HOA (nội dung In/Khắc, Thiết kế của 1 sản phẩm).
const { database, ObjectId } = require("../config/db")
const params = require("../config/params")
const HttpError = require("../utils/httpError")
const pz = require("../services/personalization")
const { resolveMaterials, materialUsable, variantImage, sellable } = require("../services/cart")

const designs = () => database.collection("designs")
const toId = (v) => (v && ObjectId.isValid(String(v)) ? new ObjectId(String(v)) : null)
const KINDS = ["GOI_QUA", "CA_NHAN_HOA"]
const kindOf = (d) => d.kind || "GOI_QUA" // document cũ chưa có kind là mẫu gói quà (06 Mục 3.2)

const readName = (v) => (typeof v === "string" ? v.normalize("NFC").trim() : "")
function assertName(name) {
  if (name.length < 1 || name.length > 60) {
    throw new HttpError(400, "VALIDATION_ERROR", "Tên mẫu cần 1-60 ký tự", { fields: { name: "Tên mẫu cần 1-60 ký tự" } })
  }
}

function readGiftMessage(v) {
  const message = typeof v === "string" ? v.normalize("NFC").trim() : ""
  if (pz.charCount(message) > params.GIFT_MESSAGE_MAX_CHARS) {
    throw new HttpError(400, "VALIDATION_ERROR", `Lời nhắn tối đa ${params.GIFT_MESSAGE_MAX_CHARS} ký tự`, { fields: { message: `Lời nhắn tối đa ${params.GIFT_MESSAGE_MAX_CHARS} ký tự` } })
  }
  return message
}

// Sản phẩm bán được và nội dung đã chuẩn hóa theo cấu hình hiện tại (BR-18, BR-19, BR-20, BR-33)
async function personalizationFor(productId, input) {
  const product = await database.collection("products").findOne({ _id: toId(productId) })
  if (!sellable(product)) throw new HttpError(404, "NOT_FOUND", "Sản phẩm không còn kinh doanh")
  const stickers = pz.stickerIndex(await pz.stickerSetsFor(product))
  const personalization = pz.normalizePersonalization(input, product, stickers)
  if (!personalization) throw new HttpError(400, "VALIDATION_ERROR", "Chọn In/Khắc hoặc Thiết kế trước khi lưu")
  return { product, personalization }
}

// Thông tin hiển thị thẻ ở SCR-21 và tab "Mẫu của tôi" của SCR-06
async function decorate(list) {
  const productIds = list.filter((d) => kindOf(d) === "CA_NHAN_HOA").map((d) => d.productId)
  const codes = list.filter((d) => kindOf(d) === "GOI_QUA").flatMap((d) => [d.paper, d.ribbon, d.card])
  const [prods, mats, sets] = await Promise.all([
    productIds.length ? database.collection("products").find({ _id: { $in: productIds } }).toArray() : [],
    codes.length ? database.collection("giftWrapMaterials").find({ code: { $in: codes } }).toArray() : [],
    productIds.length ? database.collection("stickerSets").find({}).project({ stickers: 1 }).toArray() : [],
  ])
  const pById = new Map(prods.map((p) => [String(p._id), p]))
  const mByCode = new Map(mats.map((m) => [m.code, m]))
  const sByCode = new Map(sets.flatMap((s) => (s.stickers || []).map((x) => [x.code, { code: x.code, name: x.name, image: x.image }])))
  const now = new Date()

  const out = []
  for (const d of list) {
    const base = { _id: d._id, kind: kindOf(d), name: d.name, createdAt: d.createdAt, updatedAt: d.updatedAt }
    if (base.kind === "GOI_QUA") {
      const part = (code) => {
        const m = mByCode.get(code)
        return m ? { code, name: m.name, image: m.image || null, available: materialUsable(m) } : { code, name: code, image: null, available: false }
      }
      const paper = part(d.paper)
      const ribbon = part(d.ribbon)
      const card = part(d.card)
      out.push({ ...base, paper, ribbon, card, message: d.message || "", available: paper.available && ribbon.available && card.available })
      continue
    }
    const p = pById.get(String(d.productId))
    const live = sellable(p)
    // Dùng lại được khi sản phẩm còn bán và còn cho phép hình thức đó (UC-ACC-06 2aEa); sticker hết mùa vẫn mở được (2aEb)
    let usable = live && pz.allowedTypes(p).includes(d.personalization?.type)
    let stickerGone = false
    if (usable && d.personalization.type === "THIET_KE") {
      const map = pz.stickerIndex(await pz.stickerSetsFor(p, now))
      stickerGone = (d.personalization.stickers || []).some((c) => !map.has(c))
    }
    if (usable && d.personalization.type === "IN_KHAC") usable = pz.engraveConfig(p).mode === d.personalization.mode
    out.push({
      ...base,
      productId: d.productId,
      personalization: {
        ...d.personalization,
        ...(d.personalization?.type === "THIET_KE" ? { stickerDetails: (d.personalization.stickers || []).map((c) => sByCode.get(c) || { code: c, name: c, image: null }) } : {}),
      },
      product: p
        ? { name: p.name, slug: p.slug, image: variantImage(p, null), status: p.status, available: live }
        : { name: "Sản phẩm không còn tồn tại", slug: null, image: null, status: null, available: false },
      usable,
      stickerGone,
    })
  }
  return out
}

// API-14 GET /api/account/designs?kind=GOI_QUA|CA_NHAN_HOA - mới nhất trước
async function listDesigns(req, res) {
  const filter = { userId: req.user._id }
  if (req.query.kind === "CA_NHAN_HOA") filter.kind = "CA_NHAN_HOA"
  else if (req.query.kind === "GOI_QUA") filter.kind = { $in: ["GOI_QUA", null] }
  const list = await designs().find(filter).sort({ createdAt: -1, _id: -1 }).toArray()
  res.send(await decorate(list))
}

async function findOwn(req, id) {
  const d = await designs().findOne({ _id: toId(id), userId: req.user._id })
  if (!d) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy thiết kế")
  return d
}

// API-15 POST /api/account/designs - {kind: GOI_QUA, name, paper, ribbon, card, message} | {kind: CA_NHAN_HOA, name?, productId, personalization}
async function createDesign(req, res) {
  const body = req.body || {}
  const kind = KINDS.includes(body.kind) ? body.kind : "GOI_QUA"
  // Tự lưu khi bấm Áp dụng: cùng sản phẩm, cùng nội dung thì cập nhật tên bản đã có, không tạo bản trùng
  if (kind === "CA_NHAN_HOA") {
    const { product, personalization } = await personalizationFor(body.productId, body.personalization)
    const key = pz.personalizationKey(personalization)
    const same = (await designs().find({ userId: req.user._id, kind, productId: product._id }).toArray()).find((d) => pz.personalizationKey(d.personalization) === key)
    if (same) {
      const name = readName(body.name) || same.name
      assertName(name)
      await designs().updateOne({ _id: same._id }, { $set: { name, updatedAt: new Date() } })
      return res.send((await decorate([{ ...same, name }]))[0])
    }
  }
  if ((await designs().countDocuments({ userId: req.user._id })) >= params.SAVED_DESIGNS_MAX) {
    throw new HttpError(422, "BUSINESS_RULE", `Bạn đã lưu tối đa ${params.SAVED_DESIGNS_MAX} thiết kế, hãy xóa bớt thiết kế cũ`)
  }
  const now = new Date()
  let doc
  if (kind === "GOI_QUA") {
    const name = readName(body.name)
    assertName(name)
    const message = readGiftMessage(body.message)
    await resolveMaterials({ paper: body.paper, ribbon: body.ribbon, card: body.card }, { requireStock: false })
    doc = { userId: req.user._id, kind, name, paper: body.paper, ribbon: body.ribbon, card: body.card, message }
  } else {
    const { product, personalization } = await personalizationFor(body.productId, body.personalization)
    const name = readName(body.name) || pz.suggestDesignName(product, personalization)
    assertName(name)
    doc = { userId: req.user._id, kind, name, productId: product._id, personalization }
  }
  Object.assign(doc, { createdAt: now, updatedAt: now })
  doc._id = (await designs().insertOne(doc)).insertedId
  res.status(201).send((await decorate([doc]))[0])
}

// API-16 PUT /api/account/designs - _id trong body; không đổi kind
async function updateDesign(req, res) {
  const body = req.body || {}
  const d = await findOwn(req, body._id)
  const set = { updatedAt: new Date() }
  if (body.name !== undefined) {
    set.name = readName(body.name)
    assertName(set.name)
  }
  if (kindOf(d) === "GOI_QUA") {
    const codes = { paper: body.paper ?? d.paper, ribbon: body.ribbon ?? d.ribbon, card: body.card ?? d.card }
    await resolveMaterials(codes, { requireStock: false })
    Object.assign(set, codes)
    if (body.message !== undefined) set.message = readGiftMessage(body.message)
  } else if (body.personalization !== undefined) {
    set.personalization = (await personalizationFor(d.productId, body.personalization)).personalization
  }
  await designs().updateOne({ _id: d._id }, { $set: set })
  res.send((await decorate([{ ...d, ...set }]))[0])
}

// API-17 DELETE /api/account/designs/:id - đơn đã đặt giữ bản chụp nên không ảnh hưởng (AC2)
async function deleteDesign(req, res) {
  const d = await findOwn(req, req.params["id"])
  await designs().deleteOne({ _id: d._id })
  res.status(204).send()
}

module.exports = { listDesigns, createDesign, updateDesign, deleteDesign }
