// Quy tắc vận hành đơn phía quản trị (UC-OPS-01 đến OPS-06, 05_Diagrams.md Mục 2.1). Hàm thuần, không đọc CSDL để
// unit test được: mức ưu tiên BR-32 (tính khi đọc, không lưu), bước chuyển trạng thái theo vai trò (API-92), số COD
// phải thu, loại ngoại lệ hợp lệ theo trạng thái (API-96), nhóm hàng lưu kho (SCR-51), nút được phép ở SCR-48.
const params = require("../config/params")

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

// ===== Mức ưu tiên BR-32 =====

const LEVELS = { KHAN_CAP: 3, CAN_CHU_Y: 2, BINH_THUONG: 1 }

// Đơn vị vận chuyển (giao hàng API-92, chiều về của đổi trả, bảo hành API-100, API-101)
const CARRIERS = { GHN: "GHN", GHTK: "GHTK", SPX: "SPX", VIETTEL_POST: "Viettel Post", KHAC: "Khác" }

// Lần đầu đơn tới một trạng thái (đọc statusHistory)
function reachedAt(o, status) {
  const h = (o.statusHistory || []).find((x) => x.field === "orderStatus" && x.to === status)
  return h ? new Date(h.at) : status === "CHO_XAC_NHAN" ? new Date(o.createdAt) : null
}

// ctx.refund: yêu cầu hoàn tiền mới nhất của đơn; ctx.warrantyPending: có yêu cầu bảo hành chờ (S9)
// Trả {level, reason, deadline}: mức cao nhất, cùng mức thì hạn sớm nhất. Hạn hiển thị dạng thời gian còn lại.
function priority(o, { now = new Date(), refund = null, warrantyPending = false } = {}) {
  const found = []
  const add = (level, reason, deadline) => found.push({ level, reason, deadline: deadline ? new Date(deadline) : null })

  // Khẩn cấp
  // Không thể thực hiện, đang hỏi khách (BR-29, BR-30): 2 giờ đầu phải nhắn khách; sau đó chờ khách tới hạn trả lời;
  // quá hạn thì cần hủy (hệ thống không tự hủy)
  const u = o.unfulfillable
  if (o.orderStatus === "CHO_XAC_NHAN" && u && u.status === "DANG_HOI_KHACH") {
    if (u.responseDeadline && now >= new Date(u.responseDeadline)) add("KHAN_CAP", "Quá hạn chờ khách, cần hủy", u.responseDeadline)
    else if (u.slaDeadline && now < new Date(u.slaDeadline)) add("KHAN_CAP", "Không thể thực hiện, cần nhắn khách", u.slaDeadline)
    else add("CAN_CHU_Y", "Đang hỏi khách", u.responseDeadline)
  }
  // Khách tự hủy khi đang được hỏi: nhân viên chọn gửi voucher xin lỗi (BR-30 c)
  if (u && u.outcome === "KHACH_HUY" && u.apologyVoucher && u.apologyVoucher.pending) add("KHAN_CAP", "Khách hủy, chọn gửi voucher xin lỗi", null)
  // Thay đổi chờ khách trả thêm (BR-47)
  if (o.pendingChange) add("CAN_CHU_Y", "Chờ khách trả thêm", o.pendingChange.expiresAt)
  if (o.returnStatus === "DANG_YEU_CAU") add("KHAN_CAP", "Yêu cầu đổi trả chờ xử lý", null)
  if (refund && refund.status === "CHO_XU_LY" && refund.method !== "GATEWAY" && !refund.bankInfo) add("CAN_CHU_Y", "Chờ khách nhập tài khoản", refund.slaDeadline)
  else if (refund && refund.status === "CHO_XU_LY") add("KHAN_CAP", "Hoàn tiền chờ xử lý", refund.slaDeadline)
  if (refund && refund.status === "THAT_BAI") add("KHAN_CAP", "Lỗi hoàn tiền", null)
  if (o.codDiscrepancy) add("KHAN_CAP", "COD lệch tiền, cần đối soát", null)
  // Đơn gấp: khẩn cấp tới khi giao, hạn là ngày giao đã chốt
  if (o.urgentCode && ["CHO_XAC_NHAN", "DANG_CA_NHAN_HOA", "DANG_CHUAN_BI"].includes(o.orderStatus)) {
    add("KHAN_CAP", `Đơn gấp, giao ngày ${String(o.expectedDeliveryDate || "").slice(8, 10)}/${String(o.expectedDeliveryDate || "").slice(5, 7)}`, o.expectedDeliveryDate ? `${o.expectedDeliveryDate}T00:00:00+07:00` : null)
  }

  // Cần chú ý (quá hạn) - trước hạn vẫn hiện thời gian còn lại ở mức Bình thường
  const s = o.orderStatus
  if (s === "CHO_XAC_NHAN") {
    const d = new Date(new Date(o.createdAt).getTime() + DAY)
    add(now > d ? "CAN_CHU_Y" : "BINH_THUONG", now > d ? "Chờ xác nhận quá 24 giờ" : "Chờ xác nhận", d)
  }
  if (s === "DANG_CHUAN_BI") {
    const from = reachedAt(o, "DANG_CHUAN_BI") || new Date(o.updatedAt || o.createdAt)
    const d = new Date(from.getTime() + DAY)
    add(now > d ? "CAN_CHU_Y" : "BINH_THUONG", now > d ? "Chờ đóng gói quá 24 giờ" : "Chờ đóng gói", d)
  }
  if (s === "DANG_CA_NHAN_HOA" && o.personalizationStartedAt) {
    const d = new Date(new Date(o.personalizationStartedAt).getTime() + 3 * DAY)
    add(now > d ? "CAN_CHU_Y" : "BINH_THUONG", now > d ? "Cá nhân hóa quá 3 ngày" : "Đang cá nhân hóa", d)
  }
  if (o.storageStatus === "DANG_LUU_KHO" && o.storageDeadline) {
    const d = new Date(o.storageDeadline)
    if (d - now <= 3 * DAY) add("CAN_CHU_Y", "Hàng lưu kho sắp hết hạn", d)
  }
  if (o.storageStatus === "HET_HAN_LUU_KHO") add("CAN_CHU_Y", "Hết hạn lưu kho, chờ tiêu hủy", o.storageDeadline)
  if (warrantyPending) add("CAN_CHU_Y", "Yêu cầu bảo hành chờ xử lý", null)

  if (!found.length) return { level: "BINH_THUONG", reason: null, deadline: null }
  found.sort((a, b) => LEVELS[b.level] - LEVELS[a.level] || (a.deadline ? a.deadline.getTime() : Infinity) - (b.deadline ? b.deadline.getTime() : Infinity))
  return found[0]
}

