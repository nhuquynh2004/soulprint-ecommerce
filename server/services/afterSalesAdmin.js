// "Yêu cầu hậu mãi" phía quản trị (UC-OPS-07; API-99, API-196, API-102; SCR-50). Gộp 3 loại yêu cầu (đổi trả,
// bảo hành, hoàn tiền) vào 1 danh sách theo tab tiến độ (05 Mục 2.6), xếp theo mức ưu tiên BR-32 tính khi đọc (không
// lưu), rồi phân trang trong bộ nhớ như danh sách đơn S8. Hoàn tiền: nhân viên chuyển khoản rồi bấm "Đã chuyển khoản".
const { database, ObjectId } = require("../config/db")
const HttpError = require("../utils/httpError")
const rules = require("./afterSalesRules")
const opsRules = require("./opsRules")
const st = require("./orderState")
const ops = require("./orderOps")
const returns = require("./returns")
const warranty = require("./warranty")
const { writeLog } = require("./adminLog")
const { fmt } = require("./checkoutMath")
const { getStoreSettings } = require("./settings")
const { gateway } = require("./paymentGateway")
const { removeAccents } = require("../utils/vnText")

const orders = () => database.collection("orders")
const refunds = () => database.collection("refunds")
const PAGE_SIZE = 20
const MAX_ROWS = 2000

const canOf = (req) => (code) => !!req.isFullAccess || req.permissions.has(code)
const TYPES = { RETURN: "Đổi trả", WARRANTY: "Bảo hành", REFUND: "Hoàn tiền" }

// Hướng dẫn gửi hàng điền sẵn ở hộp thoại "Duyệt - Thu hồi hàng" (UC-OPS-07 bước 3)
const defaultInstruction = (code) =>
  [
    `1. Đóng gói sản phẩm kèm đầy đủ phụ kiện và mã yêu cầu ${code}.`,
    `2. Gửi hàng trong 3 ngày, ghi mã yêu cầu ${code} bên ngoài thùng.`,
    "3. Soulprint chịu phí vận chuyển gửi về, bạn không cần trả phí.",
  ].join("\n")

const firstItem = (o, itemId) => {
  const it = (o?.items || []).find((i) => !itemId || String(i._id) === String(itemId)) || {}
  return { name: it.name || "", variantName: it.variantName || null, image: it.image || null }
}

// ===== Dòng của bảng SCR-50 =====

function rowOf(kind, x, o, now, can) {
  const priority = rules.requestPriority(kind, x, now)
  const base = {
    kind,
    _id: String(x._id),
    orderCode: x.orderCode,
    customerName: o?.customer?.fullName || "",
    customerPhone: o?.customer?.phone || "",
    status: x.status,
    stage: rules.stageOf(kind, x.status),
    priority,
    priorityLevel: priority.level,
    priorityReason: priority.reason,
    slaRemaining: opsRules.remainingText(priority.deadline, now),
    waitingHours: rules.waitingHours(x.createdAt, now),
    createdAt: x.createdAt,
  }
  if (kind === "RETURN") {
    const reasons = [...new Set((x.items || []).map((i) => rules.RETURN_REASONS[i.reason]?.short || i.reason))]
    return {
      ...base, code: x.code, statusLabel: rules.RETURN_STATUS[x.status], product: { ...firstItem(o, x.items?.[0]?.orderItemId), more: Math.max(0, (x.items || []).length - 1) },
      typeLabel: rules.RESOLUTION_SHORT[x.resolution], reasonLabel: reasons.join(", "), amount: rules.returnValue(x), actions: rules.returnActions(x, can),
    }
  }
  if (kind === "WARRANTY") {
    return {
      ...base, code: x.code, statusLabel: rules.WARRANTY_STATUS[x.status], product: { ...firstItem(o, x.orderItemId), more: 0 },
      typeLabel: "Bảo hành", reasonLabel: rules.WARRANTY_SYMPTOMS[x.symptom], amount: null, actions: rules.warrantyActions(x, can),
    }
  }
  return {
    ...base, code: x.orderCode, statusLabel: rules.refundStatusLabel(x), product: { ...firstItem(o), more: Math.max(0, (o?.items || []).length - 1) },
    typeLabel: "Hoàn tiền", reasonLabel: rules.REFUND_REASONS[x.reason] || x.reason, amount: x.amount, actions: rules.refundActions(x, can),
  }
}

