// Đặt hàng (UC-PAY-01, PAY-02, PAY-03, PAY-04; 07_API_Spec.md API-36, 37, 38). Hai bước để S6 dùng lại:
//   prepare(req, body): đọc giỏ, kiểm tra dữ liệu và BR, tính tiền -> bản chụp đơn (chưa ghi gì)
//   place(snapshot, ctx): trừ tồn kho có điều kiện, tăng lượt voucher, tạo đơn; lỗi ở bước nào thì hoàn tác các bước trước
// Trừ tồn có điều kiện stock >= qty thay transaction (UC-PAY-04 ghi chú kỹ thuật, sửa C9): 2 khách cùng đặt món cuối
// thì chỉ 1 lệnh cập nhật khớp điều kiện (AC5).
const { database, ObjectId } = require("../config/db")
const params = require("../config/params")
const HttpError = require("../utils/httpError")
const v = require("../utils/validators")
const cart = require("./cart")
const voucher = require("./voucher")
const math = require("./checkoutMath")
const { getStoreSettings } = require("./settings")
const { nextSequence } = require("./giftAdmin")
const { createToken } = require("./tokens")
const { notifier } = require("./notifier")
const pz = require("./personalization")

const users = () => database.collection("users")
const products = () => database.collection("products")
const orders = () => database.collection("orders")
const isMember = (req) => !!(req.user && req.user.role === "member")
const dmy = (ymd) => ymd.slice(8, 10) + "/" + ymd.slice(5, 7) + "/" + ymd.slice(0, 4)
const text = (value, max) => (typeof value === "string" ? value.normalize("NFC").trim().slice(0, max) : "")

// ===== Đọc giỏ cho bước thanh toán =====

// Dòng được chọn, hợp lệ (buildView đã tự bỏ chọn dòng lỗi) kèm SKU, danh mục để xét phạm vi voucher
async function checkoutLines(req) {
  return linesFromView(await cart.buildView(req, await cart.loadCart(req)))
}

// Dòng tính tiền từ một bảng giỏ đã dựng (cart.buildView): giỏ của khách, hoặc danh sách sản phẩm của đơn nháp (S8)
async function linesFromView(view) {
  const chosen = view.items.filter((it) => it.selected && !it.warning)
  if (!chosen.length) throw new HttpError(422, "NO_ITEM_SELECTED", "Giỏ hàng chưa có sản phẩm nào được chọn để thanh toán")
  const ids = [...new Set(chosen.map((it) => it.productId))].map((id) => new ObjectId(id))
  const info = new Map((await products().find({ _id: { $in: ids } }, { projection: { sku: 1, categoryId: 1 } }).toArray()).map((p) => [String(p._id), p]))
  const lines = chosen.map((it) => ({
    ...it,
    sku: info.get(it.productId)?.sku || null,
    categoryId: info.get(it.productId)?.categoryId ? String(info.get(it.productId).categoryId) : null,
    isPersonalized: !!it.personalization,
  }))
  const giftWrap = view.giftWrap && view.giftWrap.selected ? view.giftWrap : null
  return { lines, giftWrap }
}

// Tài khoản sẽ giữ đơn: Member đang đăng nhập; Guest theo SĐT (chỉ tìm, chưa tạo) để đếm lượt voucher mỗi người
async function ownerFor(req, phone) {
  if (isMember(req)) return req.user
  return v.isPhone(phone) ? users().findOne({ phone, role: "member" }) : null
}

// Bảng tiền + voucher + lựa chọn thanh toán, dùng chung cho API-37 và API-38
async function price(user, body, base, owner) {
  const settings = await getStoreSettings()
  const recipientType = body.recipientType === "OTHER" ? "OTHER" : "SELF"
  const codes = math.readCodes(body.voucherCodes ?? body.voucherCode)
  const shippingFee = settings.shippingFee
  const { applied, errors } = await voucher.evaluate(codes, {
    user, ownerId: owner ? owner._id : null, lines: base.lines, shippingFee,
  })
  const m = math.money(base.lines, { shippingFee, depositRate: settings.depositRate, discounts: applied, recipientType, urgentFee: Number(body.urgentFee) || 0 })
  const options = math.paymentOptions(m, recipientType, settings.payments)
  return { settings, recipientType, applied, errors, m, options }
}

