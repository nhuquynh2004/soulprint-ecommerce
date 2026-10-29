import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { CatalogApiService } from '../../services/catalog-apiservice';
import { CATEGORY_ICONS, IBanner, IHomeSection } from '../../classes/catalog';
import { AXIS_INFO, Axis, IProduct } from '../../classes/product';

// Banner mặc định khi chưa có banner nào đang hiển thị (06 Mục 2.7, UC-DIS-01 2Ea)
const DEFAULT_BANNER: IBanner = {
  _id: 'mac-dinh',
  title: 'Tìm món quà hoàn hảo dành tặng chàng',
  subtitle: 'Chọn quà thông minh cùng Sâu Béo hoặc tự tay thiết kế món quà mang dấu ấn riêng.',
  imageDesktop: '/images/banners/hero-dai-duong.svg',
  imageMobile: '/images/banners/hero-dai-duong-mobile.svg',
  ctaLabel: 'Tìm quà cùng AI',
  ctaLink: '/tu-van-qua',
};

// Trang chủ SCR-01 (UC-DIS-01): hiển thị các khối theo thứ tự Admin cấu hình (API-23).
// Khối không có dữ liệu đã được server bỏ; lỗi tải thì hiện khối lỗi + "Thử lại", header/footer vẫn dùng được.
@Component({
  selector: 'app-home',
  standalone: false,
  styleUrl: './home.scss',
  templateUrl: './home.html',
})
export class Home implements OnInit, OnDestroy {
  private readonly catalog = inject(CatalogApiService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly sections = signal<IHomeSection[]>([]);
  // Neo #bo-suu-tap cho liên kết "Bộ sưu tập" ở footer
  readonly firstCollectionId = computed(() => this.sections().find((s) => s.type === 'collection')?.id);
  readonly loading = signal(true);
  readonly errMessage = signal('');

  readonly categoryIcons = CATEGORY_ICONS;
  readonly axisInfo = AXIS_INFO;

  // Banner chạy vòng (khối banners luôn có; rỗng thì dùng banner mặc định)
  readonly banners = computed<IBanner[]>(() => {
    const block = this.sections().find((s) => s.type === 'banners');
    return block?.data.items.length ? (block.data.items as IBanner[]) : [DEFAULT_BANNER];
  });
  readonly bannerIndex = signal(0);
  private timer?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  load(): void {
    this.loading.set(true);
    this.errMessage.set('');
    const preview = new URLSearchParams(location.search).get('preview') === 'draft';
    this.catalog.getHome(preview).subscribe({
      next: (data) => {
        this.sections.set(data);
        this.loading.set(false);
        this.startBanner();
      },
      error: () => {
        this.errMessage.set('Không tải được nội dung');
        this.loading.set(false);
      },
    });
  }

  private startBanner(): void {
    clearInterval(this.timer);
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (this.banners().length > 1 && !reduce) this.timer = setInterval(() => this.nextBanner(1), 6000);
  }

  nextBanner(step: number): void {
    const n = this.banners().length;
    this.bannerIndex.update((i) => (i + step + n) % n);
  }

  goBanner(i: number): void {
    this.bannerIndex.set(i);
    this.startBanner(); // khách tự chuyển thì đếm lại thời gian
  }

  products(section: IHomeSection): IProduct[] {
    return section.data.items as IProduct[];
  }

  axisCss(code: string): string {
    return AXIS_INFO[code as Axis]?.css ?? 'sport';
  }

  axisIcon(code: string): string {
    return AXIS_INFO[code as Axis]?.icon ?? 'star';
  }

  initials(name: string): string {
    return name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  // Liên kết "Xem tất cả" của khối danh sách sản phẩm
  // Đường dẫn nhúng YouTube của khối Video: chỉ nhận mã 11 ký tự đã kiểm ở server, nhớ theo mã để không tải lại iframe
  private readonly videos = new Map<string, SafeResourceUrl>();
  videoUrl(id: string): SafeResourceUrl {
    if (!this.videos.has(id)) {
      const safe = /^[\w-]{11}$/.test(id) ? id : '';
      this.videos.set(id, this.sanitizer.bypassSecurityTrustResourceUrl('https://www.youtube-nocookie.com/embed/' + safe));
    }
    return this.videos.get(id)!;
  }

  listLink(section: IHomeSection): { path: string; query: Record<string, string> } {
    const source = (section.settings as any).source || {};
    if (section.type === 'featured' || source.kind === 'BEST_SELLING') return { path: '/san-pham', query: { chip: 'ban-chay' } };
    if (source.kind === 'NEW') return { path: '/san-pham', query: { chip: 'moi' } };
    return { path: '/san-pham', query: {} };
  }
}
