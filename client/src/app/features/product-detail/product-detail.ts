import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { EMPTY, catchError, switchMap, tap } from 'rxjs';
import { ProductApiService } from '../../services/product-apiservice';
import { CatalogApiService } from '../../services/catalog-apiservice';
import { AXIS_INFO, IOptionGroup, IProduct, IProductDetail, IReview, IReviewPage, IVariant, Product } from '../../classes/product';
import { ICategory } from '../../classes/catalog';
import { ApiError } from '../../classes/api-error';
import { IPersonalization, IPersonalizeProduct, describePersonalization } from '../../classes/cart';
import { CartService } from '../../services/cart';
import { WishlistService } from '../../services/wishlist';
import { ToastService } from '../../services/toast';
import { DesignApiService } from '../../services/design-apiservice';
import { PersonalizeResult, PersonalizeTab } from '../../shared/personalize-dialog/personalize-dialog';

type Tab = 'mo-ta' | 'thong-so' | 'chinh-sach';
const LOW_STOCK = 5;
const REVIEW_PREVIEW = 3;

// SCR-03 Chi tiết sản phẩm (UC-DIS-02, BR-39).
// Signal giữ giá trị khách đang chọn ở từng nhóm biến thể; computed() suy ra biến thể, giá, tồn kho và bộ ảnh
// tương ứng, nên đổi lựa chọn là giao diện cập nhật ngay, không tải lại trang, URL không đổi (AC1).
// S4 (UC-CRT-01): cá nhân hóa không bắt buộc, chọn ở mục "Cá nhân hóa" (mở SCR-04) rồi mới Thêm vào giỏ / Mua ngay.
@Component({
  selector: 'app-product-detail',
  standalone: false,
  templateUrl: './product-detail.html',
  styleUrl: './product-detail.scss',
})
export class ProductDetail {
  private readonly route = inject(ActivatedRoute);
  private readonly title = inject(Title);
  private readonly productApi = inject(ProductApiService);
  private readonly catalogApi = inject(CatalogApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly cart = inject(CartService);
  private readonly designApi = inject(DesignApiService);
  private readonly toast = inject(ToastService);
  protected readonly wishlist = inject(WishlistService);

  readonly product = signal<IProductDetail | null>(null);
  readonly loading = signal(true);
  readonly errMessage = signal('');
  readonly notFound = signal(false);
  readonly categories = signal<ICategory[]>([]);
  readonly popular = signal<IProduct[]>([]);

  readonly selected = signal<Record<string, string>>({});
  readonly activeImage = signal(0);
  readonly quantity = signal(1);
  readonly tab = signal<Tab>('mo-ta');
  readonly cartNote = signal('');
  readonly adding = signal(false);
  readonly stickerFee = signal(5000);
  // Cá nhân hóa đang chọn (null = sản phẩm trơn) và tab hộp thoại đang mở (null = đóng)
  readonly chosen = signal<IPersonalization | null>(null);
  readonly dialogTab = signal<PersonalizeTab | null>(null);
  readonly dialogInitial = signal<IPersonalization | null>(null);
  readonly describe = describePersonalization;

  readonly reviews = signal<IReviewPage | null>(null);
  readonly reviewItems = signal<IReview[]>([]);
  readonly reviewRating = signal<number | null>(null);
  readonly showAllReviews = signal(false);

  readonly axisInfo = AXIS_INFO;
  readonly stars = [5, 4, 3, 2, 1] as const;

  readonly groups = computed<IOptionGroup[]>(() => this.product()?.optionGroups ?? []);

  // Biến thể ứng với tổ hợp đang chọn (sản phẩm không có nhóm biến thể: biến thể "Mặc định")
  readonly variant = computed<IVariant | null>(() => {
    const p = this.product();
    if (!p) return null;
    if (!p.optionGroups.length) return p.variants[0] ?? null;
    const sel = this.selected();
    return p.variants.find((v) => p.optionGroups.every((g) => v.attributes[g.name] === sel[g.name])) ?? null;
  });

  // Giá = giá hiệu lực của sản phẩm + chênh giá biến thể (06 Mục 2.4, AC7)
  readonly unitPrice = computed(() => (this.product()?.finalPrice ?? 0) + (this.variant()?.priceDelta ?? 0));
  readonly wasPrice = computed(() => (this.product()?.price ?? 0) + (this.variant()?.priceDelta ?? 0));

  // Bộ ảnh: ảnh của giá trị đang chọn ở nhóm gắn ảnh; giá trị chưa có ảnh thì dùng ảnh chính (BR-39, AC6)
  readonly images = computed<string[]>(() => {
    const p = this.product();
    if (!p) return [];
    const g = p.optionGroups.find((x) => x.hasImages);
    const value = g?.values.find((v) => v.value === this.selected()[g.name]);
    if (value?.images?.length) return value.images;
    return p.images.length ? p.images : [Product.PLACEHOLDER];
  });

  readonly stock = computed(() => this.variant()?.stock ?? 0);
  readonly soldOut = computed(() => !!this.variant() && this.stock() === 0);
  readonly lowStock = computed(() => this.stock() > 0 && this.stock() <= LOW_STOCK);

  // Một hộp cảnh báo duy nhất dưới bộ chọn biến thể (UC-DIS-02 4Ea), VD "Size XL tạm hết hàng. Bạn chọn size M hoặc L nhé"
  readonly stockWarning = computed(() => {
    const v = this.variant();
    if (!v || v.stock > 0) return '';
    const sel = this.selected();
    for (const g of [...this.groups()].reverse()) {
      const alts = g.values.filter((x) => x.value !== sel[g.name] && !this.isOut(g.name, x.value)).map((x) => x.value);
      if (alts.length) return `${g.name} ${sel[g.name]} tạm hết hàng. Bạn chọn ${g.name.toLowerCase()} ${alts.join(' hoặc ')} nhé`;
    }
    return this.groups().length ? `Phiên bản ${v.name} tạm hết hàng` : 'Sản phẩm tạm hết hàng';
  });

  // Dữ liệu hộp thoại cá nhân hóa cần (ảnh theo biến thể đang chọn)
  readonly personalizeProduct = computed<IPersonalizeProduct | null>(() => {
    const p = this.product();
    if (!p) return null;
    return { _id: p._id, name: p.name, slug: p.slug, image: this.images()[0] ?? null, axis: p.axis, personalization: p.personalization, stickerSets: p.stickerSets };
  });

  readonly chosenFee = computed(() => {
    const c = this.chosen();
    return c?.type === 'THIET_KE' ? c.stickers.length * this.stickerFee() : 0;
  });

  readonly visibleReviews = computed(() => (this.showAllReviews() ? this.reviewItems() : this.reviewItems().slice(0, REVIEW_PREVIEW)));

  constructor() {
    this.catalogApi.getCategories().subscribe({ next: (c) => this.categories.set(c), error: () => {} });
    this.catalogApi.getPublicSettings().subscribe({ next: (s) => this.stickerFee.set(s.stickerFee), error: () => {} });

    this.route.paramMap
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.errMessage.set('');
          this.notFound.set(false);
        }),
        // Lỗi xử lý bên trong để luồng đọc đường dẫn không dừng: từ trang 404 bấm sang sản phẩm khác vẫn tải được
        switchMap((params) =>
          this.productApi.getProduct(params.get('slug') || '').pipe(
            catchError((err: ApiError) => {
              this.fail(err);
              return EMPTY;
            }),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((p) => this.show(p));
  }

  private show(p: IProductDetail): void {
    this.product.set(p);
    this.loading.set(false);
    this.title.setTitle(`${p.name} - Soulprint`); // đặt Title theo tên sản phẩm (Chương IV)
    this.activeImage.set(0);
    this.quantity.set(1);
    this.tab.set('mo-ta');
    this.cartNote.set('');
    this.chosen.set(null);
    this.dialogTab.set(null);
    // Chọn sẵn tổ hợp còn hàng đầu tiên
    const first = p.variants.find((v) => v.stock > 0) ?? p.variants[0];
    this.selected.set(first ? { ...first.attributes } : {});
    this.showAllReviews.set(false);
    this.reviewRating.set(null);
    this.loadReviews(1);
    this.openSavedDesign();
  }

  private fail(err: ApiError): void {
    this.loading.set(false);
    this.product.set(null);
    if (err.status === 404) {
      this.notFound.set(true);
      this.title.setTitle('Không tìm thấy sản phẩm - Soulprint');
      this.productApi.getProducts({ sort: 'pho-bien', pageSize: 4 }).subscribe({ next: (r) => this.popular.set(r.items), error: () => {} });
    } else {
      this.errMessage.set('Không tải được sản phẩm. Thử lại');
    }
  }

  reload(): void {
    const slug = this.route.snapshot.paramMap.get('slug') || '';
    this.loading.set(true);
    this.errMessage.set('');
    this.productApi.getProduct(slug).subscribe({ next: (p) => this.show(p), error: (err: ApiError) => this.fail(err) });
  }

  // Tổ hợp (các nhóm khác giữ lựa chọn hiện tại + giá trị này) có còn hàng không
  isOut(groupName: string, value: string): boolean {
    const p = this.product();
    if (!p) return false;
    const sel = { ...this.selected(), [groupName]: value };
    const matches = p.variants.filter((v) => p.optionGroups.every((g) => !sel[g.name] || v.attributes[g.name] === sel[g.name]));
    return !matches.some((v) => v.stock > 0);
  }

  select(group: IOptionGroup, value: string): void {
    this.selected.update((s) => ({ ...s, [group.name]: value }));
    if (group.hasImages) this.activeImage.set(0); // đổi Size thì bộ ảnh giữ nguyên (AC6)
    this.cartNote.set('');
    if (this.quantity() > Math.max(1, this.stock())) this.quantity.set(Math.max(1, this.stock()));
  }

  changeQuantity(step: number): void {
    this.quantity.update((q) => Math.min(Math.max(1, q + step), Math.max(1, this.stock())));
  }

  // Mở hộp thoại cá nhân hóa ở tab đã bấm (UC-CRT-01 bước 2-3, nhánh 2a, 6a)
  openPersonalize(tab: PersonalizeTab): void {
    this.dialogInitial.set(this.chosen());
    this.dialogTab.set(tab);
  }

  onPersonalized(result: PersonalizeResult): void {
    this.chosen.set(result.personalization);
    this.dialogTab.set(null);
    this.cartNote.set('');
  }

  // "Dùng lại" ở Thiết kế đã lưu: /san-pham/:slug?thietKe=<id> mở sẵn hộp thoại (UC-CRT-01 1b, UC-ACC-06 2a)
  private openSavedDesign(): void {
    const id = this.route.snapshot.queryParamMap.get('thietKe');
    if (!id) return;
    this.designApi.getDesigns('CA_NHAN_HOA').subscribe({
      next: (list) => {
        const d = list.find((x) => x._id === id);
        if (!d?.personalization || d.productId !== this.product()?._id) return;
        if (d.stickerGone) this.toast.show('Một số sticker đã hết mùa', 'info');
        this.dialogInitial.set(d.personalization);
        this.dialogTab.set(d.personalization.type);
      },
      error: () => {},
    });
  }

  // Thêm vào giỏ / Mua ngay (UC-CRT-01 bước 7-9). Mua ngay chỉ chọn dòng này rồi sang giỏ hàng;
  // trang Thanh toán (SCR-07) làm ở S5.
  addToCart(buyNow = false): void {
    const p = this.product();
    const v = this.variant();
    if (!p || !v || this.adding()) return;
    this.adding.set(true);
    this.cartNote.set('');
    // Mở từ thẻ gợi ý SCR-10 (?ai=<sessionId>): ghi lượt bấm vào aiSessions (UC-DIS-05 AC5)
    const aiSessionId = this.route.snapshot.queryParamMap.get('ai');
    this.cart.add({ productId: p._id, variantSku: v.sku, quantity: this.quantity(), personalization: this.chosen(), aiSessionId }, buyNow).subscribe({
      next: () => {
        this.adding.set(false);
        if (buyNow) this.router.navigate(['/gio-hang']);
        else this.toast.show('Đã thêm vào giỏ hàng');
      },
      error: (err: ApiError) => {
        this.adding.set(false);
        this.cartNote.set(err.message);
      },
    });
  }

  loadReviews(page: number): void {
    const p = this.product();
    if (!p) return;
    this.productApi.getReviews(p._id, this.reviewRating(), page).subscribe({
      next: (r) => {
        this.reviews.set(r);
        this.reviewItems.update((items) => (page === 1 ? r.items : [...items, ...r.items]));
      },
      error: () => this.reviews.set(null),
    });
  }

  // "Xem tất cả đánh giá": hiện toàn bộ, lọc theo số sao, không rời trang (UC-DIS-02 7b)
  filterReviews(rating: number | null): void {
    this.showAllReviews.set(true);
    this.reviewRating.set(rating);
    this.loadReviews(1);
  }

  percent(star: 1 | 2 | 3 | 4 | 5): number {
    const r = this.reviews();
    return r && r.ratingCount ? Math.round((r.distribution[star] / r.ratingCount) * 100) : 0;
  }

  scrollTo(id: string): void {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
