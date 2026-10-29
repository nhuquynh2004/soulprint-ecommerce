import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { AdminRequestApiService } from '../../../services/admin-request-apiservice';
import { ToastService } from '../../../services/toast';
import { ApiError } from '../../../classes/api-error';
import { IRequestDetail, REASON_MIN, TEXT_MAX } from '../../../classes/aftersales';

export type RequestAction = 'approve' | 'reject' | 'refundNow' | 'received' | 'complete' | 'progressNote' | 'markPaid' | 'gatewayRefund' | 'markFailed';

// Hộp thoại thao tác yêu cầu hậu mãi (SCR-50, UC-OPS-07; API-100, API-101, API-102). Một component cho mọi bước, nội dung
// chọn bằng @switch theo action (Chương II): Duyệt - Thu hồi hàng (bước 3), Từ chối có lý do mẫu + bằng chứng + cho gửi lại
// (3a), Hoàn tiền ngay (3b), Xác nhận đã nhận hàng (bước 5), Hoàn tất (bước 6), tiến độ bảo hành (1a), Đã chuyển khoản /
// Chuyển khoản thất bại (1b, 7Ea). Trả chi tiết mới qua (done).
@Component({
  selector: 'app-request-action-dialog',
  standalone: false,
  templateUrl: './request-action-dialog.html',
})
export class RequestActionDialog implements OnInit {
  @Input({ required: true }) detail!: IRequestDetail;
  @Input({ required: true }) action: RequestAction = 'received';
  @Output() closed = new EventEmitter<void>();
  @Output() done = new EventEmitter<IRequestDetail>();

  private readonly api = inject(AdminRequestApiService);
  private readonly toast = inject(ToastService);

  readonly textMax = TEXT_MAX;
  readonly reasonMin = REASON_MIN;
  readonly sending = signal(false);
  readonly error = signal('');

  instruction = '';
  carrier = '';
  tracking = '';
  resolution = 'SUA_CHUA';
  readonly reasonCode = signal('');
  readonly detailText = signal('');
  evidence: string[] = [];
  allowResubmit = false;
  readonly amount = signal(0);
  readonly reason = signal('');
  note = '';

  readonly maxRefund = computed(() => this.detail.order.refundable);
  readonly isReturn = computed(() => this.detail.kind === 'RETURN');

  ngOnInit(): void {
    this.instruction = this.detail.defaultInstruction || '';
    this.amount.set(Math.min(this.detail.defaultRefund ?? this.detail.amount ?? 0, this.detail.order.refundable));
  }

  get title(): string {
    const d = this.detail;
    return {
      approve: d.kind === 'WARRANTY' ? 'Duyệt yêu cầu bảo hành' : 'Duyệt - Thu hồi hàng',
      reject: `Từ chối yêu cầu ${d.code}?`,
      refundNow: 'Hoàn tiền ngay',
      received: 'Xác nhận đã nhận hàng',
      complete: d.kind === 'WARRANTY' ? 'Hoàn tất bảo hành' : 'Hoàn tất đổi trả',
      progressNote: 'Cập nhật tiến độ bảo hành',
      markPaid: 'Xác nhận đã chuyển khoản',
      gatewayRefund: 'Hoàn qua cổng thanh toán',
      markFailed: 'Chuyển khoản thất bại',
    }[this.action];
  }

  get summary(): string {
    const d = this.detail;
    const product = d.items?.map((i) => i.name).join(', ') || d.item?.name || d.order.items[0]?.name || '';
    return `${d.code} | ${product} | ${d.order.customer.fullName}${d.resolutionLabel ? ' | ' + d.resolutionLabel : ''}${d.reasonLabel ? ' | ' + d.reasonLabel : ''}`;
  }

  // Chọn lý do mẫu thì điền sẵn câu gợi ý (khi ô mô tả còn trống hoặc đang là câu gợi ý cũ)
  pickReason(code: string): void {
    const prev = this.detail.rejectReasons.find((r) => r.value === this.reasonCode())?.hint || '';
    this.reasonCode.set(code);
    const hint = this.detail.rejectReasons.find((r) => r.value === code)?.hint || '';
    if (!this.detailText().trim() || this.detailText() === prev) this.detailText.set(hint);
  }

  get canSubmit(): boolean {
    if (this.sending()) return false;
    switch (this.action) {
      case 'approve':
        return this.detail.kind === 'WARRANTY' ? !!this.resolution : this.instruction.trim().length >= 10;
      case 'reject': {
        const n = this.detailText().trim().length;
        return !!this.reasonCode() && n >= REASON_MIN && n <= TEXT_MAX;
      }
      case 'refundNow':
        return this.reason().trim().length >= REASON_MIN && this.amount() >= 1 && this.amount() <= this.maxRefund();
      case 'complete':
        return !(this.isReturn() && this.detail.resolution === 'HOAN_TIEN' && this.maxRefund() > 0 && (this.amount() < 1 || this.amount() > this.maxRefund()));
      case 'progressNote':
        return !!this.note.trim();
      case 'markFailed':
        return this.note.trim().length >= 5;
      default:
        return true;
    }
  }

  body(): Record<string, unknown> {
    const d = this.detail;
    switch (this.action) {
      case 'approve':
        return d.kind === 'WARRANTY'
          ? { decision: 'DA_DUYET', resolution: this.resolution, returnInstruction: this.instruction.trim(), returnCarrier: this.carrier || undefined, returnTrackingCode: this.tracking.trim() || undefined }
          : { decision: 'DONG_Y', returnInstruction: this.instruction.trim(), returnCarrier: this.carrier || undefined, returnTrackingCode: this.tracking.trim() || undefined };
      case 'reject':
        return { decision: 'TU_CHOI', reasonCode: this.reasonCode(), detail: this.detailText().trim(), evidence: this.evidence, ...(this.isReturn() ? { allowResubmit: this.allowResubmit } : {}) };
      case 'refundNow':
        return { refundWithoutReturn: true, reason: this.reason().trim(), refundAmount: this.amount() };
      case 'received':
        return { received: true };
      case 'complete':
        return this.isReturn() && d.resolution === 'HOAN_TIEN' && this.maxRefund() > 0 ? { complete: true, refundAmount: this.amount() } : { complete: true };
      case 'progressNote':
        return { progressNote: this.note.trim() };
      case 'markPaid':
      case 'gatewayRefund':
        return { status: 'DA_HOAN', note: this.note.trim() };
      case 'markFailed':
        return { status: 'THAT_BAI', note: this.note.trim() };
    }
  }

  submit(): void {
    if (!this.canSubmit) return;
    this.sending.set(true);
    this.error.set('');
    this.api.update(this.detail.kind, this.detail._id, this.body()).subscribe({
      next: (d) => {
        this.toast.show(`Đã cập nhật ${d.code}`);
        this.done.emit(d);
      },
      error: (err: ApiError) => {
        this.sending.set(false);
        this.error.set(err.message);
      },
    });
  }

  copy(text: string): void {
    navigator.clipboard?.writeText(text).then(() => this.toast.show('Đã sao chép'));
  }
}
