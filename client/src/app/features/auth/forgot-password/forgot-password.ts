import { Component, OnDestroy, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthApiService } from '../../../services/auth-apiservice';
import { ApiError } from '../../../classes/api-error';

// SCR-13 Quên mật khẩu (UC-ACC-02 nhánh 2a): bước 1 nhập Email/SĐT, bước 2 nhập mã 6 số,
// xác minh xong chuyển sang SCR-14 (bước 3) với token đặt lại hạn 15 phút.
// Dịch vụ thông báo chạy mô phỏng: chế độ demo hiện mã ngay trên màn hình, không gửi SMS/email.
@Component({
  selector: 'app-forgot-password',
  standalone: false,
  templateUrl: './forgot-password.html',
  styleUrl: '../auth-form.scss',
})
export class ForgotPassword implements OnDestroy {
  private readonly api = inject(AuthApiService);
  private readonly router = inject(Router);

  readonly step = signal<1 | 2>(1);
  login = '';
  code = '';
  readonly maskedTarget = signal('');
  readonly devCode = signal('');
  readonly countdown = signal(0);
  readonly submitting = signal(false);
  readonly errMessage = signal('');
  readonly info = signal('');
  private timer?: ReturnType<typeof setInterval>;

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  private startCountdown(seconds: number): void {
    clearInterval(this.timer);
    this.countdown.set(seconds);
    this.timer = setInterval(() => {
      this.countdown.update((s) => Math.max(0, s - 1));
      if (!this.countdown()) clearInterval(this.timer);
    }, 1000);
  }

  // Bước 1 và "Gửi lại mã"
  send(): void {
    if (!this.login.trim()) {
      this.errMessage.set('Nhập email hoặc số điện thoại đã đăng ký');
      return;
    }
    this.submitting.set(true);
    this.errMessage.set('');
    this.api.forgotPassword(this.login.trim()).subscribe({
      next: (res) => {
        this.submitting.set(false);
        this.maskedTarget.set(res.maskedTarget);
        this.devCode.set(res.devCode || '');
        this.info.set(res.message);
        this.code = '';
        this.step.set(2);
        this.startCountdown(res.resendAfter);
      },
      error: (err: ApiError) => {
        this.submitting.set(false);
        this.errMessage.set(err.message);
        if (err.status === 429 && err.extra?.['retryAfter']) {
          this.step.set(2);
          this.startCountdown(err.extra['retryAfter']);
        }
      },
    });
  }

  // Bước 2: xác minh mã -> SCR-14
  verify(): void {
    if (!/^\d{6}$/.test(this.code)) {
      this.errMessage.set('Mã xác minh gồm 6 chữ số');
      return;
    }
    this.submitting.set(true);
    this.errMessage.set('');
    this.api.verifyResetCode(this.login.trim(), this.code).subscribe({
      next: (res) => this.router.navigate(['/dat-mat-khau', res.resetToken]),
      error: (err: ApiError) => {
        this.submitting.set(false);
        this.errMessage.set(err.message);
        this.code = '';
      },
    });
  }

  changeLogin(): void {
    this.step.set(1);
    this.errMessage.set('');
    this.devCode.set('');
  }

  // Chỉ giữ chữ số
  onCode(value: string): void {
    this.code = value.replace(/\D/g, '').slice(0, 6);
  }
}
