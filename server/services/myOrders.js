// Đơn hàng của khách (UC-TRK-02, CNL-01, CNL-02, CNL-03; 07_API_Spec.md API-42 đến API-46). Quy tắc thuần ở
// orderState.js; file này đọc ghi CSDL. Mọi lần đổi trạng thái là updateOne có điều kiện trạng thái hiện tại
// (UC-CNL-02 ghi chú kỹ thuật) để không ghi đè khi nhân viên thao tác cùng lúc.
const { database, ObjectId } = require("../config/db")
const params = require("../config/params")
const HttpError = require("../utils/httpError")
const st = require("./orderState")
const cart = require("./cart")
const { notifier } = require("./notifier")
const { fmt } = require("./checkoutMath")
const { stockNeeds } = require("./order")
const { getStoreSettings } = require("./settings")
const afterRules = require("./afterSalesRules")
const { codPaid, SPECIAL_LABELS } = require("./opsRules")

const orders = () => database.collection("orders")
const users = () => database.collection("users")
const refunds = () => database.collection("refunds")
const HOUR = 60 * 60 * 1000
const PAGE_SIZE = 10

// BR-26: DA_GIAO quá 72 giờ tự chuyển HOAN_THANH; chạy mỗi giờ và mỗi lần khách đọc đơn (Render có thể đang ngủ)
async function autoComplete(extra = {}, now = new Date()) {
  const cutoff = new Date(now.getTime() - params.AUTO_COMPLETE_HOURS * HOUR)
  const done = { $add: ["$deliveredAt", params.AUTO_COMPLETE_HOURS * HOUR] }
  const r = await orders().updateMany({ ...extra, orderStatus: "DA_GIAO", deliveredAt: { $lte: cutoff } }, [
    {
      $set: {
        orderStatus: "HOAN_THANH",
        completedAt: done,
        updatedAt: now,
        statusHistory: {
          $concatArrays: [
            "$statusHistory",
            [{ field: "orderStatus", from: "DA_GIAO", to: "HOAN_THANH", at: done, by: null, byRole: "HE_THONG", note: "Tự hoàn tất sau 72 giờ kể từ khi giao (BR-26)" }],
          ],
        },
      },
    },
  ])
  return r.modifiedCount
}

// Yêu cầu hoàn tiền mới nhất theo mã đơn
async function latestRefunds(codes) {
  if (!codes.length) return new Map()
  const list = await refunds().find({ orderCode: { $in: codes } }).sort({ createdAt: -1 }).toArray()
  const map = new Map()
  for (const r of list) if (!map.has(r.orderCode)) map.set(r.orderCode, r)
  return map
}

// needsAccount: chờ khách nhập (lại) tài khoản - chuyển khoản thất bại hoặc yêu cầu tạo khi chưa có tài khoản (UC-CNL-05 5a)
const refundView = (r) =>
  r
    ? {
        amount: r.amount, status: r.status, method: r.method, bankName: r.bankInfo?.bankName || null, account: st.maskAccount(r.bankInfo?.accountNumber),
        createdAt: r.createdAt, processedAt: r.processedAt || null, failReason: r.status === "THAT_BAI" ? r.failReason || null : null,
        needsAccount: r.method !== "GATEWAY" && (r.status === "THAT_BAI" || (r.status === "CHO_XU_LY" && !r.bankInfo)),
        reason: r.reason, voucherCode: r.voucherCode || null,
        // Phần dư khi đơn đổi đang chờ chuyển khoản: khách đổi sang voucher dùng ngay được (API-219)
        canTakeVoucher: r.reason === "DOI_DON" && r.method !== "VOUCHER" && ["CHO_XU_LY", "THAT_BAI"].includes(r.status),
      }
    : null

const personalizationText = (p) => {
  if (!p) return null
  if (p.type === "IN_KHAC") return p.mode === "AO_DAU" ? [p.top, p.number, p.bottom].filter(Boolean).join(" ") : p.text
  return [(p.stickers || []).map((x) => x.name).join(", "), p.message].filter(Boolean).join(", ")
}

