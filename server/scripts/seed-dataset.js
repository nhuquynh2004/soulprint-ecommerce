// Nạp dataset 1,5 năm vào CSDL đang trỏ tới (npm run seed:dataset). XÓA toàn bộ CSDL rồi nạp lại.
// Bước 1: seed.js với catalog 60 sản phẩm và tài khoản của dataset (scripts/gen-dataset.js, dataset/catalog-extra.js).
// Bước 2: lịch sử: đơn hàng, thanh toán, hoàn tiền, đổi trả, bảo hành, đánh giá, voucher đã cấp, hội thoại CSKH,
// đơn nháp, yêu cầu đặt gấp, lượt xem theo ngày, lượt tư vấn AI, bộ đếm mã.
// Dataset sinh với mốc 10:00 19/10/2026; nạp ngày khác thì mọi thời điểm dời theo số ngày nguyên để đơn "mới" vẫn mới.
// Gói Giáng sinh 2026 (BST, sticker, mẫu gói quà, 3 sản phẩm Noel) không có ở đây: nhân viên tự tạo khi trình diễn.
const crypto = require("crypto")
const path = require("path")
const { client, database, dbName, ObjectId } = require("../config/db")
const params = require("../config/params")
const { seed } = require("./seed")
const g = require("./gen-dataset")
const math = require("../services/checkoutMath")
const opsRules = require("../services/opsRules")

const SEED_DIR = path.join(__dirname, "..", "..", "data", "seed")
const readJson = (name) => require(path.join(SEED_DIR, name + ".json"))
const HOUR = 3600 * 1000
const DAY = 24 * HOUR

// ===== Dời thời gian =====
const SHIFT = Math.max(0, Math.floor((Date.now() - g.NOW.getTime()) / DAY)) * DAY
const T = (d) => (d ? new Date(new Date(d).getTime() + SHIFT) : null)
const NOW = T(g.NOW)
const ymdShift = (s) => (s ? math.vnDate(T(new Date(s + "T12:00:00+07:00"))) : null)
const yymmdd = (d) => math.vnDate(d).slice(2).replace(/-/g, "")

// Ngẫu nhiên riêng của bước nạp (cố định để nạp lại ra cùng kết quả)
let state = 19102026
function rnd() {
  state |= 0
  state = (state + 0x6d2b79f5) | 0
  let t = Math.imul(state ^ (state >>> 15), 1 | state)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1))
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
const chance = (p) => rnd() < p
function poisson(lambda) {
  const L = Math.exp(-lambda)
  let k = 0
  let p = 1
  do {
    k++
    p *= rnd()
  } while (p > L)
  return k - 1
}
const noAccent = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D")

// ===== Bộ đếm mã (counters) =====
const counters = new Map()
function nextSeq(key) {
  counters.set(key, (counters.get(key) || 0) + 1)
  return counters.get(key)
}
const codeOf = (prefix, counter, d) => `${prefix}${yymmdd(d)}${String(nextSeq(`${counter}-${yymmdd(d)}`)).padStart(4, "0")}`

// ===== Bước 1: catalog và tài khoản =====

function catalogSource() {
  const base = readJson("products")
  const extra = g.extra
  const createdOf = new Map(g.products.map((p) => [p.sku, T(p.createdAt)]))
  const products = [...base, ...extra.products].map(({ launchedAt, ...p }) => ({ ...p, createdAt: createdOf.get(p.sku).toISOString() }))
  const at = (x) => ({ ...x, createdAt: T(g.START).toISOString() })
  return {
    products,
    stickerSets: [...readJson("stickerSets"), ...extra.stickerSets].map(at),
    giftWrapMaterials: [...readJson("giftWrapMaterials"), ...extra.giftWrapMaterials].map(at),
    giftWrapTemplates: [...readJson("giftWrapTemplates"), ...extra.giftWrapTemplates].map(at),
    collections: [...readJson("collections"), ...extra.collections].map(at),
  }
}

// Voucher: 3 mã của seed (SOULPRINT10, FREESHIP30 lùi ngày bắt đầu về ngày mở shop) + mã chiến dịch lịch sử
function voucherSource() {
  const base = new Map(readJson("vouchers").map((v) => [v.code, v]))
  return g.vouchers.map((v) => {
    const b = base.get(v.code)
    const startAt = T(v.startAt).toISOString()
    const endAt = T(v.endAt).toISOString()
    if (b) return { ...b, startAt, endAt, totalQuantity: v.totalQuantity, perUserLimit: v.perUserLimit, createdAt: startAt }
    const desc = v.type === "PERCENT"
      ? `Giảm ${v.value}%${v.maxDiscount ? `, tối đa ${math.fmt(v.maxDiscount)}` : ""}${v.minOrderValue ? ` cho đơn từ ${math.fmt(v.minOrderValue)}` : ""}`
      : `Giảm ${math.fmt(v.value)}${v.minOrderValue ? ` cho đơn từ ${math.fmt(v.minOrderValue)}` : ""}`
    return {
      code: v.code, name: v.name, description: desc, type: v.type, value: v.value, maxDiscount: v.maxDiscount || null, minOrderValue: v.minOrderValue, minItems: 1,
      scope: v.scopeCats ? { kind: "CATEGORY", slugs: v.scopeCats } : { kind: "ALL", ids: [] }, audience: v.audience, source: v.source,
      totalQuantity: v.totalQuantity, perUserLimit: v.perUserLimit, startAt, endAt, status: "HOAT_DONG",
      showInWallet: v.audience !== "SELECTED", autoOnSignup: false, createdAt: startAt,
    }
  })
}

function userSource() {
  const baseUsers = new Map(readJson("users").map((u) => [u.email, u]))
  const staff = g.staff.map((s) => {
    const b = baseUsers.get(s.email) || {}
    return {
      ...b, fullName: s.fullName, email: s.email, phone: s.phone, role: "admin", staffRoles: s.staffRoles, status: s.status,
      ...(s.password ? { password: s.password } : {}), ...(s.onDuty ? { onDuty: true } : {}),
      addresses: [], createdAt: T(s.joinedAt).toISOString(),
    }
  })
  const customers = g.customers.map((c) => {
    const b = c.email ? baseUsers.get(c.email) || {} : {}
    return {
      ...b, fullName: c.fullName, phone: c.phone, ...(c.email ? { email: c.email } : {}), role: "member", status: c.status, gender: c.gender,
      ...(c.status === "HOAT_DONG" ? { password: "Member@123" } : {}),
      addresses: c.addresses.map((a, i) => ({ ...a, isDefault: i === 0 })), createdAt: T(c.createdAt).toISOString(), datasetId: c.id,
    }
  })
  return [...staff, ...customers]
}

// ===== Bước 2: lịch sử =====

const BANKS = ["Vietcombank", "Techcombank", "MB Bank", "ACB", "VPBank", "BIDV", "VietinBank", "TPBank", "Sacombank"]
const bankFor = (name) => ({ bankName: pick(BANKS), accountNumber: String(int(10, 99)) + String(int(10000000, 99999999)) + String(int(10, 99)), accountName: noAccent(name).toUpperCase() })
const sentimentScore = { TICH_CUC: 0.6, TRUNG_TINH: 0, TIEU_CUC: -0.6 }
const REFUSAL = { "Không liên lạc được người nhận": "KHONG_CO_MAT", "Người nhận đổi ý": "KHONG_DONG_Y_NHAN", "Sai địa chỉ": "SAI_DIA_CHI" }

