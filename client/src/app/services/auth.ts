import { Injectable, computed, inject, signal } from '@angular/core';
import { NavigationStart, Router } from '@angular/router';
import { CookieService } from 'ngx-cookie-service';
import { Observable, catchError, filter, map, of, shareReplay, tap } from 'rxjs';
import { AuthApiService } from './auth-apiservice';
import { IUser, User } from '../classes/user';

// 'store' = cửa hàng (tài khoản khách), 'admin' = khu quản trị /quan-tri (tài khoản nhân viên)
export type AuthArea = 'store' | 'admin';
export const areaOf = (url: string): AuthArea => (/^\/quan-tri(\/|\?|#|$)/.test(url) ? 'admin' : 'store');

// Trạng thái đăng nhập dùng chung toàn ứng dụng (slide Chương VIII: AuthService có currentUser = signal).
// Không lưu thông tin đăng nhập ở localStorage (NFR-SEC-01): mỗi lần mở trang gọi API-04 để hỏi server.
// Phiên tách 2 phía: cửa hàng hỏi API-04, khu quản trị hỏi API-213. Nhân viên đang mở khu quản trị
// vẫn là khách chưa đăng nhập ở cửa hàng. currentUser là người dùng của phía đang mở.
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(AuthApiService);
  private readonly cookie = inject(CookieService);

  readonly area = signal<AuthArea>(areaOf(typeof location === 'undefined' ? '/' : location.pathname));
  private readonly users = { store: signal<User | null>(null), admin: signal<User | null>(null) };
  private readonly loaded: Partial<Record<AuthArea, Observable<User | null>>> = {};

  readonly currentUser = computed(() => this.users[this.area()]());
  readonly isLoggedIn = computed(() => !!this.currentUser());
  readonly isStaff = computed(() => this.currentUser()?.role === 'admin');

  constructor() {
    // NavigationStart chạy trước guard nên phía đang mở luôn đúng khi guard và trang đọc currentUser
    inject(Router)
      .events.pipe(filter((e): e is NavigationStart => e instanceof NavigationStart))
      .subscribe((e) => {
        this.area.set(areaOf(e.url));
        this.load().subscribe(); // sang phía chưa hỏi server (vd. từ quản trị sang Quên mật khẩu) thì hỏi 1 lần
      });
  }

  // Gọi API-04 (hoặc API-213) một lần cho mỗi phía, các guard dùng chung kết quả. reload = true để hỏi lại server.
  load(reload = false, area: AuthArea = this.area()): Observable<User | null> {
    if (reload || !this.loaded[area]) {
      this.loaded[area] = this.api.me(area === 'admin').pipe(
        map((u) => (u ? new User(u) : null)),
        catchError(() => of(null)),
        tap((u) => this.users[area].set(u)),
        shareReplay(1),
      );
    }
    return this.loaded[area]!;
  }

  // Sau khi đăng nhập/đăng ký thành công: nhân viên vào phía quản trị, khách vào phía cửa hàng
  setUser(user: IUser | null, area: AuthArea = user ? (user.role === 'admin' ? 'admin' : 'store') : this.area()): void {
    const u = user ? new User(user) : null;
    this.users[area].set(u);
    this.loaded[area] = of(u);
  }

  // Chỉ thoát phía đang mở (API-03 hoặc API-207)
  logout(area: AuthArea = this.area()): Observable<void> {
    return this.api.logout(area === 'admin').pipe(
      catchError(() => of(undefined)),
      tap(() => this.setUser(null, area)),
    );
  }

  // Cookie "Ghi nhớ đăng nhập" do server đặt (API-02, API-131), đọc bằng ngx-cookie-service để điền sẵn ô đăng nhập (slide 8.2)
  rememberedLogin(staff = false): string {
    return this.cookie.get(staff ? 'remember_staff' : 'remember_user') || '';
  }

  can(permission: string): boolean {
    return !!this.currentUser()?.can(permission);
  }
}
