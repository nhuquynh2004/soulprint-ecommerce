import { Component, DestroyRef, inject, signal } from '@angular/core';
import { onTabVisible } from '../../../../services/order-sync';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { OrderApiService } from '../../../../services/order-apiservice';
import { CartService } from '../../../../services/cart';
import { ToastService } from '../../../../services/toast';
import { ApiError } from '../../../../classes/api-error';
import { IOrderCard, IOrderList, ORDER_RANGES, ORDER_STATUS_LABEL, ORDER_TABS, OrderRange, OrderTab } from '../../../../classes/order';

// SCR-18 Đơn hàng của tôi (UC-TRK-02, CNL-01). Tab và khoảng thời gian nằm trên URL (?tab=&range= - Chương IV)
// nên quay lại trang vẫn đúng tab. Nút trên thẻ đơn lấy từ `actions` server tính.
@Component({
  selector: 'app-my-orders',
  standalone: false,
  templateUrl: './my-orders.html',
  styleUrl: './my-orders.scss',
})
export class MyOrders {
  private readonly api = inject(OrderApiService);
  private readonly cartService = inject(CartService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly tabs = ORDER_TABS;
  readonly ranges = ORDER_RANGES;
  readonly tab = signal<OrderTab>('tat-ca');
  readonly range = signal<OrderRange>('3m');
  readonly data = signal<IOrderList | null>(null);
  readonly error = signal('');
  readonly cancelCode = signal('');
  readonly busyCode = signal('');
  // Hộp thoại đánh giá mở từ thẻ đơn (SCR-27 trên SCR-18)
  readonly reviewCode = signal('');

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((q) => {
      const tab = (q.get('tab') as OrderTab) || 'tat-ca';
      const range = (q.get('range') as OrderRange) || '3m';
      this.tab.set(this.tabs.some((t) => t.key === tab) ? tab : 'tat-ca');
      this.range.set(this.ranges.some((r) => r.key === range) ? range : '3m');
      this.load();
    });
    // Quay lại tab thì làm mới danh sách; đang xem thêm nhiều trang thì giữ nguyên để không mất chỗ đang đọc
    onTabVisible(this.destroyRef, () => {
      if ((this.data()?.page ?? 1) === 1 && !this.cancelCode() && !this.reviewCode()) this.load();
    });
  }

  load(page = 1): void {
    this.error.set('');
    if (page === 1) this.data.set(null);
    this.api.getOrders(this.tab(), this.range(), page).subscribe({
      next: (d) => {
        const prev = this.data();
        // "Xem thêm": nối trang sau vào danh sách đang có
        this.data.set(page > 1 && prev ? { ...d, items: [...prev.items, ...d.items], requests: [...(prev.requests || []), ...(d.requests || [])], urgentRequests: prev.urgentRequests } : d);
      },
      error: (err: ApiError) => this.error.set(err.status === 0 ? err.message : 'Không tải được đơn hàng. Thử lại'),
    });
  }

  go(tab: OrderTab, range = this.range()): void {
    this.router.navigate([], { relativeTo: this.route, queryParams: { tab: tab === 'tat-ca' ? null : tab, range: range === '3m' ? null : range }, queryParamsHandling: 'merge' });
  }

  rangeLabel(): string {
    return this.ranges.find((r) => r.key === this.range())?.label.toLowerCase() || '';
  }

  // Nhãn trạng thái trên thẻ: "Cần bạn xử lý" ưu tiên hơn trạng thái đơn
  badge(o: IOrderCard): { key: string; label: string } {
    if (o.needAction) return { key: 'CAN_XU_LY', label: 'Cần bạn xử lý' };
    return { key: o.orderStatus, label: ORDER_STATUS_LABEL[o.orderStatus] };
  }

  // Dòng nhỏ dưới tổng tiền theo trục thanh toán (thiết kế SCR-18)
  moneyNote(o: IOrderCard): string {
    const vnd = (n: number) => n.toLocaleString('vi-VN') + 'đ';
    if (o.refund?.status === 'DA_HOAN') return `Đã hoàn ${vnd(o.refund.amount)}`;
    if (o.refund?.status === 'CHO_XU_LY') return `Đang hoàn ${vnd(o.refund.amount)}`;
    if (o.orderStatus === 'DA_HUY') return o.paidAmount > 0 ? `Đã thanh toán ${vnd(o.paidAmount)}` : 'Chưa thanh toán';
    if (o.paidAmount <= 0) return 'Thanh toán khi nhận (COD)';
    if (o.paidAmount >= o.total) return 'Đã thanh toán đủ';
    return `Đã cọc ${vnd(o.paidAmount)}, còn ${vnd(o.total - o.paidAmount)} khi nhận`;
  }

  onCancelled(code: string): void {
    this.cancelCode.set('');
    this.toast.show(`Đã hủy đơn ${code}`);
    this.load();
  }

  onReviewed(message: string): void {
    this.reviewCode.set('');
    this.toast.show(message);
    this.load();
  }

  onStale(): void {
    this.cancelCode.set('');
    this.toast.show('Đơn hàng đã được xử lý tiếp, không thể hủy', 'danger');
    this.load();
  }

  // API-46 "Mua lại" / "Đặt lại": thêm vào giỏ rồi mở giỏ (UC-CNL-03)
  reorder(o: IOrderCard): void {
    this.busyCode.set(o.code);
    this.api.reorder(o.code).subscribe({
      next: (r) => {
        this.cartService.refresh().subscribe({ error: () => {} });
        if (r.skipped.length) this.toast.show('Một số sản phẩm không còn khả dụng: ' + r.skipped.join(', '), 'danger');
        this.router.navigate(['/gio-hang']);
      },
      error: (err: ApiError) => {
        this.busyCode.set('');
        this.toast.show(err.extra['skipped']?.length ? `${err.message}: ${err.extra['skipped'].join(', ')}` : err.message, 'danger');
      },
    });
  }

  // UC-CNL-02 3b: sửa đơn thay vì hủy - mở chi tiết đơn với hộp thoại sửa tương ứng
  editInstead(code: string, kind: 'shipping' | 'personalization'): void {
    this.cancelCode.set('');
    this.router.navigate(['/tai-khoan/don-hang', code], { queryParams: { sua: kind } });
  }
}
