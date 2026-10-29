import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ValidationErrors, Validators } from '@angular/forms';
import { AdminGiftApiService } from '../../../services/admin-gift-apiservice';
import { ApiError } from '../../../classes/api-error';
import { IGiftTemplateAdmin, IMaterialAdmin, MATERIAL_KIND_LABEL, MaterialKind } from '../../../classes/admin-gift';
import { dateRangeValidator, toLocalInput } from '../../../shared/form-validators';

const seasonRequired = (g: AbstractControl): ValidationErrors | null => {
  if (g.get('kind')?.value !== 'BST_MUA') return null;
  const errors: ValidationErrors = {};
  if (!String(g.get('seasonLabel')?.value || '').trim()) errors['seasonLabel'] = 'Nhập tên BST/mùa hiển thị cho khách';
  if (!g.get('time.startAt')?.value || !g.get('time.endAt')?.value) errors['time'] = 'Chọn thời gian bắt đầu và kết thúc';
  return Object.keys(errors).length ? errors : null;
};

const iso = (v: string) => (v ? new Date(v).toISOString() : null);

// Form mẫu gói quà (UC-CAT-06 nhánh 1d, 1f, 1dEa): tên, mã, mô tả ngắn, ảnh, giấy gói - ruy băng - thiệp chọn từ tab
// Vật liệu (vật liệu đang ẩn bị server từ chối), loại Thường hoặc Theo BST/mùa, Hiện/Ẩn.
@Component({
  selector: 'app-gift-template-dialog',
  standalone: false,
  styleUrl: './personalization-dialogs.scss',
  template: `
    <app-dialog [title]="template && !duplicate ? 'Sửa mẫu gói quà' : 'Thêm mẫu gói quà'" size="lg" (closed)="done.emit(false)">
      <form [formGroup]="form" (ngSubmit)="save()" id="tpl-form" novalidate class="sp-pdlg">
        @if (error()) {
          <div class="sp-alert sp-alert--danger" role="alert"><app-icon name="alert-circle" [size]="20" /><p>{{ error() }}</p></div>
        }
        <div class="sp-pdlg__grid">
          <div>
            <label class="form-label" for="t-name">Tên mẫu <span class="text-danger">*</span></label>
            <input id="t-name" class="form-control" formControlName="name" maxlength="60" [class.is-invalid]="form.controls.name.touched && form.controls.name.invalid" />
            <div class="invalid-feedback">Tên mẫu cần 2-60 ký tự</div>
          </div>
          <div>
            <label class="form-label" for="t-code">Mã mẫu</label>
            <input id="t-code" class="form-control sp-mono text-uppercase" formControlName="code" maxlength="20" placeholder="Để trống để tự sinh" [class.is-invalid]="!!fieldErrors()['code']" />
            @if (fieldErrors()['code']) {
              <div class="invalid-feedback">{{ fieldErrors()['code'] }}</div>
            }
          </div>
          <div class="sp-pdlg__full">
            <label class="form-label" for="t-desc">Mô tả ngắn cho khách</label>
            <input id="t-desc" class="form-control" formControlName="description" maxlength="60" placeholder="VD Cho chàng mê thể thao" />
          </div>
          @for (slot of slots; track slot.key) {
            <div>
              <label class="form-label" [for]="'t-' + slot.key">{{ slot.label }} <span class="text-danger">*</span></label>
              <select [id]="'t-' + slot.key" class="form-select" [formControlName]="slot.key" [class.is-invalid]="(form.get(slot.key)?.touched && form.get(slot.key)?.invalid) || !!fieldErrors()[slot.key]">
                <option value="">Chọn {{ slot.label.toLowerCase() }}</option>
                @for (m of materialsOf(slot.kind); track m.code) {
                  <option [value]="m.code">{{ m.name }}{{ m.isActive ? '' : ' (đang ẩn)' }}{{ m.stock > 0 ? '' : ' - hết hàng' }}</option>
                }
              </select>
              @if (fieldErrors()[slot.key]) {
                <div class="invalid-feedback">{{ fieldErrors()[slot.key] }}</div>
              }
            </div>
          }
          <div>
            <span class="form-label d-block">Ảnh minh họa</span>
            <app-image-picker [images]="form.controls.image.value ? [form.controls.image.value] : []" [max]="1" [compact]="true" label="Tải ảnh" (imagesChange)="form.controls.image.setValue($event[0] || '')" />
          </div>
          <div class="sp-pdlg__full">
            <span class="form-label d-block">Loại</span>
            <div class="sp-seg">
              <button type="button" [class.is-on]="form.controls.kind.value === 'THUONG'" (click)="form.controls.kind.setValue('THUONG')">Mẫu thường</button>
              <button type="button" [class.is-on]="form.controls.kind.value === 'BST_MUA'" (click)="form.controls.kind.setValue('BST_MUA')">Theo BST/mùa</button>
            </div>
          </div>
          @if (form.controls.kind.value === 'BST_MUA') {
            <div>
              <label class="form-label" for="t-season">Tên BST/mùa <span class="text-danger">*</span></label>
              <input id="t-season" class="form-control" formControlName="seasonLabel" maxlength="60" [class.is-invalid]="form.touched && form.errors?.['seasonLabel']" />
            </div>
            <div>
              <label class="form-label" for="t-badge">Nhãn</label>
              <select id="t-badge" class="form-select" formControlName="badge">
                <option value="">Không có</option>
                <option value="HOT">Hot</option>
                <option value="MOI">Mới</option>
              </select>
            </div>
            <div formGroupName="time" class="sp-pdlg__dates sp-pdlg__full">
              <div>
                <label class="form-label" for="t-start">Bắt đầu <span class="text-danger">*</span></label>
                <input id="t-start" class="form-control" type="datetime-local" formControlName="startAt" />
              </div>
              <div>
                <label class="form-label" for="t-end">Kết thúc <span class="text-danger">*</span></label>
                <input id="t-end" class="form-control" type="datetime-local" formControlName="endAt" [class.is-invalid]="form.controls.time.errors?.['dateRange']" />
              </div>
              @if (form.controls.time.errors?.['dateRange']; as e) {
                <div class="invalid-feedback d-block sp-pdlg__full">{{ e }}</div>
              } @else if (form.touched && (form.errors?.['time'] || form.errors?.['seasonLabel'])) {
                <div class="invalid-feedback d-block sp-pdlg__full">{{ form.errors?.['seasonLabel'] || form.errors?.['time'] }}</div>
              }
            </div>
          }
        </div>
        <div class="form-check form-switch">
          <input id="t-active" class="form-check-input" type="checkbox" role="switch" formControlName="isActive" />
          <label class="form-check-label" for="t-active">Hiện ở tab "Mẫu gợi ý" của khách</label>
        </div>
      </form>
      <div dialog-footer class="d-flex justify-content-end gap-2">
        <button class="btn btn-outline-secondary" type="button" (click)="done.emit(false)">Hủy</button>
        <button class="btn btn-primary" type="submit" form="tpl-form" [disabled]="saving()">Lưu</button>
      </div>
    </app-dialog>
  `,
})
export class GiftTemplateDialog implements OnInit {
  @Input() template: IGiftTemplateAdmin | null = null;
  @Input() duplicate = false;
  @Input() materials: IMaterialAdmin[] = [];
  @Output() done = new EventEmitter<boolean>();

