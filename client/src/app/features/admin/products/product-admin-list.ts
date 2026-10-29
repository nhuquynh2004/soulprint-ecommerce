import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, debounceTime } from 'rxjs';
import { AdminCatalogApiService } from '../../../services/admin-catalog-apiservice';
import { AuthService } from '../../../services/auth';
import { ToastService } from '../../../services/toast';
import { ApiError } from '../../../classes/api-error';
import {
  AXIS_LABEL,
  Axis,
  IAdminCategory,
  IAdminProductList,
  IAdminProductRow,
  IBulkResult,
  PRODUCT_STATUS_LABEL,
  ProductStatus,
  STOCK_LABEL,
  StockStatus,
} from '../../../classes/admin-catalog';
import { Selection } from '../shared/selection';
import { BulkAction } from '../shared/bulk-bar/bulk-bar';
import { RowMenuItem } from '../shared/row-menu/row-menu';
import { FilterChip } from '../shared/filter-chips/filter-chips';

// SCR-41 Sản phẩm (UC-CAT-01 bước 1, nhánh 1f, 1g): tab theo trạng thái, tìm theo tên/SKU, lọc danh mục, mức tồn,
// trục đam mê, tag; sắp xếp; mở tồn theo biến thể; chọn nhiều + thao tác hàng loạt (API-161); xuất CSV (API-162).
@Component({
  selector: 'app-product-admin-list',
  standalone: false,
  templateUrl: './product-admin-list.html',
  styleUrl: './product-admin-list.scss',
})
export class ProductAdminList {
  private readonly api = inject(AdminCatalogApiService);
  protected readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly statusLabel = PRODUCT_STATUS_LABEL;
  readonly stockLabel = STOCK_LABEL;
  readonly axisLabel = AXIS_LABEL;
  readonly tabs: { key: ProductStatus | ''; label: string }[] = [
    { key: '', label: 'Tất cả' },
    { key: 'DANG_HIEN_THI', label: 'Đang bán' },
    { key: 'BAN_NHAP', label: 'Bản nháp' },
    { key: 'DA_AN', label: 'Ẩn' },
    { key: 'NGUNG_BAN', label: 'Lưu trữ' },
  ];

  // Bộ lọc và trang
  readonly status = signal<ProductStatus | ''>('');
  readonly q = signal('');
  readonly category = signal('');
  readonly stockStatus = signal<StockStatus | ''>('');
  readonly axis = signal<Axis | ''>('');
  readonly sort = signal('');
  readonly page = signal(1);
  readonly showFilter = signal(false);
  private readonly search$ = new Subject<string>();

  readonly data = signal<IAdminProductList | null>(null);
  readonly categories = signal<IAdminCategory[]>([]);
  readonly loading = signal(true);
  readonly errMessage = signal('');
  readonly expanded = signal<string | null>(null);

  readonly sel = new Selection();
  readonly pageIds = computed(() => (this.data()?.items || []).map((p) => p._id));
  readonly busy = signal(false);
  readonly result = signal<{ text: string; skipped: IBulkResult['skipped']; canArchive: boolean } | null>(null);

  // Hộp thoại
  readonly confirmDelete = signal<{ ids: string[]; names: string[] } | null>(null);
  readonly stockDialog = signal(false);
  readonly tagDialog = signal(false);

  readonly flatCategories = computed(() => this.categories().flatMap((c) => [c, ...(c.children || []).map((k) => ({ ...k, name: '— ' + k.name }))]));

  readonly chips = computed<FilterChip[]>(() => {
    const out: FilterChip[] = [];
    if (this.category()) out.push({ key: 'category', label: 'Danh mục: ' + (this.flatCategories().find((c) => c._id === this.category())?.name.replace('— ', '') || '') });
    if (this.stockStatus()) out.push({ key: 'stockStatus', label: 'Tồn kho: ' + STOCK_LABEL[this.stockStatus() as StockStatus] });
    if (this.axis()) out.push({ key: 'axis', label: 'Trục: ' + AXIS_LABEL[this.axis() as Axis] });
    return out;
  });

