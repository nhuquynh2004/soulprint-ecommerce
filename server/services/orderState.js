// Quy tắc trạng thái đơn phía khách (05_Diagrams.md Mục 2; UC-TRK-02, CNL-01, CNL-02, CNL-03). Hàm thuần, không đọc
// CSDL để unit test được: tab, mốc timeline (kèm ngày dự kiến), nút được phép (`actions`, client không tự suy
// luận quy tắc - UC-CNL-01 ghi chú kỹ thuật), phân loại hủy TH1/TH2/TH3 (BR-28), che thông tin khi xem qua tra cứu.
const params = require("../config/params")
const { vnDate } = require("./checkoutMath")

const DAY = 24 * 60 * 60 * 1000

const ORDER_LABEL = {
  CHO_XAC_NHAN: "Chờ xác nhận",
  DANG_CA_NHAN_HOA: "Đang cá nhân hóa",
  DANG_CHUAN_BI: "Đang chuẩn bị",
  DANG_VAN_CHUYEN: "Đang vận chuyển",
  DA_GIAO: "Đã giao",
  HOAN_THANH: "Hoàn thành",
  DA_HUY: "Đã hủy",
}
const PAYMENT_LABEL = {
  CHUA_THANH_TOAN: "Chưa thanh toán",
  DA_COC: "Đã đặt cọc",
  DA_THANH_TOAN: "Đã thanh toán",
  HOAN_TIEN_MOT_PHAN: "Đã hoàn một phần",
  DA_HOAN_TIEN: "Đã hoàn tiền",
}

// Trạng thái phụ ghi trong statusHistory: lưu kho (field storageStatus), dòng sản phẩm không thể thực hiện (field items)
const OTHER_LABEL = {
  DANG_LUU_KHO: "Đang lưu kho",
  HET_HAN_LUU_KHO: "Hết hạn lưu kho",
  DA_TIEU_HUY: "Đã tiêu hủy",
  CHO_KHACH_CHON: "Chờ khách chọn phương án",
  DA_THAY_THE: "Đã thay thế sản phẩm",
  DA_HOAN_TIEN: "Đã hoàn tiền sản phẩm",
  DA_SUA_DON: "Đơn đã được sửa", // Khách sửa đơn, nhân viên đổi sản phẩm
  DANG_HOI_KHACH: "Không thể thực hiện, đang hỏi khách",
  DA_GO_DANH_DAU: "Gỡ đánh dấu không thể thực hiện",
}
// Trục returnStatus (05 Mục 2.3) ghi trong statusHistory field returnStatus - S9
const RETURN_LABEL = {
  KHONG_CO: "Không có yêu cầu đổi trả",
  DANG_YEU_CAU: "Gửi yêu cầu đổi trả",
  DONG_Y: "Đổi trả đã được duyệt",
  DA_NHAN_HANG: "Đã nhận hàng trả về",
  TU_CHOI: "Đổi trả bị từ chối",
  DA_HOAN_TAT: "Đổi trả hoàn tất",
}
const statusLabel = (field, value) =>
  (field === "paymentStatus" ? PAYMENT_LABEL[value] : field === "orderStatus" ? ORDER_LABEL[value] : field === "returnStatus" ? RETURN_LABEL[value] : OTHER_LABEL[value]) || value

// Lý do hủy khi Member tự hủy (UC-CNL-02 bước 2)
const CANCEL_REASONS = {
  DOI_NOI_DUNG: "Muốn đổi nội dung cá nhân hóa",
  DOI_DIA_CHI: "Muốn đổi địa chỉ, thời gian nhận",
  DAT_TRUNG: "Đặt trùng đơn",
  CHON_QUA_KHAC: "Đã chọn được món quà khác",
  KHAC: "Lý do khác",
  // Chỉ khi đơn đang được hỏi ý kiến vì không thể thực hiện (UC-CNL-02 3c)
  KHONG_THE_THUC_HIEN: "Đơn hàng không thể thực hiện",
}

