import { Component, Input, inject, signal } from '@angular/core';
import { FormBuilder, FormGroupDirective, Validators } from '@angular/forms';
import { AccountApiService } from '../../../services/account-apiservice';
import { ToastService } from '../../../services/toast';
import { AuthService } from '../../../services/auth';
import { ApiError } from '../../../classes/api-error';
import { firstError, matchValidator, strongPasswordValidator } from '../../../shared/form-validators';

// SCR-16 Đổi mật khẩu (UC-ACC-03 nhánh 1a) - dùng lại trong Hồ sơ quản trị SCR-53 (embedded = true).
// Kiểm tra từng ô ngay khi gõ; nút "Lưu thay đổi" chỉ bật khi cả 3 ô hợp lệ. API-08.
@Component({
  selector: 'app-change-password',
  standalone: false,
  templateUrl: './change-password.html',
  styleUrl: '../account-page.scss',
})
export class ChangePassword {
  @Input() embedded = false;
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(AccountApiService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);

  // Tài khoản tạo bằng Google chưa có mật khẩu: "Đặt mật khẩu", không có ô mật khẩu hiện tại (UC-ACC-03 1a)
  readonly setMode = this.auth.currentUser()?.hasPassword === false;

  readonly saving = signal(false);
  readonly form = this.fb.nonNullable.group(
    {
      currentPassword: ['', Validators.required],
      newPassword: ['', [Validators.required, strongPasswordValidator]],
      confirmPassword: ['', Validators.required],
    },
    { validators: matchValidator('newPassword', 'confirmPassword') },
  );

  constructor() {
    if (this.setMode) this.form.controls.currentPassword.clearValidators();
  }

  error(name: string): string {
    return firstError(this.form.get(name));
  }

  save(formDir: FormGroupDirective): void {
    if (this.form.invalid) return;
    this.saving.set(true);
    this.api.changePassword(this.form.getRawValue()).subscribe({
      next: () => {
        this.saving.set(false);
        formDir.resetForm();
        this.toast.show(this.setMode ? 'Đã đặt mật khẩu. Từ nay bạn đăng nhập được bằng email và mật khẩu' : 'Đã cập nhật mật khẩu thành công');
        if (this.setMode) this.auth.load(true).subscribe();
      },
      error: (err: ApiError) => {
        this.saving.set(false);
        const fields = (err.extra?.['fields'] || {}) as Record<string, string>;
        for (const [name, msg] of Object.entries(fields)) {
          this.form.get(name)?.setErrors({ server: msg });
          this.form.get(name)?.markAsTouched();
        }
        if (!Object.keys(fields).length) this.toast.show(err.message, 'danger');
      },
    });
  }
}
