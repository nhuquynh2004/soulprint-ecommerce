import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, FormControl, ValidationErrors, Validators } from '@angular/forms';
import { AdminCatalogApiService } from '../../../services/admin-catalog-apiservice';
import { ApiError } from '../../../classes/api-error';
import { IAdminTag, ITagGroup } from '../../../classes/admin-catalog';
import { slugify } from '../../../shared/vn-text';

// Hộp thoại "Thêm nhóm tag" / "Sửa nhóm" (UC-CAT-04 nhánh 1c, 1d). Loại nhóm và trường khoảng chỉ chọn khi tạo.
@Component({
  selector: 'app-tag-group-dialog',
  standalone: false,
  template: `
    <app-dialog [title]="group ? 'Sửa nhóm tag' : 'Thêm nhóm tag'" size="md" (closed)="done.emit('')">
      <form [formGroup]="form" id="tg-form" (ngSubmit)="save()" novalidate>
        @if (error()) {
          <div class="sp-alert sp-alert--danger" role="alert"><app-icon name="alert-circle" [size]="20" /><p>{{ error() }}</p></div>
        }
        <div class="mb-3">
          <label class="form-label" for="tg-name">Tên nhóm <span class="text-danger">*</span></label>
          <input id="tg-name" class="form-control" formControlName="name" maxlength="40" [class.is-invalid]="form.controls.name.touched && form.controls.name.invalid" />
          <div class="invalid-feedback">Tên nhóm cần 2-40 ký tự</div>
        </div>
        <div class="mb-3">
          <label class="form-label" for="tg-desc">Mô tả</label>
          <input id="tg-desc" class="form-control" formControlName="description" maxlength="160" />
        </div>
        @if (!group) {
          <p class="form-label mb-2">Loại nhóm</p>
          <label class="sp-modecard mb-2" [class.is-on]="form.controls.kind.value === 'LIST'">
            <input class="form-check-input" type="radio" value="LIST" formControlName="kind" />
            <span><strong>Danh sách</strong><small>Tag gắn tay vào từng sản phẩm (VD Dịp tặng, Sở thích)</small></span>
          </label>
          <label class="sp-modecard mb-2" [class.is-on]="form.controls.kind.value === 'RANGE'">
            <input class="form-check-input" type="radio" value="RANGE" formControlName="kind" />
            <span><strong>Khoảng</strong><small>Mỗi tag là một khoảng từ - đến, sản phẩm tự khớp, không gắn tay</small></span>
          </label>
          @if (form.controls.kind.value === 'RANGE') {
            <label class="form-label mt-2" for="tg-field">Khoảng theo</label>
            <select id="tg-field" class="form-select mb-3" formControlName="rangeField">
              <option value="PRICE">Giá bán (đ)</option>
              <option value="AGE">Độ tuổi</option>
            </select>
          }
        } @else if (group.isSystem) {
          <p class="small text-body-secondary">Nhóm hệ thống: đổi được tên, mô tả nhưng không xóa được (bộ lọc và Tư vấn AI dựa vào nhóm này).</p>
        }
        <div class="form-check form-switch mt-2">
          <input id="tg-filter" class="form-check-input" type="checkbox" role="switch" formControlName="isFilter" />
          <label class="form-check-label" for="tg-filter">Hiện trên bộ lọc khách</label>
        </div>
      </form>
      <div dialog-footer class="d-flex justify-content-end gap-2">
        <button class="btn btn-outline-secondary" type="button" (click)="done.emit('')">Hủy</button>
        <button class="btn btn-primary" type="submit" form="tg-form" [disabled]="saving()">{{ group ? 'Lưu thay đổi' : 'Thêm nhóm' }}</button>
      </div>
    </app-dialog>
  `,
})
export class TagGroupDialog implements OnInit {
  @Input() group: ITagGroup | null = null;
  @Output() done = new EventEmitter<string>();