  readonly bulkActions = computed<BulkAction[]>(() => {
    const a: BulkAction[] = [];
    if (this.auth.can('SAN_PHAM.SUA')) a.push({ key: 'SHOW', label: 'Hiện', icon: 'eye' }, { key: 'HIDE', label: 'Ẩn', icon: 'eye-off' });
    if (this.auth.can('SAN_PHAM.XOA')) a.push({ key: 'ARCHIVE', label: 'Lưu trữ', icon: 'archive' });
    if (this.auth.can('TAGS.SUA')) a.push({ key: 'TAGS', label: 'Gắn tag', icon: 'tag' });
    if (this.auth.can('SAN_PHAM.CAP_NHAT_TON')) a.push({ key: 'STOCK', label: 'Cập nhật tồn kho', icon: 'package' });
    if (this.auth.can('SAN_PHAM.XOA')) a.push({ key: 'DELETE', label: 'Xóa', icon: 'trash', danger: true });
    return a;
  });

  constructor() {
    this.search$.pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef)).subscribe((v) => {
      this.q.set(v);
      this.reload();
    });
    this.api.getCategories().subscribe({ next: (c) => this.categories.set(c), error: () => {} });
    // ?q= từ ô tìm trên thanh đầu khu quản trị; không có thì tải như cũ
    inject(ActivatedRoute).queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((p) => {
      const q = p.get('q');
      if (q !== null) this.q.set(q);
      this.reload();
    });
  }

  load(): void {
    this.loading.set(!this.data());
    this.errMessage.set('');
    this.api
      .getProducts({
        q: this.q(),
        status: this.status(),
        category: this.category(),
        stockStatus: this.stockStatus(),
        axis: this.axis(),
        sort: this.sort(),
        page: this.page(),
      })
      .subscribe({
        next: (d) => {
          this.data.set(d);
          this.loading.set(false);
        },
        error: (err: ApiError) => {
          this.errMessage.set(err.message);
          this.loading.set(false);
        },
      });
  }

  // Đổi bộ lọc thì về trang 1
  reload(): void {
    this.page.set(1);
    this.load();
  }

  setTab(s: ProductStatus | ''): void {
    this.status.set(s);
    this.reload();
  }

  onSearch(v: string): void {
    this.search$.next(v.trim());
  }

  setFilter(key: 'category' | 'stockStatus' | 'axis', value: string): void {
    (this[key] as any).set(value);
    this.reload();
  }

  removeChip(key: string): void {
    this.setFilter(key as 'category' | 'stockStatus' | 'axis', '');
  }

  clearFilters(): void {
    this.category.set('');
    this.stockStatus.set('');
    this.axis.set('');
    this.reload();
  }

  // Bấm tiêu đề cột: lần 1 tăng dần, lần 2 giảm dần
  sortBy(key: 'ten' | 'gia' | 'ton'): void {
    this.sort.set(this.sort() === key ? '-' + key : key);
    this.reload();
  }

  sortIcon(key: string): string {
    return this.sort() === key ? 'chevron-up' : this.sort() === '-' + key ? 'chevron-down' : 'sort';
  }

  goPage(p: number): void {
    this.page.set(p);
    this.load();
  }

  toggleExpand(id: string): void {
    this.expanded.set(this.expanded() === id ? null : id);
  }

  rowMenu(p: IAdminProductRow): RowMenuItem[] {
    const items: RowMenuItem[] = [{ key: 'edit', label: 'Sửa', icon: 'edit' }];
    if (p.slug && p.status === 'DANG_HIEN_THI') items.push({ key: 'view', label: 'Xem trên cửa hàng', icon: 'eye' });
    if (this.auth.can('SAN_PHAM.TAO')) items.push({ key: 'duplicate', label: 'Nhân bản', icon: 'copy' });
    if (this.auth.can('SAN_PHAM.SUA')) {
      if (p.status === 'DANG_HIEN_THI') items.push({ key: 'HIDE', label: 'Ẩn', icon: 'eye-off' });
      else if (p.status !== 'BAN_NHAP') items.push({ key: 'SHOW', label: 'Hiển thị lại', icon: 'eye' });
    }
    if (this.auth.can('SAN_PHAM.XOA')) {
      if (p.status !== 'NGUNG_BAN') items.push({ key: 'ARCHIVE', label: 'Lưu trữ', icon: 'archive' });
      if (!p.hasOrders) items.push({ key: 'delete', label: 'Xóa', icon: 'trash', danger: true });
    }
    return items;
  }

  onRowMenu(p: IAdminProductRow, key: string): void {
    if (key === 'edit') this.router.navigate(['/quan-tri/san-pham', p._id]);
    else if (key === 'view') window.open('/san-pham/' + p.slug, '_blank');
    else if (key === 'duplicate') this.duplicate(p);
    else if (key === 'delete') this.confirmDelete.set({ ids: [p._id], names: [p.name] });
    else this.runBulk(key, [p._id]);
  }

  duplicate(p: IAdminProductRow): void {
    this.api.duplicateProduct(p._id).subscribe({
      next: (r) => {
        this.toast.show(`Đã tạo bản sao "${r.product.name}"`);
        this.router.navigate(['/quan-tri/san-pham', r.product._id]);
      },
      error: (err: ApiError) => this.toast.show(err.message, 'danger'),
    });
  }

  onBulk(key: string): void {
    const ids = this.sel.ids();
    if (key === 'DELETE') this.confirmDelete.set({ ids, names: this.selectedRows().map((p) => p.name) });
    else if (key === 'STOCK') this.stockDialog.set(true);
    else if (key === 'TAGS') this.tagDialog.set(true);
    else this.runBulk(key, ids);
  }

  doDelete(): void {
    const ids = this.confirmDelete()!.ids;
    this.confirmDelete.set(null);
    this.runBulk('DELETE', ids);
  }

  runBulk(action: string, ids: string[]): void {
    if (!ids.length) return;
    this.busy.set(true);
    this.api.bulkProducts({ action, ids }).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.showResult(action, r);
        this.sel.clear();
        this.load();
      },
      error: (err: ApiError) => {
        this.busy.set(false);
        this.toast.show(err.message, 'danger');
      },
    });
  }

  // Báo kết quả: số thành công + từng mục bị bỏ qua kèm lý do (SCR-41-DaXoa); xóa bị chặn vì đã có đơn thì gợi ý Lưu trữ
  private showResult(action: string, r: IBulkResult): void {
    const verb: Record<string, string> = { SHOW: 'hiện', HIDE: 'ẩn', ARCHIVE: 'lưu trữ', DELETE: 'xóa' };
    const text = `Đã ${verb[action] || 'cập nhật'} ${r.updated} sản phẩm`;
    if (!r.skipped.length) {
      this.result.set(null);
      this.toast.show(text);
      return;
    }
    this.result.set({ text, skipped: r.skipped, canArchive: action === 'DELETE' && this.auth.can('SAN_PHAM.XOA') });
  }

  archiveSkipped(): void {
    const ids = this.result()!.skipped.map((s) => s.id);
    this.result.set(null);
    this.runBulk('ARCHIVE', ids);
  }

  onDialogDone(message: string): void {
    this.stockDialog.set(false);
    this.tagDialog.set(false);
    if (message) {
      this.toast.show(message);
      this.sel.clear();
      this.load();
    }
  }

  exportCsv(): void {
    window.location.href = this.api.exportUrl(this.sel.ids());
  }

  selectedRows(): IAdminProductRow[] {
    return (this.data()?.items || []).filter((p) => this.sel.has(p._id));
  }

  summary(): string {
    const d = this.data();
    if (!d) return '';
    const s = d.stockCounts;
    return `${d.counts['ALL'] || 0} sản phẩm | ${s['SAP_HET'] || 0} sắp hết hàng | ${s['HET_HANG'] || 0} hết hàng`;
  }
}
