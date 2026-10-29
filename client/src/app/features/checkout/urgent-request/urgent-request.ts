import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { interval } from 'rxjs';
import { UrgentApiService } from '../../../services/urgent-apiservice';
import { ChatService } from '../../../services/chat';
import { CartService } from '../../../services/cart';
import { ToastService } from '../../../services/toast';
import { AuthService } from '../../../services/auth';
import { ApiError } from '../../../classes/api-error';
import { IPaymentOption } from '../../../classes/checkout';
import { IUrgentView, URGENT_STEPS } from '../../../classes/urgent';

const DAY_NAMES = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];

// Trang yêu cầu đặt gấp /dat-gap/:code. Khách theo dõi yêu cầu: shop xem xét -> shop chốt (thông tin khóa,
// có phụ phí giao gấp) -> khách chọn cách thanh toán và bấm "Đặt hàng" (COD), "Đặt hàng và cọc" hoặc "Đặt hàng và thanh toán" như SCR-07. Muốn đổi gì thì nhắn shop
// trong khung chat (gắn sẵn hội thoại của yêu cầu), khách không tự sửa. Hỏi lại mỗi 8 giây khi yêu cầu còn mở.
@Component({
  selector: 'app-urgent-request',
  standalone: false,
  templateUrl: './urgent-request.html',
  // Dùng lại style tóm tắt đơn, chính sách của SCR-07
  styleUrls: ['../checkout-page.scss', './urgent-request.scss'],
})
export class UrgentRequest {
  private readonly api = inject(UrgentApiService);
  private readonly chat = inject(ChatService);
  private readonly cart = inject(CartService);
  private readonly toast = inject(ToastService);
  protected readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly steps = URGENT_STEPS;
  readonly view = signal<IUrgentView | null>(null);
  readonly error = signal('');
  readonly optionKey = signal<IPaymentOption['key'] | ''>('');
  readonly paying = signal(false);
  readonly policyError = signal(false);
  readonly formError = signal('');
  readonly cancelConfirm = signal(false);
  acceptPolicy = false;

  private code = '';
  private token = '';

  readonly option = computed(() => {
    const v = this.view();
    if (!v) return null;
    return v.paymentOptions.find((o) => o.key === this.optionKey()) || v.paymentOptions[0] || null;
  });
  readonly stepIndex = computed(() => {
    const s = this.view()?.status;
    return s === 'DA_DAT' ? 2 : s === 'DA_CHOT' ? 1 : 0;
  });
  readonly closed = computed(() => ['TU_CHOI', 'KHACH_HUY'].includes(this.view()?.status || ''));
  readonly open = computed(() => ['CHO_XEM_XET', 'DA_CHOT'].includes(this.view()?.status || ''));
  // Nhãn nút theo cách thanh toán như SCR-07: COD chỉ "Đặt hàng"
  readonly payLabel = computed(() => {
    const k = this.option()?.key;
    return k === 'ONLINE' ? 'Đặt hàng và thanh toán' : k === 'DEPOSIT_COD' ? 'Đặt hàng và cọc' : 'Đặt hàng';
  });
  readonly dueNow = computed(() => {
    const v = this.view();
    const o = this.option();
    if (!v?.money || !o) return 0;
    return o.amountDueNow;
  });

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((p) => {
      this.code = p.get('code') || '';
      this.token = this.route.snapshot.queryParamMap.get('t') || '';
      this.load(true);
    });
    // Shop chốt, sửa, từ chối thì trang tự cập nhật
    interval(8000)
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        if (this.open() && !this.paying()) this.load(false);
      });
  }

  load(first: boolean): void {
    this.api.get(this.code, this.token).subscribe({
      next: (v) => {
        const prev = this.view();
        this.view.set(v);
        this.error.set('');
        if (!v.paymentOptions.some((o) => o.key === this.optionKey())) this.optionKey.set(v.paymentOptions[0]?.key || '');
        if (first && v.conversationId) this.chat.attach(v.conversationId);
        if (prev && prev.status !== v.status) {
          if (v.status === 'DA_CHOT') this.toast.show('Shop đã chốt đơn gấp, bạn xem lại và thanh toán nhé');
          if (v.status === 'CHO_XEM_XET') this.toast.show('Shop đang cập nhật lại đơn gấp');
          if (v.status === 'TU_CHOI') this.toast.show('Shop chưa nhận được yêu cầu này', 'danger');
        } else if (prev && prev.version !== v.version) this.toast.show('Shop vừa cập nhật đơn gấp');
      },
      error: (e: ApiError) => {
        if (first) this.error.set(e.status === 404 ? 'Không tìm thấy yêu cầu đặt gấp hoặc liên kết đã hết quyền xem.' : e.message);
      },
    });
  }

  dayLabel(ymd: string | null | undefined): string {
    if (!ymd) return '';
    const d = new Date(ymd + 'T00:00:00Z');
    return `${DAY_NAMES[d.getUTCDay()]}, ${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
  }

  openChat(): void {
    const id = this.view()?.conversationId;
    if (id) this.chat.attach(id, true);
    else this.chat.open();
  }

  // API-203: COD tạo đơn ngay; cần trả online thì sang cổng giả lập như SCR-07
  pay(): void {
    const v = this.view();
    const o = this.option();
    if (!v || !o || v.status !== 'DA_CHOT') return;
    this.formError.set('');
    this.policyError.set(!this.acceptPolicy);
    if (!this.acceptPolicy) return;
    if (v.pendingPayment && v.pendingPayment.amount === o.amountDueNow) {
      this.router.navigateByUrl(v.pendingPayment.paymentUrl);
      return;
    }
    this.paying.set(true);
    this.api.checkout(v.code, { version: v.version, paymentChoice: o.paymentChoice, remainingMethod: o.remainingMethod || null, acceptPolicy: true, t: this.token || undefined }).subscribe({
      next: (r) => {
        if (r.paymentUrl) {
          this.router.navigateByUrl(r.paymentUrl);
          return;
        }
        this.cart.refresh().subscribe({ error: () => {} });
        this.router.navigate(['/dat-hang', r.orderCode, 'ket-qua'], { state: { activation: r.activation } });
      },
      error: (e: ApiError) => {
        this.paying.set(false);
        // Shop vừa đổi đơn, giá hoặc tồn thay đổi: tải lại để khách xem bản mới
        if (['URGENT_CHANGED', 'URGENT_REOPENED', 'URGENT_NOT_CONFIRMED', 'URGENT_DONE'].includes(e.code)) {
          this.toast.show(e.message, 'danger');
          this.load(false);
          return;
        }
        this.formError.set(e.message);
      },
    });
  }

  cancel(): void {
    const v = this.view();
    if (!v) return;
    this.cancelConfirm.set(false);
    this.api.cancel(v.code, this.token).subscribe({
      next: (fresh) => {
        this.view.set(fresh);
        this.toast.show('Đã hủy yêu cầu đặt gấp');
      },
      error: (e: ApiError) => this.toast.show(e.message, 'danger'),
    });
  }
}
