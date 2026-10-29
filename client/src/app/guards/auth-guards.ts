import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from '../services/auth';
import { ToastService } from '../services/toast';

// Functional Guard (CanActivateFn) theo slide Chương IV. Guard chỉ để điều hướng;
// server vẫn kiểm tra quyền ở mọi API (NFR-SEC-04).
// Phiên tách 2 phía: guard cửa hàng đọc người dùng phía 'store' (chỉ có tài khoản khách),
// guard khu quản trị đọc phía 'admin' (chỉ có nhân viên).

// Khu Tài khoản: chưa đăng nhập thì sang /dang-nhap?returnUrl=... (UC-ACC-03 AC5)
export const authGuard: CanActivateFn = (route, state) => {
  const router = inject(Router);
  return inject(AuthService)
    .load(false, 'store')
    .pipe(
      map((user) =>
        user && user.role === 'member' ? true : router.createUrlTree(['/dang-nhap'], { queryParams: { returnUrl: state.url } }),
      ),
    );
};

// Trang đăng nhập, đăng ký của khách: đã đăng nhập tài khoản khách thì về trang chủ.
// Nhân viên đang mở khu quản trị vẫn thấy trang đăng nhập cửa hàng, không bị chuyển sang /quan-tri.
export const guestOnlyGuard: CanActivateFn = () => {
  const router = inject(Router);
  return inject(AuthService)
    .load(false, 'store')
    .pipe(map((user) => (user ? router.createUrlTree(['/']) : true)));
};

// Khu quản trị: chưa đăng nhập bằng tài khoản nhân viên thì sang /quan-tri/dang-nhap?returnUrl=...
export const adminGuard: CanActivateFn = (route, state) => {
  const router = inject(Router);
  return inject(AuthService)
    .load(false, 'admin')
    .pipe(
      map((user) =>
        user && user.role === 'admin' ? true : router.createUrlTree(['/quan-tri/dang-nhap'], { queryParams: { returnUrl: state.url } }),
      ),
    );
};

// Trang đăng nhập quản trị (SCR-60): nhân viên đã đăng nhập thì vào thẳng khu quản trị
export const adminGuestGuard: CanActivateFn = () => {
  const router = inject(Router);
  return inject(AuthService)
    .load(false, 'admin')
    .pipe(map((user) => (user && user.role === 'admin' ? router.createUrlTree(['/quan-tri']) : true)));
};

// Đọc data.permission (mã quyền .XEM của khu vực) hoặc data.adminOnly của route, so với quyền thực tế của API-04.
// Thiếu quyền thì về Hồ sơ quản trị (luôn được mở) kèm thông báo.
export const staffRoleGuard: CanActivateFn = (route) => {
  const router = inject(Router);
  const toast = inject(ToastService);
  return inject(AuthService)
    .load(true, 'admin') // hỏi lại server: quyền có thể vừa đổi
    .pipe(
      map((user) => {
        if (!user || user.role !== 'admin') return router.createUrlTree(['/quan-tri/dang-nhap']);
        const permission = route.data['permission'] as string | undefined;
        const ok = route.data['adminOnly'] ? user.isFullAccess : !permission || user.can(permission);
        if (ok) return true;
        toast.show('Bạn không có quyền mở trang này', 'danger');
        return router.createUrlTree(['/quan-tri/ho-so']);
      }),
    );
};
