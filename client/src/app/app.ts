import { Component, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { ThemeService } from './services/theme';
import { AuthService } from './services/auth';

@Component({
  selector: 'app-root',
  standalone: false,
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  // Khởi tạo ThemeService ngay khi mở ứng dụng để đồng bộ data-bs-theme với cookie.
  private readonly theme = inject(ThemeService);
  private readonly router = inject(Router);

  readonly isAdmin = signal(false);
  // Cổng thanh toán giả lập (SCR-08) đóng vai trang của cổng: không header/footer cửa hàng
  readonly isGateway = signal(false);

  constructor() {
    // Hỏi server người dùng hiện tại (API-04) một lần khi mở ứng dụng để header hiện đúng trạng thái đăng nhập
    inject(AuthService).load().subscribe();
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe((e) => {
      const url = (e as NavigationEnd).urlAfterRedirects;
      this.isAdmin.set(url.startsWith('/quan-tri'));
      this.isGateway.set(url.startsWith('/cong-thanh-toan'));
    });
  }
}
