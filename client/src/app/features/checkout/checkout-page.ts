import { Component, DestroyRef, ViewChild, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, NgForm, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { CheckoutApiService } from '../../services/checkout-apiservice';
import { AccountApiService } from '../../services/account-apiservice';
import { DvhcApiService } from '../../services/dvhc-apiservice';
import { AuthService } from '../../services/auth';
import { CartService } from '../../services/cart';
import { ToastService } from '../../services/toast';
import { ApiError } from '../../classes/api-error';
import { IAddress, IProvince, IWard } from '../../classes/user';
import { IOrderRequest, IPaymentOption, IQuote, IShippingAddress, IWalletVoucher, RecipientType, optionKeyOf, voucherBadge } from '../../classes/checkout';
import { firstError, phoneValidator } from '../../shared/form-validators';
import { UrgentApiService } from '../../services/urgent-apiservice';

const DAY_NAMES = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
// "Thứ ba, 20/10"
const dayLabel = (ymd: string) => {
  const d = new Date(ymd + 'T00:00:00Z');
  return `${DAY_NAMES[d.getUTCDay()]}, ${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
};

// SCR-07 Thanh toán (UC-PAY-01 đến PAY-04). Bảng tiền luôn lấy từ server (API-37), client chỉ hiển thị.
// - Thông tin người mua của Guest: Template-driven Form (ngModel) - Chương V, theo ghi chú UC-PAY-01
// - Giao hàng: Reactive Form, thêm/bớt validator theo hình thức giao (UC-PAY-02 ghi chú kỹ thuật)
// - Kho địa chỉ: component con AddressPicker (@Input/@Output)
// - Đơn cần trả online: API-38 trả giao dịch, chuyển tới cổng giả lập SCR-08 (S6). Quay lại từ cổng (?gd=mã giao dịch)
//   thì điền lại thông tin đã nhập đọc từ API-39
@Component({
  selector: 'app-checkout-page',
  standalone: false,
  templateUrl: './checkout-page.html',
  styleUrl: './checkout-page.scss',
})
export class CheckoutPage {
  private readonly api = inject(CheckoutApiService);
  private readonly account = inject(AccountApiService);
  protected readonly dvhc = inject(DvhcApiService);
  protected readonly auth = inject(AuthService);
  private readonly cartService = inject(CartService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly urgentApi = inject(UrgentApiService);

  readonly badge = voucherBadge;
  readonly isMember = computed(() => this.auth.currentUser()?.role === 'member');

  readonly quote = signal<IQuote | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal('');
  readonly placing = signal(false);
  readonly formError = signal('');

  // Bước 1 (Guest): chọn mua không cần tài khoản (UC-PAY-01 bước 2-3)
  readonly guestMode = signal(true);
  // Template-driven form người mua
  buyer = { fullName: '', phone: '', email: '' };

  // Bước giao hàng
  readonly recipientType = signal<RecipientType>('SELF');
  readonly addresses = signal<IAddress[]>([]);
  readonly chosenAddress = signal<IAddress | null>(null); // thẻ "Địa chỉ nhận hàng" của Member
  readonly editingAddress = signal(false); // Member bấm "Sửa" hoặc chưa có địa chỉ
  readonly setAsDefault = signal(false);
  readonly filledFrom = signal(''); // "Đã điền từ kho địa chỉ: ..." (giao người nhận)
  readonly picker = signal(false);
  readonly provinces = signal<IProvince[]>([]);
  readonly wards = signal<IWard[]>([]);
  readonly loadingWards = signal(false);

  readonly ship = this.fb.nonNullable.group({
    recipientName: [''],
    phone: [''],
    provinceCode: [0],
    ward: [''],
    street: [''],
    deliveryDate: [''],
    deliveryWindow: [''],
    noteForShop: ['', Validators.maxLength(200)],
    noteForShipper: ['', Validators.maxLength(200)],
  });

  // Ưu đãi (UC-PAY-03): tối đa 1 mã giảm giá + 1 mã freeship
  readonly codes = signal<string[]>([]);
  voucherInput = '';
  readonly voucherError = signal<{ message: string; hint: string | null; loginHint: boolean } | null>(null);
  readonly applying = signal(false);
  readonly wallet = signal<IWalletVoucher[] | null>(null);
  readonly walletOpen = signal(false);
  readonly confirmReplace = signal<{ code: string; replaces: string } | null>(null);

  // Ngày giao: Giao cho tôi chỉ hiện ngày dự kiến; Giao người nhận chọn trên lịch từ ngày sớm nhất.
  // Đặt gấp: chọn ngày mong muốn trước ngày sớm nhất, gửi yêu cầu cho shop thay vì đặt hàng.
  readonly urgent = signal(false);
  readonly deliveryDateValue = signal('');
  readonly today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  readonly dayLabel = dayLabel;
  readonly earliestReason = computed(() => {
    const e = this.quote()?.delivery?.earliest;
    if (!e) return '';
    const parts = [e.afterCutoff ? 'đặt sau 12:00 nên tính từ ngày mai' : 'đặt trước 12:00'];
    if (e.personalizationDays) parts.push(`cá nhân hóa ${e.personalizationDays} ngày`);
    parts.push(!e.knownProvince ? `giao ${e.shippingDays} ngày (chọn Tỉnh/Thành để tính chính xác)` : e.inHcm ? `giao trong TP.HCM ${e.shippingDays} ngày` : `giao tỉnh ${e.shippingDays} ngày`);
    const text = parts.join(', ');
    return text.charAt(0).toUpperCase() + text.slice(1);
  });
  // Ngày đặt gấp chọn được: từ ngày mai đến trước ngày sớm nhất; không còn ngày nào thì ẩn Đặt gấp
  readonly urgentMax = computed(() => {
    const d = this.quote()?.delivery;
    return d ? d.urgentMax || addDays(d.min, -1) : '';
  });
  // Tên món cá nhân hóa ở ô COD theo kiểu từng món: In/Khắc, Thiết kế, có cả 2 thì gộp "cá nhân hóa"
  readonly personalizedLabel = computed(() => {
    const types = new Set((this.quote()?.items || []).map((it) => it.personalization?.type).filter(Boolean));
    return types.size === 1 ? (types.has('IN_KHAC') ? 'món In/Khắc' : 'món Thiết kế') : 'món cá nhân hóa';
  });
  readonly canUrgent = computed(() => {
    const d = this.quote()?.delivery;
    return !!d && d.urgentMin <= this.urgentMax();
  });

  // Thanh toán
  readonly optionKey = signal<IPaymentOption['key'] | ''>('');
  acceptPolicy = false;
  readonly policyError = signal(false);
  readonly depositInfo = signal(false);

  readonly option = computed(() => {
    const q = this.quote();
    if (!q) return null;
    return q.paymentOptions.find((o) => o.key === this.optionKey()) || q.paymentOptions[0] || null;
  });
  readonly showAddressForm = computed(() => this.recipientType() === 'OTHER' || !this.isMember() || this.editingAddress() || !this.chosenAddress());
  readonly showNameFields = computed(() => this.recipientType() === 'OTHER' || this.isMember());
  // Giao cho tôi mà đã nhập "Số điện thoại liên hệ" (Member Google chưa có SĐT) thì không hỏi lại SĐT người nhận
  readonly showShipPhone = computed(() => this.showNameFields() && (this.recipientType() === 'OTHER' || !this.needsPhone()));

  // Điền lại sau khi quay về từ cổng thanh toán: chờ danh sách tỉnh / sổ địa chỉ tải xong
  private pendingAddress: IShippingAddress | null = null;
  private pendingAddressId = '';

  constructor() {
    const pre = this.route.snapshot.queryParamMap.get('ma');
    if (pre) this.codes.set([pre.toUpperCase()]);
    this.refresh(true);
    const gd = this.route.snapshot.queryParamMap.get('gd');
    if (gd) this.restore(gd);
    this.dvhc.getProvinces().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((list) => {
      this.provinces.set(list);
      if (this.pendingAddress) this.fillForm(this.pendingAddress);
      this.pendingAddress = null;
    });
    // Đổi tỉnh thì tải phường/xã của tỉnh đó, xóa phường/xã đã chọn (UC-PAY-02 2c)
    this.ship.controls.provinceCode.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((code) => this.onProvince(Number(code)));
    // Thông tin đăng nhập có thể về sau khi trang mở: Member thì nạp sổ địa chỉ
    effect(() => {
      const member = this.isMember();
      untracked(() => {
        if (member) this.loadAddresses();
        this.syncValidators();
      });
    });
  }

  // ===== Bảng tiền (API-37) =====

  // Đổi tỉnh, hình thức giao liên tiếp: chỉ nhận bảng tiền của lần hỏi mới nhất, để ngày sớm nhất luôn theo tỉnh đang chọn
  private quoteSeq = 0;

  refresh(first = false): void {
    if (first) this.loading.set(true);
    const seq = ++this.quoteSeq;
    this.api.quote({ recipientType: this.recipientType(), voucherCodes: this.codes(), shippingAddress: { province: this.provinceName() } }).subscribe({
      next: (q) => {
        if (seq !== this.quoteSeq) return;
        this.quote.set(q);
        this.loading.set(false);
        this.checkDate(q);
        // Mã không còn dùng được (VD mang từ SCR-20) thì bỏ khỏi danh sách và báo
        if (q.voucherErrors.length) {
          const bad = new Set(q.voucherErrors.map((e) => e.code));
          this.codes.set(this.codes().filter((c) => !bad.has(c)));
          const e = q.voucherErrors[0];
          this.voucherError.set({ message: `${e.code}: ${e.message}`, hint: e.hint, loginHint: e.loginHint });
        }
        if (!q.paymentOptions.some((o) => o.key === this.optionKey())) this.optionKey.set(q.paymentOptions[0]?.key || '');
      },
      error: (err: ApiError) => {
        if (seq !== this.quoteSeq) return;
        this.loading.set(false);
        // Giỏ chưa chọn dòng nào thì quay về giỏ (SCR-07 trạng thái rỗng - 08 Mục 4)
        if (err.code === 'NO_ITEM_SELECTED') {
          this.toast.show('Giỏ hàng chưa có sản phẩm nào được chọn để thanh toán', 'danger');
          this.router.navigate(['/gio-hang'], { queryParams: this.codes().length ? { ma: this.codes()[0] } : {} });
          return;
        }
        this.loadError.set(err.message);
      },
    });
  }

  // ===== Giao hàng (UC-PAY-02) =====

  // Tỉnh đang giao tới: thẻ địa chỉ của Member hoặc ô Tỉnh/Thành của form (để server tính ngày sớm nhất)
  provinceName(): string {
    if (this.recipientType() === 'SELF' && this.isMember() && !this.showAddressForm()) return this.chosenAddress()?.province || '';
    return this.provinces().find((p) => p.code === Number(this.ship.controls.provinceCode.value))?.name || '';
  }

  // Đổi tỉnh, thêm cá nhân hóa làm ngày sớm nhất lùi lại: ngày đã chọn không còn hợp lệ thì bỏ chọn và báo
  private checkDate(q: IQuote): void {
    const date = this.ship.controls.deliveryDate.value;
    if (!date) return;
    const d = q.delivery;
    const ok = this.urgent() ? date >= d.urgentMin && date < d.min : date >= d.min && date <= d.max;
    if (ok) return;
    this.pickDate('');
    if (this.urgent() && date >= d.min) {
      this.toggleUrgent(false);
      this.toast.show(`Ngày ${dayLabel(date)} đã kịp giao bình thường, bạn không cần đặt gấp`);
      if (this.recipientType() === 'OTHER' && date <= d.max) this.pickDate(date);
    } else this.toast.show('Ngày giao đã chọn không còn kịp với địa chỉ này, bạn chọn lại giúp Soulprint nhé', 'danger');
  }

  pickDate(ymd: string): void {
    this.ship.controls.deliveryDate.setValue(ymd);
    this.ship.controls.deliveryDate.markAsTouched();
    this.deliveryDateValue.set(ymd);
  }

  toggleUrgent(on: boolean): void {
    this.urgent.set(on);
    this.pickDate('');
    this.ship.controls.deliveryDate.markAsUntouched();
    this.formError.set('');
    this.syncValidators();
  }

  private loadAddresses(): void {
    this.account.getAddresses().subscribe({
      next: (list) => {
        this.addresses.set(list);
        const mine = list.find((a) => a._id === this.pendingAddressId) || list.find((a) => a.isDefault) || list[0] || null;
        this.pendingAddressId = '';
        this.chosenAddress.set(mine);
        if (mine) this.refresh();
        // Member chưa có địa chỉ: form trống, tên và SĐT mặc định là của người mua (nhánh 3a)
        if (!mine) this.prefillBuyer();
        this.syncValidators();
      },
      error: () => this.prefillBuyer(),
    });
  }

  private prefillBuyer(): void {
    const u = this.auth.currentUser();
    if (u) this.ship.patchValue({ recipientName: u.fullName, phone: u.phone });
  }

  setRecipient(type: RecipientType): void {
    if (type === this.recipientType()) return;
    if (type === 'OTHER' && this.quote() && !this.quote()!.canSendToOther) return;
    this.recipientType.set(type);
    this.filledFrom.set('');
    this.deliveryDateValue.set('');
    if (type === 'OTHER') {
      // Form trống cho người nhận (nhánh 2a)
      this.ship.patchValue({ recipientName: '', phone: '', provinceCode: 0, ward: '', street: '', deliveryDate: '', deliveryWindow: '' }, { emitEvent: false });
      this.wards.set([]);
    } else if (this.isMember() && !this.chosenAddress()) this.prefillBuyer();
    this.syncValidators();
    this.refresh();
  }

  // Validator động theo hình thức giao (Chương V)
  private syncValidators(): void {
    const c = this.ship.controls;
    const form = this.showAddressForm();
    const names = form && this.showNameFields();
    const other = this.recipientType() === 'OTHER';
    const set = (ctrl: (typeof c)[keyof typeof c], on: boolean, validators: any[]) => {
      ctrl.setValidators(on ? validators : []);
      ctrl.updateValueAndValidity({ emitEvent: false });
    };
    set(c.recipientName, names, [Validators.required, Validators.minLength(2), Validators.maxLength(60)]);
    set(c.phone, names && this.showShipPhone(), [Validators.required, phoneValidator]);
    set(c.provinceCode, form, [Validators.min(1)]);
    set(c.ward, form, [Validators.required]);
    set(c.street, form, [Validators.required, Validators.minLength(3), Validators.maxLength(200)]);
    set(c.deliveryDate, other || this.urgent(), [Validators.required]);
    set(c.deliveryWindow, other, [Validators.required]);
  }

  shipError(name: string): string {
    return firstError(this.ship.get(name), {
      min: 'Vui lòng chọn Tỉnh/Thành phố',
      required:
        name === 'ward' ? 'Vui lòng chọn Phường/Xã' : name === 'deliveryDate' ? 'Vui lòng chọn ngày giao' : name === 'deliveryWindow' ? 'Vui lòng chọn khung giờ' : 'Vui lòng nhập thông tin này',
      minlength: name === 'street' ? 'Nhập số nhà, tên đường (3-200 ký tự)' : 'Cần 2-60 ký tự',
    });
  }

  onProvince(code: number): void {
    this.ship.patchValue({ ward: '' });
    this.wards.set([]);
    if (code) this.loadWards(code);
    this.refresh(); // ngày sớm nhất đổi theo tỉnh
  }

  private loadWards(code: number, keep = ''): void {
    this.loadingWards.set(true);
    this.dvhc.getWards(code).subscribe((list) => {
      this.wards.set(list);
      this.loadingWards.set(false);
      if (keep) this.ship.patchValue({ ward: keep });
    });
  }

  // Điền form từ 1 địa chỉ (Sửa thẻ địa chỉ, chọn từ kho khi giao người nhận) - patchValue
  private fillForm(a: Pick<IAddress, 'recipientName' | 'phone' | 'province' | 'ward' | 'street'>): void {
    const p = this.provinces().find((x) => x.name === a.province);
    this.ship.patchValue({ recipientName: a.recipientName, phone: a.phone, provinceCode: p?.code || 0, ward: '', street: a.street }, { emitEvent: false });
    if (p) this.loadWards(p.code, a.ward);
    this.refresh();
  }

  editAddress(): void {
    const a = this.chosenAddress();
    this.editingAddress.set(true);
    if (a) this.fillForm(a);
    this.syncValidators();
  }

  onPicked(e: { address: IAddress; setAsDefault: boolean }): void {
    this.picker.set(false);
    if (this.recipientType() === 'OTHER') {
      this.fillForm(e.address);
      this.filledFrom.set(e.address.recipientName);
    } else {
      this.chosenAddress.set(e.address);
      this.setAsDefault.set(e.setAsDefault);
      this.editingAddress.set(false);
      this.refresh();
    }
    this.syncValidators();
  }

  addNewAddress(): void {
    this.picker.set(false);
    this.editingAddress.set(true);
    this.chosenAddress.set(null);
    this.ship.patchValue({ provinceCode: 0, ward: '', street: '' }, { emitEvent: false });
    this.wards.set([]);
    this.prefillBuyer();
    this.syncValidators();
  }

  // Quay lại từ cổng thanh toán (Hủy, Đổi phương thức thanh toán, hết hạn): điền lại thông tin khách đã nhập
  private restore(paymentId: string): void {
    this.api.getPayment(paymentId).subscribe({
      next: (p) => {
        const c = p.checkout;
        if (!c) return;
        if (c.contact) this.buyer = { fullName: c.contact.fullName || '', phone: c.contact.phone || '', email: c.contact.email || '' };
        const type: RecipientType = c.recipientType === 'OTHER' ? 'OTHER' : 'SELF';
        this.recipientType.set(type);
        this.codes.set(c.voucherCodes || []);
        if (c.paymentChoice) this.optionKey.set(optionKeyOf({ paymentChoice: c.paymentChoice, remainingMethod: c.remainingMethod }));
        this.acceptPolicy = c.acceptPolicy === true;
        this.setAsDefault.set(!!c.setAsDefault);
        this.ship.patchValue(
          { noteForShop: c.noteForShop || '', noteForShipper: c.noteForShipper || '', deliveryDate: c.deliveryDate || '', deliveryWindow: c.deliveryWindow || '' },
          { emitEvent: false },
        );
        this.deliveryDateValue.set(c.deliveryDate || '');
        const a = c.shippingAddress;
        if (a && type === 'SELF' && this.isMember() && a.sourceAddressId) {
          // Địa chỉ chọn từ sổ: chọn lại thẻ đó khi sổ địa chỉ tải xong (hoặc ngay nếu đã có)
          const found = this.addresses().find((x) => x._id === a.sourceAddressId);
          if (found) this.chosenAddress.set(found);
          else this.pendingAddressId = a.sourceAddressId;
        } else if (a) {
          if (this.isMember()) this.editingAddress.set(true);
          if (this.provinces().length) this.fillForm(a);
          else this.pendingAddress = a;
        }
        this.syncValidators();
        this.refresh();
      },
      error: () => {},
    });
  }

  // ===== Ưu đãi (UC-PAY-03) =====

  applyVoucher(code = this.voucherInput): void {
    const c = code.trim().toUpperCase();
    if (!c) return;
    if (this.codes().includes(c)) {
      this.voucherError.set({ message: 'Mã này đã được áp dụng', hint: null, loginHint: false });
      return;
    }
    this.applying.set(true);
    this.voucherError.set(null);
    this.api.checkVoucher(c, this.codes()).subscribe({
      next: (v) => {
        this.applying.set(false);
        // Đã có mã cùng nhóm: hỏi trước khi thay (1a)
        if (v.replaces) this.confirmReplace.set({ code: v.code, replaces: v.replaces });
        else this.setCodes([...this.codes(), v.code], `Áp dụng mã ${v.code} thành công`);
      },
      error: (err: ApiError) => {
        this.applying.set(false);
        this.voucherError.set({ message: err.message, hint: err.extra['hint'] || null, loginHint: !!err.extra['loginHint'] });
      },
    });
  }

  replace(yes: boolean): void {
    const r = this.confirmReplace();
    this.confirmReplace.set(null);
    if (yes && r) this.setCodes([...this.codes().filter((c) => c !== r.replaces), r.code], `Đã thay ${r.replaces} bằng ${r.code}`);
  }

  private setCodes(list: string[], message = ''): void {
    this.codes.set(list);
    this.voucherInput = '';
    this.walletOpen.set(false);
    if (message) this.toast.show(message);
    this.refresh();
  }

  removeVoucher(code: string): void {
    this.setCodes(this.codes().filter((c) => c !== code));
  }

  openWallet(): void {
    this.walletOpen.set(true);
    this.wallet.set(null);
    this.api.getWallet().subscribe({
      next: (list) => this.wallet.set(list),
      error: () => this.wallet.set([]),
    });
  }

  loginForVoucher(): void {
    this.router.navigate(['/dang-nhap'], { queryParams: { returnUrl: '/thanh-toan' } });
  }

  // ===== Đặt hàng (API-38) =====

  readonly submitLabel = computed(() => {
    const o = this.option();
    const q = this.quote();
    if (this.urgent()) return 'Gửi yêu cầu đặt gấp';
    if (!o || !q) return 'Đặt hàng';
    if (o.key === 'DEPOSIT_COD') return 'Đặt hàng và cọc';
    if (o.key === 'ONLINE') return 'Đặt hàng và thanh toán';
    return 'Đặt hàng';
  });

  @ViewChild('buyerForm') buyerForm?: NgForm;

  // Đăng xuất rồi đăng nhập tài khoản khác, quay lại bước thanh toán
  switchAccount(): void {
    this.auth.logout().subscribe({ complete: () => this.loginForVoucher(), error: () => this.loginForVoucher() });
  }

  // Member tạo bằng Google chưa có SĐT: nhập SĐT liên hệ, lưu vào tài khoản sau đơn đầu tiên
  needsPhone(): boolean {
    const u = this.auth.currentUser();
    return !!u && u.role === 'member' && !u.phone;
  }

  place(): void {
    const buyerForm = this.buyerForm;
    const q = this.quote();
    const o = this.option();
    if (!q || !o) return;
    this.formError.set('');
    let ok = true;
    if (!this.isMember() || this.needsPhone()) {
      buyerForm?.form.markAllAsTouched();
      if (!buyerForm || buyerForm.invalid) ok = false;
    }
    this.syncValidators();
    if (this.ship.invalid) {
      this.ship.markAllAsTouched();
      ok = false;
    }
    // Đặt gấp chưa thanh toán nên chưa cần đồng ý chính sách (khách đồng ý ở trang yêu cầu khi thanh toán)
    const needPolicy = !this.urgent();
    this.policyError.set(needPolicy && !this.acceptPolicy);
    if (!ok || (needPolicy && !this.acceptPolicy)) {
      this.formError.set(!ok ? 'Vui lòng kiểm tra lại các thông tin còn thiếu' : '');
      setTimeout(() => document.querySelector('.is-invalid, .sp-co__policy.is-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      return;
    }

    const v = this.ship.getRawValue();
    const fromCard = this.recipientType() === 'SELF' && this.isMember() && !this.editingAddress() && this.chosenAddress();
    const card = this.chosenAddress();
    const address = fromCard && card
      ? { recipientName: card.recipientName, phone: card.phone, province: card.province, ward: card.ward, street: card.street, sourceAddressId: card._id }
      : {
          recipientName: this.showNameFields() ? v.recipientName : this.buyer.fullName,
          phone: (this.showShipPhone() ? v.phone : this.buyer.phone).replace(/[\s.]/g, ''),
          province: this.provinces().find((p) => p.code === Number(v.provinceCode))?.name || '',
          ward: v.ward,
          street: v.street,
        };
    const body: IOrderRequest = {
      recipientType: this.recipientType(),
      shippingAddress: address,
      setAsDefault: this.setAsDefault(),
      noteForShop: v.noteForShop,
      noteForShipper: v.noteForShipper,
      voucherCodes: this.codes(),
      acceptPolicy: true,
      paymentChoice: o.paymentChoice,
      remainingMethod: o.remainingMethod,
      expectedTotal: q.total,
      ...(this.recipientType() === 'OTHER' || this.urgent() ? { deliveryDate: v.deliveryDate, deliveryWindow: v.deliveryWindow || undefined } : {}),
      ...(this.isMember() && !this.needsPhone() ? {} : { contact: { fullName: this.buyer.fullName.trim(), phone: this.buyer.phone.replace(/[\s.]/g, ''), email: this.buyer.email.trim() } }),
    };

    this.placing.set(true);
    if (this.urgent()) {
      const { acceptPolicy, paymentChoice, remainingMethod, expectedTotal, ...request } = body;
      this.urgentApi.create(request).subscribe({
        next: (r) => this.router.navigateByUrl(r.url),
        error: (err: ApiError) => {
          this.placing.set(false);
          this.handlePlaceError(err);
        },
      });
      return;
    }
    this.api.createOrder(body).subscribe({
      next: (r) => {
        // Cần trả online: sang cổng thanh toán giả lập, đơn được tạo khi thanh toán thành công (UC-PAY-04 5b)
        if (r.paymentUrl) {
          this.router.navigateByUrl(r.paymentUrl);
          return;
        }
        this.cartService.refresh().subscribe({ error: () => {} });
        this.router.navigate(['/dat-hang', r.orderCode, 'ket-qua'], { state: { activation: r.activation } });
      },
      error: (err: ApiError) => {
        this.placing.set(false);
        this.handlePlaceError(err);
      },
    });
  }

  private handlePlaceError(err: ApiError): void {
    if (err.code === 'VOUCHER_INVALID') {
      const bad = new Set<string>(err.extra['invalidCodes'] || []);
      this.codes.set(this.codes().filter((c) => !bad.has(c)));
      this.voucherError.set({ message: err.message, hint: null, loginHint: false });
      this.refresh();
      return;
    }
    // Ngày chọn vẫn kịp giao thường
    if (err.code === 'NOT_URGENT') {
      this.formError.set(err.message);
      this.refresh();
      return;
    }
    if (err.code === 'PRICE_CHANGED') {
      this.formError.set(err.message);
      this.refresh();
      return;
    }
    // Hết hàng: về giỏ để cập nhật (UC-PAY-04 6Ea)
    if (err.code === 'OUT_OF_STOCK' || err.code === 'NO_ITEM_SELECTED' || err.code === 'GIFT_WRAP_UNAVAILABLE') {
      this.toast.show(err.message, 'danger');
      this.router.navigate(['/gio-hang']);
      return;
    }
    this.formError.set(err.message);
  }
}