// Nhãn lý do hủy hiển thị: lý do Member chọn, hoặc lý do do nhân viên/hệ thống ghi (OPS-03, OPS-04, OPS-06)
const SYSTEM_CANCEL = { TU_CHOI_NHAN: "Khách từ chối nhận hàng", KHONG_THE_THUC_HIEN: "Sản phẩm không thể thực hiện", NGOAI_LE: "Soulprint hủy đơn" }
const cancelLabel = (code) => CANCEL_REASONS[code] || SYSTEM_CANCEL[code] || code

// 7 tab SCR-18 là nhóm các giá trị orderStatus (05 Mục 2.5); tab đổi trả liệt kê yêu cầu, không lọc đơn
const TABS = {
  "tat-ca": null,
  "cho-xac-nhan": ["CHO_XAC_NHAN"],
  "dang-xu-ly": ["DANG_CA_NHAN_HOA", "DANG_CHUAN_BI"],
  "dang-giao": ["DANG_VAN_CHUYEN"],
  "da-giao": ["DA_GIAO", "HOAN_THANH"],
  "da-huy": ["DA_HUY"],
  "doi-tra-bao-hanh": [],
}
const tabOf = (status) => Object.keys(TABS).find((k) => TABS[k] && TABS[k].includes(status)) || "tat-ca"

// Lọc thời gian SCR-18: mặc định 3 tháng gần nhất
const RANGES = { "3m": 3, "6m": 6, "12m": 12, all: null }
function rangeStart(range, now = new Date()) {
  const months = RANGES[range] === undefined ? RANGES["3m"] : RANGES[range]
  if (!months) return null
  const d = new Date(now)
  d.setMonth(d.getMonth() - months)
  return d
}

// ===== Hủy đơn =====

// BR-27: đơn cá nhân hóa chỉ hủy ở CHO_XAC_NHAN; đơn thường ở CHO_XAC_NHAN hoặc DANG_CHUAN_BI
function canCancel(o) {
  if (o.orderStatus === "CHO_XAC_NHAN") return true
  return o.orderStatus === "DANG_CHUAN_BI" && !o.hasPersonalizedItems
}

// BR-28, xét theo thứ tự: TH1 chưa trả đồng nào; TH3 đã bắt đầu cá nhân hóa và đã trả; TH2 còn lại
function cancelCase(o) {
  if (!(o.paidAmount > 0)) return "TH1"
  if (o.hasPersonalizedItems && o.personalizationStartedAt) return "TH3"
  return "TH2"
}

// Số được hoàn khi hủy (BR-07): toàn bộ phần đã trả chưa hoàn; Member tự hủy không trừ phí vì chưa giao lần nào,
// đơn bị từ chối nhận trừ phí vận chuyển phát sinh nhân viên đã ghi (UC-OPS-04 AC1)
const refundOnCancel = (o) =>
  Math.max(0, (o.paidAmount || 0) - (o.refundedAmount || 0) - (o.cancelBy === "REFUSED" ? o.refusedShippingFee || 0 : 0))

// ===== Nút được phép =====

const deliveredWithin = (o, days, now) => !!o.deliveredAt && now - new Date(o.deliveredAt) <= days * DAY