  private readonly fb = inject(FormBuilder);
  private readonly api = inject(AdminGiftApiService);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly fieldErrors = signal<Record<string, string>>({});
  readonly slots = [
    { key: 'paper', label: 'Giấy gói', kind: 'GIAY_GOI' as MaterialKind },
    { key: 'ribbon', label: 'Ruy băng', kind: 'RUY_BANG' as MaterialKind },
    { key: 'card', label: 'Thiệp', kind: 'THIEP' as MaterialKind },
  ];

  readonly form = this.fb.nonNullable.group(
    {
      name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(60)]],
      code: [''],
      description: [''],
      image: [''],
      paper: ['', Validators.required],
      ribbon: ['', Validators.required],
      card: ['', Validators.required],
      kind: ['THUONG' as 'THUONG' | 'BST_MUA'],
      seasonLabel: [''],
      badge: [''],
      time: this.fb.nonNullable.group({ startAt: [''], endAt: [''] }, { validators: dateRangeValidator }),
      isActive: [true],
    },
    { validators: seasonRequired },
  );

  materialsOf(kind: MaterialKind): IMaterialAdmin[] {
    return this.materials.filter((m) => m.kind === kind);
  }

  ngOnInit(): void {
    const t = this.template;
    if (!t) return;
    this.form.patchValue({
      name: this.duplicate ? `${t.name} (bản sao)`.slice(0, 60) : t.name,
      code: this.duplicate ? '' : t.code,
      description: t.description || '',
      image: t.image || '',
      paper: t.paper?.code || '',
      ribbon: t.ribbon?.code || '',
      card: t.card?.code || '',
      kind: t.kind,
      seasonLabel: t.seasonLabel || '',
      badge: t.badge || '',
      time: this.duplicate ? { startAt: '', endAt: '' } : { startAt: toLocalInput(t.startAt), endAt: toLocalInput(t.endAt) },
      isActive: this.duplicate ? false : t.isActive,
    });
  }

  save(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    const seasonal = v.kind === 'BST_MUA';
    const data = {
      ...(this.template && !this.duplicate ? { _id: this.template._id } : {}),
      name: v.name.trim(),
      code: v.code.trim().toUpperCase(),
      description: v.description.trim(),
      image: v.image,
      paperCode: v.paper,
      ribbonCode: v.ribbon,
      cardCode: v.card,
      kind: v.kind,
      seasonLabel: seasonal ? v.seasonLabel.trim() : null,
      badge: seasonal && v.badge ? v.badge : null,
      startAt: seasonal ? iso(v.time.startAt) : null,
      endAt: seasonal ? iso(v.time.endAt) : null,
      isActive: v.isActive,
    };
    this.saving.set(true);
    this.error.set('');
    this.fieldErrors.set({});
    const req = '_id' in data ? this.api.updateTemplate(data) : this.api.createTemplate(data);
    req.subscribe({
      next: () => {
        this.saving.set(false);
        this.done.emit(true);
      },
      error: (err: ApiError) => {
        this.saving.set(false);
        this.error.set(err.message);
        const f = (err.extra['fields'] || {}) as Record<string, string>;
        this.fieldErrors.set({ ...f, paper: f['paperCode'], ribbon: f['ribbonCode'], card: f['cardCode'] });
      },
    });
  }
}

