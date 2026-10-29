import { computed, signal } from '@angular/core';

// Ô chọn nhiều dòng của bảng quản trị (UC-CAT-01 1f, UC-CAT-05 1b): giữ id đã chọn qua các trang,
// ô chọn tổng ở đầu bảng có 3 trạng thái (chưa chọn / chọn một phần / chọn hết trang).
export class Selection {
  private readonly _ids = signal<ReadonlySet<string>>(new Set());

  readonly ids = computed(() => [...this._ids()]);
  readonly count = computed(() => this._ids().size);

  has(id: string): boolean {
    return this._ids().has(id);
  }

  toggle(id: string): void {
    this._ids.update((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // Ô chọn tổng: trang đang chọn hết thì bỏ chọn cả trang, ngược lại chọn hết trang
  togglePage(pageIds: string[]): void {
    const all = this.allOf(pageIds);
    this._ids.update((s) => {
      const next = new Set(s);
      for (const id of pageIds) all ? next.delete(id) : next.add(id);
      return next;
    });
  }

  allOf(pageIds: string[]): boolean {
    return pageIds.length > 0 && pageIds.every((id) => this._ids().has(id));
  }

  someOf(pageIds: string[]): boolean {
    return pageIds.some((id) => this._ids().has(id)) && !this.allOf(pageIds);
  }

  clear(): void {
    this._ids.set(new Set());
  }
}
