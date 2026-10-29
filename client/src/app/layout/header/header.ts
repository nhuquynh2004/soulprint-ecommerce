import { Component, DestroyRef, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { Subject, catchError, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { ThemeService } from '../../services/theme';
import { AuthService } from '../../services/auth';
import { ProductApiService } from '../../services/product-apiservice';
import { CatalogApiService } from '../../services/catalog-apiservice';
import { CartService } from '../../services/cart';
import { ToastService } from '../../services/toast';
import { ICategory, CATEGORY_ICONS, IOpenCollection } from '../../classes/catalog';
import { RecentSearchService } from '../../services/recent-search';
import { INoticePopup, NoticeService } from '../../services/notice';
import { ChatService } from '../../services/chat';
import { INotice } from '../../classes/order';
import { AXIS_INFO, ISuggestion } from '../../classes/product';
import { ConfirmService } from '../../services/confirm';

// Gợi ý phổ biến khi ô tìm kiếm còn trống (UC-DIS-03 bước 1); Member thấy thêm 3 từ khóa gần nhất.
const POPULAR = ['Quà sinh nhật bạn trai', 'Bóng đá', 'Gaming', 'Anime', 'Bình giữ nhiệt'];

// Header cửa hàng (component Header của bộ thiết kế). Tài khoản (S2), số dòng trên biểu tượng giỏ đọc Signal của CartService (S4).
@Component({
  selector: 'app-header',
  standalone: false,
  templateUrl: './header.html',
  styleUrl: './header.scss',
})
export class Header {
  private readonly confirmBox = inject(ConfirmService);
  protected readonly theme = inject(ThemeService);
  protected readonly auth = inject(AuthService);
  protected readonly cart = inject(CartService);
  private readonly router = inject(Router);
  private readonly productApi = inject(ProductApiService);
  private readonly catalogApi = inject(CatalogApiService);

  protected readonly recent = inject(RecentSearchService);
  protected readonly notice = inject(NoticeService);
  private readonly chat = inject(ChatService);
  readonly bellOpen = signal(false);
  private lastStaffMsg = '';
  readonly categories = signal<ICategory[]>([]);
  readonly collections = signal<IOpenCollection[]>([]); // menu xổ Bộ sưu tập (API-207)
  readonly drawerCollections = signal(false);
  readonly categoryIcons = CATEGORY_ICONS;
  readonly axes = Object.values(AXIS_INFO);
  readonly axisCounts = signal<Record<string, number>>({}); // số sản phẩm theo trục ở menu Danh mục (retest R01)
  private axisCountsLoaded = false;
  readonly popular = POPULAR;

  // Ô tìm kiếm: two-way binding [(ngModel)] (Chương II) + debounceTime 300ms (Chương III)
  keyword = '';
  readonly suggestions = signal<ISuggestion[]>([]);
  readonly open = signal(false);
  readonly userMenu = signal(false);
  private readonly typing$ = new Subject<string>();

  constructor() {
    // Vừa tạo tài khoản bằng Google: API-200 thêm ?welcome=1 -> báo tặng mã chào mừng như UC-ACC-01 bước 6, rồi bỏ tham số
    const toast = inject(ToastService);
    this.router.events.pipe(takeUntilDestroyed()).subscribe((e) => {
      if (!(e instanceof NavigationEnd)) return;
      const tree = this.router.parseUrl(e.urlAfterRedirects);
      if (tree.queryParams['welcome'] !== '1') return;
      toast.show('Đăng ký tài khoản thành công. Quà cảm ơn dành riêng cho bạn: nhập mã SOULPRINT10 - ưu đãi 10% cho đơn hàng đầu tiên.');
      delete tree.queryParams['welcome'];
      this.router.navigateByUrl(tree, { replaceUrl: true });
    });
    // Đang ở Ưu đãi của tôi thì khách đã thấy voucher: đánh dấu đã xem, không bật hộp nổi bật (nút "Xem ưu đãi" thừa)
    const onVoucherPage = signal(this.router.url.startsWith('/tai-khoan/voucher'));
    this.router.events.pipe(takeUntilDestroyed()).subscribe((e) => {
      if (e instanceof NavigationEnd) onVoucherPage.set(e.urlAfterRedirects.startsWith('/tai-khoan/voucher'));
    });
    effect(() => {
      if (onVoucherPage() && this.notice.highlight()) this.notice.closeHighlight();
    });
    // Nhân viên nhắn tin khi khung chat đang đóng thì hiện thẻ nổi (lần đầu chỉ ghi nhận tin cuối)
    effect(() => {
      const last = [...this.chat.messages()].reverse().find((m) => m.sender === 'ADMIN');
      if (!last) return;
      const first = !this.lastStaffMsg;
      if (last._id === this.lastStaffMsg) return;
      this.lastStaffMsg = last._id;
      if (!first && !this.chat.isOpen()) {
        this.notice.push({ id: 'chat-' + last._id, kind: 'chat', title: `${last.senderName || 'Soulprint'} vừa nhắn bạn`, body: last.text.length > 120 ? last.text.slice(0, 117) + '...' : last.text, link: null });
      }
    });
    this.catalogApi.getCategories().subscribe({ next: (c) => this.categories.set(c), error: () => {} });
    this.catalogApi.getOpenCollections().subscribe({ next: (c) => this.collections.set(c), error: () => {} });

    this.typing$
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((q) => (q.trim().length >= 2 ? this.productApi.suggest(q.trim()).pipe(catchError(() => of([]))) : of([]))),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe((list) => this.suggestions.set(list.slice(0, 5)));
  }

  // Tải khi mở menu Danh mục lần đầu: 3 lượt API-26 pageSize 1 chỉ để lấy tổng, không tải ở mọi trang
  loadAxisCounts(): void {
    if (this.axisCountsLoaded) return;
    this.axisCountsLoaded = true;
    for (const a of this.axes) {
      this.productApi.getProducts({ axis: a.slug, pageSize: 1 }).subscribe({
        next: (p) => this.axisCounts.update((m) => ({ ...m, [a.slug]: p.total })),
        error: () => {},
      });
    }
  }

  toggleBell(): void {
    this.bellOpen.set(!this.bellOpen());
    if (this.bellOpen()) this.notice.refresh();
  }

  openNotice(n: INotice): void {
    this.bellOpen.set(false);
    this.notice.markRead(n);
    this.router.navigateByUrl(n.link || '/tai-khoan/thong-bao');
  }

  openHighlight(link: string): void {
    this.notice.closeHighlight();
    this.router.navigateByUrl(link);
  }

  openPopup(p: INoticePopup): void {
    this.notice.dismiss(p.id);
    if (p.kind === 'chat') {
      this.chat.open();
      return;
    }
    const n = this.notice.latest().find((x) => x._id === p.id);
    if (n) this.notice.markRead(n);
    this.router.navigateByUrl(p.link || '/tai-khoan/thong-bao');
  }

  onType(value: string): void {
    this.keyword = value;
    this.open.set(true);
    this.typing$.next(value);
  }

  // Đóng hộp gợi ý sau khi rời ô (chờ một nhịp để kịp nhận cú bấm vào gợi ý)
  onBlur(): void {
    setTimeout(() => this.open.set(false), 150);
  }

  // Tìm kiếm chuyển sang /tim-kiem?q=... (query params, slide Chương IV)
  search(keyword: string): void {
    const q = keyword.trim();
    if (!q) return;
    this.open.set(false);
    this.router.navigate(['/tim-kiem'], { queryParams: { q } });
  }

  // Bấm gợi ý sản phẩm thì mở thẳng trang chi tiết; gợi ý danh mục thì mở /danh-muc/:slug (UC-DIS-03 nhánh 4a)
  pick(s: ISuggestion): void {
    this.open.set(false);
    this.keyword = '';
    if (s.type === 'category') this.router.navigate(['/danh-muc', s.slug]);
    else if (s.type === 'product') this.router.navigate(['/san-pham', s.slug]);
    else this.search(s.label);
  }

  // UC-ACC-02 nhánh 6a
  logout(): void {
    this.userMenu.set(false);
    this.confirmBox.ask({ title: 'Bạn có chắc chắn muốn đăng xuất?', okText: 'Đăng xuất' }).then((ok) => {
      if (ok) this.auth.logout().subscribe(() => this.router.navigate(['/']));
    });
  }

  pickPopular(text: string): void {
    this.keyword = text;
    this.search(text);
  }
}