const voucherView = (a) => ({ code: a.voucher.code, name: a.voucher.name, type: a.voucher.type, kind: a.kind, value: a.voucher.value, discount: a.discount })

function itemView(l) {
  return {
    _id: l._id, productId: l.productId, slug: l.slug, name: l.name, image: l.image, variantName: l.variantName, quantity: l.quantity,
    personalization: l.personalization, unitPrice: l.unitPrice, originalUnitPrice: l.originalUnitPrice,
    personalizationFeePerUnit: l.personalizationFeePerUnit, lineValue: l.lineValue, isPersonalized: l.isPersonalized,
  }
}

// API-37 POST /api/checkout/quote
async function quote(req, body) {
  const base = await checkoutLines(req)
  const owner = await ownerFor(req, v.str(body.contact?.phone).replace(/[\s.]/g, ""))
  const { settings, recipientType, applied, errors, m, options } = await price(isMember(req) ? req.user : null, body, base, owner)
  const chosen = math.pickOption(options, body.paymentChoice, body.remainingMethod) || options[0] || null
  return {
    items: base.lines.map(itemView),
    giftWrap: base.giftWrap,
    recipientType,
    ...m,
    vouchers: applied.map(voucherView),
    voucherErrors: errors.map(({ code, message, hint, loginHint }) => ({ code, message, hint: hint || null, loginHint: !!loginHint })),
    paymentOptions: options,
    allowedMethods: options.map((o) => o.key),
    amountDueNow: chosen ? chosen.amountDueNow : null,
    // BR-40: tắt Online 100% thì không chọn được Giao người nhận
    canSendToOther: settings.payments.onlineFull !== false,
    // Ngày giao sớm nhất theo tỉnh đang chọn và món cá nhân hóa; khách đổi tỉnh thì client tính lại
    delivery: math.deliveryRange(new Date(), { province: v.str(body.shippingAddress?.province), personalized: m.hasPersonalized }),
  }
}

// API-36 POST /api/checkout/voucher: kiểm tra 1 mã cho các dòng đang chọn; không gửi mã thì trả kho ưu đãi
async function checkVoucher(req, body) {
  const base = await checkoutLines(req)
  const settings = await getStoreSettings()
  const user = isMember(req) ? req.user : null
  const code = math.readCodes(body.code)[0]
  if (!code) return voucher.walletForCheckout({ user, lines: base.lines, shippingFee: settings.shippingFee })

  const { applied, errors } = await voucher.evaluate([code], { user, ownerId: user && user._id, lines: base.lines, shippingFee: settings.shippingFee })
  if (errors.length) {
    const e = errors[0]
    throw new HttpError(e.status || 422, e.errorCode || "VOUCHER_INVALID", e.message, { hint: e.hint || null, loginHint: !!e.loginHint })
  }
  const a = applied[0]
  // Đơn đã có mã cùng nhóm thì mã mới sẽ thay mã đó (UC-PAY-03 1a) - client hỏi khách trước khi thay
  const current = math.readCodes(body.appliedCodes).filter((c) => c !== code)
  const sameKind = current.length ? await database.collection("vouchers").find({ code: { $in: current } }, { projection: { code: 1, type: 1 } }).toArray() : []
  const replaces = sameKind.find((x) => math.kindOf(x.type) === a.kind)
  return { ...voucherView(a), replaces: replaces ? replaces.code : null }
}

// ===== Kiểm tra dữ liệu đặt hàng (API-38) =====

function readContact(req, body) {
  if (isMember(req) && req.user.phone) return { fullName: req.user.fullName, phone: req.user.phone, ...(req.user.email ? { email: req.user.email } : {}) }
  // Member tạo bằng Google chưa có SĐT: nhập SĐT ở form như Guest, họ tên và email lấy từ tài khoản
  if (isMember(req)) body = { ...body, contact: { ...(body.contact || {}), fullName: req.user.fullName, email: req.user.email || "" } }
  const c = body.contact || {}
  const contact = { fullName: text(c.fullName, 60), phone: v.str(c.phone).replace(/[\s.]/g, ""), email: v.str(c.email).toLowerCase() }
  v.assertFields({
    "contact.fullName": contact.fullName.length >= 2 ? "" : "Vui lòng nhập họ và tên",
    "contact.phone": v.isPhone(contact.phone) ? "" : "Số điện thoại cần 10 số, bắt đầu bằng 0",
    "contact.email": !contact.email || v.isEmail(contact.email) ? "" : "Email không hợp lệ",
  })
  if (!contact.email) delete contact.email
  return contact
}

