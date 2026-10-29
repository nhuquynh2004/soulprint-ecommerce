import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { DvhcApiService } from '../../../services/dvhc-apiservice';
import { IProvince } from '../../../classes/user';
import { IDraftQuote, IDraftVoucher } from '../../../classes/admin-order';
import { AdminOrderApiService } from '../../../services/admin-order-apiservice';
import { phoneError } from '../../../shared/form-validators';

export interface DraftShipping {
  recipientType: 'SELF' | 'OTHER';
  shippingAddress: { recipientName: string; phone: string; province: string; ward: string; street: string; noteForShipper: string };
  deliveryDate: string | null;
  deliveryWindow: string | null;
}

export interface SavedAddress {
  _id: string;
  label?: string;
  recipientName: string;
  phone: string;
  province: string;
  ward: string;
  street: string;
  isDefault?: boolean;
}

// Hộp thoại "Thông tin giao hàng" của đơn nháp (SCR-49-GiaoHang, UC-OPS-02 bước 3, 2a): Giao cho khách / Giao người
// nhận, chọn địa chỉ đã lưu của khách hoặc nhập địa chỉ khác (2 cấp), ngày giao và khung giờ khi giao người
// nhận, ghi chú cho shipper. Trao đổi với trang cha bằng @Input/@Output (Chương II).
@Component({
  selector: 'app-draft-shipping-dialog',
  standalone: false,
  template: `
    <app-dialog title="Thông tin giao hàng" [subtitle]="subtitle" (closed)="closed.emit()">
      <div class="sp-seg mb-3" role="group" aria-label="Hình thức giao">
        <button type="button" [class.is-on]="recipientType() === 'SELF'" (click)="recipientType.set('SELF')">Giao cho khách</button>
        <button type="button" [class.is-on]="recipientType() === 'OTHER'" (click)="recipientType.set('OTHER')">Giao người nhận</button>
      </div>
      @if (addresses.length) {
        <p class="sp-dlg-label">Địa chỉ đã lưu của khách</p>
        @for (a of addresses; track a._id) {
          <label class="sp-addr" [class.is-on]="picked() === a._id">
            <input class="form-check-input" type="radio" name="addr" [checked]="picked() === a._id" (change)="pick(a)" />
            <span><strong>{{ a.label || (a.isDefault ? 'Mặc định' : 'Địa chỉ') }} | {{ a.recipientName }}</strong> {{ a.phone }}<br />{{ a.street }}, {{ a.ward }}, {{ a.province }}</span>
          </label>
        }
        <label class="sp-addr" [class.is-on]="picked() === 'NEW'">
          <input class="form-check-input" type="radio" name="addr" [checked]="picked() === 'NEW'" (change)="picked.set('NEW')" />
          <span><strong>Địa chỉ khác</strong><br />Nhập địa chỉ mới cho đơn này</span>
        </label>
      }
      @if (!addresses.length || picked() === 'NEW') {
        <div class="row g-2 mt-1">
          <label class="sp-field col-sm-6"><span>Người nhận *</span><input class="form-control" maxlength="60" [value]="addr().recipientName" (input)="set('recipientName', $any($event.target).value)" /></label>
          <label class="sp-field col-sm-6"><span>Số điện thoại *</span><input class="form-control" inputmode="tel" maxlength="11" [value]="addr().phone" [class.is-invalid]="!!phoneErr()" (input)="set('phone', $any($event.target).value)" (blur)="phoneTouched.set(true)" /><span class="invalid-feedback">{{ phoneErr() }}</span></label>
          <label class="sp-field col-sm-6"><span>Tỉnh/Thành phố *</span>
            <app-search-select ariaLabel="Tỉnh/Thành phố" placeholder="Chọn hoặc gõ Tỉnh/Thành phố" [ngModel]="addr().province" (ngModelChange)="setProvince($event)" [options]="provinces() | searchOptions: 'name' : 'name'" />
          </label>
          <label class="sp-field col-sm-6"><span>Phường/Xã *</span>
            <app-search-select ariaLabel="Phường/Xã" placeholder="Chọn hoặc gõ Phường/Xã" [ngModel]="addr().ward" (ngModelChange)="set('ward', $event)" [options]="wards() | searchOptions" />
          </label>
          <label class="sp-field col-12"><span>Địa chỉ cụ thể *</span><input class="form-control" maxlength="200" placeholder="Số nhà, tên đường" [value]="addr().street" (input)="set('street', $any($event.target).value)" /></label>
        </div>
      }
      @if (recipientType() === 'OTHER' || urgent) {
        <div class="row g-2 mt-1">
          <label class="sp-field col-sm-6"><span>{{ urgent ? 'Ngày giao gấp *' : 'Ngày giao *' }}</span><input class="form-control" type="date" [min]="(urgent ? delivery?.urgentMin : delivery?.min) || ''" [max]="delivery?.max || ''" [value]="deliveryDate()" (input)="deliveryDate.set($any($event.target).value)" /></label>
          <label class="sp-field col-sm-6"><span>Khung giờ{{ recipientType() === 'OTHER' ? ' *' : '' }}</span>
            <select class="form-select" [value]="deliveryWindow()" (change)="deliveryWindow.set($any($event.target).value)">
              <option value="">{{ recipientType() === 'OTHER' ? 'Chọn khung giờ' : 'Không chọn' }}</option>
              @for (s of delivery?.slots || []; track s) { <option [value]="s">{{ s }}</option> }
            </select>
          </label>
        </div>
        @if (urgent) {
          <p class="small text-body-secondary mt-2 mb-0">Đơn gấp chọn được từ ngày mai; giao thường sớm nhất {{ delivery?.min | date: 'dd/MM' }}.</p>
        } @else {
          <p class="small text-body-secondary mt-2 mb-0">Giao người nhận cần thanh toán online 100% (BR-02): nút chính là “Gửi liên kết thanh toán”.</p>
        }
      }
      <label class="sp-field w-100 mt-2"><span>Ghi chú cho shipper</span><input class="form-control" maxlength="200" [value]="addr().noteForShipper" (input)="set('noteForShipper', $any($event.target).value)" /></label>
      <p class="small text-body-secondary mt-2 mb-0">Phí vận chuyển đồng giá {{ shippingFee | vnd }}, tự tính theo cài đặt cửa hàng.</p>
      @if (error()) { <p class="text-danger small mt-2 mb-0" role="alert">{{ error() }}</p> }
      <div dialog-footer class="d-flex justify-content-end gap-2">
        <button class="btn btn-outline-secondary" type="button" (click)="closed.emit()">Hủy</button>
        <button class="btn btn-primary" type="button" (click)="save()">Lưu thông tin</button>
      </div>
    </app-dialog>
  `,
  styles: `
    .sp-dlg-label { margin: 0 0 6px; font-size: 13px; font-weight: 700; }
    .sp-addr { display: flex; gap: 10px; margin-bottom: 6px; padding: 10px 12px; border: 1px solid var(--sp-color-border); border-radius: var(--sp-radius-md); font-size: 14px; cursor: pointer; }
    .sp-addr.is-on { border-color: var(--sp-color-primary); background: var(--sp-color-primary-subtle); }
    .sp-addr .form-check-input { flex: none; margin-top: 3px; }
  `,
})
export class DraftShippingDialog implements OnInit {
  @Input() value: DraftShipping | null = null;
  @Input() addresses: SavedAddress[] = [];
  @Input() delivery: IDraftQuote['delivery'] | null = null;
  // Đơn gấp: chọn ngày từ ngày mai, cả Giao cho tôi
  @Input() urgent = false;
  @Input() shippingFee = 30000;
  @Input() subtitle = '';
  @Input() defaultName = '';
  @Input() defaultPhone = '';
  @Output() saved = new EventEmitter<DraftShipping>();
  @Output() closed = new EventEmitter<void>();

