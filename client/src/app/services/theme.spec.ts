import { TestBed } from '@angular/core/testing';
import { CookieService } from 'ngx-cookie-service';
import { ThemeService } from './theme';

describe('ThemeService', () => {
  let cookie: CookieService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    cookie = TestBed.inject(CookieService);
    cookie.delete(ThemeService.COOKIE, '/');
  });

  it('đọc lựa chọn đã lưu trong cookie', () => {
    cookie.set(ThemeService.COOKIE, 'dark', { path: '/' });
    expect(TestBed.inject(ThemeService).mode()).toBe('dark');
  });

  it('đổi chế độ, lưu cookie và đặt data-bs-theme trên <html>', () => {
    cookie.set(ThemeService.COOKIE, 'light', { path: '/' });
    const theme = TestBed.inject(ThemeService);
    theme.toggle();
    TestBed.tick();
    expect(theme.mode()).toBe('dark');
    expect(cookie.get(ThemeService.COOKIE)).toBe('dark');
    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('dark');
  });
});
