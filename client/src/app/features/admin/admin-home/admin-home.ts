import { Component, computed, inject } from '@angular/core';
import { AuthService } from '../../../services/auth';
import { ADMIN_NAV } from '../admin-nav';

// Trang đầu khu quản trị: người có TONG_QUAN.XEM thấy SCR-40 Tổng quan (UC-CAT-03, S12); người không có quyền
// (vai trò tự tạo không gồm Tổng quan) thấy trang chào và lối tắt tới các mục được phép.
@Component({
  selector: 'app-admin-home',
  standalone: false,
  template: `
    @if (auth.can('TONG_QUAN.XEM')) {
      <app-dashboard />
    } @else {
    <header class="mb-4">
      <h1 class="h2 mb-1">Xin chào {{ auth.currentUser()?.fullName }}</h1>
      <p class="text-body-secondary mb-0">Vai trò: {{ roles() }}. Bạn chưa được cấp quyền xem Tổng quan.</p>
    </header>
    <div class="sp-shortcuts">
      @for (i of shortcuts(); track i.path) {
        <a class="sp-shortcut" [routerLink]="['/quan-tri', i.path]">
          <span class="sp-shortcut__ic"><app-icon [name]="i.icon" [size]="24" /></span>
          <strong>{{ i.label }}</strong>
          <app-icon class="ms-auto" name="arrow-right" [size]="18" />
        </a>
      }
    </div>
    }
  `,
  styles: `
    .sp-shortcuts { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: var(--sp-space-3); }
    .sp-shortcut {
      display: flex; align-items: center; gap: var(--sp-space-3); padding: var(--sp-space-4);
      border: 1px solid var(--sp-color-border); border-radius: var(--sp-radius-lg); background: var(--sp-color-surface);
      color: var(--sp-color-text); text-decoration: none;
    }
    .sp-shortcut:hover { border-color: var(--sp-color-primary); box-shadow: var(--sp-shadow-hover); }
    .sp-shortcut__ic {
      display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px;
      border-radius: 14px; background: var(--sp-color-primary-subtle); color: var(--sp-color-primary);
    }
  `,
})
export class AdminHome {
  protected readonly auth = inject(AuthService);

  readonly roles = computed(() => (this.auth.currentUser()?.staffRoles || []).map((r) => r.name).join(', '));

  // Các mục được phép (trừ Tổng quan)
  readonly shortcuts = computed(() => {
    const u = this.auth.currentUser();
    if (!u) return [];
    return ADMIN_NAV.flatMap((g) => g.items)
      .filter((i) => i.path && (i.adminOnly ? u.isFullAccess : !i.permission || u.can(i.permission)))
      .concat([{ path: 'ho-so', label: 'Hồ sơ của tôi', icon: 'user' }]);
  });
}