  private readonly fb = inject(FormBuilder);
  private readonly api = inject(AdminCatalogApiService);
  readonly saving = signal(false);
  readonly error = signal('');

  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(40)]],
    description: [''],
    kind: ['LIST' as 'LIST' | 'RANGE'],
    rangeField: ['PRICE' as 'PRICE' | 'AGE'],
    isFilter: [true],
  });

  ngOnInit(): void {
    if (this.group) this.form.patchValue({ name: this.group.name, description: this.group.description, isFilter: this.group.isFilter });
  }

  save(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    this.saving.set(true);
    this.error.set('');
    const req = this.group
      ? this.api.updateTagGroup({ code: this.group.code, name: v.name.trim(), description: v.description.trim(), isFilter: v.isFilter })
      : this.api.createTagGroup({ name: v.name.trim(), description: v.description.trim(), kind: v.kind, rangeField: v.kind === 'RANGE' ? v.rangeField : null, isFilter: v.isFilter });
    req.subscribe({
      next: (g) => this.done.emit(this.group ? `Đã lưu nhóm "${g.name}"` : `Đã thêm nhóm "${g.name}"`),
      error: (err: ApiError) => {
        this.saving.set(false);
        this.error.set(err.message);
      },
    });
  }
}

// Cross-field cho tag nhóm khoảng: "từ" ≤ "đến" (3Ea); "đến" để trống là không giới hạn trên
const rangeValidator = (g: AbstractControl): ValidationErrors | null => {
  const min = g.get('min')?.value;
  const max = g.get('max')?.value;
  if (min === null || min === '' || Number(min) < 0) return { range: 'Nhập giá trị "từ" không âm' };
  if (max !== null && max !== '' && Number(max) < Number(min)) return { range: 'Giá trị "từ" phải nhỏ hơn hoặc bằng "đến"' };
  return null;
};

// Hộp thoại thêm/sửa tag (UC-CAT-04 bước 2-3, nhánh 1a, 2a): tên, đường dẫn, từ đồng nghĩa, cờ bộ lọc; nhóm khoảng thêm từ - đến.
@Component({
  selector: 'app-tag-dialog',
  standalone: false,
  template: `
    <app-dialog [title]="tag ? 'Sửa tag' : 'Thêm tag vào ' + group.name" [subtitle]="tag ? 'Nhóm ' + group.name + ' | ' + tag.productCount + ' sản phẩm' : ''" size="md" (closed)="done.emit('')">
      <form [formGroup]="form" id="t-form" (ngSubmit)="save()" novalidate>
        @if (error()) {
          <div class="sp-alert sp-alert--danger" role="alert"><app-icon name="alert-circle" [size]="20" /><p>{{ error() }}</p></div>
        }
        <div class="mb-3">
          <label class="form-label" for="t-name">Tên tag <span class="text-danger">*</span></label>
          <input id="t-name" class="form-control" formControlName="name" maxlength="40" [placeholder]="group.kind === 'RANGE' ? (group.rangeField === 'PRICE' ? 'VD Dưới 300.000đ' : 'VD 18 - 24 tuổi') : 'VD Valentine'" [class.is-invalid]="form.controls.name.touched && form.controls.name.invalid" />
          <div class="invalid-feedback">Nhập tên tag</div>
        </div>
        @if (group.kind === 'RANGE') {
          <div class="row g-2 mb-1" formGroupName="range">
            <div class="col-6">
              <label class="form-label" for="t-min">Từ <span class="text-danger">*</span></label>
              <div class="sp-unit"><input id="t-min" class="form-control" type="number" min="0" formControlName="min" [class.is-invalid]="form.controls.range.errors" /><span>{{ unit() }}</span></div>
            </div>
            <div class="col-6">
              <label class="form-label" for="t-max">Đến</label>
              <div class="sp-unit"><input id="t-max" class="form-control" type="number" min="0" formControlName="max" placeholder="Không giới hạn" [class.is-invalid]="form.controls.range.errors" /><span>{{ unit() }}</span></div>
            </div>
          </div>
          @if (form.controls.range.errors?.['range']; as e) {
            <div class="invalid-feedback d-block mb-2">{{ e }}</div>
          } @else {
            <small class="text-body-secondary d-block mb-3">Để trống "Đến" là không giới hạn trên. Số sản phẩm của tag tính tự động.</small>
          }
        }
        <div class="mb-3">
          <label class="form-label" for="t-slug">Đường dẫn</label>
          <input id="t-slug" class="form-control" formControlName="slug" maxlength="60" [class.is-invalid]="form.controls.slug.invalid" />
          <small class="text-body-secondary">Dùng trên URL bộ lọc, VD ?tags={{ form.controls.slug.value || 'sinh-nhat' }}</small>
        </div>
        <div class="mb-3">
          <label class="form-label" for="t-syn">Từ đồng nghĩa</label>
          <input id="t-syn" class="form-control" formControlName="synonyms" placeholder="Cách nhau bằng dấu phẩy, VD ngày lễ tình nhân, 14/2" />
          <small class="text-body-secondary">Giúp tìm kiếm và Tư vấn AI hiểu cách khách gõ khác nhau.</small>
        </div>
        <div class="form-check form-switch">
          <input id="t-filter" class="form-check-input" type="checkbox" role="switch" formControlName="isFilter" />
          <label class="form-check-label" for="t-filter">Hiện trên bộ lọc khách</label>
        </div>
      </form>
      <div dialog-footer class="d-flex align-items-center gap-2">
        @if (tag) {
          @if (confirmDelete()) {
            <span class="small text-danger me-1">Gỡ khỏi {{ tag.productCount }} sản phẩm?</span>
            <button class="btn btn-danger btn-sm" type="button" [disabled]="saving()" (click)="remove()">Xóa</button>
            <button class="btn btn-sm" type="button" (click)="confirmDelete.set(false)">Không</button>
          } @else {
            <button class="btn btn-link text-danger px-0" type="button" (click)="confirmDelete.set(true)"><app-icon name="trash" [size]="16" /> Xóa tag</button>
          }
        }
        <span class="flex-grow-1"></span>
        <button class="btn btn-outline-secondary" type="button" (click)="done.emit('')">Hủy</button>
        <button class="btn btn-primary" type="submit" form="t-form" [disabled]="saving()">{{ tag ? 'Lưu' : 'Thêm tag' }}</button>
      </div>
    </app-dialog>
  `,
})
export class TagDialog implements OnInit {
  @Input() tag: IAdminTag | null = null;
  @Input({ required: true }) group!: ITagGroup;
  @Output() done = new EventEmitter<string>();

