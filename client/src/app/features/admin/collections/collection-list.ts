import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { Subject, debounceTime } from 'rxjs';
import { AdminStoreApiService } from '../../../services/admin-store-apiservice';
import { AuthService } from '../../../services/auth';
import { ToastService } from '../../../services/toast';
import { ApiError } from '../../../classes/api-error';
import { COLLECTION_STATUS_LABEL, CollectionDisplayStatus, IAdminCollection } from '../../../classes/admin-catalog';
import { Selection } from '../shared/selection';
import { BulkAction } from '../shared/bulk-bar/bulk-bar';
import { RowMenuItem } from '../shared/row-menu/row-menu';
import { FilterChip } from '../shared/filter-chips/filter-chips';

// SCR-54 Bộ sưu tập (UC-CAT-05 bước 1, nhánh 1a, 1b, 1c): 1 ô tìm dài + lọc Trạng thái, Loại, Nơi hiển thị có chip;
// chọn nhiều + thao tác hàng loạt (API-167) với công tắc "Chỉ hiện mục đã chọn"; nhân bản (API-168).
@Component({
  selector: 'app-collection-list',
  standalone: false,
  templateUrl: './collection-list.html',
  styleUrl: './collection-list.scss',
})
export class CollectionList {
  private readonly api = inject(AdminStoreApiService);
  protected readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly statusLabel = COLLECTION_STATUS_LABEL;
  readonly statuses = Object.keys(COLLECTION_STATUS_LABEL) as CollectionDisplayStatus[];

  readonly q = signal('');
  readonly status = signal<CollectionDisplayStatus | ''>('');
  readonly type = signal<'' | 'THU_CONG' | 'TU_DONG'>('');
  readonly home = signal<'' | 'true' | 'false'>('');
  readonly page = signal(1);
  private readonly search$ = new Subject<string>();

  readonly items = signal<IAdminCollection[]>([]);
  readonly total = signal(0);
  readonly pageSize = signal(20);
  readonly counts = signal<Record<string, number>>({});
  readonly loading = signal(true);
  readonly errMessage = signal('');

  readonly sel = new Selection();
  readonly onlySelected = signal(false);
  private readonly seen = new Map<string, IAdminCollection>(); // dòng đã chọn ở các trang trước, để "Chỉ hiện mục đã chọn"
  readonly busy = signal(false);
  readonly confirmDelete = signal<{ ids: string[]; names: string[] } | null>(null);

  readonly rows = computed(() => (this.onlySelected() ? this.sel.ids().map((id) => this.seen.get(id)!).filter(Boolean) : this.items()));
  readonly pageIds = computed(() => this.rows().map((c) => c._id!));
  readonly onHome = computed(() => this.items().filter((c) => c.showOnHome && c.displayStatus === 'DANG_HIEN').length);

  readonly chips = computed<FilterChip[]>(() => {
    const out: FilterChip[] = [];
    if (this.status()) out.push({ key: 'status', label: 'Trạng thái: ' + COLLECTION_STATUS_LABEL[this.status() as CollectionDisplayStatus] });
    if (this.type()) out.push({ key: 'type', label: 'Loại: ' + (this.type() === 'THU_CONG' ? 'Chọn tay' : 'Tự động') });
    if (this.home()) out.push({ key: 'home', label: this.home() === 'true' ? 'Hiện trên trang chủ' : 'Không ở trang chủ' });
    return out;
  });

