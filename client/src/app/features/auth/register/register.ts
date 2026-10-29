import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, Validators } from '@angular/forms';
import { AuthApiService } from '../../../services/auth-apiservice';
import { AuthService } from '../../../services/auth';
import { ApiError } from '../../../classes/api-error';
import { firstError, matchValidator, phoneValidator, strongPasswordValidator } from '../../../shared/form-validators';

// SCR-12 Đăng ký (UC-ACC-01). Reactive Form: custom validator (SĐT, độ mạnh mật khẩu) và cross-field validator
// (mật khẩu - xác nhận) theo slide Chương V. Lỗi hiện ngay khi rời ô; nút "Tạo tài khoản" khóa đến khi hợp lệ (4Eb).
@Component({
  selector: 'app-register',
  standalone: false,
  templateUrl: './register.html',
  styleUrl: '../auth-form.scss',
})
export class Register {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(AuthApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly returnUrl = (() => {
    const url = this.route.snapshot.queryParamMap.get('returnUrl');
    return url && url.startsWith('/') && !url.startsWith('//') ? url : null;
  })();

  readonly form = this.fb.nonNullable.group(
    {
      fullName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(60)]],
      email: ['', [Validators.required, Validators.email]],
      phone: ['', [Validators.required, phoneValidator]],
      password: ['', [Validators.required, strongPasswordValidator]],
      confirmPassword: ['', [Validators.required]],
      acceptTerms: [false, [Validators.requiredTrue]],
    },
    { validators: matchValidator('password', 'confirmPassword') },
  );

  readonly submitting = signal(false);
  readonly errMessage = signal('');
  // Lỗi trùng email/SĐT từ server (409) để hiện liên kết "Đăng nhập ngay"
  readonly conflict = signal(false);
  readonly welcome = signal<{ name: string; code: string | null } | null>(null);

  error(name: string): string {
    return firstError(this.form.get(name), {
      required: name === 'acceptTerms' ? 'Vui lòng đồng ý Điều khoản sử dụng và Chính sách bảo mật' : 'Vui lòng nhập thông tin này',
      minlength: 'Họ tên cần 2-60 ký tự',
    });
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.errMessage.set('');
    this.conflict.set(false);
    const v = this.form.getRawValue();
    this.api.register({ ...v, phone: v.phone.replace(/[\s.]/g, '') }).subscribe({
      next: (res) => {
        this.submitting.set(false);
        this.auth.setUser(res.user);
        this.welcome.set({ name: res.user.fullName.split(' ').slice(-1)[0], code: res.welcomeVoucher });
      },
      error: (err: ApiError) => {
        this.submitting.set(false);
        // Lỗi theo trường từ server: gắn vào đúng ô (4Ea)
        const fields = (err.extra?.['fields'] || {}) as Record<string, string>;
        for (const [name, msg] of Object.entries(fields)) {
          const control = this.form.get(name);
          control?.setErrors({ server: msg });
          control?.markAsTouched();
        }
        this.conflict.set(err.status === 409);
        if (!Object.keys(fields).length) this.errMessage.set(err.message);
      },
    });
  }

  continueShopping(): void {
    this.router.navigateByUrl(this.returnUrl || '/');
  }
}