// ===== API-42 danh sách =====

function summary(o, refund, now) {
  const first = o.items[0] || {}
  return {
    code: o.code,
    createdAt: o.createdAt,
    orderStatus: o.orderStatus,
    paymentStatus: o.paymentStatus,
    total: o.total,
    paidAmount: o.paidAmount,
    depositAmount: o.depositAmount,
    remainingAmount: o.remainingAmount,
    refundedAmount: o.refundedAmount || 0,
    paymentMethod: o.paymentMethod,
    hasPersonalizedItems: !!o.hasPersonalizedItems,
    itemCount: o.items.length,
    firstItem: { name: first.name, variantName: first.variantName, image: first.image, quantity: first.quantity, unitPrice: first.unitPrice, personalization: first.personalization, personalizationText: personalizationText(first.personalization) },
    cancelCase: o.cancelCase || null,
    cancelledAt: o.cancelledAt || null,
    cancelReason: o.cancelReason ? st.cancelLabel(o.cancelReason) : null,
    cancelBy: o.cancelBy || null,
    cancelCause: o.cancelCause || null,
    storageStatus: o.storageStatus || null,
    storageDeadline: o.storageDeadline || null,
    returnStatus: o.returnStatus || "KHONG_CO",
    carrier: o.carrier || null,
    trackingCode: o.trackingCode || null,
    refund: refundView(refund),
    needAction: st.needsAction(o),
    actions: st.actions(o, { now, refund }),
    urgent: urgentTag(o),
  }
}

// Thẻ "Đơn gấp" phía khách giữ tới khi hoàn thành
const urgentTag = (o) => !!o.urgentCode && !["HOAN_THANH", "DA_HUY"].includes(o.orderStatus)

