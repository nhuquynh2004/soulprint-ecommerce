import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { onTabVisible } from '../../../services/order-sync';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, debounceTime } from 'rxjs';
import { AdminOrderApiService } from '../../../services/admin-order-apiservice';
import { AuthService } from '../../../services/auth';
import { ToastService } from '../../../services/toast';
import { ApiError } from '../../../classes/api-error';
import {
  CARRIERS, IAdminOrderRow, IOrderMetric, IPackingSlip, ORDER_VIEWS, OrderView, PAYMENT_STATUS_LABEL, PRIORITY_LABEL, SOURCES,
} from '../../../classes/admin-order';
import { ORDER_STATUS_LABEL } from '../../../classes/order';
import { Selection } from '../shared/selection';
import { BulkAction } from '../shared/bulk-bar/bulk-bar';
import { FilterChip } from '../shared/filter-chips/filter-chips';
import { ColumnDef, ColumnState } from '../shared/column-manager/column-manager';
import { RowMenuItem } from '../shared/row-menu/row-menu';
import { saveTextFile } from '../../../shared/save-file';

// Bộ lọc của nút "Bộ lọc" (UC-OPS-01 bước 3), đồng bộ lên query params (Chương IV) để tải lại vẫn giữ
const FILTER_KEYS = ['orderStatus', 'paymentStatus', 'paymentMethod', 'personalized', 'source', 'carrier', 'tag', 'from', 'to'] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

// SCR-47 Đơn hàng (UC-OPS-01): thanh Phân tích ẩn/hiện (API-158), tab nhanh có đếm, tìm + Bộ lọc dạng chip, bảng xếp
// theo ưu tiên BR-32, Quản lý cột, ô chọn + thanh thao tác hàng loạt (API-159), thao tác nhanh In phiếu, Ghi chú.
@Component({
  selector: 'app-order-list',
  standalone: false,
  templateUrl: './order-list.html',
  styleUrl: './order-list.scss',
})
export class OrderList {
  private readonly api = inject(AdminOrderApiService);
  protected readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly views = ORDER_VIEWS;
  readonly statusLabel = ORDER_STATUS_LABEL;
  readonly paymentLabel = PAYMENT_STATUS_LABEL;
  readonly priorityLabel = PRIORITY_LABEL;
  readonly carriers = CARRIERS;
  readonly sources = SOURCES;
  readonly orderStatuses = Object.entries(ORDER_STATUS_LABEL).map(([key, label]) => ({ key, label }));
  readonly paymentStatuses = Object.entries(PAYMENT_STATUS_LABEL).map(([key, label]) => ({ key, label }));

  readonly columns: ColumnDef[] = [
    { key: 'priority', label: 'Ưu tiên' },
    { key: 'code', label: 'Mã đơn', required: true },
    { key: 'customer', label: 'Khách hàng' },
    { key: 'qty', label: 'SL' },
    { key: 'total', label: 'Tổng tiền' },
    { key: 'status', label: 'Trạng thái' },
    { key: 'tags', label: 'Thẻ' },
  ];
  readonly shownColumns = signal<string[]>(this.columns.map((c) => c.key));

  readonly view = signal<OrderView>('all');
  readonly q = signal('');
  readonly filters = signal<Partial<Record<FilterKey, string>>>({});
  readonly sort = signal('');
  readonly page = signal(1);
  private readonly search$ = new Subject<string>();

  readonly items = signal<IAdminOrderRow[]>([]);
  readonly counts = signal<Record<string, number>>({});
  readonly total = signal(0);
  readonly pageSize = signal(20);
  readonly monthCount = signal(0);
  readonly knownTags = signal<string[]>([]);
  readonly loading = signal(true);
  readonly errMessage = signal('');

  readonly showStats = signal(false);
  readonly statDays = signal<7 | 30>(7);
  readonly metrics = signal<IOrderMetric[]>([]);
  readonly filterOpen = signal(false);
  readonly draftFilters = signal<Partial<Record<FilterKey, string>>>({});

  readonly sel = new Selection();
  readonly busy = signal(false);
  readonly tagDialog = signal<{ action: 'ADD_TAGS' | 'REMOVE_TAGS'; codes: string[] } | null>(null);
  readonly tagInput = signal('');
  readonly noteFor = signal<IAdminOrderRow | null>(null);
  readonly noteText = signal('');
  readonly slips = signal<IPackingSlip[] | null>(null);
  readonly hovered = signal<string | null>(null);

  readonly pageCodes = computed(() => this.items().map((o) => o.code));