// ctx.refund: yêu cầu hoàn tiền mới nhất của đơn (nếu có). Nút bảo hành tính theo từng dòng ở myOrders.detail (S9).
function actions(o, { now = new Date(), refund = null } = {}) {
  const delivered = ["DA_GIAO", "HOAN_THANH"].includes(o.orderStatus)
  const cancelled = o.orderStatus === "DA_HUY"
  const openRefund = !!refund && ["CHO_XU_LY", "DA_HOAN"].includes(refund.status)
  const refundAccount = needsRefundAccount(refund)
  return {
    cancel: canCancel(o),
    received: o.orderStatus === "DA_GIAO",
    // Đặt lại đơn hủy TH1/TH2 (CNL-03) và "Mua lại" đơn đã giao (UC-TRK-02 bước 2)
    reorder: delivered || (cancelled && ["TH1", "TH2"].includes(o.cancelCase)),
    review: delivered && (o.items || []).some((it) => !it.reviewed),
    return: delivered && (o.returnStatus || "KHONG_CO") === "KHONG_CO" && deliveredWithin(o, params.RETURN_WINDOW_DAYS, now),
    refund: cancelled && o.cancelCase === "TH2" && refundOnCancel(o) > 0 && !openRefund && !refundAccount,
    // Nhập lại tài khoản: chuyển khoản thất bại hoặc yêu cầu hoàn chưa có tài khoản (UC-CNL-05 5a)
    refundAccount,
    redelivery: cancelled && o.cancelCase === "TH3" && o.storageStatus === "DANG_LUU_KHO" && !(o.redeliveryCount > 0),
    // Khách sửa đơn trước khi xác nhận (UC-TRK-06): không khi đang chờ trả thêm cho thay đổi khác
    editShipping: canEdit(o),
    editPersonalization: canEdit(o) && (o.items || []).some((it) => it.isPersonalized && (it.fulfillStatus || "BINH_THUONG") === "BINH_THUONG"),
  }
}

const needsRefundAccount = (r) => !!r && r.method !== "GATEWAY" && (r.status === "THAT_BAI" || (r.status === "CHO_XU_LY" && !r.bankInfo))

const canEdit = (o) => o.orderStatus === "CHO_XAC_NHAN" && !o.pendingChange && !o.urgentCode

// Đơn cần khách xử lý (dòng tóm tắt SCR-18): đang hỏi khách, chờ trả thêm, TH3 đang lưu kho
const needsAction = (o) =>
  (o.orderStatus === "CHO_XAC_NHAN" && o.unfulfillable && o.unfulfillable.status === "DANG_HOI_KHACH") ||
  !!o.pendingChange ||
  (o.orderStatus === "DA_HUY" && o.cancelCase === "TH3" && o.storageStatus === "DANG_LUU_KHO")

// ===== Timeline và lịch sử =====

