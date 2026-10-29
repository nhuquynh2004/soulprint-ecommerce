// Quy tắc hậu mãi (UC-TRK-03, TRK-04, TRK-05, OPS-07; 05_Diagrams.md Mục 2.3, 2.6). Hàm thuần, không đọc
// CSDL để unit test được: nhãn lý do và trạng thái, kiểm tra yêu cầu đổi trả (BR-12, BR-13, BR-14, BR-31) và bảo hành
// (BR-17), tiến trình hiện cho khách, tab và mức ưu tiên ở "Yêu cầu hậu mãi" (BR-32), nút được phép theo trạng thái
// và quyền, tên che của đánh giá.
const params = require("../config/params")

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

// ===== Nhãn =====

// 5 lý do đổi trả của SCR-25; `short` dùng ở cột Sản phẩm của SCR-50
const RETURN_REASONS = {
  LOI_IN_KHAC: { label: "Lỗi in/khắc (sai chữ, mờ, lệch)", short: "Lỗi in/khắc", soulprintFault: true, photo: true },
  HU_HONG: { label: "Hư hỏng, bể vỡ khi nhận", short: "Hư hỏng khi nhận", soulprintFault: true, photo: true },
  GIAO_SAI: { label: "Giao sai sản phẩm, sai size", short: "Giao sai sản phẩm", soulprintFault: true, photo: false },
  KHONG_DUNG_MO_TA: { label: "Không đúng mô tả", short: "Không đúng mô tả", soulprintFault: true, photo: false },
  DOI_Y: { label: "Đổi ý, không còn nhu cầu", short: "Đổi ý", soulprintFault: false, photo: false },
}
const RESOLUTIONS = { GIAO_LAI: "Giao hàng lại", HOAN_TIEN: "Trả hàng, hoàn tiền" }
// Loại hiện ở bảng SCR-50: "Đổi hàng · Lỗi in/khắc", "Trả hàng hoàn tiền · Hư hỏng khi nhận"
const RESOLUTION_SHORT = { GIAO_LAI: "Đổi hàng", HOAN_TIEN: "Trả hàng hoàn tiền" }

const RETURN_STATUS = {
  DANG_YEU_CAU: "Chờ duyệt",
  DONG_Y: "Đã duyệt, chờ gửi hàng",
  DA_NHAN_HANG: "Đã nhận hàng, đang kiểm tra",
  TU_CHOI: "Từ chối",
  DA_HOAN_TAT: "Hoàn tất",
  DA_HUY: "Đã hủy",
}

const WARRANTY_SYMPTOMS = {
  KHONG_HOAT_DONG: "Không hoạt động",
  CHAP_CHON: "Hoạt động chập chờn",
  HONG_MOT_PHAN: "Hỏng một phần",
  BONG_MO_IN_KHAC: "Lớp in/khắc bong, mờ",
  KHAC: "Khác",
}
const SHIPPING_METHODS = { SHIPPER_LAY: "Shipper đến lấy", TU_GUI: "Tự gửi đến cửa hàng" }
const WARRANTY_RESOLUTIONS = { SUA_CHUA: "Sửa chữa", DOI_MOI: "Đổi sản phẩm mới" }
const WARRANTY_STATUS = {
  DANG_XEM_XET: "Đang xem xét",
  DA_DUYET: "Đã duyệt, chờ nhận sản phẩm",
  DA_NHAN_HANG: "Đã nhận sản phẩm, đang xử lý",
  TU_CHOI: "Từ chối",
  HOAN_TAT: "Hoàn tất",
}

const REFUND_REASONS = {
  HUY_DON: "Hủy đơn",
  TU_CHOI_NHAN: "Từ chối nhận hàng",
  DOI_TRA: "Đổi trả",
  KHONG_THE_THUC_HIEN: "Sản phẩm không thể thực hiện",
  NGOAI_LE: "Hoàn tiền ngoại lệ",
  DOI_DON: "Phần dư khi đơn đổi",
}
const REFUND_STATUS = { CHO_XU_LY: "Chờ hoàn tiền", DA_HOAN: "Đã hoàn", THAT_BAI: "Chuyển khoản thất bại" }