// opts.personalized: đơn có món cá nhân hóa (tính ngày sớm nhất); opts.urgent: đặt gấp chọn được từ ngày mai
function readShipping(body, recipientType, contact, opts = {}) {
  const a = body.shippingAddress || {}
  const address = {
    recipientName: text(a.recipientName, 60) || (recipientType === "SELF" ? contact.fullName : ""),
    phone: v.str(a.phone).replace(/[\s.]/g, "") || (recipientType === "SELF" ? contact.phone : ""),
    province: text(a.province, 60),
    ward: text(a.ward, 80),
    street: text(a.street, 200),
  }
  const range = math.deliveryRange(opts.now || new Date(), { province: address.province, personalized: !!opts.personalized })
  const deliveryDate = v.str(body.deliveryDate)
  const deliveryWindow = v.str(body.deliveryWindow)
  const noteForShop = typeof body.noteForShop === "string" ? body.noteForShop.normalize("NFC").trim() : ""
  const noteForShipper = typeof body.noteForShipper === "string" ? body.noteForShipper.normalize("NFC").trim() : ""
  const fields = {
    "shippingAddress.recipientName": address.recipientName.length >= 2 ? "" : "Vui lòng nhập tên người nhận",
    "shippingAddress.phone": v.isPhone(address.phone) ? "" : "Số điện thoại cần 10 số, bắt đầu bằng 0",
    "shippingAddress.province": address.province ? "" : "Vui lòng chọn Tỉnh/Thành phố",
    "shippingAddress.ward": address.ward ? "" : "Vui lòng chọn Phường/Xã",
    "shippingAddress.street": address.street.length >= 3 ? "" : "Nhập số nhà, tên đường",
    noteForShop: pz.charCount(noteForShop) <= params.NOTE_MAX_CHARS ? "" : `Ghi chú tối đa ${params.NOTE_MAX_CHARS} ký tự`,
    noteForShipper: pz.charCount(noteForShipper) <= params.NOTE_MAX_CHARS ? "" : `Ghi chú tối đa ${params.NOTE_MAX_CHARS} ký tự`,
  }
  // Giao người nhận: Ngày giao và Khung giờ bắt buộc (UC-PAY-02 2a), ngày từ ngày sớm nhất.
  // Đặt gấp: chọn ngày mong muốn từ ngày mai, cả Giao cho tôi; khung giờ không bắt buộc với Giao cho tôi.
  const validDay = /^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)
  if (opts.urgent) {
    fields.deliveryDate = validDay && deliveryDate >= range.urgentMin && deliveryDate <= range.max ? "" : "Vui lòng chọn ngày bạn muốn nhận (từ ngày mai)"
    if (recipientType === "OTHER" || deliveryWindow) fields.deliveryWindow = range.slots.includes(deliveryWindow) ? "" : "Vui lòng chọn khung giờ"
  } else if (recipientType === "OTHER") {
    fields.deliveryDate = validDay && deliveryDate >= range.min && deliveryDate <= range.max
      ? ""
      : validDay && deliveryDate < range.min ? `Ngày giao sớm nhất là ${dmy(range.min)}, cần sớm hơn hãy chọn Đặt gấp` : "Vui lòng chọn ngày giao"
    fields.deliveryWindow = range.slots.includes(deliveryWindow) ? "" : "Vui lòng chọn khung giờ"
  }
  v.assertFields(fields)
  const withDate = recipientType === "OTHER" || opts.urgent
  return {
    shippingAddress: {
      ...address,
      ...(withDate ? { deliveryDate, deliveryWindow: deliveryWindow || null } : {}),
      noteForShipper,
    },
    noteForShop,
    // Ngày dự kiến giao lưu vào đơn: ngày khách chọn, không chọn thì ngày sớm nhất (SCR-09, SCR-19 đọc chung)
    expectedDeliveryDate: withDate ? deliveryDate : range.min,
  }
}

