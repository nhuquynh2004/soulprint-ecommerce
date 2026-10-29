import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { DvhcApiService } from '../../../../services/dvhc-apiservice';
import { OrderApiService } from '../../../../services/order-apiservice';
import { ApiError } from '../../../../classes/api-error';
import { IOrderDetail } from '../../../../classes/order';
import { IProvince } from '../../../../classes/user';
import { phoneError } from '../../../../shared/form-validators';

// UC-TRK-06: khách sửa thông tin giao hàng khi đơn còn chờ xác nhận, các ô như SCR-07. Phí vận chuyển đồng giá nên tổng không đổi.
// 2a: đơn Giao cho tôi đổi được sang Giao người nhận, trả online cho đủ 100% (BR-02); đơn Giao người nhận không đổi ngược lại
@Component({
  selector: 'app-edit-shipping-dialog',
  standalone: false,
  templateUrl: './edit-shipping-dialog.html',
})
export class EditShippingDialog implements OnInit {
  @Input({ required: true }) order!: IOrderDetail;
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<IOrderDetail>();
  // 1Ea: nhân viên vừa xác nhận đơn
  @Output() stale = new EventEmitter<void>();

  private readonly dvhc = inject(DvhcApiService);
  private readonly api = inject(OrderApiService);

  readonly provinces = signal<IProvince[]>([]);
  readonly wards = signal<string[]>([]);
  readonly sending = signal(false);
  // Bước xác nhận trước khi lưu (UC-TRK-06 bước 4)
  readonly confirming = signal(false);
  readonly phoneTouched = signal(false);
  readonly error = signal('');
  readonly fieldErrors = signal<Record<string, string>>({});
  readonly form = signal({ recipientName: '', phone: '', province: '', ward: '', street: '', noteForShipper: '', noteForShop: '', deliveryDate: '', deliveryWindow: '' });
  readonly today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

  readonly toOther = signal(false);
  readonly canSwitch = computed(() => this.order.recipientType === 'SELF');
  readonly isOther = computed(() => this.order.recipientType === 'OTHER' || this.toOther());
  // Số trả thêm khi đổi sang Giao người nhận: phần còn lại của tổng (BR-02)
  readonly switchPay = computed(() => (this.toOther() ? this.order.remainingAmount : 0));
  private selfForm: Record<string, string> | null = null;
  // Khoảng ngày giao theo tỉnh đang chọn (BR-42): TP.HCM giao nhanh hơn tỉnh khác
  readonly range = computed(() => {
    const d = this.order.editDelivery;
    if (!d) return null;
    return /h[oồ]\s*ch[ií]\s*minh|hcm/i.test(this.form().province) ? d.hcm : d.other;
  });

  ngOnInit(): void {
    const a = this.order.shippingAddress;
    this.form.set({
      recipientName: a.recipientName, phone: a.phone, province: a.province, ward: a.ward, street: a.street,
      noteForShipper: a.noteForShipper || '', noteForShop: this.order.noteForShop || '',
      deliveryDate: a.deliveryDate || '', deliveryWindow: a.deliveryWindow || '',
    });
    this.dvhc.getProvinces().subscribe({
      next: (list) => {
        this.provinces.set(list);
        this.loadWards(a.province);
      },
      error: () => this.provinces.set([]),
    });
  }

  provinceNames(): string[] {
    return this.provinces().map((p) => p.name);
  }

  // Đổi kiểu nhận: sang Giao người nhận thì xóa ô người nhận, ngày giao để khách nhập mới; quay lại thì trả thông tin cũ
  setKind(other: boolean): void {
    if (other === this.toOther()) return;
    this.confirming.set(false);
    this.fieldErrors.set({});
    this.phoneTouched.set(false);
    if (other) {
      this.selfForm = this.form();
      this.form.update((f) => ({ ...f, recipientName: '', phone: '', street: '', ward: '', deliveryDate: '', deliveryWindow: '' }));
    } else if (this.selfForm) {
      this.form.set({ ...this.form(), ...this.selfForm });
    }
    this.toOther.set(other);
    this.loadWards(this.form().province);
  }

  set(key: string, value: string): void {
    this.form.update((f) => ({ ...f, [key]: value, ...(key === 'province' ? { ward: '' } : {}) }));
    this.confirming.set(false);
    if (key === 'province') this.loadWards(value);
  }

  private loadWards(province: string): void {
    this.wards.set([]);
    const p = this.provinces().find((x) => x.name === province);
    if (p) this.dvhc.getWards(p.code).subscribe({ next: (w) => this.wards.set(w.map((x) => x.name)), error: () => this.wards.set([]) });
  }

  // Lỗi ô từ server có tiền tố "shippingAddress."
  fe(key: string): string {
    const e = this.fieldErrors();
    if (key === 'phone' && !e['shippingAddress.phone']) return phoneError(this.form().phone, this.phoneTouched());
    return e['shippingAddress.' + key] || e[key] || '';
  }

  // Lần bấm đầu: hiện tóm tắt để khách xem lại; bấm "Xác nhận" mới gửi
  submit(): void {
    if (this.sending()) return;
    this.phoneTouched.set(true);
    if (!this.confirming()) {
      if (!this.fe('phone')) this.confirming.set(true);
      return;
    }
    const f = this.form();
    const body: Record<string, unknown> = {
      shippingAddress: { recipientName: f.recipientName.trim(), phone: f.phone.trim(), province: f.province, ward: f.ward, street: f.street.trim() },
      noteForShipper: f.noteForShipper.trim(),
      noteForShop: f.noteForShop.trim(),
      ...(this.isOther() ? { deliveryDate: f.deliveryDate, deliveryWindow: f.deliveryWindow } : {}),
      ...(this.toOther() ? { recipientType: 'OTHER' } : {}),
    };
    this.sending.set(true);
    this.error.set('');
    this.fieldErrors.set({});
    this.api.updateShipping(this.order.code, body).subscribe({
      next: (r) => {
        // Phải trả thêm: chuyển tới cổng thanh toán, đơn chỉ đổi khi trả xong (UC-TRK-06 4a)
        if (r.payment) {
          location.href = r.payment.paymentUrl;
          return;
        }
        if (r.order) this.saved.emit(r.order);
      },
      error: (err: ApiError) => {
        this.sending.set(false);
        this.confirming.set(false);
        if (err.status === 409) {
          this.stale.emit();
          return;
        }
        this.fieldErrors.set(err.extra['fields'] || {});
        this.error.set(err.extra['fields'] ? '' : err.message);
      },
    });
  }
}