  readonly bulkActions = computed<BulkAction[]>(() => {
    const a: BulkAction[] = [
      { key: 'ADD_TAGS', label: 'Gắn thẻ', icon: 'tag' },
      { key: 'REMOVE_TAGS', label: 'Gỡ thẻ', icon: 'x-circle' },
    ];
    if (this.auth.can('DON_HANG.IN_PHIEU')) a.push({ key: 'PRINT', label: 'In phiếu đóng gói', icon: 'file' });
    a.push({ key: 'EXPORT', label: 'Xuất CSV', icon: 'upload' });
    // Chép đúng 1 đơn sang đơn nháp mới (giỏ hàng và thông tin giao hàng)
    if (this.auth.can('DON_NHAP.TAO')) a.push({ key: 'COPY_DRAFT', label: 'Chép vào đơn nháp', icon: 'file', ...(this.sel.count() === 1 ? {} : { disabledHint: 'Chọn đúng 1 đơn để chép vào đơn nháp' }) });
    return a;
  });

  readonly chips = computed<FilterChip[]>(() => {
    const f = this.filters();
    const out: FilterChip[] = [];
    const name = (list: { key: string; label: string }[], v: string) => v.split(',').map((x) => list.find((i) => i.key === x)?.label || x).join(', ');
    if (f.orderStatus) out.push({ key: 'orderStatus', label: 'Trạng thái: ' + name(this.orderStatuses, f.orderStatus) });
    if (f.paymentStatus) out.push({ key: 'paymentStatus', label: 'Thanh toán: ' + name(this.paymentStatuses, f.paymentStatus) });
    if (f.paymentMethod) out.push({ key: 'paymentMethod', label: f.paymentMethod === 'COD' ? 'Phương thức: COD' : 'Phương thức: Online' });
    if (f.personalized) out.push({ key: 'personalized', label: f.personalized === 'true' ? 'Có cá nhân hóa' : 'Không cá nhân hóa' });
    if (f.source) out.push({ key: 'source', label: 'Nguồn: ' + name(this.sources, f.source) });
    if (f.carrier) out.push({ key: 'carrier', label: 'ĐVVC: ' + name(this.carriers, f.carrier) });
    if (f.tag) out.push({ key: 'tag', label: 'Thẻ: ' + f.tag });
    if (f.from || f.to) out.push({ key: 'date', label: `Ngày: ${this.ddmm(f.from) || '...'} - ${this.ddmm(f.to) || '...'}` });
    return out;
  });

  readonly urgentCount = computed(() => this.counts()['urgent'] || 0);
  readonly viewHint = computed(() => ORDER_VIEWS.find((v) => v.key === this.view())?.hint || '');

