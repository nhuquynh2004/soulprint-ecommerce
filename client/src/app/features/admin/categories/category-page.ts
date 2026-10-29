import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { forkJoin } from 'rxjs';
import { AdminCatalogApiService } from '../../../services/admin-catalog-apiservice';
import { AuthService } from '../../../services/auth';
import { ToastService } from '../../../services/toast';
import { ApiError } from '../../../classes/api-error';
import { IAdminCategory } from '../../../classes/admin-catalog';
import { Selection } from '../shared/selection';
import { BulkAction } from '../shared/bulk-bar/bulk-bar';
import { RowMenuItem } from '../shared/row-menu/row-menu';

type Row = IAdminCategory & { level: 0 | 1 };

// SCR-43 Danh mục (UC-CAT-01 nhánh 1e, 1f): bảng có ô chọn, kéo thả thứ tự (HTML5 drag and drop, thông báo kèm
// "Hoàn tác" trong 10 giây), thêm/sửa trong hộp thoại, thao tác hàng loạt Hiện/Ẩn/Xóa (API-164).
// Xóa chỉ khi không còn sản phẩm và danh mục con; luôn hỏi xác nhận.
@Component({
  selector: 'app-category-page',
  standalone: false,
  templateUrl: './category-page.html',
  styleUrl: './category-page.scss',
})
export class CategoryPage implements OnDestroy {
  private readonly api = inject(AdminCatalogApiService);
  protected readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  readonly tree = signal<IAdminCategory[]>([]);
  readonly loading = signal(true);
  readonly errMessage = signal('');
  readonly q = signal('');
  readonly status = signal<'' | 'on' | 'off'>('');
  readonly sel = new Selection();
  readonly busy = signal(false);

  readonly editing = signal<IAdminCategory | 'new' | null>(null);
  readonly confirmDelete = signal<{ ids: string[]; deletable: Row[]; blocked: Row[] } | null>(null);
  readonly undo = signal<{ text: string; previous: { _id: string; sortOrder: number }[] } | null>(null);
  private undoTimer: ReturnType<typeof setTimeout> | null = null;
  private dragId: string | null = null;
  readonly dragOver = signal<string | null>(null);

  // Cây thành danh sách phẳng: danh mục con nằm ngay dưới cha, thụt lề
  readonly rows = computed<Row[]>(() => {
    const q = this.q().toLowerCase();
    const okStatus = (c: IAdminCategory) => !this.status() || (this.status() === 'on' ? c.isActive : !c.isActive);
    const okText = (c: IAdminCategory) => !q || c.name.toLowerCase().includes(q) || c.slug.includes(q);
    return this.tree().flatMap((c) => {
      const kids = (c.children || []).filter((k) => okStatus(k) && okText(k)).map((k) => ({ ...k, level: 1 as const }));
      return (okStatus(c) && okText(c)) || kids.length ? [{ ...c, level: 0 as const }, ...kids] : [];
    });
  });
  readonly pageIds = computed(() => this.rows().map((r) => r._id));
  readonly total = computed(() => this.tree().reduce((n, c) => n + 1 + (c.children?.length || 0), 0));
  readonly canReorder = computed(() => this.auth.can('DANH_MUC.SUA') && !this.q() && !this.status());

  readonly bulkActions = computed<BulkAction[]>(() => {
    const a: BulkAction[] = [];
    if (this.auth.can('DANH_MUC.SUA')) a.push({ key: 'SHOW', label: 'Hiện', icon: 'eye' }, { key: 'HIDE', label: 'Ẩn', icon: 'eye-off' });
    if (this.auth.can('DANH_MUC.XOA')) a.push({ key: 'DELETE', label: 'Xóa', icon: 'trash', danger: true });
    return a;
  });

  constructor() {
    this.load();
  }

  ngOnDestroy(): void {
    if (this.undoTimer) clearTimeout(this.undoTimer);
  }

  load(): void {
    this.errMessage.set('');
    this.api.getCategories().subscribe({
      next: (t) => {
        this.tree.set(t);
        this.loading.set(false);
      },
      error: (err: ApiError) => {
        this.errMessage.set(err.message);
        this.loading.set(false);
      },
    });
  }

  childCount(r: Row): number {
    return r.children?.length || 0;
  }

  blockReason(r: Row): string {
    if (r.productCount) return `còn ${r.productCount} sản phẩm`;
    if (this.childCount(r)) return `còn ${this.childCount(r)} danh mục con`;
    return '';
  }

  rowMenu(r: Row): RowMenuItem[] {
    const items: RowMenuItem[] = [];
    if (this.auth.can('DANH_MUC.SUA')) {
      items.push({ key: 'edit', label: 'Sửa', icon: 'edit' });
      items.push(r.isActive ? { key: 'HIDE', label: 'Ẩn', icon: 'eye-off' } : { key: 'SHOW', label: 'Hiện', icon: 'eye' });
    }
    items.push({ key: 'view', label: 'Xem trên cửa hàng', icon: 'eye' });
    if (this.auth.can('DANH_MUC.XOA')) items.push({ key: 'delete', label: 'Xóa', icon: 'trash', danger: true });
    return items;
  }