// Lý do từ chối mẫu (UC-OPS-07 3a) kèm câu gợi ý điền sẵn vào ô mô tả
const REJECT_REASONS = {
  QUA_HAN: { label: "Quá thời hạn đổi trả", hint: "Yêu cầu được gửi sau 7 ngày kể từ khi nhận hàng nên không thuộc thời hạn đổi trả." },
  DA_QUA_SU_DUNG: { label: "Sản phẩm đã qua sử dụng", hint: "Sản phẩm có dấu hiệu đã qua sử dụng nên không đủ điều kiện đổi trả." },
  THIEU_TEM_NHAN_BAO_BI: { label: "Thiếu tem/nhãn/bao bì", hint: "Sản phẩm không còn đủ tem, nhãn hoặc bao bì gốc như khi nhận hàng." },
  LOI_DO_NGUOI_DUNG: { label: "Lỗi do người dùng", hint: "Hư hỏng phát sinh trong quá trình sử dụng, không phải lỗi từ Soulprint." },
  ANH_KHONG_CHUNG_MINH: { label: "Ảnh chưa chứng minh được lỗi", hint: "Ảnh gửi kèm chưa thể hiện rõ lỗi của sản phẩm. Bạn có thể gửi lại ảnh rõ hơn." },
  KHONG_THUOC_CHINH_SACH: { label: "Không thuộc chính sách đổi trả", hint: "Yêu cầu không thuộc các trường hợp được đổi trả theo chính sách của Soulprint." },
  KHONG_DAT_KIEM_TRA: { label: "Không đạt kiểm tra", hint: "Sản phẩm nhận về không đúng tình trạng đã xác nhận khi gửi yêu cầu. Soulprint sẽ gửi trả hàng lại cho bạn." },
  KHAC: { label: "Khác", hint: "" },
}

// Đánh giá (UC-TRK-03)
const RATING_LABELS = { 1: "Rất tệ", 2: "Chưa hài lòng", 3: "Bình thường", 4: "Hài lòng", 5: "Rất hài lòng" }
const REVIEW_LIKES = {
  CA_NHAN_HOA_DEP: "Cá nhân hóa đẹp",
  DONG_GOI_DEP: "Đóng gói đẹp",
  GIAO_NHANH: "Giao nhanh",
  DUNG_MO_TA: "Đúng mô tả",
  DANG_TIEN: "Đáng tiền",
}

const charCount = (s) => Array.from(s || "").length
const text = (x, max) => (typeof x === "string" ? x.normalize("NFC").trim().slice(0, max) : "")

// ===== Đổi trả (UC-TRK-04) =====

// Hạn gửi yêu cầu: 7 ngày kể từ deliveredAt (BR-12)
const returnDeadline = (o) => (o.deliveredAt ? new Date(new Date(o.deliveredAt).getTime() + params.RETURN_WINDOW_DAYS * DAY) : null)
const withinReturnWindow = (o, now = new Date()) => !!o.deliveredAt && now <= returnDeadline(o)
const canReturn = (o, now = new Date()) =>
  ["DA_GIAO", "HOAN_THANH"].includes(o.orderStatus) && (o.returnStatus || "KHONG_CO") === "KHONG_CO" && withinReturnWindow(o, now)

// Số ngày còn lại để gửi (làm tròn lên, khung tóm tắt SCR-25 "Còn N ngày")
const daysLeft = (deadline, now = new Date()) => (deadline ? Math.max(0, Math.ceil((new Date(deadline) - now) / DAY)) : 0)

// Giá trị phần trả của 1 dòng theo số lượng (lineValue của dòng gồm cả phí cá nhân hóa)
const lineValueOf = (it, quantity) => Math.round(((it.lineValue || 0) * quantity) / (it.quantity || 1))

