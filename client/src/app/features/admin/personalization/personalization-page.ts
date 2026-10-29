import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Observable, forkJoin } from 'rxjs';
import { AdminGiftApiService } from '../../../services/admin-gift-apiservice';
import { AdminCatalogApiService } from '../../../services/admin-catalog-apiservice';
import { AdminStoreApiService } from '../../../services/admin-store-apiservice';
import { CatalogApiService } from '../../../services/catalog-apiservice';
import { AuthService } from '../../../services/auth';
import { ToastService } from '../../../services/toast';
import { ApiError } from '../../../classes/api-error';
import { IAdminCategory } from '../../../classes/admin-catalog';
import {
  IBulkResult,
  IGiftTemplateAdmin,
  IMaterialAdmin,
  IMovementPage,
  IStickerSetAdmin,
  MATERIAL_KIND_LABEL,
  MaterialKind,
  STATUS_LABEL,
  STOCK_LABEL,
} from '../../../classes/admin-gift';
import { Selection } from '../shared/selection';
import { BulkAction } from '../shared/bulk-bar/bulk-bar';
import { RowMenuItem } from '../shared/row-menu/row-menu';
import { FilterChip } from '../shared/filter-chips/filter-chips';

type Tab = 'STICKER' | 'GOI_QUA' | 'VAT_LIEU';
interface TemplateGroup {
  key: string;
  kind: 'THUONG' | 'BST_MUA';
  label: string;
  badge: string | null;
  items: IGiftTemplateAdmin[];
}
interface Confirm {
  title: string;
  message: string;
  run: () => Observable<unknown>;
}

const MATERIAL_KINDS: MaterialKind[] = ['GIAY_GOI', 'RUY_BANG', 'THIEP'];

// SCR-56 Cá nhân hóa và gói quà (UC-CAT-06): 3 tab Bộ sticker, Mẫu gói quà, Vật liệu. Mỗi tab là các nhóm thu gọn được,
// bảng trong nhóm; ô chọn 3 cấp (tổng, nhóm, dòng) suy ra bằng Signal computed (Chương II); kéo thả thứ tự bằng HTML5
// drag and drop; thao tác hàng loạt qua API-171, 172, 173. Nút hiện theo mã quyền (BR-34): Bán hàng sửa sticker và mẫu,
// Kho quản lý vật liệu, phiếu nhập; Bán hàng xem tab Vật liệu chỉ đọc, không thấy giá vốn (BR-36).
@Component({
  selector: 'app-personalization-page',
  standalone: false,
  templateUrl: './personalization-page.html',
  styleUrl: './personalization-page.scss',
})
export class PersonalizationPage {
  private readonly api = inject(AdminGiftApiService);
  private readonly catalogAdmin = inject(AdminCatalogApiService);
  private readonly storeAdmin = inject(AdminStoreApiService);
  private readonly toast = inject(ToastService);
  protected readonly auth = inject(AuthService);

  readonly STATUS = STATUS_LABEL;
  readonly STOCK = STOCK_LABEL;
  readonly KIND_LABEL = MATERIAL_KIND_LABEL;

  readonly tab = signal<Tab>('STICKER');
  readonly loading = signal(true);
  readonly errMessage = signal('');
  readonly busy = signal(false);

  readonly sets = signal<IStickerSetAdmin[]>([]);
  readonly templates = signal<IGiftTemplateAdmin[]>([]);
  readonly materials = signal<IMaterialAdmin[]>([]);
  readonly categories = signal<IAdminCategory[]>([]);
  readonly collections = signal<{ _id: string; name: string }[]>([]);
  readonly stickerFee = signal(5000);

  // Tìm, bộ lọc, sắp xếp (bước 1)
  readonly q = signal('');
  readonly fKind = signal('');
  readonly fStatus = signal('');
  readonly fStock = signal('');
  readonly sortBy = signal<'ORDER' | 'NAME'>('ORDER');
  readonly filterOpen = signal(false);

