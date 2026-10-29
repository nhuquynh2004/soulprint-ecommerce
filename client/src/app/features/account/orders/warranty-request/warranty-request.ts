import { Component, computed, inject, signal } from '@angular/core';
import { AbstractControl, FormControl, FormGroup, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { OrderApiService } from '../../../../services/order-apiservice';
import { ApiError } from '../../../../classes/api-error';
import { IOrderDetail } from '../../../../classes/order';
import { AddressValue, IWarrantyRequest, TEXT_MAX, WARRANTY_SYMPTOMS } from '../../../../classes/aftersales';

// Ít nhất 1 ảnh chứng minh (BR-31: yêu cầu bảo hành luôn cần ảnh)
const atLeastOnePhoto = (c: AbstractControl): ValidationErrors | null => ((c.value || []).length ? null : { photoRequired: true });

// SCR-26 Yêu cầu bảo hành (UC-TRK-05): sản phẩm và hạn bảo hành, hiện tượng (chọn 1), mô tả, ảnh, cách gửi sản
// phẩm (shipper đến lấy tại địa chỉ, hoặc tự gửi đến cửa hàng); khung "Thông tin bảo hành". Hết hạn thì không có form (2Ea).
@Component({
  selector: 'app-warranty-request',
  standalone: false,
  templateUrl: './warranty-request.html',
  styleUrl: '../return-request/return-request.scss',
})
export class WarrantyRequestPage {
  private readonly api = inject(OrderApiService);
  private readonly route = inject(ActivatedRoute);
  readonly code = this.route.snapshot.paramMap.get('code') || '';

  readonly symptoms = WARRANTY_SYMPTOMS;
  readonly textMax = TEXT_MAX;
  readonly order = signal<IOrderDetail | null>(null);
  readonly loadError = signal('');
  readonly itemId = signal(this.route.snapshot.queryParamMap.get('item') || '');
  readonly sending = signal(false);
  readonly submitted = signal(false);
  readonly error = signal('');
  readonly fieldErrors = signal<Record<string, string>>({});
  readonly done = signal<IWarrantyRequest | null>(null);
  readonly address = signal<AddressValue | null>(null);

  readonly form = new FormGroup({
    symptom: new FormControl('', { nonNullable: true, validators: Validators.required }),
    description: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(TEXT_MAX)] }),
    images: new FormControl<string[]>([], { nonNullable: true, validators: atLeastOnePhoto }),
    shippingMethod: new FormControl<'SHIPPER_LAY' | 'TU_GUI'>('SHIPPER_LAY', { nonNullable: true }),
  });
  readonly value = signal(this.form.getRawValue());

  // Dòng còn bảo hành để chọn khi vào từ nút chung "Yêu cầu bảo hành"
  readonly eligible = computed(() => (this.order()?.items || []).filter((i) => (i.warranty?.months || 0) > 0));
  readonly item = computed(() => this.order()?.items.find((i) => i._id === this.itemId()) || null);
  readonly storeAddress = computed(() => this.order()?.warranties?.find((w) => w.returnAddress)?.returnAddress || '');

  constructor() {
    this.form.valueChanges.subscribe(() => this.value.set(this.form.getRawValue()));
    this.api.getOrder(this.code).subscribe({
      next: (o) => {
        this.order.set(o);
        if (!this.itemId()) {
          const list = o.items.filter((i) => i.warranty?.allowed);
          if (list.length === 1) this.itemId.set(list[0]._id);
        }
      },
      error: (err: ApiError) => this.loadError.set(err.status === 404 ? 'Không tìm thấy đơn hàng' : err.message),
    });
  }

  get canSend(): boolean {
    return !this.sending() && (this.value().shippingMethod === 'TU_GUI' || !!this.address());
  }

  submit(): void {
    this.submitted.set(true);
    this.form.markAllAsTouched();
    if (this.form.invalid || !this.canSend) return;
    const v = this.form.getRawValue();
    const a = this.address();
    const body: Record<string, unknown> = {
      orderItemId: this.itemId(),
      symptom: v.symptom,
      description: v.description.trim(),
      images: v.images,
      shippingMethod: v.shippingMethod,
      ...(v.shippingMethod === 'SHIPPER_LAY' && a ? ('addressId' in a ? { addressId: a.addressId } : { pickupAddress: a.address }) : {}),
    };
    this.sending.set(true);
    this.error.set('');
    this.fieldErrors.set({});
    this.api.createWarranty(this.code, body).subscribe({
      next: (r) => {
        this.done.set(r.warrantyRequest);
        window.scrollTo({ top: 0 });
      },
      error: (err: ApiError) => {
        this.sending.set(false);
        this.fieldErrors.set(err.extra['fields'] || {});
        this.error.set(err.message);
      },
    });
  }
}