  readonly bulkActions = computed<BulkAction[]>(() => {
    const a: BulkAction[] = [];
    if (this.auth.can('BO_SUU_TAP.SUA'))
      a.push(
        { key: 'BULK_EDIT', label: 'Sửa hàng loạt', icon: 'edit' },
        { key: 'SHOW', label: 'Hiện trên website', icon: 'eye' },
        { key: 'HIDE', label: 'Ẩn khỏi website', icon: 'eye-off' },
        { key: 'ADD_TO_HOME', label: 'Hiện trên trang chủ', icon: 'home' },
        { key: 'REMOVE_FROM_HOME', label: 'Gỡ khỏi trang chủ', icon: 'minus' },
      );
    if (this.auth.can('BO_SUU_TAP.XOA')) a.push({ key: 'DELETE', label: 'Xóa bộ sưu tập', icon: 'trash', danger: true });
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
    this.api.getCollections({ q: this.q(), status: this.status(), type: this.type(), showOnHome: this.home(), page: this.page() }).subscribe({
      next: (d) => {
        this.items.set(d.items);
        for (const c of d.items) this.seen.set(c._id!, c);
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

  setFilter(key: 'status' | 'type' | 'home', v: string): void {
    (this[key] as any).set(v);
    this.reload();
  }

  clearFilters(): void {
    this.status.set('');
    this.type.set('');
    this.home.set('');
    this.reload();
  }

  timeText(c: IAdminCollection): string {
    const f = (d: string) => { const x = new Date(d); return String(x.getDate()).padStart(2, '0') + '/' + String(x.getMonth() + 1).padStart(2, '0'); };
    if (!c.startAt && !c.endAt) return 'Không giới hạn thời gian';
    return `${c.startAt ? f(c.startAt) : '...'} - ${c.endAt ? f(c.endAt) : '...'}`;
  }

  rowMenu(c: IAdminCollection): RowMenuItem[] {
    const items: RowMenuItem[] = [{ key: 'edit', label: 'Sửa', icon: 'edit' }];
    if (c.displayStatus === 'DANG_HIEN') items.push({ key: 'view', label: 'Xem trên cửa hàng', icon: 'eye' });
    if (this.auth.can('BO_SUU_TAP.TAO')) items.push({ key: 'duplicate', label: 'Nhân bản', icon: 'copy' });
    if (this.auth.can('BO_SUU_TAP.SUA')) {
      items.push(c.status === 'HIEN_THI' ? { key: 'HIDE', label: 'Ẩn khỏi website', icon: 'eye-off' } : { key: 'SHOW', label: 'Hiện trên website', icon: 'eye' });
      items.push(c.showOnHome ? { key: 'REMOVE_FROM_HOME', label: 'Gỡ khỏi trang chủ', icon: 'minus' } : { key: 'ADD_TO_HOME', label: 'Hiện trên trang chủ', icon: 'home' });
    }
    if (this.auth.can('BO_SUU_TAP.XOA')) items.push({ key: 'delete', label: 'Xóa', icon: 'trash', danger: true });
    return items;
  }

  onRowMenu(c: IAdminCollection, key: string): void {
    if (key === 'edit') this.router.navigate(['/quan-tri/bo-suu-tap', c._id]);
    else if (key === 'view') window.open('/bo-suu-tap/' + c.slug, '_blank');
    else if (key === 'delete') this.confirmDelete.set({ ids: [c._id!], names: [c.name] });
    else if (key === 'duplicate') {
      this.api.duplicateCollection(c._id!).subscribe({
        next: (copy) => {
          this.toast.show(`Đã tạo bản sao "${copy.name}"`);
          this.router.navigate(['/quan-tri/bo-suu-tap', copy._id]);
        },
        error: (err: ApiError) => this.toast.show(err.message, 'danger'),
      });
    } else this.runBulk(key, [c._id!]);
  }

  onBulk(key: string): void {
    if (key === 'BULK_EDIT') this.router.navigate(['/quan-tri/bo-suu-tap/sua-hang-loat'], { queryParams: { ids: this.sel.ids().join(',') } });
    else if (key === 'DELETE') this.confirmDelete.set({ ids: this.sel.ids(), names: this.sel.ids().map((id) => this.seen.get(id)?.name || '') });
    else this.runBulk(key, this.sel.ids());
  }

  doDelete(): void {
    const ids = this.confirmDelete()!.ids;
    this.confirmDelete.set(null);
    this.runBulk('DELETE', ids);
  }

  runBulk(action: string, ids: string[]): void {
    this.busy.set(true);
    this.api.bulkCollections({ action, ids }).subscribe({
      next: (r) => {
        this.busy.set(false);
        const verb: Record<string, string> = { SHOW: 'hiện', HIDE: 'ẩn', ADD_TO_HOME: 'thêm vào trang chủ', REMOVE_FROM_HOME: 'gỡ khỏi trang chủ', DELETE: 'xóa' };
        const skipped = r.skipped.length ? `. Bỏ qua: ${r.skipped.map((s) => `${s.name} (${s.reason})`).join('; ')}` : '';
        this.toast.show(`Đã ${verb[action]} ${r.updated} bộ sưu tập${skipped}`, r.skipped.length ? 'info' : 'success');
        if (action === 'ADD_TO_HOME') this.toast.show('Thêm khối Bộ sưu tập ở "Trang chủ" để BST xuất hiện trên trang chủ', 'info');
        this.sel.clear();
        this.onlySelected.set(false);
        this.load();
      },
      error: (err: ApiError) => {
        this.busy.set(false);
        this.toast.show(err.message, 'danger');
      },
    });
  }

  goPage(p: number): void {
    this.page.set(p);
    this.load();
  }
}