// Sắp danh sách: Khẩn cấp → Cần chú ý → Bình thường, rồi hạn sớm trước, rồi đơn mới trước (API-90)
function comparePriority(a, b) {
  const pa = a.priority
  const pb = b.priority
  const byLevel = LEVELS[pb.level] - LEVELS[pa.level]
  if (byLevel) return byLevel
  const da = pa.deadline ? new Date(pa.deadline).getTime() : Infinity
  const db = pb.deadline ? new Date(pb.deadline).getTime() : Infinity
  if (da !== db) return da - db
  return new Date(b.createdAt) - new Date(a.createdAt)
}

// Thời gian còn lại cho cột ưu tiên, viết đủ chữ: "1 giờ 40 phút", "Quá 8 giờ", "2 ngày"
function remainingText(deadline, now = new Date()) {
  if (!deadline) return null
  let ms = new Date(deadline) - now
  const over = ms < 0
  ms = Math.abs(ms)
  const days = Math.floor(ms / DAY)
  const hours = Math.floor((ms % DAY) / HOUR)
  const mins = Math.floor((ms % HOUR) / 60000)
  const text = days >= 2 ? `${days} ngày` : days === 1 ? `${24 + hours} giờ` : hours ? `${hours} giờ${mins ? " " + mins + " phút" : ""}` : `${mins} phút`
  return over ? `Quá ${text}` : text
}

