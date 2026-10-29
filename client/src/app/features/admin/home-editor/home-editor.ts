import { AfterViewInit, Component, DestroyRef, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, Subject, catchError, debounceTime, forkJoin, of, switchMap } from 'rxjs';
import { AdminStoreApiService } from '../../../services/admin-store-apiservice';
import { AdminCatalogApiService } from '../../../services/admin-catalog-apiservice';
import { AuthService } from '../../../services/auth';
import { ToastService } from '../../../services/toast';
import { ApiError } from '../../../classes/api-error';
import {
  HomeSectionType,
  IAdminCategory,
  IAdminCollection,
  IAdminProductRow,
  IAdminTag,
  IBanner,
  IHomeSection,
  IPickedProduct,
} from '../../../classes/admin-catalog';
import { HasUnsavedChanges } from '../../../guards/unsaved-changes-guard';

export const BLOCK_TYPES: { type: HomeSectionType; label: string; icon: string; multiple: boolean }[] = [
  { type: 'banners', label: 'Banner', icon: 'image', multiple: false },
  { type: 'categories', label: 'Danh mục', icon: 'grid', multiple: false },
  { type: 'axes', label: 'Khám phá theo đam mê', icon: 'sparkle', multiple: false },
  { type: 'recipientGroups', label: 'Mua theo người nhận', icon: 'users', multiple: false },
  { type: 'featured', label: 'Sản phẩm nổi bật', icon: 'star', multiple: false },
  { type: 'collection', label: 'Bộ sưu tập', icon: 'layers', multiple: true },
  { type: 'productList', label: 'Danh sách sản phẩm', icon: 'list-ul', multiple: true },
  { type: 'featuredReviews', label: 'Đánh giá khách hàng', icon: 'chat', multiple: false },
  { type: 'richText', label: 'Khối chữ và nút', icon: 'file', multiple: true },
  { type: 'video', label: 'Video', icon: 'video', multiple: true },
];

const SOURCE_LABEL: Record<string, string> = { NEW: 'Sản phẩm mới nhất', BEST_SELLING: 'Bán chạy', CATEGORY: 'Theo danh mục', AXIS: 'Theo trục đam mê', TAG: 'Theo tag' };

// SCR-55 Trình chỉnh sửa trang chủ (UC-CAT-05 nhánh 1d, 1e, 1f, AC3, AC4): trái là danh sách khối (kéo thả, nút mắt,
// bấm để mở cài đặt, "+ Thêm khối"), phải là xem trước trực tiếp bản nháp (iframe tới /?preview=draft, Desktop/Mobile).
// "Lưu nháp" (API-114) không đổi trang khách; "Xuất bản" (API-170) mới đổi. Banner, sản phẩm nổi bật là khối con.
@Component({
  selector: 'app-home-editor',
  standalone: false,
  templateUrl: './home-editor.html',
  styleUrl: './home-editor.scss',
})
export class HomeEditor implements HasUnsavedChanges, AfterViewInit {
  private readonly api = inject(AdminStoreApiService);
  private readonly catalogApi = inject(AdminCatalogApiService);
  protected readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  @ViewChild('box') set box(el: ElementRef<HTMLElement> | undefined) {
    this.observer?.disconnect();
    if (!el) return;
    // Khung xem trước đổi kích thước thì tính lại tỉ lệ thu nhỏ iframe 1280px
    this.observer = new ResizeObserver(([e]) => {
      this.scale.set(Math.min(1, e.contentRect.width / 1280));
      this.boxHeight.set(e.contentRect.height);
    });
    this.observer.observe(el.nativeElement);
  }
  private observer?: ResizeObserver;
  readonly scale = signal(0.5);
  readonly boxHeight = signal(600);

  readonly blockTypes = BLOCK_TYPES;
  readonly sourceLabel = SOURCE_LABEL;
  readonly canEdit = this.auth.can('TRANG_CHU.SUA');
  readonly canPublish = this.auth.can('TRANG_CHU.XUAT_BAN');

