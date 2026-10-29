import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { StaffApiService } from '../../../services/staff-apiservice';
import { ToastService } from '../../../services/toast';
import { ApiError } from '../../../classes/api-error';
import { IPermissionArea, IRole } from '../../../classes/user';

type Column = 'XEM' | 'TAO' | 'SUA' | 'XOA';

// Trang Tạo / Sửa vai trò /quan-tri/nhan-vien/vai-tro/moi | /:id (UC-ACC-07 nhánh 1f, BR-37).
// Ma trận quyền dựng bằng @for lồng theo danh mục quyền (API-183); computed() đếm số quyền đang bật (Chương II).
// Bỏ Xem thì các quyền khác trên dòng tự tắt; bật một hành động khi Xem đang tắt thì Xem tự bật.
@Component({
  selector: 'app-role-editor',
  standalone: false,
  templateUrl: './role-editor.html',
  styleUrl: './role-editor.scss',
})
export class RoleEditor {
  private readonly api = inject(StaffApiService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly id = inject(ActivatedRoute).snapshot.paramMap.get('id');

  readonly columns: Column[] = ['XEM', 'TAO', 'SUA', 'XOA'];
  readonly catalog = signal<IPermissionArea[]>([]);
  readonly role = signal<IRole | null>(null);
  readonly selected = signal<Set<string>>(new Set());
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly errMessage = signal('');
  name = '';
  description = '';

  readonly isNew = !this.id;
  readonly readOnly = computed(() => !!this.role()?.isFullAccess);
  readonly isDefault = computed(() => this.role()?.type === 'MAC_DINH');
  readonly total = computed(() => this.catalog().reduce((n, a) => n + a.actions.length, 0));
  readonly count = computed(() => this.selected().size);

  // Nhóm khu vực theo Bán hàng / Catalog / Cửa hàng / Hệ thống
  readonly groups = computed(() => {
    const out: { group: string; areas: IPermissionArea[] }[] = [];
    for (const a of this.catalog()) {
      const g = out.find((x) => x.group === a.group);
      if (g) g.areas.push(a);
      else out.push({ group: a.group, areas: [a] });
    }
    return out;
  });

  constructor() {
    forkJoin([this.api.getPermissionCatalog(), this.id ? this.api.getRole(this.id) : of(null)]).subscribe({
      next: ([catalog, role]) => {
        this.catalog.set(catalog);
        if (role) {
          this.role.set(role);
          this.name = role.name;
          this.description = role.description;
          this.selected.set(new Set(role.permissions));
        }
        this.loading.set(false);
      },
      error: (err: ApiError) => {
        this.errMessage.set(err.message);
        this.loading.set(false);
      },
    });
  }

  action(area: IPermissionArea, column: Column) {
    return area.actions.find((x) => x.column === column);
  }

  others(area: IPermissionArea) {
    return area.actions.filter((x) => x.column === 'KHAC');
  }

  has(code: string): boolean {
    return this.selected().has(code);
  }

  rowState(area: IPermissionArea): 'all' | 'some' | 'none' {
    const n = area.actions.filter((x) => this.has(x.code)).length;
    return n === 0 ? 'none' : n === area.actions.length ? 'all' : 'some';
  }

  toggle(area: IPermissionArea, code: string): void {
    if (this.readOnly()) return;
    const set = new Set(this.selected());
    const view = `${area.area}.XEM`;
    if (set.has(code)) {
      set.delete(code);
      if (code === view) for (const x of area.actions) set.delete(x.code); // bỏ Xem: tắt cả dòng
    } else {
      set.add(code);
      set.add(view); // bật hành động: tự bật Xem
    }
    this.selected.set(set);
  }

  toggleRow(area: IPermissionArea): void {
    if (this.readOnly()) return;
    const set = new Set(this.selected());
    const on = this.rowState(area) !== 'all';
    for (const x of area.actions) on ? set.add(x.code) : set.delete(x.code);
    this.selected.set(set);
  }

  setAll(on: boolean): void {
    if (this.readOnly()) return;
    this.selected.set(on ? new Set(this.catalog().flatMap((a) => a.actions.map((x) => x.code))) : new Set());
  }

  get nameError(): string {
    const n = this.name.trim();
    return n.length < 3 || n.length > 40 ? 'Tên vai trò cần 3-40 ký tự' : '';
  }

  save(): void {
    if (this.readOnly() || this.nameError || !this.count()) return;
    this.saving.set(true);
    this.errMessage.set('');
    const permissions = [...this.selected()];
    const done = (affected: number) => {
      this.toast.show(affected ? `Đã lưu vai trò, áp dụng ngay cho ${affected} nhân viên` : 'Đã lưu vai trò');
      this.router.navigate(['/quan-tri/nhan-vien/vai-tro']);
    };
    const fail = (err: ApiError) => {
      this.saving.set(false);
      this.errMessage.set(err.message);
    };
    const body = { name: this.name.trim(), description: this.description.trim(), permissions };
    if (this.isNew) {
      this.api.createRole(body).subscribe({ next: () => done(0), error: fail });
    } else {
      this.api.updateRole({ _id: this.role()!._id, ...body }).subscribe({ next: (res) => done(res.affectedStaff.length), error: fail });
    }
  }
}
