import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, debounceTime } from 'rxjs';
import { AdminOrderApiService } from '../../../services/admin-order-apiservice';
import { AuthService } from '../../../services/auth';
import { ToastService } from '../../../services/toast';
import { ApiError } from '../../../classes/api-error';
import { CUSTOMER_STATUS_LABEL, ICustomerRow, IReviewRow } from '../../../classes/admin-order';
import { Selection } from '../shared/selection';
import { BulkAction } from '../shared/bulk-bar/bulk-bar';

const HIDE_REASONS = ['Quảng cáo, spam', 'Chứa thông tin cá nhân', 'Ngôn từ không phù hợp', 'Không liên quan sản phẩm'];

// SCR-58 Khách hàng (UC-OPS-08): tab "Danh sách khách" (API-98 có số đơn, tổng chi tiêu, đơn gần nhất - aggregation)
// và tab "Đánh giá" (API-141, ẩn/hiện hàng loạt API-142, ẩn bắt buộc lý do - 1aEa). Tab đọc từ route data.
@Component({
  selector: 'app-customer-list',
  standalone: false,
  templateUrl: './customer-list.html',
  styleUrl: './customer-list.scss',
})
export class CustomerList {
  private readonly api = inject(AdminOrderApiService);
  protected readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly statusLabel = CUSTOMER_STATUS_LABEL;
  readonly hideReasons = HIDE_REASONS;
  readonly tab = signal<'customers' | 'reviews'>('customers');

  readonly q = signal('');
  readonly status = signal('');
  readonly hasOrders = signal('');
  readonly sort = signal('moi-nhat');
  readonly page = signal(1);
  private readonly search$ = new Subject<string>();

  readonly customers = signal<ICustomerRow[]>([]);
  readonly total = signal(0);
  readonly pageSize = signal(20);
  readonly allCount = signal(0);
  readonly newThisMonth = signal(0);

  readonly reviews = signal<IReviewRow[]>([]);
  readonly reviewCounts = signal({ all: 0, shown: 0, hidden: 0 });
  readonly hidden = signal('');
  readonly rating = signal('');
  readonly replied = signal('');
  // UC-OPS-08 1b: hộp thoại trả lời đánh giá, xóa trả lời có hỏi xác nhận
  readonly replyDialog = signal<IReviewRow | null>(null);
  readonly replyText = signal('');
  readonly replyDeleteAsk = signal(false);
  readonly sel = new Selection();
  readonly hideDialog = signal<IReviewRow[] | null>(null);
  readonly hideReason = signal('');
  readonly busy = signal(false);

  readonly loading = signal(true);
  readonly errMessage = signal('');

  readonly reviewIds = computed(() => this.reviews().map((r) => r._id));
  readonly reviewActions = computed<BulkAction[]>(() =>
    this.auth.can('KHACH_HANG.AN_DANH_GIA') ? [{ key: 'HIDE', label: 'Ẩn', icon: 'eye-off', danger: true }, { key: 'SHOW', label: 'Hiện lại', icon: 'eye' }] : [],
  );

  constructor() {
    this.search$.pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef)).subscribe((v) => {
      this.q.set(v);
      this.page.set(1);
      this.load();
    });
    this.route.data.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((d) => {
      this.tab.set(d['tab'] === 'reviews' ? 'reviews' : 'customers');
      this.q.set('');
      this.page.set(1);
      this.sel.clear();
      this.load();
    });
  }

  load(): void {
    this.errMessage.set('');
    if (this.tab() === 'customers') {
      this.api.getCustomers({ q: this.q(), status: this.status(), hasOrders: this.hasOrders(), sort: this.sort(), page: this.page() }).subscribe({
        next: (d) => {
          this.customers.set(d.items);
          this.total.set(d.total);
          this.pageSize.set(d.pageSize);
          this.allCount.set(d.allCount);
          this.newThisMonth.set(d.newThisMonth);
          this.loading.set(false);
        },
        error: (err: ApiError) => this.fail(err),
      });
    } else {
      this.api.getReviews({ q: this.q(), hidden: this.hidden(), rating: this.rating(), replied: this.replied(), page: this.page() }).subscribe({
        next: (d) => {
          this.reviews.set(d.items);
          this.total.set(d.total);
          this.pageSize.set(d.pageSize);
          this.reviewCounts.set(d.counts);
          this.loading.set(false);
        },
        error: (err: ApiError) => this.fail(err),
      });
    }
  }

  private fail(err: ApiError): void {
    this.errMessage.set(err.message);
    this.loading.set(false);
  }

  onSearch(v: string): void {
    this.search$.next(v.trim());
  }

  setFilter(sig: { set: (v: string) => void }, v: string): void {
    sig.set(v);
    this.page.set(1);
    this.sel.clear();
    this.load();
  }

  goPage(p: number): void {
    this.page.set(p);
    this.load();
  }

  open(c: ICustomerRow): void {
    this.router.navigate(['/quan-tri/khach-hang', c._id]);
  }

  statusClass(c: ICustomerRow): string {
    if (c.status === 'HOAT_DONG' && c.lookupLocked) return 'TAM_NGUNG';
    return c.status;
  }

  statusText(c: ICustomerRow): string {
    if (c.status === 'HOAT_DONG' && c.loginLocked) return 'Khóa đăng nhập tạm';
    if (c.status === 'HOAT_DONG' && c.lookupLocked) return 'Khóa tra cứu';
    return this.statusLabel[c.status] || c.status;
  }

  initials(name: string): string {
    return name.trim().split(/\s+/).slice(-2).map((w) => w[0]).join('').toUpperCase();
  }

  stars(n: number): number[] {
    return [1, 2, 3, 4, 5].map((i) => (i <= n ? 1 : 0));
  }

  // ===== Đánh giá =====

  onBulk(key: string): void {
    const list = this.reviews().filter((r) => this.sel.has(r._id));
    if (key === 'HIDE') this.openHide(list);
    else this.setVisibility(list.map((r) => r._id), false);
  }

  openHide(list: IReviewRow[]): void {
    this.hideReason.set('');
    this.hideDialog.set(list);
  }

  doHide(): void {
    const list = this.hideDialog()!;
    this.setVisibility(list.map((r) => r._id), true, this.hideReason().trim());
  }

  openReply(r: IReviewRow): void {
    this.replyText.set(r.reply?.text || '');
    this.replyDeleteAsk.set(false);
    this.replyDialog.set(r);
  }

  // text rỗng là xóa trả lời (API-233)
  sendReply(text: string): void {
    const r = this.replyDialog()!;
    this.busy.set(true);
    this.api.replyReview(r._id, text).subscribe({
      next: () => {
        this.busy.set(false);
        this.replyDialog.set(null);
        this.replyDeleteAsk.set(false);
        this.toast.show(text ? (r.reply ? 'Đã cập nhật trả lời' : 'Đã gửi trả lời, khách được thông báo') : 'Đã xóa trả lời');
        this.load();
      },
      error: (err: ApiError) => {
        this.busy.set(false);
        this.toast.show(err.message, 'danger');
      },
    });
  }

  setVisibility(ids: string[], isHidden: boolean, reason = ''): void {
    this.busy.set(true);
    this.api.setReviewVisibility(ids, isHidden, reason).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.hideDialog.set(null);
        this.sel.clear();
        this.toast.show(isHidden ? `Đã ẩn ${r.updated} đánh giá, điểm trung bình sản phẩm đã tính lại` : `Đã hiện lại ${r.updated} đánh giá`);
        this.load();
      },
      error: (err: ApiError) => {
        this.busy.set(false);
        this.toast.show(err.message, 'danger');
      },
    });
  }
}
