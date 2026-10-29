// Danh mục quyền nhân viên: khu vực x hành động (02_Actors_BusinessRules_Glossary.md Mục 2.3, BR-37).
// Mã quyền dạng KHU_VUC.HANH_DONG. Tổng 60 quyền cấp được (gồm DON_HANG.NGOAI_LE_DAC_BIET); Nhân viên và Cài đặt chỉ vai trò Quản trị.
// column: cột trên ma trận "Sửa vai trò" ở SCR-57 (XEM, TAO, SUA, XOA hoặc KHAC = "Hành động khác").
const crud = (labels = {}) => [
  { action: "XEM", label: labels.XEM || "Xem", column: "XEM" },
  { action: "TAO", label: labels.TAO || "Tạo", column: "TAO" },
  { action: "SUA", label: labels.SUA || "Sửa", column: "SUA" },
  { action: "XOA", label: labels.XOA || "Xóa", column: "XOA" },
]
const other = (action, label) => ({ action, label, column: "KHAC" })

const AREAS = [
  // Bán hàng
  { group: "Bán hàng", area: "TONG_QUAN", areaLabel: "Tổng quan", screens: ["SCR-40"], actions: [{ action: "XEM", label: "Xem", column: "XEM" }, other("XEM_DOANH_THU", "Xem doanh thu")] },
  {
    group: "Bán hàng", area: "DON_HANG", areaLabel: "Đơn hàng", screens: ["SCR-47", "SCR-48"],
    actions: [
      { action: "XEM", label: "Xem", column: "XEM" },
      { action: "SUA", label: "Xử lý", column: "SUA" },
      other("DONG_GOI", "Đóng gói"),
      other("GIAO_VAN_CHUYEN", "Giao vận chuyển"),
      other("IN_PHIEU", "In phiếu"),
      other("HUY_DON", "Hủy đơn"),
      // BR-48: cấp voucher bồi hoàn, hoàn tiền ngoài quy trình, hủy đơn đã cá nhân hóa, bỏ tặng voucher xin lỗi
      other("NGOAI_LE_DAC_BIET", "Ngoại lệ đặc biệt"),
    ],
  },
  { group: "Bán hàng", area: "DON_NHAP", areaLabel: "Đơn nháp", screens: ["SCR-49"], actions: [...crud(), other("KICH_HOAT", "Tạo đơn, gửi liên kết")] },
  {
    group: "Bán hàng", area: "HAU_MAI", areaLabel: "Yêu cầu hậu mãi", screens: ["SCR-50"],
    actions: [
      { action: "XEM", label: "Xem", column: "XEM" },
      { action: "SUA", label: "Sửa", column: "SUA" },
      other("XAC_NHAN_NHAN_HANG", "Nhận hàng trả về"),
      other("DUYET_TU_CHOI", "Duyệt, từ chối"),
      other("HOAN_TIEN", "Hoàn tiền"),
    ],
  },
  {
    group: "Bán hàng", area: "HANG_LUU_KHO", areaLabel: "Hàng lưu kho", screens: ["SCR-51"],
    actions: [{ action: "XEM", label: "Xem", column: "XEM" }, { action: "SUA", label: "Sửa", column: "SUA" }, other("TIEU_HUY", "Tiêu hủy")],
  },
  {
    group: "Bán hàng", area: "KHACH_HANG", areaLabel: "Khách hàng", screens: ["SCR-58"],
    actions: [
      { action: "XEM", label: "Xem", column: "XEM" },
      { action: "SUA", label: "Sửa", column: "SUA" },
      other("KHOA_TAI_KHOAN", "Khóa tài khoản"),
      other("AN_DANH_GIA", "Ẩn, trả lời đánh giá"),
    ],
  },
  { group: "Bán hàng", area: "HO_TRO", areaLabel: "Hỗ trợ khách hàng", screens: ["SCR-52"], actions: [{ action: "XEM", label: "Xem", column: "XEM" }, other("TRA_LOI", "Trả lời")] },
  // Catalog
  { group: "Catalog", area: "SAN_PHAM", areaLabel: "Sản phẩm", screens: ["SCR-41", "SCR-42"], actions: [...crud(), other("CAP_NHAT_TON", "Cập nhật tồn"), other("SUA_GIA", "Sửa giá")] },
  { group: "Catalog", area: "DANH_MUC", areaLabel: "Danh mục", screens: ["SCR-43"], actions: crud() },
  { group: "Catalog", area: "TAGS", areaLabel: "Tags và dữ liệu gợi ý", screens: ["SCR-44"], actions: crud() },
  { group: "Catalog", area: "VOUCHER", areaLabel: "Voucher", screens: ["SCR-45", "SCR-46"], actions: [...crud(), other("XUAT_CSV", "Xuất CSV")] },
  { group: "Catalog", area: "BO_SUU_TAP", areaLabel: "Bộ sưu tập", screens: ["SCR-54"], actions: crud() },
  // Cửa hàng
  {
    group: "Cửa hàng", area: "TRANG_CHU", areaLabel: "Trang chủ", screens: ["SCR-55"],
    actions: [{ action: "XEM", label: "Xem", column: "XEM" }, { action: "SUA", label: "Sửa", column: "SUA" }, other("XUAT_BAN", "Xuất bản")],
  },
  {
    group: "Cửa hàng", area: "GOI_QUA", areaLabel: "Cá nhân hóa và gói quà", screens: ["SCR-56"],
    actions: [...crud(), other("QUAN_LY_VAT_LIEU", "Quản lý vật liệu"), other("NHAP_KHO", "Nhập kho")],
  },
  // Hệ thống: chỉ vai trò Quản trị, không cấp được
  { group: "Hệ thống", area: "NHAN_VIEN", areaLabel: "Nhân viên và phân quyền", screens: ["SCR-57"], actions: [], adminOnly: true },
  { group: "Hệ thống", area: "CAI_DAT", areaLabel: "Cài đặt cửa hàng", screens: ["SCR-59"], actions: [], adminOnly: true },
]

// Danh sách phẳng mọi mã quyền cấp được
const ALL_PERMISSIONS = AREAS.flatMap((a) => a.actions.map((x) => `${a.area}.${x.action}`))
const PERMISSION_SET = new Set(ALL_PERMISSIONS)

const FULL_ACCESS_ROLE = "QUAN_TRI"
const DEFAULT_ROLES = ["QUAN_TRI", "BAN_HANG", "KHO"]

module.exports = { AREAS, ALL_PERMISSIONS, PERMISSION_SET, FULL_ACCESS_ROLE, DEFAULT_ROLES }