const addDaysYmd = (ymd, n) => new Date(Date.parse(ymd + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10)

// 6 mốc (bỏ "Đang cá nhân hóa" với đơn thường - TRK-02 AC3). Mốc đã qua có thời gian thật (lần đầu tới mốc đó);
// mốc chưa tới có ngày dự kiến tính từ mốc gần nhất, mỗi bước 1 ngày, giao hàng 1-2 ngày (chỉ để hiển thị),
// trừ khi nhân viên đã gia hạn ngày giao (`expectedDeliveryDate`).
// Đơn đã hủy: chèn mốc "Đã hủy" sau mốc cuối đã qua, các mốc sau không có ngày dự kiến.
function timeline(o) {
  const steps = ["CHO_XAC_NHAN", ...(o.hasPersonalizedItems ? ["DANG_CA_NHAN_HOA"] : []), "DANG_CHUAN_BI", "DANG_VAN_CHUYEN", "DA_GIAO", "HOAN_THANH"]
  const reached = new Map()
  // Đơn nhận lại hàng (UC-CNL-04): từ "Đang chuẩn bị" trở đi chỉ tính các lần đổi trạng thái sau khi giao lại
  const resumedAt = o.redeliveredAt ? new Date(o.redeliveredAt) : null
  const AFTER_RESUME = ["DANG_CHUAN_BI", "DANG_VAN_CHUYEN", "DA_GIAO", "HOAN_THANH"]
  for (const h of o.statusHistory || []) {
    if (h.field !== "orderStatus" || reached.has(h.to)) continue
    if (resumedAt && AFTER_RESUME.includes(h.to) && new Date(h.at) < resumedAt) continue
    reached.set(h.to, h.at)
  }
  if (!reached.has("CHO_XAC_NHAN")) reached.set("CHO_XAC_NHAN", o.createdAt)

  const cancelled = o.orderStatus === "DA_HUY"
  let lastDone = 0
  steps.forEach((s, i) => {
    if (reached.has(s)) lastDone = i
  })
  const currentIndex = cancelled ? -1 : steps.indexOf(o.orderStatus)

  const out = []
  const base = vnDate(new Date(reached.get(steps[lastDone])))
  let ahead = 0
  steps.forEach((s, i) => {
    // Mốc "Đã hủy" vẫn giữ trong timeline của đơn nhận lại hàng (hậu điều kiện UC-CNL-04)
    if (resumedAt && s === "DANG_CHUAN_BI") {
      out.push({ status: "DA_HUY", label: "Đã hủy, khách nhận lại hàng", at: o.cancelledAt || null, state: "done", expected: null })
    }
    if (i <= lastDone) {
      out.push({ status: s, label: ORDER_LABEL[s], at: reached.get(s) || null, state: i === currentIndex ? "current" : "done", expected: null })
      if (cancelled && i === lastDone) {
        out.push({ status: "DA_HUY", label: ORDER_LABEL.DA_HUY, at: o.cancelledAt || null, state: "cancelled", expected: null })
      }
      return
    }
    if (cancelled) {
      out.push({ status: s, label: ORDER_LABEL[s], at: null, state: "todo", expected: null })
      return
    }
    ahead += 1
    let expected = null
    // Nhân viên gia hạn thời gian xử lý thì mốc "Đã giao" dùng ngày đó (UC-OPS-03 2e)
    if (s === "DA_GIAO" && o.expectedDeliveryDate) expected = { from: o.expectedDeliveryDate, to: o.expectedDeliveryDate }
    else if (s === "DA_GIAO") expected = { from: addDaysYmd(base, ahead), to: addDaysYmd(base, ahead + 1) }
    else if (s !== "HOAN_THANH") expected = { from: addDaysYmd(base, ahead), to: addDaysYmd(base, ahead) }
    if (s === "DA_GIAO") ahead += 1
    out.push({ status: s, label: ORDER_LABEL[s], at: null, state: "todo", expected })
  })
  return out
}

// "Lịch sử chi tiết": mọi lần đổi trạng thái đơn hàng và thanh toán, mới nhất trước
function history(o) {
  return (o.statusHistory || [])
    .map((h) => ({
      field: h.field,
      label: statusLabel(h.field, h.to),
      at: h.at,
      byRole: h.byRole || null,
      note: h.note || null,
    }))
    .sort((a, b) => new Date(b.at) - new Date(a.at))
}

// ===== Che thông tin khi xem qua tra cứu đơn (SCR-24) =====

// "Phan Ngọc Bảo" -> "Ph*** N*** B***": từ đầu giữ 2 ký tự, các từ sau giữ 1 ký tự
function maskName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean)
  return parts.map((w, i) => [...w].slice(0, i === 0 ? 2 : 1).join("") + "***").join(" ")
}
// Báo nơi nhận OTP: giữ 4 số đầu, 3 số cuối để khách nhận ra số của mình (UC-TRK-01 bước 4)
const maskPhone = (p) => (p && p.length >= 7 ? `${p.slice(0, 4)} *** ${p.slice(-3)}` : "***")
// SĐT trong thông tin đơn khi tra cứu: chỉ giữ 3 số đầu
const maskPhoneShort = (p) => (p && p.length >= 7 ? `${p.slice(0, 3)} *** ****` : "***")
// "12 Nguyễn Văn Bảo" -> "12 Ng***": giữ số nhà và 2 ký tự đầu tên đường, bỏ phần còn lại
function maskStreet(street) {
  const parts = String(street || "").trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return ""
  if (/\d/.test(parts[0]) && parts.length >= 2) return `${parts[0]} ${[...parts[1]].slice(0, 2).join("")}***`
  return [...parts[0]].slice(0, 2).join("") + "***"
}
// "Phường Bến Nghé" -> "P***"
const maskWard = (w) => (w ? [...String(w).trim()].slice(0, 1).join("") + "***" : "")
// Phiên bản đơn để trang chi tiết tự tải lại khi đơn đổi ở nơi khác (NFR-REL-06): mã băm các trường người xem thấy.
// Phía khách không tính ghi chú nội bộ, thẻ, yêu cầu duyệt (các thao tác chỉ nhân viên thấy không làm trang khách tải lại)
function orderVersion(o, { staff = false } = {}) {
  const pick = {
    s: [o.orderStatus, o.paymentStatus, o.paidAmount || 0, o.refundedAmount || 0, o.total, o.remainingAmount ?? null, o.expectedDeliveryDate || null],
    a: o.shippingAddress || null, n: o.noteForShop || "",
    i: (o.items || []).map((it) => [String(it._id), it.variantSku, it.quantity, it.fulfillStatus || "", it.personalization || null]),
    g: o.giftWrap || null, h: (o.statusHistory || []).length,
    p: o.pendingChange ? String(o.pendingChange.paymentId) : "", u: o.unfulfillable ? [o.unfulfillable.status, !!o.unfulfillable.apologyVoucher?.pending] : null,
    k: [o.storageStatus || "", o.trackingCode || "", o.returnStatus || "", o.carrier || ""],
    ...(staff ? { x: [(o.internalNotes || []).length, !!o.approvalPending, o.tags || [], o.lastExpiredChange ? 1 : 0] } : {}),
  }
  return require("crypto").createHash("sha1").update(JSON.stringify(pick)).digest("hex").slice(0, 16)
}