  // Nhóm đang mở: mặc định chỉ mở nhóm đầu tiên
  readonly open = signal<Set<string>>(new Set());
  private opened = { STICKER: false, GOI_QUA: false, VAT_LIEU: false };

  // Ô chọn 3 cấp
  readonly selSets = new Selection();
  readonly selCodes = new Selection();
  readonly selTpl = new Selection();
  readonly selMat = new Selection();

  // Hộp thoại
  readonly setDialog = signal<{ set: IStickerSetAdmin | null; duplicate: boolean } | null>(null);
  readonly tplDialog = signal<{ template: IGiftTemplateAdmin | null; duplicate: boolean } | null>(null);
  readonly matDialog = signal<{ material: IMaterialAdmin | null; kind: MaterialKind } | null>(null);
  readonly stockDialog = signal<{ type: 'NHAP' | 'DIEU_CHINH'; ids: string[] } | null>(null);
  readonly seasonDialog = signal<{ mode: 'SCHEDULE_SET' | 'SCHEDULE_TPL' | 'SET_SEASON'; ids: string[]; initial: IGiftTemplateAdmin | null } | null>(null);
  readonly seasonError = signal('');
  readonly thresholdDialog = signal<string[] | null>(null);
  readonly threshold = signal(5);
  readonly confirm = signal<Confirm | null>(null);

  // Ngăn chi tiết vật liệu
  readonly drawer = signal<IMaterialAdmin | null>(null);
  readonly history = signal<IMovementPage | null>(null);

  readonly canSticker = computed(() => ({
    create: this.auth.can('GOI_QUA.TAO'),
    edit: this.auth.can('GOI_QUA.SUA'),
    remove: this.auth.can('GOI_QUA.XOA'),
  }));
  readonly canMaterial = computed(() => this.auth.can('GOI_QUA.QUAN_LY_VAT_LIEU'));
  readonly canStock = computed(() => this.auth.can('GOI_QUA.NHAP_KHO'));

  // ===== Lọc =====
  private match(text: string): boolean {
    const q = this.q().toLowerCase();
    return !q || text.toLowerCase().includes(q);
  }

  readonly visibleSets = computed(() => {
    let list = this.sets().filter(
      (s) =>
        (!this.fKind() || s.kind === this.fKind()) &&
        (!this.fStatus() || s.displayStatus === this.fStatus()) &&
        (this.match(`${s.name} ${s.seasonLabel || ''}`) || s.stickers.some((x) => this.match(`${x.name} ${x.code}`))),
    );
    if (this.sortBy() === 'NAME') list = [...list].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    return list;
  });

  readonly templateGroups = computed<TemplateGroup[]>(() => {
    const list = this.templates().filter(
      (t) =>
        (!this.fKind() || t.kind === this.fKind()) &&
        (!this.fStatus() || (this.fStatus() === 'TAM_HET' ? t.outOfStock.length > 0 : t.displayStatus === this.fStatus())) &&
        this.match(`${t.name} ${t.code} ${t.seasonLabel || ''}`),
    );
    const groups = new Map<string, TemplateGroup>();
    for (const t of list) {
      const key = t.kind === 'BST_MUA' ? 'S|' + t.seasonLabel : 'THUONG';
      if (!groups.has(key)) {
        groups.set(key, { key, kind: t.kind, label: t.kind === 'BST_MUA' ? t.seasonLabel || '' : 'Mẫu thường', badge: t.kind === 'BST_MUA' ? t.badge : null, items: [] });
      }
      groups.get(key)!.items.push(t);
    }
    const out = [...groups.values()].sort((a, b) => (a.kind === 'BST_MUA' ? 0 : 1) - (b.kind === 'BST_MUA' ? 0 : 1));
    if (this.sortBy() === 'NAME') out.forEach((g) => g.items.sort((a, b) => a.name.localeCompare(b.name, 'vi')));
    return out;
  });

  readonly materialGroups = computed(() =>
    MATERIAL_KINDS.map((kind) => {
      let items = this.materials().filter((m) => m.kind === kind && (!this.fStock() || m.stockStatus === this.fStock()) && this.match(`${m.name} ${m.code}`));
      if (this.sortBy() === 'NAME') items = [...items].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
      return { kind, label: MATERIAL_KIND_LABEL[kind], items };
    }).filter((g) => g.items.length || (!this.q() && !this.fStock())),
  );