// API-99 GET /api/admin/requests?type=&stage=&q=&page=
async function list(req, query) {
  const now = new Date()
  const can = canOf(req)
  const type = TYPES[query.type] ? query.type : null
  const stage = rules.STAGES[query.stage] ? query.stage : null
  const want = (k) => !type || type === k
  const [rets, wars, refs] = await Promise.all([
    want("RETURN") ? database.collection("returnRequests").find({ status: { $ne: "DA_HUY" } }).sort({ createdAt: -1 }).limit(MAX_ROWS).toArray() : [],
    want("WARRANTY") ? database.collection("warrantyRequests").find({}).sort({ createdAt: -1 }).limit(MAX_ROWS).toArray() : [],
    want("REFUND") ? refunds().find({}).sort({ createdAt: -1 }).limit(MAX_ROWS).toArray() : [],
  ])
  const codes = [...new Set([...rets, ...wars, ...refs].map((x) => x.orderCode))]
  const orderMap = new Map((await orders().find({ code: { $in: codes } }, { projection: { code: 1, customer: 1, items: 1 } }).toArray()).map((o) => [o.code, o]))
  let rows = [
    ...rets.map((x) => rowOf("RETURN", x, orderMap.get(x.orderCode), now, can)),
    ...wars.map((x) => rowOf("WARRANTY", x, orderMap.get(x.orderCode), now, can)),
    ...refs.map((x) => rowOf("REFUND", x, orderMap.get(x.orderCode), now, can)),
  ]
  // Ô tìm: mã yêu cầu, mã đơn, tên hoặc SĐT khách, không phân biệt dấu
  const q = removeAccents(query.q || "")
  if (q) rows = rows.filter((r) => [r.code, r.orderCode, r.customerName, r.customerPhone].some((s) => removeAccents(s).includes(q)))

  const counts = { "tat-ca": rows.length, ...Object.fromEntries(Object.keys(rules.STAGES).map((k) => [k, 0])) }
  for (const r of rows) if (r.stage) counts[r.stage] += 1
  if (stage) rows = rows.filter((r) => r.stage === stage)
  rows.sort(opsRules.comparePriority)

  const page = Math.max(1, parseInt(query.page, 10) || 1)
  const total = rows.length
  return {
    items: rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(({ priority, ...r }) => ({ ...r, slaDeadline: priority.deadline })),
    counts, page, pageSize: PAGE_SIZE, total, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  }
}

// ===== API-196 chi tiết =====

function orderSummary(o) {
  return {
    code: o.code, createdAt: o.createdAt, deliveredAt: o.deliveredAt || null, orderStatus: o.orderStatus, orderStatusLabel: st.ORDER_LABEL[o.orderStatus],
    paymentStatus: o.paymentStatus, paymentStatusLabel: st.PAYMENT_LABEL[o.paymentStatus], paymentMethod: o.paymentMethod, total: o.total,
    paidAmount: o.paidAmount || 0, refundedAmount: o.refundedAmount || 0, refundable: rules.refundableOf(o), customer: o.customer,
    shippingAddress: o.shippingAddress, items: (o.items || []).map((it) => ({ _id: String(it._id), name: it.name, variantName: it.variantName, image: it.image, quantity: it.quantity, lineValue: it.lineValue, isPersonalized: !!it.isPersonalized })),
    history: st.history(o).slice(0, 30),
  }
}

const KINDS = { returns: "returnRequests", warranty: "warrantyRequests", refunds: "refunds" }

async function detail(req, kind, id) {
  if (!KINDS[kind] || !ObjectId.isValid(String(id))) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy yêu cầu")
  const x = await database.collection(KINDS[kind]).findOne({ _id: new ObjectId(String(id)) })
  if (!x) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy yêu cầu")
  const o = await orders().findOne({ code: x.orderCode })
  if (!o) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy đơn hàng của yêu cầu")
  const now = new Date()
  const can = canOf(req)
  const store = (await getStoreSettings()).store
  const common = {
    order: orderSummary(o),
    carriers: Object.entries(opsRules.CARRIERS).map(([value, label]) => ({ value, label })),
    rejectReasons: Object.entries(rules.REJECT_REASONS).map(([value, r]) => ({ value, label: r.label, hint: r.hint })),
    returnAddress: store.returnAddress || null,
  }
  if (kind === "returns") {
    const priority = rules.requestPriority("RETURN", x, now)
    return {
      ...returns.view(x, o, { store, staff: true }), ...common, priority: priority.level, priorityReason: priority.reason, slaRemaining: opsRules.remainingText(priority.deadline, now),
      actions: rules.returnActions(x, can), defaultInstruction: defaultInstruction(x.code), defaultRefund: rules.defaultRefund(x, o),
    }
  }
  if (kind === "warranty") {
    const priority = rules.requestPriority("WARRANTY", x, now)
    return {
      ...warranty.view(x, o, { store, staff: true }), ...common, priority: priority.level, priorityReason: priority.reason, slaRemaining: opsRules.remainingText(priority.deadline, now),
      actions: rules.warrantyActions(x, can), defaultInstruction: defaultInstruction(x.code),
      resolutions: Object.entries(rules.WARRANTY_RESOLUTIONS).map(([value, label]) => ({ value, label })),
    }
  }
  const priority = rules.requestPriority("REFUND", x, now)
  return {
    kind: "REFUND", _id: String(x._id), code: x.orderCode, orderCode: x.orderCode, reason: x.reason, reasonLabel: rules.REFUND_REASONS[x.reason] || x.reason,
    amount: x.amount, method: x.method, bankInfo: x.bankInfo || null, status: x.status, statusLabel: rules.refundStatusLabel(x), note: x.note || null,
    // Phần dư khi đơn đổi đã tính trước vào refundedAmount (preCounted) nhưng chưa chuyển: tách khỏi "Đã hoàn"
    pendingCounted: x.preCounted && x.status !== "DA_HOAN" ? x.amount : 0,
    failReason: x.failReason || null, processedAt: x.processedAt || null, createdAt: x.createdAt, slaDeadline: x.slaDeadline,
    priority: priority.level, priorityReason: priority.reason, slaRemaining: opsRules.remainingText(priority.deadline, now),
    ...common, actions: rules.refundActions(x, can),
  }
}

