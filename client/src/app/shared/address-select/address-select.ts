import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { AccountApiService } from '../../services/account-apiservice';
import { DvhcApiService } from '../../services/dvhc-apiservice';
import { IAddress, IProvince, IWard } from '../../classes/user';
import { AddressValue } from '../../classes/aftersales';

// Địa chỉ lấy hàng / nhận hàng dùng ở SCR-25 "Lấy hàng tại", SCR-26 "Shipper đến lấy", SCR-28 "Nhận lại hàng":
// chọn từ sổ địa chỉ (API-09) hoặc nhập mới với Tỉnh/Thành, Phường/Xã từ External API địa giới.
// Địa chỉ mới hoặc đã sửa server tự lưu vào sổ (BR-22). Phát (changed) mỗi lần đổi; null khi chưa đủ thông tin.
@Component({
  selector: 'app-address-select',
  standalone: false,
  templateUrl: './address-select.html',
  styleUrl: './address-select.scss',
})
export class AddressSelect implements OnInit {
  // Tiền tố tên trường lỗi server trả về (pickupAddress.phone, shippingAddress.phone...)
  @Input() prefix = 'pickupAddress';
  @Input() fieldErrors: Record<string, string> = {};
  @Output() changed = new EventEmitter<AddressValue | null>();

  private readonly account = inject(AccountApiService);
  private readonly dvhc = inject(DvhcApiService);

  readonly addresses = signal<IAddress[]>([]);
  readonly loading = signal(true);
  readonly mode = signal<'book' | 'list' | 'new'>('book');
  readonly selectedId = signal('');
  readonly provinces = signal<IProvince[]>([]);
  readonly wards = signal<IWard[]>([]);

  form = { recipientName: '', phone: '', provinceCode: '', ward: '', street: '' };

  ngOnInit(): void {
    this.account.getAddresses().subscribe({
      next: (list) => {
        this.addresses.set(list);
        this.loading.set(false);
        const first = list.find((a) => a.isDefault) || list[0];
        if (first) {
          this.selectedId.set(first._id);
          this.emit();
        } else this.startNew();
      },
      error: () => {
        this.loading.set(false);
        this.startNew();
      },
    });
  }

  get selected(): IAddress | undefined {
    return this.addresses().find((a) => a._id === this.selectedId());
  }

  choose(id: string): void {
    this.selectedId.set(id);
    this.mode.set('book');
    this.emit();
  }

  startNew(): void {
    this.mode.set('new');
    if (!this.provinces().length) this.dvhc.getProvinces().subscribe((list) => this.provinces.set(list));
    this.emit();
  }

  backToBook(): void {
    this.mode.set('book');
    this.emit();
  }

  onProvince(code: string): void {
    this.form.provinceCode = code;
    this.form.ward = '';
    this.wards.set([]);
    if (code) this.dvhc.getWards(Number(code)).subscribe((list) => this.wards.set(list));
    this.emit();
  }

  err(field: string): string {
    return this.fieldErrors[`${this.prefix}.${field}`] || '';
  }

  emit(): void {
    if (this.mode() !== 'new') {
      const a = this.selected;
      this.changed.emit(a ? { addressId: a._id, preview: a } : null);
      return;
    }
    const f = this.form;
    const province = this.provinces().find((p) => String(p.code) === String(f.provinceCode))?.name || '';
    const ok = f.recipientName.trim().length >= 2 && /^0\d{9}$/.test(f.phone.replace(/[\s.]/g, '')) && province && f.ward && f.street.trim().length >= 3;
    this.changed.emit(ok ? { address: { recipientName: f.recipientName.trim(), phone: f.phone.replace(/[\s.]/g, ''), province, ward: f.ward, street: f.street.trim() } } : null);
  }
}