// Form vật liệu gói quà (UC-CAT-06 nhánh 1e): loại, mã (không đổi khi sửa), tên, mô tả ngắn, đơn vị tính, ảnh,
// ngưỡng sắp hết, Hiện/Ẩn. Tồn ban đầu 0, nhập qua phiếu nhập.
@Component({
  selector: 'app-material-dialog',
  standalone: false,
  styleUrl: './personalization-dialogs.scss',
  template: `
    <app-dialog [title]="material ? 'Sửa vật liệu' : 'Thêm vật liệu'" size="md" (closed)="done.emit(false)">
      <form [formGroup]="form" (ngSubmit)="save()" id="mat-form" novalidate class="sp-pdlg">
        @if (error()) {
          <div class="sp-alert sp-alert--danger" role="alert"><app-icon name="alert-circle" [size]="20" /><p>{{ error() }}</p></div>
        }
        <div class="sp-pdlg__grid">
          <div>
            <label class="form-label" for="m-kind">Nhóm <span class="text-danger">*</span></label>
            <select id="m-kind" class="form-select" formControlName="kind">
              @for (k of kinds; track k.value) {
                <option [value]="k.value">{{ k.label }}</option>
              }
            </select>
          </div>
          <div>
            <label class="form-label" for="m-code">Mã <span class="text-danger">*</span></label>
            <input id="m-code" class="form-control sp-mono text-uppercase" formControlName="code" maxlength="20" placeholder="VD VL-GG-01" [class.is-invalid]="(form.controls.code.touched && form.controls.code.invalid) || !!fieldErrors()['code']" />
            <div class="invalid-feedback">{{ fieldErrors()['code'] || 'Mã cần 2-20 ký tự: chữ in hoa, số, dấu gạch' }}</div>
          </div>
          <div class="sp-pdlg__full">
            <label class="form-label" for="m-name">Tên vật liệu <span class="text-danger">*</span></label>
            <input id="m-name" class="form-control" formControlName="name" maxlength="60" [class.is-invalid]="form.controls.name.touched && form.controls.name.invalid" />
            <div class="invalid-feedback">Tên vật liệu cần 2-60 ký tự</div>
          </div>
          <div class="sp-pdlg__full">
            <label class="form-label" for="m-desc">Mô tả ngắn cho khách</label>
            <input id="m-desc" class="form-control" formControlName="description" maxlength="60" placeholder="VD Viền cỏ, chữ trắng" />
          </div>
          <div>
            <label class="form-label" for="m-unit">Đơn vị tính</label>
            <input id="m-unit" class="form-control" formControlName="unit" maxlength="15" placeholder="cuộn, tờ, cái" />
          </div>
          <div>
            <label class="form-label" for="m-low">Ngưỡng sắp hết</label>
            <input id="m-low" class="form-control" type="number" min="0" formControlName="lowStockThreshold" />
          </div>
          <div class="sp-pdlg__full">
            <span class="form-label d-block">Ảnh</span>
            <app-image-picker [images]="form.controls.image.value ? [form.controls.image.value] : []" [max]="1" [compact]="true" label="Tải ảnh" (imagesChange)="form.controls.image.setValue($event[0] || '')" />
          </div>
        </div>
        <div class="form-check form-switch">
          <input id="m-active" class="form-check-input" type="checkbox" role="switch" formControlName="isActive" />
          <label class="form-check-label" for="m-active">Hiện ở tab "Tạo mới" của khách</label>
        </div>
      </form>
      <div dialog-footer class="d-flex justify-content-end gap-2">
        <button class="btn btn-outline-secondary" type="button" (click)="done.emit(false)">Hủy</button>
        <button class="btn btn-primary" type="submit" form="mat-form" [disabled]="saving()">Lưu</button>
      </div>
    </app-dialog>
  `,
})
export class MaterialDialog implements OnInit {
  @Input() material: IMaterialAdmin | null = null;
  @Input() defaultKind: MaterialKind = 'GIAY_GOI';
  @Output() done = new EventEmitter<boolean>();

