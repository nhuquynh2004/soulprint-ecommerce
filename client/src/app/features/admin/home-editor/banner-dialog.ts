import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ValidationErrors, Validators } from '@angular/forms';
import { AdminStoreApiService } from '../../../services/admin-store-apiservice';
import { ApiError } from '../../../classes/api-error';
import { IBanner } from '../../../classes/admin-catalog';

const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const bannerValidator = (g: AbstractControl): ValidationErrors | null => {
  const s = g.get('startAt')?.value;
  const e = g.get('endAt')?.value;
  if (s && e && new Date(e) <= new Date(s)) return { dateRange: 'Thời gian kết thúc phải sau thời gian bắt đầu' };
  if (g.get('ctaLabel')?.value && !g.get('ctaLink')?.value) return { ctaLink: 'Nhập đường dẫn cho nút' };
  return null;
};

// Hộp thoại banner (UC-CAT-05 nhánh 1e, API-115/116): tiêu đề, mô tả, ảnh Desktop và Mobile, chữ nút, đường dẫn nút
// (đường dẫn trong website), thời gian hiển thị, bật/tắt.
@Component({
  selector: 'app-banner-dialog',
  standalone: false,
  template: `
    <app-dialog [title]="banner ? 'Sửa banner' : 'Thêm banner'" size="lg" (closed)="done.emit(null)">
      <form [formGroup]="form" id="bn-form" (ngSubmit)="save()" novalidate>
        @if (error()) {
          <div class="sp-alert sp-alert--danger" role="alert"><app-icon name="alert-circle" [size]="20" /><p>{{ error() }}</p></div>
        }
        <div class="row g-3">
          <div class="col-md-6">
            <label class="form-label" for="bn-title">Tiêu đề <span class="text-danger">*</span></label>
            <input id="bn-title" class="form-control" formControlName="title" maxlength="100" [class.is-invalid]="form.controls.title.touched && form.controls.title.invalid" />
          </div>
          <div class="col-md-6">
            <label class="form-label" for="bn-sub">Mô tả</label>
            <input id="bn-sub" class="form-control" formControlName="subtitle" maxlength="200" />
          </div>
          <div class="col-md-7">
            <span class="form-label d-block">Ảnh Desktop <span class="text-danger">*</span></span>
            <app-image-picker [images]="form.controls.imageDesktop.value ? [form.controls.imageDesktop.value] : []" [max]="1" label="Tải ảnh 16:6" (imagesChange)="form.controls.imageDesktop.setValue($event[0] || '')" />
            @if (form.controls.imageDesktop.touched && form.controls.imageDesktop.invalid) {
              <div class="invalid-feedback d-block">Tải ảnh Desktop</div>
            }
          </div>
          <div class="col-md-5">
            <span class="form-label d-block">Ảnh Mobile</span>
            <app-image-picker [images]="form.controls.imageMobile.value ? [form.controls.imageMobile.value] : []" [max]="1" label="Tải ảnh 4:5" (imagesChange)="form.controls.imageMobile.setValue($event[0] || '')" />
          </div>
          <div class="col-md-6">
            <label class="form-label" for="bn-cta">Chữ nút</label>
            <input id="bn-cta" class="form-control" formControlName="ctaLabel" maxlength="40" placeholder="VD Khám phá ngay" />
          </div>
          <div class="col-md-6">
            <label class="form-label" for="bn-link">Đường dẫn nút</label>
            <input id="bn-link" class="form-control" formControlName="ctaLink" placeholder="/bo-suu-tap/qua-trung-thu" [class.is-invalid]="form.controls.ctaLink.invalid || form.errors?.['ctaLink']" />
            @if (form.errors?.['ctaLink']; as e) {
              <div class="invalid-feedback d-block">{{ e }}</div>
            } @else if (form.controls.ctaLink.invalid) {
              <div class="invalid-feedback d-block">Đường dẫn trong website, bắt đầu bằng /</div>
            }
          </div>
          <div class="col-md-6">
            <label class="form-label" for="bn-start">Bắt đầu hiển thị</label>
            <input id="bn-start" class="form-control" type="datetime-local" formControlName="startAt" />
          </div>
          <div class="col-md-6">
            <label class="form-label" for="bn-end">Kết thúc</label>
            <input id="bn-end" class="form-control" type="datetime-local" formControlName="endAt" [class.is-invalid]="form.errors?.['dateRange']" />
            @if (form.errors?.['dateRange']; as e) {
              <div class="invalid-feedback d-block">{{ e }}</div>
            }
          </div>
        </div>
        <div class="form-check form-switch mt-3">
          <input id="bn-active" class="form-check-input" type="checkbox" role="switch" formControlName="isActive" />
          <label class="form-check-label" for="bn-active">Bật banner</label>
        </div>
      </form>
      <div dialog-footer class="d-flex justify-content-end gap-2">
        <button class="btn btn-outline-secondary" type="button" (click)="done.emit(null)">Hủy</button>
        <button class="btn btn-primary" type="submit" form="bn-form" [disabled]="saving()">Lưu banner</button>
      </div>
    </app-dialog>
  `,
})
export class BannerDialog implements OnInit {
  @Input() banner: IBanner | null = null;
  @Output() done = new EventEmitter<IBanner | null>();

  private readonly fb = inject(FormBuilder);
  private readonly api = inject(AdminStoreApiService);
  readonly saving = signal(false);
  readonly error = signal('');

  readonly form = this.fb.nonNullable.group(
    {
      title: ['', [Validators.required, Validators.maxLength(100)]],
      subtitle: [''],
      imageDesktop: ['', [Validators.required]],
      imageMobile: [''],
      ctaLabel: [''],
      ctaLink: ['', [Validators.pattern(/^\/(?!\/).*/)]],
      startAt: [''],
      endAt: [''],
      isActive: [true],
    },
    { validators: bannerValidator },
  );

  ngOnInit(): void {
    const b = this.banner;
    if (b) this.form.reset({ ...b, startAt: toLocalInput(b.startAt), endAt: toLocalInput(b.endAt) });
  }

  save(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    const data = { ...v, startAt: v.startAt ? new Date(v.startAt).toISOString() : null, endAt: v.endAt ? new Date(v.endAt).toISOString() : null };
    this.saving.set(true);
    const req = this.banner ? this.api.updateBanner({ ...data, _id: this.banner._id! }) : this.api.createBanner(data);
    req.subscribe({
      next: (b) => this.done.emit(b),
      error: (err: ApiError) => {
        this.saving.set(false);
        this.error.set(err.message);
      },
    });
  }
}
