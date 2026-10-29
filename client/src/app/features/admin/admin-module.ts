import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../../shared/shared-module';
import { ComingSoon } from '../../shared/coming-soon/coming-soon';
import { staffRoleGuard } from '../../guards/auth-guards';
import { ADMIN_NAV } from './admin-nav';
import { AdminLayout } from './admin-layout/admin-layout';
import { AdminHome } from './admin-home/admin-home';
import { AdminProfile } from './admin-profile/admin-profile';
import { StaffPage } from './staff/staff-page';
import { StaffDialog } from './staff/staff-dialog';
import { RoleEditor } from './staff/role-editor';
import { BulkBar } from './shared/bulk-bar/bulk-bar';
import { RowMenu } from './shared/row-menu/row-menu';
import { FilterChips } from './shared/filter-chips/filter-chips';
import { ConfirmDialog } from './shared/confirm-dialog/confirm-dialog';
import { ImagePicker } from './shared/image-picker/image-picker';
import { ProductAdminList } from './products/product-admin-list';
import { StockDialog } from './products/stock-dialog';
import { BulkTagDialog } from './products/bulk-tag-dialog';
import { ProductForm } from './products/product-form';
import { CategoryPage } from './categories/category-page';
import { CategoryDialog } from './categories/category-dialog';
import { TagsPage } from './tags/tags-page';
import { TagDialog, TagGroupDialog } from './tags/tag-dialogs';
import { CollectionList } from './collections/collection-list';
import { CollectionForm } from './collections/collection-form';
import { CollectionBulkEdit } from './collections/collection-bulk-edit';
import { HomeEditor } from './home-editor/home-editor';
import { BannerDialog } from './home-editor/banner-dialog';
import { SafeUrlPipe } from './shared/safe-url-pipe';
import { SettingsPage } from './settings/settings-page';
import { FaqDialog } from './settings/faq-dialog';
import { RichEditor } from './shared/rich-editor/rich-editor';
import { unsavedChangesGuard } from '../../guards/unsaved-changes-guard';
import { PersonalizationPage } from './personalization/personalization-page';
import { StickerSetDialog } from './personalization/sticker-set-dialog';
import { GiftTemplateDialog, MaterialDialog, SeasonDialog } from './personalization/gift-admin-dialogs';
import { StockMovementDialog } from './personalization/stock-movement-dialog';
import { VoucherList } from './vouchers/voucher-list';
import { VoucherForm } from './vouchers/voucher-form';
import { ColumnManager } from './shared/column-manager/column-manager';
import { Sparkline } from './shared/sparkline';
import { GiftPreview } from './shared/gift-preview';
import { PzPreview } from './shared/pz-preview';
import { PackingSlips } from './shared/packing-slips';
import { OrderList } from './orders/order-list';
import { OrderDetail } from './orders/order-detail';
import { StoragePage } from './storage/storage-page';
import { CustomerList } from './customers/customer-list';
import { CustomerDetail } from './customers/customer-detail';
import { DraftList } from './drafts/draft-list';
import { DraftForm } from './drafts/draft-form';
import { DraftDiscountDialog, DraftShippingDialog } from './drafts/draft-dialogs';
import { RequestList } from './requests/request-list';
import { RequestDetail } from './requests/request-detail';
import { RequestActionDialog } from './requests/request-action-dialog';
import { SupportPage } from './support/support-page';
import { ChatDock } from './support/chat-dock';
import { ChatWindow } from './support/chat-window';
import { Dashboard } from './dashboard/dashboard';
import { RevenueChart } from './dashboard/revenue-chart';

// Bộ component quản trị dùng chung (S3): thanh thao tác hàng loạt, menu "...", chip bộ lọc, hộp thoại xác nhận, ô ảnh
// S8 thêm Quản lý cột, đường xu hướng nhỏ, phiếu đóng gói
const ADMIN_SHARED = [BulkBar, RowMenu, FilterChips, ConfirmDialog, ImagePicker, RichEditor, SafeUrlPipe, ColumnManager, Sparkline, PackingSlips, GiftPreview, PzPreview];
const DONE = ['nhan-vien', 'san-pham', 'danh-muc', 'catalog-ai', 'bo-suu-tap', 'trang-chu', 'cai-dat', 'ca-nhan-hoa', 'voucher', 'don-hang', 'don-nhap', 'luu-kho', 'khach-hang', 'yeu-cau', 'ho-tro'];

// Các mục của slice sau (S3 trở đi) tạm hiện "đang hoàn thiện" nhưng vẫn kiểm tra quyền như thật
const later = ADMIN_NAV.flatMap((g) => g.items)
  .filter((i) => i.path && !DONE.includes(i.path))
  .map((i) => ({
    path: i.path,
    component: ComingSoon,
    canActivate: [staffRoleGuard],
    data: { heading: i.label, permission: i.permission, adminOnly: i.adminOnly },
    title: `${i.label} - Quản trị Soulprint`,
  }));

