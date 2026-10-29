import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormBuilder, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, Subject, catchError, debounceTime, of, switchMap } from 'rxjs';
import { AdminVoucherApiService } from '../../../services/admin-voucher-apiservice';
import { CatalogApiService } from '../../../services/catalog-apiservice';
import { ProductApiService } from '../../../services/product-apiservice';
import { AuthService } from '../../../services/auth';
import { ToastService } from '../../../services/toast';
import { ApiError } from '../../../classes/api-error';
import { IAdminVoucher, ICustomerBrief, VOUCHER_STATUS_LABEL, VoucherAudience, VoucherType } from '../../../classes/checkout';
import { HasUnsavedChanges } from '../../../guards/unsaved-changes-guard';

type Picked = { _id: string; name: string; sub?: string };

// Cross-field (UC-CAT-02 5Ec-5Ee): ngày kết thúc sau ngày bắt đầu; lượt mỗi khách ≤ tổng lượt;
// voucher số tiền cố định không lớn hơn giá trị đơn tối thiểu. Lỗi gắn vào ô bị sai để hiện ngay dưới ô.
const voucherRules: ValidatorFn = (g: AbstractControl): ValidationErrors | null => {
  const v = g.getRawValue();
  const errors: ValidationErrors = {};
  const mark = (name: string, key: string, msg: string | null) => {
    const c = g.get(name)!;
    const e = { ...(c.errors || {}) };
    if (msg) e[key] = msg;
    else delete e[key];
    c.setErrors(Object.keys(e).length ? e : null);
    if (msg) errors[key] = true;
  };
  mark('endAt', 'range', v.startAt && v.endAt && new Date(v.endAt) <= new Date(v.startAt) ? 'Thời gian hiệu lực không hợp lệ' : null);
  mark('perUserLimit', 'limit', v.perUserLimit && v.totalQuantity && +v.perUserLimit > +v.totalQuantity ? 'Không lớn hơn tổng số lượt' : null);
  mark('value', 'fixed', v.type === 'FIXED' && v.minOrderValue > 0 && +v.value > +v.minOrderValue ? 'Số tiền giảm không được lớn hơn giá trị đơn tối thiểu' : null);
  mark('value', 'percent', v.type === 'PERCENT' && v.value !== null && v.value !== '' && (+v.value < 1 || +v.value > 100) ? 'Phần trăm giảm từ 1 đến 100' : null);
  return Object.keys(errors).length ? errors : null;
};

// datetime-local cần "yyyy-MM-ddTHH:mm" theo giờ máy
const toLocal = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

// SCR-46 Form voucher 8 vùng + thống kê (UC-CAT-02 bước 3-5, nhánh 1a-1e): mục lục 8 vùng có dấu lỗi,
// Reactive Form nhóm trường động theo loại ưu đãi, đối tượng Danh sách chọn có ô tìm khách (API-98) và tải tệp SĐT/email
// (đọc bằng FileReader rồi gửi API-190), voucher đang hoạt động chỉ sửa mô tả, ngày kết thúc, tổng lượt.
@Component({
  selector: 'app-voucher-form',
  standalone: false,
  templateUrl: './voucher-form.html',
  styleUrl: './voucher-form.scss',
})
export class VoucherForm implements HasUnsavedChanges {
  private readonly api = inject(AdminVoucherApiService);
  private readonly catalog = inject(CatalogApiService);
  private readonly productApi = inject(ProductApiService);
  protected readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  readonly statusLabel = VOUCHER_STATUS_LABEL;
  readonly id = signal<string | null>(this.route.snapshot.paramMap.get('id'));
  readonly saved = signal<IAdminVoucher | null>(null);
  readonly loading = signal(true);
  readonly errMessage = signal('');
  readonly saving = signal(false);
  readonly fieldErrors = signal<Record<string, string>>({});
  readonly leaveDialog = signal(false);
  private leave$ = new Subject<boolean>();