  readonly chips = computed<FilterChip[]>(() => {
    const out: FilterChip[] = [];
    if (this.fKind()) out.push({ key: 'kind', label: this.fKind() === 'BST_MUA' ? 'Loại: Theo BST/mùa' : 'Loại: Thường' });
    if (this.fStatus()) out.push({ key: 'status', label: 'Trạng thái: ' + (this.fStatus() === 'TAM_HET' ? 'Tạm hết' : this.STATUS[this.fStatus() as keyof typeof STATUS_LABEL]) });
    if (this.fStock()) out.push({ key: 'stock', label: 'Tồn kho: ' + this.STOCK[this.fStock() as keyof typeof STOCK_LABEL] });
    return out;
  });

  // ===== Đếm cho tab và ô chọn tổng =====
  readonly selectedCount = computed(() => {
    switch (this.tab()) {
      case 'STICKER':
        return this.selSets.count() + this.selCodes.count();
      case 'GOI_QUA':
        return this.selTpl.count();
      default:
        return this.selMat.count();
    }
  });

  readonly allIds = computed(() => {
    switch (this.tab()) {
      case 'STICKER':
        return this.visibleSets().map((s) => s._id);
      case 'GOI_QUA':
        return this.templateGroups().flatMap((g) => g.items.map((t) => t._id));
      default:
        return this.materialGroups().flatMap((g) => g.items.map((m) => m._id));
    }
  });

  readonly bulkActions = computed<BulkAction[]>(() => {
    const t = this.tab();
    if (t === 'VAT_LIEU') {
      if (!this.canMaterial() && !this.canStock()) return [];
      const a: BulkAction[] = [];
      if (this.canStock()) a.push({ key: 'NHAP', label: 'Tạo phiếu nhập', icon: 'package' }, { key: 'DIEU_CHINH', label: 'Điều chỉnh tồn', icon: 'edit' });
      if (this.canMaterial()) {
        a.push(
          { key: 'SET_THRESHOLD', label: 'Đặt ngưỡng sắp hết', icon: 'settings' },
          { key: 'SHOW', label: 'Hiện', icon: 'eye' },
          { key: 'HIDE', label: 'Ẩn', icon: 'eye-off' },
          { key: 'DELETE', label: 'Xóa', icon: 'trash', danger: true },
        );
      }
      return a;
    }
    const c = this.canSticker();
    const a: BulkAction[] = [];
    if (c.edit) {
      a.push({ key: 'SHOW', label: 'Hiện', icon: 'eye' }, { key: 'HIDE', label: 'Ẩn', icon: 'eye-off' });
      // "Lên lịch" chỉ bật khi có chọn cấp nhóm (1b)
      if (t === 'GOI_QUA' || this.selSets.count()) a.push({ key: 'SCHEDULE', label: 'Lên lịch', icon: 'calendar' });
    }
    if (c.remove) a.push({ key: 'DELETE', label: 'Xóa', icon: 'trash', danger: true });
    return a;
  });

  constructor() {
    // ?tab=sticker|mau|vat-lieu: Gợi ý hành động ở SCR-40 mở đúng tab
    const tab = ({ sticker: 'STICKER', mau: 'GOI_QUA', 'vat-lieu': 'VAT_LIEU' } as Record<string, Tab>)[inject(ActivatedRoute).snapshot.queryParamMap.get('tab') || ''];
    if (tab) this.tab.set(tab);
    this.load();
    this.catalogAdmin.getCategories().subscribe({
      next: (tree) => this.categories.set(tree.flatMap((c) => [c, ...(c.children || [])])),
      error: () => {},
    });
    this.storeAdmin.getCollections({ pageSize: 100 }).subscribe({ next: (r) => this.collections.set(r.items.map((c) => ({ _id: String(c._id), name: c.name }))), error: () => {} });
    inject(CatalogApiService)
      .getPublicSettings()
      .subscribe({ next: (s) => this.stickerFee.set(s.stickerFee), error: () => {} });
  }