// Khu quản trị /quan-tri/* - tải lười, adminGuard ở route cha (app-routing-module), staffRoleGuard từng màn hình
// đọc data.permission (mã quyền .XEM) hoặc data.adminOnly.
const routes: Routes = [
  {
    path: '',
    component: AdminLayout,
    children: [
      { path: '', component: AdminHome, title: 'Tổng quan - Quản trị Soulprint' }, // SCR-40 (S12)
      { path: 'bao-cao', component: AdminHome, title: 'Tổng quan - Quản trị Soulprint' },
      { path: 'ho-so', component: AdminProfile, title: 'Hồ sơ - Quản trị Soulprint' },
      { path: 'nhan-vien', component: StaffPage, canActivate: [staffRoleGuard], data: { adminOnly: true, tab: 'staff' }, title: 'Nhân viên và phân quyền - Quản trị Soulprint' },
      { path: 'nhan-vien/vai-tro', component: StaffPage, canActivate: [staffRoleGuard], data: { adminOnly: true, tab: 'roles' }, title: 'Vai trò và quyền - Quản trị Soulprint' },
      { path: 'nhan-vien/vai-tro/moi', component: RoleEditor, canActivate: [staffRoleGuard], data: { adminOnly: true }, title: 'Tạo vai trò - Quản trị Soulprint' },
      { path: 'nhan-vien/vai-tro/:id', component: RoleEditor, canActivate: [staffRoleGuard], data: { adminOnly: true }, title: 'Sửa vai trò - Quản trị Soulprint' },
      { path: 'san-pham', component: ProductAdminList, canActivate: [staffRoleGuard], data: { permission: 'SAN_PHAM.XEM' }, title: 'Sản phẩm - Quản trị Soulprint' },
      { path: 'san-pham/moi', component: ProductForm, canActivate: [staffRoleGuard], canDeactivate: [unsavedChangesGuard], data: { permission: 'SAN_PHAM.TAO' }, title: 'Thêm sản phẩm - Quản trị Soulprint' },
      { path: 'san-pham/:id', component: ProductForm, canActivate: [staffRoleGuard], canDeactivate: [unsavedChangesGuard], data: { permission: 'SAN_PHAM.XEM' }, title: 'Sửa sản phẩm - Quản trị Soulprint' },
      { path: 'danh-muc', component: CategoryPage, canActivate: [staffRoleGuard], data: { permission: 'DANH_MUC.XEM' }, title: 'Danh mục - Quản trị Soulprint' },
      { path: 'catalog-ai', component: TagsPage, canActivate: [staffRoleGuard], data: { permission: 'TAGS.XEM' }, title: 'Tags và dữ liệu gợi ý - Quản trị Soulprint' },
      { path: 'bo-suu-tap', component: CollectionList, canActivate: [staffRoleGuard], data: { permission: 'BO_SUU_TAP.XEM' }, title: 'Bộ sưu tập - Quản trị Soulprint' },
      { path: 'bo-suu-tap/sua-hang-loat', component: CollectionBulkEdit, canActivate: [staffRoleGuard], canDeactivate: [unsavedChangesGuard], data: { permission: 'BO_SUU_TAP.SUA' }, title: 'Sửa hàng loạt bộ sưu tập - Quản trị Soulprint' },
      { path: 'bo-suu-tap/moi', component: CollectionForm, canActivate: [staffRoleGuard], canDeactivate: [unsavedChangesGuard], data: { permission: 'BO_SUU_TAP.TAO' }, title: 'Tạo bộ sưu tập - Quản trị Soulprint' },
      { path: 'bo-suu-tap/:id', component: CollectionForm, canActivate: [staffRoleGuard], canDeactivate: [unsavedChangesGuard], data: { permission: 'BO_SUU_TAP.XEM' }, title: 'Sửa bộ sưu tập - Quản trị Soulprint' },
      { path: 'trang-chu', component: HomeEditor, canActivate: [staffRoleGuard], canDeactivate: [unsavedChangesGuard], data: { permission: 'TRANG_CHU.XEM' }, title: 'Trang chủ - Quản trị Soulprint' },
      { path: 'ca-nhan-hoa', component: PersonalizationPage, canActivate: [staffRoleGuard], data: { permission: 'GOI_QUA.XEM' }, title: 'Cá nhân hóa và gói quà - Quản trị Soulprint' }, // SCR-56 (S4)
      { path: 'voucher', component: VoucherList, canActivate: [staffRoleGuard], data: { permission: 'VOUCHER.XEM' }, title: 'Voucher - Quản trị Soulprint' }, // SCR-45 (S5)
      { path: 'voucher/moi', component: VoucherForm, canActivate: [staffRoleGuard], canDeactivate: [unsavedChangesGuard], data: { permission: 'VOUCHER.TAO' }, title: 'Tạo voucher - Quản trị Soulprint' }, // SCR-46
      { path: 'voucher/:id', component: VoucherForm, canActivate: [staffRoleGuard], canDeactivate: [unsavedChangesGuard], data: { permission: 'VOUCHER.XEM' }, title: 'Sửa voucher - Quản trị Soulprint' },
      { path: 'cai-dat', component: SettingsPage, canActivate: [staffRoleGuard], canDeactivate: [unsavedChangesGuard], data: { adminOnly: true }, title: 'Cài đặt cửa hàng - Quản trị Soulprint' },
      { path: 'don-hang', component: OrderList, canActivate: [staffRoleGuard], data: { permission: 'DON_HANG.XEM' }, title: 'Đơn hàng - Quản trị Soulprint' }, // SCR-47 (S8)
      { path: 'don-hang/:code', component: OrderDetail, canActivate: [staffRoleGuard], data: { permission: 'DON_HANG.XEM' }, title: 'Chi tiết đơn - Quản trị Soulprint' }, // SCR-48
      { path: 'don-nhap', component: DraftList, canActivate: [staffRoleGuard], data: { permission: 'DON_NHAP.XEM' }, title: 'Đơn nháp - Quản trị Soulprint' }, // SCR-49
      { path: 'don-nhap/moi', component: DraftForm, canActivate: [staffRoleGuard], data: { permission: 'DON_NHAP.TAO' }, title: 'Tạo đơn nháp - Quản trị Soulprint' },
      { path: 'don-nhap/:code', component: DraftForm, canActivate: [staffRoleGuard], data: { permission: 'DON_NHAP.XEM' }, title: 'Đơn nháp - Quản trị Soulprint' },
      { path: 'luu-kho', component: StoragePage, canActivate: [staffRoleGuard], data: { permission: 'HANG_LUU_KHO.XEM' }, title: 'Hàng lưu kho - Quản trị Soulprint' }, // SCR-51
      { path: 'khach-hang', component: CustomerList, canActivate: [staffRoleGuard], data: { permission: 'KHACH_HANG.XEM', tab: 'customers' }, title: 'Khách hàng - Quản trị Soulprint' }, // SCR-58
      { path: 'khach-hang/danh-gia', component: CustomerList, canActivate: [staffRoleGuard], data: { permission: 'KHACH_HANG.XEM', tab: 'reviews' }, title: 'Đánh giá - Quản trị Soulprint' },
      { path: 'khach-hang/:id', component: CustomerDetail, canActivate: [staffRoleGuard], data: { permission: 'KHACH_HANG.XEM' }, title: 'Hồ sơ khách - Quản trị Soulprint' },
      { path: 'yeu-cau', component: RequestList, canActivate: [staffRoleGuard], data: { permission: 'HAU_MAI.XEM' }, title: 'Yêu cầu hậu mãi - Quản trị Soulprint' }, // SCR-50 (S9)
      { path: 'yeu-cau/:kind/:id', component: RequestDetail, canActivate: [staffRoleGuard], data: { permission: 'HAU_MAI.XEM' }, title: 'Chi tiết yêu cầu - Quản trị Soulprint' },
      { path: 'ho-tro', component: SupportPage, canActivate: [staffRoleGuard], data: { permission: 'HO_TRO.XEM' }, title: 'Hỗ trợ khách hàng - Quản trị Soulprint' }, // SCR-52 (S11)
      ...later,
    ],
  },
];

@NgModule({
  declarations: [AdminLayout, AdminHome, AdminProfile, StaffPage, StaffDialog, RoleEditor, ...ADMIN_SHARED, ProductAdminList, StockDialog, BulkTagDialog, ProductForm, CategoryPage, CategoryDialog, TagsPage, TagDialog, TagGroupDialog, CollectionList, CollectionForm, CollectionBulkEdit, HomeEditor, BannerDialog, SettingsPage, FaqDialog, PersonalizationPage, StickerSetDialog, GiftTemplateDialog, MaterialDialog, SeasonDialog, StockMovementDialog, VoucherList, VoucherForm, OrderList, OrderDetail, StoragePage, CustomerList, CustomerDetail, DraftList, DraftForm, DraftShippingDialog, DraftDiscountDialog, RequestList, RequestDetail, RequestActionDialog, SupportPage, ChatDock, ChatWindow, Dashboard, RevenueChart],
  imports: [SharedModule, RouterModule.forChild(routes)],
})
export class AdminModule {}
