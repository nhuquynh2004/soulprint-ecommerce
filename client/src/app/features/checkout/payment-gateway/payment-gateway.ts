import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { timer } from 'rxjs';
import { CheckoutApiService } from '../../../services/checkout-apiservice';
import { CartService } from '../../../services/cart';
import { ToastService } from '../../../services/toast';
import { ApiError } from '../../../classes/api-error';
import { IPaymentView, formatCountdown, demoQrCells } from '../../../classes/checkout';

// SCR-08 Cổng thanh toán giả lập (UC-PAY-04 nhánh 5b). Trang đóng vai trang của cổng thanh toán: không có
// header/footer cửa hàng, ghi rõ môi trường thử nghiệm. Khách chọn 1 kết quả để mô phỏng (API-40); đơn chỉ được tạo
// khi thanh toán thành công. Đồng hồ đếm ngược theo giờ server; hết giờ thì đọc lại giao dịch (server chuyển FAILED).
@Component({
  selector: 'app-payment-gateway',
  standalone: false,
  templateUrl: './payment-gateway.html',
  styleUrl: './payment-gateway.scss',
})
export class PaymentGateway {
  private readonly api = inject(CheckoutApiService);
  private readonly cartService = inject(CartService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly payment = signal<IPaymentView | null>(null);
  readonly error = signal('');
  readonly busy = signal<'' | 'success' | 'fail' | 'cancel' | 'retry'>('');
  readonly secondsLeft = signal(0);
  private clockOffset = 0; // giờ server - giờ máy khách

  readonly expired = computed(() => !!this.payment()?.expired);
  readonly clock = computed(() => formatCountdown(this.secondsLeft()));

  // Mã QR minh họa sinh từ mã giao dịch (dùng chung với app-pay-qr)
  readonly qrCells = computed(() => demoQrCells(this.payment()?.code || 'SOULPRINT'));

  constructor() {
    // "Tạo phiên thanh toán mới" đổi :id trên cùng trang nên theo dõi paramMap
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((p) => this.load(p.get('id') || ''));
    timer(1000, 1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.tick());
  }

  private load(id: string): void {
    this.payment.set(null);
    this.error.set('');
    this.busy.set('');
    this.api.getPayment(id).subscribe({
      next: (p) => this.show(p),
      error: (err: ApiError) => this.error.set(err.status === 404 ? 'Không tìm thấy giao dịch hoặc giao dịch không thuộc phiên của bạn.' : err.message),
    });
  }

  private show(p: IPaymentView): void {
    // Giao dịch đã xử lý (mở lại trang cũ): chuyển tới trang kết quả tương ứng
    // Trả thêm khi đổi đơn, nhận lại hàng: trang kết quả theo loại giao dịch, không phải "Đặt hàng thành công"
    if (p.status === 'SUCCESS' && p.orderCode) {
      if (p.purpose === 'ORDER') this.router.navigate(['/dat-hang', p.orderCode, 'ket-qua'], { replaceUrl: true });
      else this.router.navigate(['/thanh-toan/giao-dich', p._id], { replaceUrl: true });
      return;
    }
    if (p.status === 'REFUNDED' || (p.status === 'FAILED' && !p.expired)) {
      this.router.navigate(['/thanh-toan/giao-dich', p._id], { replaceUrl: true });
      return;
    }
    this.clockOffset = Date.parse(p.serverTime) - Date.now();
    this.payment.set(p);
    this.tick();
  }

  private tick(): void {
    const p = this.payment();
    if (!p || p.expired) return;
    const left = Math.round((Date.parse(p.expiresAt) - (Date.now() + this.clockOffset)) / 1000);
    this.secondsLeft.set(left);
    // Hết giờ: đọc lại để server ghi nhận hết hạn (API-39 chuyển FAILED, expired = true)
    if (left <= 0 && !this.busy()) this.load(p._id);
  }

  // API-40. Thành công/thất bại hiện "Đang xác nhận giao dịch..." như cổng thật trước khi chuyển trang
  simulate(result: 'success' | 'fail' | 'cancel'): void {
    const p = this.payment();
    if (!p || this.busy()) return;
    this.busy.set(result);
    const send = () =>
      this.api.simulatePayment(p._id, result).subscribe({
        next: (r) => {
          if (r.status === 'SUCCESS') this.cartService.refresh().subscribe({ error: () => {} });
          if (result === 'cancel') this.toast.show('Bạn đã hủy thanh toán. Thông tin đặt hàng vẫn được giữ nguyên');
          this.router.navigateByUrl(r.redirectUrl, { state: { activation: r.activation ?? null } });
        },
        error: (err: ApiError) => {
          this.busy.set('');
          // Hết hạn hoặc đã xử lý ở tab khác: đọc lại giao dịch
          if (err.code === 'EXPIRED' || err.code === 'ALREADY_PROCESSED') this.load(p._id);
          else this.toast.show(err.message, 'danger');
        },
      });
    if (result === 'cancel') send();
    else timer(900).subscribe(send);
  }

  // API-191: hết hạn thì tạo phiên mới từ thông tin đã lưu
  retry(): void {
    const p = this.payment();
    if (!p || this.busy()) return;
    this.busy.set('retry');
    this.api.retryPayment(p._id).subscribe({
      next: (r) => this.router.navigateByUrl(r.paymentUrl, { replaceUrl: true }),
      error: (err: ApiError) => {
        this.busy.set('');
        this.toast.show(err.message, 'danger');
        // Giỏ, giá, voucher đã đổi: về giỏ hoặc trang thanh toán để kiểm tra lại (6Ea)
        if (err.code === 'OUT_OF_STOCK' || err.code === 'NO_ITEM_SELECTED' || err.code === 'GIFT_WRAP_UNAVAILABLE') this.router.navigate(['/gio-hang']);
        else if (err.status === 409 || err.status === 422) this.router.navigate(['/thanh-toan'], { queryParams: { gd: p._id } });
      },
    });
  }
}