// Đọc và kiểm tra yêu cầu đổi trả. Trả {value} hoặc {status, code, message, rule?, fields}. imageCount: số ảnh gửi kèm.
function checkReturn(o, body, { imageCount = 0, now = new Date() } = {}) {
  const fields = {}
  const fail = (status, code, message, extra = {}) => ({ error: { status, code, message, fields, ...extra } })
  if (!["DA_GIAO", "HOAN_THANH"].includes(o.orderStatus) || !withinReturnWindow(o, now)) {
    return fail(422, "BUSINESS_RULE", `Đơn hàng đã quá ${params.RETURN_WINDOW_DAYS} ngày kể từ khi nhận, không thể gửi yêu cầu đổi trả`, { rule: "BR-12" })
  }
  if ((o.returnStatus || "KHONG_CO") !== "KHONG_CO") return fail(409, "ALREADY_REQUESTED", "Đơn hàng đang có yêu cầu đổi trả")

  const raw = Array.isArray(body.items) ? body.items : []
  const items = []
  const seen = new Set()
  for (const x of raw) {
    const it = (o.items || []).find((i) => String(i._id) === String(x && x.orderItemId))
    if (!it || seen.has(String(it._id)) || ["DA_HOAN_TIEN"].includes(it.fulfillStatus)) continue
    seen.add(String(it._id))
    const quantity = parseInt(x.quantity, 10)
    if (!(quantity >= 1 && quantity <= it.quantity)) {
      fields[`items.${it._id}.quantity`] = `Số lượng từ 1 đến ${it.quantity}`
      continue
    }
    const reason = String(x.reason || "")
    if (!RETURN_REASONS[reason]) {
      fields[`items.${it._id}.reason`] = "Chọn lý do đổi trả"
      continue
    }
    items.push({ it, quantity, reason })
  }
  if (!items.length && !Object.keys(fields).length) fields.items = "Chọn ít nhất 1 sản phẩm muốn đổi trả"
  const resolution = String(body.resolution || "")
  if (!RESOLUTIONS[resolution]) fields.resolution = "Chọn hình thức xử lý"
  const description = text(body.description, 2000)
  if (charCount(description) > params.AFTERSALES_TEXT_MAX) fields.description = `Mô tả tối đa ${params.AFTERSALES_TEXT_MAX} ký tự`
  if (imageCount > params.RETURN_MAX_IMAGES) fields.images = `Tối đa ${params.RETURN_MAX_IMAGES} ảnh`
  if (Object.keys(fields).length) return fail(400, "VALIDATION_ERROR", Object.values(fields)[0])

  // BR-14: món cá nhân hóa chỉ đổi trả khi lỗi từ Soulprint
  if (items.some((x) => x.it.isPersonalized && !RETURN_REASONS[x.reason].soulprintFault)) {
    return fail(422, "BUSINESS_RULE", "Lý do \"Đổi ý\" không áp dụng cho sản phẩm cá nhân hóa", { rule: "BR-14" })
  }
  // BR-31: bắt buộc ảnh với lỗi in/khắc, hư hỏng, và mọi lý do của sản phẩm cá nhân hóa
  if (imageCount < 1 && items.some((x) => x.it.isPersonalized || RETURN_REASONS[x.reason].photo)) {
    fields.images = "Thêm ảnh bằng chứng để gửi yêu cầu"
    return fail(422, "BUSINESS_RULE", "Còn thiếu thông tin - Thêm ảnh bằng chứng để gửi yêu cầu", { rule: "BR-31" })
  }
  // BR-13: sản phẩm không cá nhân hóa cần khách xác nhận còn tem, nhãn, bao bì
  if (items.some((x) => !x.it.isPersonalized) && body.conditionConfirmed !== true) {
    fields.conditionConfirmed = "Vui lòng xác nhận tình trạng sản phẩm"
    return fail(422, "BUSINESS_RULE", "Vui lòng xác nhận sản phẩm còn nguyên tem, nhãn, bao bì gốc, chưa qua sử dụng", { rule: "BR-13" })
  }
  return {
    value: {
      items: items.map(({ it, quantity, reason }) => ({ orderItemId: it._id, quantity, reason, lineValue: lineValueOf(it, quantity) })),
      resolution,
      description,
      conditionConfirmed: body.conditionConfirmed === true,
    },
  }
}

// Tổng giá trị các dòng trả, không vượt phần đã trả chưa hoàn
const refundableOf = (o) => Math.max(0, (o.paidAmount || 0) - (o.refundedAmount || 0))
const returnValue = (r) => (r.items || []).reduce((s, x) => s + (x.lineValue || 0), 0)
const defaultRefund = (r, o) => Math.min(returnValue(r), refundableOf(o))

// Tiến trình trang "Đã gửi yêu cầu đổi trả" và thẻ yêu cầu: Đã gửi → Đang xem xét → Shipper lấy hàng → Giao hàng lại/Hoàn tiền
function returnProgress(r) {
  const last = r.resolution === "GIAO_LAI" ? "Giao hàng lại" : "Hoàn tiền"
  const labels = ["Đã gửi yêu cầu", "Đang xem xét", "Shipper lấy hàng", last]
  const at = [r.createdAt, r.decidedAt, r.receivedAt, r.completedAt]
  let current
  if (r.status === "DANG_YEU_CAU") current = 1
  else if (r.status === "DONG_Y") current = 2
  else if (r.status === "DA_NHAN_HANG") current = 3
  else if (r.status === "DA_HOAN_TAT") current = 4
  else current = -1
  return labels.map((label, i) => ({
    label,
    at: i < current || (r.status === "DA_HOAN_TAT" && i === 3) ? at[i] || null : null,
    state: r.status === "DA_HOAN_TAT" || i < current ? "done" : i === current ? "current" : "todo",
  }))
}

