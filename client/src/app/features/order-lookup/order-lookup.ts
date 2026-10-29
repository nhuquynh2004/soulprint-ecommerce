import { Component, DestroyRef, ElementRef, QueryList, ViewChildren, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { timer } from 'rxjs';
import { OrderApiService } from '../../services/order-apiservice';
import { AuthService } from '../../services/auth';
import { ToastService } from '../../services/toast';
import { ApiError } from '../../classes/api-error';
import { ILookupList, IOrderDetail, ORDER_STATUS_LABEL } from '../../classes/order';
import { formatCountdown } from '../../classes/checkout';

// SCR-24 Tra cứu đơn hàng (UC-TRK-01, UC-ACC-04 1b). Nghiệp vụ theo BA: 1 ô SĐT hoặc Mã đơn, OTP gửi về SĐT,
// danh sách mọi đơn của SĐT; không cho biết có đơn hay không trước khi OTP đúng. Bố cục 3 bước, ô OTP 6 số, đồng hồ
// "Gửi lại mã sau" theo thiết kế. Phiên xác thực 30 phút lưu ở server (session.lookup - Chương VIII).
@Component({
  selector: 'app-order-lookup',
  standalone: false,
  templateUrl: './order-lookup.html',
  styleUrl: './order-lookup.scss',
})
export class OrderLookup {
  private readonly api = inject(OrderApiService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly step = signal<1 | 2 | 3>(1);
  target = '';
  readonly targetError = signal('');
  readonly sending = signal(false);
  readonly masked = signal('');
  readonly devCode = signal('');
  readonly resendIn = signal(0);
  readonly digits = signal<string[]>(['', '', '', '', '', '']);
  readonly otpError = signal('');
  readonly locked = signal(false);
  readonly expired = signal(false);
  readonly verifying = signal(false);

  readonly list = signal<ILookupList | null>(null);
  readonly detail = signal<IOrderDetail | null>(null);
  readonly activationSent = signal<{ maskedPhone: string; devLink?: string | null } | null>(null);
  readonly statusLabel = ORDER_STATUS_LABEL;
  readonly countdown = formatCountdown;

  @ViewChildren('otpBox') otpBoxes!: QueryList<ElementRef<HTMLInputElement>>;

  constructor() {
    // 2a: khách đã đăng nhập thì chuyển thẳng tới Đơn hàng của tôi
    effect(() => {
      const u = this.auth.currentUser();
      untracked(() => {
        if (u?.role === 'member') this.router.navigate(['/tai-khoan/don-hang'], { replaceUrl: true });
      });
    });
    // Phiên tra cứu còn hạn (VD tải lại trang ở bước 3) thì hiện luôn danh sách
    this.api.lookupOrders().subscribe({ next: (l) => this.showList(l), error: () => {} });
    timer(1000, 1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.resendIn.update((s) => Math.max(0, s - 1)));
  }

  // Bước 1 -> 2: API-55
  send(): void {
    const t = this.target.replace(/[\s.]/g, '').toUpperCase();
    if (!/^0\d{9}$/.test(t) && !/^SP\d{10}$/.test(t)) {
      this.targetError.set('Nhập số điện thoại (10 số) hoặc mã đơn dạng SP2610150001');
      return;
    }
    this.targetError.set('');
    this.sending.set(true);
    this.api.lookupOtp(t).subscribe({
      next: (r) => {
        this.sending.set(false);
        this.target = t;
        this.masked.set(r.maskedPhone);
        this.devCode.set(r.devCode || '');
        this.resendIn.set(r.resendAfter);
        this.resetOtp();
        this.step.set(2);
      },
      error: (err: ApiError) => {
        this.sending.set(false);
        if (err.status === 429 && this.step() === 2) {
          this.resendIn.set(err.extra['retryAfter'] || 60);
          return;
        }
        if (err.status === 423) {
          this.locked.set(true);
          if (this.step() === 1) this.targetError.set(err.message);
          else this.otpError.set(err.message);
          return;
        }
        this.targetError.set(err.message);
      },
    });
  }

  private resetOtp(): void {
    this.digits.set(['', '', '', '', '', '']);
    this.otpError.set('');
    this.expired.set(false);
    this.locked.set(false);
    setTimeout(() => this.otpBoxes?.first?.nativeElement.focus());
  }

  backToStep1(): void {
    this.step.set(1);
    this.otpError.set('');
  }

  // Ô OTP 6 số: gõ tự sang ô sau, xóa lùi về ô trước, dán cả 6 số
  onDigit(i: number, ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const val = input.value.replace(/\D/g, '');
    const d = [...this.digits()];
    if (val.length > 1) {
      val.slice(0, 6 - i).split('').forEach((c, k) => (d[i + k] = c));
      this.digits.set(d);
      const next = Math.min(5, i + val.length);
      this.otpBoxes.get(next)?.nativeElement.focus();
    } else {
      d[i] = val;
      this.digits.set(d);
      input.value = val;
      if (val && i < 5) this.otpBoxes.get(i + 1)?.nativeElement.focus();
    }
    if (this.digits().every((x) => x)) this.verify();
  }

  onKey(i: number, ev: KeyboardEvent): void {
    if (ev.key === 'Backspace' && !this.digits()[i] && i > 0) this.otpBoxes.get(i - 1)?.nativeElement.focus();
  }

  // Bước 2 -> 3: API-56 rồi API-57
  verify(): void {
    const otp = this.digits().join('');
    if (otp.length !== 6 || this.verifying() || this.locked()) return;
    this.verifying.set(true);
    this.otpError.set('');
    this.api.lookupVerify(this.target, otp).subscribe({
      next: () => {
        this.api.lookupOrders().subscribe({
          next: (l) => {
            this.verifying.set(false);
            this.showList(l);
          },
          error: (err: ApiError) => {
            this.verifying.set(false);
            this.otpError.set(err.message);
          },
        });
      },
      error: (err: ApiError) => {
        this.verifying.set(false);
        this.digits.set(['', '', '', '', '', '']);
        setTimeout(() => this.otpBoxes?.first?.nativeElement.focus());
        if (err.status === 423) this.locked.set(true);
        if (err.status === 410) this.expired.set(true);
        this.otpError.set(err.message);
      },
    });
  }

  private showList(l: ILookupList): void {
    this.list.set(l);
    this.detail.set(null);
    this.step.set(3);
  }

  // Xem chi tiết 1 đơn ở chế độ chỉ xem (API-43 qua phiên tra cứu, thông tin đã che)
  openOrder(code: string): void {
    this.api.getOrder(code).subscribe({
      next: (o) => {
        this.detail.set(o);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
      error: (err: ApiError) => {
        // Phiên tra cứu hết 30 phút: xác minh lại
        if (err.status === 404) this.restart('Phiên tra cứu đã hết hạn, vui lòng xác minh lại');
        else this.toast.show(err.message, 'danger');
      },
    });
  }

  restart(message = ''): void {
    this.list.set(null);
    this.detail.set(null);
    this.activationSent.set(null);
    this.target = '';
    this.step.set(1);
    if (message) this.toast.show(message, 'danger');
  }

  // API-58 Gửi lại liên kết kích hoạt (7a, UC-ACC-04 1b)
  resendActivation(): void {
    this.api.resendActivation().subscribe({
      next: (r) => this.activationSent.set({ maskedPhone: r.maskedPhone, devLink: r.devLink }),
      error: (err: ApiError) => {
        if (err.status === 401) this.restart('Phiên tra cứu đã hết hạn, vui lòng xác minh lại');
        else this.toast.show(err.message, 'danger');
      },
    });
  }
}
