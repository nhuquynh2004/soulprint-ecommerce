import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { AdminStoreApiService } from '../../../services/admin-store-apiservice';
import { ApiError } from '../../../classes/api-error';
import { FAQ_CATEGORY_LABEL, IFaq } from '../../../classes/admin-catalog';

// Hộp thoại thêm/sửa câu hỏi chatbot (UC-CAT-07 1c, 1cEa): câu hỏi, câu trả lời (dùng được biến chính sách),
// từ khóa (server lưu dạng không dấu), nhóm, bật/tắt.
@Component({
  selector: 'app-faq-dialog',
  standalone: false,
  template: `
    <app-dialog [title]="faq ? 'Sửa câu hỏi' : 'Thêm câu hỏi'" size="md" (closed)="done.emit('')">
      <form [formGroup]="form" id="faq-form" (ngSubmit)="save()" novalidate>
        @if (error()) {
          <div class="sp-alert sp-alert--danger" role="alert"><app-icon name="alert-circle" [size]="20" /><p>{{ error() }}</p></div>
        }
        <div class="mb-3">
          <label class="form-label" for="fq-q">Câu hỏi <span class="text-danger">*</span></label>
          <input id="fq-q" class="form-control" formControlName="question" maxlength="200" [class.is-invalid]="form.controls.question.touched && form.controls.question.invalid" />
          <div class="invalid-feedback">Nhập câu hỏi</div>
        </div>
        <div class="mb-3">
          <label class="form-label" for="fq-a">Câu trả lời <span class="text-danger">*</span></label>
          <textarea id="fq-a" class="form-control" rows="4" formControlName="answer" maxlength="1000" [class.is-invalid]="form.controls.answer.touched && form.controls.answer.invalid"></textarea>
          <div class="invalid-feedback">Nhập câu trả lời</div>
          <small class="text-body-secondary">
            Dùng được biến:
            @for (v of variables; track v.key; let last = $last) {
              <button type="button" class="btn btn-link btn-sm p-0 align-baseline" (click)="addVar(v.key)">{{ v.label }}</button>{{ last ? '' : ', ' }}
            }
          </small>
        </div>
        <div class="mb-3">
          <label class="form-label" for="fq-k">Từ khóa <span class="text-danger">*</span></label>
          <input id="fq-k" class="form-control" formControlName="keywords" placeholder="Cách nhau bằng dấu phẩy, VD phi ship, van chuyen" [class.is-invalid]="form.controls.keywords.touched && form.controls.keywords.invalid" />
          <div class="invalid-feedback">Nhập ít nhất 1 từ khóa</div>
          <small class="text-body-secondary">Gõ có dấu cũng được, hệ thống lưu dạng không dấu để so khớp câu của khách.</small>
        </div>
        <div class="row g-3 align-items-end">
          <div class="col-7">
            <label class="form-label" for="fq-c">Nhóm</label>
            <select id="fq-c" class="form-select" formControlName="category">
              @for (c of categories; track c) {
                <option [value]="c">{{ label[c] }}</option>
              }
            </select>
          </div>
          <div class="col-5">
            <div class="form-check form-switch mb-2">
              <input id="fq-on" class="form-check-input" type="checkbox" role="switch" formControlName="isActive" />
              <label class="form-check-label" for="fq-on">Bật</label>
            </div>
          </div>
        </div>
      </form>
      <div dialog-footer class="d-flex justify-content-end gap-2">
        <button class="btn btn-outline-secondary" type="button" (click)="done.emit('')">Hủy</button>
        <button class="btn btn-primary" type="submit" form="faq-form" [disabled]="saving()">Lưu</button>
      </div>
    </app-dialog>
  `,
})
export class FaqDialog implements OnInit {
  @Input() faq: IFaq | null = null;
  @Input() variables: { key: string; label: string }[] = [];
  @Output() done = new EventEmitter<string>();

  private readonly fb = inject(FormBuilder);
  private readonly api = inject(AdminStoreApiService);
  readonly label = FAQ_CATEGORY_LABEL;
  readonly categories = Object.keys(FAQ_CATEGORY_LABEL) as IFaq['category'][];
  readonly saving = signal(false);
  readonly error = signal('');

  readonly form = this.fb.nonNullable.group({
    question: ['', [Validators.required, Validators.maxLength(200)]],
    answer: ['', [Validators.required, Validators.maxLength(1000)]],
    keywords: ['', [Validators.required]],
    category: ['KHAC' as IFaq['category']],
    isActive: [true],
  });

  ngOnInit(): void {
    const f = this.faq;
    if (f) this.form.reset({ question: f.question, answer: f.answer, keywords: f.keywords.join(', '), category: f.category, isActive: f.isActive });
  }

  addVar(key: string): void {
    const c = this.form.controls.answer;
    c.setValue((c.value ? c.value + ' ' : '') + '{{' + key + '}}');
  }

  save(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    const data: Partial<IFaq> = { ...v, keywords: v.keywords.split(',').map((k) => k.trim()).filter(Boolean) };
    this.saving.set(true);
    const req = this.faq ? this.api.updateFaq({ ...data, _id: this.faq._id! }) : this.api.createFaq(data);
    req.subscribe({
      next: () => this.done.emit(this.faq ? 'Đã lưu câu hỏi' : 'Đã thêm câu hỏi'),
      error: (err: ApiError) => {
        this.saving.set(false);
        this.error.set(err.message);
      },
    });
  }
}