  private readonly dvhc = inject(DvhcApiService);
  readonly recipientType = signal<'SELF' | 'OTHER'>('SELF');
  readonly addr = signal({ recipientName: '', phone: '', province: '', ward: '', street: '', noteForShipper: '' });
  readonly phoneTouched = signal(false);
  readonly phoneErr = computed(() => phoneError(this.addr().phone, this.phoneTouched()));
  readonly deliveryDate = signal('');
  readonly deliveryWindow = signal('');
  readonly picked = signal<string>('NEW');
  readonly provinces = signal<IProvince[]>([]);
  readonly wards = signal<string[]>([]);
  readonly error = signal('');

  ngOnInit(): void {
    const v = this.value;
    this.recipientType.set(v?.recipientType || 'SELF');
    this.addr.set(v?.shippingAddress ? { ...v.shippingAddress, noteForShipper: v.shippingAddress.noteForShipper || '' } : { recipientName: this.defaultName, phone: this.defaultPhone, province: '', ward: '', street: '', noteForShipper: '' });
    this.deliveryDate.set(v?.deliveryDate || '');
    this.deliveryWindow.set(v?.deliveryWindow || '');
    const same = this.addresses.find((a) => v?.shippingAddress && a.street === v.shippingAddress.street && a.ward === v.shippingAddress.ward);
    const def = this.addresses.find((a) => a.isDefault) || this.addresses[0];
    if (same) this.picked.set(same._id);
    else if (!v?.shippingAddress && def) this.pick(def);
    this.dvhc.getProvinces().subscribe({
      next: (list) => {
        this.provinces.set(list);
        if (this.addr().province) this.loadWards(this.addr().province);
      },
      error: () => this.provinces.set([]),
    });
  }

