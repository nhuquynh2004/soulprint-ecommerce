import { Injectable, effect, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { CookieService } from 'ngx-cookie-service';

export type ThemeMode = 'light' | 'dark';

// Chế độ Sáng/Tối (NFR-THEME-01, 02): đặt data-bs-theme trên <html>, lưu lựa chọn bằng cookie
// (ví dụ "cá nhân hóa giao diện bằng cookie" của slide Chương VIII 8.1.5). Lần đầu theo cài đặt hệ điều hành.
@Injectable({ providedIn: 'root' })
export class ThemeService {
  static readonly COOKIE = 'theme';
  private readonly cookie = inject(CookieService);
  private readonly document = inject(DOCUMENT);

  readonly mode = signal<ThemeMode>(this.initialMode());

  constructor() {
    effect(() => this.document.documentElement.setAttribute('data-bs-theme', this.mode()));
  }

  toggle(): void {
    const next: ThemeMode = this.mode() === 'dark' ? 'light' : 'dark';
    this.mode.set(next);
    this.cookie.set(ThemeService.COOKIE, next, { expires: 365, path: '/', sameSite: 'Lax' });
  }

  private initialMode(): ThemeMode {
    const saved = this.cookie.get(ThemeService.COOKIE);
    if (saved === 'light' || saved === 'dark') return saved;
    return this.document.defaultView?.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
}
