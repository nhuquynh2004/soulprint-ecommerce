import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, Subject, catchError, forkJoin, map, of } from 'rxjs';
import { AdminStoreApiService } from '../../../services/admin-store-apiservice';
import { ToastService } from '../../../services/toast';
import { ApiError } from '../../../classes/api-error';
import { IAdminCollection } from '../../../classes/admin-catalog';
import { HasUnsavedChanges } from '../../../guards/unsaved-changes-guard';

interface Row {
  original: IAdminCollection;
  name: string;
  sortBy: IAdminCollection['sortBy'];
  status: IAdminCollection['status'];
  showOnHome: boolean;
  error: string;
}

export const SORT_LABEL: Record<IAdminCollection['sortBy'], string> = {
  THU_CONG: 'Thủ công (kéo thả)',
  LIEN_QUAN: 'Liên quan nhất',
  BAN_CHAY: 'Bán chạy nhất',
  MOI_NHAT: 'Mới nhất',
  TEN_AZ: 'Tên A - Z',
  TEN_ZA: 'Tên Z - A',
  GIA_TANG: 'Giá thấp đến cao',
  GIA_GIAM: 'Giá cao đến thấp',
};

// SCR-54 "Sửa hàng loạt" (UC-CAT-05 nhánh 1b): sửa trực tiếp trong bảng tên, thứ tự sắp xếp, nơi hiển thị
// (Website = trạng thái Đang hiện, Trang chủ = showOnHome), trạng thái của các BST đã chọn. Dòng đổi chưa lưu có vạch màu
// đầu dòng; "Lưu" gọi API-111 cho từng BST đổi và báo dòng lỗi tại chỗ.
@Component({
  selector: 'app-collection-bulk-edit',
  standalone: false,
  templateUrl: './collection-bulk-edit.html',
  styleUrl: './collection-bulk-edit.scss',
})
export class CollectionBulkEdit implements HasUnsavedChanges {
  private readonly api = inject(AdminStoreApiService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  readonly sortLabel = SORT_LABEL;
  readonly rows = signal<Row[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly leaveDialog = signal(false);
  private leave$ = new Subject<boolean>();
  private saved = false;

  readonly changedCount = computed(() => this.rows().filter((r) => this.isChanged(r)).length);

  constructor() {
    const ids = (inject(ActivatedRoute).snapshot.queryParamMap.get('ids') || '').split(',').filter(Boolean);
    if (!ids.length) {
      this.loading.set(false);
      return;
    }
    forkJoin(ids.map((id) => this.api.getCollection(id).pipe(catchError(() => of(null))))).subscribe((list) => {
      this.rows.set(
        list
          .filter((c): c is IAdminCollection => !!c)
          .map((c) => ({ original: c, name: c.name, sortBy: c.sortBy, status: c.status, showOnHome: c.showOnHome, error: '' })),
      );
      this.loading.set(false);
    });
  }

  sortsFor(r: Row): IAdminCollection['sortBy'][] {
    const all = Object.keys(SORT_LABEL) as IAdminCollection['sortBy'][];
    return all.filter((s) => (r.original.type === 'THU_CONG' ? s !== 'LIEN_QUAN' : s !== 'THU_CONG'));
  }

  isChanged(r: Row): boolean {
    const o = r.original;
    return r.name.trim() !== o.name || r.sortBy !== o.sortBy || r.status !== o.status || r.showOnHome !== o.showOnHome;
  }

  patch(i: number, p: Partial<Row>): void {
    this.rows.set(this.rows().map((r, k) => (k === i ? { ...r, ...p, error: '' } : r)));
  }

  // Chip "Website": bật = Đang hiện, tắt = Ẩn (giữ đồng bộ với ô Trạng thái)
  toggleWebsite(i: number): void {
    const r = this.rows()[i];
    this.patch(i, { status: r.status === 'HIEN_THI' ? 'AN' : 'HIEN_THI' });
  }

  save(): void {
    const changed = this.rows()
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => this.isChanged(r));
    if (!changed.length) return;
    const empty = changed.find(({ r }) => r.name.trim().length < 2);
    if (empty) return this.patch(empty.i, { error: 'Tên bộ sưu tập cần 2-120 ký tự' });
    this.saving.set(true);
    forkJoin(
      changed.map(({ r, i }) =>
        this.api.updateCollection({ _id: r.original._id!, name: r.name.trim(), sortBy: r.sortBy, status: r.status, showOnHome: r.showOnHome }).pipe(
          map((c) => ({ i, c, error: '' })),
          catchError((err: ApiError) => of({ i, c: null as IAdminCollection | null, error: err.message })),
        ),
      ),
    ).subscribe((results) => {
      this.saving.set(false);
      const next = [...this.rows()];
      for (const x of results) {
        next[x.i] = x.c ? { original: x.c, name: x.c.name, sortBy: x.c.sortBy, status: x.c.status, showOnHome: x.c.showOnHome, error: '' } : { ...next[x.i], error: x.error };
      }
      this.rows.set(next);
      const ok = results.filter((x) => x.c).length;
      const fail = results.length - ok;
      this.toast.show(`Đã lưu ${ok} bộ sưu tập` + (fail ? `, ${fail} không lưu được (xem dòng báo lỗi)` : ''), fail ? 'info' : 'success');
      if (!fail) {
        this.saved = true;
        this.router.navigate(['/quan-tri/bo-suu-tap']);
      }
    });
  }

  cancel(): void {
    this.router.navigate(['/quan-tri/bo-suu-tap']);
  }

  hasUnsavedChanges(): boolean {
    return !this.saved && this.changedCount() > 0;
  }

  confirmLeave(): Observable<boolean> {
    this.leaveDialog.set(true);
    this.leave$ = new Subject<boolean>();
    return this.leave$;
  }

  answerLeave(ok: boolean): void {
    this.leaveDialog.set(false);
    this.leave$.next(ok);
    this.leave$.complete();
  }
}