  pick(a: SavedAddress): void {
    this.picked.set(a._id);
    this.addr.update((x) => ({ ...x, recipientName: a.recipientName, phone: a.phone, province: a.province, ward: a.ward, street: a.street }));
  }

  set(key: string, value: string): void {
    this.addr.update((a) => ({ ...a, [key]: value }));
  }

  setProvince(name: string): void {
    this.addr.update((a) => ({ ...a, province: name, ward: '' }));
    this.loadWards(name);
  }

  private loadWards(name: string): void {
    const p = this.provinces().find((x) => x.name === name);
    if (!p) return;
    this.dvhc.getWards(p.code).subscribe({ next: (w) => this.wards.set(w.map((x) => x.name)), error: () => this.wards.set([]) });
  }

  save(): void {
    const a = this.addr();
    this.phoneTouched.set(true);
    if (a.recipientName.trim().length < 2 || !/^0\d{9}$/.test(a.phone.replace(/[\s.]/g, '')) || !a.province || !a.ward || a.street.trim().length < 3) {
      this.error.set('Nhập đủ người nhận, số điện thoại 10 số, Tỉnh/Thành, Phường/Xã và địa chỉ cụ thể');
      return;
    }
    if (this.recipientType() === 'OTHER' && (!this.deliveryDate() || !this.deliveryWindow())) {
      this.error.set('Chọn ngày giao và khung giờ cho đơn giao người nhận');
      return;
    }
    if (this.urgent && !this.deliveryDate()) {
      this.error.set('Chọn ngày giao gấp');
      return;
    }
    const withDate = this.recipientType() === 'OTHER' || this.urgent;
    this.saved.emit({
      recipientType: this.recipientType(),
      shippingAddress: { ...a, phone: a.phone.replace(/[\s.]/g, ''), recipientName: a.recipientName.trim(), street: a.street.trim() },
      deliveryDate: withDate ? this.deliveryDate() : null,
      deliveryWindow: withDate ? this.deliveryWindow() || null : null,
    });
  }
}

