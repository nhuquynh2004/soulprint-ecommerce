import { Component, DestroyRef, ElementRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder, FormControl, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, Subject, forkJoin, of, catchError } from 'rxjs';
import { AdminCatalogApiService } from '../../../services/admin-catalog-apiservice';
import { AdminStoreApiService } from '../../../services/admin-store-apiservice';
import { CatalogApiService } from '../../../services/catalog-apiservice';
import { AuthService } from '../../../services/auth';
import { ToastService } from '../../../services/toast';
import { ApiError } from '../../../classes/api-error';
import {
  IAdminCategory,
  IAdminProduct,
  IAdminTag,
  IFieldIssue,
  IOptionGroup,
  ITagGroup,
  IVariant,
  PRODUCT_STATUS_LABEL,
  ProductStatus,
} from '../../../classes/admin-catalog';
import { salePriceValidator } from '../../../shared/form-validators';
import { slugify, valueCode } from '../../../shared/vn-text';
import { HasUnsavedChanges } from '../../../guards/unsaved-changes-guard';
import { RowMenuItem } from '../shared/row-menu/row-menu';

// 8 vùng của form (UC-CAT-01 bước 3, thứ tự theo thiết kế). Vùng 0 là thẻ Phân loại/Trạng thái ở cột phải.
export const AREAS = [
  { no: 1, label: 'Thông tin cơ bản' },
  { no: 2, label: 'Giá và tồn kho' },
  { no: 3, label: 'Biến thể' },
  { no: 4, label: 'Hình ảnh' },
  { no: 5, label: 'Mô tả' },
  { no: 6, label: 'Thông số' },
  { no: 7, label: 'Cá nhân hóa' },
  { no: 8, label: 'Gợi ý và tags' },
];

type VariantForm = FormGroup<{
  key: FormControl<string>;
  name: FormControl<string>;
  attributes: FormControl<Record<string, string>>;
  sku: FormControl<string>;
  priceDelta: FormControl<number>;
  stock: FormControl<number>;
  lowStockThreshold: FormControl<number>;
  isActive: FormControl<boolean>;
  locked: FormControl<boolean>; // biến thể của giá trị đã ẩn (có đơn): chỉ đọc
}>;

const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const num = (v: any) => (v === null || v === undefined || v === '' ? null : Number(v));

