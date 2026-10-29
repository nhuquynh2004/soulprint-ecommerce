import { Component, computed, inject, signal } from '@angular/core';
import { AbstractControl, FormArray, FormControl, FormGroup, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { OrderApiService } from '../../../../services/order-apiservice';
import { ApiError } from '../../../../classes/api-error';
import { IOrderDetail } from '../../../../classes/order';
import { AddressValue, IReturnRequest, RESOLUTIONS, RETURN_REASONS, RefundAccountValue, ReturnReason, TEXT_MAX } from '../../../../classes/aftersales';

type ItemGroup = FormGroup<{ orderItemId: FormControl<string>; selected: FormControl<boolean>; quantity: FormControl<number> }>;

// Validator nhóm của form (Chương V): ít nhất 1 sản phẩm; ảnh bắt buộc khi lý do là lỗi in/khắc, hư hỏng, hoặc có món
// cá nhân hóa (BR-31); xác nhận tình trạng khi có sản phẩm không cá nhân hóa (BR-13); "Đổi ý" không cho món cá nhân hóa (BR-14).
export function returnRules(isPersonalized: (id: string) => boolean): ValidatorFn {
  return (group: AbstractControl): ValidationErrors | null => {
    const v = group.getRawValue();
    const picked = (v.items as { orderItemId: string; selected: boolean }[]).filter((x) => x.selected);
    if (!picked.length) return { noItem: true };
    const errors: ValidationErrors = {};
    const anyPersonalized = picked.some((x) => isPersonalized(x.orderItemId));
    const reason = RETURN_REASONS.find((r) => r.key === v.reason);
    if (anyPersonalized && v.reason === 'DOI_Y') errors['personalizedChangeMind'] = true;
    if ((anyPersonalized || reason?.photo) && !(v.images || []).length) errors['photoRequired'] = true;
    if (picked.some((x) => !isPersonalized(x.orderItemId)) && !v.conditionConfirmed) errors['conditionRequired'] = true;
    return Object.keys(errors).length ? errors : null;
  };
}

// SCR-25 Yêu cầu đổi/trả (UC-TRK-04): các bước đánh số chọn sản phẩm và số lượng, lý do, hình thức xử lý, ảnh và
// mô tả, lấy hàng tại, tài khoản nhận tiền (khi trả hàng hoàn tiền); khung tóm tắt bên phải. Gửi xong hiện "Đã gửi yêu cầu".
@Component({
  selector: 'app-return-request',
  standalone: false,
  templateUrl: './return-request.html',
  styleUrl: './return-request.scss',
})
export class ReturnRequestPage {
  private readonly api = inject(OrderApiService);
  readonly code = inject(ActivatedRoute).snapshot.paramMap.get('code') || '';

  readonly reasons = RETURN_REASONS;
  readonly resolutions = RESOLUTIONS;
  readonly textMax = TEXT_MAX;
  readonly order = signal<IOrderDetail | null>(null);
  readonly loadError = signal('');
  readonly sending = signal(false);
  readonly error = signal('');
  readonly fieldErrors = signal<Record<string, string>>({});
  readonly submitted = signal(false);
  readonly done = signal<IReturnRequest | null>(null);
  readonly address = signal<AddressValue | null>(null);
  readonly account = signal<RefundAccountValue | null>(null);

  readonly form = new FormGroup({
    items: new FormArray<ItemGroup>([]),
    reason: new FormControl<ReturnReason | ''>('', { nonNullable: true, validators: Validators.required }),
    resolution: new FormControl<'GIAO_LAI' | 'HOAN_TIEN' | ''>('', { nonNullable: true, validators: Validators.required }),
    images: new FormControl<string[]>([], { nonNullable: true }),
    description: new FormControl('', { nonNullable: true, validators: Validators.maxLength(TEXT_MAX) }),
    conditionConfirmed: new FormControl(false, { nonNullable: true }),
  });

  // Giá trị form dạng signal để template và computed đọc (FormArray không phải signal)
  readonly value = signal(this.form.getRawValue());

  readonly pickedItems = computed(() => {
    const o = this.order();
    return o ? this.value().items.filter((x) => x.selected).map((x) => ({ ...x, item: o.items.find((i) => i._id === x.orderItemId)! })) : [];
  });
  readonly anyPersonalized = computed(() => this.pickedItems().some((x) => x.item.isPersonalized));
  readonly anyNormal = computed(() => this.pickedItems().some((x) => !x.item.isPersonalized));
  readonly returnValue = computed(() => this.pickedItems().reduce((s, x) => s + Math.round((x.item.lineValue * x.quantity) / x.item.quantity), 0));
  readonly photoNeeded = computed(() => this.anyPersonalized() || !!RETURN_REASONS.find((r) => r.key === this.value().reason)?.photo);

  constructor() {
    this.form.valueChanges.subscribe(() => this.value.set(this.form.getRawValue()));
    this.api.getOrder(this.code).subscribe({
      next: (o) => {
        this.order.set(o);
        const items = this.form.controls.items;
        for (const it of o.items.filter((i) => i.fulfillStatus !== 'DA_HOAN_TIEN')) {
          items.push(
            new FormGroup({
              orderItemId: new FormControl(it._id, { nonNullable: true }),
              selected: new FormControl(o.items.length === 1, { nonNullable: true }),
              quantity: new FormControl(it.quantity, { nonNullable: true, validators: [Validators.min(1), Validators.max(it.quantity)] }),
            }),
          );
        }
        this.form.setValidators(returnRules((id) => !!o.items.find((i) => i._id === id)?.isPersonalized));
        this.form.updateValueAndValidity();
      },
      error: (err: ApiError) => this.loadError.set(err.status === 404 ? 'Không tìm thấy đơn hàng' : err.message),
    });
  }

  get itemControls(): ItemGroup[] {
    return this.form.controls.items.controls;
  }

  itemOf(id: string) {
    return this.order()!.items.find((i) => i._id === id)!;
  }

  // "Đổi ý" bị vô hiệu khi có món cá nhân hóa (BR-14)
  reasonDisabled(key: ReturnReason): boolean {
    return key === 'DOI_Y' && this.anyPersonalized();
  }

  pickReason(key: ReturnReason): void {
    if (!this.reasonDisabled(key)) this.form.controls.reason.setValue(key);
  }

  quantityStep(g: ItemGroup, d: number): void {
    const max = this.itemOf(g.controls.orderItemId.value).quantity;
    g.controls.quantity.setValue(Math.min(max, Math.max(1, g.controls.quantity.value + d)));
  }

  get canSend(): boolean {
    if (this.sending()) return false;
    if (!this.address()) return false;
    if (this.value().resolution === 'HOAN_TIEN' && !this.account()) return false;
    return true;
  }

  // 5Ea: thiếu ảnh khi lý do bắt buộc thì báo ở đầu trang và tại khối ảnh, không gửi
  get topError(): string {
    if (!this.submitted()) return '';
    const e = this.form.errors || {};
    if (e['noItem']) return 'Chọn ít nhất 1 sản phẩm cần đổi/trả';
    if (this.form.controls.reason.invalid) return 'Chọn lý do đổi/trả';
    if (e['personalizedChangeMind']) return 'Lý do "Đổi ý" không áp dụng cho món cá nhân hóa';
    if (this.form.controls.resolution.invalid) return 'Chọn hình thức xử lý';
    if (e['photoRequired']) return 'Thêm ảnh bằng chứng để gửi yêu cầu';
    if (e['conditionRequired']) return 'Xác nhận sản phẩm còn nguyên tem, nhãn, bao bì gốc';
    if (!this.address()) return 'Chọn hoặc nhập địa chỉ lấy hàng';
    if (this.value().resolution === 'HOAN_TIEN' && !this.account()) return 'Nhập tài khoản nhận tiền hoàn';
    return '';
  }

  submit(): void {
    this.submitted.set(true);
    this.form.markAllAsTouched();
    if (this.form.invalid || this.topError || this.sending()) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const v = this.form.getRawValue();
    const a = this.address()!;
    const body: Record<string, unknown> = {
      items: v.items.filter((x) => x.selected).map((x) => ({ orderItemId: x.orderItemId, quantity: x.quantity, reason: v.reason })),
      resolution: v.resolution,
      description: v.description.trim(),
      images: v.images,
      conditionConfirmed: v.conditionConfirmed,
      ...('addressId' in a ? { addressId: a.addressId } : { pickupAddress: a.address }),
      ...(v.resolution === 'HOAN_TIEN' ? this.account()! : {}),
    };
    this.sending.set(true);
    this.error.set('');
    this.fieldErrors.set({});
    this.api.createReturn(this.code, body).subscribe({
      next: (r) => {
        this.done.set(r.returnRequest);
        window.scrollTo({ top: 0 });
      },
      error: (err: ApiError) => {
        this.sending.set(false);
        this.fieldErrors.set(err.extra['fields'] || {});
        this.error.set(err.message);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
    });
  }
}
