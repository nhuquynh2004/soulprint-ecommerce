import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { BehaviorSubject, Observable, catchError, combineLatest, map, of, switchMap, tap } from 'rxjs';
import { ProductApiService } from '../../services/product-apiservice';
import { CatalogApiService } from '../../services/catalog-apiservice';
import { RecentSearchService } from '../../services/recent-search';
import { ICategory, ICollection, ITagGroup } from '../../classes/catalog';
import { IPage, IProduct } from '../../classes/product';
import { ApiError } from '../../classes/api-error';
import {
  AXES,
  CHIPS,
  EMPTY_FILTER,
  FilterState,
  RATINGS,
  SORTS,
  UNDER_300K,
  rangeValue,
  countCriteria,
  isPriceOnly,
  parsePrice,
  readFilter,
  toApiQuery,
  toQueryParams,
} from './filter-state';

type Mode = 'all' | 'category' | 'search' | 'collection';
const PAGE_SIZE = 12; // UC-DIS-04 bước 5

interface ActiveChip {
  label: string;
  patch: Partial<FilterState>;
}

// SCR-02 Danh sách sản phẩm (UC-DIS-01 3d, UC-DIS-03, UC-DIS-04) và SCR-32 Trang bộ sưu tập (UC-DIS-01 3e).
// Một component cho 4 route, phân biệt bằng data.mode của route:
//   /san-pham, /danh-muc/:slug, /tim-kiem?q=, /bo-suu-tap/:slug
// Bộ lọc nằm trên URL (query params - Chương IV): đổi lọc = điều hướng tới URL mới, component đọc URL rồi gọi API.
@Component({
  selector: 'app-product-list',
  standalone: false,
  templateUrl: './product-list.html',
  styleUrl: './product-list.scss',
})
export class ProductList {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly title = inject(Title);
  private readonly productApi = inject(ProductApiService);
  private readonly catalogApi = inject(CatalogApiService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly recent = inject(RecentSearchService);

  // Bấm "Thử lại" thì phát lại để gọi API với cùng URL
  private readonly reload$ = new BehaviorSubject(0);

  readonly mode = signal<Mode>('all');
  readonly slug = signal('');
  readonly filter = signal<FilterState>(EMPTY_FILTER);

  readonly categories = signal<ICategory[]>([]);
  readonly tagGroups = signal<ITagGroup[]>([]);
  readonly collection = signal<ICollection | null>(null);

  readonly result = signal<IPage<IProduct> | null>(null);
  readonly loading = signal(true);
  readonly errMessage = signal('');
  readonly notFound = signal(false);
  // Bộ sưu tập đã kết thúc (API-108 trả 404 kèm ended)
  readonly ended = signal<{ collection: ICollection; openCollections: ICollection[] } | null>(null);
  // Sản phẩm phổ biến khi tìm kiếm không có kết quả (UC-DIS-03 5Ea)
  readonly popular = signal<IProduct[]>([]);

  readonly chips = CHIPS;
  readonly sorts = SORTS;
  readonly under300k = UNDER_300K;
  readonly skeleton = Array.from({ length: PAGE_SIZE }, (_, i) => i);

  readonly category = computed(() => this.categories().find((c) => c.slug === this.slug()) || null);
  readonly criteriaCount = computed(() => countCriteria(this.filter()));
  // /danh-muc/:slug với slug không có trong danh sách danh mục đang hiện
  readonly missing = computed(() => this.notFound() || (this.mode() === 'category' && this.categories().length > 0 && !this.category()));

  // "Đang lọc:" - mỗi tiêu chí là 1 chip bỏ được (UC-DIS-04 nhánh 2b)
  readonly activeChips = computed<ActiveChip[]>(() => {
    const f = this.filter();
    const out: ActiveChip[] = [];
    const tagName = new Map(this.tagGroups().flatMap((g) => g.items.map((t) => [t.slug, t.name] as const)));
    const catName = new Map(this.categories().map((c) => [c.slug, c.name] as const));
    for (const c of f.categories) out.push({ label: catName.get(c) || c, patch: { categories: f.categories.filter((x) => x !== c) } });
    for (const a of f.axes) out.push({ label: AXES.find((x) => x.value === a)?.label || a, patch: { axes: f.axes.filter((x) => x !== a) } });
    for (const t of f.tags) out.push({ label: tagName.get(t) || t, patch: { tags: f.tags.filter((x) => x !== t) } });
    // Ngân sách, độ tuổi: lấy tên mức từ nhóm khoảng của API-25, không khớp mức nào thì hiện khoảng số
    const rangeName = (field: 'PRICE' | 'AGE', value: string) => {
      const g = this.tagGroups().find((x) => x.kind === 'RANGE' && x.rangeField === field);
      return g?.items.find((i) => i.range && rangeValue(field, i.range) === value)?.name;
    };
    if (f.price) out.push({ label: rangeName('PRICE', f.price) || this.priceLabel(f.price), patch: { price: null } });
    if (f.age) out.push({ label: rangeName('AGE', f.age) || f.age + ' tuổi', patch: { age: null } });
    if (f.rating) out.push({ label: RATINGS.find((r) => r.value === f.rating)?.label || '', patch: { rating: null } });
    return out;
  });

  readonly heading = computed(() => {
    switch (this.mode()) {
      case 'category':
        return this.category()?.name || 'Danh mục';
      case 'search':
        return this.filter().q ? `Kết quả cho "${this.filter().q}"` : 'Tìm kiếm';
      case 'collection':
        return this.collection()?.name || 'Bộ sưu tập';
      default:
        return 'Tất cả sản phẩm';
    }
  });

  readonly rangeText = computed(() => {
    const r = this.result();
    if (!r || !r.total) return '';
    const from = (r.page - 1) * r.pageSize + 1;
    return `Hiển thị ${from}-${Math.min(r.page * r.pageSize, r.total)} trong ${r.total} sản phẩm`;
  });

  constructor() {
    this.catalogApi.getCategories().subscribe({ next: (c) => this.categories.set(c), error: () => {} });
    this.catalogApi.getFilterTags().subscribe({ next: (t) => this.tagGroups.set(t), error: () => {} });

    combineLatest([this.route.data, this.route.paramMap, this.route.queryParamMap, this.reload$])
      .pipe(
        map(([data, params, query]) => ({ mode: (data['mode'] || 'all') as Mode, slug: params.get('slug') || '', filter: readFilter(query) })),
        tap(({ mode, slug, filter }) => {
          this.mode.set(mode);
          this.slug.set(slug);
          this.filter.set(filter);
          if (mode === 'search' && filter.q) this.recent.add(filter.q); // 3 từ khóa gần nhất của Member
          this.loading.set(true);
          this.errMessage.set('');
          this.notFound.set(false);
          this.ended.set(null);
        }),
        switchMap(({ mode, slug, filter }) => this.fetch(mode, slug, filter)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((page) => {
        this.loading.set(false);
        if (page) this.result.set(page);
        this.updateTitle();
        if (page && !page.total && this.mode() === 'search' && this.filter().q) this.loadPopular();
      });
  }

  // Chọn API theo route và bộ lọc. Lỗi được xử lý tại đây để luồng đọc URL không bị dừng.
  private fetch(mode: Mode, slug: string, f: FilterState): Observable<IPage<IProduct> | null> {
    const fail = (err: ApiError) => {
      if (err.status === 404) {
        this.notFound.set(true);
        if (err.extra?.['ended']) this.ended.set({ collection: err.extra['collection'], openCollections: err.extra['openCollections'] || [] });
      } else {
        this.errMessage.set('Không tải được danh sách sản phẩm. Thử lại');
      }
      this.result.set(null);
      return of(null);
    };

    if (mode === 'collection') {
      return this.catalogApi.getCollection(slug, toApiQuery(f, PAGE_SIZE)).pipe(
        tap((res) => this.collection.set(res.collection)),
        map((res) => ({ items: res.items, page: res.page, pageSize: res.pageSize, total: res.total })),
        catchError(fail),
      );
    }

    // Chỉ lọc theo giá: dùng API-184 theo mẫu slide 6.7.2, sắp xếp và phân trang ở client (UC-DIS-04 nhánh 2c)
    const price = parsePrice(f.price);
    if (mode === 'all' && price && price.max !== null && isPriceOnly(f, false)) {
      return this.productApi.filterByPrice(price.min, price.max).pipe(
        map((items) => {
          const sorted = f.sort === 'gia-giam' ? [...items].reverse() : items;
          const start = (f.page - 1) * PAGE_SIZE;
          return { items: sorted.slice(start, start + PAGE_SIZE), page: f.page, pageSize: PAGE_SIZE, total: items.length };
        }),
        catchError(fail),
      );
    }

    if (mode === 'search' && !f.q) return of({ items: [], page: 1, pageSize: PAGE_SIZE, total: 0 });
    return this.productApi.getProducts(toApiQuery(f, PAGE_SIZE, mode === 'category' ? slug : undefined)).pipe(catchError(fail));
  }

  private loadPopular(): void {
    this.productApi.getProducts({ sort: 'pho-bien', pageSize: 8 }).subscribe({
      next: (res) => this.popular.set(res.items),
      error: () => this.popular.set([]),
    });
  }

  private updateTitle(): void {
    const name = this.missing() ? 'Không tìm thấy' : this.heading();
    this.title.setTitle(`${name} - Soulprint`);
  }

  // Ghi bộ lọc mới lên URL; đổi tiêu chí thì về trang 1
  apply(patch: Partial<FilterState>): void {
    const next = { ...this.filter(), ...patch };
    if (!('page' in patch)) next.page = 1;
    this.router.navigate([], { relativeTo: this.route, queryParams: toQueryParams(next) });
  }

  setChip(value: string | null): void {
    this.apply({ chip: this.filter().chip === value ? null : value });
  }

  // Chip "Dưới 300.000đ" bật/tắt ngân sách
  toggleUnder300k(): void {
    this.apply({ price: this.filter().price === UNDER_300K ? null : UNDER_300K });
  }

  setSort(value: string): void {
    this.apply({ sort: value || null });
  }

  setPage(page: number): void {
    this.apply({ page });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // "Xóa tất cả": chip và thanh lọc về mặc định, giữ từ khóa tìm kiếm
  clearAll(): void {
    this.router.navigate([], { relativeTo: this.route, queryParams: toQueryParams({ ...EMPTY_FILTER, q: this.filter().q }) });
  }

  search(keyword: string): void {
    this.apply({ q: keyword.trim() });
  }

  retry(): void {
    this.reload$.next(this.reload$.value + 1);
  }

  priceLabel(price: string): string {
    const p = parsePrice(price);
    if (!p) return price;
    const fmt = (n: number) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.') + 'đ';
    return p.max === null ? `Từ ${fmt(p.min)}` : `${fmt(p.min)} - ${fmt(p.max)}`;
  }
}