// Hộp thoại "Thêm khoản giảm giá" (SCR-49-GiamGia): mỗi đơn 1 voucher giảm giá + 1 voucher miễn phí vận chuyển (BR-23).
// Không có "Giảm thủ công". Trang cha tính lại tiền và trả lỗi từng mã qua @Input errors.
@Component({
  selector: 'app-draft-discount-dialog',
  standalone: false,
  template: `
    <app-dialog title="Thêm khoản giảm giá" subtitle="Mỗi đơn dùng tối đa 1 voucher giảm giá và 1 voucher miễn phí vận chuyển" (closed)="closed.emit()">
      <div class="d-flex gap-2">
        <input class="form-control text-uppercase" maxlength="16" placeholder="Nhập mã khách gửi" aria-label="Mã voucher" [value]="code()" (input)="code.set($any($event.target).value)" (keydown.enter)="add()" />
        <button class="btn btn-outline-primary" type="button" [disabled]="!code().trim()" (click)="add()">Áp dụng</button>
      </div>
      <!-- voucher trong kho mà khách này dùng được, kèm đủ điều kiện theo đơn nháp hiện tại -->
      @if (form) {
        <p class="sp-field__label mt-3 mb-1">Chọn từ kho ưu đãi</p>
        @if (wallet() === null) {
          <p class="small text-body-secondary mb-0">Đang tải...</p>
        } @else if (!wallet()!.length) {
          <p class="small text-body-secondary mb-0">Không có voucher nào khách này dùng được.</p>
        } @else {
          <ul class="sp-vpick">
            @for (v of wallet(); track v.code) {
              <li [class.is-off]="!v.eligible">
                <span class="flex-grow-1">
                  <strong>{{ v.code }}</strong> | {{ v.name }}
                  <small class="d-block">{{ v.eligible ? 'Đủ điều kiện, giảm ' + (v.discount | vnd) : v.reason }}{{ v.expiresAt ? ' | hạn ' + (v.expiresAt | date: 'dd/MM') : '' }}</small>
                </span>
                <button type="button" class="btn btn-sm btn-outline-primary" [disabled]="!v.eligible || codes().includes(v.code)" (click)="pickCode(v.code)">{{ codes().includes(v.code) ? 'Đã áp dụng' : 'Áp dụng' }}</button>
              </li>
            }
          </ul>
        }
      } @else {
        <p class="small text-body-secondary mt-2 mb-0">Lưu nháp để xem voucher trong kho khách dùng được.</p>
      }
      <ul class="sp-vlist">
        @for (c of codes(); track c) {
          <li [class.is-bad]="errorOf(c)">
            <span><strong>{{ c }}</strong> {{ errorOf(c) ? '| ' + errorOf(c) : discountOf(c) ? '| giảm ' + (discountOf(c) | vnd) : '' }}</span>
            <button type="button" class="btn btn-sm btn-link" (click)="remove(c)">Gỡ</button>
          </li>
        } @empty {
          <li class="text-body-secondary">Chưa áp dụng mã nào.</li>
        }
      </ul>
      <div dialog-footer class="d-flex justify-content-end gap-2">
        <button class="btn btn-primary" type="button" (click)="closed.emit()">Xong</button>
      </div>
    </app-dialog>
  `,
  styles: `
    .sp-vlist { display: flex; flex-direction: column; gap: 6px; margin: 12px 0 0; padding: 0; list-style: none; }
    .sp-vlist li { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-radius: var(--sp-radius-md); background: var(--sp-color-surface-alt); font-size: 14px; }
    .sp-vlist li.is-bad { background: var(--sp-color-danger-subtle); color: var(--sp-color-danger); }
    .sp-vpick { display: flex; flex-direction: column; gap: 6px; max-height: 260px; overflow: auto; margin: 0; padding: 0; list-style: none; }
    .sp-vpick li { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border: 1px solid var(--sp-color-border); border-radius: var(--sp-radius-md); font-size: 14px; }
    .sp-vpick li.is-off { opacity: .7; }
    .sp-vpick small { color: var(--sp-color-text-muted); }
  `,
})
export class DraftDiscountDialog implements OnInit {
  private readonly api = inject(AdminOrderApiService);
  @Input() set initial(v: string[]) {
    this.codes.set([...(v || [])]);
  }
  // Nội dung form đang soạn (chưa lưu cũng được): kho voucher khách dùng được tính theo đúng nội dung này (API-225)
  @Input() form: Record<string, unknown> | null = null;
  readonly wallet = signal<IDraftVoucher[] | null>(null);

  ngOnInit(): void {
    if (!this.form) {
      this.wallet.set([]);
      return;
    }
    this.api.getDraftVouchersForm(this.form).subscribe({ next: (r) => this.wallet.set(r.items), error: () => this.wallet.set([]) });
  }

  pickCode(code: string): void {
    this.code.set(code);
    this.add();
  }
  @Input() quote: IDraftQuote | null = null;
  @Output() changed = new EventEmitter<string[]>();
  @Output() closed = new EventEmitter<void>();

  readonly code = signal('');
  readonly codes = signal<string[]>([]);

  add(): void {
    const c = this.code().trim().toUpperCase();
    if (!c || this.codes().includes(c)) return;
    this.codes.update((l) => [...l, c].slice(-2));
    this.code.set('');
    this.changed.emit(this.codes());
  }

  remove(c: string): void {
    this.codes.update((l) => l.filter((x) => x !== c));
    this.changed.emit(this.codes());
  }

  errorOf(c: string): string {
    return this.quote?.voucherErrors.find((e) => e.code === c)?.message || '';
  }

  discountOf(c: string): number {
    return this.quote?.vouchers.find((v) => v.code === c)?.discount || 0;
  }
}