// ===== Bảo hành (UC-TRK-05) =====

// Hạn bảo hành = deliveredAt + warrantyMonths tháng (BR-17)
function warrantyUntil(deliveredAt, months) {
  if (!deliveredAt || !(months > 0)) return null
  const d = new Date(deliveredAt)
  d.setMonth(d.getMonth() + months)
  return d
}

const WARRANTY_OPEN = ["DANG_XEM_XET", "DA_DUYET", "DA_NHAN_HANG"]

// Dòng sản phẩm có được gửi bảo hành: đơn đã giao, còn hạn, không có yêu cầu chưa kết thúc
function warrantyState(o, it, months, { openCount = 0, now = new Date() } = {}) {
  const until = warrantyUntil(o.deliveredAt, months)
  const delivered = ["DA_GIAO", "HOAN_THANH"].includes(o.orderStatus)
  return {
    months: months || 0,
    until,
    expired: !!until && now > until,
    open: openCount > 0,
    allowed: delivered && !!until && now <= until && openCount === 0 && it.fulfillStatus !== "DA_HOAN_TIEN",
  }
}

function checkWarranty(body, { imageCount = 0 } = {}) {
  const fields = {}
  const symptom = String(body.symptom || "")
  const description = text(body.description, 2000)
  const shippingMethod = String(body.shippingMethod || "")
  if (!WARRANTY_SYMPTOMS[symptom]) fields.symptom = "Chọn hiện tượng"
  if (!description) fields.description = "Vui lòng mô tả lỗi"
  else if (charCount(description) > params.AFTERSALES_TEXT_MAX) fields.description = `Mô tả tối đa ${params.AFTERSALES_TEXT_MAX} ký tự`
  if (imageCount > params.RETURN_MAX_IMAGES) fields.images = `Tối đa ${params.RETURN_MAX_IMAGES} ảnh`
  if (!SHIPPING_METHODS[shippingMethod]) fields.shippingMethod = "Chọn cách gửi sản phẩm"
  if (Object.keys(fields).length) return { error: { status: 400, code: "VALIDATION_ERROR", message: Object.values(fields)[0], fields } }
  // BR-31: yêu cầu bảo hành luôn cần ảnh (AC3)
  if (imageCount < 1) {
    return { error: { status: 422, code: "BUSINESS_RULE", message: "Thêm ít nhất 1 ảnh chứng minh lỗi", rule: "BR-31", fields: { images: "Thêm ít nhất 1 ảnh chứng minh" } } }
  }
  return { value: { symptom, description, shippingMethod } }
}

// Tiến trình "Đã tiếp nhận yêu cầu bảo hành": Đã tiếp nhận → Chờ lấy hàng/Chờ nhận hàng → Kiểm tra, sửa chữa → Giao trả
function warrantyProgress(w) {
  const labels = ["Đã tiếp nhận", w.shippingMethod === "TU_GUI" ? "Chờ nhận hàng" : "Chờ lấy hàng", "Kiểm tra, sửa chữa", "Giao trả"]
  const at = [w.createdAt, w.decidedAt, w.receivedAt, w.completedAt]
  // Đang xem xét và đã duyệt cùng hiện bước 2 (chờ lấy/nhận hàng); từ chối thì không bước nào đang chạy
  const current = { DANG_XEM_XET: 1, DA_DUYET: 1, DA_NHAN_HANG: 2, HOAN_TAT: 4 }[w.status] ?? -1
  return labels.map((label, i) => {
    const done = w.status === "HOAN_TAT" || (current > 0 && i < current) || (current < 0 && i === 0)
    return { label, at: done ? at[i] || null : null, state: done ? "done" : i === current ? "current" : "todo" }
  })
}

// ===== Tab và ưu tiên ở "Yêu cầu hậu mãi" (05 Mục 2.6, BR-32) =====

