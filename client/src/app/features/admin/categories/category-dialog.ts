import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { AdminCatalogApiService } from '../../../services/admin-catalog-apiservice';
import { ApiError } from '../../../classes/api-error';
import { IAdminCategory } from '../../../classes/admin-catalog';
import { slugify } from '../../../shared/vn-text';

// Hộp thoại thêm/sửa danh mục (UC-CAT-01 nhánh 1e): tên, mã danh mục dùng trong SKU (BR-46), đường dẫn tự sinh,
// mô tả, ảnh/minh họa, danh mục cha, hiện/ẩn.
// Tối đa 2 cấp: chỉ chọn danh mục cấp 1 làm cha; danh mục đang có con thì không chọn cha được.
@Component({
  selector: 'app-category-dialog',
  standalone: false,
  template: `
    <app-dialog [title]="category ? 'Sửa danh mục' : 'Thêm danh mục'" size="md" (closed)="done.emit('')">
      <form [formGroup]="form" (ngSubmit)="save()" id="cat-form" novalidate>
        @if (error()) {
          <div class="sp-alert sp-alert--danger" role="alert"><app-icon name="alert-circle" [size]="20" /><p>{{ error() }}</p></div>
        }
        <div class="mb-3">
          <label class="form-label" for="c-name">Tên danh mục <span class="text-danger">*</span></label>
          <input id="c-name" class="form-control" formControlName="name" maxlength="60" [class.is-invalid]="form.controls.name.touched && form.controls.name.invalid" />
          <div class="invalid-feedback">Tên danh mục cần 2-60 ký tự</div>
        </div>
        <div class="mb-3">
          <label class="form-label" for="c-code">Mã danh mục <span class="text-danger">*</span></label>
          <input id="c-code" class="form-control text-uppercase" formControlName="code" maxlength="6" placeholder="VD TBN" (input)="upperCode()" [class.is-invalid]="(form.controls.code.touched && form.controls.code.invalid) || !!fieldError()['code']" />
          @if (fieldError()['code']) {
            <div class="invalid-feedback d-block">{{ fieldError()['code'] }}</div>
          } @else {
            <div class="invalid-feedback">Mã cần 2-6 ký tự A-Z, 0-9</div>
            <small class="text-body-secondary">Dùng trong SKU sản phẩm, VD TT-<strong>TBN</strong>-001. Đổi mã không đổi SKU đã có.</small>
          }
        </div>
        <div class="mb-3">
          <label class="form-label" for="c-slug">Đường dẫn</label>
          <div class="input-group">
            <span class="input-group-text">/danh-muc/</span>
            <input id="c-slug" class="form-control" formControlName="slug" maxlength="80" [class.is-invalid]="form.controls.slug.invalid || !!fieldError()['slug']" />
          </div>
          @if (fieldError()['slug']) {
            <div class="invalid-feedback d-block">{{ fieldError()['slug'] }}</div>
          } @else if (form.controls.slug.invalid) {
            <div class="invalid-feedback d-block">Chỉ gồm chữ thường không dấu, số và dấu gạch</div>
          }
        </div>
        <div class="mb-3">
          <label class="form-label" for="c-desc">Mô tả</label>
          <input id="c-desc" class="form-control" formControlName="description" maxlength="300" />
        </div>
        <div class="mb-3">
          <label class="form-label" for="c-parent">Danh mục cha</label>
          <select id="c-parent" class="form-select" formControlName="parentId">
            <option value="">Không có (danh mục cấp 1)</option>
            @for (p of parents(); track p._id) {
              <option [value]="p._id">{{ p.name }}</option>
            }
          </select>
          @if (hasChildren()) {
            <small class="text-body-secondary">Danh mục đang có danh mục con nên luôn là cấp 1 (tối đa 2 cấp).</small>
          }
        </div>
        <div class="mb-3">
          <span class="form-label d-block">Ảnh / minh họa</span>
          <app-image-picker [images]="form.controls.image.value ? [form.controls.image.value] : []" [max]="1" label="Tải ảnh" (imagesChange)="form.controls.image.setValue($event[0] || ''); form.controls.image.markAsDirty()" />
        </div>
        <div class="form-check form-switch">
          <input id="c-active" class="form-check-input" type="checkbox" role="switch" formControlName="isActive" />
          <label class="form-check-label" for="c-active">Hiện ở menu và trang chủ</label>
        </div>
      </form>
      <div dialog-footer class="d-flex justify-content-end gap-2">
        <button class="btn btn-outline-secondary" type="button" (click)="done.emit('')">Hủy</button>
        <button class="btn btn-primary" type="submit" form="cat-form" [disabled]="saving()">{{ category ? 'Lưu thay đổi' : 'Thêm danh mục' }}</button>
      </div>
    </app-dialog>
  `,
})
export class CategoryDialog implements OnInit {
  @Input() category: IAdminCategory | null = null;
  @Input() tree: IAdminCategory[] = [];
  @Output() done = new EventEmitter<string>();

  private readonly fb = inject(FormBuilder);
  private readonly api = inject(AdminCatalogApiService);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly fieldError = signal<Record<string, string>>({});

  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(60)]],
    slug: ['', [Validators.pattern(/^[a-z0-9]+(-[a-z0-9]+)*$/)]],
    code: ['', [Validators.required, Validators.pattern(/^[A-Z0-9]{2,6}$/)]],
    description: [''],
    parentId: [''],
    image: [''],
    isActive: [true],
  });

  readonly parents = computed(() => this.tree.filter((c) => c._id !== this.category?._id));
  readonly hasChildren = computed(() => !!this.category?.children?.length);

  ngOnInit(): void {
    if (this.category) {
      this.form.reset({
        name: this.category.name,
        slug: this.category.slug,
        code: this.category.code || '',
        description: this.category.description || '',
        parentId: this.category.parentId || '',
        image: this.category.image || '',
        isActive: this.category.isActive,
      });
    }
    if (this.hasChildren()) this.form.controls.parentId.disable();
    // Thêm mới: đường dẫn tự sinh theo tên cho tới khi người dùng sửa tay
    this.form.controls.name.valueChanges.subscribe((name) => {
      if (!this.category && !this.form.controls.slug.dirty) this.form.controls.slug.setValue(slugify(name));
    });
  }

  // Mã luôn viết hoa, bỏ ký tự không hợp lệ ngay khi gõ
  upperCode(): void {
    const c = this.form.controls.code;
    const v = c.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (v !== c.value) c.setValue(v);
  }

  save(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    const data = { ...v, parentId: v.parentId || null };
    this.saving.set(true);
    this.error.set('');
    this.fieldError.set({});
    const req = this.category ? this.api.updateCategory({ ...data, _id: this.category._id }) : this.api.createCategory(data);
    req.subscribe({
      next: (c) => {
        this.saving.set(false);
        this.done.emit(this.category ? `Đã lưu danh mục "${c.name}"` : `Đã thêm danh mục "${c.name}"`);
      },
      error: (err: ApiError) => {
        this.saving.set(false);
        this.fieldError.set((err.extra['fields'] as Record<string, string>) || {});
        this.error.set(err.message);
      },
    });
  }
}
