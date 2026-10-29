import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder, FormControl, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, Subject, catchError, debounceTime, forkJoin, of, switchMap } from 'rxjs';
import { AdminStoreApiService } from '../../../services/admin-store-apiservice';
import { AdminCatalogApiService } from '../../../services/admin-catalog-apiservice';
import { AuthService } from '../../../services/auth';
import { ToastService } from '../../../services/toast';
import { ApiError } from '../../../classes/api-error';
import { IProduct } from '../../../classes/product';
import {
  COLLECTION_STATUS_LABEL,
  IAdminCategory,
  IAdminCollection,
  IAdminProductRow,
  IAdminTag,
  ICollectionRule,
  IPickedProduct,
} from '../../../classes/admin-catalog';
import { slugify } from '../../../shared/vn-text';
import { dateRangeValidator, toLocalInput } from '../../../shared/form-validators';
import { HasUnsavedChanges } from '../../../guards/unsaved-changes-guard';
import { RowMenuItem } from '../shared/row-menu/row-menu';

type RuleForm = FormGroup<{ field: FormControl<ICollectionRule['field']>; operator: FormControl<ICollectionRule['operator']>; value: FormControl<any> }>;

export const RULE_FIELDS: { field: ICollectionRule['field']; label: string; ops: { op: ICollectionRule['operator']; label: string }[] }[] = [
  { field: 'CATEGORY', label: 'Danh mục', ops: [{ op: 'EQ', label: 'là' }, { op: 'NE', label: 'không phải' }] },
  { field: 'AXIS', label: 'Trục đam mê', ops: [{ op: 'EQ', label: 'bằng' }, { op: 'NE', label: 'khác' }] },
  { field: 'TAG', label: 'Tag', ops: [{ op: 'EQ', label: 'có' }, { op: 'NE', label: 'không có' }] },
  { field: 'PRICE', label: 'Giá', ops: [{ op: 'LT', label: 'nhỏ hơn' }, { op: 'GT', label: 'lớn hơn' }] },
  { field: 'CREATED_WITHIN_DAYS', label: 'Mới trong', ops: [{ op: 'EQ', label: 'số ngày' }] },
  { field: 'IN_STOCK', label: 'Tồn kho', ops: [{ op: 'EQ', label: 'là' }] },
  { field: 'ON_SALE', label: 'Đang giảm giá', ops: [{ op: 'EQ', label: 'là' }] },
];


// SCR-54 Form bộ sưu tập (UC-CAT-05 bước 2-5, 5Ea): Thông tin chung (ảnh bìa, tên, slug, mô tả), Sản phẩm chọn tay
// (tìm, thêm, kéo thả thứ tự) hoặc tự động theo điều kiện (khớp tất cả/bất kỳ, xem trước 12 sản phẩm - API-169),
// cột phải: Trạng thái, Thời gian hiển thị, Hiển thị trang chủ. Lưu nháp vẫn cho khi chưa có sản phẩm/điều kiện.
@Component({
  selector: 'app-collection-form',
  standalone: false,
  templateUrl: './collection-form.html',
  styleUrl: './collection-form.scss',
})
export class CollectionForm implements HasUnsavedChanges {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(AdminStoreApiService);
  private readonly catalogApi = inject(AdminCatalogApiService);
  protected readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly ruleFields = RULE_FIELDS;
  readonly statusLabel = COLLECTION_STATUS_LABEL;
  readonly id = signal<string | null>(null);
  readonly saved = signal<IAdminCollection | null>(null);
  readonly loading = signal(true);
  readonly errMessage = signal('');
  readonly saving = signal(false);
  readonly fieldErrors = signal<Record<string, string>>({});

  readonly categories = signal<IAdminCategory[]>([]);
  readonly tags = signal<IAdminTag[]>([]);
  readonly picked = signal<IPickedProduct[]>([]); // sản phẩm chọn tay, theo thứ tự hiển thị
  readonly view = signal<'grid' | 'list'>('grid');

  // Tìm sản phẩm để thêm (chọn tay)
  readonly search = signal('');
  readonly results = signal<IAdminProductRow[]>([]);
  private readonly search$ = new Subject<string>();
  private dragFrom: number | null = null;