  private readonly fb = inject(FormBuilder);
  private readonly api = inject(AdminGiftApiService);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly fieldErrors = signal<Record<string, string>>({});
  readonly kinds = (Object.keys(MATERIAL_KIND_LABEL) as MaterialKind[]).map((value) => ({ value, label: MATERIAL_KIND_LABEL[value] }));

  readonly form = this.fb.nonNullable.group({
    kind: ['GIAY_GOI' as MaterialKind],
    code: ['', [Validators.required, Validators.pattern(/^[A-Za-z0-9-]{2,20}$/)]],
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(60)]],
    description: [''],
    unit: ['cái'],
    image: [''],
    lowStockThreshold: [5, [Validators.min(0)]],
    isActive: [true],
  });

  ngOnInit(): void {
    const m = this.material;
    if (!m) {
      this.form.controls.kind.setValue(this.defaultKind);
      return;
    }
    this.form.patchValue({ ...m, description: m.description || '', unit: m.unit || 'cái', image: m.image || '' });
    this.form.controls.kind.disable();
    this.form.controls.code.disable();
  }

  save(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    const data = { ...v, code: v.code.toUpperCase(), lowStockThreshold: Number(v.lowStockThreshold), ...(this.material ? { _id: this.material._id } : {}) };
    this.saving.set(true);
    this.error.set('');
    const req = this.material ? this.api.updateMaterial(data) : this.api.createMaterial(data);
    req.subscribe({
      next: () => {
        this.saving.set(false);
        this.done.emit(true);
      },
      error: (err: ApiError) => {
        this.saving.set(false);
        this.error.set(err.message);
        this.fieldErrors.set(err.extra['fields'] || {});
      },
    });
  }
}

