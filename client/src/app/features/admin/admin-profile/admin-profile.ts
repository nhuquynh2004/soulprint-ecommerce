import { Component, inject, signal } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { AuthService } from '../../../services/auth';
import { AuthApiService } from '../../../services/auth-apiservice';
import { AccountApiService } from '../../../services/account-apiservice';
import { ToastService } from '../../../services/toast';
import { ApiError } from '../../../classes/api-error';
import { ISession } from '../../../classes/user';
import { firstError, phoneValidator } from '../../../shared/form-validators';
import { ConfirmService } from '../../../services/confirm';

// SCR-53 Hồ sơ quản trị (UC-ACC-02 nhánh 6b, UC-ACC-03): thông tin, đổi mật khẩu, phiên đăng nhập
// (đăng xuất 1 thiết bị hoặc mọi thiết bị khác - AC8). API-07, API-08, API-132, API-133.
@Component({
  selector: 'app-admin-profile',
  standalone: false,
  templateUrl: './admin-profile.html',
  styleUrl: '../../account/account-page.scss',
})
export class AdminProfile {
  private readonly confirmBox = inject(ConfirmService);
  protected readonly auth = inject(AuthService);
  private readonly authApi = inject(AuthApiService);
  private readonly accountApi = inject(AccountApiService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  readonly sessions = signal<ISession[]>([]);
  readonly saving = signal(false);
  readonly form = this.fb.nonNullable.group({
    fullName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(60)]],
    phone: ['', [Validators.required, phoneValidator]],
  });

  constructor() {
    this.auth.load().subscribe((u) => u && this.form.patchValue({ fullName: u.fullName, phone: u.phone }));
    this.loadSessions();
  }

  error(name: string): string {
    return firstError(this.form.get(name), { minlength: 'Họ tên cần 2-60 ký tự' });
  }

  save(): void {
    if (this.form.invalid) return;
    const u = this.auth.currentUser()!;
    this.saving.set(true);
    const v = this.form.getRawValue();
    this.accountApi.updateProfile({ ...v, phone: v.phone.replace(/[\s.]/g, ''), gender: u.gender, birthday: u.birthday }).subscribe({
      next: (user) => {
        this.saving.set(false);
        this.auth.setUser({ ...u, ...user, staffRoles: u.staffRoles, permissions: u.permissions, isFullAccess: u.isFullAccess });
        this.form.markAsPristine();
        this.toast.show('Đã lưu thông tin');
      },
      error: (err: ApiError) => {
        this.saving.set(false);
        const fields = (err.extra?.['fields'] || {}) as Record<string, string>;
        for (const [name, msg] of Object.entries(fields)) this.form.get(name)?.setErrors({ server: msg });
        this.form.markAllAsTouched();
        if (!Object.keys(fields).length) this.toast.show(err.message, 'danger');
      },
    });
  }

  loadSessions(): void {
    this.authApi.getSessions().subscribe({ next: (list) => this.sessions.set(list), error: () => this.sessions.set([]) });
  }

  signOut(s: ISession | 'others'): void {
    const msg = s === 'others' ? 'Đăng xuất khỏi tất cả thiết bị khác?' : `Đăng xuất phiên trên ${s.device}?`;
    this.confirmBox.ask({ title: msg, okText: 'Đăng xuất', danger: true }).then((ok) => {
      if (!ok) return;
      this.authApi.deleteSession(s === 'others' ? 'others' : s.id).subscribe({
        next: () => {
          this.toast.show(s === 'others' ? 'Đã đăng xuất các thiết bị khác' : 'Đã đăng xuất thiết bị');
          this.loadSessions();
        },
        error: (err: ApiError) => this.toast.show(err.message, 'danger'),
      });
    });
  }

  deviceIcon(device: string): string {
    return /iOS|Android/.test(device) ? 'smartphone' : 'monitor';
  }
}