async function list(user, query) {
  const now = new Date()
  await autoComplete({ userId: user._id }, now)
  const tab = Object.prototype.hasOwnProperty.call(st.TABS, query.tab) ? query.tab : "tat-ca"
  const range = Object.prototype.hasOwnProperty.call(st.RANGES, query.range) ? query.range : "3m"
  const page = Math.max(1, parseInt(query.page, 10) || 1)
  const since = st.rangeStart(range, now)
  const base = { userId: user._id, ...(since ? { createdAt: { $gte: since } } : {}) }

  // Đếm theo tab và số đơn cần xử lý trong khoảng thời gian đang lọc
  const all = await orders().find(base, { projection: { orderStatus: 1, items: 1, cancelCase: 1, storageStatus: 1, "unfulfillable.status": 1, pendingChange: 1 } }).toArray()
  const counts = Object.fromEntries(Object.keys(st.TABS).map((k) => [k, 0]))
  counts["tat-ca"] = all.length
  for (const o of all) counts[st.tabOf(o.orderStatus)] += 1
  const needAction = all.filter(st.needsAction).length
  const everOrdered = all.length > 0 || (await orders().countDocuments({ userId: user._id }, { limit: 1 })) > 0

  // Tab Đổi trả và bảo hành liệt kê yêu cầu (returnRequests, warrantyRequests), mỗi yêu cầu có tiến độ riêng (05 Mục 2.5)
  const reqFilter = { userId: user._id, ...(since ? { createdAt: { $gte: since } } : {}) }
  const [rets, wars] = await Promise.all([
    database.collection("returnRequests").find({ ...reqFilter, status: { $ne: "DA_HUY" } }).sort({ createdAt: -1 }).toArray(),
    database.collection("warrantyRequests").find(reqFilter).sort({ createdAt: -1 }).toArray(),
  ])
  counts["doi-tra-bao-hanh"] = rets.length + wars.length
  if (tab === "doi-tra-bao-hanh") {
    const all = [...rets.map((x) => ["RETURN", x]), ...wars.map((x) => ["WARRANTY", x])].sort((a, b) => new Date(b[1].createdAt) - new Date(a[1].createdAt))
    const pageList = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    const owners = new Map((await orders().find({ _id: { $in: pageList.map(([, x]) => x.orderId) } }).toArray()).map((o) => [String(o._id), o]))
    const { store } = await getStoreSettings()
    const returns = require("./returns")
    const warranty = require("./warranty")
    const requests = pageList.map(([kind, x]) => (kind === "RETURN" ? returns.view(x, owners.get(String(x.orderId)), { store }) : warranty.view(x, owners.get(String(x.orderId)), { store })))
    return { tab, range, counts, needAction, everOrdered, requests, items: [], page, totalPages: Math.max(1, Math.ceil(all.length / PAGE_SIZE)) }
  }

  // Yêu cầu đặt gấp chưa thành đơn: đang mở nằm ở tab Chờ xác nhận, đã từ chối/hủy ở tab Đã hủy; hiện trên trang 1
  const urgent = await urgentCards(user, since)
  for (const u of urgent) {
    counts["tat-ca"] += 1
    counts[u.tab] += 1
  }
  const urgentNeed = urgent.filter((u) => u.status === "DA_CHOT").length

  const filter = { ...base, ...(st.TABS[tab] ? { orderStatus: { $in: st.TABS[tab] } } : {}) }
  const total = await orders().countDocuments(filter)
  const docs = await orders().find(filter).sort({ createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).toArray()
  const refundMap = await latestRefunds(docs.map((o) => o.code))
  return {
    tab, range, counts, needAction: needAction + urgentNeed, everOrdered: everOrdered || urgent.length > 0,
    urgentRequests: page === 1 ? urgent.filter((u) => tab === "tat-ca" || u.tab === tab) : [],
    items: docs.map((o) => summary(o, refundMap.get(o.code), now)),
    page, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  }
}

const URGENT_CARD_LABEL = { CHO_XEM_XET: "Shop đang xem xét", DA_CHOT: "Chờ bạn thanh toán", TU_CHOI: "Shop từ chối", KHACH_HUY: "Bạn đã hủy" }

// Thẻ yêu cầu gấp ở SCR-18 (draftOrders kind DAT_GAP chưa thành đơn)
async function urgentCards(user, since) {
  const list = await database.collection("draftOrders")
    .find({ kind: "DAT_GAP", customerUserId: user._id, status: { $ne: "HOAN_TAT" }, ...(since ? { createdAt: { $gte: since } } : {}) })
    .sort({ createdAt: -1 }).limit(20).toArray()
  if (!list.length) return []
  const ids = [...new Set(list.map((d) => String(d.items?.[0]?.productId || "")).filter((x) => ObjectId.isValid(x)))].map((x) => new ObjectId(x))
  const prods = new Map((await database.collection("products").find({ _id: { $in: ids } }, { projection: { name: 1, images: 1, variants: 1, optionGroups: 1 } }).toArray()).map((p) => [String(p._id), p]))
  return list.map((d) => {
    const status = d.urgent?.status || "CHO_XEM_XET"
    const first = d.items?.[0] || {}
    const p = prods.get(String(first.productId)) || {}
    const v = (p.variants || []).find((x) => x.sku === first.variantSku)
    return {
      code: d.code, status, statusLabel: URGENT_CARD_LABEL[status] || status, tab: ["TU_CHOI", "KHACH_HUY"].includes(status) ? "da-huy" : "cho-xac-nhan",
      createdAt: d.createdAt, requestedDate: d.urgent?.requestedDate || d.deliveryDate, deliveryDate: d.deliveryDate, total: d.totalEstimate ?? null,
      itemCount: (d.items || []).length,
      firstItem: { name: p.name || "Sản phẩm", variantName: v?.name || null, image: p._id ? cart.variantImage(p, v) : null, quantity: first.quantity || 1, personalizationText: personalizationText(first.personalization) },
      rejectReason: d.urgent?.rejectReason || null, url: `/dat-gap/${d.code}`,
    }
  })
}

// ===== API-43 chi tiết =====

// mode: "owner" (Member chủ đơn), "session" (phiên vừa đặt - SCR-09), "lookup" (phiên tra cứu: che thông tin, không nút)
async function detail(o, mode) {
  const now = new Date()
  const refund = (await latestRefunds([o.code])).get(o.code) || null
  const lookup = mode === "lookup"
  const ids = o.items.map((it) => it.productId).filter(Boolean)
  const prods = await database.collection("products").find({ _id: { $in: ids } }, { projection: { slug: 1, personalization: 1 } }).toArray()
  const slugs = new Map(prods.map((p) => [String(p._id), p.slug]))
  // Sản phẩm có hỗ trợ cá nhân hóa: món thường được "Thêm cá nhân hóa" khi đơn chờ xác nhận (UC-TRK-06 1b)
  const pzTypes = new Map(prods.map((p) => [String(p._id), p.personalization && p.personalization.allowed ? p.personalization.types || [] : []]))
  const owner = await users().findOne({ _id: o.userId }, { projection: { status: 1, refundAccount: 1 } })
  const a = o.shippingAddress || {}
  // Hậu mãi của chủ đơn (S9): đánh giá, bảo hành từng dòng, yêu cầu đổi trả và bảo hành. Nạp lúc chạy vì các file đó dùng lại file này.
  const isOwner = mode === "owner"
  const reviewMap = isOwner ? await require("./reviews").forOrder(o) : new Map()
  const warrantyMap = isOwner ? await require("./warranty").itemStates(o, now) : new Map()
  const store = isOwner ? (await getStoreSettings()).store : null
  const view = {
    code: o.code,
    createdAt: o.createdAt,
    urgent: urgentTag(o),
    urgentCode: o.urgentCode || null,
    customer: lookup ? { fullName: st.maskName(o.customer.fullName), phone: st.maskPhoneShort(o.customer.phone) } : o.customer,
    items: o.items.map((it) => ({
      _id: String(it._id), name: it.name, variantName: it.variantName, image: it.image, slug: slugs.get(String(it.productId)) || null, quantity: it.quantity,
      unitPrice: it.unitPrice, lineValue: it.lineValue, personalization: it.personalization, personalizationText: personalizationText(it.personalization),
      personalizationFeePerUnit: it.personalizationFeePerUnit, isPersonalized: it.isPersonalized, fulfillStatus: it.fulfillStatus,
      substitute: it.substitute ? { name: it.substitute.name, variantName: it.substitute.variantName, image: it.substitute.image, unitPrice: it.substitute.unitPrice } : null,
      canEditPersonalization: isOwner && it.isPersonalized && (it.fulfillStatus || "BINH_THUONG") === "BINH_THUONG" && o.orderStatus === "CHO_XAC_NHAN" && !o.pendingChange && !o.urgentCode,
      canAddPersonalization: isOwner && !it.isPersonalized && (pzTypes.get(String(it.productId)) || []).length > 0 && (it.fulfillStatus || "BINH_THUONG") === "BINH_THUONG" && o.orderStatus === "CHO_XAC_NHAN" && !o.pendingChange && !o.urgentCode,
      reviewed: !!it.reviewed,
      review: reviewMap.get(String(it._id)) || null,
      warranty: warrantyMap.get(String(it._id)) || null,
    })),
    giftWrap: o.giftWrap,
    recipientType: o.recipientType,
    shippingAddress: lookup
      ? { recipientName: st.maskName(a.recipientName), phone: st.maskPhoneShort(a.phone), province: a.province, ward: st.maskWard(a.ward), street: st.maskStreet(a.street), deliveryDate: a.deliveryDate, deliveryWindow: a.deliveryWindow }
      : a,
    noteForShop: lookup ? "" : o.noteForShop,
    subtotal: o.subtotal,
    personalizationFee: o.personalizationFee,
    giftWrapFee: o.giftWrapFee,
    shippingFee: o.shippingFee,
    urgentFee: o.urgentFee || 0,
    urgentCode: o.urgentCode || null,
    discount: o.discount,
    vouchers: (o.vouchers || []).map(({ code, type, value, discount }) => ({ code, type, value, discount })),
    total: o.total,
    depositAmount: o.depositAmount,
    remainingAmount: o.remainingAmount,
    paidAmount: o.paidAmount,
    codPaid: codPaid(o),
    refundedAmount: o.refundedAmount || 0,
    paymentMethod: o.paymentMethod,
    remainingMethod: o.remainingMethod,
    orderStatus: o.orderStatus,
    paymentStatus: o.paymentStatus,
    returnStatus: o.returnStatus || "KHONG_CO",
    carrier: o.carrier || null,
    trackingCode: o.trackingCode || null,
    deliveredAt: o.deliveredAt || null,
    completedAt: o.completedAt || null,
    cancelledAt: o.cancelledAt || null,
    cancelReason: o.cancelReason ? st.cancelLabel(o.cancelReason) : null,
    cancelDetail: o.cancelDetail || null,
    cancelBy: o.cancelBy || null,
    cancelCause: o.cancelCause || null,
    cancelCase: o.cancelCase || null,
    storageStatus: o.storageStatus || null,
    storageDeadline: o.storageDeadline || null,
    refund: refundView(refund),
    timeline: st.timeline(o),
    history: st.history(o),
    expectedDeliveryDate: o.expectedDeliveryDate || null,
    actions: isOwner ? { ...st.actions(o, { now, refund }), warranty: [...warrantyMap.values()].some((w) => w.allowed) } : null,
    returns: isOwner ? await require("./returns").forOrder(o, { store }) : [],
    warranties: isOwner ? await require("./warranty").forOrder(o, { store }) : [],
    returnDeadline: afterRules.returnDeadline(o),
    returnDaysLeft: afterRules.daysLeft(afterRules.returnDeadline(o), now),
    sourceOrderCode: o.sourceOrderCode || null,
    replacementFor: o.replacementFor ? { kind: o.replacementFor.kind, requestCode: o.replacementFor.requestCode } : null,
    redeliveryCount: o.redeliveryCount || 0,
    // Hộp thoại "Nhận lại hàng" (UC-CNL-04 bước 2, 4)
    redelivery: isOwner && o.cancelCase === "TH3" && o.storageStatus === "DANG_LUU_KHO" ? await require("./redelivery").costOf(o) : null,
    // Soulprint không thực hiện được món, đang hỏi khách có muốn đổi không (UC-TRK-02 5d)
    asking: isOwner && o.orderStatus === "CHO_XAC_NHAN" && o.unfulfillable && o.unfulfillable.status === "DANG_HOI_KHACH"
      ? {
          message: o.unfulfillable.message, responseDeadline: o.unfulfillable.responseDeadline || null,
          itemNames: o.items.filter((it) => (o.unfulfillable.itemIds || []).map(String).includes(String(it._id))).map((it) => it.name),
        }
      : null,
    // Khoảng ngày giao khi khách sửa thông tin giao hàng (UC-TRK-06): đơn giao người nhận, hoặc đơn Giao cho tôi đổi sang Giao người nhận (2a)
    editDelivery: isOwner && o.orderStatus === "CHO_XAC_NHAN" && !o.urgentCode
      ? (() => {
          const cm = require("./checkoutMath")
          const opts = { personalized: !!o.hasPersonalizedItems }
          const hcm = cm.deliveryRange(now, { ...opts, province: "Hồ Chí Minh" })
          const other = cm.deliveryRange(now, { ...opts, province: "Tỉnh khác" })
          return { hcm: { min: hcm.min, max: hcm.max }, other: { min: other.min, max: other.max }, slots: hcm.slots }
        })()
      : null,
    // Thay đổi chờ khách trả thêm (BR-47): nút Thanh toán mở cổng
    pendingChange: isOwner && o.pendingChange
      ? { amount: o.pendingChange.amount, summary: o.pendingChange.summary, expiresAt: o.pendingChange.expiresAt, paymentId: String(o.pendingChange.paymentId), paymentUrl: o.pendingChange.paymentUrl || `/cong-thanh-toan/${o.pendingChange.paymentId}` }
      : null,
    needAction: st.needsAction(o),
    version: st.orderVersion(o), // so với API-229 để SCR-19 tự tải lại
    // Lượt khách tự sửa làm đổi tổng còn lại (BR-47)
    valueEditsLeft: isOwner ? require("./orderChange").editsLeftOf(o) : 0,
    accountPending: !!owner && owner.status === "CHO_KICH_HOAT",
    // Hộp thoại hủy: số được hoàn và tài khoản đã lưu (che số)
    cancelRefundAmount: mode === "owner" ? st.refundOnCancel(o) : null,
    refundAccount: mode === "owner" && owner?.refundAccount
      ? { bankName: owner.refundAccount.bankName, accountName: owner.refundAccount.accountName, account: st.maskAccount(owner.refundAccount.accountNumber) }
      : null,
  }
  return view
}

// Đơn của Member (404 nếu không phải chủ đơn - TRK-02 AC5, 4Ea)
async function ownOrder(user, code) {
  await autoComplete({ userId: user._id, code })
  const o = await orders().findOne({ code: String(code), userId: user._id })
  if (!o) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy đơn hàng")
  return o
}

// ===== API-44 hủy đơn =====

// Cộng trả tồn biến thể, vật liệu gói quà (ghi stockMovements HOAN_DON); trả lượt voucher nếu chưa trả tiền.
// opts.items: chỉ trả các dòng này (VD hủy sau khi đã cá nhân hóa thì món đã làm không về kho - S8);
// opts.materials = false khi gói quà đã dùng (đơn đã giao cho vận chuyển - BR-36).
async function releaseStock(o, now, { items = o.items, materials = true } = {}) {
  const lines = items.filter((it) => !["DA_HOAN_TIEN", "DA_THAY_THE"].includes(it.fulfillStatus))
  for (const need of stockNeeds(lines.map((it) => ({ productId: String(it.productId), variantSku: it.variantSku, name: it.name, quantity: it.quantity })))) {
    await database.collection("products").updateOne(
      { _id: new ObjectId(need.productId), "variants.sku": need.variantSku },
      { $inc: { "variants.$.stock": need.quantity, soldCount: -need.quantity } },
    )
  }
  if (o.giftWrap && materials) {
    for (const slot of ["paper", "ribbon", "card"]) {
      const code = o.giftWrap[slot]?.code
      if (!code) continue
      const m = await database.collection("giftWrapMaterials").findOneAndUpdate({ code }, { $inc: { stock: 1 } }, { returnDocument: "after" })
      if (m) {
        await database.collection("stockMovements").insertOne({ materialId: m._id, materialCode: code, type: "HOAN_DON", quantity: 1, orderCode: o.code, stockAfter: m.stock, by: null, createdAt: now })
      }
    }
  }
  if (!(o.paidAmount > 0)) {
    for (const v of o.vouchers || []) {
      await database.collection("vouchers").updateOne({ _id: v.voucherId }, { $inc: { usedCount: -1, discountGiven: -v.discount } })
      await database.collection("userVouchers").updateOne({ userId: o.userId, voucherId: v.voucherId, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } })
    }
  }
}