  // Xem trước BST tự động
  readonly preview = signal<{ count: number; items: IProduct[] } | null>(null);
  readonly previewLoading = signal(false);
  private readonly preview$ = new Subject<void>();

  readonly leaveDialog = signal(false);
  private leave$ = new Subject<boolean>();
  readonly confirmDelete = signal(false);
  readonly pickedDirty = signal(false);

  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(120)]],
    slug: ['', [Validators.pattern(/^[a-z0-9]+(-[a-z0-9]+)*$/)]],
    code: ['', [Validators.pattern(/^([A-Z0-9]{2,6})?$/)]],
    description: ['', [Validators.maxLength(300)]],
    coverImage: [''],
    type: ['THU_CONG' as 'THU_CONG' | 'TU_DONG'],
    rules: this.fb.array<RuleForm>([]),
    matchMode: ['ALL' as 'ALL' | 'ANY'],
    sortBy: ['THU_CONG' as IAdminCollection['sortBy']],
    status: ['BAN_NHAP' as IAdminCollection['status']],
    time: this.fb.nonNullable.group({ startAt: [''], endAt: [''] }, { validators: dateRangeValidator }),
    showOnHome: [false],
  });

  get rules(): FormArray<RuleForm> {
    return this.form.controls.rules;
  }

  readonly isShown = computed(() => this.saved()?.status === 'HIEN_THI');
  readonly flatCategories = computed(() => this.categories().flatMap((c) => [c, ...(c.children || []).map((k) => ({ ...k, name: '— ' + k.name }))]));

  constructor() {
    const id = this.route.snapshot.paramMap.get('id');
    this.id.set(id && id !== 'moi' ? id : null);

    this.form.controls.name.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((n) => {
      if (!this.id() && !this.form.controls.slug.dirty) this.form.controls.slug.setValue(slugify(n), { emitEvent: false });
    });
    // Chọn tay thì sắp xếp mặc định "Thủ công"; tự động thì không có "Thủ công"
    this.form.controls.type.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((t) => {
      if (t === 'TU_DONG' && this.form.controls.sortBy.value === 'THU_CONG') this.form.controls.sortBy.setValue('BAN_CHAY');
      if (t === 'THU_CONG' && this.form.controls.sortBy.value === 'LIEN_QUAN') this.form.controls.sortBy.setValue('THU_CONG');
      if (t === 'TU_DONG') this.preview$.next();
    });
    this.form.controls.rules.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.preview$.next());
    this.form.controls.matchMode.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.preview$.next());
    this.form.controls.sortBy.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.form.controls.type.value === 'TU_DONG' && this.preview$.next());

    this.preview$
      .pipe(
        debounceTime(400),
        switchMap(() => {
          const rules = this.validRules();
          if (!rules.length) return of({ count: 0, items: [] });
          this.previewLoading.set(true);
          return this.api.previewRules({ rules, matchMode: this.form.controls.matchMode.value, sortBy: this.form.controls.sortBy.value }).pipe(catchError(() => of(null)));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((r) => {
        this.previewLoading.set(false);
        this.preview.set(r);
      });

    this.search$
      .pipe(
        debounceTime(300),
        switchMap((q) => (q.length >= 1 ? this.catalogApi.getProducts({ q, page: 1 }).pipe(catchError(() => of(null))) : of(null))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((d) => this.results.set(d ? d.items.filter((p) => !this.picked().some((x) => x._id === p._id)).slice(0, 8) : []));

    forkJoin([
      this.catalogApi.getCategories().pipe(catchError(() => of([]))),
      this.auth.can('TAGS.XEM') ? this.catalogApi.getTags().pipe(catchError(() => of([]))) : of([]),
      this.id() ? this.api.getCollection(this.id()!) : of(null),
    ]).subscribe({
      next: ([cats, tags, c]) => {
        this.categories.set(cats);
        this.tags.set(tags);
        if (c) this.fill(c);
        if (!this.canEdit()) this.form.disable();
        this.loading.set(false);
      },
      error: (err: ApiError) => {
        this.errMessage.set(err.status === 404 ? 'Không tìm thấy bộ sưu tập' : err.message);
        this.loading.set(false);
      },
    });
  }

  canEdit(): boolean {
    return this.id() ? this.auth.can('BO_SUU_TAP.SUA') : this.auth.can('BO_SUU_TAP.TAO');
  }

  // Mã BST luôn viết hoa, bỏ ký tự không hợp lệ ngay khi gõ
  upperCode(): void {
    const c = this.form.controls.code;
    const v = c.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (v !== c.value) c.setValue(v);
  }

  private fill(c: IAdminCollection): void {
    this.saved.set(c);
    this.form.reset({
      name: c.name,
      slug: c.slug,
      code: c.code || '',
      description: c.description || '',
      coverImage: c.coverImage || '',
      type: c.type,
      matchMode: c.matchMode || 'ALL',
      sortBy: c.sortBy,
      status: c.status,
      time: { startAt: toLocalInput(c.startAt), endAt: toLocalInput(c.endAt) },
      showOnHome: c.showOnHome,
    });
    this.rules.clear();
    for (const r of c.rules || []) this.rules.push(this.ruleGroup(r));
    this.picked.set(c.products || []);
    this.form.markAsPristine();
    this.pickedDirty.set(false);
    if (c.type === 'TU_DONG') this.preview$.next();
  }

  // ===== Điều kiện tự động =====

  private ruleGroup(r: Partial<ICollectionRule> = {}): RuleForm {
    const field = r.field || 'AXIS';
    const def = RULE_FIELDS.find((f) => f.field === field)!;
    return this.fb.nonNullable.group({
      field: [field as ICollectionRule['field']],
      operator: [(r.operator || def.ops[0].op) as ICollectionRule['operator']],
      value: [r.value ?? this.defaultValue(field)],
    });
  }

  private defaultValue(field: string): any {
    if (field === 'IN_STOCK' || field === 'ON_SALE') return true;
    if (field === 'AXIS') return 'THE_THAO';
    if (field === 'CREATED_WITHIN_DAYS') return 30;
    if (field === 'PRICE') return 500000;
    return '';
  }

  addRule(): void {
    this.rules.push(this.ruleGroup());
    this.rules.markAsDirty();
  }

  removeRule(i: number): void {
    this.rules.removeAt(i);
    this.rules.markAsDirty();
  }

  // Đổi trường điều kiện thì đặt lại phép so sánh và giá trị
  onFieldChange(r: RuleForm): void {
    const def = RULE_FIELDS.find((f) => f.field === r.controls.field.value)!;
    r.controls.operator.setValue(def.ops[0].op);
    r.controls.value.setValue(this.defaultValue(def.field));
  }

  opsOf(r: RuleForm) {
    return RULE_FIELDS.find((f) => f.field === r.controls.field.value)!.ops;
  }

  private validRules(): ICollectionRule[] {
    return this.rules.getRawValue().filter((r) => r.value !== '' && r.value !== null && r.value !== undefined);
  }

  // ===== Chọn tay =====

  onSearch(v: string): void {
    this.search.set(v);
    this.search$.next(v.trim());
  }

  addProduct(p: IAdminProductRow): void {
    this.picked.set([...this.picked(), { _id: p._id, name: p.name, sku: p.sku, image: p.image, price: p.price, salePrice: p.salePrice, status: p.status }]);
    this.results.set(this.results().filter((x) => x._id !== p._id));
    this.pickedDirty.set(true);
  }

  removeProduct(id: string): void {
    this.picked.set(this.picked().filter((p) => p._id !== id));
    this.pickedDirty.set(true);
  }

  onDragStart(i: number): void {
    this.dragFrom = i;
  }

  onDrop(i: number, e: DragEvent): void {
    e.preventDefault();
    if (this.dragFrom === null || this.dragFrom === i) return;
    const list = [...this.picked()];
    const [p] = list.splice(this.dragFrom, 1);
    list.splice(i, 0, p);
    this.dragFrom = null;
    this.picked.set(list);
    this.pickedDirty.set(true);
    if (this.form.controls.sortBy.value !== 'THU_CONG') this.form.controls.sortBy.setValue('THU_CONG');
  }

  imageOf(p: IPickedProduct): string | null {
    return p.image ?? p.images?.[0] ?? null;
  }

  // ===== Lưu =====

  save(mode: 'draft' | 'publish' | 'save'): void {
    this.form.markAllAsTouched();
    if (this.form.controls.name.invalid || this.form.controls.time.invalid || this.form.controls.code.invalid) return;
    const v = this.form.getRawValue();
    const status = mode === 'draft' ? 'BAN_NHAP' : mode === 'publish' ? 'HIEN_THI' : v.status;
    const data: Partial<IAdminCollection> = {
      name: v.name.trim(),
      slug: v.slug.trim(),
      code: v.type === 'THU_CONG' ? v.code || null : null,
      description: v.description.trim(),
      coverImage: v.coverImage || null,
      type: v.type,
      productIds: v.type === 'THU_CONG' ? this.picked().map((p) => p._id) : [],
      rules: v.type === 'TU_DONG' ? this.validRules() : [],
      matchMode: v.matchMode,
      sortBy: v.sortBy,
      startAt: v.time.startAt ? new Date(v.time.startAt).toISOString() : null,
      endAt: v.time.endAt ? new Date(v.time.endAt).toISOString() : null,
      status,
      showOnHome: v.showOnHome,
    };
    const id = this.id();
    this.saving.set(true);
    this.fieldErrors.set({});
    const req = id ? this.api.updateCollection({ ...data, _id: id }) : this.api.createCollection(data);
    req.subscribe({
      next: (c) => {
        this.saving.set(false);
        this.toast.show(mode === 'publish' ? 'Đã xuất bản bộ sưu tập' : 'Đã lưu bộ sưu tập');
        // API-110/111 không trả products: giữ danh sách đang chọn
        this.fill({ ...c, products: this.picked() });
        if (!id) {
          this.id.set(c._id!);
          this.router.navigate(['/quan-tri/bo-suu-tap', c._id], { replaceUrl: true });
        }
      },
      error: (err: ApiError) => {
        this.saving.set(false);
        this.fieldErrors.set((err.extra['fields'] as Record<string, string>) || {});
        this.toast.show(err.message, 'danger');
      },
    });
  }

  menuItems(): RowMenuItem[] {
    if (!this.id()) return [];
    const items: RowMenuItem[] = [];
    if (this.auth.can('BO_SUU_TAP.TAO')) items.push({ key: 'duplicate', label: 'Nhân bản', icon: 'copy' });
    if (this.hasUnsavedChanges()) items.push({ key: 'reset', label: 'Hủy thay đổi', icon: 'rotate' });
    if (this.auth.can('BO_SUU_TAP.XOA')) items.push({ key: 'delete', label: 'Xóa', icon: 'trash', danger: true });
    return items;
  }

  onMenu(key: string): void {
    if (key === 'reset') this.fill(this.saved()!);
    else if (key === 'delete') this.confirmDelete.set(true);
    else if (key === 'duplicate') {
      this.api.duplicateCollection(this.id()!).subscribe({
        next: (c) => {
          this.form.markAsPristine();
          this.pickedDirty.set(false);
          this.toast.show(`Đã tạo bản sao "${c.name}"`);
          this.id.set(c._id!);
          this.fill({ ...c, products: this.picked() });
          this.router.navigate(['/quan-tri/bo-suu-tap', c._id]);
        },
        error: (err: ApiError) => this.toast.show(err.message, 'danger'),
      });
    }
  }

  openPreview(): void {
    const s = this.saved();
    if (s?.displayStatus === 'DANG_HIEN') window.open('/bo-suu-tap/' + s.slug, '_blank');
    else this.toast.show('Bộ sưu tập chưa hiện trên website. Xuất bản rồi mở xem trước.', 'info');
  }

  doDelete(): void {
    this.confirmDelete.set(false);
    this.api.deleteCollection(this.id()!).subscribe({
      next: () => {
        this.form.markAsPristine();
        this.pickedDirty.set(false);
        this.toast.show('Đã xóa bộ sưu tập');
        this.router.navigate(['/quan-tri/bo-suu-tap']);
      },
      error: (err: ApiError) => this.toast.show(err.message, 'danger'),
    });
  }

  hasUnsavedChanges(): boolean {
    return !this.loading() && !this.errMessage() && (this.form.dirty || this.pickedDirty());
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