// ===== Tab nhanh SCR-47 (API-90 view) =====

// Thêm tab theo đủ các bước của quy trình (Đang cá nhân hóa, Đã giao, Đã hủy)
const VIEWS = {
  all: () => true,
  approval: (o) => !!o.approvalPending, // Có yêu cầu duyệt ngoại lệ đặc biệt
  urgent: (o) => o.priority.level === "KHAN_CAP",
  attention: (o) => o.priority.level === "CAN_CHU_Y",
  "to-confirm": (o) => o.orderStatus === "CHO_XAC_NHAN",
  personalizing: (o) => o.orderStatus === "DANG_CA_NHAN_HOA",
  "to-pack": (o) => o.orderStatus === "DANG_CHUAN_BI",
  shipping: (o) => o.orderStatus === "DANG_VAN_CHUYEN",
  delivered: (o) => ["DA_GIAO", "HOAN_THANH"].includes(o.orderStatus),
  cancelled: (o) => o.orderStatus === "DA_HUY",
  storage: (o) => ["DANG_LUU_KHO", "HET_HAN_LUU_KHO"].includes(o.storageStatus),
}

// ===== Chuyển trạng thái theo vai trò (API-92, 07 Mục 1.1) =====

// Bước kế tiếp hợp lệ từ trạng thái hiện tại: {to, permission, label}
function nextSteps(o) {
  switch (o.orderStatus) {
    case "CHO_XAC_NHAN":
      return [o.hasPersonalizedItems
        ? { to: "DANG_CA_NHAN_HOA", permission: "DON_HANG.SUA", label: "Xác nhận đơn" }
        : { to: "DANG_CHUAN_BI", permission: "DON_HANG.SUA", label: "Xác nhận đơn" }]
    case "DANG_CA_NHAN_HOA":
      return [{ to: "DANG_CHUAN_BI", permission: "DON_HANG.DONG_GOI", label: "Hoàn tất cá nhân hóa" }]
    case "DANG_CHUAN_BI":
      return [{ to: "DANG_VAN_CHUYEN", permission: "DON_HANG.GIAO_VAN_CHUYEN", label: "Giao cho vận chuyển" }]
    case "DANG_VAN_CHUYEN":
      return [{ to: "DA_GIAO", permission: "DON_HANG.SUA", label: "Giao thành công" }]
    default:
      return []
  }
}

// Kiểm tra 1 lần chuyển: trả null nếu được, hoặc {status, code, message} để controller ném lỗi
function checkTransition(o, to, can) {
  const step = nextSteps(o).find((x) => x.to === to)
  if (!step) return { status: 409, code: "INVALID_TRANSITION", message: "Trạng thái đơn đã thay đổi, vui lòng tải lại" }
  if (!can(step.permission)) return { status: 403, code: "FORBIDDEN", message: "Bước này không thuộc vai trò của bạn" }
  if (o.orderStatus === "CHO_XAC_NHAN" && o.unfulfillable && o.unfulfillable.status === "DANG_HOI_KHACH") {
    return { status: 422, code: "BUSINESS_RULE", message: "Đơn đang hỏi khách vì có món không thể thực hiện (UC-OPS-06)" }
  }
  // Chờ khách trả thêm: chưa xác nhận được; đổi sang Giao người nhận đang chờ tiền thì chưa giao vận chuyển
  if (o.pendingChange && (o.orderStatus === "CHO_XAC_NHAN" || to === "DANG_VAN_CHUYEN")) {
    return { status: 422, code: "BUSINESS_RULE", message: "Đơn đang chờ khách trả thêm cho thay đổi (BR-47)" }
  }
  return null
}

// Số COD còn phải thu khi giao (tổng - đã trả); không âm
const codDue = (o) => Math.max(0, (o.total || 0) - (o.paidAmount || 0))

// Số đã thu bằng COD khi giao: đơn thu từ khi có codCollectedAmount thì đọc thẳng; đơn cũ suy ra
// tổng - cọc. Phần còn lại của paidAmount là tiền trả online (cọc, thanh toán 100%, trả phần chênh).
const codPaid = (o) => (o.codCollectedAt ? (o.codCollectedAmount ?? Math.max(0, (o.total || 0) - (o.depositAmount || 0))) : 0)