// Tài khoản nhận tiền hoàn: tài khoản đã lưu hoặc tài khoản mới nhập
async function chooseRefundAccount(user, body) {
  if (body.useSavedAccount === true) {
    const u = await users().findOne({ _id: user._id }, { projection: { refundAccount: 1 } })
    if (u?.refundAccount) {
      const { bankName, accountNumber, accountName } = u.refundAccount
      return { account: { bankName, accountNumber, accountName }, save: false }
    }
  }
  const { account, errors } = st.readRefundAccount(body.refundAccount)
  if (Object.values(errors).some(Boolean)) {
    throw new HttpError(400, "VALIDATION_ERROR", "Vui lòng nhập tài khoản nhận tiền hoàn", { fields: Object.fromEntries(Object.entries(errors).filter(([, v]) => v)) })
  }
  return { account, save: body.saveAccount === true }
}

async function cancel(user, code, body) {
  const reason = String(body.reason || "")
  const detailText = typeof body.detail === "string" ? body.detail.normalize("NFC").trim().slice(0, 300) : ""
  const fields = {}
  if (!st.CANCEL_REASONS[reason]) fields.reason = "Vui lòng chọn lý do hủy"
  else if (reason === "KHAC" && !detailText) fields.detail = "Vui lòng nhập lý do"
  if (Object.keys(fields).length) throw new HttpError(400, "VALIDATION_ERROR", "Vui lòng chọn lý do hủy", { fields })

  const o = await ownOrder(user, code)
  if (!st.canCancel(o)) {
    throw new HttpError(422, "BUSINESS_RULE", o.orderStatus === "DA_HUY" ? "Đơn hàng đã được hủy" : "Đơn hàng đã được xử lý tiếp, không thể hủy", { rule: "BR-27" })
  }
  // Đơn đang được hỏi ý kiến (UC-CNL-02 3c): lý do "Đơn hàng không thể thực hiện" chỉ dùng được lúc này
  const asking = !!o.unfulfillable && o.unfulfillable.status === "DANG_HOI_KHACH"
  if (reason === "KHONG_THE_THUC_HIEN" && !asking) throw new HttpError(400, "VALIDATION_ERROR", "Vui lòng chọn lý do hủy", { fields: { reason: "Lý do không áp dụng cho đơn này" } })
  const amount = st.refundOnCancel(o)
  const refundTo = amount > 0 ? await chooseRefundAccount(user, body) : null

  const now = new Date()
  const cancelCase = st.cancelCase(o)
  const r = await orders().updateOne(
    { _id: o._id, orderStatus: o.orderStatus },
    {
      $set: {
        orderStatus: "DA_HUY", cancelledAt: now, cancelReason: reason, cancelDetail: detailText || null, cancelBy: "MEMBER", cancelCase, updatedAt: now,
        // Khách hủy khi đang được hỏi: đóng "Đang hỏi khách", chờ nhân viên quyết định voucher xin lỗi (BR-30 c)
        ...(asking ? { "unfulfillable.status": "DA_DONG", "unfulfillable.outcome": "KHACH_HUY", "unfulfillable.closedAt": now, "unfulfillable.closedBy": user._id, "unfulfillable.apologyVoucher": { pending: true } } : {}),
      },
      ...(asking ? { $pull: { tags: require("./orderChange").ASKING_TAG } } : {}),
      $push: { statusHistory: { field: "orderStatus", from: o.orderStatus, to: "DA_HUY", at: now, by: user._id, byRole: "KHACH", note: st.CANCEL_REASONS[reason] + (detailText ? ": " + detailText : "") } },
    },
  )
  // 4Ea: nhân viên vừa chuyển đơn sang trạng thái khác
  if (!r.modifiedCount) throw new HttpError(409, "INVALID_TRANSITION", "Đơn hàng đã được xử lý tiếp, không thể hủy")
  // Đơn đang chờ trả thêm cho thay đổi: hủy giao dịch đó
  if (o.pendingChange) await dropPendingChange(o)
  await closeApprovalsOnCancel(o, now)

  try {
    await releaseStock(o, now)
  } catch (err) {
    console.error("Trả tồn khi hủy đơn lỗi:", err.message)
  }

  let refund = null
  if (refundTo) {
    refund = {
      orderId: o._id, orderCode: o.code, userId: user._id, reason: "HUY_DON", amount, method: "BANK_TRANSFER", bankInfo: refundTo.account,
      status: "CHO_XU_LY", slaDeadline: new Date(now.getTime() + params.REFUND_SLA_HOURS * HOUR), createdAt: now, updatedAt: now,
    }
    refund._id = (await refunds().insertOne(refund)).insertedId
    if (refundTo.save) await users().updateOne({ _id: user._id }, { $set: { refundAccount: { ...refundTo.account, savedAt: now }, updatedAt: now } })
  }

  await notifier.notify(user, {
    type: refund ? "HOAN_TIEN" : "DON_HANG",
    title: `Đơn ${o.code} đã hủy`,
    body: refund
      ? `Yêu cầu hoàn ${fmt(amount)} về ${refund.bankInfo.bankName} ${st.maskAccount(refund.bankInfo.accountNumber)} đã được ghi nhận. Tiền về trong 1 - 3 ngày làm việc.`
      : "Bạn có thể đặt lại đơn bất cứ lúc nào.",
    link: `/tai-khoan/don-hang/${o.code}`,
  }).catch((err) => console.error("Gửi thông báo hủy đơn lỗi:", err.message))

  return detail(await orders().findOne({ _id: o._id }), "owner")
}

