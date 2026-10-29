import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AdminVoucherApiService } from '../../../services/admin-voucher-apiservice';
import { ReportApiService } from '../../../services/report-apiservice';
import { AuthService } from '../../../services/auth';
import { ToastService } from '../../../services/toast';
import { ApiError } from '../../../classes/api-error';
import { saveTextFile } from '../../../shared/save-file';
import {
  ExportDataset, GROUP_LABEL, GroupBy, IInsight, IMetric, IOverview, IReportQuery, IReportSections, PRESETS, dmy,
} from '../../../classes/report';

// SCR-40 Tổng quan và báo cáo (UC-CAT-03). Bộ lọc thời gian nằm trên query params (?preset=, ?from=&to=,
// ?groupBy=) nên tải lại trang hay bấm Quay lại vẫn đúng khoảng đang xem (Chương IV). Phần trên theo thiết kế
// (Gợi ý hành động, Thiết lập cửa hàng, 6 chỉ số, biểu đồ, trạng thái, bán chạy, 3 trục); bên dưới các nhóm của BA
// tải song song sau khi phần trên đã hiện. Mục gợi ý đã ẩn và trạng thái "Ẩn khối" chỉ lưu trên trình duyệt.
type Tile = { key: string; label: string; icon: string; metric: IMetric | null; kind: 'money' | 'count' | 'rate'; info?: string; sub?: string };

const DISMISS_KEY = 'sp-dash-dismissed';
const SETUP_KEY = 'sp-dash-setup-hidden';
const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // trình duyệt chặn bộ nhớ: chỉ mất tính năng ghi nhớ
    }
  },
};
const today = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