  load(): void {
    this.loading.set(true);
    this.errMessage.set('');
    forkJoin({ sets: this.api.getStickerSets(), templates: this.api.getTemplates(), materials: this.api.getMaterials() }).subscribe({
      next: (r) => {
        this.sets.set(r.sets);
        this.templates.set(r.templates);
        this.materials.set(r.materials);
        this.loading.set(false);
        this.openFirst();
      },
      error: (err: ApiError) => {
        this.loading.set(false);
        this.errMessage.set(err.message || 'Không tải được dữ liệu. Thử lại');
      },
    });
  }

  private reloadTab(): void {
    const t = this.tab();
    const done = { error: (err: ApiError) => this.toast.show(err.message, 'danger') };
    if (t === 'STICKER') this.api.getStickerSets().subscribe({ next: (x) => this.sets.set(x), ...done });
    // Mẫu gói quà phụ thuộc tồn vật liệu ("Tạm hết") nên tải lại cả hai
    this.api.getTemplates().subscribe({ next: (x) => this.templates.set(x), ...done });
    this.api.getMaterials().subscribe({
      next: (x) => {
        this.materials.set(x);
        const d = this.drawer();
        if (d) this.openDrawer(x.find((m) => m._id === d._id) || null);
      },
      ...done,
    });
  }

  private openFirst(): void {
    const t = this.tab();
    if (this.opened[t]) return;
    this.opened[t] = true;
    const first = t === 'STICKER' ? this.visibleSets()[0]?._id : t === 'GOI_QUA' ? this.templateGroups()[0]?.key : this.materialGroups()[0]?.kind;
    if (first) this.open.update((s) => new Set([...s, first]));
  }

  switchTab(t: Tab): void {
    this.tab.set(t);
    this.clearSelection();
    this.fKind.set('');
    this.fStatus.set('');
    this.fStock.set('');
    this.filterOpen.set(false);
    this.openFirst();
  }

  isOpen(key: string): boolean {
    return this.open().has(key);
  }

