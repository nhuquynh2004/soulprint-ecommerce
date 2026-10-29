import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, debounceTime } from 'rxjs';
import { StaffApiService } from '../../../services/staff-apiservice';
import { AuthService } from '../../../services/auth';
import { ToastService } from '../../../services/toast';
import { ApiError } from '../../../classes/api-error';
import { IPermissionArea, IRole, IStaff, STATUS_LABEL, UserStatus } from '../../../classes/user';
import { ConfirmService } from '../../../services/confirm';

// SCR-57 Nhân viên và phân quyền (UC-ACC-07) - chỉ vai trò Quản trị.
// Tab "Nhân viên" (/quan-tri/nhan-vien) và tab "Vai trò và quyền" (/quan-tri/nhan-vien/vai-tro).
@Component({
  selector: 'app-staff-page',
  standalone: false,
  templateUrl: './staff-page.html',
  styleUrl: './staff-page.scss',
})
export class StaffPage {
  private readonly confirmBox = inject(ConfirmService);
  private readonly api = inject(StaffApiService);
  protected readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly tab = signal<'staff' | 'roles'>(inject(ActivatedRoute).snapshot.data['tab'] === 'roles' ? 'roles' : 'staff');
  readonly statusLabel = STATUS_LABEL;

  readonly staff = signal<IStaff[]>([]);
  readonly roles = signal<IRole[]>([]);
  readonly catalog = signal<IPermissionArea[]>([]);
  readonly loading = signal(true);
  readonly errMessage = signal('');

  // Bộ lọc tab Nhân viên
  readonly status = signal<UserStatus | ''>('');
  readonly roleFilter = signal('');
  readonly q = signal('');
  private readonly search$ = new Subject<string>();

  readonly filtered = computed(() => {
    const q = this.q().toLowerCase();
    return this.staff().filter(
      (s) =>
        (!this.status() || s.status === this.status()) &&
        (!this.roleFilter() || s.staffRoles.some((r) => r.code === this.roleFilter())) &&
        (!q || [s.fullName, s.email || '', s.phone].some((x) => x.toLowerCase().includes(q))),
    );
  });
  readonly counts = computed(() => {
    const c: Record<string, number> = { '': this.staff().length, HOAT_DONG: 0, CHO_KICH_HOAT: 0, BI_KHOA: 0 };
    for (const s of this.staff()) c[s.status]++;
    return c;
  });

  // Tên quyền dễ đọc: "KHACH_HANG.XEM" -> "Khách hàng: Xem"
  readonly permissionLabel = computed(() => {
    const map = new Map<string, string>();
    for (const a of this.catalog()) for (const x of a.actions) map.set(x.code, `${a.areaLabel}: ${x.label}`);
    return map;
  });

  // Hộp thoại
  readonly editing = signal<IStaff | 'new' | null>(null);
  readonly locking = signal<IStaff | null>(null);
  lockReason = '';
  readonly deleting = signal<IRole | null>(null);
  replacementRoleId = '';
  readonly openMenu = signal<string | null>(null);
  readonly devLink = signal('');