const maskAccount = (n) => (n ? "****" + String(n).slice(-4) : "")

// Tài khoản CHO_KICH_HOAT (tạo sẵn khi đặt bằng SĐT, UC-ACC-04) chưa là thành viên; "Thành viên từ" tính lúc kích hoạt
function membership(u, firstOrderAt = null) {
  const isMember = !!u.activatedAt || u.status === "HOAT_DONG"
  return { isMember, memberSince: isMember ? u.activatedAt || u.createdAt : null, firstOrderAt: firstOrderAt || null }
}

// ===== Tài khoản nhận tiền hoàn =====

// Số tài khoản 6-20 chữ số; tên chủ tài khoản chữ in hoa không dấu (như trên thẻ ngân hàng)
function readRefundAccount(input) {
  const a = input || {}
  const account = {
    bankName: String(a.bankName || "").normalize("NFC").trim().slice(0, 60),
    accountNumber: String(a.accountNumber || "").replace(/[\s.-]/g, ""),
    accountName: String(a.accountName || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .toUpperCase()
      .replace(/\s+/g, " ")
      .trim(),
  }
  const errors = {
    "refundAccount.bankName": account.bankName ? "" : "Vui lòng chọn ngân hàng",
    "refundAccount.accountNumber": /^\d{6,20}$/.test(account.accountNumber) ? "" : "Số tài khoản gồm 6 đến 20 chữ số",
    "refundAccount.accountName": /^[A-Z ]{2,60}$/.test(account.accountName) ? "" : "Nhập tên chủ tài khoản như trên thẻ (chữ không dấu)",
  }
  return { account, errors }
}

module.exports = {
  ORDER_LABEL, PAYMENT_LABEL, OTHER_LABEL, RETURN_LABEL, statusLabel, CANCEL_REASONS, cancelLabel, TABS, tabOf, RANGES, rangeStart,
  canCancel, cancelCase, refundOnCancel, actions, needsAction, timeline, history,
  maskName, maskPhone, maskPhoneShort, maskStreet, maskWard, maskAccount, readRefundAccount, membership, orderVersion,
}