// API-38 bước 1-3: trả bản chụp đơn (cũng là checkoutSnapshot của giao dịch online ở S6)
async function prepare(req, body) {
  const contact = readContact(req, body)
  const recipientType = body.recipientType === "OTHER" ? "OTHER" : "SELF"
  const base = await checkoutLines(req)
  const { shippingAddress, noteForShop, expectedDeliveryDate } = readShipping(body, recipientType, contact, { personalized: base.lines.some((l) => l.isPersonalized) })
  if (body.acceptPolicy !== true) {
    throw new HttpError(422, "POLICY_NOT_ACCEPTED", "Vui lòng đồng ý Chính sách thanh toán và đặt cọc", { fields: { acceptPolicy: "Vui lòng đồng ý Chính sách thanh toán và đặt cọc" } })
  }

  if (base.giftWrap && !base.giftWrap.available) {
    throw new HttpError(409, "GIFT_WRAP_UNAVAILABLE", `Gói quà "${base.giftWrap.name}" tạm hết vật liệu, vui lòng chọn mẫu khác`)
  }
  const owner = await ownerFor(req, contact.phone)
  if (!isMember(req) && !owner && (await users().findOne({ phone: contact.phone, role: "admin" }, { projection: { _id: 1 } }))) {
    throw new HttpError(422, "VALIDATION_ERROR", "Số điện thoại này thuộc tài khoản nhân viên, vui lòng dùng số khác", { fields: { "contact.phone": "Số điện thoại thuộc tài khoản nhân viên" } })
  }
  const { recipientType: rt, applied, errors, m, options } = await price(isMember(req) ? req.user : null, { ...body, recipientType }, base, owner)

  // Voucher không còn hợp lệ lúc đặt: bỏ mã, báo khách xác nhận lại tổng mới (UC-PAY-03 2Ef, AC4)
  if (errors.length) {
    throw new HttpError(409, "VOUCHER_INVALID", `Mã ${errors[0].code}: ${errors[0].message}. Tổng tiền đã được tính lại, vui lòng kiểm tra trước khi đặt hàng`, {
      invalidCodes: errors.map((e) => e.code),
    })
  }
  const option = math.pickOption(options, body.paymentChoice, body.remainingMethod)
  if (!option) {
    if (rt === "OTHER" && body.paymentChoice === "COD") {
      throw new HttpError(422, "BUSINESS_RULE", "Đơn giao người nhận cần thanh toán online 100%", { rule: "BR-02" })
    }
    if (m.hasPersonalized && rt === "SELF" && body.paymentChoice === "COD") {
      throw new HttpError(422, "BUSINESS_RULE", "Đơn có sản phẩm cá nhân hóa cần đặt cọc online", { rule: "BR-03" })
    }
    throw new HttpError(422, "BUSINESS_RULE", "Phương thức thanh toán không áp dụng cho đơn này", { rule: "BR-40" })
  }
  // Tổng tiền khác lần tính khách đã xem (giá, phí, voucher vừa đổi): không tạo đơn, trả bảng tiền mới (6Ea)
  if (body.expectedTotal !== undefined && Number(body.expectedTotal) !== m.total) {
    throw new HttpError(409, "PRICE_CHANGED", "Tổng tiền vừa thay đổi, vui lòng kiểm tra lại trước khi đặt hàng", { total: m.total })
  }

  return {
    sessionId: req.sessionID,
    memberId: isMember(req) ? req.user._id : null,
    contact,
    recipientType: rt,
    shippingAddress,
    noteForShop,
    expectedDeliveryDate,
    sourceAddressId: v.str(body.shippingAddress?.sourceAddressId) || null,
    setAsDefault: body.setAsDefault === true,
    lines: base.lines,
    giftWrap: base.giftWrap,
    vouchers: applied.map((a) => ({ voucherId: a.voucher._id, code: a.voucher.code, type: a.voucher.type, value: a.voucher.value, discount: a.discount })),
    money: m,
    option,
    policyAcceptedAt: new Date(),
  }
}

// ===== Tạo đơn (API-38 bước 4) =====

// Gom số lượng theo biến thể (2 dòng cùng biến thể, khác nội dung cá nhân hóa trừ chung 1 lần)
function stockNeeds(lines) {
  const map = new Map()
  for (const l of lines) {
    const key = `${l.productId}|${l.variantSku}`
    const cur = map.get(key) || { productId: l.productId, variantSku: l.variantSku, name: l.name, quantity: 0 }
    cur.quantity += l.quantity
    map.set(key, cur)
  }
  return [...map.values()]
}