  constructor() {
    this.search$.pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef)).subscribe((v) => this.q.set(v));
    this.api.getPermissionCatalog().subscribe({ next: (c) => this.catalog.set(c), error: () => {} });
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.errMessage.set('');
    this.api.getRoles().subscribe({ next: (r) => this.roles.set(r), error: () => {} });
    this.api.getStaff().subscribe({
      next: (list) => {
        this.staff.set(list);
        this.loading.set(false);
      },
      error: (err: ApiError) => {
        this.errMessage.set(err.message);
        this.loading.set(false);
      },
    });
  }

  setTab(tab: 'staff' | 'roles'): void {
    this.tab.set(tab);
    this.router.navigate(tab === 'roles' ? ['/quan-tri/nhan-vien/vai-tro'] : ['/quan-tri/nhan-vien'], { replaceUrl: true });
  }

  onSearch(value: string): void {
    this.search$.next(value);
  }

  statusText(s: string): string {
    return s ? STATUS_LABEL[s as UserStatus] : 'Tất cả';
  }

  initials(name: string): string {
    return name.trim().split(/\s+/).slice(-2).map((w) => w[0]).join('').toUpperCase();
  }

  isSelf(s: IStaff): boolean {
    return s._id === this.auth.currentUser()?._id;
  }

  overrideTitle(s: IStaff): string {
    return s.overrides
      .map((o) => `${o.type === 'CAP_THEM' ? '+' : '-'} ${this.permissionLabel().get(o.permission) || o.permission}${o.expiresAt ? ' (đến ' + new Date(o.expiresAt).toLocaleDateString('vi-VN') + ')' : ''}`)
      .join('\n');
  }

  toggleMenu(id: string): void {
    this.openMenu.set(this.openMenu() === id ? null : id);
  }

  // Sau khi thêm/sửa trong hộp thoại
  onSaved(result: { message: string; devLink?: string; removed?: string[] }): void {
    this.editing.set(null);
    this.toast.show(result.message);
    if (result.removed?.length) {
      this.toast.show('Đã tự gỡ quyền riêng không còn tác dụng: ' + result.removed.map((p) => this.permissionLabel().get(p) || p).join(', '), 'info');
    }
    this.devLink.set(result.devLink || '');
    this.load();
  }

  resend(s: IStaff): void {
    this.openMenu.set(null);
    this.api.resendActivation(s._id).subscribe({
      next: (res) => {
        this.toast.show(res.message);
        this.devLink.set(res.devLink || '');
      },
      error: (err: ApiError) => this.toast.show(err.message, 'danger'),
    });
  }

  // Khóa: nhập lý do rồi xác nhận (nhánh 1b)
  confirmLock(): void {
    const s = this.locking();
    if (!s || this.lockReason.trim().length < 3) return;
    this.api.updateStaff({ _id: s._id, status: 'BI_KHOA', reason: this.lockReason.trim() }).subscribe({
      next: () => {
        this.locking.set(null);
        this.toast.show(`Đã khóa tài khoản ${s.fullName}, mọi phiên đăng nhập đã bị hủy`);
        this.load();
      },
      error: (err: ApiError) => this.toast.show(err.message, 'danger'),
    });
  }

  unlock(s: IStaff): void {
    this.openMenu.set(null);
    this.confirmBox.ask({ title: `Mở khóa tài khoản ${s.fullName}?`, okText: 'Mở khóa' }).then((ok) => {
      if (!ok) return;
      this.api.updateStaff({ _id: s._id, status: 'HOAT_DONG' }).subscribe({
        next: () => {
          this.toast.show(`Đã mở khóa ${s.fullName}`);
          this.load();
        },
        error: (err: ApiError) => this.toast.show(err.message, 'danger'),
      });
    });
  }

  startLock(s: IStaff): void {
    this.openMenu.set(null);
    this.lockReason = '';
    this.locking.set(s);
  }

  // Vai trò: nhân bản rồi mở trang sửa (nhánh 1g)
  cloneRole(r: IRole): void {
    this.openMenu.set(null);
    this.api.createRole({ fromRoleId: r._id }).subscribe({
      next: (role) => {
        this.toast.show(`Đã tạo vai trò "${role.name}"`);
        this.router.navigate(['/quan-tri/nhan-vien/vai-tro', role._id]);
      },
      error: (err: ApiError) => this.toast.show(err.message, 'danger'),
    });
  }

  startDelete(r: IRole): void {
    this.openMenu.set(null);
    this.replacementRoleId = '';
    this.deleting.set(r);
  }

  // Nhánh 1h: còn nhân viên dùng thì bắt buộc chọn vai trò thay thế
  confirmDelete(): void {
    const r = this.deleting();
    if (!r) return;
    if (r.staffCount && !this.replacementRoleId) return;
    this.api.deleteRole(r._id, this.replacementRoleId || undefined).subscribe({
      next: () => {
        this.deleting.set(null);
        this.toast.show(`Đã xóa vai trò "${r.name}"`);
        this.load();
      },
      error: (err: ApiError) => this.toast.show(err.message, 'danger'),
    });
  }

  staffOfRole(code: string): IStaff[] {
    return this.staff().filter((s) => s.staffRoles.some((x) => x.code === code));
  }
}