// ===== API-45 đã nhận hàng =====

async function received(user, code) {
  const o = await ownOrder(user, code)
  const now = new Date()
  const r = await orders().updateOne(
    { _id: o._id, orderStatus: "DA_GIAO" },
    {
      $set: { orderStatus: "HOAN_THANH", completedAt: now, updatedAt: now },
      $push: { statusHistory: { field: "orderStatus", from: "DA_GIAO", to: "HOAN_THANH", at: now, by: user._id, byRole: "KHACH", note: "Khách xác nhận đã nhận hàng" } },
    },
  )
  if (!r.modifiedCount) throw new HttpError(409, "INVALID_TRANSITION", "Đơn hàng chưa ở trạng thái Đã giao")
  return detail(await orders().findOne({ _id: o._id }), "owner")
}

// ===== API-46 đặt lại / mua lại =====

async function reorder(req, code) {
  const o = await ownOrder(req.user, code)
  if (!st.actions(o).reorder) {
    throw new HttpError(422, "BUSINESS_RULE", o.cancelCase === "TH3" ? "Đơn cá nhân hóa đang chờ nhận lại hàng, không thể đặt lại" : "Đơn hàng này chưa thể đặt lại", { rule: "BR-28" })
  }
  const lines = o.items.map((it) => ({
    productId: String(it.productId),
    variantSku: it.variantSku,
    name: it.name,
    quantity: it.quantity,
    priceAtOrder: it.unitPrice,
    personalization: it.personalization
      ? it.personalization.type === "THIET_KE"
        ? { type: "THIET_KE", stickers: (it.personalization.stickers || []).map((x) => x.code), message: it.personalization.message || "" }
        : it.personalization
      : null,
  }))
  const { view, added, skipped } = await cart.addLines(req, lines)
  // 2Ea: không còn sản phẩm nào thì báo và ở lại chi tiết đơn
  if (!added) throw new HttpError(422, "NOTHING_AVAILABLE", "Các sản phẩm của đơn không còn khả dụng", { skipped })
  return { cart: view, added, skipped }
}

