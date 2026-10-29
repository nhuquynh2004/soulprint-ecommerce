import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { AdminOrderApiService } from '../../../services/admin-order-apiservice';
import { AuthService } from '../../../services/auth';
import { ToastService } from '../../../services/toast';
import { ApiError } from '../../../classes/api-error';
import { CUSTOMER_STATUS_LABEL, ICustomerDetail } from '../../../classes/admin-order';
import { RowMenuItem } from '../shared/row-menu/row-menu';

// SCR-58 hồ sơ khách (UC-OPS-08 bước 3-5, 4a-4d): liên hệ (sao chép), sổ địa chỉ chỉ đọc, đơn hàng, yêu cầu hậu mãi,
// đánh giá, hội thoại, voucher được cấp, trạng thái khóa; menu "..." Khóa/Mở khóa tài khoản, Mở khóa đăng nhập,
// Mở khóa tra cứu, Gửi lại liên kết kích hoạt; "Tạo đơn nháp cho khách". Không sửa thông tin cá nhân của khách.
@Component({
  selector: 'app-customer-detail',
  standalone: false,
  templateUrl: './customer-detail.html',
  styleUrl: './customer-list.scss',
})
export class CustomerDetail {
  private readonly api = inject(AdminOrderApiService);
  protected readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly statusLabel = CUSTOMER_STATUS_LABEL;
  readonly c = signal<ICustomerDetail | null>(null);
  readonly loading = signal(true);
  readonly errMessage = signal('');
  readonly busy = signal(false);
  readonly lockDialog = signal(false);
  readonly lockReason = signal('');
  readonly devLink = signal<string | null>(null);

  readonly menu = computed<RowMenuItem[]>(() => {
    const c = this.c();
    if (!c) return [];
    const m: RowMenuItem[] = [];
    if (this.auth.can('KHACH_HANG.KHOA_TAI_KHOAN')) {
      m.push(c.status === 'BI_KHOA' ? { key: 'unlock', label: 'Mở khóa tài khoản', icon: 'lock' } : { key: 'lock', label: 'Khóa tài khoản', icon: 'lock', danger: true });
    }
    if (this.auth.can('KHACH_HANG.SUA')) {
      if (c.loginLocked) m.push({ key: 'unlockLogin', label: 'Mở khóa đăng nhập', icon: 'key' });
      if (c.lookupLocked) m.push({ key: 'unlockLookup', label: 'Mở khóa tra cứu', icon: 'search' });
      if (c.status === 'CHO_KICH_HOAT') m.push({ key: 'activation', label: 'Gửi lại liên kết kích hoạt', icon: 'send' });
    }
    return m;
  });

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((p) => this.load(p.get('id')!));
  }

  load(id = this.c()?._id || ''): void {
    this.api.getCustomer(id).subscribe({
      next: (c) => {
        this.c.set(c);
        this.loading.set(false);
      },
      error: (err: ApiError) => {
        this.errMessage.set(err.status === 404 ? 'Không tìm thấy khách hàng' : err.message);
        this.loading.set(false);
      },
    });
  }

  initials(name: string): string {
    return name.trim().split(/\s+/).slice(-2).map((w) => w[0]).join('').toUpperCase();
  }

  copy(text: string | null, label: string): void {
    if (text) navigator.clipboard?.writeText(text).then(() => this.toast.show(`Đã sao chép ${label}`));
  }

  onMenu(key: string): void {
    const c = this.c()!;
    if (key === 'lock') {
      this.lockReason.set('');
      this.lockDialog.set(true);
    } else if (key === 'unlock') this.update({ status: 'HOAT_DONG' }, 'Đã mở khóa tài khoản');
    else if (key === 'unlockLogin') this.update({ unlockLogin: true }, 'Đã mở khóa đăng nhập, khách đăng nhập được ngay');
    else if (key === 'unlockLookup') this.update({ unlockLookup: true }, 'Đã mở khóa tra cứu đơn bằng số điện thoại');
    else if (key === 'activation') {
      this.api.resendActivation(c._id).subscribe({
        next: (r) => {
          this.devLink.set(r.devLink);
          this.toast.show('Đã gửi lại liên kết kích hoạt (hạn 24 giờ)');
        },
        error: (err: ApiError) => this.toast.show(err.message, 'danger'),
      });
    }
  }

  doLock(): void {
    this.update({ status: 'BI_KHOA', reason: this.lockReason().trim() }, 'Đã khóa tài khoản và đăng xuất khách khỏi mọi thiết bị');
  }

  private update(body: Record<string, unknown>, ok: string): void {
    this.busy.set(true);
    this.api.updateCustomer(this.c()!._id, body).subscribe({
      next: (c) => {
        this.busy.set(false);
        this.lockDialog.set(false);
        this.c.set(c);
        this.toast.show(ok);
      },
      error: (err: ApiError) => {
        this.busy.set(false);
        this.toast.show(err.message, 'danger');
      },
    });
  }

  requestLabel(kind: string): string {
    return kind === 'DOI_TRA' ? 'Đổi trả' : 'Bảo hành';
  }
}
