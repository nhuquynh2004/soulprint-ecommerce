import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { Subject, debounceTime } from 'rxjs';
import { AdminOrderApiService } from '../../../services/admin-order-apiservice';
import { AuthService } from '../../../services/auth';
import { ToastService } from '../../../services/toast';
import { ApiError } from '../../../classes/api-error';
import { DRAFT_STATUS_LABEL, DraftStatus, IDraftRow, SOURCES, URGENT_STATUS_LABEL } from '../../../classes/admin-order';
import { Selection } from '../shared/selection';
import { BulkAction } from '../shared/bulk-bar/bulk-bar';

// SCR-49 danh sách đơn nháp (UC-OPS-02 bước 1, 1b, 1c): tab trạng thái có đếm, tìm, lọc nguồn; cột mã #D,
// ghi chú, ngày, khách (xổ xem số đơn, email, SĐT, "Xem khách hàng"), trạng thái, tổng, thẻ, nguồn; thao tác hàng loạt
// Kích hoạt đơn nháp, Gửi lại liên kết, Gắn thẻ, Xóa nháp (API-193).
@Component({
  selector: 'app-draft-list',
  standalone: false,
  templateUrl: './draft-list.html',
  styleUrl: './draft-list.scss',
})
export class DraftList {
  private readonly api = inject(AdminOrderApiService);
  protected readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly statusLabel = DRAFT_STATUS_LABEL;
  readonly sources = SOURCES.filter((s) => s.key !== 'WEBSITE');
  readonly urgentLabel = URGENT_STATUS_LABEL;
  // Tab "Đặt gấp" lọc theo loại đơn nháp, không theo trạng thái
  readonly tabs: (DraftStatus | '' | 'DAT_GAP')[] = ['', 'DAT_GAP', 'MO', 'DA_GUI_LINK', 'HOAN_TAT'];

  readonly status = signal<DraftStatus | '' | 'DAT_GAP'>('');
  readonly source = signal('');
  readonly q = signal('');
  readonly page = signal(1);
  private readonly search$ = new Subject<string>();

  readonly items = signal<IDraftRow[]>([]);
  readonly counts = signal<Record<string, number>>({});
  readonly total = signal(0);
  readonly pageSize = signal(20);
  readonly loading = signal(true);
  readonly errMessage = signal('');
  readonly busy = signal(false);
  readonly openCustomer = signal<string | null>(null);

  readonly sel = new Selection();
  readonly confirmDelete = signal<string[] | null>(null);
  readonly tagFor = signal<string[] | null>(null);
  readonly tagInput = signal('');
  readonly result = signal<{ orders: string[]; links: { code: string; paymentUrl: string; expiresAt: string; amount: number }[]; failed: { code: string; reason: string }[]; action: string } | null>(null);

  readonly pageCodes = computed(() => this.items().map((d) => d.code));
  readonly bulkActions = computed<BulkAction[]>(() => {
    const a: BulkAction[] = [];
    if (this.auth.can('DON_NHAP.KICH_HOAT')) a.push({ key: 'COMPLETE', label: 'Kích hoạt đơn nháp', icon: 'check-circle' }, { key: 'RESEND_LINK', label: 'Gửi lại liên kết', icon: 'link' });
    if (this.auth.can('DON_NHAP.SUA')) a.push({ key: 'ADD_TAGS', label: 'Gắn thẻ', icon: 'tag' });
    if (this.auth.can('DON_NHAP.XOA')) a.push({ key: 'DELETE', label: 'Xóa nháp', icon: 'trash', danger: true });
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
    const urgent = this.status() === 'DAT_GAP';
    this.api.getDrafts({ status: urgent ? '' : this.status(), kind: urgent ? 'DAT_GAP' : '', source: this.source(), q: this.q(), page: this.page() }).subscribe({
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

  reload(): void {
    this.page.set(1);
    this.load();
  }

  onSearch(v: string): void {
    this.search$.next(v.trim());
  }

  setTab(s: DraftStatus | '' | 'DAT_GAP'): void {
    this.status.set(s);
    this.sel.clear();
    this.reload();
  }

  setSource(s: string): void {
    this.source.set(s);
    this.reload();
  }

  goPage(p: number): void {
    this.page.set(p);
    this.load();
  }

  sourceLabel(key: string | null): string {
    return SOURCES.find((s) => s.key === key)?.label || '-';
  }

  open(d: IDraftRow): void {
    this.router.navigate(['/quan-tri/don-nhap', d.code]);
  }

  onBulk(key: string): void {
    const codes = this.sel.ids();
    if (key === 'DELETE') this.confirmDelete.set(codes);
    else if (key === 'ADD_TAGS') {
      this.tagInput.set('');
      this.tagFor.set(codes);
    } else this.run(key, codes);
  }

  run(action: string, codes: string[], tags?: string[]): void {
    this.busy.set(true);
    this.api.bulkDrafts({ codes, action, tags }).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.confirmDelete.set(null);
        this.tagFor.set(null);
        this.sel.clear();
        if (action === 'COMPLETE' || action === 'RESEND_LINK') this.result.set({ ...r, action });
        else this.toast.show(`Đã ${action === 'DELETE' ? 'xóa' : 'gắn thẻ cho'} ${r.updated} đơn nháp${r.failed.length ? '. Bỏ qua: ' + r.failed.map((f) => '#' + f.code + ' ' + f.reason).join('; ') : ''}`, r.failed.length ? 'info' : 'success');
        this.load();
      },
      error: (err: ApiError) => {
        this.busy.set(false);
        this.toast.show(err.message, 'danger');
      },
    });
  }

  copy(text: string): void {
    navigator.clipboard?.writeText(location.origin + text).then(() => this.toast.show('Đã sao chép liên kết'));
  }
}