// Hoàn tiền (sau hủy đơn, sau đổi trả) tách khỏi "Chờ duyệt" sang tab "Chờ hoàn tiền" vì không có bước duyệt
const STAGES = {
  "cho-duyet": { RETURN: ["DANG_YEU_CAU"], WARRANTY: ["DANG_XEM_XET"], REFUND: [] },
  "cho-hoan-tien": { RETURN: [], WARRANTY: [], REFUND: ["CHO_XU_LY", "THAT_BAI"] },
  "dang-gui-ve": { RETURN: ["DONG_Y"], WARRANTY: ["DA_DUYET"], REFUND: [] },
  "da-nhan": { RETURN: ["DA_NHAN_HANG"], WARRANTY: ["DA_NHAN_HANG"], REFUND: [] },
  "hoan-tat": { RETURN: ["DA_HOAN_TAT"], WARRANTY: ["HOAN_TAT"], REFUND: ["DA_HOAN"] },
  "tu-choi": { RETURN: ["TU_CHOI"], WARRANTY: ["TU_CHOI"], REFUND: [] },
}
const stageOf = (kind, status) => Object.keys(STAGES).find((k) => STAGES[k][kind].includes(status)) || null

// Mức ưu tiên 1 yêu cầu: đổi trả chờ duyệt, hoàn tiền chờ xử lý/thất bại là Khẩn cấp; bảo hành chờ xem xét là Cần chú ý
function requestPriority(kind, x, now = new Date()) {
  const deadline = x.slaDeadline ? new Date(x.slaDeadline) : null
  if (kind === "RETURN" && x.status === "DANG_YEU_CAU") return { level: "KHAN_CAP", reason: "Đổi trả chờ duyệt", deadline }
  // Chờ khách nhập tài khoản: nhân viên chưa chuyển được nên chỉ Cần chú ý (UC-OPS-01 bước 2)
  if (kind === "REFUND" && x.status === "CHO_XU_LY" && x.method !== "GATEWAY" && !x.bankInfo) return { level: "CAN_CHU_Y", reason: "Chờ khách nhập tài khoản", deadline }
  if (kind === "REFUND" && x.status === "CHO_XU_LY") return { level: "KHAN_CAP", reason: "Hoàn tiền chờ xử lý", deadline }
  if (kind === "REFUND" && x.status === "THAT_BAI") return { level: "KHAN_CAP", reason: "Lỗi hoàn tiền", deadline: null }
  if (kind === "WARRANTY" && x.status === "DANG_XEM_XET") return { level: "CAN_CHU_Y", reason: "Bảo hành chờ xem xét", deadline }
  if (kind === "RETURN" && x.status === "DA_NHAN_HANG" && !x.replacementOrderCode) return { level: "CAN_CHU_Y", reason: "Chờ kiểm tra hàng trả về", deadline: null }
  if (kind === "WARRANTY" && x.status === "DA_NHAN_HANG" && !x.replacementOrderCode) return { level: "CAN_CHU_Y", reason: "Đang xử lý bảo hành", deadline: null }
  return { level: "BINH_THUONG", reason: null, deadline: null }
}

// "chờ N giờ" ở cột Ưu tiên
const waitingHours = (createdAt, now = new Date()) => Math.max(0, Math.floor((now - new Date(createdAt)) / HOUR))

// ===== Nút được phép (API-196 `actions`) =====

// can(code): người gọi có quyền. Đổi trả theo 05 Mục 2.3; "Hoàn tiền ngay" ở DANG_YEU_CAU và DA_NHAN_HANG.
function returnActions(r, can) {
  const s = r.status
  const waitingReplacement = s === "DA_NHAN_HANG" && !!r.replacementOrderCode
  return {
    approve: s === "DANG_YEU_CAU" && can("HAU_MAI.DUYET_TU_CHOI"),
    reject: (s === "DANG_YEU_CAU" || (s === "DA_NHAN_HANG" && !waitingReplacement)) && can("HAU_MAI.DUYET_TU_CHOI"),
    refundNow: (s === "DANG_YEU_CAU" || (s === "DA_NHAN_HANG" && !waitingReplacement)) && can("HAU_MAI.HOAN_TIEN"),
    received: s === "DONG_Y" && can("HAU_MAI.XAC_NHAN_NHAN_HANG"),
    complete: s === "DA_NHAN_HANG" && !waitingReplacement && can("HAU_MAI.HOAN_TIEN"),
  }
}