@Component({
  selector: 'app-dashboard',
  standalone: false,
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  private readonly api = inject(ReportApiService);
  private readonly voucherApi = inject(AdminVoucherApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly auth = inject(AuthService);

  readonly presets = PRESETS;
  readonly groupLabel = GROUP_LABEL;
  readonly groups: GroupBy[] = ['day', 'week', 'month'];
  readonly dmy = dmy;

  readonly query = signal<IReportQuery>({});
  readonly data = signal<IOverview | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly sections = signal<IReportSections>({});
  readonly loadedAt = signal<Date | null>(null);

  // Mục gợi ý đã ẩn trong ngày (theo loại + nội dung)
  readonly dismissed = signal<string[]>(this.readDismissed());
  readonly setupHidden = signal(store.get(SETUP_KEY) === '1');

  // Hộp thoại
  readonly customOpen = signal(false);
  readonly customFrom = signal('');
  readonly customTo = signal('');
  readonly topOpen = signal(false);
  readonly groupMenu = signal(false);
  readonly csvOpen = signal<ExportDataset | null>(null);
  readonly csvKind = signal<'day' | 'product' | 'axis'>('day');
  readonly csvFrom = signal('');
  readonly csvTo = signal('');
  readonly csvBusy = signal(false);

  readonly preset = computed(() => this.data()?.range.preset || this.query().preset || '30-ngay');
  readonly insights = computed(() => (this.data()?.insights || []).filter((i) => !this.dismissed().includes(this.insightKey(i))));
  readonly fin = computed(() => !!this.data()?.canFinance);
  readonly noOrders = computed(() => this.data()?.kpis.orders.value === 0);
  readonly statusMax = computed(() => Math.max(1, ...(this.data()?.statuses || []).map((s) => s.count)));
  readonly totalRevenue = computed(() => (this.data()?.series || []).reduce((s, p) => s + (p.revenue || 0), 0));
  readonly avgRevenue = computed(() => {
    const d = this.data();
    return d ? Math.round(this.totalRevenue() / Math.max(1, d.series.length)) : 0;
  });

  // 6 thẻ của Quản trị; người không xem doanh thu: Số đơn, Cần đóng gói (Kho), Tỷ lệ hoàn tất, Tỷ lệ hủy (thiết kế SCR-40 Kho)
  readonly tiles = computed<Tile[]>(() => {
    const d = this.data();
    if (!d) return [];
    const k = d.kpis;
    const ops: Tile[] = [
      { key: 'completion', label: 'Tỷ lệ hoàn tất', icon: 'check-circle', metric: k.completionRate, kind: 'rate', info: 'Đơn Đã giao và Hoàn thành trên tổng số đơn đặt trong kỳ' },
      { key: 'cancel', label: 'Tỷ lệ hủy', icon: 'x-circle', metric: k.cancelRate, kind: 'rate' },
    ];
    const orders: Tile = { key: 'orders', label: 'Số đơn', icon: 'cart', metric: k.orders, kind: 'count' };
    if (d.canFinance) {
      return [
        { key: 'revenue', label: 'Doanh thu', icon: 'chart', metric: k.revenue, kind: 'money', info: 'Chỉ tính đơn Đã giao và Hoàn thành, trừ tiền đã hoàn' },
        { key: 'collected', label: 'Tiền đã thu', icon: 'store', metric: k.collected, kind: 'money', info: 'Mọi khoản khách đã trả (gồm tiền cọc của đơn chưa giao), trừ tiền đã hoàn' },
        orders,
        { key: 'aov', label: 'Giá trị đơn TB', icon: 'bag', metric: k.aov, kind: 'money', info: 'Doanh thu chia số đơn Đã giao và Hoàn thành' },
        ...ops,
      ];
    }
    const packing: Tile[] = k.packingCount !== null ? [{ key: 'packing', label: 'Cần đóng gói', icon: 'package', metric: null, kind: 'count', sub: `${k.packingCount}` }] : [];
    return [orders, ...packing, ...ops];
  });

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((p) => {
      const q: IReportQuery = {};
      if (p.get('from') && p.get('to')) {
        q.from = p.get('from')!;
        q.to = p.get('to')!;
      } else if (p.get('preset')) q.preset = p.get('preset')!;
      if (p.get('groupBy')) q.groupBy = p.get('groupBy')!;
      this.query.set(q);
      this.load();
    });
  }

  // ===== Tải số liệu =====

  load(): void {
    this.error.set('');
    this.loading.set(!this.data());
    const q = this.query();
    this.api.getOverview(q).subscribe({
      next: (d) => {
        this.data.set(d);
        this.loading.set(false);
        this.loadedAt.set(new Date());
        this.loadSections(q);
      },
      error: (e: ApiError) => {
        this.loading.set(false);
        this.error.set(e.message);
      },
    });
  }

  private loadSections(q: IReportQuery): void {
    this.sections.set({});
    const keys: (keyof IReportSections)[] = ['customers', 'personalization', 'vouchers', 'reviews', 'ai'];
    for (const k of keys) {
      this.api.getSection(k, q).subscribe({
        next: (v) => this.sections.update((s) => ({ ...s, [k]: v })),
        error: () => this.sections.update((s) => ({ ...s, [k]: undefined })),
      });
    }
  }

  // ===== Bộ lọc thời gian =====

  pick(preset: string): void {
    this.router.navigate([], { relativeTo: this.route, queryParams: { preset, from: null, to: null, groupBy: null }, queryParamsHandling: 'merge' });
  }

  openCustom(): void {
    const r = this.data()?.range;
    this.customFrom.set(r?.from || today());
    this.customTo.set(r?.to || today());
    this.customOpen.set(true);
  }

  readonly customError = computed(() => {
    if (!this.customFrom() || !this.customTo()) return 'Chọn đủ ngày bắt đầu và ngày kết thúc';
    if (this.customTo() < this.customFrom()) return 'Ngày kết thúc phải sau ngày bắt đầu'; // 4Ea
    return '';
  });

  applyCustom(): void {
    if (this.customError()) return;
    this.customOpen.set(false);
    this.router.navigate([], { relativeTo: this.route, queryParams: { preset: null, from: this.customFrom(), to: this.customTo(), groupBy: null }, queryParamsHandling: 'merge' });
  }

  setGroup(g: GroupBy): void {
    this.groupMenu.set(false);
    this.router.navigate([], { relativeTo: this.route, queryParams: { groupBy: g }, queryParamsHandling: 'merge' });
  }

  // ===== Gợi ý hành động =====

  insightKey(i: IInsight): string {
    return `${i.type}|${i.message}`;
  }

  dismiss(i: IInsight): void {
    const list = [...this.dismissed(), this.insightKey(i)];
    this.dismissed.set(list);
    store.set(DISMISS_KEY, JSON.stringify({ day: today(), keys: list }));
  }

  private readDismissed(): string[] {
    try {
      const v = JSON.parse(store.get(DISMISS_KEY) || 'null');
      return v && v.day === today() && Array.isArray(v.keys) ? v.keys : [];
    } catch {
      return [];
    }
  }

  actionLabel(i: IInsight): string {
    const labels: Record<string, string> = {
      URGENT_ORDERS: 'Xử lý ngay', URGENT_REQUESTS: 'Xem yêu cầu', STOCKOUT: 'Cập nhật tồn kho', LOW_CONVERSION: 'Xem sản phẩm', EXPIRING: 'Gia hạn',
      VOUCHER: 'Xem voucher', AI_GAPS: 'Xem nhu cầu', MATERIAL: 'Nhập vật liệu', PACKING: 'Xem đơn', STORAGE: 'Xem hàng lưu kho',
    };
    return labels[i.type] || 'Xử lý';
  }

  open(link: string): void {
    this.router.navigateByUrl(link);
  }

  toggleSetup(): void {
    const v = !this.setupHidden();
    this.setupHidden.set(v);
    store.set(SETUP_KEY, v ? '1' : '0');
  }

  // ===== Bấm vào trạng thái: danh sách đơn của trạng thái trong khoảng đang xem (3e) =====

  statusLink(status: string): Record<string, string> {
    const r = this.data()!.range;
    return { orderStatus: status, from: r.from, to: r.to };
  }

  // ===== Xuất CSV (5a) =====

  openCsv(dataset: ExportDataset): void {
    const r = this.data()?.range;
    this.csvKind.set('day');
    this.csvFrom.set(r?.from || today());
    this.csvTo.set(r?.to || today());
    this.csvOpen.set(dataset);
  }

  readonly csvError = computed(() => (!this.csvFrom() || !this.csvTo() ? 'Chọn đủ khoảng thời gian' : this.csvTo() < this.csvFrom() ? 'Ngày kết thúc phải sau ngày bắt đầu' : ''));

  downloadCsv(): void {
    const dataset = this.csvOpen();
    if (!dataset || this.csvError()) return;
    this.csvBusy.set(true);
    this.api.exportCsv(dataset, { from: this.csvFrom(), to: this.csvTo(), kind: dataset === 'revenue' ? this.csvKind() : undefined }).subscribe({
      next: (csv) => {
        this.csvBusy.set(false);
        this.csvOpen.set(null);
        const names: Record<ExportDataset, string> = { orders: 'don-hang', revenue: `doanh-thu-${this.csvKind()}`, 'top-products': 'san-pham-ban-chay', personalization: 'ca-nhan-hoa' };
        saveTextFile(csv, `${names[dataset]}-${this.csvFrom()}-${this.csvTo()}.csv`);
        this.toast.show('Đã tải tệp CSV');
      },
      error: (e: ApiError) => {
        this.csvBusy.set(false);
        this.toast.show(e.message);
      },
    });
  }

  // CSV lượt dùng voucher (API-166) theo khoảng ngày đang xem
  readonly voucherCsvBusy = signal(false);
  downloadVoucherCsv(): void {
    const r = this.data()?.range;
    this.voucherCsvBusy.set(true);
    this.voucherApi.exportUsage([], { from: r?.from, to: r?.to }).subscribe({
      next: (csv) => {
        this.voucherCsvBusy.set(false);
        saveTextFile(csv, `luot-dung-voucher-${r?.from || today()}-${r?.to || today()}.csv`);
        this.toast.show('Đã tải tệp CSV');
      },
      error: (e: ApiError) => {
        this.voucherCsvBusy.set(false);
        this.toast.show(e.message);
      },
    });
  }

  csvTitle(d: ExportDataset): string {
    return { orders: 'Đơn hàng', revenue: 'Doanh thu', 'top-products': 'Sản phẩm bán chạy', personalization: 'Cá nhân hóa' }[d];
  }

  // ===== Hiển thị =====

  fmtNumber(n: number | null | undefined): string {
    return n === null || n === undefined ? '-' : n.toLocaleString('vi-VN');
  }

  fmtRate(n: number | null | undefined): string {
    return n === null || n === undefined ? '-' : `${String(n).replace('.', ',')}%`;
  }

  // "+12,4% so với kỳ trước" hoặc "+1,2 điểm"; tỷ lệ hủy tăng là xấu
  changeText(m: IMetric | null): string {
    if (!m || m.change === null) return '';
    const v = `${m.change > 0 ? '+' : ''}${String(m.change).replace('.', ',')}`;
    return m.changeKind === 'points' ? `${v} điểm` : `${v}%`;
  }

  changeTone(t: Tile): 'up' | 'down' | 'flat' {
    const c = t.metric?.change;
    if (c === null || c === undefined || c === 0) return 'flat';
    const good = t.key === 'cancel' ? c < 0 : c > 0;
    return good ? 'up' : 'down';
  }

  firstOrderText(): string {
    const f = this.data()?.firstOrderAt;
    return f ? new Date(f).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' }) : '';
  }

  pctWidth(part: number, total: number): number {
    return total ? Math.max(part ? 2 : 0, Math.round((part / total) * 100)) : 0;
  }
}
