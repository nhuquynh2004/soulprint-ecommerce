import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { NgForm } from '@angular/forms';
import { AuthApiService } from '../../../services/auth-apiservice';
import { AuthService } from '../../../services/auth';
import { ApiError } from '../../../classes/api-error';

// SCR-11 Đăng nhập khách (UC-ACC-02). Template-driven Form với [(ngModel)] (slide Chương V).
// Ô Email/SĐT điền sẵn từ cookie remember_user (ngx-cookie-service, slide 8.2).
@Component({
  selector: 'app-login',
  standalone: false,
  templateUrl: './login.html',
  styleUrl: '../auth-form.scss',
})
export class Login {
  private readonly api = inject(AuthApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly returnUrl = this.safeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl'));
  model = { login: this.auth.rememberedLogin(), password: '', rememberMe: !!this.auth.rememberedLogin() };

  readonly submitting = signal(false);
  readonly errMessage = signal('');
  readonly errCode = signal('');
  readonly hint = signal('');

  // Lỗi đăng nhập Google do API-200 trả về qua ?google= (UC-ACC-02 2bEa, 2bEb)
  readonly googleError = (
    {
      failed: 'Chưa đăng nhập được bằng Google, vui lòng thử lại.',
      unverified: 'Email Google chưa được xác minh, vui lòng dùng cách đăng nhập khác.',
      staff: 'Đây là tài khoản nhân viên, vui lòng đăng nhập ở trang quản trị.',
      locked: 'Tài khoản đã bị khóa, vui lòng liên hệ Soulprint để được hỗ trợ.',
      unavailable: 'Đăng nhập Google đang tạm ngưng, bạn dùng Email/SĐT và mật khẩu nhé.',
    } as Record<string, string>
  )[this.route.snapshot.queryParamMap.get('google') || ''] || '';
  readonly googleStaff = this.route.snapshot.queryParamMap.get('google') === 'staff';

  // Chỉ nhận đường dẫn nội bộ để không bị chuyển hướng sang trang lạ
  private safeReturnUrl(url: string | null): string | null {
    return url && url.startsWith('/') && !url.startsWith('//') ? url : null;
  }

  submit(form: NgForm): void {
    if (form.invalid) {
      form.control.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.errMessage.set('');
    this.hint.set('');
    this.api.login(this.model.login.trim(), this.model.password, this.model.rememberMe).subscribe({
      next: (res) => {
        this.auth.setUser(res.user);
        this.router.navigateByUrl(this.returnUrl || '/');
      },
      error: (err: ApiError) => {
        this.submitting.set(false);
        this.errCode.set(err.code);
        this.errMessage.set(err.message);
        this.hint.set(err.extra?.['hint'] || '');
        this.model.password = '';
      },
    });
  }
}
