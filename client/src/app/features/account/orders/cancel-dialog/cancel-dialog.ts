import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { OrderApiService } from '../../../../services/order-apiservice';
import { ApiError } from '../../../../classes/api-error';
import { CANCEL_REASONS, IOrderDetail, ORDER_STATUS_LABEL } from '../../../../classes/order';
import { RefundAccountValue } from '../../../../classes/aftersales';

// SCR-28 Hộp thoại hủy đơn (UC-CNL-02): lý do bắt buộc, "Lý do khác" cần chi tiết; đơn đã trả tiền báo trước số
// được hoàn (BR-07) và chọn tài khoản nhận tiền hoàn (đã lưu hoặc nhập mới, form dùng chung `app-refund-account`). Mở từ thẻ đơn (SCR-18) hoặc chi tiết (SCR-19):
// component tự đọc chi tiết đơn (API-43) để có số hoàn và tài khoản đã lưu.
@Component({
  selector: 'app-cancel-dialog',
  standalone: false,
  templateUrl: './cancel-dialog.html',
  styleUrl: './cancel-dialog.scss',
})
export class CancelDialog implements OnInit {
  @Input({ required: true }) code = '';
  @Output() closed = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<IOrderDetail>();
  // Đơn đã được xử lý tiếp trong lúc mở hộp thoại (4Ea): trang cha tải lại
  @Output() stale = new EventEmitter<void>();
  // UC-CNL-02 3b: khách chọn sửa đơn thay vì hủy
  @Output() edit = new EventEmitter<'shipping' | 'personalization'>();

  private readonly api = inject(OrderApiService);

  // Đơn đang được hỏi ý kiến (UC-CNL-02 3c): thêm lý do "Đơn hàng không thể thực hiện" ở đầu và chọn sẵn
  readonly reasons = computed(() => (this.order()?.asking ? [{ key: 'KHONG_THE_THUC_HIEN', label: 'Đơn hàng không thể thực hiện' }, ...CANCEL_REASONS] : CANCEL_REASONS));
  readonly statusLabel = ORDER_STATUS_LABEL;
  readonly order = signal<IOrderDetail | null>(null);
  readonly loadError = signal('');
  readonly sending = signal(false);
  readonly error = signal('');
  readonly fieldErrors = signal<Record<string, string>>({});

  reason = '';
  detail = '';
  readonly account = signal<RefundAccountValue | null>(null);
  readonly accountTouched = signal(false);

  readonly needsAccount = computed(() => (this.order()?.cancelRefundAmount || 0) > 0);
  readonly hasPersonalized = computed(() => !!this.order()?.items.some((i) => i.isPersonalized));
  // Lý do đổi nội dung cá nhân hóa, đổi địa chỉ và thời gian nhận: mời sửa đơn (khi đơn còn sửa được), trừ khi khách vẫn muốn hủy
  readonly reasonKey = signal('');
  readonly forceCancel = signal(false);
  readonly editOffer = computed<'shipping' | 'personalization' | null>(() => {
    const a = this.order()?.actions;
    if (this.forceCancel() || !a) return null;
    if (this.reasonKey() === 'DOI_NOI_DUNG' && a.editPersonalization) return 'personalization';
    if (this.reasonKey() === 'DOI_DIA_CHI' && a.editShipping) return 'shipping';
    return null;
  });

  pickReason(key: string): void {
    this.reason = key;
    this.reasonKey.set(key);
    this.forceCancel.set(false);
    this.fieldErrors.set({});
  }

  ngOnInit(): void {
    this.api.getOrder(this.code).subscribe({
      next: (o) => {
        this.order.set(o);
        if (o.asking) this.pickReason('KHONG_THE_THUC_HIEN');
      },
      error: (err: ApiError) => this.loadError.set(err.message),
    });
  }

  // Nút luôn bấm được: còn thiếu thì đánh dấu đúng ô và báo, không khóa nút im lặng
  private missingFields(): Record<string, string> {
    const f: Record<string, string> = {};
    if (!this.reason) f['reason'] = 'Vui lòng chọn lý do hủy';
    else if (this.reason === 'KHAC' && !this.detail.trim()) f['detail'] = 'Vui lòng nhập lý do';
    // Tài khoản: form dùng chung tự báo lỗi từng ô khi touchAll
    if (this.needsAccount() && !this.account()) {
      f['account'] = 'missing';
      this.accountTouched.set(true);
    }
    return f;
  }

  submit(): void {
    if (this.sending() || this.editOffer()) return;
    const missing = this.missingFields();
    if (Object.keys(missing).length) {
      // Lỗi đã hiện ngay dưới từng ô, không thêm dòng chung (retest R02: 2 dòng đỏ trùng ý)
      this.fieldErrors.set(missing);
      this.error.set('');
      return;
    }
    this.sending.set(true);
    this.error.set('');
    this.fieldErrors.set({});
    const body = {
      reason: this.reason,
      ...(this.reason === 'KHAC' ? { detail: this.detail.trim() } : {}),
      ...(this.needsAccount() ? this.account() : {}),
    };
    this.api.cancel(this.code, body).subscribe({
      next: (o) => this.cancelled.emit(o),
      error: (err: ApiError) => {
        this.sending.set(false);
        if (err.status === 409 || err.status === 422) {
          this.stale.emit();
          return;
        }
        this.fieldErrors.set(err.extra['fields'] || {});
        this.error.set(err.message);
      },
    });
  }
}
