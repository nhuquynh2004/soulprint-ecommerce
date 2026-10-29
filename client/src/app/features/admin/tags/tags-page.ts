import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { Subject, debounceTime, forkJoin } from 'rxjs';
import { AdminCatalogApiService } from '../../../services/admin-catalog-apiservice';
import { AuthService } from '../../../services/auth';
import { ToastService } from '../../../services/toast';
import { ApiError } from '../../../classes/api-error';
import { IAdminProductRow, IAdminTag, IAiGap, ITagGroup } from '../../../classes/admin-catalog';
import { RowMenuItem } from '../shared/row-menu/row-menu';
import { Selection } from '../shared/selection';
import { VndPipe } from '../../../shared/vnd-pipe';

// SCR-44 Tags và dữ liệu gợi ý (UC-CAT-04): tab "Tags theo nhóm" (thẻ từng nhóm, chip tag kèm số sản phẩm,
// menu nhóm: Sửa nhóm / Ẩn-Hiện trên bộ lọc khách / Xóa nhóm tự tạo), "Gắn tag hàng loạt" (API-79),
// "Nhu cầu chưa đáp ứng" (aiGaps, API-80, API-81).
@Component({
  selector: 'app-tags-page',
  standalone: false,
  templateUrl: './tags-page.html',
  styleUrl: './tags-page.scss',
})
export class TagsPage {
  private readonly api = inject(AdminCatalogApiService);
  protected readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly vnd = new VndPipe();

  readonly tab = signal<'groups' | 'bulk' | 'gaps'>('groups');
  readonly groups = signal<ITagGroup[]>([]);
  readonly tags = signal<IAdminTag[]>([]);
  readonly gaps = signal<IAiGap[]>([]);
  readonly gapCounts = signal({ MOI: 0, DA_XU_LY: 0 });
  readonly gapQ = signal('');
  readonly gapStatus = signal<'MOI' | 'DA_XU_LY' | ''>('MOI');
  private readonly gapSearch$ = new Subject<string>();
  readonly loading = signal(true);
  readonly errMessage = signal('');
  readonly q = signal('');

  // Hộp thoại
  readonly editingGroup = signal<ITagGroup | 'new' | null>(null);
  readonly editingTag = signal<{ tag: IAdminTag | null; group: ITagGroup } | null>(null);
  readonly deletingGroup = signal<ITagGroup | null>(null);

  // Tab Gắn tag hàng loạt
  readonly products = signal<IAdminProductRow[]>([]);
  readonly productQ = signal('');
  readonly productsLoading = signal(false);
  readonly sel = new Selection();
  readonly tagDialog = signal(false);
  private readonly search$ = new Subject<string>();

  // Số trên tab: mọi nhu cầu Mới trong CSDL, không phải số dòng đã tải
  readonly openGaps = computed(() => this.gapCounts().MOI);
  readonly pageIds = computed(() => this.products().map((p) => p._id));

