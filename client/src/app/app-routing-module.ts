import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { Home } from './features/home/home';
import { NotFound } from './features/not-found/not-found';
import { ProductList } from './features/product-list/product-list';
import { ProductDetail } from './features/product-detail/product-detail';
import { Policy } from './features/policy/policy';
import { Login } from './features/auth/login/login';
import { Register } from './features/auth/register/register';
import { ForgotPassword } from './features/auth/forgot-password/forgot-password';
import { SetPassword } from './features/auth/set-password/set-password';
import { CartPage } from './features/cart/cart-page';
import { CheckoutPage } from './features/checkout/checkout-page';
import { OrderResult } from './features/checkout/order-result/order-result';
import { UrgentRequest } from './features/checkout/urgent-request/urgent-request';
import { PaymentGateway } from './features/checkout/payment-gateway/payment-gateway';
import { OrderLookup } from './features/order-lookup/order-lookup';
import { GiftAdvisor } from './features/gift-advisor/gift-advisor';
import { ComingSoon } from './shared/coming-soon/coming-soon';
import { adminGuard, adminGuestGuard, authGuard, guestOnlyGuard } from './guards/auth-guards';

// Bảng route (08_Sitemap_Screens.md). Mỗi slice thêm route của mình; route ** luôn để cuối.
// Trang có tiêu đề động (danh sách, chi tiết, chính sách) tự đặt Title theo dữ liệu (Chương IV).
const routes: Routes = [
  { path: '', component: Home, title: 'Soulprint - Quà tặng cá nhân hóa' },
  { path: 'trang-chu', redirectTo: '', pathMatch: 'full' },

  // S1 Khám phá sản phẩm: SCR-02 dùng chung cho 4 route, phân biệt bằng data.mode
  { path: 'san-pham', component: ProductList, data: { mode: 'all' } },
  { path: 'san-pham/:slug', component: ProductDetail },
  { path: 'danh-muc/:slug', component: ProductList, data: { mode: 'category' } },
  { path: 'tim-kiem', component: ProductList, data: { mode: 'search' } },
  { path: 'bo-suu-tap/:slug', component: ProductList, data: { mode: 'collection' } },
  { path: 'chinh-sach/:slug', component: Policy },
  { path: 'chinh-sach', redirectTo: 'chinh-sach/doi-tra', pathMatch: 'full' },

  // S4 Giỏ hàng (UC-CRT-03, CRT-04); S5 Thanh toán SCR-07, Kết quả đặt hàng SCR-09 (UC-PAY-01 đến PAY-04)
  { path: 'gio-hang', component: CartPage, title: 'Giỏ hàng - Soulprint' },
  { path: 'thanh-toan', component: CheckoutPage, title: 'Thanh toán - Soulprint' },
  { path: 'dat-hang/:code/ket-qua', component: OrderResult, title: 'Đặt hàng thành công - Soulprint' },
  { path: 'dat-gap/:code', component: UrgentRequest, title: 'Yêu cầu đặt gấp - Soulprint' },
  // S6: cổng thanh toán giả lập SCR-08 và trang thanh toán không thành công (SCR-09)
  { path: 'cong-thanh-toan/:id', component: PaymentGateway, title: 'Cổng thanh toán - Soulprint' },
  { path: 'thanh-toan/giao-dich/:id', component: OrderResult, title: 'Kết quả thanh toán - Soulprint' },
  // S7: tra cứu đơn bằng OTP (SCR-24, UC-TRK-01)
  { path: 'tra-cuu-don', component: OrderLookup, title: 'Tra cứu đơn hàng - Soulprint' },
  // S10: Tư vấn quà cùng AI SCR-10 (UC-DIS-05)
  { path: 'tu-van-qua', component: GiftAdvisor, title: 'Tìm quà cùng AI - Soulprint' },

  // S2 Tài khoản (UC-ACC-01 đến 03)
  { path: 'dang-nhap', component: Login, canActivate: [guestOnlyGuard], title: 'Đăng nhập - Soulprint' },
  { path: 'dang-ky', component: Register, canActivate: [guestOnlyGuard], title: 'Đăng ký - Soulprint' },
  { path: 'quen-mat-khau', component: ForgotPassword, title: 'Quên mật khẩu - Soulprint' },
  { path: 'dat-mat-khau/:token', component: SetPassword, title: 'Đặt mật khẩu - Soulprint' },
  // Khu Tài khoản và khu Quản trị tải lười (lazy loading - Chương IV)
  {
    path: 'tai-khoan',
    canActivate: [authGuard],
    loadChildren: () => import('./features/account/account-module').then((m) => m.AccountModule),
  },
  // SCR-60 là component standalone tải bằng loadComponent như slide; không có header/footer cửa hàng
  {
    path: 'quan-tri/dang-nhap',
    canActivate: [adminGuestGuard],
    loadComponent: () => import('./features/admin/admin-login/admin-login').then((m) => m.AdminLogin),
    title: 'Đăng nhập quản trị - Soulprint',
  },
  {
    path: 'quan-tri',
    canActivate: [adminGuard],
    loadChildren: () => import('./features/admin/admin-module').then((m) => m.AdminModule),
  },

  // Liên kết "Về Soulprint" của footer v4, chờ Quỳnh chốt nội dung (chỗ giữ, không phải trang 404)
  ...[
    ['huong-dan-ca-nhan-hoa', 'Hướng dẫn cá nhân hóa'],
    ['cau-chuyen-thuong-hieu', 'Câu chuyện thương hiệu'],
    ['goc-chia-se', 'Góc chia sẻ'],
    ['tuyen-dung', 'Tuyển dụng'],
  ].map(([path, heading]) => ({ path: 've-soulprint/' + path, component: ComingSoon, data: { heading }, title: heading + ' - Soulprint' })),
  { path: '**', component: NotFound, title: 'Không tìm thấy trang - Soulprint' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { scrollPositionRestoration: 'top', anchorScrolling: 'enabled' })],
  exports: [RouterModule],
})
export class AppRoutingModule {}