// Ô kiểm tra thủ công bắt buộc khi xác nhận (UC-OPS-01 bước 6b): nội dung in/khắc (đơn cá nhân hóa) và địa chỉ, SĐT
function requiredChecks(o) {
  return [...(o.hasPersonalizedItems ? ["content"] : []), "address"]
}

// Kiểm tra tự động khi xác nhận (bước 6a). stockOf: Map "productId|sku" -> tồn còn lại; materialStock: Map mã -> tồn
function confirmChecks(o, { stockOf = new Map(), materialStock = new Map() } = {}) {
  const checks = []
  if (o.depositAmount > 0) {
    const ok = (o.paidAmount || 0) >= o.depositAmount
    checks.push({ key: "payment", ok, label: ok ? `Đã nhận cọc ${fmt(o.depositAmount)}` : `Chưa nhận đủ cọc ${fmt(o.depositAmount)}` })
  } else if (o.paymentMethod === "ONLINE") {
    const ok = (o.paidAmount || 0) >= o.total
    checks.push({ key: "payment", ok, label: ok ? `Đã thanh toán ${fmt(o.total)}` : "Chưa nhận đủ tiền thanh toán online" })
  } else {
    checks.push({ key: "payment", ok: true, label: `Thu khi giao (COD) ${fmt(codDue(o))}` })
  }
  for (const it of o.items || []) {
    if (["DA_HOAN_TIEN"].includes(it.fulfillStatus)) continue
    const stock = stockOf.get(`${it.productId}|${it.variantSku}`)
    const ok = stock === undefined || stock >= 0
    const tag = stock === undefined ? "" : stock <= 0 ? " (Hết)" : stock <= 5 ? " (Sắp hết)" : ""
    checks.push({ key: "stock", ok, productId: String(it.productId), label: `Tồn kho: ${it.name}${it.variantName ? " " + it.variantName : ""} x${it.quantity}, còn ${stock ?? "?"} sau khi giữ cho đơn${tag}` })
  }
  if (o.giftWrap) {
    const codes = ["paper", "ribbon", "card"].map((k) => o.giftWrap[k]?.code).filter(Boolean)
    const short = codes.filter((c) => (materialStock.get(c) ?? 0) < 0)
    checks.push({ key: "giftWrap", ok: !short.length, label: short.length ? `Gói quà ${o.giftWrap.name} thiếu vật liệu` : `Gói quà ${o.giftWrap.name} đủ vật liệu` })
  }
  return checks
}

const fmt = (n) => String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "đ"

// ===== Xử lý ngoại lệ (API-96) =====

const EXCEPTION_TYPES = {
  SUA_THONG_TIN: "Sửa thông tin giao hàng, liên hệ",
  DOI_SAN_PHAM: "Sửa sản phẩm trong đơn",
  HUY_DON: "Hủy đơn ngoại lệ",
  HOAN_TIEN: "Hoàn tiền ngoài quy trình",
  CAP_VOUCHER: "Cấp voucher bồi hoàn",
  GIA_HAN: "Gia hạn thời gian xử lý",
  KHAC: "Khác",
}
const BEFORE_DELIVERY = ["CHO_XAC_NHAN", "DANG_CA_NHAN_HOA", "DANG_CHUAN_BI", "DANG_VAN_CHUYEN"]
// Nhân viên đổi kiểu nhận (Giao cho tôi <-> Giao người nhận) tới trước khi giao vận chuyển (UC-OPS-03 2a)
const BEFORE_SHIPPING = ["CHO_XAC_NHAN", "DANG_CA_NHAN_HOA", "DANG_CHUAN_BI"]
// Trạng thái đơn còn giữ được thay đổi chờ khách trả thêm: đổi kiểu nhận tới trước khi giao, các thay đổi khác chỉ khi Chờ xác nhận
const changeStatuses = (kind) => (kind === "DOI_KIEU_NHAN" ? BEFORE_SHIPPING : ["CHO_XAC_NHAN"])

