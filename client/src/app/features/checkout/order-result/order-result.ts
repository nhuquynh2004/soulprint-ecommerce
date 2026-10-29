import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CheckoutApiService } from '../../../services/checkout-apiservice';
import { ProductApiService } from '../../../services/product-apiservice';
import { AuthService } from '../../../services/auth';
import { IActivation, IOrderSummary, IPaymentView } from '../../../classes/checkout';
import { ApiError } from '../../../classes/api-error';
import { ToastService } from '../../../services/toast';
import { IProduct } from '../../../classes/product';

const DAY_NAMES = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
const fmt = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;

// SCR-09 Kết quả đặt hàng (UC-PAY-01 bước 7, UC-PAY-04 bước 7). Đọc đơn bằng API-43 (phiên vừa đặt được xem).
// Guest có tài khoản chờ kích hoạt: lời mời "Kích hoạt tài khoản để theo dõi đơn dễ hơn" kèm "Để sau".
// Route /thanh-toan/giao-dich/:id (S6): thanh toán online không thành công hoặc đã hoàn tiền, đọc giao dịch
// bằng API-39; chưa có đơn nên hiện mã giao dịch, "Thử lại" (API-191) và "Đổi phương thức thanh toán" (SCR-07 điền sẵn).
@Component({
  selector: 'app-order-result',
  standalone: false,
  templateUrl: './order-result.html',
  styleUrl: './order-result.scss',
})
export class OrderResult {
  private readonly api = inject(CheckoutApiService);
  private readonly products = inject(ProductApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  readonly order = signal<IOrderSummary | null>(null);
  readonly error = signal('');
  readonly related = signal<IProduct[]>([]);
  readonly showInvite = signal(true);
  readonly payment = signal<IPaymentView | null>(null);
  readonly retrying = signal(false);
  // Kết quả API-38 / API-40 truyền qua navigation state (không lưu lại khi tải lại trang)
  readonly activation = (this.router.getCurrentNavigation()?.extras.state?.['activation'] ?? history.state?.activation ?? null) as IActivation;

  readonly eta = computed(() => {
    const o = this.order();
    if (!o) return '';
    // Ngày khách chọn hoặc ngày sớm nhất server lưu vào đơn lúc đặt (cùng nguồn với SCR-19)
    const ymd = o.shippingAddress.deliveryDate || o.expectedDeliveryDate;
    if (ymd) {
      const d = new Date(ymd + 'T00:00:00');
      return `${DAY_NAMES[d.getDay()]} ${fmt(d)}/${d.getFullYear()}${o.shippingAddress.deliveryWindow ? ' | ' + o.shippingAddress.deliveryWindow : ''}`;
    }
    // Đơn cũ chưa lưu ngày dự kiến: +3 đến +5 ngày
    const from = new Date(o.createdAt);
    from.setDate(from.getDate() + 3);
    const to = new Date(o.createdAt);
    to.setDate(to.getDate() + 5);
    return `${DAY_NAMES[from.getDay()]} ${fmt(from)} - ${DAY_NAMES[to.getDay()]} ${fmt(to)}/${to.getFullYear()}`;
  });

  constructor() {
    const paymentId = this.route.snapshot.paramMap.get('id');
    if (paymentId) {
      this.loadPayment(paymentId);
      return;
    }
    const code = this.route.snapshot.paramMap.get('code') || '';
    this.api.getOrder(code).subscribe({
      next: (o) => this.order.set(o),
      error: () => this.error.set('Không tìm thấy đơn hàng hoặc phiên xem đơn đã hết hạn.'),
    });
    this.products.getProducts({ pageSize: 4 }).subscribe({
      next: (p) => this.related.set(p.items),
      error: () => {},
    });
  }

  private loadPayment(id: string): void {
    this.api.getPayment(id).subscribe({
      next: (p) => {
        // Đã thanh toán thì xem đơn; còn đang chờ thì về cổng
        if (p.status === 'SUCCESS' && p.orderCode && p.purpose === 'ORDER') this.router.navigate(['/dat-hang', p.orderCode, 'ket-qua'], { replaceUrl: true });
        else if (p.status === 'PENDING') this.router.navigate(['/cong-thanh-toan', p._id], { replaceUrl: true });
        else this.payment.set(p);
      },
      error: () => this.error.set('Không tìm thấy giao dịch hoặc phiên thanh toán đã kết thúc.'),
    });
  }

  // API-191 "Thử lại": giao dịch mới từ thông tin đã lưu, khách không phải nhập lại
  retry(): void {
    const p = this.payment();
    if (!p || this.retrying()) return;
    this.retrying.set(true);
    this.api.retryPayment(p._id).subscribe({
      next: (r) => this.router.navigateByUrl(r.paymentUrl),
      error: (err: ApiError) => {
        this.retrying.set(false);
        this.toast.show(err.message, 'danger');
        if (err.code === 'OUT_OF_STOCK' || err.code === 'NO_ITEM_SELECTED' || err.code === 'GIFT_WRAP_UNAVAILABLE') this.router.navigate(['/gio-hang']);
        else if (p.purpose === 'ORDER_CHANGE' || p.draftCode) this.loadPayment(p._id); // hết hạn hoặc nhân viên vừa hủy: hiện lại trạng thái
        else if (err.status === 409 || err.status === 422) this.router.navigate(['/thanh-toan'], { queryParams: { gd: p._id } });
      },
    });
  }

  // Xem đơn sau khi trả thêm: thành viên vào chi tiết đơn, khách mở liên kết chưa đăng nhập thì tra cứu đơn
  orderLink(code: string | null): unknown[] {
    return this.auth.currentUser()?.role === 'member' ? ['/tai-khoan/don-hang', code] : ['/tra-cuu-don'];
  }

  activate(): void {
    const link = this.activation?.devLink;
    if (link) this.router.navigateByUrl(link);
  }
}
