import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom, isObservable, of } from 'rxjs';
import { adminGuard, authGuard, staffRoleGuard } from './auth-guards';
import { AuthService } from '../services/auth';
import { User } from '../classes/user';

describe('Functional Guard (Chương IV)', () => {
  let auth: AuthService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
    auth = TestBed.inject(AuthService);
  });

  const run = async (guard: typeof authGuard, url: string, data: Record<string, unknown> = {}) => {
    const route = { data } as unknown as ActivatedRouteSnapshot;
    const result = TestBed.runInInjectionContext(() => guard(route, { url } as RouterStateSnapshot));
    const value = isObservable(result) ? await firstValueFrom(result) : await result;
    return value instanceof UrlTree ? TestBed.inject(Router).serializeUrl(value) : value;
  };
  const login = (u: Partial<User> | null) => vi.spyOn(auth, 'load').mockReturnValue(of(u ? new User(u) : null));

  it('chưa đăng nhập mở /tai-khoan/thong-tin thì sang /dang-nhap?returnUrl=... (UC-ACC-03 AC5)', async () => {
    login(null);
    expect(await run(authGuard, '/tai-khoan/thong-tin')).toBe('/dang-nhap?returnUrl=%2Ftai-khoan%2Fthong-tin');
  });

  it('Member mở /quan-tri thì sang trang đăng nhập quản trị (UC-ACC-02 AC4)', async () => {
    login({ role: 'member' });
    expect(await run(adminGuard, '/quan-tri')).toBe('/quan-tri/dang-nhap?returnUrl=%2Fquan-tri');
  });

  it('Kho không mở được trang Voucher, về Hồ sơ quản trị (UC-ACC-07 AC1)', async () => {
    login({ role: 'admin', permissions: ['TONG_QUAN.XEM', 'DON_HANG.XEM'] });
    expect(await run(staffRoleGuard, '/quan-tri/voucher', { permission: 'VOUCHER.XEM' })).toBe('/quan-tri/ho-so');
    expect(await run(staffRoleGuard, '/quan-tri/don-hang', { permission: 'DON_HANG.XEM' })).toBe(true);
  });

  it('trang chỉ Quản trị: cần vai trò Quản trị (toàn quyền)', async () => {
    login({ role: 'admin', permissions: ['TONG_QUAN.XEM'] });
    expect(await run(staffRoleGuard, '/quan-tri/nhan-vien', { adminOnly: true })).toBe('/quan-tri/ho-so');
    login({ role: 'admin', isFullAccess: true });
    expect(await run(staffRoleGuard, '/quan-tri/nhan-vien', { adminOnly: true })).toBe(true);
  });
});