// ===== API-102 hoàn tiền =====

async function updateRefund(req, id, body) {
  const x = ObjectId.isValid(String(id)) ? await refunds().findOne({ _id: new ObjectId(String(id)) }) : null
  if (!x) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy yêu cầu hoàn tiền")
  // AC3: đã hoàn thì bấm lại 409
  if (x.status !== "CHO_XU_LY") throw new HttpError(409, "ALREADY_PROCESSED", x.status === "DA_HOAN" ? "Yêu cầu đã được hoàn tiền" : "Yêu cầu đang chờ khách nhập lại tài khoản")
  const o = await orders().findOne({ code: x.orderCode })
  if (!o) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy đơn hàng")
  const note = rules.text(body.note, 500)
  const now = new Date()
  const by = req.user._id

  if (body.status === "THAT_BAI") {
    // 7Ea: chuyển khoản thất bại, khách nhập lại tài khoản (UC-CNL-05 5a)
    if (rules.charCount(note) < 5) throw new HttpError(422, "VALIDATION_ERROR", "Nhập lý do thất bại (VD sai số tài khoản)", { fields: { note: "Nhập lý do" } })
    const r = await refunds().updateOne({ _id: x._id, status: "CHO_XU_LY" }, { $set: { status: "THAT_BAI", failReason: note, processedAt: now, processedBy: by, updatedAt: now } })
    if (!r.modifiedCount) throw new HttpError(409, "ALREADY_PROCESSED", "Yêu cầu đã được xử lý")
    await writeLog({ adminId: by, action: "REFUND_UPDATE", targetType: "refunds", targetId: x._id, reason: note, after: { summary: `Hoàn tiền đơn ${x.orderCode} thất bại` } })
    await ops.notifyOwner(o, { type: "HOAN_TIEN", title: `Đơn ${o.code}: chuyển khoản hoàn tiền chưa thành công`, body: `${note}. Vui lòng nhập lại tài khoản ngân hàng để Soulprint hoàn ${fmt(x.amount)}.` })
    return
  }
  if (body.status !== "DA_HOAN") throw new HttpError(400, "VALIDATION_ERROR", "Trạng thái không hợp lệ")
  if (x.method !== "GATEWAY" && !x.bankInfo) throw new HttpError(409, "WAITING_ACCOUNT", "Chờ khách nhập tài khoản nhận tiền")
  let refundTransId = null
  if (x.method === "GATEWAY") {
    const pay = await database.collection("payments").findOne({ orderCode: o.code, status: "SUCCESS" }, { sort: { paidAt: -1 } })
    if (pay) refundTransId = (await gateway.refund(pay, x.amount)).refundTransId
  }
  const r = await refunds().updateOne(
    { _id: x._id, status: "CHO_XU_LY" },
    { $set: { status: "DA_HOAN", note: note || x.note || null, refundTransId, processedAt: now, processedBy: by, updatedAt: now } },
  )
  if (!r.modifiedCount) throw new HttpError(409, "ALREADY_PROCESSED", "Yêu cầu đã được hoàn tiền")
  // Không hoàn quá số đã trả (đảm bảo tối thiểu của UC-OPS-07); phần dư khi đơn đổi đã trừ lúc đổi (preCounted)
  const refundedAmount = Math.min(o.paidAmount || 0, (o.refundedAmount || 0) + (x.preCounted ? 0 : x.amount))
  const remaining = st.refundOnCancel({ ...o, refundedAmount })
  const paymentStatus = rules.paymentStatusAfterRefund(o, refundedAmount, remaining)
  await orders().updateOne(
    { _id: o._id },
    {
      $set: { refundedAmount, paymentStatus, updatedAt: now },
      $push: { statusHistory: ops.historyEntry("paymentStatus", o.paymentStatus, paymentStatus, { by, at: now, note: `Hoàn ${fmt(x.amount)} (${rules.REFUND_REASONS[x.reason] || x.reason})` }) },
    },
  )
  await writeLog({ adminId: by, action: "REFUND_UPDATE", targetType: "refunds", targetId: x._id, reason: note || null, after: { summary: `Đã hoàn ${fmt(x.amount)} đơn ${x.orderCode}` } })
  await ops.notifyOwner(o, {
    type: "HOAN_TIEN",
    title: `Đơn ${o.code}: Soulprint đã hoàn ${fmt(x.amount)}`,
    body: x.method === "GATEWAY" ? "Tiền đã được hoàn qua cổng thanh toán." : `Tiền đã chuyển về ${x.bankInfo.bankName} ${st.maskAccount(x.bankInfo.accountNumber)}.`,
  })
}

module.exports = { list, detail, updateRefund, defaultInstruction }
