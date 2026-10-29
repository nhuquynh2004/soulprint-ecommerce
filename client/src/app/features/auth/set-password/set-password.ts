import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, Validators } from '@angular/forms';
import { AuthApiService } from '../../../services/auth-apiservice';
import { AuthService } from '../../../services/auth';
import { ApiError } from '../../../classes/api-error';
import { firstError, matchValidator, strongPasswordValidator } from '../../../shared/form-validators';

// SCR-14 Đặt mật khẩu /dat-mat-khau/:token (route tham số - Chương IV).
// Dùng cho: đặt lại mật khẩu sau khi xác minh mã, kích hoạt tài khoản khách (ACC-04), nhân viên mới (ACC-07).
@Component({
  selector: 'app-set-password',
  standalone: false,
  templateUrl: './set-password.html',
  styleUrl: '../auth-form.scss',
})
export class SetPassword {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(AuthApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly token = inject(ActivatedRoute).snapshot.paramMap.get('token') || '';

  readonly info = signal<{ purpose: string; fullName: string; phone: string; role: string } | null>(null);
  readonly loading = signal(true);
  readonly expired = signal(false);
  // Mục đích token hết hạn do server trả kèm 410: liên kết kích hoạt thì gợi ý Tra cứu đơn hàng (UC-ACC-04 2Ea)
  readonly expiredPurpose = signal<string | null>(null);
  readonly submitting = signal(false);
  readonly errMessage = signal('');
  readonly done = signal<{ role: string; loggedIn: boolean } | null>(null);

  readonly form = this.fb.nonNullable.group(
    {
      password: ['', [Validators.required, strongPasswordValidator]],
      confirmPassword: ['', [Validators.required]],
      logoutOthers: [true],
    },
    { validators: matchValidator('password', 'confirmPassword') },
  );

  constructor() {
    this.api.setPasswordInfo(this.token).subscribe({
      next: (info) => {
        this.info.set(info);
        this.loading.set(false);
      },
      error: (err: ApiError) => {
        this.expiredPurpose.set(err.extra?.['purpose'] || null);
        this.expired.set(true);
        this.loading.set(false);
      },
    });
  }

  get isReset(): boolean {
    return this.info()?.purpose === 'DAT_LAI_MAT_KHAU';
  }

  error(name: string): string {
    return firstError(this.form.get(name));
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.errMessage.set('');
    const v = this.form.getRawValue();
    this.api.setPassword({ token: this.token, password: v.password, confirmPassword: v.confirmPassword, logoutOthers: this.isReset && v.logoutOthers }).subscribe({
      next: (res) => {
        this.submitting.set(false);
        this.done.set({ role: res.role, loggedIn: res.loggedIn });
        if (res.loggedIn) this.auth.load(true).subscribe();
      },
      error: (err: ApiError) => {
        this.submitting.set(false);
        if (err.status === 410) {
          this.expiredPurpose.set(err.extra?.['purpose'] || this.info()?.purpose || null);
          this.expired.set(true);
        }
        else this.errMessage.set(err.message);
      },
    });
  }

  next(): void {
    const d = this.done();
    if (!d) return;
    if (d.role === 'admin') this.router.navigate(['/quan-tri/dang-nhap']);
    // Kích hoạt xong: tới Đơn hàng của tôi để thấy đơn đã đặt (UC-ACC-04 bước 5)
    else if (d.loggedIn) this.router.navigate([this.isReset ? '/tai-khoan/thong-tin' : '/tai-khoan/don-hang']);
    else this.router.navigate(['/dang-nhap']);
  }
}