// Thực hiện lần lượt, ghi lại cách hoàn tác; lỗi thì chạy hoàn tác theo thứ tự ngược
async function rollback(undo) {
  for (const fn of undo.reverse()) {
    try {
      await fn()
    } catch (err) {
      console.error("Hoàn tác đặt hàng lỗi:", err.message)
    }
  }
}

async function reserveStock(lines, undo) {
  for (const need of stockNeeds(lines)) {
    const r = await products().updateOne(
      { _id: new ObjectId(need.productId), status: "DANG_HIEN_THI", variants: { $elemMatch: { sku: need.variantSku, isActive: { $ne: false }, stock: { $gte: need.quantity } } } },
      { $inc: { "variants.$.stock": -need.quantity } },
    )
    if (!r.modifiedCount) {
      throw new HttpError(409, "OUT_OF_STOCK", `Sản phẩm ${need.name} vừa hết hàng, vui lòng cập nhật giỏ hàng`, { productId: need.productId, variantSku: need.variantSku })
    }
    undo.push(() => products().updateOne({ _id: new ObjectId(need.productId), "variants.sku": need.variantSku }, { $inc: { "variants.$.stock": need.quantity } }))
  }
}

// Gói quà trừ 1 đơn vị mỗi vật liệu (BR-36), trả tồn sau khi trừ để ghi stockMovements
async function reserveMaterials(giftWrap, undo) {
  if (!giftWrap) return []
  const taken = []
  for (const slot of ["paper", "ribbon", "card"]) {
    const code = giftWrap[slot]?.code
    const m = await database.collection("giftWrapMaterials").findOneAndUpdate(
      { code, isActive: { $ne: false }, stock: { $gte: 1 } },
      { $inc: { stock: -1 } },
      { returnDocument: "after" },
    )
    if (!m) throw new HttpError(409, "GIFT_WRAP_UNAVAILABLE", `Gói quà "${giftWrap.name}" tạm hết ${giftWrap[slot]?.name || code}, vui lòng chọn mẫu khác`)
    undo.push(() => database.collection("giftWrapMaterials").updateOne({ _id: m._id }, { $inc: { stock: 1 } }))
    taken.push(m)
  }
  return taken
}

// Tăng lượt và ngân sách đã dùng có điều kiện (BR-23): không vượt tổng lượt, không vượt ngân sách
async function useVouchers(list, undo) {
  for (const x of list) {
    const r = await database.collection("vouchers").updateOne(
      {
        _id: x.voucherId,
        status: "HOAT_DONG",
        $expr: {
          $and: [
            { $lt: [{ $ifNull: ["$usedCount", 0] }, { $ifNull: ["$totalQuantity", Number.MAX_SAFE_INTEGER] }] },
            { $lte: [{ $add: [{ $ifNull: ["$discountGiven", 0] }, x.discount] }, { $ifNull: ["$maxBudget", Number.MAX_SAFE_INTEGER] }] },
          ],
        },
      },
      { $inc: { usedCount: 1, discountGiven: x.discount } },
    )
    if (!r.modifiedCount) throw new HttpError(409, "VOUCHER_INVALID", `Mã ${x.code}: Mã giảm giá đã hết lượt sử dụng. Tổng tiền đã được tính lại, vui lòng kiểm tra trước khi đặt hàng`, { invalidCodes: [x.code] })
    undo.push(() => database.collection("vouchers").updateOne({ _id: x.voucherId }, { $inc: { usedCount: -1, discountGiven: -x.discount } }))
  }
}

// Guest Checkout: tìm tài khoản theo SĐT, chưa có thì tạo CHO_KICH_HOAT (UC-PAY-01 bước 6)
async function guestAccount(contact, undo) {
  const found = await users().findOne({ phone: contact.phone })
  if (found) return { user: found, created: false }
  const now = new Date()
  const emailFree = contact.email && !(await users().findOne({ email: contact.email }, { projection: { _id: 1 } }))
  const user = {
    fullName: contact.fullName, phone: contact.phone, ...(emailFree ? { email: contact.email } : {}),
    role: "member", status: "CHO_KICH_HOAT", staffRoles: [], permissionOverrides: [], addresses: [], wishlist: [], searchHistory: [],
    failedLogins: 0, lockedUntil: null, createdAt: now, updatedAt: now,
  }
  user._id = (await users().insertOne(user)).insertedId
  undo.push(() => users().deleteOne({ _id: user._id }))
  return { user, created: true }
}