  private readonly fb = inject(FormBuilder);
  private readonly api = inject(AdminCatalogApiService);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly confirmDelete = signal(false);

  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(40)]],
    slug: ['', [Validators.pattern(/^[a-z0-9]+(-[a-z0-9]+)*$/)]],
    synonyms: [''],
    isFilter: [true],
    range: this.fb.group({ min: new FormControl<number | null>(0), max: new FormControl<number | null>(null) }, { validators: rangeValidator }),
  });

  unit(): string {
    return this.group.rangeField === 'PRICE' ? 'đ' : 'tuổi';
  }

  ngOnInit(): void {
    if (this.group.kind !== 'RANGE') this.form.controls.range.disable();
    if (this.tag) {
      this.form.patchValue({
        name: this.tag.name,
        slug: this.tag.slug,
        synonyms: this.tag.synonyms.join(', '),
        isFilter: this.tag.isFilter,
        range: { min: this.tag.range?.min ?? 0, max: this.tag.range?.max ?? null },
      });
    }
    this.form.controls.name.valueChanges.subscribe((n) => {
      if (!this.tag && !this.form.controls.slug.dirty) this.form.controls.slug.setValue(slugify(n));
    });
  }

  save(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    const data: Partial<IAdminTag> = {
      name: v.name.trim(),
      slug: v.slug.trim(),
      synonyms: v.synonyms.split(',').map((s) => s.trim()).filter(Boolean),
      isFilter: v.isFilter,
      group: this.group.code,
      ...(this.group.kind === 'RANGE' ? { range: { min: Number(v.range.min), max: v.range.max === null || (v.range.max as any) === '' ? null : Number(v.range.max) } } : {}),
    };
    this.saving.set(true);
    this.error.set('');
    const req = this.tag ? this.api.updateTag({ ...data, _id: this.tag._id }) : this.api.createTag(data);
    req.subscribe({
      next: (t) => this.done.emit(this.tag ? `Đã lưu tag "${t.name}"` : `Đã thêm tag "${t.name}" vào ${this.group.name}`),
      error: (err: ApiError) => {
        this.saving.set(false);
        this.error.set(err.message);
      },
    });
  }

  remove(): void {
    this.saving.set(true);
    this.api.deleteTag(this.tag!._id).subscribe({
      next: () => this.done.emit(`Đã xóa tag "${this.tag!.name}"`),
      error: (err: ApiError) => {
        this.saving.set(false);
        this.error.set(err.message);
      },
    });
  }
}