// Loại ngoại lệ hợp lệ với trạng thái đơn và quyền người gọi
function exceptionTypes(o, can) {
  const out = []
  const s = o.orderStatus
  const sua = can("DON_HANG.SUA")
  if (sua && BEFORE_DELIVERY.includes(s)) out.push("SUA_THONG_TIN")
  if (sua && s === "CHO_XAC_NHAN") out.push("DOI_SAN_PHAM")
  if (can("DON_HANG.HUY_DON") && ["CHO_XAC_NHAN", "DANG_CA_NHAN_HOA", "DANG_CHUAN_BI"].includes(s)) out.push("HUY_DON")
  if (sua && can("HAU_MAI.HOAN_TIEN") && refundable(o) > 0) out.push("HOAN_TIEN")
  if (sua) out.push("CAP_VOUCHER")
  if (sua && BEFORE_DELIVERY.includes(s)) out.push("GIA_HAN")
  if (sua) out.push("KHAC")
  return out
}

// BR-48: can thiệp ảnh hưởng tiền của shop cần quyền DON_HANG.NGOAI_LE_DAC_BIET, không có thì gửi duyệt.
// api EXCEPTION (API-96) hoặc UNFULFILLABLE (API-94). Trả mã loại đặc biệt hoặc null
const SPECIAL = "DON_HANG.NGOAI_LE_DAC_BIET"
const SPECIAL_LABELS = { CAP_VOUCHER: "Cấp voucher bồi hoàn", HOAN_TIEN: "Hoàn tiền ngoài quy trình", HUY_DON: "Hủy đơn đã bắt đầu cá nhân hóa", BO_VOUCHER_XIN_LOI: "Bỏ tặng voucher xin lỗi" }
function specialOf(api, o, body = {}) {
  const skip = !!(body.apologyVoucher && body.apologyVoucher.skip)
  if (api === "EXCEPTION") {
    if (body.type === "CAP_VOUCHER" || body.type === "HOAN_TIEN") return body.type
    if (body.type === "HUY_DON" && o.personalizationStartedAt) return "HUY_DON"
    if (body.type === "HUY_DON" && body.cause !== "KHACH" && skip) return "BO_VOUCHER_XIN_LOI"
    return null
  }
  if (api === "UNFULFILLABLE" && ["CANCEL", "APOLOGY"].includes(body.action) && skip) return "BO_VOUCHER_XIN_LOI"
  return null
}

// Số còn có thể hoàn (2a: ≤ paidAmount - refundedAmount)
const refundable = (o) => Math.max(0, (o.paidAmount || 0) - (o.refundedAmount || 0))

// ===== Từ chối nhận hàng (UC-OPS-04) =====

const REFUSAL_REASONS = {
  KHONG_CO_MAT: "Người nhận không có mặt",
  KHONG_DONG_Y_NHAN: "Người nhận không đồng ý nhận",
  SAI_DIA_CHI: "Sai địa chỉ",
}

// Phân loại BR-28 và trạng thái lưu kho sau khi bị từ chối: lần giao lại thứ 2 bị từ chối thì hết hạn ngay (BR-11)
function refusalOutcome(o, now = new Date()) {
  const cancelCase = !(o.paidAmount > 0) ? "TH1" : o.hasPersonalizedItems && o.personalizationStartedAt ? "TH3" : "TH2"
  if (cancelCase !== "TH3") return { cancelCase, storageStatus: null, storageDeadline: null }
  const expired = (o.redeliveryCount || 0) >= params.MAX_REDELIVERY
  return {
    cancelCase,
    storageStatus: expired ? "HET_HAN_LUU_KHO" : "DANG_LUU_KHO",
    storageDeadline: expired ? now : new Date(now.getTime() + params.REDELIVERY_WINDOW_DAYS * DAY),
  }
}

// ===== Không thể thực hiện (UC-OPS-06) =====

