// Thanh điều hướng khu quản trị (08_Sitemap_Screens.md Mục 3): 4 nhóm, mỗi mục cần quyền .XEM của khu vực
// (02 Mục 2.3) hoặc chỉ vai trò Quản trị. Chỉ hiện mục người dùng được phép (BR-34).
export interface AdminNavItem {
  path: string;
  label: string;
  icon: string;
  permission?: string;
  adminOnly?: boolean;
}

export const ADMIN_NAV: { group: string; items: AdminNavItem[] }[] = [
  {
    group: 'Bán hàng',
    items: [
      { path: '', label: 'Tổng quan', icon: 'chart', permission: 'TONG_QUAN.XEM' },
      { path: 'don-hang', label: 'Đơn hàng', icon: 'cart', permission: 'DON_HANG.XEM' },
      { path: 'don-nhap', label: 'Đơn nháp', icon: 'file', permission: 'DON_NHAP.XEM' },
      { path: 'yeu-cau', label: 'Yêu cầu hậu mãi', icon: 'refresh', permission: 'HAU_MAI.XEM' },
      { path: 'luu-kho', label: 'Hàng lưu kho', icon: 'archive', permission: 'HANG_LUU_KHO.XEM' },
      { path: 'khach-hang', label: 'Khách hàng', icon: 'users', permission: 'KHACH_HANG.XEM' },
      { path: 'ho-tro', label: 'Hỗ trợ khách hàng', icon: 'headset', permission: 'HO_TRO.XEM' },
    ],
  },
  {
    group: 'Catalog',
    items: [
      { path: 'san-pham', label: 'Sản phẩm', icon: 'package', permission: 'SAN_PHAM.XEM' },
      { path: 'danh-muc', label: 'Danh mục', icon: 'list-ul', permission: 'DANH_MUC.XEM' },
      { path: 'catalog-ai', label: 'Tags và dữ liệu gợi ý', icon: 'tag', permission: 'TAGS.XEM' },
      { path: 'voucher', label: 'Voucher', icon: 'ticket', permission: 'VOUCHER.XEM' },
      { path: 'bo-suu-tap', label: 'Bộ sưu tập', icon: 'layers', permission: 'BO_SUU_TAP.XEM' },
    ],
  },
  {
    group: 'Cửa hàng',
    items: [
      { path: 'trang-chu', label: 'Trang chủ', icon: 'home', permission: 'TRANG_CHU.XEM' },
      { path: 'ca-nhan-hoa', label: 'Cá nhân hóa và gói quà', icon: 'gift', permission: 'GOI_QUA.XEM' },
    ],
  },
  {
    group: 'Hệ thống',
    items: [
      { path: 'nhan-vien', label: 'Nhân viên', icon: 'user', adminOnly: true },
      { path: 'cai-dat', label: 'Cài đặt cửa hàng', icon: 'settings', adminOnly: true },
    ],
  },
];