  toggleOpen(key: string): void {
    this.open.update((s) => {
      const n = new Set(s);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  }

  removeChip(key: string): void {
    if (key === 'kind') this.fKind.set('');
    if (key === 'status') this.fStatus.set('');
    if (key === 'stock') this.fStock.set('');
  }

  clearFilters(): void {
    this.fKind.set('');
    this.fStatus.set('');
    this.fStock.set('');
  }

  clearSelection(): void {
    this.selSets.clear();
    this.selCodes.clear();
    this.selTpl.clear();
    this.selMat.clear();
  }

  // ===== Ô chọn 3 cấp =====
  allChecked(): boolean {
    const ids = this.allIds();
    if (this.tab() === 'STICKER') return ids.length > 0 && ids.every((id) => this.setState(this.sets().find((s) => s._id === id)!) === 'all');
    return (this.tab() === 'GOI_QUA' ? this.selTpl : this.selMat).allOf(ids);
  }

  someChecked(): boolean {
    return this.selectedCount() > 0 && !this.allChecked();
  }

  toggleAll(): void {
    const ids = this.allIds();
    if (this.tab() === 'STICKER') {
      const all = this.allChecked();
      this.selCodes.clear();
      this.selSets.clear();
      if (!all) ids.forEach((id) => this.selSets.toggle(id));
      return;
    }
    (this.tab() === 'GOI_QUA' ? this.selTpl : this.selMat).togglePage(ids);
  }

  // Trạng thái ô chọn nhóm sticker: cả bộ, một phần ("-"), không
  setState(s: IStickerSetAdmin): 'all' | 'some' | 'none' {
    if (this.selSets.has(s._id)) return 'all';
    const codes = s.stickers.filter((x) => this.selCodes.has(x.code)).length;
    if (codes && codes === s.stickers.length) return 'all';
    return codes ? 'some' : 'none';
  }

  toggleSet(s: IStickerSetAdmin): void {
    const state = this.setState(s);
    for (const x of s.stickers) if (this.selCodes.has(x.code)) this.selCodes.toggle(x.code);
    if (state === 'all') {
      if (this.selSets.has(s._id)) this.selSets.toggle(s._id);
    } else if (!this.selSets.has(s._id)) this.selSets.toggle(s._id);
  }

  toggleSticker(s: IStickerSetAdmin, code: string): void {
    if (this.selSets.has(s._id)) {
      // Đang chọn cả bộ: bỏ chọn 1 sticker thì chuyển sang chọn các sticker còn lại
      this.selSets.toggle(s._id);
      for (const x of s.stickers) if (x.code !== code) this.selCodes.toggle(x.code);
      return;
    }
    this.selCodes.toggle(code);
  }

  stickerChecked(s: IStickerSetAdmin, code: string): boolean {
    return this.selSets.has(s._id) || this.selCodes.has(code);
  }

  groupState(ids: string[], sel: Selection): 'all' | 'some' | 'none' {
    if (sel.allOf(ids)) return 'all';
    return sel.someOf(ids) ? 'some' : 'none';
  }

  groupIds(items: { _id: string }[]): string[] {
    return items.map((x) => x._id);
  }

  // ===== Thao tác hàng loạt =====
  private report(r: IBulkResult, verb: string): void {
    if (r.skipped.length) {
      this.toast.show(`${verb} ${r.updated} mục. Bỏ qua ${r.skipped.length}: ${r.skipped.map((s) => `${s.name} (${s.reason})`).join('; ')}`, 'info');
    } else this.toast.show(`${verb} ${r.updated} mục`);
  }

  private runBulk(call: Observable<IBulkResult>, verb: string): void {
    this.busy.set(true);
    call.subscribe({
      next: (r) => {
        this.busy.set(false);
        this.report(r, verb);
        this.clearSelection();
        this.reloadTab();
      },
      error: (err: ApiError) => {
        this.busy.set(false);
        this.toast.show(err.message, 'danger');
      },
    });
  }

  onBulk(action: string): void {
    const t = this.tab();
    const verbs: Record<string, string> = { SHOW: 'Đã hiện', HIDE: 'Đã ẩn', DELETE: 'Đã xóa' };
    if (t === 'STICKER') {
      const body = { setIds: this.selSets.ids(), stickerCodes: this.selCodes.ids() };
      if (action === 'SCHEDULE') return this.seasonDialog.set({ mode: 'SCHEDULE_SET', ids: this.selSets.ids(), initial: null });
      if (action === 'DELETE') {
        return this.confirm.set({
          title: `Xóa ${this.selectedCount()} mục đã chọn?`,
          message: 'Bộ sticker hoặc sticker bị xóa không còn hiện ở hộp thoại cá nhân hóa. Đơn đã đặt vẫn giữ bản chụp sticker.',
          run: () => this.api.bulkStickerSets({ ...body, action }),
        });
      }
      return this.runBulk(this.api.bulkStickerSets({ ...body, action }), verbs[action]);
    }
    if (t === 'GOI_QUA') {
      const ids = this.selTpl.ids();
      if (action === 'SCHEDULE') return this.seasonDialog.set({ mode: 'SCHEDULE_TPL', ids, initial: null });
      if (action === 'DELETE') {
        return this.confirm.set({ title: `Xóa ${ids.length} mẫu gói quà?`, message: 'Đơn đã đặt vẫn giữ bản chụp gói quà.', run: () => this.api.bulkTemplates({ ids, action }) });
      }
      return this.runBulk(this.api.bulkTemplates({ ids, action }), verbs[action]);
    }
    const ids = this.selMat.ids();
    if (action === 'NHAP' || action === 'DIEU_CHINH') return this.stockDialog.set({ type: action, ids });
    if (action === 'SET_THRESHOLD') return this.thresholdDialog.set(ids);
    if (action === 'DELETE') {
      return this.confirm.set({
        title: `Xóa ${ids.length} vật liệu?`,
        message: 'Vật liệu đang dùng trong mẫu gói quà hoặc đã có phiếu nhập sẽ được bỏ qua (chỉ ẩn được).',
        run: () => this.api.bulkMaterials({ ids, action }),
      });
    }
    this.runBulk(this.api.bulkMaterials({ ids, action }), verbs[action]);
  }

  runConfirm(): void {
    const c = this.confirm();
    if (!c) return;
    this.busy.set(true);
    c.run().subscribe({
      next: (r) => {
        this.busy.set(false);
        this.confirm.set(null);
        if (r && typeof r === 'object' && 'updated' in (r as object)) this.report(r as IBulkResult, 'Đã xóa');
        else this.toast.show('Đã xóa');
        this.clearSelection();
        this.reloadTab();
      },
      error: (err: ApiError) => {
        this.busy.set(false);
        this.confirm.set(null);
        this.toast.show(err.message, 'danger');
      },
    });
  }

  onSeasonSaved(v: { seasonLabel?: string; badge?: string | null; startAt: string; endAt: string }): void {
    const d = this.seasonDialog();
    if (!d) return;
    this.seasonError.set('');
    const call =
      d.mode === 'SCHEDULE_SET'
        ? this.api.bulkStickerSets({ setIds: d.ids, action: 'SCHEDULE', ...v })
        : this.api.bulkTemplates({ ids: d.ids, action: d.mode === 'SET_SEASON' ? 'SET_SEASON' : 'SCHEDULE', ...v });
    this.busy.set(true);
    call.subscribe({
      next: (r) => {
        this.busy.set(false);
        this.seasonDialog.set(null);
        this.report(r, 'Đã cập nhật');
        this.clearSelection();
        this.reloadTab();
        this.api.getStickerSets().subscribe({ next: (x) => this.sets.set(x), error: () => {} });
      },
      error: (err: ApiError) => {
        this.busy.set(false);
        this.seasonError.set(err.message);
      },
    });
  }

  saveThreshold(): void {
    const ids = this.thresholdDialog();
    if (!ids) return;
    this.thresholdDialog.set(null);
    this.runBulk(this.api.bulkMaterials({ ids, action: 'SET_THRESHOLD', lowStockThreshold: Number(this.threshold()) }), 'Đã đặt ngưỡng cho');
  }

  // ===== Menu "..." =====
  setMenu(s: IStickerSetAdmin): RowMenuItem[] {
    const c = this.canSticker();
    const m: RowMenuItem[] = [];
    if (c.edit) m.push({ key: 'edit', label: 'Sửa nhóm', icon: 'edit' });
    if (c.create) m.push({ key: 'dup', label: 'Nhân bản', icon: 'copy' });
    if (c.edit) m.push(s.isActive ? { key: 'hide', label: 'Ẩn', icon: 'eye-off' } : { key: 'show', label: 'Hiện', icon: 'eye' });
    if (c.remove) m.push({ key: 'delete', label: 'Xóa', icon: 'trash', danger: true });
    return m;
  }

  onSetMenu(s: IStickerSetAdmin, key: string): void {
    if (key === 'edit') this.setDialog.set({ set: s, duplicate: false });
    if (key === 'dup') this.setDialog.set({ set: s, duplicate: true });
    if (key === 'hide' || key === 'show') this.runBulk(this.api.bulkStickerSets({ setIds: [s._id], action: key.toUpperCase() }), key === 'hide' ? 'Đã ẩn' : 'Đã hiện');
    if (key === 'delete') this.confirm.set({ title: `Xóa bộ "${s.name}"?`, message: 'Đơn đã đặt vẫn giữ bản chụp sticker.', run: () => this.api.deleteStickerSet(s._id) });
  }

  stickerMenu(active: boolean): RowMenuItem[] {
    const c = this.canSticker();
    const m: RowMenuItem[] = [];
    if (c.edit) m.push(active ? { key: 'HIDE', label: 'Ẩn', icon: 'eye-off' } : { key: 'SHOW', label: 'Hiện', icon: 'eye' });
    if (c.remove) m.push({ key: 'DELETE', label: 'Xóa', icon: 'trash', danger: true });
    return m;
  }

  onStickerMenu(code: string, key: string): void {
    if (key === 'DELETE') {
      return this.confirm.set({ title: 'Xóa sticker?', message: 'Đơn đã đặt vẫn giữ bản chụp sticker.', run: () => this.api.bulkStickerSets({ stickerCodes: [code], action: key }) });
    }
    this.runBulk(this.api.bulkStickerSets({ stickerCodes: [code], action: key }), key === 'HIDE' ? 'Đã ẩn' : 'Đã hiện');
  }

  tplMenu(t: IGiftTemplateAdmin): RowMenuItem[] {
    const c = this.canSticker();
    const m: RowMenuItem[] = [];
    if (c.edit) m.push({ key: 'edit', label: 'Sửa', icon: 'edit' });
    if (c.create) m.push({ key: 'dup', label: 'Nhân bản', icon: 'copy' });
    if (c.edit) m.push(t.isActive ? { key: 'HIDE', label: 'Ẩn', icon: 'eye-off' } : { key: 'SHOW', label: 'Hiện', icon: 'eye' });
    if (c.remove) m.push({ key: 'delete', label: 'Xóa', icon: 'trash', danger: true });
    return m;
  }

  onTplMenu(t: IGiftTemplateAdmin, key: string): void {
    if (key === 'edit') this.tplDialog.set({ template: t, duplicate: false });
    if (key === 'dup') this.tplDialog.set({ template: t, duplicate: true });
    if (key === 'HIDE' || key === 'SHOW') this.runBulk(this.api.bulkTemplates({ ids: [t._id], action: key }), key === 'HIDE' ? 'Đã ẩn' : 'Đã hiện');
    if (key === 'delete') this.confirm.set({ title: `Xóa mẫu "${t.name}"?`, message: 'Đơn đã đặt vẫn giữ bản chụp gói quà.', run: () => this.api.deleteTemplate(t._id) });
  }

  editTemplateGroup(g: TemplateGroup): void {
    this.seasonError.set('');
    this.seasonDialog.set({ mode: 'SET_SEASON', ids: g.items.map((t) => t._id), initial: g.items[0] });
  }

  matMenu(m: IMaterialAdmin): RowMenuItem[] {
    const items: RowMenuItem[] = [{ key: 'view', label: 'Xem chi tiết', icon: 'eye' }];
    if (this.canMaterial()) items.push({ key: 'edit', label: 'Sửa', icon: 'edit' });
    if (this.canStock()) items.push({ key: 'NHAP', label: 'Tạo phiếu nhập', icon: 'package' }, { key: 'DIEU_CHINH', label: 'Điều chỉnh tồn', icon: 'edit' });
    if (this.canMaterial()) items.push({ key: 'delete', label: 'Xóa', icon: 'trash', danger: true });
    return items;
  }

  onMatMenu(m: IMaterialAdmin, key: string): void {
    if (key === 'view') this.openDrawer(m);
    if (key === 'edit') this.matDialog.set({ material: m, kind: m.kind });
    if (key === 'NHAP' || key === 'DIEU_CHINH') this.stockDialog.set({ type: key, ids: [m._id] });
    if (key === 'delete') this.confirm.set({ title: `Xóa vật liệu "${m.name}"?`, message: 'Vật liệu đang dùng trong mẫu hoặc đã có phiếu nhập không xóa được, chỉ ẩn được.', run: () => this.api.deleteMaterial(m._id) });
  }

  toggleMaterial(m: IMaterialAdmin): void {
    this.runBulk(this.api.bulkMaterials({ ids: [m._id], action: m.isActive ? 'HIDE' : 'SHOW' }), m.isActive ? 'Đã ẩn' : 'Đã hiện');
  }

  // Nút chính ở đầu trang theo tab
  addNew(): void {
    const t = this.tab();
    if (t === 'STICKER') this.setDialog.set({ set: null, duplicate: false });
    else if (t === 'GOI_QUA') this.tplDialog.set({ template: null, duplicate: false });
    else this.matDialog.set({ material: null, kind: 'GIAY_GOI' });
  }

  canAdd(): boolean {
    return this.tab() === 'VAT_LIEU' ? this.canMaterial() : this.canSticker().create;
  }

  onDialogDone(saved: boolean, which: 'setDialog' | 'tplDialog' | 'matDialog'): void {
    this[which].set(null);
    if (saved) {
      this.toast.show(this.tab() === 'STICKER' ? 'Đã lưu bộ sticker' : this.tab() === 'GOI_QUA' ? 'Đã lưu mẫu gói quà' : 'Đã lưu vật liệu');
      this.reloadTab();
    }
  }

  onStockDone(result: string | null): void {
    this.stockDialog.set(null);
    if (!result) return;
    this.toast.show(result === 'DIEU_CHINH' ? 'Đã điều chỉnh tồn' : `Đã tạo phiếu nhập ${result}`);
    this.clearSelection();
    this.reloadTab();
  }

  // ===== Kéo thả thứ tự (1c) =====
  private drag: { scope: string; id: string } | null = null;
  readonly dragOver = signal<string | null>(null);

  onDragStart(scope: string, id: string, e: DragEvent): void {
    e.stopPropagation();
    this.drag = { scope, id };
  }

  onDragOver(scope: string, id: string, e: DragEvent): void {
    if (this.drag?.scope !== scope) return;
    e.preventDefault();
    e.stopPropagation();
    this.dragOver.set(id);
  }

  onDrop(scope: string, targetId: string, order: string[], e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    this.dragOver.set(null);
    const d = this.drag;
    this.drag = null;
    if (!d || d.scope !== scope || d.id === targetId) return;
    const list = order.filter((x) => x !== d.id);
    list.splice(list.indexOf(targetId), 0, d.id);
    if (scope === 'SETS') this.runBulk(this.api.bulkStickerSets({ action: 'REORDER', setIds: list }), 'Đã đổi thứ tự');
    else if (scope.startsWith('SET:')) this.runBulk(this.api.bulkStickerSets({ action: 'REORDER', setId: scope.slice(4), codes: list }), 'Đã đổi thứ tự');
    else if (scope.startsWith('TPL:')) {
      // Đổi thứ tự trong nhóm: ghép lại toàn bộ thứ tự mẫu với nhóm này đã sắp
      const all = this.templateGroups().flatMap((g) => (g.key === scope.slice(4) ? list : g.items.map((t) => t._id)));
      this.runBulk(this.api.bulkTemplates({ action: 'REORDER', ids: all }), 'Đã đổi thứ tự');
    } else if (scope.startsWith('MAT:')) this.runBulk(this.api.bulkMaterials({ action: 'REORDER', ids: list }), 'Đã đổi thứ tự');
  }

  canReorder(): boolean {
    if (this.q() || this.chips().length || this.sortBy() !== 'ORDER') return false;
    return this.tab() === 'VAT_LIEU' ? this.canMaterial() : this.canSticker().edit;
  }

  codesOf(s: IStickerSetAdmin): string[] {
    return s.stickers.map((x) => x.code);
  }

  // ===== Ngăn chi tiết vật liệu =====
  openDrawer(m: IMaterialAdmin | null): void {
    this.drawer.set(m);
    this.history.set(null);
    if (!m || !this.canStock()) return;
    this.api.getMovements({ materialId: m._id }).subscribe({ next: (h) => this.history.set(h), error: () => {} });
  }

  movementLabel(type: string): string {
    return { NHAP: 'Nhập', DIEU_CHINH: 'Điều chỉnh', XUAT_DON: 'Xuất', HOAN_DON: 'Hoàn' }[type] || type;
  }

  reasonLabel(r: string | null): string {
    return { HONG: 'Hỏng', KIEM_KE: 'Kiểm kê', KHAC: 'Khác' }[r || ''] || '';
  }

  tabCount(t: Tab): number {
    return t === 'STICKER' ? this.sets().length : t === 'GOI_QUA' ? this.templates().length : this.materials().length;
  }
}
