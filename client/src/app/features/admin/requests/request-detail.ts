import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AdminRequestApiService } from '../../../services/admin-request-apiservice';
import { ToastService } from '../../../services/toast';
import { ApiError } from '../../../classes/api-error';
import { IRequestDetail, RequestKind } from '../../../classes/aftersales';
import { RequestAction } from './request-action-dialog';

const KIND_OF: Record<string, RequestKind> = { returns: 'RETURN', warranty: 'WARRANTY', refunds: 'REFUND' };

// Chi tiết yêu cầu hậu mãi (UC-OPS-07 bước 2; dựng theo bộ component quản trị):
// sản phẩm, số lượng, lý do, hình thức, mô tả, ảnh, xác nhận tình trạng, địa chỉ lấy hàng, tài khoản nhận tiền, đơn gốc
// và lịch sử; các nút thao tác như menu "..." của SCR-50 (API-196). Route /quan-tri/yeu-cau/:kind/:id.
@Component({
  selector: 'app-request-detail',
  standalone: false,
  templateUrl: './request-detail.html',
  styleUrl: './request-detail.scss',
})
export class RequestDetail {
  private readonly api = inject(AdminRequestApiService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  readonly kind = KIND_OF[this.route.snapshot.paramMap.get('kind') || ''] || 'RETURN';
  readonly id = this.route.snapshot.paramMap.get('id') || '';

  readonly detail = signal<IRequestDetail | null>(null);
  readonly error = signal('');
  readonly dialog = signal<RequestAction | null>(null);

  readonly buttons = computed(() => {
    const d = this.detail();
    if (!d) return [];
    const a = d.actions;
    const out: { key: RequestAction; label: string; cls: string }[] = [];
    if (a.approve) out.push({ key: 'approve', label: d.kind === 'WARRANTY' ? 'Duyệt bảo hành' : 'Duyệt - Thu hồi hàng', cls: 'btn-primary' });
    if (a.received) out.push({ key: 'received', label: 'Xác nhận đã nhận hàng', cls: 'btn-primary' });
    if (a.complete) out.push({ key: 'complete', label: 'Hoàn tất', cls: 'btn-primary' });
    if (a.markPaid) out.push({ key: 'markPaid', label: 'Đã chuyển khoản', cls: 'btn-primary' });
    if (a.gatewayRefund) out.push({ key: 'gatewayRefund', label: 'Hoàn qua cổng', cls: 'btn-primary' });
    if (a.progressNote) out.push({ key: 'progressNote', label: 'Cập nhật tiến độ', cls: 'btn-outline-secondary' });
    if (a.refundNow) out.push({ key: 'refundNow', label: 'Hoàn tiền ngay', cls: 'btn-outline-secondary' });
    if (a.markFailed) out.push({ key: 'markFailed', label: 'Chuyển khoản thất bại', cls: 'btn-outline-danger' });
    if (a.reject) out.push({ key: 'reject', label: 'Từ chối', cls: 'btn-outline-danger' });
    return out;
  });

  constructor() {
    this.load();
  }

  load(): void {
    this.error.set('');
    this.api.getRequest(this.kind, this.id).subscribe({
      next: (d) => this.detail.set(d),
      error: (err: ApiError) => this.error.set(err.status === 404 ? 'Không tìm thấy yêu cầu' : err.message),
    });
  }

  onDone(d: IRequestDetail): void {
    this.dialog.set(null);
    this.detail.set(d);
  }

  copy(text: string): void {
    navigator.clipboard?.writeText(text).then(() => this.toast.show('Đã sao chép'));
  }
}
