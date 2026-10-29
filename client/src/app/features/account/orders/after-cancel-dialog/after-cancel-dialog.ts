import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { OrderApiService } from '../../../../services/order-apiservice';
import { ApiError } from '../../../../classes/api-error';
import { IOrderDetail } from '../../../../classes/order';
import { AddressValue, DELIVERY_SLOTS, RefundAccountValue } from '../../../../classes/aftersales';

// SCR-28 Hộp thoại hành động đơn đã hủy (S9):
// - "Nhận lại hàng" (UC-CNL-04): đơn TH3 đang lưu kho; địa chỉ, khung giờ nhận, bảng chi phí = phí vận chuyển mới +
//   giá trị còn lại; "Thanh toán" tạo giao dịch REDELIVERY và chuyển tới cổng (API-47).
// - "Nhận tiền hoàn" (UC-CNL-05) đơn TH2, hoặc nhập lại tài khoản khi chuyển khoản thất bại (5a) - API-48.
@Component({
  selector: 'app-after-cancel-dialog',
  standalone: false,
  templateUrl: './after-cancel-dialog.html',
  styleUrl: './after-cancel-dialog.scss',
})
export class AfterCancelDialog implements OnInit {
  @Input({ required: true }) order!: IOrderDetail;
  @Input({ required: true }) mode: 'redelivery' | 'refund' = 'refund';
  @Output() closed = new EventEmitter<void>();
  @Output() done = new EventEmitter<string>();

  private readonly api = inject(OrderApiService);
  private readonly router = inject(Router);

  readonly slots = DELIVERY_SLOTS;
  readonly recipientType = signal<'SELF' | 'OTHER'>('SELF');
  readonly address = signal<AddressValue | null>(null);
  readonly slot = signal('');
  readonly account = signal<RefundAccountValue | null>(null);
  readonly sending = signal(false);
  readonly error = signal('');
  readonly fieldErrors = signal<Record<string, string>>({});

  ngOnInit(): void {
    this.slot.set(this.order.shippingAddress?.deliveryWindow || '');
  }

  // Còn N ngày lưu kho (hạn tính ở server - BR-09)
  get daysLeft(): number {
    const d = this.order.storageDeadline ? new Date(this.order.storageDeadline).getTime() - Date.now() : 0;
    return Math.max(0, Math.ceil(d / 86400000));
  }

  // Nhập lại tài khoản sau khi chuyển khoản thất bại (không dùng lại tài khoản cũ)
  get reenter(): boolean {
    return !!this.order.actions?.refundAccount;
  }

  // Chuyển khoản trước đã thất bại (nhập lại); ngược lại là shop hủy đơn khi khách chưa lưu tài khoản (nhập lần đầu)
  get failedBefore(): boolean {
    return this.reenter && this.order.refund?.status === 'THAT_BAI';
  }

  // Phần chênh khi đơn đổi trước xác nhận (BR-47 b), không phải đơn hủy
  get changeRefund(): boolean {
    return this.order.refund?.reason === 'DOI_DON';
  }

  get refundAmount(): number {
    if (this.reenter && this.order.refund) return this.order.refund.amount;
    return this.order.cancelRefundAmount ?? Math.max(0, this.order.paidAmount - this.order.refundedAmount);
  }

  get canSubmit(): boolean {
    if (this.sending()) return false;
    return this.mode === 'redelivery' ? !!this.address() : !!this.account();
  }

  submit(): void {
    if (!this.canSubmit) return;
    this.sending.set(true);
    this.error.set('');
    this.fieldErrors.set({});
    const fail = (err: ApiError) => {
      this.sending.set(false);
      this.fieldErrors.set(err.extra['fields'] || {});
      this.error.set(err.message);
    };
    if (this.mode === 'redelivery') {
      const a = this.address()!;
      const body = {
        recipientType: this.recipientType(),
        ...('addressId' in a ? { addressId: a.addressId } : { shippingAddress: a.address }),
        ...(this.slot() ? { deliveryWindow: this.slot() } : {}),
      };
      // Thanh toán xong cổng chuyển về chi tiết đơn (redirectUrl của API-40)
      this.api.redelivery(this.order.code, body).subscribe({ next: (r) => this.router.navigateByUrl(r.paymentUrl), error: fail });
      return;
    }
    this.api.refundRequest(this.order.code, this.account()!).subscribe({
      next: () => this.done.emit('Yêu cầu hoàn tiền đã được ghi nhận, tiền về tài khoản của bạn trong 1 - 3 ngày làm việc'),
      error: fail,
    });
  }
}
