import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { AbstractControl, FormArray, FormBuilder, ValidationErrors, Validators } from '@angular/forms';
import { AdminGiftApiService } from '../../../services/admin-gift-apiservice';
import { ApiError } from '../../../classes/api-error';
import { IStickerSetAdmin } from '../../../classes/admin-gift';
import { IAdminCategory } from '../../../classes/admin-catalog';
import { dateRangeValidator, toLocalInput } from '../../../shared/form-validators';

// Bộ BST/mùa bắt buộc tên BST/mùa và thời gian (UC-CAT-06 5Ea) - validator theo loại, đặt ở FormGroup
const seasonRequired = (g: AbstractControl): ValidationErrors | null => {
  if (g.get('kind')?.value !== 'BST_MUA') return null;
  const errors: ValidationErrors = {};
  if (!String(g.get('seasonLabel')?.value || '').trim()) errors['seasonLabel'] = 'Nhập tên BST/mùa hiển thị cho khách';
  if (!g.get('time.startAt')?.value || !g.get('time.endAt')?.value) errors['time'] = 'Chọn thời gian bắt đầu và kết thúc';
  return Object.keys(errors).length ? errors : null;
};

const AXES = [
  { value: 'THE_THAO', label: 'Thể thao' },
  { value: 'ANIME', label: 'Anime' },
  { value: 'GAME', label: 'Game' },
];

// Form bộ sticker (UC-CAT-06 bước 2-5, nhánh 1a, 1f): Reactive Form với FormArray danh sách sticker (Chương V),
// validator theo loại và cross-field validator ngày. Ảnh sticker tải lên qua API-70 (ô ảnh dùng chung).
@Component({
  selector: 'app-sticker-set-dialog',
  standalone: false,
  templateUrl: './sticker-set-dialog.html',
  styleUrl: './personalization-dialogs.scss',
})
export class StickerSetDialog implements OnInit {
  @Input() set: IStickerSetAdmin | null = null;
  @Input() duplicate = false;
  @Input() categories: IAdminCategory[] = [];
  @Input() collections: { _id: string; name: string }[] = [];
  @Input() stickerFee = 5000;
  @Output() done = new EventEmitter<boolean>();

  private readonly fb = inject(FormBuilder);
  private readonly api = inject(AdminGiftApiService);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly fieldErrors = signal<Record<string, string>>({});
  readonly axes = AXES;
  private dragFrom: number | null = null;

  readonly form = this.fb.nonNullable.group(
    {
      name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(60)]],
      kind: ['THUONG' as 'THUONG' | 'BST_MUA'],
      seasonLabel: [''],
      badge: [''],
      collectionId: [''],
      categoryIds: [[] as string[]],
      axes: [[] as string[]],
      time: this.fb.nonNullable.group({ startAt: [''], endAt: [''] }, { validators: dateRangeValidator }),
      isActive: [true],
      stickers: this.fb.array<any>([]),
    },
    { validators: seasonRequired },
  );

  get stickers(): FormArray {
    return this.form.controls.stickers as FormArray;
  }

  stickerGroup(s?: { code?: string; name?: string; image?: string; isActive?: boolean }) {
    return this.fb.nonNullable.group({
      code: [s?.code ?? ''],
      name: [s?.name ?? '', [Validators.required, Validators.maxLength(40)]],
      image: [s?.image ?? '', Validators.required],
      isActive: [s?.isActive ?? true],
    });
  }

  ngOnInit(): void {
    const s = this.set;
    if (!s) {
      this.addSticker();
      return;
    }
    this.form.patchValue({
      name: this.duplicate ? `${s.name} (bản sao)`.slice(0, 60) : s.name,
      kind: s.kind,
      seasonLabel: s.seasonLabel || '',
      badge: s.badge || '',
      collectionId: s.collectionId || '',
      categoryIds: (s.categoryIds || []).map(String),
      axes: s.axes || [],
      // Nhân bản: trạng thái Ẩn, xóa trống thời gian để đặt lại (1f)
      time: this.duplicate ? { startAt: '', endAt: '' } : { startAt: toLocalInput(s.startAt), endAt: toLocalInput(s.endAt) },
      isActive: this.duplicate ? false : s.isActive,
    });
    for (const x of s.stickers) this.stickers.push(this.stickerGroup(this.duplicate ? { ...x, code: '' } : x));
  }

  addSticker(): void {
    this.stickers.push(this.stickerGroup());
  }

  removeSticker(i: number): void {
    this.stickers.removeAt(i);
  }

  toggleIn(control: 'categoryIds' | 'axes', value: string): void {
    const c = this.form.controls[control];
    const list = c.value;
    c.setValue(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  }

  // Kéo thả đổi thứ tự sticker trong form (HTML5 drag and drop, 1c)
  onDragStart(i: number): void {
    this.dragFrom = i;
  }

  onDrop(i: number, e: DragEvent): void {
    e.preventDefault();
    if (this.dragFrom === null || this.dragFrom === i) return;
    const ctl = this.stickers.at(this.dragFrom);
    this.stickers.removeAt(this.dragFrom);
    this.stickers.insert(i, ctl);
    this.dragFrom = null;
  }

  // Mã trùng: kiểm ngay trong form (2 dòng cùng mã), trùng với bộ khác thì server báo theo ô stickers.<i>.code
  codeError(i: number): string {
    const code = String(this.stickers.at(i)?.get('code')?.value || '').trim().toUpperCase();
    if (code && this.stickers.controls.some((c, k) => k !== i && String(c.get('code')?.value || '').trim().toUpperCase() === code)) {
      return 'Mã sticker đã tồn tại. Vui lòng sử dụng mã khác.';
    }
    return this.fieldErrors()[`stickers.${i}.code`] || '';
  }

  clearCodeError(i: number): void {
    const { [`stickers.${i}.code`]: _, ...rest } = this.fieldErrors();
    this.fieldErrors.set(rest);
  }

  stickerImage(i: number): string {
    return this.stickers.at(i).get('image')?.value || '';
  }

  setImage(i: number, urls: string[]): void {
    this.stickers.at(i).get('image')?.setValue(urls[0] || '');
  }

  save(): void {
    this.form.markAllAsTouched();
    if (!this.stickers.length) {
      this.error.set('Bộ sticker cần ít nhất 1 sticker');
      return;
    }
    if (this.form.invalid || this.stickers.controls.some((_, i) => this.codeError(i))) {
      this.error.set('Vui lòng kiểm tra các trường được đánh dấu');
      return;
    }
    const v = this.form.getRawValue();
    const seasonal = v.kind === 'BST_MUA';
    const data = {
      ...(this.set && !this.duplicate ? { _id: this.set._id } : {}),
      name: v.name.trim(),
      kind: v.kind,
      seasonLabel: seasonal ? v.seasonLabel.trim() : null,
      badge: seasonal && v.badge ? v.badge : null,
      collectionId: seasonal && v.collectionId ? v.collectionId : null,
      categoryIds: v.categoryIds,
      axes: v.axes,
      startAt: seasonal && v.time.startAt ? new Date(v.time.startAt).toISOString() : null,
      endAt: seasonal && v.time.endAt ? new Date(v.time.endAt).toISOString() : null,
      isActive: v.isActive,
      stickers: (v.stickers as { code: string; name: string; image: string; isActive: boolean }[]).map((x, i) => ({ ...x, sortOrder: i + 1 })),
    };
    this.saving.set(true);
    this.error.set('');
    this.fieldErrors.set({});
    const req = data._id ? this.api.updateStickerSet(data) : this.api.createStickerSet(data);
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