  readonly sections = signal<IHomeSection[]>([]);
  readonly banners = signal<IBanner[]>([]);
  readonly featured = signal<IPickedProduct[]>([]);
  readonly publishedAt = signal<string | null>(null);
  readonly unpublished = signal(false);
  readonly dirty = signal(false);
  readonly featuredDirty = signal(false);
  readonly loading = signal(true);
  readonly errMessage = signal('');
  readonly saving = signal(false);
  readonly error = signal('');

  readonly open = signal<string | null>(null);
  readonly addMenu = signal(false);
  readonly device = signal<'desktop' | 'mobile'>('desktop');
  readonly frameSrc = signal('/?preview=draft');
  private dragFrom: number | null = null;

  readonly collections = signal<IAdminCollection[]>([]);
  readonly categories = signal<IAdminCategory[]>([]);
  readonly tags = signal<IAdminTag[]>([]);

  // Khối con Banner, Sản phẩm nổi bật
  readonly editingBanner = signal<IBanner | 'new' | null>(null);
  readonly deletingBanner = signal<IBanner | null>(null);
  readonly featuredQ = signal('');
  readonly featuredResults = signal<IAdminProductRow[]>([]);
  private readonly featured$ = new Subject<string>();

  readonly leaveDialog = signal(false);
  private leave$ = new Subject<boolean>();
  readonly confirmReset = signal(false);

  readonly addable = computed(() => BLOCK_TYPES.filter((b) => b.multiple || !this.sections().some((s) => s.type === b.type)));

  ngAfterViewInit(): void {
    this.destroyRef.onDestroy(() => this.observer?.disconnect());
  }