function warrantyActions(w, can) {
  const s = w.status
  const waitingReplacement = s === "DA_NHAN_HANG" && !!w.replacementOrderCode
  return {
    approve: s === "DANG_XEM_XET" && can("HAU_MAI.DUYET_TU_CHOI"),
    reject: (s === "DANG_XEM_XET" || (s === "DA_NHAN_HANG" && !waitingReplacement)) && can("HAU_MAI.DUYET_TU_CHOI"),
    received: s === "DA_DUYET" && can("HAU_MAI.XAC_NHAN_NHAN_HANG"),
    progressNote: WARRANTY_OPEN.includes(s) && can("HAU_MAI.SUA"),
    complete: s === "DA_NHAN_HANG" && !waitingReplacement && can("HAU_MAI.HOAN_TIEN"),
  }
}

// Nhãn khoản hoàn đang chờ tách theo việc cần làm: chờ khách nhập tài khoản thì nhân viên chưa chuyển được
function refundStatusLabel(x) {
  if (x.status !== "CHO_XU_LY") return REFUND_STATUS[x.status]
  if (x.method === "GATEWAY") return "Chờ hoàn qua cổng"
  return x.bankInfo ? "Chờ chuyển khoản" : "Chờ khách nhập tài khoản"
}

function refundActions(x, can) {
  const open = x.status === "CHO_XU_LY"
  return {
    markPaid: open && x.method !== "GATEWAY" && !!x.bankInfo && can("HAU_MAI.HOAN_TIEN"),
    gatewayRefund: open && x.method === "GATEWAY" && can("HAU_MAI.HOAN_TIEN"),
    // Chưa có tài khoản thì chưa chuyển, không có "Chuyển khoản thất bại"
    markFailed: open && (x.method === "GATEWAY" || !!x.bankInfo) && can("HAU_MAI.HOAN_TIEN"),
    waitingAccount: open && x.method !== "GATEWAY" && !x.bankInfo,
  }
}

// Số tiền sau khi hoàn: DA_HOAN_TIEN khi đã hoàn hết phần đã trả (đơn hủy: hết phần được hoàn), còn lại HOAN_TIEN_MOT_PHAN
function paymentStatusAfterRefund(o, refundedAmount, remainingRefundable) {
  if (refundedAmount >= (o.paidAmount || 0) || (o.orderStatus === "DA_HUY" && remainingRefundable <= 0)) return "DA_HOAN_TIEN"
  return "HOAN_TIEN_MOT_PHAN"
}

// ===== Đánh giá =====

// Tên hiện trên SCR-03 khi chọn "Ẩn tên": "Nguyễn Minh Anh" -> "M*** A" (2 chữ cuối, giữ chữ cái đầu)
function hiddenName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return "K***"
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase() + "***"
  const [a, b] = parts.slice(-2)
  return `${a.slice(0, 1).toUpperCase()}*** ${b.slice(0, 1).toUpperCase()}`
}

function checkReview(body) {
  const fields = {}
  const rating = Number(body.rating)
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) fields.rating = "Chọn số sao"
  const comment = text(body.comment, 2000)
  if (charCount(comment) > params.AFTERSALES_TEXT_MAX) fields.comment = `Nhận xét tối đa ${params.AFTERSALES_TEXT_MAX} ký tự`
  const likes = [...new Set((Array.isArray(body.likes) ? body.likes : []).map(String))].filter((k) => REVIEW_LIKES[k])
  if (Object.keys(fields).length) return { error: { status: 400, code: "VALIDATION_ERROR", message: Object.values(fields)[0], fields } }
  return { value: { rating, comment, likes, hideName: body.hideName === true } }
}

module.exports = {
  RETURN_REASONS, RESOLUTIONS, RESOLUTION_SHORT, RETURN_STATUS, WARRANTY_SYMPTOMS, SHIPPING_METHODS, WARRANTY_RESOLUTIONS, WARRANTY_STATUS,
  REFUND_REASONS, REFUND_STATUS, REJECT_REASONS, RATING_LABELS, REVIEW_LIKES, WARRANTY_OPEN, STAGES,
  charCount, text, returnDeadline, withinReturnWindow, canReturn, daysLeft, lineValueOf, checkReturn, refundableOf, returnValue, defaultRefund,
  returnProgress, warrantyUntil, warrantyState, checkWarranty, warrantyProgress, stageOf, requestPriority, waitingHours,
  returnActions, warrantyActions, refundActions, refundStatusLabel, paymentStatusAfterRefund, hiddenName, checkReview,
}
