import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { NgForm } from '@angular/forms';
import { SharedModule } from '../../../shared/shared-module';
import { AuthApiService } from '../../../services/auth-apiservice';
import { AuthService } from '../../../services/auth';
import { ThemeService } from '../../../services/theme';
import { ApiError } from '../../../classes/api-error';

// SCR-60 Đăng nhập quản trị /quan-tri/dang-nhap (UC-ACC-02 nhánh 1a): trang riêng, không header/footer cửa hàng,
// không có Đăng ký. Component standalone tải lười bằng loadComponent theo slide Chương IV.
// Ô ghi nhớ dùng cookie remember_staff.
@Component({
  selector: 'app-admin-login',
  imports: [SharedModule],
  templateUrl: './admin-login.html',
  styleUrls: ['../../auth/auth-form.scss', './admin-login.scss'],
})
export class AdminLogin {
  private readonly api = inject(AuthApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly theme = inject(ThemeService);
  private readonly returnUrl = inject(ActivatedRoute).snapshot.queryParamMap.get('returnUrl');

  model = { login: this.auth.rememberedLogin(true), password: '', rememberMe: !!this.auth.rememberedLogin(true) };
  readonly submitting = signal(false);
  readonly errMessage = signal('');

  submit(form: NgForm): void {
    if (form.invalid) {
      form.control.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.errMessage.set('');
    this.api.staffLogin(this.model.login.trim(), this.model.password, this.model.rememberMe).subscribe({
      next: (res) => {
        this.auth.setUser(res.user);
        // Quay lại trang đang mở dở trong khu quản trị; staffRoleGuard tự đưa về trang được phép nếu thiếu quyền
        const back = this.returnUrl && this.returnUrl.startsWith('/quan-tri') && !this.returnUrl.startsWith('/quan-tri/dang-nhap') ? this.returnUrl : res.landing;
        this.router.navigateByUrl(back);
      },
      error: (err: ApiError) => {
        this.submitting.set(false);
        this.errMessage.set(err.message);
        this.model.password = '';
      },
    });
  }
}