  constructor() {
    this.featured$
      .pipe(
        debounceTime(300),
        switchMap((q) => (q ? this.catalogApi.getProducts({ q, status: 'DANG_HIEN_THI', page: 1 }).pipe(catchError(() => of(null))) : of(null))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((d) => this.featuredResults.set(d ? d.items.filter((p) => !this.featured().some((f) => f._id === p._id)).slice(0, 8) : []));
    forkJoin([
      this.api.getCollections({ page: 1 }).pipe(catchError(() => of({ items: [] as IAdminCollection[] }))),
      this.catalogApi.getCategories().pipe(catchError(() => of([]))),
      this.auth.can('TAGS.XEM') ? this.catalogApi.getTags().pipe(catchError(() => of([]))) : of([]),
    ]).subscribe(([c, cats, tags]) => {
      this.collections.set(c.items);
      this.categories.set(cats);
      this.tags.set(tags.filter((t) => !t.range));
    });
    this.load();
  }

  load(): void {
    this.errMessage.set('');
    this.api.getHome().subscribe({
      next: (h) => {
        this.sections.set(structuredClone(h.draft.sections));
        this.banners.set(h.banners);
        this.featured.set(h.featured);
        this.publishedAt.set(h.publishedAt);
        this.unpublished.set(h.hasUnpublishedChanges);
        this.dirty.set(false);
        this.featuredDirty.set(false);
        this.loading.set(false);
      },
      error: (err: ApiError) => {
        this.errMessage.set(err.message);
        this.loading.set(false);
      },
    });
  }

  label(s: IHomeSection): string {
    return BLOCK_TYPES.find((b) => b.type === s.type)?.label || s.type;
  }

  icon(s: IHomeSection): string {
    return BLOCK_TYPES.find((b) => b.type === s.type)?.icon || 'file';
  }

  // Dòng phụ dưới tên khối (SCR-55: "2 banner", "6 danh mục", tên BST...)
  summary(s: IHomeSection): string {
    switch (s.type) {
      case 'banners':
        return `${this.banners().filter((b) => b.isActive).length} banner đang bật`;
      case 'categories':
        return `${this.categories().filter((c) => c.isActive).length} danh mục`;
      case 'axes':
        return 'Thể thao, Anime, Game';
      case 'featured':
        return `${this.featured().length} sản phẩm`;
      case 'collection': {
        // BST chưa hiển thị thì khách không thấy khối dù mắt đang mở
        const c = this.collections().find((x) => x._id === s.settings.collectionId);
        return c ? c.name + (c.displayStatus !== 'DANG_HIEN' ? ' (BST chưa hiện)' : '') : 'Chưa chọn bộ sưu tập';
      }
      case 'productList':
        return SOURCE_LABEL[s.settings.source?.kind || 'NEW'];
      case 'video':
        return s.settings.youtubeId || s.settings.youtubeUrl ? 'YouTube' : 'Chưa có video';
      default:
        return s.settings.title || '';
    }
  }

  private change(list: IHomeSection[]): void {
    this.sections.set(list);
    this.dirty.set(true);
    this.error.set('');
  }

  update(s: IHomeSection, patch: Partial<IHomeSection['settings']>): void {
    this.change(this.sections().map((x) => (x.id === s.id ? { ...x, settings: { ...x.settings, ...patch } } : x)));
  }

  setSource(s: IHomeSection, kind: string): void {
    this.update(s, { source: { kind: kind as any, id: null } });
  }

  toggleVisible(s: IHomeSection): void {
    this.change(this.sections().map((x) => (x.id === s.id ? { ...x, visible: !x.visible } : x)));
  }

  remove(s: IHomeSection): void {
    this.change(this.sections().filter((x) => x.id !== s.id));
    this.open.set(null);
  }

  add(type: HomeSectionType): void {
    this.addMenu.set(false);
    const id = `${type}-${Date.now().toString(36)}`;
    const settings: IHomeSection['settings'] =
      type === 'collection'
        ? { collectionId: this.collections().find((c) => c.showOnHome)?._id || this.collections()[0]?._id || null, limit: 8 }
        : type === 'productList'
          ? { title: 'Sản phẩm mới', source: { kind: 'NEW' }, limit: 8 }
          : type === 'richText'
            ? { title: 'Cam kết của Soulprint', body: '<p>Đổi trả trong 7 ngày, bảo hành tới 12 tháng.</p>', ctaLabel: '', ctaLink: '' }
            : type === 'video'
              ? { title: 'Câu chuyện Soulprint', youtubeUrl: '', caption: '' }
            : type === 'featured'
              ? { title: 'Sản phẩm nổi bật', limit: 8 }
              : { title: BLOCK_TYPES.find((b) => b.type === type)!.label };
    this.change([...this.sections(), { id, type, visible: true, settings }]);
    this.open.set(id);
  }

  // Khôi phục bố cục gợi ý: Banner → Danh mục → Sản phẩm nổi bật → Bộ sưu tập → Đánh giá khách hàng → Khối chữ cam kết đổi trả
  resetLayout(): void {
    this.confirmReset.set(false);
    const col = this.collections().find((c) => c.showOnHome && c.status === 'HIEN_THI') || this.collections()[0];
    const list: IHomeSection[] = [
      { id: 'banners', type: 'banners', visible: true, settings: {} },
      { id: 'categories', type: 'categories', visible: true, settings: { title: 'Mua theo nhu cầu' } },
      { id: 'featured', type: 'featured', visible: true, settings: { title: 'Sản phẩm nổi bật', limit: 8 } },
      ...(col ? [{ id: 'collection-' + col.slug, type: 'collection' as const, visible: true, settings: { collectionId: col._id, limit: 8 } }] : []),
      { id: 'featuredReviews', type: 'featuredReviews', visible: true, settings: { title: 'Khách hàng nói gì' } },
      { id: 'richText-cam-ket', type: 'richText', visible: true, settings: { title: 'Đổi trả 7 ngày, bảo hành 12 tháng', body: '<p>Soulprint nhận đổi trả trong 7 ngày và bảo hành tới 12 tháng cho sản phẩm lỗi.</p>', ctaLabel: 'Xem chính sách', ctaLink: '/chinh-sach/doi-tra' } },
    ];
    this.change(list);
    this.toast.show('Đã khôi phục bố cục gợi ý. Bấm Lưu nháp để xem trước.', 'info');
  }

  // ===== Kéo thả thứ tự khối =====

  onDragStart(i: number): void {
    this.dragFrom = i;
  }

  onDrop(i: number, e: DragEvent): void {
    e.preventDefault();
    if (this.dragFrom === null || this.dragFrom === i) return;
    const list = [...this.sections()];
    const [s] = list.splice(this.dragFrom, 1);
    list.splice(i, 0, s);
    this.dragFrom = null;
    this.change(list);
  }

  // ===== Lưu nháp, xuất bản =====

  saveDraft(then?: () => void): void {
    this.saving.set(true);
    this.error.set('');
    const featured = this.featuredDirty() ? this.featured().map((p, i) => ({ productId: p._id, order: i + 1 })) : undefined;
    this.api.saveHomeDraft({ sections: this.sections(), featured }).subscribe({
      next: (r) => {
        this.saving.set(false);
        this.sections.set(structuredClone(r.draft.sections));
        this.featured.set(r.featured);
        this.unpublished.set(r.hasUnpublishedChanges);
        this.dirty.set(false);
        this.featuredDirty.set(false);
        this.reloadFrame();
        if (then) then();
        else this.toast.show('Đã lưu nháp. Khách chưa thấy thay đổi cho tới khi Xuất bản.');
      },
      error: (err: ApiError) => {
        this.saving.set(false);
        this.error.set(err.message);
      },
    });
  }

  publish(): void {
    const run = () =>
      this.api.publishHome().subscribe({
        next: (r) => {
          this.publishedAt.set(r.publishedAt);
          this.unpublished.set(false);
          this.toast.show('Đã xuất bản trang chủ');
        },
        error: (err: ApiError) => this.error.set(err.message),
      });
    if (this.dirty() || this.featuredDirty()) this.saveDraft(run);
    else run();
  }

  reloadFrame(): void {
    this.frameSrc.set('/?preview=draft&t=' + Date.now());
  }

  openPreview(): void {
    window.open('/?preview=draft', '_blank');
  }

  // ===== Sản phẩm nổi bật (1f) =====

  onFeaturedSearch(v: string): void {
    this.featuredQ.set(v);
    this.featured$.next(v.trim());
  }

  addFeatured(p: IAdminProductRow): void {
    if (this.featured().length >= 8) return this.toast.show('Tối đa 8 sản phẩm nổi bật', 'info');
    this.featured.set([...this.featured(), { _id: p._id, name: p.name, sku: p.sku, image: p.image, price: p.price, salePrice: p.salePrice, status: p.status }]);
    this.featuredResults.set(this.featuredResults().filter((x) => x._id !== p._id));
    this.featuredDirty.set(true);
  }

  moveFeatured(i: number, d: -1 | 1): void {
    const list = [...this.featured()];
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    this.featured.set(list);
    this.featuredDirty.set(true);
  }

  removeFeatured(id: string): void {
    this.featured.set(this.featured().filter((p) => p._id !== id));
    this.featuredDirty.set(true);
  }

  // ===== Banner (1e) - lưu ngay qua API-115 đến 117, không chờ Xuất bản =====

  toggleBanner(b: IBanner): void {
    this.api.updateBanner({ _id: b._id!, isActive: !b.isActive }).subscribe({
      next: (x) => {
        this.banners.set(this.banners().map((y) => (y._id === x._id ? x : y)));
        this.reloadFrame();
      },
      error: (err: ApiError) => this.toast.show(err.message, 'danger'),
    });
  }

  moveBanner(i: number, d: -1 | 1): void {
    const list = [...this.banners()];
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    this.banners.set(list);
    forkJoin(list.map((b, k) => this.api.updateBanner({ _id: b._id!, sortOrder: k + 1 }))).subscribe({
      next: () => this.reloadFrame(),
      error: (err: ApiError) => this.toast.show(err.message, 'danger'),
    });
  }

  doDeleteBanner(): void {
    const b = this.deletingBanner()!;
    this.deletingBanner.set(null);
    this.api.deleteBanner(b._id!).subscribe({
      next: () => {
        this.banners.set(this.banners().filter((x) => x._id !== b._id));
        this.toast.show('Đã xóa banner');
        this.reloadFrame();
      },
      error: (err: ApiError) => this.toast.show(err.message, 'danger'),
    });
  }

  onBannerSaved(b: IBanner | null): void {
    this.editingBanner.set(null);
    if (!b) return;
    const exists = this.banners().some((x) => x._id === b._id);
    this.banners.set(exists ? this.banners().map((x) => (x._id === b._id ? b : x)) : [...this.banners(), b]);
    this.toast.show('Đã lưu banner');
    this.reloadFrame();
  }

  // ===== Rời trang =====

  hasUnsavedChanges(): boolean {
    return this.dirty() || this.featuredDirty();
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
