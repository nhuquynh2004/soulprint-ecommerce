import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, Validators } from '@angular/forms';
import { AccountApiService } from '../../../services/account-apiservice';
import { DvhcApiService } from '../../../services/dvhc-apiservice';
import { ToastService } from '../../../services/toast';
import { ApiError } from '../../../classes/api-error';
import { IAddress, IProvince, IWard } from '../../../classes/user';
import { firstError, phoneValidator } from '../../../shared/form-validators';
import { ConfirmService } from '../../../services/confirm';

// SCR-17 Sổ địa chỉ (UC-ACC-03 nhánh 1b, 1c). Đủ GET, POST, PUT, DELETE (API-09 đến 12).
// Ô Tỉnh/Thành, Phường/Xã lấy từ External API địa giới 2 cấp (slide 6.3).
@Component({
  selector: 'app-addresses',
  standalone: false,
  templateUrl: './addresses.html',
  styleUrl: '../account-page.scss',
})
export class Addresses {
  private readonly confirmBox = inject(ConfirmService);
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(AccountApiService);
  protected readonly dvhc = inject(DvhcApiService);
  private readonly toast = inject(ToastService);

  readonly addresses = signal<IAddress[]>([]);
  readonly loading = signal(true);
  readonly errMessage = signal('');

  // Hộp thoại thêm/sửa
  readonly editing = signal<IAddress | 'new' | null>(null);
  readonly provinces = signal<IProvince[]>([]);
  readonly wards = signal<IWard[]>([]);
  readonly loadingWards = signal(false);
  readonly saving = signal(false);

  readonly form = this.fb.nonNullable.group({
    recipientName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(60)]],
    phone: ['', [Validators.required, phoneValidator]],
    provinceCode: [0, [Validators.min(1)]],
    ward: ['', Validators.required],
    street: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(200)]],
    isDefault: [false],
  });

  constructor() {
    this.load();
    // Đổi tỉnh thì tải phường/xã (ô dùng [ngValue] nên đọc giá trị từ control, không đọc $event.target.value)
    this.form.controls.provinceCode.valueChanges.pipe(takeUntilDestroyed()).subscribe((code) => this.onProvince(Number(code)));
  }

  load(): void {
    this.loading.set(true);
    this.errMessage.set('');
    this.api.getAddresses().subscribe({
      next: (list) => {
        this.addresses.set(list);
        this.loading.set(false);
      },
      error: () => {
        this.errMessage.set('Không tải được sổ địa chỉ');
        this.loading.set(false);
      },
    });
  }

  error(name: string): string {
    return firstError(this.form.get(name), {
      min: 'Vui lòng chọn Tỉnh/Thành phố',
      required: name === 'ward' ? 'Vui lòng chọn Phường/Xã' : 'Vui lòng nhập thông tin này',
      minlength: name === 'street' ? 'Nhập số nhà, tên đường (3-200 ký tự)' : 'Cần 2-60 ký tự',
    });
  }

  open(address: IAddress | null): void {
    this.form.reset({ recipientName: '', phone: '', provinceCode: 0, ward: '', street: '', isDefault: this.addresses().length === 0 }, { emitEvent: false });
    this.wards.set([]);
    this.editing.set(address || 'new');
    this.dvhc.getProvinces().subscribe((list) => {
      this.provinces.set(list);
      if (!address) return;
      // Sửa: tìm lại mã tỉnh theo tên đã lưu (server chỉ lưu tên - 07 Mục 1.6)
      const p = list.find((x) => x.name === address.province);
      this.form.patchValue({ ...address, provinceCode: p?.code || 0 }, { emitEvent: false });
      if (p) this.loadWards(p.code, address.ward);
    });
  }

  onProvince(code: number): void {
    this.form.patchValue({ ward: '' });
    this.wards.set([]);
    if (code) this.loadWards(code);
  }

  private loadWards(code: number, keep = ''): void {
    this.loadingWards.set(true);
    this.dvhc.getWards(code).subscribe((list) => {
      this.wards.set(list);
      this.loadingWards.set(false);
      if (keep) this.form.patchValue({ ward: keep });
    });
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const body = {
      recipientName: v.recipientName,
      phone: v.phone.replace(/[\s.]/g, ''),
      province: this.provinces().find((p) => p.code === Number(v.provinceCode))?.name || '',
      ward: v.ward,
      street: v.street,
      isDefault: v.isDefault,
    };
    const current = this.editing();
    this.saving.set(true);
    const request = current === 'new' || !current ? this.api.addAddress(body) : this.api.updateAddress({ ...body, _id: current._id });
    request.subscribe({
      next: () => {
        this.saving.set(false);
        this.editing.set(null);
        this.toast.show(current === 'new' ? 'Đã thêm địa chỉ' : 'Đã lưu địa chỉ');
        this.load();
      },
      error: (err: ApiError) => {
        this.saving.set(false);
        this.toast.show(err.message, 'danger');
      },
    });
  }

  // UC-ACC-03 nhánh 1c: hỏi xác nhận trước khi xóa
  remove(address: IAddress): void {
    this.confirmBox.ask({ title: 'Xóa địa chỉ này?', message: 'Bạn có chắc chắn muốn xóa địa chỉ này? Bạn không thể lấy lại sau khi xóa', okText: 'Xóa địa chỉ', danger: true }).then((ok) => {
      if (!ok) return;
      this.api.deleteAddress(address._id).subscribe({
        next: () => {
          this.toast.show('Đã xóa địa chỉ');
          this.load();
        },
        error: (err: ApiError) => this.toast.show(err.message, 'danger'),
      });
    });
  }

  setDefault(address: IAddress): void {
    this.api.updateAddress({ ...address, isDefault: true }).subscribe({
      next: () => this.load(),
      error: (err: ApiError) => this.toast.show(err.message, 'danger'),
    });
  }
}