  readonly form = this.fb.group(
    {
      code: ['', [Validators.required, Validators.pattern(/^[A-Z0-9]{4,16}$/)]],
      name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(120)]],
      description: ['', Validators.maxLength(300)],
      type: ['PERCENT' as VoucherType],
      value: [null as number | null, [Validators.required, Validators.min(1)]],
      maxDiscount: [null as number | null, Validators.min(1)],
      minOrderValue: [0, Validators.min(0)],
      minItems: [1, Validators.min(0)],
      scopeKind: ['ALL' as 'ALL' | 'CATEGORY' | 'PRODUCT'],
      audience: ['PUBLIC' as VoucherAudience],
      totalQuantity: [null as number | null, Validators.min(1)],
      perUserLimit: [1 as number | null, Validators.min(1)],
      maxBudget: [null as number | null, Validators.min(1)],
      startAt: [''],
      endAt: [''],
      validDays: [null as number | null, [Validators.min(1), Validators.max(365)]],
      showInWallet: [true],
      autoOnSignup: [false],
    },
    { validators: voucherRules },
  );

  // Phạm vi, loại trừ, khách chọn: danh sách chọn ngoài form (đánh dấu đã sửa bằng listDirty)
  readonly categories = signal<{ _id: string; name: string }[]>([]);
  readonly scopeItems = signal<Picked[]>([]);
  readonly excluded = signal<Picked[]>([]);
  readonly selectedUsers = signal<ICustomerBrief[]>([]);
  readonly listDirty = signal(false);
  readonly productQ = signal('');
  readonly productTarget = signal<'scope' | 'exclude'>('scope');
  readonly productResults = signal<Picked[]>([]);
  private readonly productSearch$ = new Subject<string>();
  readonly customerResults = signal<ICustomerBrief[]>([]);
  private readonly customerSearch$ = new Subject<string>();
  readonly upload = signal<{ file: string; matched: number; unmatched: string[] } | null>(null);
  readonly uploading = signal(false);

  readonly regions = [
    { n: 1, id: 'vf-1', label: 'Thông tin chung', fields: ['code', 'name', 'description'] },
    { n: 2, id: 'vf-2', label: 'Loại ưu đãi', fields: ['type', 'value', 'maxDiscount'] },
    { n: 3, id: 'vf-3', label: 'Điều kiện áp dụng', fields: ['minOrderValue', 'minItems', 'scope'] },
    { n: 4, id: 'vf-4', label: 'Đối tượng', fields: ['audience'] },
    { n: 5, id: 'vf-5', label: 'Giới hạn sử dụng', fields: ['totalQuantity', 'perUserLimit', 'maxBudget'] },
    { n: 6, id: 'vf-6', label: 'Thời gian', fields: ['startAt', 'endAt', 'validDays'] },
    { n: 7, id: 'vf-7', label: 'Hiển thị', fields: ['showInWallet', 'autoOnSignup'] },
    { n: 8, id: 'vf-8', label: 'Kết hợp ưu đãi', fields: [] },
  ];
  readonly submitted = signal(false);
  readonly formTick = signal(0); // tăng mỗi khi form đổi để computed đọc lại trạng thái lỗi

  readonly live = computed(() => {
    const s = this.saved();
    return !!s && s.fullyEditable === false;
  });
  readonly isDraft = computed(() => !this.saved() || this.saved()!.status === 'BAN_NHAP');

  // Đường biểu đồ lượt dùng 14 ngày (SVG, không thư viện)
  readonly sparkline = computed(() => {
    const d = this.saved()?.stats?.daily || [];
    if (!d.length) return '';
    const max = Math.max(1, ...d.map((x) => x.count));
    return d.map((x, i) => `${(i / (d.length - 1)) * 240},${56 - (x.count / max) * 50}`).join(' ');
  });

  constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.formTick.update((n) => n + 1);
      this.syncType();
    });
    // Mã chữ in hoa, không dấu
    this.form.controls.code.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((v) => {
      const clean = (v || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/Đ/g, 'D').replace(/[^A-Z0-9]/g, '').slice(0, 16);
      if (clean !== v) this.form.controls.code.setValue(clean, { emitEvent: false });
    });
    this.productSearch$
      .pipe(
        debounceTime(300),
        switchMap((q) => (q.length >= 1 ? this.productApi.getProducts({ q, pageSize: 8 }).pipe(catchError(() => of(null))) : of(null))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((d) => {
        const taken = new Set([...this.scopeItems(), ...this.excluded()].map((x) => x._id));
        this.productResults.set(d ? d.items.filter((p) => !taken.has(p._id)).map((p) => ({ _id: p._id, name: p.name, sub: '' })) : []);
      });
    this.customerSearch$
      .pipe(
        debounceTime(300),
        switchMap((q) => (q.length >= 2 ? this.api.searchCustomers(q).pipe(catchError(() => of([]))) : of([]))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((list) => this.customerResults.set(list.filter((u) => !this.selectedUsers().some((x) => x._id === u._id))));

    this.catalog.getCategories().subscribe({ next: (list) => this.categories.set(list.map((c) => ({ _id: c._id, name: c.name }))), error: () => {} });
    const id = this.id();
    if (!id) {
      // UC-CAT-01 1f -> UC-CAT-02 1h: mở sẵn phạm vi Sản phẩm với các sản phẩm đã chọn (?products=id1,id2)
      const preset = this.route.snapshot.queryParamMap.get('products');
      if (preset) {
        this.form.patchValue({ scopeKind: 'PRODUCT' });
        this.scopeItems.set(preset.split(',').map((x) => ({ _id: x, name: 'Sản phẩm ' + x.slice(-6) })));
      }
      if (!this.auth.can('VOUCHER.TAO')) this.form.disable();
      this.loading.set(false);
      this.syncType();
      return;
    }
    this.api.getVoucher(id).subscribe({
      next: (v) => {
        this.fill(v);
        this.loading.set(false);
      },
      error: (err: ApiError) => {
        this.errMessage.set(err.status === 404 ? 'Không tìm thấy voucher' : err.message);
        this.loading.set(false);
      },
    });
  }

  canEdit(): boolean {
    const s = this.saved();
    if (s?.status === 'LUU_TRU') return false;
    return this.id() ? this.auth.can('VOUCHER.SUA') : this.auth.can('VOUCHER.TAO');
  }

  private fill(v: IAdminVoucher): void {
    this.saved.set(v);
    this.form.reset(
      {
        code: v.code, name: v.name, description: v.description || '', type: v.type, value: v.value, maxDiscount: v.maxDiscount,
        minOrderValue: v.minOrderValue || 0, minItems: v.minItems ?? 1, scopeKind: v.scope?.kind || 'ALL', audience: v.audience,
        totalQuantity: v.totalQuantity, perUserLimit: v.perUserLimit, maxBudget: v.maxBudget, startAt: toLocal(v.startAt),
        endAt: toLocal(v.endAt), validDays: v.validDays, showInWallet: v.showInWallet !== false, autoOnSignup: !!v.autoOnSignup,
      },
      { emitEvent: false },
    );
    const pick = (x: { _id: string; name: string; sku?: string }) => ({ _id: x._id, name: x.name, sub: x.sku });
    this.scopeItems.set((v.scopeItems || []).map(pick));
    this.excluded.set((v.excludedProducts || []).map(pick));
    this.selectedUsers.set(v.selectedUsers || []);
    this.listDirty.set(false);
    this.syncType();
    // 1b: voucher đang hoạt động chỉ sửa mô tả, ngày kết thúc, số lượng phát hành
    if (!this.canEdit()) this.form.disable({ emitEvent: false });
    else if (this.live()) {
      this.form.disable({ emitEvent: false });
      for (const k of ['description', 'endAt', 'totalQuantity'] as const) this.form.controls[k].enable({ emitEvent: false });
    }
  }

  // Nhóm trường động theo loại ưu đãi: "Giảm tối đa" chỉ với %; tặng khi đăng ký chỉ với đối tượng thành viên
  private syncType(): void {
    const c = this.form.controls;
    if (this.live() || !this.canEdit()) return;
    const percent = c.type.value === 'PERCENT';
    if (percent && c.maxDiscount.disabled) c.maxDiscount.enable({ emitEvent: false });
    if (!percent && c.maxDiscount.enabled) {
      c.maxDiscount.setValue(null, { emitEvent: false });
      c.maxDiscount.disable({ emitEvent: false });
    }
    const members = ['ALL_MEMBERS', 'NEW_MEMBERS'].includes(c.audience.value || '');
    if (members && c.autoOnSignup.disabled) c.autoOnSignup.enable({ emitEvent: false });
    if (!members && c.autoOnSignup.enabled) {
      c.autoOnSignup.setValue(false, { emitEvent: false });
      c.autoOnSignup.disable({ emitEvent: false });
    }
  }

  err(name: string): string {
    this.formTick();
    const server = this.fieldErrors()[name];
    if (server) return server;
    const c = this.form.get(name);
    if (!c || !c.errors || !(c.touched || c.dirty || this.submitted())) return '';
    const e = c.errors;
    if (e['range'] || e['limit'] || e['fixed'] || e['percent']) return e['range'] || e['limit'] || e['fixed'] || e['percent'];
    if (e['required']) return name === 'code' ? 'Nhập mã voucher' : name === 'value' ? 'Nhập mức giảm' : 'Vui lòng nhập thông tin này';
    if (e['pattern']) return 'Mã chỉ gồm chữ in hoa không dấu và số, 4-16 ký tự';
    if (e['min']) return name === 'minOrderValue' || name === 'minItems' ? 'Không được âm' : 'Phải lớn hơn 0';
    if (e['max']) return 'Hạn dùng sau khi nhận từ 1 đến 365 ngày';
    if (e['minlength']) return 'Cần ít nhất 2 ký tự';
    return 'Giá trị không hợp lệ';
  }

  // Lỗi riêng của phạm vi, đối tượng (danh sách chọn)
  listError(kind: 'scope' | 'audience'): string {
    this.formTick();
    if (this.fieldErrors()[kind]) return this.fieldErrors()[kind];
    if (!this.submitted()) return '';
    const v = this.form.getRawValue();
    if (kind === 'scope' && v.scopeKind !== 'ALL' && !this.scopeItems().length) return v.scopeKind === 'CATEGORY' ? 'Chọn danh mục áp dụng' : 'Chọn sản phẩm áp dụng';
    if (kind === 'audience' && v.audience === 'SELECTED' && !this.selectedUsers().length) return 'Chọn khách hàng nhận voucher';
    return '';
  }

  regionHasError(fields: string[]): boolean {
    return fields.some((f) => (f === 'scope' ? !!this.listError('scope') : f === 'audience' ? !!this.listError('audience') : !!this.err(f)));
  }

  goto(id: string): void {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ===== Phạm vi =====

  setScopeKind(kind: 'ALL' | 'CATEGORY' | 'PRODUCT'): void {
    if (this.form.controls.scopeKind.value === kind) return;
    this.form.controls.scopeKind.setValue(kind);
    this.form.controls.scopeKind.markAsDirty();
    this.scopeItems.set([]);
  }

  toggleCategory(c: { _id: string; name: string }): void {
    const has = this.scopeItems().some((x) => x._id === c._id);
    this.scopeItems.set(has ? this.scopeItems().filter((x) => x._id !== c._id) : [...this.scopeItems(), c]);
    this.listDirty.set(true);
  }

  hasCategory(id: string): boolean {
    return this.scopeItems().some((x) => x._id === id);
  }

  searchProduct(target: 'scope' | 'exclude', q: string): void {
    this.productTarget.set(target);
    this.productQ.set(q);
    this.productSearch$.next(q.trim());
  }

  addProduct(p: Picked): void {
    if (this.productTarget() === 'scope') this.scopeItems.set([...this.scopeItems(), p]);
    else this.excluded.set([...this.excluded(), p]);
    this.productResults.set([]);
    this.productQ.set('');
    this.listDirty.set(true);
  }

  removePicked(list: 'scope' | 'exclude', id: string): void {
    const sig = list === 'scope' ? this.scopeItems : this.excluded;
    sig.set(sig().filter((x) => x._id !== id));
    this.listDirty.set(true);
  }

  // ===== Đối tượng: Danh sách chọn =====

  searchCustomer(q: string): void {
    this.customerSearch$.next(q.trim());
  }

  addCustomer(u: ICustomerBrief): void {
    this.selectedUsers.set([...this.selectedUsers(), u]);
    this.customerResults.set([]);
    this.listDirty.set(true);
  }

  removeCustomer(id: string): void {
    this.selectedUsers.set(this.selectedUsers().filter((u) => u._id !== id));
    this.listDirty.set(true);
  }

  // Tải lên tệp .csv/.txt, mỗi dòng 1 SĐT hoặc email (5Eh): đọc ở client bằng FileReader, gửi danh sách cho API-190
  onFile(input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!/\.(csv|txt)$/i.test(file.name) || file.size > 200 * 1024) {
      this.toast.show('Tệp không hợp lệ, cần .csv hoặc .txt, tối đa 1.000 dòng', 'danger');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const contacts = String(reader.result || '')
        .split(/[\r\n,;]+/)
        .map((s) => s.replace(/^"|"$/g, '').trim())
        .filter((s) => s && !/^(sđt|sdt|email|phone)$/i.test(s));
      if (!contacts.length || contacts.length > 1000) {
        this.toast.show('Tệp không hợp lệ, cần .csv hoặc .txt, tối đa 1.000 dòng', 'danger');
        return;
      }
      this.uploading.set(true);
      this.api.matchCustomers(contacts).subscribe({
        next: (r) => {
          this.uploading.set(false);
          const have = new Set(this.selectedUsers().map((u) => u._id));
          this.selectedUsers.set([...this.selectedUsers(), ...r.matched.filter((u) => !have.has(u._id))]);
          this.upload.set({ file: file.name, matched: r.matched.length, unmatched: r.unmatched });
          this.listDirty.set(true);
        },
        error: (err: ApiError) => {
          this.uploading.set(false);
          this.toast.show(err.message, 'danger');
        },
      });
    };
    reader.readAsText(file, 'utf-8');
  }

  // ===== Lưu =====

  private body(): Partial<IAdminVoucher> {
    const v = this.form.getRawValue();
    const num = (x: any) => (x === null || x === '' || x === undefined ? null : Number(x));
    return {
      code: v.code || '',
      name: (v.name || '').trim(),
      description: (v.description || '').trim(),
      type: v.type as VoucherType,
      value: num(v.value),
      maxDiscount: v.type === 'PERCENT' ? num(v.maxDiscount) : null,
      minOrderValue: num(v.minOrderValue) || 0,
      minItems: num(v.minItems) || 0,
      scope: { kind: v.scopeKind as any, ids: this.scopeItems().map((x) => x._id), excludeProductIds: this.excluded().map((x) => x._id) },
      audience: v.audience as VoucherAudience,
      selectedUserIds: v.audience === 'SELECTED' ? this.selectedUsers().map((u) => u._id) : [],
      totalQuantity: num(v.totalQuantity),
      perUserLimit: num(v.perUserLimit),
      maxBudget: num(v.maxBudget),
      startAt: v.startAt ? new Date(v.startAt).toISOString() : null,
      endAt: v.endAt ? new Date(v.endAt).toISOString() : null,
      validDays: num(v.validDays),
      showInWallet: !!v.showInWallet,
      autoOnSignup: !!v.autoOnSignup,
    };
  }

  // mode: 'draft' Lưu bản nháp, 'publish' Tạo voucher (bản nháp -> hoạt động), 'save' Lưu thay đổi
  save(mode: 'draft' | 'publish' | 'save'): void {
    this.submitted.set(true);
    this.fieldErrors.set({});
    this.formTick.update((n) => n + 1);
    const needTime = mode !== 'draft';
    const v = this.form.getRawValue();
    const extra: Record<string, string> = {};
    if (needTime && !this.live() && !v.startAt) extra['startAt'] = 'Chọn thời gian bắt đầu';
    if (needTime && !v.endAt) extra['endAt'] = 'Chọn thời gian kết thúc';
    const invalid = this.form.invalid || !!this.listError('scope') || !!this.listError('audience') || Object.keys(extra).length;
    if (invalid && !(mode === 'draft' && this.form.controls.code.valid && this.form.controls.name.valid)) {
      this.fieldErrors.set(extra);
      this.form.markAllAsTouched();
      this.toast.show('Vui lòng kiểm tra các vùng có dấu lỗi', 'danger');
      setTimeout(() => document.querySelector('.is-invalid, .sp-vf__err')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      return;
    }
    const id = this.id();
    const data = this.live() ? { description: this.body().description, endAt: this.body().endAt, totalQuantity: this.body().totalQuantity } : this.body();
    const request: Observable<IAdminVoucher & { distributed?: number }> = id
      ? this.api.updateVoucher({ ...data, _id: id, ...(mode === 'publish' ? { status: 'HOAT_DONG' as const } : {}) })
      : this.api.createVoucher({ ...data, status: mode === 'draft' ? 'BAN_NHAP' : 'HOAT_DONG' });
    this.saving.set(true);
    request.subscribe({
      next: (r) => {
        this.saving.set(false);
        this.form.markAsPristine();
        this.listDirty.set(false);
        const sent = r.distributed ? `, đã phát cho ${r.distributed} khách` : '';
        this.toast.show((mode === 'draft' ? 'Đã lưu bản nháp ' : id && mode === 'save' ? 'Đã lưu ' : 'Đã tạo voucher ') + r.code + sent);
        if (!id) this.router.navigate(['/quan-tri/voucher', r._id], { replaceUrl: true });
        else this.reloadVoucher();
      },
      error: (err: ApiError) => {
        this.saving.set(false);
        const fields = (err.extra['fields'] || {}) as Record<string, string>;
        this.fieldErrors.set(fields);
        this.toast.show(err.message, 'danger');
      },
    });
  }

  private reloadVoucher(): void {
    this.api.getVoucher(this.id()!).subscribe({ next: (v) => this.fill(v), error: () => {} });
  }

  // Tạm ngừng / Bật lại (1c)
  togglePause(): void {
    const s = this.saved()!;
    const to = s.status === 'TAM_NGUNG' ? 'HOAT_DONG' : 'TAM_NGUNG';
    this.api.updateVoucher({ _id: s._id!, status: to }).subscribe({
      next: () => {
        this.toast.show(to === 'TAM_NGUNG' ? `Đã tạm ngừng ${s.code}` : `Đã bật lại ${s.code}`);
        this.reloadVoucher();
      },
      error: (err: ApiError) => this.toast.show(err.message, 'danger'),
    });
  }

  duplicate(): void {
    this.api.duplicateVoucher(this.id()!).subscribe({
      next: (copy) => {
        this.toast.show(`Đã tạo bản nháp ${copy.code}, hãy đặt lại mã và thời gian`);
        this.router.navigate(['/quan-tri/voucher', copy._id]).then(() => {
          this.id.set(copy._id!);
          this.reloadVoucher();
        });
      },
      error: (err: ApiError) => this.toast.show(err.message, 'danger'),
    });
  }

  hasUnsavedChanges(): boolean {
    return !this.loading() && !this.errMessage() && (this.form.dirty || this.listDirty());
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