// SCR-42 Form sản phẩm (UC-CAT-01): Reactive Form có FormArray biến thể và bảng size, validator chéo giá sale < giá bán.
// Vai trò Kho (không có SAN_PHAM.SUA) chỉ sửa tồn kho và ngưỡng (nhánh 1j); không có SAN_PHAM.SUA_GIA thì vùng giá chỉ đọc.
@Component({
  selector: 'app-product-form',
  standalone: false,
  templateUrl: './product-form.html',
  styleUrl: './product-form.scss',
})
export class ProductForm implements HasUnsavedChanges {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(AdminCatalogApiService);
  private readonly storeApi = inject(AdminStoreApiService);
  private readonly catalog = inject(CatalogApiService);
  protected readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);

  readonly areas = AREAS;
  readonly statusLabel = PRODUCT_STATUS_LABEL;
  readonly statusChoices: ProductStatus[] = ['DANG_HIEN_THI', 'BAN_NHAP', 'DA_AN'];

  // Quyền (BR-34, 07 Mục 1.1)
  readonly canContent = this.auth.can('SAN_PHAM.SUA') || this.auth.can('SAN_PHAM.TAO');
  readonly canPrice = this.auth.can('SAN_PHAM.SUA_GIA');
  readonly canStock = this.auth.can('SAN_PHAM.CAP_NHAT_TON');
  readonly stockOnly = !this.auth.can('SAN_PHAM.SUA') && this.canStock;

  readonly productId = signal<string | null>(null);
  readonly product = signal<IAdminProduct | null>(null);
  readonly loading = signal(true);
  readonly errMessage = signal('');
  readonly saving = signal(false);
  readonly issues = signal<IFieldIssue[]>([]);
  readonly warnings = signal<string[]>([]);

  readonly categories = signal<IAdminCategory[]>([]);
  readonly tagGroups = signal<ITagGroup[]>([]);
  readonly tags = signal<IAdminTag[]>([]);
  readonly depositRate = signal(0.5);
  readonly stickerFee = signal(5000);

  // Nhóm biến thể giữ ở signal (chip giá trị), biến thể là FormArray dựng lại theo tổ hợp (BR-39)
  readonly groups = signal<IOptionGroup[]>([]);
  readonly groupsDirty = signal(false);
  readonly collapsed = signal<Record<string, boolean>>({});
  readonly newValue = signal<Record<number, string>>({});
  readonly editingGroup = signal<number | null>(null);
  readonly editingValue = signal<{ g: number; value: string } | null>(null); // nhấp đúp sửa giá trị biến thể
  readonly skuTaken = signal(''); // SKU trùng sản phẩm khác
  // Gợi ý SKU theo BR-46: BST chọn tay có mã, BST đang chọn, mã gợi ý. Gợi ý chỉ tự điền khi ô SKU trống
  // hoặc đang là mã gợi ý trước đó, không ghi đè SKU nhân viên gõ tay.
  readonly skuCollections = signal<{ _id: string; name: string; code: string }[]>([]);
  readonly skuCollectionId = signal('');
  readonly skuSuggest = signal('');
  private lastSuggested = '';

  // Hộp thoại
  readonly leaveDialog = signal(false);
  private leave$ = new Subject<boolean>();
  readonly confirmDelete = signal(false);
  readonly confirmImgGroup = signal<number | null>(null);

  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(120)]],
    sku: ['', [Validators.pattern(/^[A-Za-z0-9-]{2,40}$/)]],
    brand: [''],
    slug: ['', [Validators.pattern(/^[a-z0-9]+(-[a-z0-9]+)*$/)]],
    pricing: this.fb.nonNullable.group(
      {
        price: new FormControl<number | null>(null, [Validators.min(1)]),
        salePrice: new FormControl<number | null>(null),
        costPrice: new FormControl<number | null>(null, [Validators.min(0)]),
        saleStartAt: [''],
        saleEndAt: [''],
      },
      { validators: salePriceValidator },
    ),
    lowStockThreshold: [5, [Validators.min(0)]],
    outOfStockBehavior: ['HIEN_TAM_HET' as 'HIEN_TAM_HET' | 'AN_KHI_HET'],
    images: this.fb.nonNullable.control<string[]>([]),
    shortDescription: ['', [Validators.maxLength(300)]],
    description: [''],
    specs: this.fb.nonNullable.group({ material: [''], size: [''], weight: [''], origin: [''], care: [''] }),
    warrantyMonths: [0],
    hasSizeChart: [false],
    sizeChart: this.fb.nonNullable.group({
      columns: this.fb.array<FormControl<string>>([]),
      rows: this.fb.array<FormArray<FormControl<string>>>([]),
      note: [''],
    }),
    personalization: this.fb.nonNullable.group({
      allowed: [false],
      inKhac: [false],
      thietKe: [false],
      mode: ['THUONG' as 'THUONG' | 'AO_DAU'],
      maxChars: [20, [Validators.min(1), Validators.max(30)]],
      topMaxChars: [20, [Validators.min(1), Validators.max(30)]],
      bottomMaxChars: [20, [Validators.min(1), Validators.max(30)]],
      numberMaxDigits: [3, [Validators.min(1), Validators.max(3)]],
    }),
    tagIds: this.fb.nonNullable.control<string[]>([]),
    ageMin: new FormControl<number | null>(null, [Validators.min(0), Validators.max(99)]),
    ageMax: new FormControl<number | null>(null, [Validators.min(0), Validators.max(99)]),
    aiEligible: [true],
    status: ['BAN_NHAP' as ProductStatus],
    categoryId: [''],
    axis: [''],
    isFeatured: [false],
    variants: this.fb.array<VariantForm>([]),
  });

  get variants(): FormArray<VariantForm> {
    return this.form.controls.variants;
  }
  get columns(): FormArray<FormControl<string>> {
    return this.form.controls.sizeChart.controls.columns;
  }
  get rows(): FormArray<FormArray<FormControl<string>>> {
    return this.form.controls.sizeChart.controls.rows;
  }

  readonly flatCategories = computed(() => this.categories().flatMap((c) => [c, ...(c.children || []).map((k) => ({ ...k, name: '— ' + k.name }))]));
  readonly listGroups = computed(() => this.tagGroups().filter((g) => g.kind === 'LIST'));
  readonly isPublished = computed(() => this.product()?.status === 'DANG_HIEN_THI');
  readonly issueAreas = computed(() => new Set(this.issues().map((i) => i.area)));

  constructor() {
    const id = this.route.snapshot.paramMap.get('id');
    this.productId.set(id && id !== 'moi' ? id : null);

    // Tên đổi thì gợi ý slug khi slug chưa sửa tay (sản phẩm mới)
    this.form.controls.name.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((name) => {
      if (!this.productId() && !this.form.controls.slug.dirty) this.form.controls.slug.setValue(slugify(name), { emitEvent: false });
    });

    // Trục, danh mục đổi thì hỏi lại SKU kế tiếp
    this.form.controls.axis.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.refreshSkuSuggest());
    this.form.controls.categoryId.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.refreshSkuSuggest());
    if (this.auth.can('BO_SUU_TAP.XEM')) {
      this.storeApi.getCollections({ type: 'THU_CONG' }).pipe(catchError(() => of({ items: [] }))).subscribe((d) =>
        this.skuCollections.set(d.items.filter((c) => !!c.code).map((c) => ({ _id: c._id!, name: c.name, code: c.code! }))),
      );
    }

    // Danh mục, tag chỉ để hiển thị lựa chọn: thiếu quyền xem (VD vai trò Kho không có TAGS.XEM) thì để trống, không chặn form
    forkJoin([
      this.api.getCategories().pipe(catchError(() => of([]))),
      this.auth.can('TAGS.XEM') ? this.api.getTagGroups().pipe(catchError(() => of([]))) : of([]),
      this.auth.can('TAGS.XEM') ? this.api.getTags().pipe(catchError(() => of([]))) : of([]),
      this.catalog.getPublicSettings().pipe(catchError(() => of(null))),
      this.productId() ? this.api.getProduct(this.productId()!) : of(null),
    ]).subscribe({
      next: ([cats, groups, tags, settings, product]) => {
        this.categories.set(cats);
        this.tagGroups.set(groups);
        this.tags.set(tags);
        if (settings) {
          this.depositRate.set(settings.depositRate);
          this.stickerFee.set(settings.stickerFee);
        }
        if (product) this.fill(product);
        else this.rebuildVariants();
        this.applyPermissions();
        this.loading.set(false);
      },
      error: (err: ApiError) => {
        this.errMessage.set(err.status === 404 ? 'Không tìm thấy sản phẩm' : err.message);
        this.loading.set(false);
      },
    });
  }

  // Đổ dữ liệu sản phẩm vào form (lần đầu, sau khi lưu, Hủy thay đổi)
  private fill(p: IAdminProduct): void {
    this.product.set(p);
    const pe = p.personalization || { allowed: false, types: [] };
    const en = pe.engrave || { mode: 'THUONG' };
    this.form.reset({
      name: p.name,
      sku: p.sku || '',
      brand: p.brand || '',
      slug: p.slug || '',
      pricing: {
        price: p.price,
        salePrice: p.salePrice,
        costPrice: p.costPrice ?? null,
        saleStartAt: toLocalInput(p.saleStartAt),
        saleEndAt: toLocalInput(p.saleEndAt),
      },
      lowStockThreshold: p.variants[0]?.lowStockThreshold ?? 5,
      outOfStockBehavior: p.outOfStockBehavior || 'HIEN_TAM_HET',
      images: p.images || [],
      shortDescription: p.shortDescription || '',
      description: p.description || '',
      specs: Object.assign({ material: '', size: '', weight: '', origin: '', care: '' }, p.specs || {}),
      warrantyMonths: p.warrantyMonths || 0,
      hasSizeChart: !!p.sizeChart,
      sizeChart: { note: p.sizeChart?.note || '' },
      personalization: {
        allowed: !!pe.allowed,
        inKhac: pe.types.includes('IN_KHAC'),
        thietKe: pe.types.includes('THIET_KE'),
        mode: en.mode || 'THUONG',
        maxChars: en.maxChars ?? 20,
        topMaxChars: en.topMaxChars ?? 20,
        bottomMaxChars: en.bottomMaxChars ?? 20,
        numberMaxDigits: en.numberMaxDigits ?? 3,
      },
      tagIds: p.tagIds || [],
      ageMin: p.ageMin,
      ageMax: p.ageMax,
      aiEligible: p.aiEligible !== false,
      status: p.status,
      categoryId: p.categoryId || '',
      axis: p.axis || '',
      isFeatured: !!p.isFeatured,
    });
    this.columns.clear();
    this.rows.clear();
    for (const c of p.sizeChart?.columns || []) this.columns.push(this.fb.nonNullable.control(c));
    for (const r of p.sizeChart?.rows || []) this.rows.push(this.fb.array(r.map((x) => this.fb.nonNullable.control(x))));
    this.groups.set(structuredClone(p.optionGroups || []));
    this.variants.clear();
    for (const v of p.variants) this.variants.push(this.variantGroup(v, false));
    this.rebuildVariants();
    this.form.markAsPristine();
    this.groupsDirty.set(false);
  }

  private variantGroup(v: Partial<IVariant>, locked: boolean): VariantForm {
    const attributes = v.attributes || {};
    return this.fb.nonNullable.group({
      key: [this.keyOf(attributes)],
      name: [v.name || 'Mặc định'],
      attributes: new FormControl<Record<string, string>>(attributes, { nonNullable: true }),
      sku: [v.sku || ''],
      priceDelta: [v.priceDelta ?? 0, [Validators.min(0)]],
      stock: [v.stock ?? 0, [Validators.required, Validators.min(0)]],
      lowStockThreshold: [v.lowStockThreshold ?? this.form.controls.lowStockThreshold.value ?? 5],
      isActive: [v.isActive !== false],
      locked: [locked],
    });
  }

  private keyOf(attributes: Record<string, string>): string {
    return this.groups().map((g) => attributes[g.name] ?? '').join('|');
  }

  // Dựng lại FormArray biến thể đủ tổ hợp giá trị không ẩn (BR-39); giữ SKU, chênh giá, tồn của tổ hợp đã có
  rebuildVariants(): void {
    const groups = this.groups();
    const old = new Map(this.variants.controls.map((c) => [this.keyOf(c.controls.attributes.value), c]));
    let combos: Record<string, string>[] = [{}];
    for (const g of groups) combos = combos.flatMap((a) => g.values.filter((v) => !v.isHidden).map((v) => ({ ...a, [g.name]: v.value })));
    const next: VariantForm[] = combos.map((attrs) => {
      const found = old.get(this.keyOf(attrs));
      if (found) {
        found.controls.name.setValue(groups.length ? groups.map((g) => attrs[g.name]).join(' / ') : 'Mặc định');
        return found;
      }
      return this.variantGroup({ attributes: attrs, name: groups.length ? groups.map((g) => attrs[g.name]).join(' / ') : 'Mặc định' }, false);
    });
    // Biến thể của giá trị đã ẩn (có đơn hàng) giữ lại ở trạng thái ngừng bán, chỉ đọc
    for (const [key, c] of old) {
      const attrs = c.controls.attributes.value;
      const hidden = groups.some((g) => g.values.find((v) => v.value === attrs[g.name])?.isHidden);
      if (hidden && !next.includes(c)) {
        c.controls.isActive.setValue(false);
        c.controls.locked.setValue(true);
        next.push(c);
      }
      void key;
    }
    this.variants.clear({ emitEvent: false });
    for (const c of next) this.variants.push(c, { emitEvent: false });
    this.applyPermissions();
  }

  // SKU biến thể dự kiến khi để trống (server tự sinh khi lưu)
  autoSku(attrs: Record<string, string>): string {
    const sku = this.form.controls.sku.value.trim().toUpperCase();
    if (!sku) return 'Tự sinh';
    const codes = this.groups().map((g) => g.values.find((v) => v.value === attrs[g.name])?.code || valueCode(attrs[g.name] || ''));
    return codes.length ? `${sku}-${codes.join('-')}` : sku;
  }

  // Khóa ô theo quyền: Kho chỉ sửa tồn và ngưỡng; thiếu Sửa giá thì vùng giá và chênh giá chỉ đọc
  private applyPermissions(): void {
    const opts = { emitEvent: false };
    if (this.stockOnly || !this.canContent) {
      for (const [k, c] of Object.entries(this.form.controls)) if (!['variants', 'lowStockThreshold'].includes(k)) c.disable(opts);
    }
    if (!this.canPrice) this.form.controls.pricing.disable(opts);
    for (const v of this.variants.controls) {
      if (this.stockOnly || !this.canContent) {
        v.controls.sku.disable(opts);
        v.controls.isActive.disable(opts);
      }
      if (!this.canPrice) v.controls.priceDelta.disable(opts);
      if (!this.canStock && !this.canContent) v.controls.stock.disable(opts);
      if (v.controls.locked.value) v.disable(opts);
    }
  }

  // ===== Nhóm biến thể =====

  private setGroups(groups: IOptionGroup[]): void {
    this.groups.set(groups);
    this.groupsDirty.set(true);
    this.rebuildVariants();
  }

  addGroup(): void {
    const n = this.groups().length;
    if (n >= 3) return;
    const name = ['Màu sắc', 'Size', 'Chất liệu'].find((x) => !this.groups().some((g) => g.name === x)) || `Nhóm ${n + 1}`;
    this.setGroups([...this.groups(), { name, hasImages: false, values: [] }]);
    this.editingGroup.set(n);
  }

  renameGroup(i: number, name: string): void {
    const clean = name.trim().slice(0, 30);
    this.editingGroup.set(null);
    if (!clean || this.groups().some((g, k) => k !== i && g.name.toLowerCase() === clean.toLowerCase())) return;
    const old = this.groups()[i].name;
    // Đổi khóa thuộc tính của biến thể theo tên nhóm mới để giữ tồn kho
    for (const v of this.variants.controls) {
      const a = { ...v.controls.attributes.value };
      if (old in a) {
        a[clean] = a[old];
        delete a[old];
        v.controls.attributes.setValue(a);
      }
    }
    this.setGroups(this.groups().map((g, k) => (k === i ? { ...g, name: clean } : g)));
  }

  removeGroup(i: number): void {
    this.setGroups(this.groups().filter((_, k) => k !== i));
  }

  setNewValue(i: number, v: string): void {
    this.newValue.set({ ...this.newValue(), [i]: v });
  }

  addValue(i: number): void {
    const value = (this.newValue()[i] || '').trim().slice(0, 30);
    this.newValue.set({ ...this.newValue(), [i]: '' });
    const g = this.groups()[i];
    if (!value || g.values.length >= 20 || g.values.some((v) => v.value.toLowerCase() === value.toLowerCase())) return;
    let code = valueCode(value);
    for (let n = 2; g.values.some((v) => v.code === code); n++) code = valueCode(value).slice(0, 9) + n;
    this.setGroups(this.groups().map((x, k) => (k === i ? { ...x, values: [...x.values, { value, code, ...(x.hasImages ? { images: [] } : {}) }] } : x)));
  }

  // Sửa trực tiếp giá trị: giữ mã giá trị nên SKU biến thể không đổi; đổi giá trị thuộc tính của biến thể để giữ tồn kho, chênh giá
  renameValue(i: number, old: string, raw: string): void {
    if (!this.editingValue()) return; // blur sau Enter
    this.editingValue.set(null);
    const value = raw.trim().slice(0, 30);
    const g = this.groups()[i];
    if (!value || value === old || g.values.some((v) => v.value !== old && v.value.toLowerCase() === value.toLowerCase())) {
      if (value && value !== old) this.toast.show(`Giá trị "${value}" đã có trong nhóm ${g.name}`, 'danger');
      return;
    }
    for (const v of this.variants.controls) {
      const a = { ...v.controls.attributes.value };
      if (a[g.name] === old) {
        a[g.name] = value;
        v.controls.attributes.setValue(a);
      }
    }
    this.setGroups(this.groups().map((x, k) => (k === i ? { ...x, values: x.values.map((v) => (v.value === old ? { ...v, value } : v)) } : x)));
  }

  // SKU trùng: hỏi API-65 khi rời ô để báo ngay dưới ô, không đợi bấm Lưu
  // SKU kế tiếp theo BR-46 (API-214). Chỉ gợi ý cho sản phẩm mới hoặc sản phẩm chưa có SKU (VD bản nhân bản).
  refreshSkuSuggest(): void {
    const { axis, categoryId } = this.form.getRawValue();
    const sku = this.form.controls.sku.value.trim().toUpperCase();
    if (!axis || !categoryId || (this.productId() && sku && sku !== this.lastSuggested)) {
      this.skuSuggest.set('');
      return;
    }
    this.api.nextSku({ axis, categoryId, ...(this.skuCollectionId() ? { collectionId: this.skuCollectionId() } : {}) }).subscribe({
      next: (r) => {
        this.skuSuggest.set(r.sku);
        const cur = this.form.controls.sku.value.trim().toUpperCase();
        if (!cur || cur === this.lastSuggested) this.useSuggestedSku(r.sku);
        this.lastSuggested = r.sku;
      },
      error: () => this.skuSuggest.set(''), // danh mục chưa có mã: không gợi ý, nhân viên tự nhập
    });
  }

  useSuggestedSku(sku = this.skuSuggest()): void {
    if (!sku || this.form.controls.sku.disabled) return;
    this.form.controls.sku.setValue(sku);
    this.form.controls.sku.markAsDirty();
    this.skuTaken.set('');
    this.lastSuggested = sku;
  }

  checkSku(): void {
    const sku = this.form.controls.sku.value.trim().toUpperCase();
    if (!sku || this.form.controls.sku.invalid) return;
    this.api.getProducts({ q: sku, page: 1 }).subscribe({
      next: (d) => {
        const other = d.items.find((p) => (p.sku || '').toUpperCase() === sku && p._id !== this.productId());
        if (other && this.form.controls.sku.value.trim().toUpperCase() === sku) this.skuTaken.set('Mã sản phẩm đã tồn tại. Vui lòng sử dụng mã khác.');
      },
      error: () => {},
    });
  }

  // Bỏ giá trị: sản phẩm đã có đơn thì server giữ lại ở dạng ẩn nếu giá trị đó đã bán (1l)
  removeValue(i: number, value: string): void {
    this.setGroups(this.groups().map((x, k) => (k === i ? { ...x, values: x.values.filter((v) => v.value !== value) } : x)));
  }

  // Công tắc "Gắn ảnh theo giá trị": chỉ 1 nhóm được bật; bật nhóm khác thì hỏi lại (1m)
  toggleImages(i: number): void {
    const g = this.groups()[i];
    const other = this.groups().findIndex((x, k) => k !== i && x.hasImages);
    if (!g.hasImages && other >= 0 && this.confirmImgGroup() !== i) {
      this.confirmImgGroup.set(i);
      return;
    }
    this.confirmImgGroup.set(null);
    this.setGroups(
      this.groups().map((x, k) =>
        k === i
          ? { ...x, hasImages: !x.hasImages, values: x.values.map((v) => ({ ...v, images: !x.hasImages ? v.images || [] : undefined })) }
          : { ...x, hasImages: false },
      ),
    );
  }

  setValueImages(i: number, value: string, images: string[]): void {
    this.setGroups(this.groups().map((x, k) => (k === i ? { ...x, values: x.values.map((v) => (v.value === value ? { ...v, images } : v)) } : x)));
  }

  imgGroup(): IOptionGroup | undefined {
    return this.groups().find((g) => g.hasImages);
  }

  // Biến thể gom theo giá trị của nhóm gắn ảnh (mở/thu gọn từng nhóm), không có nhóm gắn ảnh thì 1 nhóm chung
  variantSections(): { value: string | null; hasImage: boolean; rows: VariantForm[]; total: number }[] {
    const g = this.imgGroup();
    const all = this.variants.controls;
    if (!g) return [{ value: null, hasImage: true, rows: all, total: all.reduce((n, c) => n + Number(c.controls.stock.value || 0), 0) }];
    return g.values.map((v) => {
      const rows = all.filter((c) => c.controls.attributes.value[g.name] === v.value);
      return { value: v.value, hasImage: !!v.images?.length, rows, total: rows.reduce((n, c) => n + Number(c.controls.stock.value || 0), 0) };
    });
  }

  toggleSection(value: string): void {
    this.collapsed.set({ ...this.collapsed(), [value]: !this.collapsed()[value] });
  }

  variantSummary(): string {
    const n = this.variants.controls.filter((c) => !c.controls.locked.value).length;
    const parts = this.groups().map((g) => `${g.values.filter((v) => !v.isHidden).length} ${g.name.toLowerCase()}`);
    return parts.length > 1 ? `${n} biến thể = ${parts.join(' x ')}` : `${n} biến thể`;
  }

  totalStock(): number {
    return this.variants.controls.filter((c) => c.controls.isActive.value).reduce((n, c) => n + Number(c.controls.stock.value || 0), 0);
  }

  // ===== Bảng size =====

  addColumn(): void {
    if (this.columns.length >= 8) return;
    this.columns.push(this.fb.nonNullable.control(''));
    for (const r of this.rows.controls) r.push(this.fb.nonNullable.control(''));
    this.form.markAsDirty();
  }

  addRow(): void {
    if (this.rows.length >= 20) return;
    if (!this.columns.length) this.addColumn();
    this.rows.push(this.fb.array(this.columns.controls.map(() => this.fb.nonNullable.control(''))));
    this.form.markAsDirty();
  }

  removeColumn(i: number): void {
    this.columns.removeAt(i);
    for (const r of this.rows.controls) r.removeAt(i);
    this.form.markAsDirty();
  }

  removeRow(i: number): void {
    this.rows.removeAt(i);
    this.form.markAsDirty();
  }

  // ===== Tags =====

  tagsOf(code: string): IAdminTag[] {
    return this.tags().filter((t) => t.group === code);
  }

  hasTag(id: string): boolean {
    return this.form.controls.tagIds.value.includes(id);
  }

  toggleTag(id: string): void {
    const c = this.form.controls.tagIds;
    if (c.disabled) return;
    c.setValue(this.hasTag(id) ? c.value.filter((x) => x !== id) : [...c.value, id]);
    c.markAsDirty();
  }

  tagName(id: string): string {
    return this.tags().find((t) => t._id === id)?.name || '';
  }

  // ===== Thẻ cột phải =====

  effectivePrice(): number | null {
    const p = this.form.controls.pricing.getRawValue();
    return num(p.salePrice) ?? num(p.price);
  }

  discountPercent(): number {
    const p = this.form.controls.pricing.getRawValue();
    const price = num(p.price);
    const sale = num(p.salePrice);
    return price && sale && sale < price ? Math.round((1 - sale / price) * 100) : 0;
  }

  margin(): { profit: number; rate: number } | null {
    const price = this.effectivePrice();
    const cost = num(this.form.controls.pricing.getRawValue().costPrice);
    if (!price || cost === null) return null;
    return { profit: price - cost, rate: Math.round(((price - cost) / price) * 1000) / 10 };
  }

  // ===== Lưu =====

  // Dữ liệu gửi API-67/68. Kho chỉ gửi biến thể (tồn, ngưỡng); thiếu Sửa giá thì không gửi trường giá.
  private payload(status: ProductStatus): Partial<IAdminProduct> {
    const v = this.form.getRawValue();
    const threshold = Number(v.lowStockThreshold ?? 5);
    const variants: IVariant[] = this.variants.controls.map((c) => {
      const x = c.getRawValue();
      return {
        sku: x.sku.trim().toUpperCase() || null,
        name: x.name,
        attributes: x.attributes,
        priceDelta: Number(x.priceDelta) || 0,
        stock: Number(x.stock) || 0,
        lowStockThreshold: this.form.controls.lowStockThreshold.dirty ? threshold : Number(x.lowStockThreshold ?? threshold),
        isActive: x.isActive,
      };
    });
    if (this.stockOnly) return { variants };

    const types: ('IN_KHAC' | 'THIET_KE')[] = [];
    if (v.personalization.allowed && v.personalization.inKhac) types.push('IN_KHAC');
    if (v.personalization.allowed && v.personalization.thietKe) types.push('THIET_KE');
    const pe = v.personalization;
    const data: Partial<IAdminProduct> = {
      name: v.name.trim(),
      sku: v.sku.trim().toUpperCase() || null,
      brand: v.brand.trim(),
      slug: v.slug.trim() || null,
      status,
      categoryId: v.categoryId || null,
      axis: (v.axis || null) as IAdminProduct['axis'],
      isFeatured: v.isFeatured,
      outOfStockBehavior: v.outOfStockBehavior,
      images: v.images,
      shortDescription: v.shortDescription.trim(),
      description: v.description,
      specs: v.specs,
      warrantyMonths: Number(v.warrantyMonths),
      sizeChart: v.hasSizeChart && v.sizeChart.columns.some((c) => c.trim()) ? { columns: v.sizeChart.columns, rows: v.sizeChart.rows, note: v.sizeChart.note } : null,
      personalization: {
        allowed: pe.allowed,
        types,
        ...(types.includes('IN_KHAC')
          ? {
              engrave:
                pe.mode === 'AO_DAU'
                  ? { mode: 'AO_DAU' as const, topMaxChars: Number(pe.topMaxChars), bottomMaxChars: Number(pe.bottomMaxChars), numberMaxDigits: Number(pe.numberMaxDigits) }
                  : { mode: 'THUONG' as const, maxChars: Number(pe.maxChars) },
            }
          : {}),
      },
      tagIds: v.tagIds,
      ageMin: num(v.ageMin),
      ageMax: num(v.ageMax),
      aiEligible: v.aiEligible,
      optionGroups: this.groups(),
      variants,
    };
    if (this.canPrice) {
      Object.assign(data, {
        price: num(v.pricing.price),
        salePrice: num(v.pricing.salePrice),
        costPrice: num(v.pricing.costPrice),
        saleStartAt: v.pricing.saleStartAt ? new Date(v.pricing.saleStartAt).toISOString() : null,
        saleEndAt: v.pricing.saleEndAt ? new Date(v.pricing.saleEndAt).toISOString() : null,
      });
    }
    return data;
  }

  // mode: 'draft' (Lưu bản nháp), 'publish' (Xuất bản), 'save' (Lưu thay đổi / Lưu tồn kho, giữ trạng thái đang chọn)
  save(mode: 'draft' | 'publish' | 'save'): void {
    this.form.markAllAsTouched();
    if (this.form.controls.name.invalid && !this.stockOnly) {
      this.issues.set([{ field: 'name', message: 'Nhập tên sản phẩm (2-120 ký tự)', area: 1 }]);
      this.goArea(1);
      return;
    }
    const status: ProductStatus = mode === 'draft' ? 'BAN_NHAP' : mode === 'publish' ? 'DANG_HIEN_THI' : this.form.getRawValue().status;
    const data = this.payload(status);
    const id = this.productId();
    this.saving.set(true);
    this.issues.set([]);
    const req = id ? this.api.updateProduct({ ...data, _id: id }) : this.api.createProduct(data);
    req.subscribe({
      next: (r) => {
        this.saving.set(false);
        this.warnings.set(r.warnings);
        this.toast.show(mode === 'publish' ? 'Đã xuất bản sản phẩm' : this.stockOnly ? 'Đã lưu tồn kho' : 'Đã lưu sản phẩm');
        this.fill(r.product);
        if (!id) this.router.navigate(['/quan-tri/san-pham', r.product._id], { replaceUrl: true }).then(() => this.productId.set(r.product._id!));
      },
      error: (err: ApiError) => {
        this.saving.set(false);
        const missing = (err.extra['missing'] as IFieldIssue[]) || [];
        const skuIssue = missing.find((m) => m.field === 'sku' && err.status === 409);
        if (skuIssue) this.skuTaken.set(skuIssue.message);
        if (missing.length) {
          this.issues.set(missing);
          this.goArea(missing[0].area);
        } else this.toast.show(err.message, 'danger');
      },
    });
  }

  // Cuộn tới vùng và đặt con trỏ vào ô đầu tiên (7Ea)
  goArea(no: number): void {
    setTimeout(() => {
      const el = this.host.nativeElement.querySelector(`#area-${no}`) as HTMLElement | null;
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      (el?.querySelector('input:not([type=checkbox]):not(:disabled), select:not(:disabled), textarea:not(:disabled)') as HTMLElement | null)?.focus({ preventScroll: true });
    });
  }

  areaLabel(no: number): string {
    return no ? AREAS.find((a) => a.no === no)?.label || '' : 'Phân loại';
  }

  // ===== Menu "..." =====

  menuItems(): RowMenuItem[] {
    const p = this.product();
    if (!p) return [];
    const items: RowMenuItem[] = [];
    if (p.status === 'DANG_HIEN_THI' && p.slug) items.push({ key: 'preview', label: 'Xem trên cửa hàng', icon: 'eye' });
    if (this.auth.can('SAN_PHAM.TAO')) items.push({ key: 'duplicate', label: 'Nhân bản', icon: 'copy' });
    if (this.auth.can('SAN_PHAM.XOA') && p.status !== 'NGUNG_BAN') items.push({ key: 'archive', label: 'Lưu trữ', icon: 'archive' });
    if (this.hasUnsavedChanges()) items.push({ key: 'reset', label: 'Hủy thay đổi', icon: 'rotate' });
    if (this.auth.can('SAN_PHAM.XOA') && !p.hasOrders) items.push({ key: 'delete', label: 'Xóa', icon: 'trash', danger: true });
    return items;
  }

  onMenu(key: string): void {
    const p = this.product()!;
    if (key === 'preview') window.open('/san-pham/' + p.slug, '_blank');
    else if (key === 'reset') this.fill(p);
    else if (key === 'delete') this.confirmDelete.set(true);
    else if (key === 'duplicate') {
      this.api.duplicateProduct(p._id!).subscribe({
        next: (r) => {
          // Cùng route nên Angular dùng lại component: đổ bản sao vào form rồi đổi URL
          this.fill(r.product);
          this.productId.set(r.product._id!);
          this.issues.set([]);
          this.toast.show('Đã tạo bản sao (bản nháp, tồn 0, SKU để trống)');
          this.router.navigate(['/quan-tri/san-pham', r.product._id]);
        },
        error: (err: ApiError) => this.toast.show(err.message, 'danger'),
      });
    } else if (key === 'archive') {
      this.api.updateProduct({ _id: p._id!, status: 'NGUNG_BAN' }).subscribe({
        next: (r) => {
          this.toast.show('Đã lưu trữ sản phẩm');
          if (r.warnings.length) this.warnings.set(r.warnings);
          this.fill(r.product);
        },
        error: (err: ApiError) => this.toast.show(err.message, 'danger'),
      });
    }
  }

  doDelete(): void {
    this.confirmDelete.set(false);
    this.api.deleteProduct(this.productId()!).subscribe({
      next: () => {
        this.form.markAsPristine();
        this.groupsDirty.set(false);
        this.toast.show('Đã xóa sản phẩm');
        this.router.navigate(['/quan-tri/san-pham']);
      },
      error: (err: ApiError) => this.toast.show(err.message, 'danger'),
    });
  }

  // ===== Rời trang khi chưa lưu (3a, unsavedChangesGuard) =====

  hasUnsavedChanges(): boolean {
    return !this.loading() && !this.errMessage() && (this.form.dirty || this.groupsDirty());
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

  changeCount(): number {
    const groups = this.groupsDirty() ? 1 : 0;
    const controls = Object.values(this.form.controls).filter((c) => c.dirty).length;
    return groups + controls;
  }
}