// Phần tử orders.items (06 Mục 4.2): chụp tên, ảnh, giá, sticker
function orderItem(l) {
  const { stickerDetails, ...p } = l.personalization || {}
  return {
    _id: new ObjectId(),
    productId: new ObjectId(l.productId),
    sku: l.sku,
    variantSku: l.variantSku,
    name: l.name,
    variantName: l.variantName,
    image: l.image,
    unitPrice: l.unitPrice,
    quantity: l.quantity,
    personalization: l.personalization
      ? { ...p, ...(p.type === "THIET_KE" ? { stickers: (stickerDetails || []).map((s) => ({ code: s.code, name: s.name, image: s.image || null })) } : {}) }
      : null,
    personalizationFeePerUnit: l.personalizationFeePerUnit,
    isPersonalized: l.isPersonalized,
    lineValue: l.lineValue,
    fulfillStatus: "BINH_THUONG",
    reviewed: false,
  }
}

function giftWrapSnapshot(g) {
  if (!g) return null
  const part = (x) => (x ? { code: x.code, name: x.name } : null)
  // Lưu mã mẫu gợi ý để chép đơn giữ đúng nguồn "Mẫu gợi ý"
  return { source: g.source, templateId: g.source === "GOI_Y" && g.templateId ? g.templateId : null, name: g.name, paper: part(g.paper), ribbon: part(g.ribbon), card: part(g.card), message: g.message || "" }
}

// Lưu địa chỉ của đơn vào sổ (BR-22): khác mọi địa chỉ đã có thì thêm mới; "Đặt làm địa chỉ của tôi" hoặc địa chỉ
// đầu tiên thì thành mặc định. Lỗi không chặn đơn (UC-PAY-02 6aEa).
const ADDRESS_KEYS = ["recipientName", "phone", "province", "ward", "street"]
const sameAddress = (a, b) => ADDRESS_KEYS.every((k) => String(a[k] || "").trim().toLowerCase() === String(b[k] || "").trim().toLowerCase())

async function saveToAddressBook(userId, snap) {
  try {
    const u = await users().findOne({ _id: userId }, { projection: { addresses: 1 } })
    let list = (u && u.addresses) || []
    const addr = Object.fromEntries(ADDRESS_KEYS.map((k) => [k, snap.shippingAddress[k]]))
    let target = list.find((x) => sameAddress(x, addr))
    if (!target) {
      target = { _id: new ObjectId(), ...addr, isDefault: false }
      list.push(target)
    }
    if (snap.setAsDefault || list.length === 1) list = list.map((x) => ({ ...x, isDefault: x === target }))
    await users().updateOne({ _id: userId }, { $set: { addresses: list, updatedAt: new Date() } })
  } catch (err) {
    console.error("Lưu sổ địa chỉ sau khi đặt hàng lỗi:", err.message)
  }
}

// Xóa các dòng đã đặt và gói quà (nếu đơn có gói quà) khỏi giỏ; dòng không được chọn vẫn giữ (UC-PAY-04 bước 6)
async function clearOrderedLines(req, snap) {
  const c = await cart.loadCart(req)
  const ordered = new Set(snap.lines.map((l) => l._id))
  c.items = c.items.filter((it) => !ordered.has(it._id))
  if (snap.giftWrap || !c.items.length) c.giftWrap = null
  await cart.saveCart(req, c)
}