// Hủy đơn khi đang có thay đổi chờ thanh toán (BR-47): giao dịch ORDER_CHANGE thành thất bại, bỏ chỗ giữ
async function dropPendingChange(o) {
  await require("./payment").cancelPending(o.pendingChange.paymentId).catch(() => 0)
  await orders().updateOne({ _id: o._id }, { $unset: { pendingChange: "" } })
}

// BR-48: đơn bị hủy khi đang có yêu cầu duyệt ngoại lệ thì yêu cầu tự đóng, rời tab Chờ duyệt, báo người gửi
async function closeApprovalsOnCancel(o, now = new Date()) {
  if (!o.approvalPending) return
  const x = await database.collection("approvalRequests").findOneAndUpdate(
    { orderCode: o.code, status: "CHO_DUYET" },
    { $set: { status: "DONG_THEO_DON", decidedAt: now } },
  )
  await orders().updateOne({ _id: o._id }, { $unset: { approvalPending: "" }, $pull: { tags: "Chờ duyệt ngoại lệ" } })
  if (!x) return
  await database.collection("staffMentions").insertOne({
    adminId: x.requestedBy, byAdminId: null, byName: "Hệ thống", orderCode: o.code, noteId: null,
    excerpt: `Đã đóng: ${SPECIAL_LABELS[x.type] || "yêu cầu duyệt"} (đơn đã hủy)`, readAt: null, createdAt: now,
  })
}

module.exports = { autoComplete, list, detail, ownOrder, cancel, received, reorder, personalizationText, latestRefunds, refundView, releaseStock, chooseRefundAccount, dropPendingChange, closeApprovalsOnCancel }
