import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { Subject, debounceTime } from 'rxjs';
import { AdminVoucherApiService } from '../../../services/admin-voucher-apiservice';
import { AuthService } from '../../../services/auth';
import { ToastService } from '../../../services/toast';
import { ApiError } from '../../../classes/api-error';
import { IAdminVoucher, VOUCHER_STATUS_LABEL, VoucherDisplayStatus } from '../../../classes/checkout';
import { Selection } from '../shared/selection';
import { BulkAction } from '../shared/bulk-bar/bulk-bar';
import { RowMenuItem } from '../shared/row-menu/row-menu';
import { saveTextFile } from '../../../shared/save-file';

const vnd = (n: number) => n.toLocaleString('vi-VN') + 'đ';

// SCR-45 Voucher (UC-CAT-02 bước 1, nhánh 1c, 1d, 1f, 1g): tab trạng thái có đếm, tìm theo mã/tên, lọc loại ưu đãi,
// ô chọn + thanh thao tác hàng loạt (API-165), menu "..." mỗi dòng, xuất CSV lượt dùng (API-166).
@Component({
  selector: 'app-voucher-list',
  standalone: false,
  templateUrl: './voucher-list.html',
  styleUrl: './voucher-list.scss',
})
export class VoucherList {
  private readonly api = inject(AdminVoucherApiService);
  protected readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly statusLabel = VOUCHER_STATUS_LABEL;
  readonly tabs: (VoucherDisplayStatus | '')[] = ['', 'DANG_HOAT_DONG', 'DA_LEN_LICH', 'TAM_NGUNG', 'HET_HAN', 'HET_LUOT', 'BAN_NHAP', 'LUU_TRU'];

  readonly q = signal('');
  readonly status = signal<VoucherDisplayStatus | ''>('');
  readonly type = signal('');
  readonly sort = signal('');
  readonly page = signal(1);
  private readonly search$ = new Subject<string>();

  readonly items = signal<IAdminVoucher[]>([]);
  readonly total = signal(0);
  readonly pageSize = signal(20);
  readonly counts = signal<Record<string, number>>({});
  readonly loading = signal(true);
  readonly errMessage = signal('');

  readonly sel = new Selection();
  private readonly seen = new Map<string, IAdminVoucher>();
  readonly busy = signal(false);
  readonly confirmDelete = signal<IAdminVoucher[] | null>(null);
  readonly confirmPause = signal<IAdminVoucher | null>(null);

  readonly pageIds = computed(() => this.items().map((v) => v._id!));

  readonly bulkActions = computed<BulkAction[]>(() => {
    const a: BulkAction[] = [];
    if (this.auth.can('VOUCHER.SUA')) a.push({ key: 'PAUSE', label: 'Tạm ngừng', icon: 'pause' }, { key: 'ACTIVATE', label: 'Kích hoạt', icon: 'play' });
    if (this.auth.can('VOUCHER.XUAT_CSV')) a.push({ key: 'EXPORT', label: 'Xuất CSV lượt dùng', icon: 'file' });
    if (this.auth.can('VOUCHER.XOA')) a.push({ key: 'DELETE', label: 'Xóa', icon: 'trash', danger: true });
    return a;
  });