  constructor() {
    // ?tab=nhu-cau: Gợi ý hành động ở SCR-40 mở tab Nhu cầu chưa đáp ứng
    if (inject(ActivatedRoute).snapshot.queryParamMap.get('tab') === 'nhu-cau') this.tab.set('gaps');
    this.search$.pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef)).subscribe((v) => {
      this.productQ.set(v);
      this.loadProducts();
    });
    this.gapSearch$.pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef)).subscribe((v) => {
      this.gapQ.set(v);
      this.loadGaps();
    });
    this.load();
  }

  load(): void {
    this.errMessage.set('');
    forkJoin([this.api.getTagGroups(), this.api.getTags(), this.api.getAiGaps(this.gapQuery())]).subscribe({
      next: ([g, t, gaps]) => {
        this.groups.set(g);
        this.tags.set(t);
        this.gaps.set(gaps.items);
        this.gapCounts.set(gaps.counts);
        this.loading.set(false);
      },
      error: (err: ApiError) => {
        this.errMessage.set(err.message);
        this.loading.set(false);
      },
    });
  }

  setTab(t: 'groups' | 'bulk' | 'gaps'): void {
    this.tab.set(t);
    if (t === 'bulk' && !this.products().length) this.loadProducts();
    if (t === 'gaps') this.loadGaps(); // nhu cầu mới có thể vừa phát sinh từ Tư vấn AI
  }

  // Tìm tag: chỉ giữ nhóm có tag khớp (theo tên hoặc từ đồng nghĩa)
  tagsOf(g: ITagGroup): IAdminTag[] {
    const q = this.q().toLowerCase();
    return this.tags()
      .filter((t) => t.group === g.code)
      .filter((t) => !q || t.name.toLowerCase().includes(q) || t.synonyms.some((s) => s.toLowerCase().includes(q)));
  }

  visibleGroups(): ITagGroup[] {
    return this.q() ? this.groups().filter((g) => this.tagsOf(g).length || g.name.toLowerCase().includes(this.q().toLowerCase())) : this.groups();
  }

  rangeText(g: ITagGroup, t: IAdminTag): string {
    if (!t.range) return '';
    const f = (n: number) => (g.rangeField === 'PRICE' ? this.vnd.transform(n) : `${n} tuổi`);
    return t.range.max === null ? `từ ${f(t.range.min)}` : `${f(t.range.min)} - ${f(t.range.max)}`;
  }

  groupNote(g: ITagGroup): string {
    if (g.kind === 'RANGE') return g.rangeField === 'PRICE' ? 'Tự khớp theo giá bán' : 'Tự khớp theo độ tuổi của sản phẩm';
    return g.description;
  }

  groupMenu(g: ITagGroup): RowMenuItem[] {
    const items: RowMenuItem[] = [];
    if (this.auth.can('TAGS.SUA')) {
      items.push({ key: 'edit', label: 'Sửa nhóm', icon: 'edit' });
      items.push(g.isFilter ? { key: 'hide', label: 'Ẩn khỏi bộ lọc khách', icon: 'eye-off' } : { key: 'show', label: 'Hiện trên bộ lọc khách', icon: 'eye' });
    }
    if (this.auth.can('TAGS.XOA') && !g.isSystem) items.push({ key: 'delete', label: 'Xóa nhóm', icon: 'trash', danger: true });
    return items;
  }

  onGroupMenu(g: ITagGroup, key: string): void {
    if (key === 'edit') this.editingGroup.set(g);
    else if (key === 'delete') this.deletingGroup.set(g);
    else {
      const isFilter = key === 'show';
      this.api.updateTagGroup({ code: g.code, isFilter }).subscribe({
        next: () => {
          this.toast.show(isFilter ? `Nhóm "${g.name}" đã hiện trên bộ lọc khách` : `Đã ẩn nhóm "${g.name}" khỏi bộ lọc khách, Tư vấn AI vẫn dùng`);
          this.load();
        },
        error: (err: ApiError) => this.toast.show(err.message, 'danger'),
      });
    }
  }

  doDeleteGroup(): void {
    const g = this.deletingGroup()!;
    this.deletingGroup.set(null);
    this.api.deleteTagGroup(g.code).subscribe({
      next: () => {
        this.toast.show(`Đã xóa nhóm "${g.name}" và gỡ tag khỏi sản phẩm`);
        this.load();
      },
      error: (err: ApiError) => this.toast.show(err.message, 'danger'),
    });
  }

  onDialogDone(message: string): void {
    this.editingGroup.set(null);
    this.editingTag.set(null);
    if (message) {
      this.toast.show(message);
      this.load();
    }
  }

  // ===== Gắn tag hàng loạt =====

  loadProducts(): void {
    this.productsLoading.set(true);
    this.api.getProducts({ q: this.productQ(), page: 1 }).subscribe({
      next: (d) => {
        this.products.set(d.items);
        this.productsLoading.set(false);
      },
      error: (err: ApiError) => {
        this.productsLoading.set(false);
        this.toast.show(err.message, 'danger');
      },
    });
  }

  onProductSearch(v: string): void {
    this.search$.next(v.trim());
  }

  onBulkDone(message: string): void {
    this.tagDialog.set(false);
    if (message) {
      this.toast.show(message);
      this.sel.clear();
      this.load();
    }
  }

  // ===== Nhu cầu chưa đáp ứng =====

  private gapQuery() {
    return { status: this.gapStatus() || undefined, q: this.gapQ() || undefined };
  }

  loadGaps(): void {
    this.api.getAiGaps(this.gapQuery()).subscribe({
      next: (r) => {
        this.gaps.set(r.items);
        this.gapCounts.set(r.counts);
      },
      error: (err: ApiError) => this.toast.show(err.message, 'danger'),
    });
  }

  onGapSearch(v: string): void {
    this.gapSearch$.next(v.trim());
  }

  setGapStatus(s: 'MOI' | 'DA_XU_LY' | ''): void {
    this.gapStatus.set(s);
    this.loadGaps();
  }

  // Đã xử lý: rời nhóm Mới nên số Mới giảm 1, số Đã xử lý tăng 1
  resolveGap(g: IAiGap): void {
    this.api.resolveAiGap(g._id).subscribe({
      next: (r) => {
        this.gaps.set(this.gapStatus() === 'MOI' ? this.gaps().filter((x) => x._id !== r._id) : this.gaps().map((x) => (x._id === r._id ? r : x)));
        if (g.status !== 'DA_XU_LY') this.gapCounts.set({ MOI: this.gapCounts().MOI - 1, DA_XU_LY: this.gapCounts().DA_XU_LY + 1 });
        this.toast.show('Đã chuyển nhu cầu sang Đã xử lý');
      },
      error: (err: ApiError) => this.toast.show(err.message, 'danger'),
    });
  }
}