const UNFULFILLABLE_REASONS = {
  HET_HANG: "Hết hàng",
  HET_VAT_LIEU: "Hết vật liệu cá nhân hóa",
  KHONG_THUC_HIEN_DUOC: "Nội dung in/khắc không thực hiện được",
  KHAC: "Lý do khác",
}

// Câu mẫu điền sẵn ô "Nội dung gửi khách" theo lý do (client hiển thị, nhân viên sửa được)
const UNFULFILLABLE_TEMPLATES = {
  HET_HANG: "Xin lỗi bạn, sản phẩm trong đơn vừa hết hàng và chưa có ngày nhập lại.",
  HET_VAT_LIEU: "Xin lỗi bạn, vật liệu để cá nhân hóa sản phẩm đang hết và chưa có ngày nhập lại.",
  KHONG_THUC_HIEN_DUOC: "Xin lỗi bạn, nội dung in/khắc bạn chọn không thể thực hiện được trên sản phẩm này.",
  KHAC: "",
}

// ===== Hàng lưu kho (SCR-51) =====

// Nhóm hiển thị: Đang lưu (còn > 3 ngày), Sắp hết hạn (≤ 3 ngày), Chờ tiêu hủy (đã hết hạn)
function storageGroup(o, now = new Date()) {
  if (o.storageStatus === "HET_HAN_LUU_KHO") return "cho-tieu-huy"
  if (o.storageStatus !== "DANG_LUU_KHO") return null
  return new Date(o.storageDeadline) - now <= 3 * DAY ? "sap-het-han" : "dang-luu"
}

// Lý do lưu kho (cột "Lý do" SCR-51)
function storageReason(o) {
  if (o.cancelBy === "REFUSED") return (o.redeliveryCount || 0) > 0 ? "Giao lại thất bại" : "Khách từ chối nhận"
  if (o.cancelBy === "ADMIN") return "Hủy sau khi cá nhân hóa"
  return "Quá hạn nhận lại"
}

// Mã lưu LK-MMdd-nn theo ngày nhập kho (giờ Việt Nam)
function storageCode(now, seq) {
  const vn = new Date(now.getTime() + 7 * HOUR).toISOString()
  return `LK-${vn.slice(5, 7)}${vn.slice(8, 10)}-${String(seq).padStart(2, "0")}`
}

const DISPOSAL_METHODS = { TAI_CHE: "Tái chế", TIEU_HUY: "Tiêu hủy", KHAC: "Khác" }

// ===== Nút ở SCR-48 theo trạng thái và quyền (API-91 adminActions) =====

function adminActions(o, can) {
  const step = nextSteps(o)[0]
  // Đang hỏi khách hoặc chờ khách trả thêm thì chưa xác nhận được (checkTransition), không hiện nút chính
  const held = (o.orderStatus === "CHO_XAC_NHAN" && ((o.unfulfillable && o.unfulfillable.status === "DANG_HOI_KHACH") || !!o.pendingChange)) ||
    (!!o.pendingChange && !!step && step.to === "DANG_VAN_CHUYEN")
  const a = {
    next: step && can(step.permission) && !held ? { to: step.to, label: step.label } : null,
    print: o.orderStatus !== "DA_HUY" && can("DON_HANG.IN_PHIEU"),
    note: can("DON_HANG.XEM"),
    tags: can("DON_HANG.XEM"),
    exception: exceptionTypes(o, can).length > 0,
    unfulfillable: o.orderStatus === "CHO_XAC_NHAN" && can("DON_HANG.SUA") && !held,
    asking: o.orderStatus === "CHO_XAC_NHAN" && !!o.unfulfillable && o.unfulfillable.status === "DANG_HOI_KHACH" && can("DON_HANG.SUA"),
    pendingChange: !!o.pendingChange && can("DON_HANG.SUA"),
    // Đổi Giao cho tôi <-> Giao người nhận trong "Sửa thông tin giao hàng" (UC-OPS-03 2a)
    switchRecipient: BEFORE_SHIPPING.includes(o.orderStatus) && !o.urgentCode && !o.pendingChange && can("DON_HANG.SUA"),
    // Liên kết thanh toán thêm đã hết hạn: gửi lại một chạm (API-220)
    resendChange: o.orderStatus === "CHO_XAC_NHAN" && !!o.lastExpiredChange && !o.pendingChange && can("DON_HANG.SUA"),
    // Khách đã tự hủy khi đang hỏi: gửi hoặc không gửi voucher xin lỗi (API-94 APOLOGY)
    apology: !!o.unfulfillable && o.unfulfillable.outcome === "KHACH_HUY" && !!o.unfulfillable.apologyVoucher?.pending && can("DON_HANG.SUA"),
    refused: o.orderStatus === "DANG_VAN_CHUYEN" && can("DON_HANG.SUA"),
    reconcileCod: !!o.codDiscrepancy && can("DON_HANG.SUA"),
    shelf: ["DANG_LUU_KHO", "HET_HAN_LUU_KHO"].includes(o.storageStatus) && can("HANG_LUU_KHO.SUA"),
    dispose: o.storageStatus === "HET_HAN_LUU_KHO" && can("HANG_LUU_KHO.TIEU_HUY"),
  }
  return a
}