async function main() {
  console.log(`Nạp dataset 1,5 năm vào CSDL "${dbName}" (dời ${SHIFT / DAY} ngày)...`)
  const cat = catalogSource()
  const maps = await seed({ ...cat, vouchers: voucherSource(), users: userSource() })
  const db = database
  const products = await db.collection("products").find().toArray()
  const productBySku = new Map(products.map((p) => [p.sku, p]))
  const users = await db.collection("users").find().toArray()
  const userByDatasetId = new Map(users.filter((u) => u.datasetId).map((u) => [u.datasetId, u]))
  await db.collection("users").updateMany({ datasetId: { $exists: true } }, { $unset: { datasetId: "" } })
  const staffByName = new Map(users.filter((u) => u.role === "admin").map((u) => [u.fullName, u]))
  const staffList = users.filter((u) => u.role === "admin" && u.status === "HOAT_DONG")
  const vouchers = await db.collection("vouchers").find().toArray()
  const voucherByCode = new Map(vouchers.map((v) => [v.code, v]))
  const stickers = new Map((await db.collection("stickerSets").find().toArray()).flatMap((s) => s.stickers.map((x) => [x.code, x])))
  const templates = new Map((await db.collection("giftWrapTemplates").find().toArray()).map((t) => [t.name, t]))
  const materials = new Map((await db.collection("giftWrapMaterials").find().toArray()).map((m) => [m.code, m]))
  const admin = staffByName.get("Quản trị Soulprint")
  const staffId = (name) => (staffByName.get(name) || admin)._id

  // ----- Đơn hàng -----
  const genOrders = [...g.orders].sort((a, b) => a.createdAt - b.createdAt)
  const orderDocs = []
  const orderByGenCode = new Map()
  const payments = []
  const refunds = []
  const userVoucherUse = [] // [userId, voucherId, orderCode]

  const pzDoc = (l) => {
    if (!l.pz) return null
    if (l.pz.type === "THIET_KE") {
      return { type: "THIET_KE", stickers: l.pz.stickers.map((c) => ({ code: c, name: stickers.get(c)?.name || c, image: stickers.get(c)?.image || null })), message: l.pz.message }
    }
    return l.pz
  }
  const giftWrapDoc = (text) => {
    if (!text) return null
    const part = (code) => ({ code, name: materials.get(code)?.name || code })
    if (text.startsWith("Gợi ý: ")) {
      const t = templates.get(text.slice(7))
      return { source: "GOI_Y", name: t.name, paper: part(t.paper.code), ribbon: part(t.ribbon.code), card: part(t.card.code), message: chance(0.5) ? "Chúc anh luôn vui!" : "" }
    }
    return { source: "TAO_MOI", name: "Mẫu tự tạo", paper: part("KRAFT"), ribbon: part("RUY-DO"), card: part("THIEP-TRON"), message: "" }
  }

  for (const o of genOrders) {
    const owner = userByDatasetId.get(o.customerId)
    const at = T(o.createdAt)
    const code = codeOf("SP", "order", at)
    const items = o.lines.map((l) => {
      const p = productBySku.get(l.sku)
      return {
        _id: new ObjectId(), productId: p._id, sku: l.sku, variantSku: l.variantSku, name: l.name, variantName: l.variantName, image: p.images[0],
        unitPrice: l.unitPrice, quantity: l.quantity, personalization: pzDoc(l), personalizationFeePerUnit: l.feePerUnit, isPersonalized: !!l.pz,
        lineValue: (l.unitPrice + l.feePerUnit) * l.quantity, fulfillStatus: "BINH_THUONG", reviewed: false,
      }
    })
    const subtotal = items.reduce((s, it) => s + it.unitPrice * it.quantity, 0)
    const personalizationFee = items.reduce((s, it) => s + it.personalizationFeePerUnit * it.quantity, 0)
    const total = subtotal + o.shippingFee + personalizationFee + (o.urgentFee || 0) - o.discount
    const hasPers = items.some((it) => it.isPersonalized)
    const option = o.recipientType === "OTHER" ? "ONLINE" : hasPers ? (o.remainingMethod === "COD" ? "DEPOSIT_COD" : "ONLINE") : o.paymentMethod === "COD" ? "COD" : "ONLINE"
    const depositAmount = option === "DEPOSIT_COD" ? Math.min(Math.ceil(items.filter((it) => it.isPersonalized).reduce((s, it) => s + it.lineValue, 0) * params.DEPOSIT_RATE), total) : 0
    const upfront = option === "ONLINE" ? total : option === "DEPOSIT_COD" ? depositAmount : 0
    const ship = o.shipping
    const shippingAddress = {
      recipientName: ship.recipientName, phone: ship.phone, province: ship.province, ward: ship.ward, street: ship.street,
      ...(o.recipientType === "OTHER" || o.urgentFee ? { deliveryDate: ymdShift(o.deliveryDate) || math.vnDate(at), deliveryWindow: pick(params.DELIVERY_SLOTS) } : {}),
      noteForShipper: "",
    }
    const expectedDeliveryDate = shippingAddress.deliveryDate || math.deliveryRange(at, { province: ship.province, personalized: hasPers }).min
    const customer = { fullName: owner.fullName, phone: owner.phone, ...(owner.email ? { email: owner.email } : {}) }

    // Lịch sử trạng thái
    const history = []
    let prev = null
    let lastStaff = null
    for (const h of o.history) {
      const when = T(h.at)
      const entry = { field: "orderStatus", from: prev, to: h.to, at: when, by: null, byRole: "HE_THONG", note: null }
      if (h.by === "Khách") Object.assign(entry, { by: owner._id, byRole: "KHACH" })
      else if (h.by === "Hệ thống (72 giờ)") entry.note = `Tự hoàn thành sau ${params.AUTO_COMPLETE_HOURS} giờ`
      else if (h.by === "Tự xác nhận") entry.note = `Tự xác nhận: đơn gấp đã được shop chốt`
      else if (h.by === "Shipper báo từ chối") Object.assign(entry, { by: lastStaff || admin._id, byRole: "NHAN_VIEN" })
      else if (staffByName.has(h.by)) {
        lastStaff = staffId(h.by)
        Object.assign(entry, { by: lastStaff, byRole: "NHAN_VIEN" })
      }
      if (!prev && o.createdBy === "ADMIN") Object.assign(entry, { by: staffId(pick(["Phan Ngọc Lan", "Lê Quốc Huy"])), byRole: "NHAN_VIEN" })
      history.push(entry)
      prev = h.to
    }

    const doc = {
      _id: new ObjectId(), code, userId: owner._id, customer, createdBy: o.createdBy, source: o.source, tags: [...o.tags],
      items, hasPersonalizedItems: hasPers, giftWrap: giftWrapDoc(o.giftWrap), recipientType: o.recipientType, shippingAddress, noteForShop: o.noteForShop,
      subtotal, personalizationFee, giftWrapFee: 0, shippingFee: o.shippingFee, ...(o.urgentFee ? { urgentFee: o.urgentFee } : {}), discount: o.discount, total,
      vouchers: o.vouchers.map((x) => {
        const v = voucherByCode.get(x.code)
        return { voucherId: v._id, code: v.code, type: v.type, value: v.value, discount: x.discount }
      }),
      expectedDeliveryDate,
      depositAmount, remainingAmount: option === "DEPOSIT_COD" ? total - depositAmount : option === "COD" ? total : 0,
      paymentMethod: option === "COD" ? "COD" : "ONLINE", remainingMethod: option === "DEPOSIT_COD" ? "COD" : null,
      paidAmount: upfront, refundedAmount: 0, orderStatus: o.orderStatus,
      paymentStatus: upfront <= 0 ? "CHUA_THANH_TOAN" : upfront < total ? "DA_COC" : "DA_THANH_TOAN",
      returnStatus: "KHONG_CO", statusHistory: history, redeliveryCount: 0, internalNotes: [], policyAcceptedAt: at, createdAt: at, updatedAt: T(o.history[o.history.length - 1].at),
    }
    if (o.personalizationStartedAt) doc.personalizationStartedAt = T(o.personalizationStartedAt)
    if (o.carrier) Object.assign(doc, { carrier: o.carrier, trackingCode: o.trackingCode })
    if (o.deliveredAt) {
      doc.deliveredAt = T(o.deliveredAt)
      const due = total - upfront
      if (o.codDiscrepancy) {
        // Kịch bản COD lệch tiền: đơn vẫn Đã giao, giữ trạng thái thanh toán, chờ đối soát
        const by = history[history.length - 1].by
        doc.codDiscrepancy = { expected: due, collected: due - 20000, reason: "Shipper báo khách thiếu tiền lẻ, hẹn chuyển khoản sau", at: doc.deliveredAt, by }
        history[history.length - 1].note = `COD lệch ${math.fmt(-20000)}: Shipper báo khách thiếu tiền lẻ, hẹn chuyển khoản sau`
      } else if (due > 0) {
        Object.assign(doc, { paidAmount: total, paymentStatus: "DA_THANH_TOAN", remainingAmount: 0, codCollectedAt: doc.deliveredAt, codCollectedAmount: due })
        const i = history.findIndex((h) => h.to === "DA_GIAO")
        history.splice(i + 1, 0, { field: "paymentStatus", from: upfront > 0 ? "DA_COC" : "CHUA_THANH_TOAN", to: "DA_THANH_TOAN", at: doc.deliveredAt, by: history[i].by, byRole: "NHAN_VIEN", note: `Thu COD ${math.fmt(due)}` })
      }
    }
    if (o.completedAt) doc.completedAt = T(o.completedAt)
    if (o.urgentFee) doc.urgentCode = codeOf("G", "urgent", at)
    if (o.scenario.startsWith("Gia hạn ngày giao")) {
      doc.internalNotes.push({ _id: new ObjectId(), at: T(new Date(o.createdAt.getTime() + 5 * DAY)), by: staffId("Lê Quốc Huy"), text: "GHN báo kẹt hàng ở kho trung chuyển, dự kiến trễ 2 ngày. Đã gọi báo khách.", attachments: [] })
    }

    // Hủy đơn (BR-28)
    if (o.orderStatus === "DA_HUY") {
      const cancelledAt = T(o.cancelledAt)
      Object.assign(doc, { cancelledAt, cancelBy: o.cancelBy, cancelCase: o.cancelCase })
      if (o.cancelBy === "MEMBER") Object.assign(doc, { cancelReason: o.cancelReason, cancelDetail: o.cancelReason === "KHAC" ? "Mình đặt nhầm, sẽ đặt lại sau" : null })
      if (o.cancelBy === "ADMIN") Object.assign(doc, { cancelReason: "NGOAI_LE", cancelDetail: o.cancelReason })
      if (o.cancelBy === "REFUSED") {
        const reason = REFUSAL[o.cancelReason] || "KHONG_CO_MAT"
        Object.assign(doc, { cancelReason: "TU_CHOI_NHAN", cancelDetail: opsRules.REFUSAL_REASONS[reason], refusalReason: reason, refusedShippingFee: o.refusedShippingFee || 0, refusalNote: null })
      }
      history[history.length - 1].note = o.cancelBy === "MEMBER" ? "Khách hủy đơn" : o.cancelBy === "REFUSED" ? `Từ chối nhận: ${doc.cancelDetail}` : o.cancelReason
      if (o.cancelCase === "TH3") {
        const seq = nextSeq(`storage-${math.vnDate(cancelledAt).slice(5, 7)}${math.vnDate(cancelledAt).slice(8, 10)}`)
        Object.assign(doc, { storageStatus: o.storageStatus, storageDeadline: new Date(cancelledAt.getTime() + params.REDELIVERY_WINDOW_DAYS * DAY), storageCode: opsRules.storageCode(cancelledAt, seq), storedAt: cancelledAt })
        history.push({ field: "storageStatus", from: null, to: "DANG_LUU_KHO", at: cancelledAt, by: history[history.length - 1].by, byRole: "NHAN_VIEN", note: `Lưu kho đến ${math.vnDate(doc.storageDeadline)}` })
        if (o.storageStatus !== "DANG_LUU_KHO") history.push({ field: "storageStatus", from: "DANG_LUU_KHO", to: "HET_HAN_LUU_KHO", at: doc.storageDeadline, by: null, byRole: "HE_THONG", note: "Hết hạn lưu kho" })
        if (o.storageStatus === "DA_TIEU_HUY") {
          const disposedAt = new Date(doc.storageDeadline.getTime() + int(2, 10) * DAY)
          doc.disposal = { method: "TAI_CHE", at: disposedAt, by: staffId("Đỗ Minh Khoa") }
          history.push({ field: "storageStatus", from: "HET_HAN_LUU_KHO", to: "DA_TIEU_HUY", at: disposedAt, by: doc.disposal.by, byRole: "NHAN_VIEN", note: "Tiêu hủy (Tái chế)" })
        }
      }
      // Hoàn tiền: hủy bởi khách tạo ngay; từ chối nhận thì khách bấm "Nhận tiền hoàn" sau (đơn quá 2 ngày coi như đã bấm)
      const amount = o.refundedAmount
      const claimed = o.cancelBy !== "REFUSED" || NOW - cancelledAt > 2 * DAY
      if (amount > 0 && claimed) {
        const createdAt = o.cancelBy === "REFUSED" ? new Date(cancelledAt.getTime() + int(3, 30) * HOUR) : cancelledAt
        refunds.push({ order: doc, reason: o.cancelBy === "REFUSED" ? "TU_CHOI_NHAN" : "HUY_DON", amount, createdAt, by: o.cancelBy === "ADMIN" ? history[history.length - 1].by : null })
      }
    }

    // Thanh toán online (đơn tạo khi cổng báo thành công)
    if (upfront > 0) {
      const payAt = new Date(at.getTime() - int(1, 4) * 60000)
      payments.push({
        code: codeOf("GD", "payment", payAt), purpose: "ORDER", provider: "MOCK", amount: upfront, status: "SUCCESS", orderId: doc._id, orderCode: code,
        checkoutSnapshot: null, checkoutRequest: null, retryOf: null,
        description: option === "DEPOSIT_COD" ? `Đặt cọc ${params.DEPOSIT_RATE * 100}% sản phẩm cá nhân hóa` : "Thanh toán 100% đơn hàng",
        userId: owner.status === "HOAT_DONG" ? owner._id : null, sessionId: null, providerTransId: "MOCK-" + code, paidAt: at,
        expiresAt: new Date(payAt.getTime() + params.PAYMENT_TTL_MINUTES * 60000), createdAt: payAt, updatedAt: at,
      })
    }
    for (const v of doc.vouchers) userVoucherUse.push([owner._id, v.voucherId, code])
    orderDocs.push(doc)
    orderByGenCode.set(o.code, { gen: o, doc })
  }

  // Kịch bản: đơn gấp đã thanh toán
  const urgentDone = orderDocs.filter((o) => o.urgentCode)

  // ----- Đổi trả -----
  const returnDocs = []
  for (const r of g.returns) {
    const { gen: o, doc } = orderByGenCode.get(r.orderCode)
    const it = doc.items[r.lineIndex]
    const createdAt = T(r.createdAt)
    const handler = r.handledBy ? staffId(r.handledBy) : null
    let resolution = r.resolution
    if (r.status === "DA_HOAN_TAT" && resolution === "GIAO_LAI") resolution = "HOAN_TIEN"
    const rd = {
      _id: new ObjectId(), code: codeOf("DT", "return", createdAt), orderId: doc._id, orderCode: doc.code, userId: doc.userId,
      items: [{ orderItemId: it._id, quantity: it.quantity, reason: r.reason, lineValue: it.lineValue }], resolution,
      description: { HU_HONG: "Hộp bị móp, sản phẩm bên trong bị nứt một góc.", LOI_IN_KHAC: "Chữ khắc bị lệch và mờ ở cuối.", GIAO_SAI: "Mình đặt màu đen nhưng nhận màu trắng.", KHONG_DUNG_MO_TA: "Chất liệu không giống mô tả trên web.", DOI_Y: "Mình đổi ý, sản phẩm còn nguyên tem." }[r.reason],
      images: ["HU_HONG", "LOI_IN_KHAC"].includes(r.reason) || it.isPersonalized ? [it.image] : [],
      pickupAddress: { recipientName: doc.shippingAddress.recipientName, phone: doc.shippingAddress.phone, province: doc.shippingAddress.province, ward: doc.shippingAddress.ward, street: doc.shippingAddress.street },
      bankInfo: resolution === "HOAN_TIEN" ? bankFor(doc.customer.fullName) : null, conditionConfirmed: !it.isPersonalized,
      status: r.status, slaDeadline: new Date(createdAt.getTime() + params.AFTERSALES_SLA_HOURS * HOUR), createdAt, updatedAt: createdAt,
    }
    const decidedAt = new Date(createdAt.getTime() + int(4, 30) * HOUR)
    if (["DONG_Y", "DA_NHAN_HANG", "DA_HOAN_TAT"].includes(r.status)) {
      Object.assign(rd, { decidedAt, decidedBy: handler, returnInstruction: "Bạn đóng gói sản phẩm kèm phụ kiện, ghi mã yêu cầu ngoài hộp. Shipper GHN sẽ đến lấy trong 2 ngày.", returnCarrier: "GHN", returnTrackingCode: null, updatedAt: decidedAt })
    }
    if (["DA_NHAN_HANG", "DA_HOAN_TAT"].includes(r.status)) Object.assign(rd, { receivedAt: new Date(decidedAt.getTime() + int(30, 70) * HOUR), receivedBy: staffId("Đỗ Minh Khoa") })
    if (r.status === "DA_HOAN_TAT") {
      const completedAt = new Date(rd.receivedAt.getTime() + int(4, 24) * HOUR)
      const amount = Math.min(it.lineValue, doc.paidAmount)
      Object.assign(rd, { refundAmount: amount, completedAt, updatedAt: completedAt })
      refunds.push({ order: doc, reason: "DOI_TRA", amount, createdAt: completedAt, by: handler, bankInfo: rd.bankInfo, note: `Yêu cầu đổi trả ${rd.code}`, request: rd })
    }
    if (r.status === "TU_CHOI") {
      Object.assign(rd, { reject: { reasonCode: r.rejectReason, detail: "Soulprint đã kiểm tra ảnh và sản phẩm, yêu cầu chưa đủ điều kiện đổi trả theo chính sách.", evidence: [], allowResubmit: false, at: decidedAt, by: handler }, decidedAt, decidedBy: handler, updatedAt: decidedAt })
    }
    if (r.status === "DA_HUY") rd.updatedAt = new Date(createdAt.getTime() + int(1, 10) * HOUR)
    doc.returnStatus = r.status === "DA_HUY" ? "KHONG_CO" : r.status
    if (r.status !== "DA_HUY") doc.statusHistory.push({ field: "returnStatus", from: "KHONG_CO", to: "DANG_YEU_CAU", at: createdAt, by: doc.userId, byRole: "KHACH", note: `Yêu cầu ${rd.code}` })
    returnDocs.push(rd)
  }

  // ----- Bảo hành -----
  const warrantyDocs = []
  for (const w of g.warranties) {
    const { doc } = orderByGenCode.get(w.orderCode)
    const it = doc.items[w.lineIndex]
    const createdAt = T(w.createdAt)
    const wd = {
      _id: new ObjectId(), code: codeOf("BH", "warranty", createdAt), orderId: doc._id, orderCode: doc.code, orderItemId: it._id, productId: it.productId, userId: doc.userId,
      symptom: w.symptom, description: { KHONG_HOAT_DONG: "Cắm điện nhưng không lên đèn, không hoạt động.", CHAP_CHON: "Lúc được lúc không, phải rút ra cắm lại.", HONG_MOT_PHAN: "Một phím bị liệt, các phím khác vẫn bình thường.", BONG_MO_IN_KHAC: "Lớp khắc tên bị mờ sau vài tháng." }[w.symptom],
      images: [it.image], shippingMethod: "TU_GUI", pickupAddress: null, warrantyUntil: T(w.warrantyUntil), status: w.status, progressNotes: [],
      slaDeadline: new Date(createdAt.getTime() + params.AFTERSALES_SLA_HOURS * HOUR), createdAt, updatedAt: createdAt,
    }
    const decidedAt = new Date(createdAt.getTime() + int(4, 30) * HOUR)
    if (["DA_DUYET", "DA_NHAN_HANG", "HOAN_TAT"].includes(w.status)) Object.assign(wd, { resolution: "SUA_CHUA", returnInstruction: "Bạn gửi sản phẩm về kho Soulprint, ghi mã yêu cầu ngoài hộp.", returnCarrier: null, returnTrackingCode: null, decidedAt, decidedBy: staffId("Lê Quốc Huy"), updatedAt: decidedAt })
    if (["DA_NHAN_HANG", "HOAN_TAT"].includes(w.status)) Object.assign(wd, { receivedAt: new Date(decidedAt.getTime() + 2 * DAY), receivedBy: staffId("Đỗ Minh Khoa") })
    if (w.status === "HOAN_TAT") {
      wd.progressNotes.push({ at: new Date(wd.receivedAt.getTime() + DAY), text: "Đã thay linh kiện, đang kiểm tra lại.", by: staffId("Đỗ Minh Khoa") })
      Object.assign(wd, { completedAt: new Date(wd.receivedAt.getTime() + 3 * DAY), updatedAt: new Date(wd.receivedAt.getTime() + 3 * DAY) })
    }
    if (w.status === "TU_CHOI") Object.assign(wd, { reject: { reasonCode: "LOI_DO_NGUOI_DUNG", detail: "Sản phẩm bị vào nước, không thuộc phạm vi bảo hành.", evidence: [], allowResubmit: false, at: decidedAt, by: staffId("Lê Quốc Huy") }, decidedAt, decidedBy: staffId("Lê Quốc Huy") })
    warrantyDocs.push(wd)
  }

  // ----- Hoàn tiền (06 Mục 4.5) -----
  const refundDocs = refunds.map((x) => {
    const done = NOW - x.createdAt > 3 * DAY
    const owner = users.find((u) => u._id.equals(x.order.userId))
    const bankInfo = x.bankInfo || bankFor(x.order.customer.fullName)
    const processedAt = done ? new Date(x.createdAt.getTime() + int(6, 40) * HOUR) : null
    const d = {
      _id: new ObjectId(), orderId: x.order._id, orderCode: x.order.code, userId: x.order.userId, reason: x.reason, amount: x.amount, method: "BANK_TRANSFER", bankInfo,
      status: done ? "DA_HOAN" : "CHO_XU_LY", slaDeadline: new Date(x.createdAt.getTime() + params.REFUND_SLA_HOURS * HOUR), createdBy: x.by || null, note: x.note || null,
      createdAt: x.createdAt, updatedAt: processedAt || x.createdAt,
      ...(done ? { refundTransId: "CK" + int(100000000, 999999999), processedAt, processedBy: staffId("Phan Ngọc Lan") } : {}),
    }
    if (x.request) x.request.refundId = d._id
    if (done) {
      x.order.refundedAmount += x.amount
      x.order.paymentStatus = x.order.refundedAmount >= x.order.paidAmount ? "DA_HOAN_TIEN" : "HOAN_TIEN_MOT_PHAN"
      x.order.statusHistory.push({ field: "paymentStatus", from: null, to: x.order.paymentStatus, at: processedAt, by: d.processedBy, byRole: "NHAN_VIEN", note: `Hoàn ${math.fmt(x.amount)}` })
    }
    if (owner && owner.status === "HOAT_DONG" && !owner.refundAccount) owner.refundAccount = { ...bankInfo, savedAt: x.createdAt }
    return d
  })

  // ----- Đánh giá -----
  const reviewDocs = []
  for (const r of g.reviews) {
    const { doc } = orderByGenCode.get(r.orderCode)
    const it = doc.items[r.lineIndex]
    const owner = users.find((u) => u._id.equals(doc.userId))
    it.reviewed = true
    const createdAt = T(r.createdAt)
    reviewDocs.push({
      _id: new ObjectId(), productId: it.productId, orderId: doc._id, orderItemId: it._id, userId: doc.userId, userName: owner.fullName, variantName: it.variantName,
      rating: r.rating, comment: r.comment, likes: r.likes, hideName: r.hideName, images: r.hasImages ? [it.image] : [],
      editableUntil: new Date(createdAt.getTime() + params.REVIEW_EDIT_HOURS * HOUR), isHidden: r.isHidden,
      ...(r.isHidden ? { hiddenReason: r.hiddenReason, hiddenBy: staffId("Phan Ngọc Lan"), hiddenAt: new Date(createdAt.getTime() + 6 * HOUR) } : {}),
      createdAt, updatedAt: createdAt,
    })
  }

  // ----- Đơn nháp, đơn gấp -----
  const drafts = require("../services/draftOrders")
  const cartItem = (it) => ({
    _id: String(new ObjectId()), productId: String(it.productId), variantSku: it.variantSku, quantity: it.quantity, selected: true,
    personalization: it.personalization ? (it.personalization.type === "THIET_KE" ? { type: "THIET_KE", stickers: it.personalization.stickers.map((s) => s.code), message: it.personalization.message } : it.personalization) : null,
  })
  const draftDocs = []
  let draftSeq = 0
  for (const o of orderDocs.filter((x) => x.createdBy === "ADMIN")) {
    const code = `D${++draftSeq}`
    o.draftCode = code
    o.statusHistory[0].note = `Tạo bởi nhân viên từ đơn nháp #${code}`
    draftDocs.push({
      code, kind: "THUONG", status: "HOAN_TAT", source: o.source, tags: [], customerUserId: o.userId, customer: o.customer, items: o.items.map(cartItem), giftWrap: null,
      recipientType: o.recipientType, shippingAddress: o.shippingAddress, deliveryDate: o.shippingAddress.deliveryDate || null, deliveryWindow: o.shippingAddress.deliveryWindow || null,
      noteForShop: o.noteForShop, voucherCodes: [], paymentChoice: o.paymentMethod, remainingMethod: o.remainingMethod, urgentFee: 0, internalNote: "Khách đặt qua " + o.source,
      orderCode: o.code, totalEstimate: o.total, primaryAction: null, createdBy: o.statusHistory[0].by, updatedBy: o.statusHistory[0].by,
      createdAt: new Date(o.createdAt.getTime() - int(20, 90) * 60000), updatedAt: o.createdAt,
    })
  }
  for (const o of urgentDone) {
    const confirmedAt = new Date(o.createdAt.getTime() - int(20, 60) * 60000)
    draftDocs.push({
      code: o.urgentCode, kind: "DAT_GAP", status: "HOAN_TAT", source: "WEBSITE", tags: ["Đơn gấp"], customerUserId: o.userId, customer: o.customer, items: o.items.map(cartItem), giftWrap: null,
      recipientType: o.recipientType, shippingAddress: o.shippingAddress, deliveryDate: o.shippingAddress.deliveryDate, deliveryWindow: o.shippingAddress.deliveryWindow, noteForShop: o.noteForShop,
      voucherCodes: [], paymentChoice: "ONLINE", remainingMethod: null, urgentFee: o.urgentFee, internalNote: "", orderCode: o.code, totalEstimate: o.total, primaryAction: null,
      urgent: {
        status: "DA_CHOT", requestedDate: o.shippingAddress.deliveryDate, earliestDate: math.deliveryRange(o.createdAt, { province: o.shippingAddress.province, personalized: o.hasPersonalizedItems }).min,
        token: crypto.randomBytes(16).toString("hex"), sessionId: null, conversationId: null, version: 1, lockedTotal: o.total, confirmedAt, confirmedBy: staffId("Phan Ngọc Lan"),
        history: [
          { at: new Date(confirmedAt.getTime() - 3 * HOUR), action: "GUI", by: "KHACH", byName: null, note: null },
          { at: confirmedAt, action: "CHOT", by: staffId("Phan Ngọc Lan"), byName: "Phan Ngọc Lan", note: `Phụ phí ${math.fmt(o.urgentFee)}` },
          { at: o.createdAt, action: "DAT_HANG", by: "KHACH", byName: null, note: o.code },
        ],
        originalGiftWrap: null,
      },
      createdBy: null, updatedBy: staffId("Phan Ngọc Lan"), createdAt: new Date(confirmedAt.getTime() - 3 * HOUR), updatedAt: o.createdAt,
    })
  }
  // Đơn nháp đang soạn (nhân viên nhận đơn qua Zalo, Facebook, điện thoại)
  const members = users.filter((u) => u.role === "member" && u.status === "HOAT_DONG" && u.addresses.length)
  const sellable = products.filter((p) => p.status === "DANG_HIEN_THI")
  const openDrafts = [
    ["ZALO", "TT-VBL-001", { type: "IN_KHAC", mode: "THUONG", text: "BỐ YÊU" }, "Khách hỏi qua Zalo, chờ khách chốt nội dung khắc"],
    ["FACEBOOK", "GM-KGC-001", null, "Khách muốn in ảnh riêng lên lót chuột, đang chờ gửi ảnh"],
    ["DIEN_THOAI", "AN-MMN-004", { type: "IN_KHAC", mode: "THUONG", text: "Gia Bảo" }, "Gọi lại cho khách sau 17:00 để xác nhận địa chỉ"],
  ]
  for (const [source, sku, pz, note] of openDrafts) {
    const c = pick(members)
    const p = productBySku.get(sku)
    const createdAt = new Date(NOW.getTime() - int(2, 40) * HOUR)
    const a = c.addresses[0]
    const d = {
      code: `D${++draftSeq}`, kind: "THUONG", status: "MO", source, tags: [], customerUserId: c._id, customer: { fullName: c.fullName, phone: c.phone, ...(c.email ? { email: c.email } : {}) },
      items: [{ _id: String(new ObjectId()), productId: String(p._id), variantSku: p.variants.find((v) => v.stock > 0).sku, quantity: 1, personalization: pz, selected: true }], giftWrap: null,
      recipientType: "SELF", shippingAddress: { recipientName: a.recipientName, phone: a.phone, province: a.province, ward: a.ward, street: a.street, noteForShipper: "" },
      deliveryDate: null, deliveryWindow: null, noteForShop: "", voucherCodes: [], paymentChoice: null, remainingMethod: null, urgentFee: 0, internalNote: note,
      createdBy: staffId(pick(["Phan Ngọc Lan", "Lê Quốc Huy"])), createdAt, updatedAt: createdAt,
    }
    d.updatedBy = d.createdBy
    draftDocs.push(d)
  }
  void sellable

  // ----- Hội thoại CSKH -----
  const TOPIC_TEXT = {
    "Hỏi phí vận chuyển và thời gian giao": ["Shop ơi phí ship bao nhiêu, giao Hà Nội mất mấy ngày?", "Phí vận chuyển đồng giá 30.000đ. Trong TP.HCM khoảng 2 ngày, tỉnh khác khoảng 4 ngày, đơn có cá nhân hóa cộng thêm 3 ngày nha bạn."],
    "Đơn hàng đang ở đâu": ["Đơn của mình đặt mấy hôm rồi mà chưa thấy giao", "Mình kiểm tra thì đơn đã giao cho GHN, dự kiến 1 đến 2 ngày nữa tới nha bạn."],
    "Đổi nội dung khắc sau khi đặt": ["Mình muốn đổi chữ khắc trên đơn vừa đặt được không?", "Đơn chưa vào cá nhân hóa nên đổi được ạ, bạn gửi giúp mình nội dung mới nhé."],
    "Đổi địa chỉ nhận hàng": ["Mình muốn đổi địa chỉ nhận hàng sang chỗ làm", "Bạn gửi địa chỉ mới, mình cập nhật vào đơn ngay nha."],
    "Mã giảm giá không áp dụng được": ["Mình nhập mã mà báo không áp dụng được", "Mã này cần đơn tối thiểu 300.000đ, bạn thêm sản phẩm là dùng được ạ."],
    "Tư vấn quà sinh nhật bạn trai mê game": ["Bạn trai mình thích chơi game PC, tầm 500k nên tặng gì?", "Bạn tham khảo lót chuột in theo yêu cầu hoặc ly giữ nhiệt hình tay cầm khắc tên nha, đều dưới 500.000đ."],
    "Hỏi chính sách đổi trả hàng khắc tên": ["Hàng khắc tên có đổi trả được không shop?", "Sản phẩm cá nhân hóa được đổi trả khi lỗi từ Soulprint (sai chữ, mờ, hư hỏng) trong 7 ngày, bạn chụp ảnh gửi kèm yêu cầu nhé."],
    "Hỏi đặt gấp giao trong ngày": ["Mình cần quà gấp cho ngày mai, shop làm kịp không?", "Bạn chọn ngày giao trên lịch rồi tick Đặt gấp, shop kiểm tra và báo phụ phí trong chat nha."],
  }
  const LABEL = { VAN_CHUYEN: "TU_VAN", DON_HANG: "DON_HANG", CA_NHAN_HOA: "DON_HANG", VOUCHER: "TU_VAN", TU_VAN: "TU_VAN", DOI_TRA: "DOI_TRA", DAT_GAP: "DAT_GAP" }
  const convDocs = []
  const msgDocs = []
  const onDuty = staffByName.get("Phan Ngọc Lan")
  for (const c of g.conversations) {
    const createdAt = T(c.createdAt)
    const member = c.customerId ? userByDatasetId.get(c.customerId) : null
    let agent = c.handledBy && staffByName.has(c.handledBy) ? staffByName.get(c.handledBy) : null
    if (c.status === "DANG_HO_TRO") agent = onDuty // nhân viên đang trực trong dataset
    if (c.status === "CHO_NHAN_VIEN" || c.status === "BOT") agent = null
    const [ask, answer] = TOPIC_TEXT[c.topic]
    const conv = {
      _id: new ObjectId(), userId: member ? member._id : null, sessionId: null, customerName: member ? member.fullName : c.customerName,
      status: c.status, summary: c.status === "BOT" ? null : `Khách hỏi: ${ask}`, sentiment: c.sentiment, sentimentScore: sentimentScore[c.sentiment], topic: c.topic,
      contact: null, botMissCount: 0, assignedAdminId: agent && c.status !== "CHO_NHAN_VIEN" ? agent._id : null, escalatedAt: null, lastMessageAt: createdAt,
      internalNotes: [], labels: [], createdAt,
    }
    const msgs = []
    const add = (sender, text, gap, extra = {}) => {
      const at = new Date((msgs.length ? msgs[msgs.length - 1].createdAt : createdAt).getTime() + gap)
      msgs.push({ _id: new ObjectId(), conversationId: conv._id, sender, text, createdAt: at, ...extra })
    }
    add("BOT", `Chào ${member ? member.fullName.split(" ").pop() : "bạn"}! Mình là Sâu Béo, trợ lý của Soulprint. Bạn cần mình giúp gì nè?`, 0)
    add("KHACH", ask, int(20, 90) * 1000)
    if (c.handledBy === "Sâu Béo (chatbot)" || !agent) {
      if (c.status === "CHO_NHAN_VIEN") {
        add("BOT", "Sâu đã báo nhân viên. Nhân viên sẽ trả lời bạn trong ít phút, bạn để ý tin nhắn ở đây nhé.", 5000)
        conv.escalatedAt = msgs[msgs.length - 1].createdAt
      } else {
        add("BOT", answer, 3000)
        if (c.messages > 3) add("KHACH", "Cảm ơn Sâu nha", int(30, 120) * 1000)
      }
    } else {
      add("BOT", "Sâu đã báo nhân viên. Nhân viên sẽ trả lời bạn trong ít phút, bạn để ý tin nhắn ở đây nhé.", 5000)
      conv.escalatedAt = msgs[msgs.length - 1].createdAt
      add("HE_THONG", `${agent.fullName} đã tham gia cuộc trò chuyện`, int(1, 6) * 60000)
      conv.assignedAt = msgs[msgs.length - 1].createdAt
      add("ADMIN", answer, int(30, 180) * 1000, { senderName: agent.fullName, adminId: agent._id })
      if (c.status === "DA_DONG") {
        add("KHACH", "Ok shop, cảm ơn nhiều", int(1, 5) * 60000)
        add("ADMIN", "Dạ không có gì ạ, chúc bạn một ngày vui!", int(20, 90) * 1000, { senderName: agent.fullName, adminId: agent._id })
      } else add("KHACH", "Mình cần gấp, shop xem giúp mình với nhé", int(1, 4) * 60000)
    }
    if (c.status === "DA_DONG") {
      add("HE_THONG", "Cảm ơn bạn đã trò chuyện cùng Soulprint. Cuộc trò chuyện đã kết thúc, bạn cần thêm gì cứ nhắn Sâu Béo nhé!", int(2, 30) * 60000)
      Object.assign(conv, { closedAt: msgs[msgs.length - 1].createdAt, closedBy: agent ? agent._id : null })
    } else {
      conv.labels = [...new Set([LABEL[c.label], ...(c.sentiment === "TIEU_CUC" ? ["KHIEU_NAI"] : [])])].filter(Boolean)
      if (c.status === "DANG_HO_TRO") conv.staffSeenAt = msgs[msgs.length - 2].createdAt
    }
    conv.lastMessageAt = msgs[msgs.length - 1].createdAt
    convDocs.push(conv)
    msgDocs.push(...msgs)
  }

  // Yêu cầu đặt gấp đang chờ shop xem xét (gắn vào hội thoại "Hỏi đặt gấp giao trong ngày" đang chờ nhân viên)
  const urgentConv = convDocs.find((c) => c.status === "CHO_NHAN_VIEN" && c.topic === "Hỏi đặt gấp giao trong ngày")
  if (urgentConv) {
    const at = new Date(urgentConv.createdAt.getTime() + 3 * 60000)
    const p = productBySku.get("TT-TBN-GGY-003")
    const requestedDate = math.vnDate(new Date(NOW.getTime() + 2 * DAY))
    const code = codeOf("G", "urgent", at)
    const contact = { fullName: "Đỗ Khánh Linh", phone: "0938456127" }
    const d = {
      code, kind: "DAT_GAP", status: "MO", source: "WEBSITE", tags: ["Đơn gấp"], customerUserId: null, customer: contact,
      items: [{ _id: String(new ObjectId()), productId: String(p._id), variantSku: p.variants[0].sku, quantity: 1, personalization: { type: "IN_KHAC", mode: "THUONG", text: "TUẤN KIỆT" }, selected: true }],
      giftWrap: null, recipientType: "OTHER",
      shippingAddress: { recipientName: "Phạm Tuấn Kiệt", phone: "0907812345", province: "Thành phố Hồ Chí Minh", ward: "Phường Bến Thành", street: "45 Lê Thánh Tôn", noteForShipper: "" },
      deliveryDate: requestedDate, deliveryWindow: "18:00 - 21:00", noteForShop: "Quà sinh nhật, cần kịp tối thứ Năm", voucherCodes: [], paymentChoice: null, remainingMethod: null, urgentFee: 0, internalNote: "",
      urgent: {
        status: "CHO_XEM_XET", requestedDate, earliestDate: math.deliveryRange(at, { province: "Thành phố Hồ Chí Minh", personalized: true }).min, token: crypto.randomBytes(16).toString("hex"),
        sessionId: null, conversationId: urgentConv._id, version: 0, history: [{ at, action: "GUI", by: "KHACH", byName: null, note: null }], originalGiftWrap: null,
      },
      createdBy: null, updatedBy: null, createdAt: at, updatedAt: at,
    }
    draftDocs.push(d)
    Object.assign(urgentConv, { customerName: contact.fullName, contact: contact.phone, urgentOpen: true, urgentCodes: [code], labels: ["DAT_GAP"], topic: `Đặt gấp #${code}` })
    const dmy = requestedDate.split("-").reverse().join("/")
    msgDocs.push(
      { _id: new ObjectId(), conversationId: urgentConv._id, sender: "KHACH", text: `Mình cần đặt gấp, mong nhận ngày ${dmy}.`, createdAt: at },
      { _id: new ObjectId(), conversationId: urgentConv._id, sender: "HE_THONG", text: "Sâu đã gửi yêu cầu đặt gấp cho shop. Shop sẽ kiểm tra khả năng làm kịp, báo phụ phí (nếu có) ngay trong khung chat này.", createdAt: new Date(at.getTime() + 1000),
        card: { type: "DAT_GAP", code, status: "CHO_XEM_XET", title: `Yêu cầu đặt gấp #${code}`, text: `Mong nhận ${dmy}, 1 sản phẩm`, url: `/dat-gap/${code}?t=${d.urgent.token}` } },
    )
    urgentConv.lastMessageAt = new Date(at.getTime() + 1000)
  }

  // ----- Ví voucher (userVouchers) -----
  const grants = new Map()
  const grant = (u, v, at) => {
    const key = `${u._id}|${v._id}`
    if (grants.has(key)) return
    const expiresAt = v.validDays ? new Date(Math.min(at.getTime() + v.validDays * DAY, v.endAt ? v.endAt.getTime() : Infinity)) : v.endAt
    grants.set(key, { userId: u._id, voucherId: v._id, code: v.code, source: v.source || "CAMPAIGN", assignedAt: at, expiresAt, usedCount: 0, lastOrderCode: null, createdAt: at })
  }
  const activeMembers = users.filter((u) => u.role === "member" && u.status === "HOAT_DONG")
  const welcome = voucherByCode.get("SOULPRINT10")
  for (const u of activeMembers) grant(u, welcome, u.activatedAt || u.createdAt)
  for (const v of vouchers.filter((x) => x.audience === "ALL_MEMBERS")) {
    for (const u of activeMembers.filter((x) => x.createdAt <= v.startAt)) grant(u, v, v.startAt)
  }
  const sorry = voucherByCode.get("BUDAP30K")
  const sorryUsers = [...new Set(orderDocs.filter((o) => o.cancelBy === "REFUSED" || o.internalNotes.length).map((o) => String(o.userId)))]
  const sorryList = activeMembers.filter((u) => sorryUsers.includes(String(u._id))).slice(0, 12)
  for (const u of sorryList) grant(u, sorry, new Date(Math.max(sorry.startAt.getTime(), u.createdAt.getTime())))
  for (const [userId, voucherId, code] of userVoucherUse) {
    const x = grants.get(`${userId}|${voucherId}`)
    if (x) Object.assign(x, { usedCount: x.usedCount + 1, lastOrderCode: code })
  }

  // ----- Ghi CSDL -----
  const insertMany = async (name, docs) => {
    for (let i = 0; i < docs.length; i += 1000) await db.collection(name).insertMany(docs.slice(i, i + 1000))
    console.log(`  ${name}: ${docs.length}`)
  }
  await insertMany("orders", orderDocs)
  await insertMany("payments", payments)
  await insertMany("refunds", refundDocs)
  await insertMany("returnRequests", returnDocs)
  await insertMany("warrantyRequests", warrantyDocs)
  await insertMany("reviews", reviewDocs)
  await insertMany("conversations", convDocs)
  await insertMany("messages", msgDocs)
  await insertMany("userVouchers", [...grants.values()])
  for (const d of draftDocs.filter((x) => x.status !== "HOAN_TAT")) Object.assign(d, await drafts.withEstimate(d))
  await insertMany("draftOrders", draftDocs)
  await db.collection("vouchers").updateOne({ _id: sorry._id }, { $set: { selectedUserIds: sorryList.map((u) => u._id) } })
  for (const u of users.filter((x) => x.refundAccount)) await db.collection("users").updateOne({ _id: u._id }, { $set: { refundAccount: u.refundAccount } })

  // Số liệu tổng hợp trên sản phẩm và voucher
  const sold = new Map()
  for (const o of orderDocs) for (const it of o.items) {
    const k = String(it.productId)
    const x = sold.get(k) || { sold: 0, any: false }
    x.any = true
    if (o.orderStatus !== "DA_HUY") x.sold += it.quantity
    sold.set(k, x)
  }
  const { refreshRating } = require("../services/customersAdmin")
  for (const p of products) {
    const x = sold.get(String(p._id)) || { sold: 0, any: false }
    await db.collection("products").updateOne({ _id: p._id }, { $set: { soldCount: x.sold, hasOrders: x.any } })
    await refreshRating(p._id)
  }
  for (const v of vouchers) {
    const used = orderDocs.flatMap((o) => o.vouchers).filter((x) => x.code === v.code)
    await db.collection("vouchers").updateOne({ _id: v._id }, { $set: { usedCount: used.length, discountGiven: used.reduce((s, x) => s + x.discount, 0) } })
  }

  // ----- Lượt xem, yêu thích, thêm giỏ theo ngày (productDailyStats) -----
  const stats = []
  const viewTotal = new Map()
  for (const p of products) {
    const gp = g.products.find((x) => x.sku === p.sku)
    const pop = g.popularity.get(p.sku) || 1
    if (p.status === "BAN_NHAP") continue
    for (let day = new Date(gp.createdAt); day < g.NOW; day = new Date(day.getTime() + DAY)) {
      if (p.sku === "GM-VBL-005" && day >= new Date("2026-08-01T00:00:00+07:00")) break
      const fresh = day - gp.createdAt < 30 * DAY ? 1.8 : 1
      const views = poisson(g.dayRate(day) * pop * 2.2 * fresh)
      if (!views) continue
      const addToCarts = poisson(views * 0.09)
      const wishlists = poisson(views * 0.03)
      stats.push({ productId: p._id, date: math.vnDate(T(day)), views, wishlists, addToCarts })
      viewTotal.set(String(p._id), (viewTotal.get(String(p._id)) || 0) + views)
    }
  }
  await insertMany("productDailyStats", stats)
  for (const p of products) await db.collection("products").updateOne({ _id: p._id }, { $set: { viewCount: viewTotal.get(String(p._id)) || 0 } })

  // ----- Lượt tư vấn AI: chạy bộ máy gợi ý thật trên catalog vừa nạp (aiSessions, aiGaps) -----
  const engines = require("../services/recommendationEngine")
  const recRules = require("../services/recommendRules")
  const catalog = await engines.loadCatalogFromDb(db)
  const eng = engines.engine()
  const tagsByGroup = {}
  for (const t of readJson("tags")) (tagsByGroup[t.group] = tagsByGroup[t.group] || []).push(t.slug)
  const some = (arr, max) => [...new Set(Array.from({ length: int(0, max) }, () => pick(arr)))]
  const slugOfTag = new Map((await db.collection("tags").find().toArray()).map((t) => [String(t._id), t.slug]))
  const aiProducts = products.filter((p) => p.status === "DANG_HIEN_THI" && p.aiEligible !== false).map((p) => ({ ...p, tagSlugs: (p.tagIds || []).map((id) => slugOfTag.get(String(id))) }))
  const BUDGETS = [[0, 300000], [300000, 500000], [500000, 1000000], [1000000, 3000000], [null, null]]
  const sessionsAi = []
  const gaps = new Map()
  const orderCodesByUser = new Map()
  for (const o of orderDocs) if (!orderCodesByUser.has(String(o.userId))) orderCodesByUser.set(String(o.userId), [])
  for (const o of orderDocs) orderCodesByUser.get(String(o.userId)).push(o)
  for (let day = new Date(g.START); day < g.NOW; day = new Date(day.getTime() + DAY)) {
    const n = poisson(g.dayRate(day) * 1.6)
    for (let i = 0; i < n; i++) {
      const at = T(new Date(day.getTime() + int(0, 14 * 60) * 60000))
      if (at > NOW) continue
      const [bMin, bMax] = pick(BUDGETS)
      // Khách thường có nhu cầu gần với một món có thật (lấy tag của món đó); khoảng 15% là nhu cầu shop chưa có
      const body = { budgetMin: bMin ?? undefined, budgetMax: bMax ?? undefined, preferPersonalized: chance(0.4) }
      if (chance(0.85)) {
        const p = pick(aiProducts)
        const of = (group) => p.tagSlugs.filter((s) => tagsByGroup[group].includes(s))
        Object.assign(body, {
          recipient: chance(0.85) ? pick(of("DOI_TUONG")) : undefined, occasions: chance(0.6) ? [pick(of("DIP_TANG"))].filter(Boolean) : [], hobbies: chance(0.8) ? [pick(of("SO_THICH"))].filter(Boolean) : [],
          personalities: chance(0.3) ? [pick([...of("TINH_CACH"), ...of("PHONG_CACH")])].filter(Boolean) : [],
          budgetMin: chance(0.7) ? Math.floor((p.salePrice || p.price) * 0.6 / 100000) * 100000 : body.budgetMin, budgetMax: chance(0.7) ? Math.ceil((p.salePrice || p.price) * 1.3 / 100000) * 100000 : body.budgetMax,
        })
      } else {
        Object.assign(body, { recipient: pick(tagsByGroup.DOI_TUONG), occasions: some(tagsByGroup.DIP_TANG, 1), hobbies: some(tagsByGroup.SO_THICH, 2), personalities: some([...tagsByGroup.TINH_CACH, ...tagsByGroup.PHONG_CACH], 2) })
      }
      if (chance(0.5)) {
        body.ageMin = int(16, 30)
        body.ageMax = body.ageMin + int(2, 10)
      }
      const criteria = recRules.readCriteria(body, catalog.tagInfo)
      if (!recRules.hasAnyField(criteria)) continue
      const out = eng.recommend(criteria, catalog.items, catalog.tagInfo)
      const member = chance(0.45) ? pick(activeMembers.filter((u) => u.createdAt <= at)) : null
      const results = out.results.map((r) => ({ productId: new ObjectId(r.item.id), score: r.score, reasons: r.reasons, overBudget: r.overBudget }))
      const clicked = results.filter(() => chance(0.25)).map((r) => r.productId)
      let orderCodes = []
      if (member && clicked.length && chance(0.3)) {
        const o = (orderCodesByUser.get(String(member._id)) || []).find((x) => x.createdAt > at && x.createdAt - at < DAY)
        if (o) orderCodes = [o.code]
      }
      sessionsAi.push({
        userId: member ? member._id : null, sessionId: null, input: recRules.toInput(criteria, catalog.tagInfo), criteria: recRules.toInput(criteria, catalog.tagInfo), extractedTags: [],
        engine: eng.code, modelVersion: eng.modelVersion, results, combos: out.combos.map((c) => ({ name: c.name, productIds: c.items.map((it) => new ObjectId(it.id)), total: c.total, overBudget: c.overBudget })),
        matchedAll: out.matchedAll, tookMs: int(8, 60), clickedProductIds: clicked, orderCodes, refinements: [], createdAt: at, updatedAt: at,
      })
      if (!out.matchedAll) {
        const key = recRules.gapKeyOf(criteria, catalog.tagInfo)
        const x = gaps.get(key) || { criteriaKey: key, count: 0, status: "MOI", sampleInput: recRules.summaryOf(criteria, catalog.tagInfo), createdAt: at }
        x.count++
        x.lastSeenAt = at
        gaps.set(key, x)
      }
    }
  }
  await insertMany("aiSessions", sessionsAi)
  await insertMany("aiGaps", [...gaps.values()])

  // ----- Bộ đếm mã: đơn, giao dịch, yêu cầu, lưu kho, đơn nháp tạo tiếp không trùng mã có sẵn -----
  counters.set("draft", draftSeq)
  await db.collection("counters").insertMany([...counters].map(([_id, seq]) => ({ _id, seq })))
  console.log(`  counters: ${counters.size}`)

  // Kiểm tra nhanh
  const bad = orderDocs.filter((o) => o.total !== o.subtotal + o.shippingFee + o.personalizationFee + (o.urgentFee || 0) - o.discount)
  if (bad.length) throw new Error(`${bad.length} đơn sai công thức tổng tiền`)
  console.log(`Xong: ${orderDocs.length} đơn, ${users.filter((u) => u.role === "member").length} khách, ${staffList.length} nhân viên đang hoạt động.`)
  void maps
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => client.close())