// "Sửa nhóm" của nhóm mẫu BST/mùa và "Lên lịch" bộ sticker/mẫu (1b): đặt thời gian hiển thị,
// có thêm tên BST/mùa và nhãn khi sửa nhóm. Trang cha gọi API bulk SET_SEASON hoặc SCHEDULE.
@Component({
  selector: 'app-season-dialog',
  standalone: false,
  styleUrl: './personalization-dialogs.scss',
  template: `
    <app-dialog [title]="withLabel ? 'Sửa nhóm ' + (initial?.seasonLabel || '') : 'Lên lịch hiển thị'" size="md" (closed)="cancel.emit()">
      <form [formGroup]="form" (ngSubmit)="submit()" id="season-form" novalidate class="sp-pdlg">
        @if (withLabel) {
          <div class="sp-pdlg__grid">
            <div>
              <label class="form-label" for="se-label">Tên BST/mùa <span class="text-danger">*</span></label>
              <input id="se-label" class="form-control" formControlName="seasonLabel" maxlength="60" [class.is-invalid]="form.controls.seasonLabel.touched && form.controls.seasonLabel.invalid" />
            </div>
            <div>
              <label class="form-label" for="se-badge">Nhãn</label>
              <select id="se-badge" class="form-select" formControlName="badge">
                <option value="">Không có</option>
                <option value="HOT">Hot</option>
                <option value="MOI">Mới</option>
              </select>
            </div>
          </div>
        }
        <div formGroupName="time" class="sp-pdlg__dates">
          <div>
            <label class="form-label" for="se-start">Bắt đầu <span class="text-danger">*</span></label>
            <input id="se-start" class="form-control" type="datetime-local" formControlName="startAt" required />
          </div>
          <div>
            <label class="form-label" for="se-end">Kết thúc <span class="text-danger">*</span></label>
            <input id="se-end" class="form-control" type="datetime-local" formControlName="endAt" required [class.is-invalid]="form.controls.time.errors?.['dateRange']" />
          </div>
          @if (form.controls.time.errors?.['dateRange']; as e) {
            <div class="invalid-feedback d-block sp-pdlg__full">{{ e }}</div>
          }
        </div>
        @if (note) {
          <p class="small text-body-secondary m-0">{{ note }}</p>
        }
        @if (error) {
          <div class="sp-alert sp-alert--danger" role="alert"><p>{{ error }}</p></div>
        }
      </form>
      <div dialog-footer class="d-flex justify-content-end gap-2">
        <button class="btn btn-outline-secondary" type="button" (click)="cancel.emit()">Hủy</button>
        <button class="btn btn-primary" type="submit" form="season-form" [disabled]="busy || form.invalid">Lưu</button>
      </div>
    </app-dialog>
  `,
})
export class SeasonDialog implements OnInit {
  @Input() withLabel = false;
  @Input() initial: { seasonLabel?: string | null; badge?: string | null; startAt?: string | null; endAt?: string | null } | null = null;
  @Input() note = '';
  @Input() busy = false;
  @Input() error = '';
  @Output() saved = new EventEmitter<{ seasonLabel?: string; badge?: string | null; startAt: string; endAt: string }>();
  @Output() cancel = new EventEmitter<void>();

  private readonly fb = inject(FormBuilder);
  readonly form = this.fb.nonNullable.group({
    seasonLabel: [''],
    badge: [''],
    time: this.fb.nonNullable.group({ startAt: ['', Validators.required], endAt: ['', Validators.required] }, { validators: dateRangeValidator }),
  });

  ngOnInit(): void {
    if (this.withLabel) this.form.controls.seasonLabel.addValidators(Validators.required);
    const i = this.initial;
    if (i) {
      this.form.patchValue({ seasonLabel: i.seasonLabel || '', badge: i.badge || '', time: { startAt: toLocalInput(i.startAt), endAt: toLocalInput(i.endAt) } });
    }
    this.form.controls.seasonLabel.updateValueAndValidity();
  }

  submit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    this.saved.emit({
      ...(this.withLabel ? { seasonLabel: v.seasonLabel.trim(), badge: v.badge || null } : {}),
      startAt: new Date(v.time.startAt).toISOString(),
      endAt: new Date(v.time.endAt).toISOString(),
    });
  }
}