// API-38 bước 4: tạo đơn từ bản chụp. ctx.req để dọn giỏ, ghi session; ctx.paidAmount với đơn đã trả online (API-40).
async function place(snap, ctx) {
  const undo = []
  const now = new Date()
  try {
    await reserveStock(snap.lines, undo)
    const materials = await reserveMaterials(snap.giftWrap, undo)
    await useVouchers(snap.vouchers, undo)

    let owner
    let accountCreated = false
    if (snap.memberId) owner = await users().findOne({ _id: snap.memberId })
    else {
      const r = await guestAccount(snap.contact, undo)
      owner = r.user
      accountCreated = r.created
    }

    const seq = await nextSequence("order-" + math.vnDate(now).slice(2).replace(/-/g, ""))
    const m = snap.money
    const paidAmount = ctx.paidAmount || 0
    // Đơn gấp: shop đã chốt trước khi khách thanh toán nên bỏ qua Chờ xác nhận, vào thẳng bước xử lý
    const startStatus = snap.urgentCode ? (m.hasPersonalized ? "DANG_CA_NHAN_HOA" : "DANG_CHUAN_BI") : "CHO_XAC_NHAN"
    const history = [{ field: "orderStatus", from: null, to: "CHO_XAC_NHAN", at: now, by: snap.staffId || null, byRole: snap.staffId ? "NHAN_VIEN" : "HE_THONG", note: snap.draftCode ? `Tạo bởi nhân viên từ đơn nháp #${snap.draftCode}` : null }]
    if (startStatus !== "CHO_XAC_NHAN") history.push({ field: "orderStatus", from: "CHO_XAC_NHAN", to: startStatus, at: now, by: null, byRole: "HE_THONG", note: `Tự xác nhận: đơn gấp #${snap.urgentCode} đã được shop chốt` })
    const order = {
      code: math.orderCode(now, seq),
      userId: owner._id,
      customer: snap.contact,
      createdBy: snap.createdBy || "KHACH",
      source: snap.source || "WEBSITE",
      ...(snap.draftCode ? { draftCode: snap.draftCode } : {}),
      tags: snap.tags || [],
      items: snap.lines.map(orderItem),
      hasPersonalizedItems: m.hasPersonalized,
      giftWrap: giftWrapSnapshot(snap.giftWrap),
      recipientType: snap.recipientType,
      shippingAddress: snap.shippingAddress,
      noteForShop: snap.noteForShop,
      subtotal: m.subtotal,
      personalizationFee: m.personalizationFee,
      giftWrapFee: m.giftWrapFee,
      shippingFee: m.shippingFee,
      ...(m.urgentFee ? { urgentFee: m.urgentFee } : {}),
      discount: m.discount,
      total: m.total,
      vouchers: snap.vouchers,
      ...(snap.expectedDeliveryDate ? { expectedDeliveryDate: snap.expectedDeliveryDate } : {}),
      ...(snap.urgentCode ? { urgentCode: snap.urgentCode } : {}),
      depositAmount: snap.option.key === "DEPOSIT_COD" ? m.depositAmount : 0,
      remainingAmount: snap.option.key === "DEPOSIT_COD" ? m.remainingAmount : snap.option.key === "COD" ? m.total : 0,
      paymentMethod: snap.option.paymentChoice,
      remainingMethod: snap.option.remainingMethod,
      paidAmount,
      refundedAmount: 0,
      orderStatus: startStatus,
      ...(startStatus === "DANG_CA_NHAN_HOA" ? { personalizationStartedAt: now } : {}),
      paymentStatus: paidAmount <= 0 ? "CHUA_THANH_TOAN" : paidAmount < m.total ? "DA_COC" : "DA_THANH_TOAN",
      returnStatus: "KHONG_CO",
      statusHistory: history,
      redeliveryCount: 0,
      internalNotes: snap.internalNote ? [{ _id: new ObjectId(), at: now, by: snap.staffId || null, text: snap.internalNote, attachments: [] }] : [],
      policyAcceptedAt: snap.policyAcceptedAt,
      createdAt: now,
      updatedAt: now,
    }
    order._id = (await orders().insertOne(order)).insertedId

    // Sau khi đơn đã có: các việc phụ không làm hỏng đơn nếu lỗi
    await afterPlaced(order, snap, { owner, accountCreated, materials, req: ctx.req })
    return { order, owner, accountCreated }
  } catch (err) {
    await rollback(undo)
    throw err
  }
}

