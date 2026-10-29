import { Component, inject, signal } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { AuthService } from '../../../services/auth';
import { AccountApiService } from '../../../services/account-apiservice';
import { ToastService } from '../../../services/toast';
import { ApiError } from '../../../classes/api-error';
import { Gender, ISavedRefundAccount } from '../../../classes/user';
import { RefundAccountValue } from '../../../classes/aftersales';
import { firstError, phoneValidator } from '../../../shared/form-validators';
import { ConfirmService } from '../../../services/confirm';

// SCR-15 Thông tin cá nhân (UC-ACC-03 luồng chính). Reactive Form nạp dữ liệu bằng patchValue (slide Chương V);
// Email chỉ đọc (AC2). Lưu qua API-07. Khối tài khoản nhận tiền hoàn (nhánh 1e) qua API-226 đến API-228.
@Component({
  selector: 'app-profile',
  standalone: false,
  templateUrl: './profile.html',
  styleUrl: '../account-page.scss',
})
export class Profile {
  private readonly confirmBox = inject(ConfirmService);
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly api = inject(AccountApiService);
  private readonly toast = inject(ToastService);

  readonly genders: { value: Gender | null; label: string }[] = [
    { value: 'NU', label: 'Nữ' },
    { value: 'NAM', label: 'Nam' },
    { value: 'KHAC', label: 'Khác' },
    { value: null, label: 'Không muốn nói' },
  ];
  readonly today = new Date().toLocaleDateString('en-CA');
  readonly saving = signal(false);
  readonly email = signal('');

  readonly form = this.fb.group({
    fullName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(60)]],
    phone: ['', [Validators.required, phoneValidator]],
    birthday: [''],
    gender: [null as Gender | null],
  });

  readonly refund = signal<ISavedRefundAccount | null>(null);
  readonly refundLoading = signal(true);
  readonly refundEditing = signal(false);
  readonly refundSaving = signal(false);
  readonly refundValue = signal<RefundAccountValue | null>(null);
  readonly refundErrors = signal<Record<string, string>>({});

  constructor() {
    this.api.getRefundAccount().subscribe({
      next: (a) => {
        this.refund.set(a);
        this.refundLoading.set(false);
      },
      error: () => this.refundLoading.set(false),
    });
    this.auth.load().subscribe((u) => {
      if (!u) return;
      this.email.set(u.email || '');
      this.form.patchValue({
        fullName: u.fullName,
        phone: u.phone,
        birthday: u.birthday ? u.birthday.slice(0, 10) : '',
        gender: u.gender,
      });
    });
  }

  error(name: string): string {
    return firstError(this.form.get(name), { minlength: 'Họ tên cần 2-60 ký tự' });
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    const v = this.form.getRawValue();
    this.api.updateProfile({ ...v, phone: (v.phone || '').replace(/[\s.]/g, ''), birthday: v.birthday || null }).subscribe({
      next: (user) => {
        this.saving.set(false);
        this.auth.setUser({ ...this.auth.currentUser()!, ...user });
        this.form.markAsPristine();
        this.toast.show('Đã cập nhật thông tin cá nhân thành công');
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

  editRefund(): void {
    this.refundErrors.set({});
    this.refundValue.set(null);
    this.refundEditing.set(true);
  }

  saveRefund(): void {
    const v = this.refundValue();
    if (!v || !('refundAccount' in v)) return;
    this.refundSaving.set(true);
    this.api.saveRefundAccount(v.refundAccount).subscribe({
      next: (a) => {
        this.refundSaving.set(false);
        this.refund.set(a);
        this.refundEditing.set(false);
        this.toast.show('Đã lưu tài khoản nhận tiền hoàn');
      },
      error: (err: ApiError) => {
        this.refundSaving.set(false);
        const fields = (err.extra?.['fields'] || {}) as Record<string, string>;
        this.refundErrors.set(fields);
        if (!Object.keys(fields).length) this.toast.show(err.message, 'danger');
      },
    });
  }

  // Xóa hỏi xác nhận như xóa địa chỉ (nhánh 1c); yêu cầu hoàn đã tạo vẫn giữ tài khoản đã gửi
  deleteRefund(): void {
    this.confirmBox
      .ask({ title: 'Xóa tài khoản nhận tiền hoàn?', message: 'Lần hoàn tiền sau bạn sẽ nhập lại tài khoản. Yêu cầu hoàn tiền đang xử lý không bị ảnh hưởng.', okText: 'Xóa tài khoản', danger: true })
      .then((ok) => {
        if (ok) this.doDeleteRefund();
      });
  }

  private doDeleteRefund(): void {
    this.refundSaving.set(true);
    this.api.deleteRefundAccount().subscribe({
      next: () => {
        this.refundSaving.set(false);
        this.refund.set(null);
        this.toast.show('Đã xóa tài khoản nhận tiền hoàn');
      },
      error: (err: ApiError) => {
        this.refundSaving.set(false);
        this.toast.show(err.message, 'danger');
      },
    });
  }
}
