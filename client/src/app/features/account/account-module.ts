import { NgModule, inject } from '@angular/core';
import { Router, RouterModule, Routes } from '@angular/router';
import { SharedModule } from '../../shared/shared-module';
import { AccountLayout } from './account-layout/account-layout';
import { Profile } from './profile/profile';
import { Addresses } from './addresses/addresses';
import { ChangePassword } from './change-password/change-password';
import { SavedDesigns } from './saved-designs/saved-designs';
import { WishlistPage } from './wishlist/wishlist-page';
import { MyVouchers } from './vouchers/my-vouchers';
import { MyOrders } from './orders/my-orders/my-orders';
import { OrderDetail } from './orders/order-detail/order-detail';
import { CancelDialog } from './orders/cancel-dialog/cancel-dialog';
import { EditShippingDialog } from './orders/edit-shipping-dialog/edit-shipping-dialog';
import { Notices } from './notices/notices';
import { ReturnRequestPage } from './orders/return-request/return-request';
import { WarrantyRequestPage } from './orders/warranty-request/warranty-request';
import { ReviewDialog } from './orders/review-dialog/review-dialog';
import { AfterCancelDialog } from './orders/after-cancel-dialog/after-cancel-dialog';
import { RequestCard } from './orders/request-card/request-card';

// Khu Tài khoản /tai-khoan/* (UC-ACC-03): nested routes, tải lười (loadChildren trong app-routing-module),
// chặn bằng authGuard ở route cha. Các mục của slice sau (đơn hàng, voucher...) tạm hiện "đang hoàn thiện".
const routes: Routes = [
  {
    path: '',
    component: AccountLayout,
    children: [
      // /tai-khoan: Mobile, Tablet mở trang menu (SCR-15-Mobile-Menu), Desktop chuyển sang Thông tin cá nhân
      {
        path: '',
        pathMatch: 'full',
        title: 'Tài khoản - Soulprint',
        canActivate: [() => matchMedia('(max-width: 991.98px)').matches || inject(Router).parseUrl('/tai-khoan/thong-tin')],
        children: [],
      },
      { path: 'thong-tin', component: Profile, title: 'Thông tin cá nhân - Soulprint' },
      { path: 'mat-khau', component: ChangePassword, title: 'Đổi mật khẩu - Soulprint' },
      { path: 'dia-chi', component: Addresses, title: 'Sổ địa chỉ - Soulprint' },
      { path: 'don-hang', component: MyOrders, title: 'Đơn hàng của tôi - Soulprint' }, // SCR-18 (S7)
      { path: 'don-hang/:code', component: OrderDetail, title: 'Chi tiết đơn hàng - Soulprint' }, // SCR-19 (S7)
      { path: 'don-hang/:code/doi-tra', component: ReturnRequestPage, title: 'Yêu cầu đổi/trả - Soulprint' }, // SCR-25 (S9)
      { path: 'don-hang/:code/bao-hanh', component: WarrantyRequestPage, title: 'Yêu cầu bảo hành - Soulprint' }, // SCR-26 (S9)
      { path: 'voucher', component: MyVouchers, title: 'Ưu đãi của tôi - Soulprint' }, // SCR-20 (S5)
      { path: 'uu-dai', redirectTo: 'voucher' }, // liên kết trong thông báo cũ trỏ /tai-khoan/uu-dai
      { path: 'thiet-ke', component: SavedDesigns, title: 'Thiết kế đã lưu - Soulprint' }, // SCR-21 (S4)
      { path: 'yeu-thich', component: WishlistPage, title: 'Yêu thích - Soulprint' }, // SCR-22 (S4)
      { path: 'thong-bao', component: Notices, title: 'Thông báo - Soulprint' }, // SCR-23 (S7)
    ],
  },
];

@NgModule({
  // ChangePassword khai báo ở SharedModule vì Hồ sơ quản trị (SCR-53) cũng dùng
  declarations: [AccountLayout, Profile, Addresses, SavedDesigns, WishlistPage, MyVouchers, MyOrders, OrderDetail, CancelDialog, EditShippingDialog, Notices, ReturnRequestPage, WarrantyRequestPage, ReviewDialog, AfterCancelDialog, RequestCard],
  imports: [SharedModule, RouterModule.forChild(routes)],
})
export class AccountModule {}
