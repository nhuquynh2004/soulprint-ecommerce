import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, debounceTime } from 'rxjs';
import { AdminRequestApiService } from '../../../services/admin-request-apiservice';
import { ToastService } from '../../../services/toast';
import { ApiError } from '../../../classes/api-error';
import { IRequestDetail, IRequestRow, KIND_PATH, REQUEST_STAGES, REQUEST_TYPES, RequestKind, RequestStage, waitingText } from '../../../classes/aftersales';
import { RowMenuItem } from '../shared/row-menu/row-menu';
import { RequestAction } from './request-action-dialog';

// SCR-50 Yêu cầu hậu mãi (UC-OPS-07): tab theo tiến độ có đếm (05 Mục 2.6), ô tìm mã yêu cầu / mã đơn / tên khách,
// dropdown loại; bảng Ưu tiên (mức + "chờ N giờ"), Mã yêu cầu + mã đơn, Khách hàng, Sản phẩm kèm loại và lý do, Trạng thái,
// menu "..." theo trạng thái và quyền. Tab, loại, ô tìm nằm trên URL (query params - Chương IV).
@Component({
  selector: 'app-request-list',
  standalone: false,
  templateUrl: './request-list.html',
  styleUrl: './request-list.scss',
})
export class RequestList {
  private readonly api = inject(AdminRequestApiService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly stages = REQUEST_STAGES;
  readonly types = REQUEST_TYPES;
  readonly waiting = waitingText;
  readonly kindPath = KIND_PATH;
  readonly stage = signal<RequestStage | ''>('');
  readonly type = signal<RequestKind | ''>('');
  readonly q = signal('');
  readonly page = signal(1);
  readonly items = signal<IRequestRow[]>([]);
  readonly counts = signal<Record<string, number>>({});
  readonly total = signal(0);
  readonly pageSize = signal(20);
  readonly loading = signal(true);
  readonly errMessage = signal('');
  readonly dialog = signal<{ detail: IRequestDetail; action: RequestAction } | null>(null);
  private readonly search$ = new Subject<string>();

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((p) => {
      this.stage.set((p.get('stage') as RequestStage) || '');
      this.type.set((p.get('type') as RequestKind) || '');
      this.q.set(p.get('q') || '');
      this.page.set(Number(p.get('page')) || 1);
      this.load();
    });
    this.search$.pipe(debounceTime(350), takeUntilDestroyed(this.destroyRef)).subscribe((q) => this.go({ q: q || null, page: null }));
  }

  load(): void {
    this.errMessage.set('');
    this.api.getRequests({ stage: this.stage(), type: this.type(), q: this.q(), page: this.page() }).subscribe({
      next: (d) => {
        this.items.set(d.items);
        this.counts.set(d.counts);
        this.total.set(d.total);
        this.pageSize.set(d.pageSize);
        this.loading.set(false);
      },
      error: (err: ApiError) => {
        this.errMessage.set(err.message);
        this.loading.set(false);
      },
    });
  }

  go(params: Record<string, string | number | null>): void {
    this.router.navigate([], { relativeTo: this.route, queryParams: params, queryParamsHandling: 'merge' });
  }

  onSearch(v: string): void {
    this.search$.next(v.trim());
  }

  priorityClass(r: IRequestRow): string {
    return r.priorityLevel === 'KHAN_CAP' ? 'urgent' : r.priorityLevel === 'CAN_CHU_Y' ? 'attention' : 'normal';
  }

  priorityLabel(r: IRequestRow): string {
    return r.priorityLevel === 'KHAN_CAP' ? 'Khẩn cấp' : r.priorityLevel === 'CAN_CHU_Y' ? 'Cần chú ý' : 'Bình thường';
  }

  // Menu "..." theo thao tác được phép (SCR-50-MenuThaoTac)
  menu(r: IRequestRow): RowMenuItem[] {
    const a = r.actions;
    const out: RowMenuItem[] = [{ key: 'view', label: 'Xem chi tiết', icon: 'eye' }];
    if (a.approve) out.push({ key: 'approve', label: r.kind === 'WARRANTY' ? 'Duyệt bảo hành' : 'Duyệt - Thu hồi hàng', icon: 'check-circle' });
    if (a.refundNow) out.push({ key: 'refundNow', label: 'Hoàn tiền ngay', icon: 'ticket' });
    if (a.received) out.push({ key: 'received', label: 'Xác nhận đã nhận hàng', icon: 'package' });
    if (a.complete) out.push({ key: 'complete', label: 'Hoàn tất', icon: 'check' });
    if (a.markPaid) out.push({ key: 'markPaid', label: 'Đã chuyển khoản', icon: 'check-circle' });
    if (a.gatewayRefund) out.push({ key: 'gatewayRefund', label: 'Hoàn qua cổng', icon: 'refresh' });
    if (a.markFailed) out.push({ key: 'markFailed', label: 'Chuyển khoản thất bại', icon: 'alert-circle', danger: true });
    if (a.reject) out.push({ key: 'reject', label: 'Từ chối', icon: 'x-circle', danger: true });
    return out;
  }

  // Nút chính ngay trên hàng: thao tác đầu tiên khác "Xem chi tiết" và không phải Từ chối
  primary(r: IRequestRow): RowMenuItem | null {
    return this.menu(r).find((m) => m.key !== 'view' && !m.danger) ?? null;
  }

  open(r: IRequestRow): void {
    this.router.navigate(['/quan-tri/yeu-cau', KIND_PATH[r.kind], r._id]);
  }

  onMenu(r: IRequestRow, key: string): void {
    if (key === 'view') {
      this.open(r);
      return;
    }
    // Hộp thoại cần chi tiết đầy đủ (hướng dẫn mẫu, tài khoản, số có thể hoàn) - API-196
    this.api.getRequest(r.kind, r._id).subscribe({
      next: (detail) => this.dialog.set({ detail, action: key as RequestAction }),
      error: (err: ApiError) => this.toast.show(err.message, 'danger'),
    });
  }

  onDone(): void {
    this.dialog.set(null);
    this.load();
  }
}
