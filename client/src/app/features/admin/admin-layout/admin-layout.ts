import { Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { filter, interval, startWith, switchMap, catchError, of, forkJoin } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../../../services/auth';
import { ThemeService } from '../../../services/theme';
import { ADMIN_NAV } from '../admin-nav';
import { AdminChatApiService } from '../../../services/admin-chat-apiservice';
import { AdminOrderApiService } from '../../../services/admin-order-apiservice';
import { AdminRequestApiService } from '../../../services/admin-request-apiservice';
import { ChatDockService } from '../../../services/chat-dock';
import { IMention } from '../../../classes/admin-order';
import { ConfirmService } from '../../../services/confirm';

const PIN_KEY = 'sp_admin_nav_pinned';
function readPin(): boolean {
  try {
    return localStorage.getItem(PIN_KEY) === '1';
  } catch {
    return false;
  }
}

// Khung khu quản trị /quan-tri/* (08 Mục 3): thanh điều hướng trái theo 4 nhóm, chỉ hiện mục được phép (BR-34),
// thanh trên có tên trang, Sáng/Tối, tài khoản; nội dung là router-outlet con (nested routes).
@Component({
  selector: 'app-admin-layout',
  standalone: false,
  templateUrl: './admin-layout.html',
  styleUrl: './admin-layout.scss',
})
export class AdminLayout {
  private readonly confirmBox = inject(ConfirmService);
  protected readonly auth = inject(AuthService);
  protected readonly theme = inject(ThemeService);
  private readonly router = inject(Router);
  private readonly title = inject(Title);

  readonly navOpen = signal(false);
  // Ghim thanh menu luôn mở, nhớ theo trình duyệt
  readonly pinned = signal(readPin());
  readonly menuOpen = signal(false);
  readonly pageTitle = signal('');

  // Chỉ nhóm còn ít nhất 1 mục được phép
  readonly nav = computed(() => {
    const u = this.auth.currentUser();
    if (!u) return [];
    return ADMIN_NAV.map((g) => ({
      group: g.group,
      items: g.items.filter((i) => (i.adminOnly ? u.isFullAccess : !i.permission || u.can(i.permission))),
    })).filter((g) => g.items.length);
  });

  // Số hội thoại chờ ở mục "Hỗ trợ khách hàng" (UC-CSK-04 trigger), hỏi lại mỗi 30 giây khi có quyền HO_TRO.XEM
  readonly waitingChats = signal(0);
  private readonly chatApi = inject(AdminChatApiService);
  private readonly orderApi = inject(AdminOrderApiService);
  private readonly requestApi = inject(AdminRequestApiService);

  // theo SCR-41: số việc chờ ở menu trái và chuông trên thanh đầu - đơn cần xác nhận (API-90 counts),
  // yêu cầu hậu mãi chờ duyệt (API-99 counts), hội thoại chờ. Chỉ hỏi phần người dùng có quyền xem.
  readonly toConfirm = signal(0);
  readonly pendingRequests = signal(0);
  readonly pendingApprovals = signal(0); // ngoại lệ đặc biệt chờ duyệt (BR-48)
  readonly urgentDrafts = signal(0); // Đơn gấp chờ chốt
  readonly mentions = signal<IMention[]>([]); // Lần mình được gắn thẻ @ trong ghi chú đơn
  readonly unreadMentions = signal(0);
  readonly bellOpen = signal(false);
  readonly dock = inject(ChatDockService);
  // Cửa sổ chat đang mở thì chừa khoảng dưới trang để không che nút cuối trang
  readonly chatOpen = computed(() => this.dock.windows().some((w) => !w.minimized));
  readonly bellTotal = computed(() => this.toConfirm() + this.pendingRequests() + this.waitingChats() + this.urgentDrafts() + this.unreadMentions() + this.pendingApprovals());
  searchText = '';

  readonly roleNames = computed(() => (this.auth.currentUser()?.staffRoles || []).map((r) => r.name).join(', '));

  constructor() {
    interval(30000)
      .pipe(
        startWith(0),
        filter(() => !!this.auth.currentUser()?.can('HO_TRO.XEM')),
        switchMap(() => this.chatApi.getQueue().pipe(catchError(() => of(null)))),
        takeUntilDestroyed(),
      )
      .subscribe((q) => {
        // Hội thoại chờ nhận + hội thoại đã xem mà chưa trả lời quá 5 phút
        if (q) this.waitingChats.set(q.waitingCount + (q.remindCount || 0));
      });
    interval(60000)
      .pipe(
        startWith(0),
        filter(() => !!this.auth.currentUser()),
        switchMap(() => {
          const u = this.auth.currentUser()!;
          return forkJoin({
            orders: u.can('DON_HANG.XEM') ? this.orderApi.getOrders({ view: 'to-confirm', page: 1 }).pipe(catchError(() => of(null))) : of(null),
            requests: u.can('HAU_MAI.XEM') ? this.requestApi.getRequests({ stage: 'cho-duyet', page: 1 }).pipe(catchError(() => of(null))) : of(null),
            drafts: u.can('DON_NHAP.XEM') ? this.orderApi.getDrafts({ kind: 'DAT_GAP', page: 1 }).pipe(catchError(() => of(null))) : of(null),
            mentions: this.orderApi.getMentions().pipe(catchError(() => of(null))),
          });
        }),
        takeUntilDestroyed(),
      )
      .subscribe(({ orders, requests, drafts, mentions }) => {
        if (mentions) {
          this.mentions.set(mentions.items.slice(0, 6)); // giữ cả dòng đã đọc (mờ hơn) để xem lại (retest R06)
          this.unreadMentions.set(mentions.unread);
        }
        this.toConfirm.set(orders?.counts?.['to-confirm'] || 0);
        this.pendingApprovals.set(this.auth.currentUser()?.can('DON_HANG.NGOAI_LE_DAC_BIET') ? orders?.counts?.['approval'] || 0 : 0);
        this.pendingRequests.set((requests?.counts?.['cho-duyet'] || 0) + (requests?.counts?.['cho-hoan-tien'] || 0));
        this.urgentDrafts.set(drafts?.counts?.['urgent'] || 0);
      });
    const update = () => this.pageTitle.set(this.title.getTitle().replace(/ - (Quản trị )?Soulprint.*$/, ''));
    update();
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        setTimeout(update); // Title đặt xong sau NavigationEnd
        this.navOpen.set(false);
        this.menuOpen.set(false);
        this.bellOpen.set(false);
      });
  }

  // Số trên mục menu trái (đỏ như thiết kế)
  countFor(path: string): number {
    return path === 'don-hang' ? this.toConfirm() : path === 'yeu-cau' ? this.pendingRequests() : path === 'ho-tro' ? this.waitingChats() : path === 'don-nhap' ? this.urgentDrafts() : 0;
  }

  // Ô tìm trên thanh đầu: mã đơn hoặc số điện thoại -> Đơn hàng (SCR-47 tìm theo mã, SĐT, tên khách); còn lại -> Sản phẩm (SCR-41)
  // Mở đơn được nhắc đến và đánh dấu đã đọc (API-211)
  openMention(m: IMention): void {
    this.bellOpen.set(false);
    if (!m.readAt) {
      const now = new Date().toISOString();
      this.mentions.update((l) => l.map((x) => (x._id === m._id ? { ...x, readAt: now } : x)));
      this.unreadMentions.update((n) => Math.max(0, n - 1));
    }
    if (m.readAt) {
      this.router.navigate(['/quan-tri/don-hang', m.orderCode]);
      return;
    }
    this.orderApi.readMentions([m._id]).subscribe({ next: (r) => this.unreadMentions.set(r.unread), error: () => {} });
    this.router.navigate(['/quan-tri/don-hang', m.orderCode]);
  }

  readAllMentions(): void {
    const now = new Date().toISOString();
    this.mentions.update((l) => l.map((x) => (x.readAt ? x : { ...x, readAt: now })));
    this.unreadMentions.set(0);
    this.orderApi.readMentions().subscribe({ error: () => {} });
  }

  search(): void {
    const q = this.searchText.trim();
    if (!q) return;
    const toOrders = /^SP\d{4,}$/i.test(q) || /^0\d{6,}$/.test(q.replace(/[\s.]/g, ''));
    const can = (p: string) => !!this.auth.currentUser()?.can(p);
    if ((toOrders && can('DON_HANG.XEM')) || !can('SAN_PHAM.XEM')) this.router.navigate(['/quan-tri/don-hang'], { queryParams: { q } });
    else this.router.navigate(['/quan-tri/san-pham'], { queryParams: { q } });
    this.searchText = '';
  }

  togglePin(): void {
    this.pinned.set(!this.pinned());
    try {
      localStorage.setItem(PIN_KEY, this.pinned() ? '1' : '0');
    } catch {
      // trình duyệt chặn lưu trữ: vẫn ghim trong phiên này
    }
  }

  link(path: string): string[] {
    return path ? ['/quan-tri', path] : ['/quan-tri'];
  }

  // UC-ACC-02 nhánh 6a: nhân viên đăng xuất về SCR-60
  logout(): void {
    this.confirmBox.ask({ title: 'Bạn có chắc chắn muốn đăng xuất?', okText: 'Đăng xuất' }).then((ok) => {
      if (ok) this.auth.logout().subscribe(() => this.router.navigate(['/quan-tri/dang-nhap']));
    });
  }
}