  constructor() {
    this.search$.pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef)).subscribe((v) => {
      this.q.set(v);
      this.reload();
    });
    this.load();
  }

  load(): void {
    this.errMessage.set('');
    this.api.getVouchers({ q: this.q(), status: this.status(), type: this.type(), sort: this.sort(), page: this.page() }).subscribe({
      next: (d) => {
        this.items.set(d.items);
        for (const v of d.items) this.seen.set(v._id!, v);
        this.total.set(d.total);
        this.pageSize.set(d.pageSize);
        this.counts.set(d.counts);
        this.loading.set(false);
      },
      error: (err: ApiError) => {
        this.errMessage.set(err.message);
        this.loading.set(false);
      },
    });
  }

  reload(): void {
    this.page.set(1);
    this.load();
  }

  onSearch(v: string): void {
    this.search$.next(v.trim());
  }

  setTab(s: VoucherDisplayStatus | ''): void {
    this.status.set(s);
    this.sel.clear();
    this.reload();
  }

  setType(t: string): void {
    this.type.set(t);
    this.reload();
  }

  toggleSort(key: string): void {
    this.sort.set(this.sort() === key ? '' : key);
    this.reload();
  }

  offer(v: IAdminVoucher): string {
    const parts: string[] = []
    if (v.type === 'PERCENT') parts.push(`Giảm ${v.value}%${v.maxDiscount ? ', tối đa ' + vnd(v.maxDiscount) : ''}`);
    else if (v.type === 'FIXED') parts.push(`Giảm ${vnd(v.value || 0)}`);
    else parts.push(`Giảm ${vnd(v.value || 0)} phí ship`);
    if (v.minOrderValue) parts.push(`Đơn từ ${vnd(v.minOrderValue)}`);
    if (v.scope?.kind === 'CATEGORY') parts.push('Theo danh mục');
    if (v.scope?.kind === 'PRODUCT') parts.push('Sản phẩm chọn');
    if (v.audience === 'NEW_MEMBERS') parts.push('Thành viên mới');
    if (v.audience === 'ALL_MEMBERS') parts.push('Thành viên');
    if (v.audience === 'SELECTED') parts.push(`${v.selectedCount || 0} khách chọn`);
    return parts.join(' | ');
  }

  usedPercent(v: IAdminVoucher): number {
    return v.totalQuantity ? Math.min(100, Math.round(((v.usedCount || 0) / v.totalQuantity) * 100)) : 0;
  }

  timeText(v: IAdminVoucher): string {
    const f = (d: string) => { const x = new Date(d); return String(x.getDate()).padStart(2, '0') + '/' + String(x.getMonth() + 1).padStart(2, '0'); };
    if (!v.startAt && !v.endAt) return 'Chưa đặt';
    return `${v.startAt ? f(v.startAt) : '...'} - ${v.endAt ? f(v.endAt) + '/' + new Date(v.endAt).getFullYear() : '...'}`;
  }

  rowMenu(v: IAdminVoucher): RowMenuItem[] {
    const items: RowMenuItem[] = [{ key: 'edit', label: v.status === 'LUU_TRU' ? 'Xem' : 'Sửa', icon: 'edit' }];
    if (this.auth.can('VOUCHER.SUA')) {
      if (v.status === 'HOAT_DONG') items.push({ key: 'pause', label: 'Tạm ngừng', icon: 'pause' });
      if (v.status === 'TAM_NGUNG') items.push({ key: 'ACTIVATE', label: 'Bật lại', icon: 'play' });
    }
    if (this.auth.can('VOUCHER.TAO')) items.push({ key: 'duplicate', label: 'Nhân bản', icon: 'copy' });
    if (this.auth.can('VOUCHER.XOA') && v.status !== 'LUU_TRU') items.push({ key: 'delete', label: 'Xóa', icon: 'trash', danger: true });
    return items;
  }

  onRowMenu(v: IAdminVoucher, key: string): void {
    if (key === 'edit') this.router.navigate(['/quan-tri/voucher', v._id]);
    else if (key === 'pause') this.confirmPause.set(v);
    else if (key === 'delete') this.confirmDelete.set([v]);
    else if (key === 'duplicate') {
      this.api.duplicateVoucher(v._id!).subscribe({
        next: (copy) => {
          this.toast.show(`Đã tạo bản nháp ${copy.code}, hãy đặt lại mã và thời gian`);
          this.router.navigate(['/quan-tri/voucher', copy._id]);
        },
        error: (err: ApiError) => this.toast.show(err.message, 'danger'),
      });
    } else this.runBulk(key, [v._id!]);
  }

  onBulk(key: string): void {
    const ids = this.sel.ids();
    if (key === 'DELETE') this.confirmDelete.set(ids.map((id) => this.seen.get(id)!).filter(Boolean));
    else if (key === 'EXPORT') this.exportCsv(ids);
    else this.runBulk(key, ids);
  }

  doPause(): void {
    const v = this.confirmPause()!;
    this.confirmPause.set(null);
    this.runBulk('PAUSE', [v._id!]);
  }

  doDelete(): void {
    const list = this.confirmDelete()!;
    this.confirmDelete.set(null);
    this.runBulk('DELETE', list.map((v) => v._id!));
  }

  runBulk(action: string, ids: string[]): void {
    this.busy.set(true);
    this.api.bulkVouchers({ action, ids }).subscribe({
      next: (r) => {
        this.busy.set(false);
        const verb: Record<string, string> = { PAUSE: 'tạm ngừng', ACTIVATE: 'kích hoạt', DELETE: 'xóa' };
        const archived = action === 'DELETE' && r.archived.length ? ` (${r.archived.length} voucher đã dùng chuyển vào Lưu trữ)` : '';
        const skipped = r.skipped.length ? `. Bỏ qua: ${r.skipped.map((s) => s.reason).join('; ')}` : '';
        this.toast.show(`Đã ${verb[action]} ${r.updated} voucher${archived}${skipped}`, r.skipped.length ? 'info' : 'success');
        this.sel.clear();
        this.load();
      },
      error: (err: ApiError) => {
        this.busy.set(false);
        this.toast.show(err.message, 'danger');
      },
    });
  }

  // API-166: tải tệp CSV (chuỗi trả về -> Blob -> liên kết tải)
  exportCsv(ids: string[]): void {
    this.api.exportUsage(ids).subscribe({
      next: (csv) => {
        saveTextFile(csv, `luot-dung-voucher-${new Date().toISOString().slice(0, 10)}.csv`);
      },
      error: (err: ApiError) => this.toast.show(err.message, 'danger'),
    });
  }

  goPage(p: number): void {
    this.page.set(p);
    this.load();
  }
}