// ===== Tính lại tiền khi dòng sản phẩm đổi (OPS-03 2d, OPS-06 1b, 1c) =====

// Giá hiệu lực của 1 dòng: dòng đã thay thế tính theo sản phẩm thay thế (không cá nhân hóa); dòng đã hoàn tiền bỏ ra
function effectiveLine(it) {
  if (it.fulfillStatus === "DA_HOAN_TIEN") return null
  if (it.fulfillStatus === "DA_THAY_THE" && it.substitute) return { unitPrice: it.substitute.unitPrice, fee: 0, quantity: it.quantity }
  return { unitPrice: it.unitPrice, fee: it.personalizationFeePerUnit || 0, quantity: it.quantity }
}

// Công thức 02 Mục 3.1 với các dòng còn lại; giảm giá giữ nguyên số đã áp (không vượt tổng mới). refundDue: phần đã trả
// vượt tổng mới cần hoàn thêm so với trước khi đổi; COD thì phần còn phải thu tự giảm theo tổng.
function recalcTotals(o, items) {
  const lines = items.map(effectiveLine).filter(Boolean)
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0)
  const personalizationFee = lines.reduce((s, l) => s + l.fee * l.quantity, 0)
  const shippingFee = o.shippingFee || 0
  const giftWrapFee = o.giftWrapFee || 0
  const urgentFee = o.urgentFee || 0
  const discount = Math.min(o.discount || 0, subtotal + personalizationFee + shippingFee)
  const total = subtotal + shippingFee + personalizationFee + giftWrapFee + urgentFee - discount
  const paid = o.paidAmount || 0
  const refundDue = Math.max(0, paid - total) - Math.max(0, paid - (o.total || 0))
  return { subtotal, personalizationFee, discount, total, remainingAmount: Math.max(0, total - paid), refundDue: Math.max(0, refundDue) }
}

// Thẻ đơn: tối đa 10, mỗi thẻ 1-30 ký tự, bỏ trùng (UC-OPS-01 5d)
function normalizeTags(list) {
  const out = []
  for (const t of Array.isArray(list) ? list : []) {
    const v = String(t || "").normalize("NFC").trim().replace(/\s+/g, " ")
    if (v && v.length <= 30 && !out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v)
  }
  return out
}

module.exports = {
  LEVELS, CARRIERS, priority, comparePriority, remainingText, reachedAt, VIEWS, SPECIAL, SPECIAL_LABELS, specialOf,
  nextSteps, checkTransition, codDue, codPaid, requiredChecks, confirmChecks,
  EXCEPTION_TYPES, exceptionTypes, refundable, BEFORE_SHIPPING, changeStatuses,
  REFUSAL_REASONS, refusalOutcome,
  UNFULFILLABLE_REASONS, UNFULFILLABLE_TEMPLATES,
  storageGroup, storageReason, storageCode, DISPOSAL_METHODS,
  adminActions, normalizeTags, effectiveLine, recalcTotals,
}