async function afterPlaced(order, snap, { owner, accountCreated, materials, req }) {
  const now = order.createdAt
  try {
    if (materials.length) {
      await database.collection("stockMovements").insertMany(
        materials.map((m) => ({ materialId: m._id, materialCode: m.code, type: "XUAT_DON", quantity: -1, orderCode: order.code, stockAfter: m.stock, by: null, createdAt: now })),
      )
    }
    for (const need of stockNeeds(snap.lines)) {
      await products().updateOne({ _id: new ObjectId(need.productId) }, { $set: { hasOrders: true }, $inc: { soldCount: need.quantity } })
    }
    for (const x of snap.vouchers) {
      await database.collection("userVouchers").updateOne({ userId: owner._id, voucherId: x.voucherId }, { $inc: { usedCount: 1 }, $set: { lastOrderCode: order.code } })
    }
    // Đơn từ dòng giỏ thêm qua Tư vấn AI: ghi mã đơn vào aiSessions.orderCodes (số liệu SCR-40 nhóm Tư vấn AI)
    const aiIds = [...new Set(snap.lines.map((l) => l.aiSessionId).filter((id) => id && ObjectId.isValid(String(id))))]
    if (aiIds.length) {
      await database.collection("aiSessions").updateMany({ _id: { $in: aiIds.map((id) => new ObjectId(String(id))) } }, { $addToSet: { orderCodes: order.code } })
    }
    if (req) await clearOrderedLines(req, snap)
    // Tài khoản tạo bằng Google chưa có SĐT: lưu SĐT liên hệ của đơn đầu tiên
    if (owner && !owner.phone) await require("./googleAuth").fillMissingPhone(owner._id, snap.contact?.phone)
    // Đơn nháp do nhân viên nhập địa chỉ: không tự lưu vào sổ địa chỉ của khách (BR-22 áp dụng khi khách tự đặt).
    // Đơn gấp: địa chỉ do khách tự nhập ở SCR-07 nên vẫn lưu.
    if (snap.memberId && (!snap.draftCode || snap.urgentCode)) await saveToAddressBook(owner._id, snap)
    // Đơn gấp: báo trong khung chat của yêu cầu, gỡ nhãn Đơn gấp
    if (snap.urgentCode) await require("./urgentOrders").onPlaced(order)
    await notifier.notify(owner, {
      type: "DON_HANG", title: `Đặt hàng thành công ${order.code}`,
      body: order.paymentStatus === "CHUA_THANH_TOAN" ? `Tổng thanh toán khi nhận hàng ${math.fmt(order.total)}` : `Tổng đơn ${math.fmt(order.total)}`,
      link: `/tai-khoan/don-hang/${order.code}`,
    })
  } catch (err) {
    console.error("Việc sau khi tạo đơn lỗi:", err.message)
  }
}

// Liên kết kích hoạt cho tài khoản chờ kích hoạt (UC-PAY-01 bước 7, BR-25). DEMO_MODE trả đường dẫn để hiện trên màn hình.
async function sendActivation(user) {
  const token = await createToken(user._id, "KICH_HOAT", params.ACTIVATION_TTL_HOURS * 60)
  const path = `/dat-mat-khau/${token}`
  const origin = process.env.CLIENT_ORIGIN || "http://localhost:4200"
  const sent = await notifier.sendLink(user, "Kích hoạt tài khoản Soulprint để theo dõi đơn hàng", origin + path)
  return sent.devLink ? path : null
}

// Guest: tài khoản chờ kích hoạt thì gửi liên kết (UC-PAY-01 bước 7, UC-ACC-04); SĐT đã có tài khoản hoạt động thì
// gợi ý đăng nhập (6Ea). Member: null. Dùng chung cho đơn COD (API-38) và đơn trả online (API-40).
async function activationFor(snap, owner, accountCreated) {
  if (snap.memberId) return null
  if (owner.status === "CHO_KICH_HOAT") return { needed: true, devLink: await sendActivation(owner), created: accountCreated }
  return { needed: false, hasAccount: true }
}

// Ghi mã đơn vào phiên để xem SCR-09 không cần đăng nhập (API-43)
function rememberOrder(req, code) {
  req.session.recentOrders = [code, ...(req.session.recentOrders || []).filter((c) => c !== code)].slice(0, 10)
}

module.exports = {
  quote, checkVoucher, prepare, place, sendActivation, activationFor, rememberOrder, stockNeeds, sameAddress, checkoutLines, readContact,
  linesFromView, price, readShipping, guestAccount, useVouchers, reserveStock, reserveMaterials,
}