  onRowMenu(r: Row, key: string): void {
    if (key === 'edit') this.editing.set(r);
    else if (key === 'view') window.open('/danh-muc/' + r.slug, '_blank');
    else if (key === 'delete') this.askDelete([r._id]);
    else this.runBulk(key, [r._id]);
  }

  onBulk(key: string): void {
    if (key === 'DELETE') this.askDelete(this.sel.ids());
    else this.runBulk(key, this.sel.ids());
  }

  // Hộp thoại xóa báo trước danh mục nào sẽ bị bỏ qua (SCR-43-Xoa)
  askDelete(ids: string[]): void {
    const list = this.rows().filter((r) => ids.includes(r._id));
    // Chọn cả cha lẫn con thì con bị xóa trước nên cha không còn bị chặn vì con
    const deletingKids = new Set(list.filter((r) => r.level === 1 && !r.productCount).map((r) => r._id));
    const blocked = list.filter((r) => r.productCount || (r.children || []).some((k) => !deletingKids.has(k._id)));
    this.confirmDelete.set({ ids, blocked, deletable: list.filter((r) => !blocked.includes(r)) });
  }

  doDelete(): void {
    const ids = this.confirmDelete()!.ids;
    this.confirmDelete.set(null);
    this.runBulk('DELETE', ids);
  }

  runBulk(action: string, ids: string[]): void {
    if (!ids.length) return;
    this.busy.set(true);
    this.api.bulkCategories({ action, ids }).subscribe({
      next: (r) => {
        this.busy.set(false);
        const verb: Record<string, string> = { SHOW: 'hiện', HIDE: 'ẩn', DELETE: 'xóa' };
        const skipped = r.skipped.length ? `. Bỏ qua: ${r.skipped.map((s) => `${s.name} (${s.reason})`).join('; ')}` : '';
        this.toast.show(`Đã ${verb[action]} ${r.updated} danh mục${skipped}`, r.skipped.length ? 'info' : 'success');
        this.sel.clear();
        this.load();
      },
      error: (err: ApiError) => {
        this.busy.set(false);
        this.toast.show(err.message, 'danger');
      },
    });
  }

  // ===== Kéo thả thứ tự (chỉ trong cùng cấp, khi không lọc) =====

  onDragStart(r: Row): void {
    this.dragId = r._id;
  }

  onDragOver(e: DragEvent, r: Row): void {
    const from = this.rows().find((x) => x._id === this.dragId);
    if (!from || from.parentId !== r.parentId) return; // khác cấp thì không thả được
    e.preventDefault();
    this.dragOver.set(r._id);
  }

  onDrop(e: DragEvent, target: Row): void {
    e.preventDefault();
    this.dragOver.set(null);
    const fromId = this.dragId;
    this.dragId = null;
    if (!fromId || fromId === target._id) return;
    const siblings = target.level === 0 ? this.tree() : this.tree().find((c) => c._id === target.parentId)?.children || [];
    const previous = siblings.map((c) => ({ _id: c._id, sortOrder: c.sortOrder }));
    const order = siblings.filter((c) => c._id !== fromId);
    order.splice(order.findIndex((c) => c._id === target._id) + (siblings.findIndex((c) => c._id === fromId) < siblings.findIndex((c) => c._id === target._id) ? 1 : 0), 0, siblings.find((c) => c._id === fromId)!);
    const next = order.map((c, i) => ({ _id: c._id, sortOrder: i + 1 }));
    this.applyOrder(next, previous, 'Đã đổi thứ tự danh mục');
  }

  // Lưu thứ tự mới (API-73 từng danh mục đổi chỗ), hiện thông báo "Hoàn tác" 10 giây
  private applyOrder(next: { _id: string; sortOrder: number }[], previous: { _id: string; sortOrder: number }[], text: string | null): void {
    const changed = next.filter((n) => previous.find((p) => p._id === n._id)?.sortOrder !== n.sortOrder);
    if (!changed.length) return;
    // Vẽ ngay thứ tự mới rồi mới gọi API
    const sort = (list: IAdminCategory[]) =>
      list.map((c) => ({ ...c, sortOrder: next.find((n) => n._id === c._id)?.sortOrder ?? c.sortOrder })).sort((a, b) => a.sortOrder - b.sortOrder);
    this.tree.set(sort(this.tree()).map((c) => ({ ...c, children: sort(c.children || []) })));
    forkJoin(changed.map((c) => this.api.updateCategory(c))).subscribe({
      next: () => {
        if (this.undoTimer) clearTimeout(this.undoTimer);
        if (text) {
          this.undo.set({ text, previous });
          this.undoTimer = setTimeout(() => this.undo.set(null), 10000);
        } else this.undo.set(null);
      },
      error: (err: ApiError) => {
        this.toast.show(err.message, 'danger');
        this.load();
      },
    });
  }

  undoOrder(): void {
    const u = this.undo();
    if (!u) return;
    const current = u.previous.map((p) => ({ _id: p._id, sortOrder: this.rows().find((r) => r._id === p._id)?.sortOrder ?? p.sortOrder }));
    this.applyOrder(u.previous, current, null);
    this.toast.show('Đã hoàn tác thứ tự danh mục', 'info');
  }

  onSaved(message: string): void {
    this.editing.set(null);
    if (message) {
      this.toast.show(message);
      this.load();
    }
  }
}