  constructor() {
    // Quay lại tab thì làm mới danh sách
    onTabVisible(this.destroyRef, () => this.load());
    this.search$.pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef)).subscribe((v) => {
      this.q.set(v);
      this.page.set(1);
      this.pushQuery();
    });
    // Query params là nguồn sự thật của bộ lọc (Chương IV): bấm Quay lại của trình duyệt vẫn về đúng bộ lọc
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((p) => {
      const v = p.get('view') as OrderView | null;
      this.view.set(v && ORDER_VIEWS.some((x) => x.key === v) ? v : 'all');
      this.q.set(p.get('q') || '');
      this.sort.set(p.get('sort') || '');
      this.page.set(Math.max(1, Number(p.get('page')) || 1));
      const f: Partial<Record<FilterKey, string>> = {};
      for (const k of FILTER_KEYS) if (p.get(k)) f[k] = p.get(k)!;
      this.filters.set(f);
      this.load();
    });
  }

  load(): void {
    this.errMessage.set('');
    this.loading.set(!this.items().length);
    this.api.getOrders({ view: this.view(), q: this.q(), sort: this.sort(), page: this.page(), ...this.filters() }).subscribe({
      next: (d) => {
        this.items.set(d.items);
        this.counts.set(d.counts);
        this.total.set(d.total);
        this.pageSize.set(d.pageSize);
        this.monthCount.set(d.monthCount);
        this.knownTags.set(d.tags);
        this.loading.set(false);
      },
      error: (err: ApiError) => {
        this.errMessage.set(err.message);
        this.loading.set(false);
      },
    });
  }

  private pushQuery(): void {
    const qp: Record<string, string | null> = { view: this.view() === 'all' ? null : this.view(), q: this.q() || null, sort: this.sort() || null, page: this.page() > 1 ? String(this.page()) : null };
    for (const k of FILTER_KEYS) qp[k] = this.filters()[k] || null;
    this.router.navigate([], { relativeTo: this.route, queryParams: qp });
  }

  onSearch(v: string): void {
    this.search$.next(v.trim());
  }

  setView(v: OrderView): void {
    this.view.set(v);
    this.page.set(1);
    this.sel.clear();
    this.pushQuery();
  }

  setSort(v: string): void {
    this.sort.set(v);
    this.page.set(1);
    this.pushQuery();
  }

  goPage(p: number): void {
    this.page.set(p);
    this.pushQuery();
  }

  // ===== Bộ lọc =====

  openFilter(): void {
    this.draftFilters.set({ ...this.filters() });
    this.filterOpen.set(!this.filterOpen());
  }

  setDraft(key: FilterKey, value: string): void {
    this.draftFilters.update((f) => ({ ...f, [key]: value || undefined }));
  }

  // Ô chọn nhiều giá trị (trạng thái, thanh toán, nguồn, ĐVVC) lưu dạng "A,B"
  toggleDraft(key: FilterKey, value: string): void {
    const cur = (this.draftFilters()[key] || '').split(',').filter(Boolean);
    const next = cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value];
    this.setDraft(key, next.join(','));
  }

  hasDraft(key: FilterKey, value: string): boolean {
    return (this.draftFilters()[key] || '').split(',').includes(value);
  }

  applyFilter(): void {
    this.filters.set(Object.fromEntries(Object.entries(this.draftFilters()).filter(([, v]) => v)));
    this.filterOpen.set(false);
    this.page.set(1);
    this.pushQuery();
  }

  removeChip(key: string): void {
    this.filters.update((f) => {
      const next = { ...f };
      if (key === 'date') {
        delete next.from;
        delete next.to;
      } else delete next[key as FilterKey];
      return next;
    });
    this.page.set(1);
    this.pushQuery();
  }

  clearFilters(): void {
    this.filters.set({});
    this.page.set(1);
    this.pushQuery();
  }

  ddmm(ymd?: string): string {
    return ymd ? ymd.slice(8, 10) + '/' + ymd.slice(5, 7) : '';
  }

  // ===== Phân tích =====

  toggleStats(): void {
    this.showStats.set(!this.showStats());
    if (this.showStats() && !this.metrics().length) this.loadStats();
  }

  setDays(d: 7 | 30): void {
    this.statDays.set(d);
    this.loadStats();
  }

  loadStats(): void {
    this.api.getStats(this.statDays()).subscribe({
      next: (r) => this.metrics.set(r.metrics),
      error: (err: ApiError) => this.toast.show(err.message, 'danger'),
    });
  }

  metricValue(m: IOrderMetric): string {
    return m.unit ? `${m.value.toLocaleString('vi-VN')} ${m.unit}` : m.value.toLocaleString('vi-VN');
  }

  // Thay đổi so với kỳ trước: % (số đơn) hoặc chênh tuyệt đối (giờ, đổi trả)
  metricChange(m: IOrderMetric): string {
    if (m.key === 'returns') {
      const d = m.value - m.previous;
      return `${d >= 0 ? '+' : ''}${d} đơn`;
    }
    if (m.change === null) return 'Kỳ trước 0';
    const s = m.change.toLocaleString('vi-VN');
    return m.unit ? `${m.change >= 0 ? '+' : ''}${s} ${m.unit}` : `${m.change >= 0 ? '+' : ''}${s}%`;
  }

  // Tăng là tốt với số đơn; giảm là tốt với thời gian xử lý và đổi trả
  metricGood(m: IOrderMetric): boolean {
    const up = m.value >= m.previous;
    return m.key === 'avgHours' || m.key === 'returns' ? !up : up;
  }

  // ===== Bảng =====

  onColumns(state: ColumnState[]): void {
    this.shownColumns.set(state.filter((c) => c.visible).map((c) => c.key));
  }

  priorityClass(o: IAdminOrderRow): string {
    return o.priority === 'KHAN_CAP' ? 'urgent' : o.priority === 'CAN_CHU_Y' ? 'attention' : 'normal';
  }

  // Hạn xử lý viết rõ còn hay quá: "Còn 44 giờ", "Quá hạn 5 ngày"
  deadlineText(o: IAdminOrderRow): string {
    const t = o.slaRemaining;
    if (!t) return '';
    return t.startsWith('Quá ') ? 'Quá hạn ' + t.slice(4) : 'Còn ' + t;
  }

  overdue(o: IAdminOrderRow): boolean {
    return !!o.slaRemaining?.startsWith('Quá ');
  }

  // Thao tác nhanh: Xem chi tiết, In phiếu hiện sẵn; các thao tác còn lại trong "..."
  rowMenu(o: IAdminOrderRow): RowMenuItem[] {
    return [
      { key: 'note', label: o.noteCount ? `Ghi chú nội bộ (${o.noteCount})` : 'Thêm ghi chú nội bộ', icon: 'edit' },
      { key: 'tag', label: 'Gắn thẻ', icon: 'tag' },
      { key: 'csv', label: 'Xuất CSV', icon: 'upload' },
    ];
  }

  onRowMenu(o: IAdminOrderRow, key: string): void {
    if (key === 'note') this.openNote(o);
    else if (key === 'tag') this.openTag('ADD_TAGS', [o.code]);
    else if (key === 'csv') this.exportCsv([o.code]);
  }

  onBulk(key: string): void {
    const codes = this.sel.ids();
    if (key === 'ADD_TAGS' || key === 'REMOVE_TAGS') this.openTag(key, codes);
    else if (key === 'PRINT') this.print(codes);
    else if (key === 'EXPORT') this.exportCsv(codes);
    else if (key === 'COPY_DRAFT' && codes.length === 1) this.copyToDraft(codes[0]);
  }

  // API-224: tạo đơn nháp từ đơn đã chọn rồi mở form đơn nháp
  copyToDraft(code: string): void {
    this.busy.set(true);
    this.api.copyToDraft(code).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.toast.show(r.skipped.length ? `Đã tạo đơn nháp ${r.draftCode}. Không chép được: ${r.skipped.join(', ')}` : `Đã chép đơn ${code} vào đơn nháp ${r.draftCode}`, r.skipped.length ? 'info' : 'success');
        this.router.navigate(['/quan-tri/don-nhap', r.draftCode]);
      },
      error: (err: ApiError) => {
        this.busy.set(false);
        this.toast.show(err.message, 'danger');
      },
    });
  }

  openTag(action: 'ADD_TAGS' | 'REMOVE_TAGS', codes: string[]): void {
    this.tagInput.set('');
    this.tagDialog.set({ action, codes });
  }

  applyTag(): void {
    const d = this.tagDialog()!;
    const tag = this.tagInput().trim();
    if (!tag) return;
    this.busy.set(true);
    this.api.bulkOrders({ codes: d.codes, action: d.action, tags: [tag] }).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.tagDialog.set(null);
        const skip = r.failed.length ? `. Bỏ qua ${r.failed.length}: ${r.failed.map((f) => f.code + ' - ' + f.reason).join('; ')}` : '';
        this.toast.show(`${d.action === 'ADD_TAGS' ? 'Đã gắn' : 'Đã gỡ'} thẻ "${tag}" cho ${r.updated} đơn${skip}`, r.failed.length ? 'info' : 'success');
        this.sel.clear();
        this.load();
      },
      error: (err: ApiError) => {
        this.busy.set(false);
        this.toast.show(err.message, 'danger');
      },
    });
  }

  print(codes: string[]): void {
    this.api.bulkOrders({ codes, action: 'PRINT_PACKING_SLIP' }).subscribe({
      next: (r) => {
        if (r.failed.length) this.toast.show(`Bỏ qua ${r.failed.map((f) => f.code + ' (' + f.reason + ')').join(', ')}`, 'info');
        if (r.slips?.length) this.slips.set(r.slips);
      },
      error: (err: ApiError) => this.toast.show(err.message, 'danger'),
    });
  }

  exportCsv(codes: string[]): void {
    this.api.exportCsv(codes).subscribe({
      next: (csv) => {
        saveTextFile(csv, `don-hang-${new Date().toISOString().slice(0, 10)}.csv`);
        this.toast.show(`Đã tải tệp CSV ${codes.length} đơn, mở được bằng Excel`);
      },
      error: (err: ApiError) => this.toast.show(err.message, 'danger'),
    });
  }

  // Ghi chú nhanh từ danh sách (UC-OPS-01 5b)
  openNote(o: IAdminOrderRow): void {
    this.noteText.set('');
    this.noteFor.set(o);
  }

  saveNote(): void {
    const o = this.noteFor()!;
    const text = this.noteText().trim();
    if (!text) return;
    this.busy.set(true);
    this.api.addNote(o.code, text, []).subscribe({
      next: () => {
        this.busy.set(false);
        this.noteFor.set(null);
        this.toast.show(`Đã thêm ghi chú cho ${o.code}`);
        this.load();
      },
      error: (err: ApiError) => {
        this.busy.set(false);
        this.toast.show(err.message, 'danger');
      },
    });
  }
}
