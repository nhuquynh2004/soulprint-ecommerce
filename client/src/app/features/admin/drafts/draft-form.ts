import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder, FormGroup } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, debounceTime, switchMap, of, catchError, interval, filter, exhaustMap } from 'rxjs';
import { AdminOrderApiService } from '../../../services/admin-order-apiservice';
import { ProductApiService } from '../../../services/product-apiservice';
import { AuthService } from '../../../services/auth';
import { ChatDockService } from '../../../services/chat-dock';
import { ToastService } from '../../../services/toast';
import { ConfirmService } from '../../../services/confirm';
import { ApiError } from '../../../classes/api-error';
import { IDraft, IDraftQuote, IDraftLine, ICustomerRow, SOURCES, DRAFT_STATUS_LABEL, URGENT_STATUS_LABEL } from '../../../classes/admin-order';
import { IProduct, IProductDetail } from '../../../classes/product';
import { GiftWrapRequest, IPersonalization, IPersonalizeProduct, describePersonalization } from '../../../classes/cart';
import { PersonalizeResult } from '../../../shared/personalize-dialog/personalize-dialog';
import { DraftShipping, SavedAddress } from './draft-dialogs';
import { phoneError } from '../../../shared/form-validators';

const OPTION_LABEL: Record<string, string> = {
  COD: 'Thu tiền khi giao (COD)',
  DEPOSIT_COD: 'Cọc món cá nhân hóa online, còn lại COD',
  ONLINE: 'Thanh toán online toàn bộ',
};

// SCR-49 form đơn nháp (UC-OPS-02 bước 2-7, 1a, 2a, 6a): cột trái Sản phẩm (tìm, biến thể, số lượng, cá nhân hóa,
// tồn còn lại) và Thanh toán (liên kết Thêm gói quà, Thêm khoản giảm giá, Thêm thông tin giao hàng); cột phải Khách
// hàng (tìm hoặc tạo mới), Nguồn đơn, Ghi chú, Thẻ, Phương thức thanh toán (chỉ phương thức hợp lệ BR-01 đến BR-05).
// Reactive Form có FormArray sản phẩm (Chương V); hộp thoại con dùng @Input/@Output (Chương II). Bảng tiền tính lại
// bằng API-97 sau mỗi thay đổi, cùng công thức với khách tự đặt.
@Component({
  selector: 'app-draft-form',
  standalone: false,
  templateUrl: './draft-form.html',
  styleUrl: './draft-form.scss',
})
export class DraftForm {
  private readonly api = inject(AdminOrderApiService);
  private readonly products = inject(ProductApiService);
  protected readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly confirmBox = inject(ConfirmService);

  readonly sources = SOURCES.filter((s) => s.key !== 'WEBSITE');
  readonly allSources = SOURCES; // đơn gấp do khách gửi từ website
  readonly statusLabel = DRAFT_STATUS_LABEL;
  readonly urgentLabel = URGENT_STATUS_LABEL;
  // Chat nổi: mở hội thoại của yêu cầu gấp ngay trên trang để vừa chat vừa sửa đơn
  readonly dock = inject(ChatDockService);
  readonly optionLabel = OPTION_LABEL;
  readonly describe = describePersonalization;

  readonly form: FormGroup = this.fb.group({
    items: this.fb.array([]),
    source: ['DIEN_THOAI'],
    noteForShop: [''],
    internalNote: [''],
  });

  readonly code = signal<string | null>(null);
  readonly draft = signal<IDraft | null>(null);
  readonly quote = signal<IDraftQuote | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly errMessage = signal('');

  // Dữ liệu ngoài form: khách, giao hàng, gói quà, voucher, phương thức, thẻ (đổi qua hộp thoại)
  readonly customerUserId = signal<string | null>(null);
  readonly customer = signal<{ fullName: string; phone: string; email?: string } | null>(null);
  readonly customerOrders = signal(0);
  readonly addresses = signal<SavedAddress[]>([]);
  readonly shipping = signal<DraftShipping | null>(null);
  readonly giftWrap = signal<GiftWrapRequest | null>(null);
  readonly voucherCodes = signal<string[]>([]);
  readonly option = signal<string | null>(null);
  readonly tags = signal<string[]>([]);
  readonly tagInput = signal('');

  // Tìm khách, tìm sản phẩm
  readonly custQuery = signal('');
  readonly custResults = signal<ICustomerRow[]>([]);
  readonly newCustomer = signal(false);
  readonly newCust = signal({ fullName: '', phone: '', email: '' });
  readonly newCustPhoneTouched = signal(false);
  readonly newCustPhoneErr = computed(() => phoneError(this.newCust().phone, this.newCustPhoneTouched()));
  // Bấm "Đổi" khách: giữ khách cũ tới khi chọn khách mới, bấm "Giữ khách cũ" để quay lại
  readonly prevCustomer = signal<{ userId: string | null; customer: { fullName: string; phone: string; email?: string }; orders: number; addresses: SavedAddress[] } | null>(null);
  readonly prodQuery = signal('');
  readonly prodResults = signal<IProduct[]>([]);
  private readonly custSearch$ = new Subject<string>();
  private readonly prodSearch$ = new Subject<string>();
  private readonly requote$ = new Subject<void>();
  readonly productInfo = signal<Record<string, IProductDetail>>({});

  readonly dialog = signal<'shipping' | 'discount' | 'gift' | 'personalize' | 'link' | null>(null);
  // Nội dung form lúc mở hộp ưu đãi: kho voucher tính theo đúng nội dung này (API-225)
  discountForm: Record<string, unknown> | null = null;
  openDiscount(): void {
    this.discountForm = { ...this.payload() } as Record<string, unknown>;
    this.dialog.set('discount');
  }
  readonly personalizeIndex = signal<number | null>(null);
  readonly link = signal<{ paymentUrl: string; expiresAt: string; amount: number } | null>(null);
  readonly dirty = signal(false);
  // Số dòng sản phẩm dạng signal để computed() tính lại (FormArray không phải signal)
  readonly itemCount = signal(0);

  // Đơn gấp: khách gửi từ trang Thanh toán; nhân viên sửa, nhập phụ phí, bấm "Chốt đơn gấp"; khách tự thanh toán
  readonly isUrgent = computed(() => this.draft()?.kind === 'DAT_GAP');
  readonly urgentStatus = computed(() => this.draft()?.urgent?.status || null);
  readonly urgentFee = signal(0);
  readonly rejectOpen = signal(false);
  readonly rejectReason = signal('');
  readonly readonly = computed(() => this.draft()?.status === 'HOAN_TAT' || ['TU_CHOI', 'KHACH_HUY', 'DA_DAT'].includes(this.urgentStatus() || ''));
  readonly primary = computed(() => this.quote()?.primaryAction || 'CREATE_ORDER');
  readonly missing = computed(() => {
    const m: string[] = [];
    if (!this.customer()?.fullName || !/^0\d{9}$/.test(this.customer()?.phone || '')) m.push('customer');
    if (!this.itemCount()) m.push('items');
    if (!this.shipping()) m.push('shipping');
    return m;
  });
  readonly canComplete = computed(() => !this.missing().length && !!this.quote()?.money && !this.quote()?.stockWarnings.length && !this.quote()?.voucherErrors.length);

  get itemsArray(): FormArray {
    return this.form.get('items') as FormArray;
  }

  constructor() {
    this.custSearch$
      .pipe(
        debounceTime(300),
        switchMap((q) => (q.length >= 2 ? this.api.getCustomers({ q, pageSize: 6 }).pipe(catchError(() => of({ items: [] as ICustomerRow[] }))) : of({ items: [] as ICustomerRow[] }))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((r) => this.custResults.set(r.items));
    this.prodSearch$
      .pipe(
        debounceTime(300),
        switchMap((q) => (q.length >= 2 ? this.products.getProducts({ q, pageSize: 8 }).pipe(catchError(() => of({ items: [] as IProduct[] }))) : of({ items: [] as IProduct[] }))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((r) => this.prodResults.set((r as { items: IProduct[] }).items));
    this.requote$
      .pipe(
        debounceTime(350),
        switchMap(() => this.api.quoteDraft(this.payload()).pipe(catchError((err: ApiError) => {
          this.toast.show(err.message, 'danger');
          return of(null);
        }))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((q) => {
        if (!q) return;
        this.quote.set(q);
        // Phương thức đang chọn không còn hợp lệ (VD vừa chọn Giao người nhận) thì chọn lại phương thức đầu tiên (AC2)
        if (!this.option() || !q.allowedMethods.includes(this.option()!)) this.option.set(q.chosenOption);
      });
    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.changed());

    // Đã gửi liên kết: hỏi lại đơn nháp mỗi 15 giây khi tab đang mở, khách trả xong hoặc trả lỗi thì tự cập nhật
    interval(15000)
      .pipe(
        filter(() => document.visibilityState === 'visible' && this.draft()?.status === 'DA_GUI_LINK' && !!this.code() && !this.saving()),
        exhaustMap(() => this.api.getDraft(this.code()!).pipe(catchError(() => of(null)))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((r) => {
        const before = this.draft();
        if (!r || !before || this.linkKey(r.draft) === this.linkKey(before)) return;
        const d = r.draft;
        const msg = d.status === 'HOAN_TAT' ? `Khách đã thanh toán, đơn nháp đã thành đơn ${d.orderCode}` : d.payFailedAt ? 'Khách vừa thanh toán không thành công' : d.linkExpired ? 'Liên kết thanh toán đã hết hạn' : 'Đơn nháp vừa thay đổi';
        if (this.dirty() && d.status === before.status) {
          this.toast.show(`${msg}. Lưu hoặc tải lại trang để xem mới nhất`, 'info');
          this.draft.set({ ...before, payFailedAt: d.payFailedAt, payment: d.payment });
          return;
        }
        this.load(this.code()!);
        this.toast.show(msg, d.status === 'HOAN_TAT' ? 'success' : 'info');
      });

    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((p) => {
      const code = p.get('code');
      this.code.set(code);
      if (code) this.load(code);
      else {
        this.loading.set(false);
        const khach = this.route.snapshot.queryParamMap.get('khach');
        if (khach) this.api.getCustomer(khach).subscribe((c) => this.pickCustomer({ _id: c._id, fullName: c.fullName, phone: c.phone, email: c.email, orderCount: c.orderCount } as ICustomerRow));
        this.requote$.next();
      }
    });
  }

  // ===== Nạp và lưu =====

  load(code: string): void {
    this.api.getDraft(code).subscribe({
      next: ({ draft, quote }) => {
        this.draft.set(draft);
        this.quote.set(quote);
        this.customerUserId.set(draft.customerUserId);
        this.customer.set(draft.customer);
        this.shipping.set(draft.shippingAddress ? { recipientType: draft.recipientType, shippingAddress: { ...draft.shippingAddress, noteForShipper: draft.shippingAddress.noteForShipper || '' }, deliveryDate: draft.deliveryDate, deliveryWindow: draft.deliveryWindow } : null);
        this.giftWrap.set(draft.giftWrap as GiftWrapRequest | null);
        this.voucherCodes.set(draft.voucherCodes);
        this.option.set(this.optionKey(draft.paymentChoice, draft.remainingMethod) || quote.chosenOption);
        this.tags.set(draft.tags);
        this.urgentFee.set(draft.urgentFee || 0);
        this.itemsArray.clear({ emitEvent: false });
        for (const it of draft.items) this.itemsArray.push(this.lineGroup(it), { emitEvent: false });
        this.form.patchValue({ source: draft.source || 'DIEN_THOAI', noteForShop: draft.noteForShop, internalNote: draft.internalNote }, { emitEvent: false });
        for (const it of quote.items) this.loadProduct(it.slug);
        if (draft.customerUserId) this.loadAddresses(draft.customerUserId);
        if (draft.linkExpired) this.toast.show('Liên kết thanh toán đã hết hạn, đơn nháp quay về trạng thái Mở', 'info');
        this.itemCount.set(this.itemsArray.length);
        if (draft.status === 'HOAN_TAT' || ['TU_CHOI', 'KHACH_HUY', 'DA_DAT'].includes(draft.urgent?.status || '')) this.form.disable({ emitEvent: false });
        this.dirty.set(false);
        this.loading.set(false);
      },
      error: (err: ApiError) => {
        this.errMessage.set(err.status === 404 ? 'Không tìm thấy đơn nháp' : err.message);
        this.loading.set(false);
      },
    });
  }

  private optionKey(choice: string | null, remaining: string | null): string | null {
    if (choice === 'COD') return 'COD';
    if (choice === 'ONLINE') return remaining === 'COD' ? 'DEPOSIT_COD' : 'ONLINE';
    return null;
  }

  private lineGroup(it: IDraftLine): FormGroup {
    return this.fb.group({ _id: [it._id || null], productId: [it.productId], variantSku: [it.variantSku], quantity: [it.quantity], personalization: [it.personalization] });
  }

  payload(): Partial<IDraft> {
    const v = this.form.getRawValue();
    const opt = this.quote()?.paymentOptions.find((o) => o.key === this.option());
    const s = this.shipping();
    const body: Record<string, unknown> = {
      items: v.items,
      source: v.source,
      noteForShop: v.noteForShop,
      internalNote: v.internalNote,
      giftWrap: this.giftWrap(),
      voucherCodes: this.voucherCodes(),
      tags: this.tags(),
      recipientType: s?.recipientType || 'SELF',
      shippingAddress: s?.shippingAddress || null,
      deliveryDate: s?.deliveryDate || null,
      deliveryWindow: s?.deliveryWindow || null,
      paymentChoice: opt ? opt.paymentChoice : null,
      remainingMethod: opt ? opt.remainingMethod : null,
    };
    // Đang chọn khách khác mà lưu: giữ khách cũ trên server cho tới khi chọn xong
    const prev = !this.customer() ? this.prevCustomer() : null;
    if (prev) {
      if (prev.userId) body['customerUserId'] = prev.userId;
      else body['customer'] = prev.customer;
    } else if (this.customerUserId()) body['customerUserId'] = this.customerUserId();
    else body['customer'] = this.customer();
    if (this.isUrgent()) Object.assign(body, { kind: 'DAT_GAP', urgentFee: this.urgentFee() });
    return body as Partial<IDraft>;
  }

  changed(): void {
    this.itemCount.set(this.itemsArray.length);
    this.dirty.set(true);
    this.requote$.next();
  }

  // Bước 5: "Lưu nháp" bất kỳ lúc nào (không bắt buộc đủ trường)
  save(then?: () => void): void {
    this.saving.set(true);
    const code = this.code();
    const req = code ? this.api.updateDraft({ ...this.payload(), code }) : this.api.createDraft(this.payload());
    req.subscribe({
      next: ({ draft, quote }) => {
        this.saving.set(false);
        this.dirty.set(false);
        this.draft.set(draft);
        this.quote.set(quote);
        if (!code) {
          this.code.set(draft.code);
          this.router.navigate(['/quan-tri/don-nhap', draft.code], { replaceUrl: true });
        }
        if (then) then();
        else this.toast.show(`Đã lưu đơn nháp #${draft.code}`);
      },
      error: (err: ApiError) => {
        this.saving.set(false);
        this.toast.show(err.message, 'danger');
      },
    });
  }

  // Bước 6-7, 6a: lưu rồi hoàn tất theo nút chính
  complete(): void {
    this.save(() => {
      const code = this.code()!;
      const mode = this.primary();
      this.saving.set(true);
      this.api.completeDraft(code, mode).subscribe({
        next: (r) => {
          this.saving.set(false);
          if (mode === 'CREATE_ORDER') {
            this.toast.show(`Đã tạo đơn ${r.orderCode}`);
            this.router.navigate(['/quan-tri/don-hang', r.orderCode]);
          } else {
            // Khối mã QR, liên kết hiện ngay trên form sau khi tải lại
            this.link.set({ paymentUrl: r.paymentUrl!, expiresAt: r.expiresAt!, amount: r.amount! });
            this.toast.show('Đã tạo liên kết thanh toán, gửi mã QR hoặc liên kết cho khách');
            this.load(code);
          }
        },
        error: (err: ApiError) => {
          this.saving.set(false);
          // 7Eb: voucher không còn hợp lệ - gỡ mã và tính lại
          const invalid = err.extra?.['invalidCodes'] as string[] | undefined;
          if (invalid?.length) {
            this.voucherCodes.update((l) => l.filter((c) => !invalid.includes(c)));
            this.changed();
          }
          this.toast.show(err.message, 'danger');
          this.load(code);
        },
      });
    });
  }

  // ===== Đặt gấp (API-205) =====

  setUrgentFee(value: string): void {
    const n = Math.max(0, Math.round(Number(String(value).replace(/[^\d]/g, '')) || 0));
    this.urgentFee.set(n);
    this.changed();
  }

  // Lưu thay đổi rồi chốt: khách thấy đơn đã khóa và nút đặt hàng theo cách thanh toán
  confirmUrgent(): void {
    this.save(() => this.urgentAction('CONFIRM', 'Đã chốt đơn gấp, khách nhận thông báo trong khung chat'));
  }

  reopenUrgent(): void {
    this.urgentAction('REOPEN', 'Đã mở lại để sửa, khách thấy "Shop đang cập nhật"');
  }

  rejectUrgent(): void {
    const reason = this.rejectReason().trim();
    if (reason.length < 5) {
      this.toast.show('Nhập lý do (ít nhất 5 ký tự) để khách hiểu', 'danger');
      return;
    }
    this.rejectOpen.set(false);
    this.urgentAction('REJECT', 'Đã từ chối yêu cầu, khách nhận lý do trong khung chat', reason);
  }

  private urgentAction(action: 'CONFIRM' | 'REOPEN' | 'REJECT', message: string, reason = ''): void {
    const code = this.code();
    if (!code) return;
    this.saving.set(true);
    this.api.urgentAction(code, action, reason).subscribe({
      next: () => {
        this.saving.set(false);
        this.toast.show(message);
        this.load(code);
      },
      error: (err: ApiError) => {
        this.saving.set(false);
        this.toast.show(err.message, 'danger');
        this.load(code);
      },
    });
  }

  private linkKey(d: IDraft): string {
    return [d.status, d.payFailedAt || '', d.payment?.code || '', d.orderCode || ''].join('|');
  }

  // UC-OPS-02 6b: cổng giả lập, khách báo đã trả thì nhân viên xác nhận (API-217); thành công thì đơn được tạo.
  // Tạo đơn không hoàn tác được nên hỏi lại trước
  confirmPaid(paymentCode: string): void {
    const amount = this.draft()?.payment?.amount;
    this.confirmBox
      .ask({
        title: 'Xác nhận khách đã thanh toán?',
        message: `Chỉ xác nhận khi khách đã chuyển ${amount ? amount.toLocaleString('vi-VN') + 'đ ' : ''}cho giao dịch ${paymentCode}. Hệ thống tạo đơn ngay và không hoàn tác được.`,
        okText: 'Xác nhận và tạo đơn',
      })
      .then((ok) => {
        if (ok) this.doConfirmPaid(paymentCode);
      });
  }

  private doConfirmPaid(paymentCode: string): void {
    const code = this.code()!;
    this.saving.set(true);
    this.api.confirmPayment(paymentCode).subscribe({
      next: (r) => {
        this.saving.set(false);
        this.toast.show(r.status === 'SUCCESS' ? `Đã xác nhận thanh toán, tạo đơn ${r.orderCode}` : r.failMessage || 'Không tạo được đơn, tiền đã được hoàn', r.status === 'SUCCESS' ? 'success' : 'danger');
        this.load(code);
      },
      error: (err: ApiError) => {
        this.saving.set(false);
        this.toast.show(err.message, 'danger');
        this.load(code);
      },
    });
  }

  // Mẫu tin nhắn mã đơn và thông tin đơn gửi khách sau khi thành đơn
  orderMessage(): string {
    const o = this.draft()?.order;
    if (!o) return '';
    const vnd = (n: number) => n.toLocaleString('vi-VN') + 'đ';
    const day = o.expectedDeliveryDate ? new Date(o.expectedDeliveryDate + 'T00:00:00').toLocaleDateString('vi-VN') : '';
    return `Soulprint đã tạo đơn ${o.code} cho bạn. Tổng ${vnd(o.total)}${o.paidAmount ? `, đã thanh toán ${vnd(o.paidAmount)}` : ''}${o.remainingAmount ? `, thu khi giao ${vnd(o.remainingAmount)}` : ''}.${day ? ` Dự kiến giao ${day}.` : ''} Bạn tra cứu đơn tại ${location.origin}/tra-cuu-don.`;
  }

  copyOrderMessage(): void {
    navigator.clipboard?.writeText(this.orderMessage()).then(
      () => this.toast.show('Đã sao chép tin nhắn'),
      () => this.toast.show('Trình duyệt không cho sao chép', 'danger'),
    );
  }

  copyLink(): void {
    const l = this.link() || (this.draft()?.paymentUrl ? { paymentUrl: this.draft()!.paymentUrl! } : null);
    if (l) navigator.clipboard?.writeText(location.origin + l.paymentUrl).then(() => this.toast.show('Đã sao chép liên kết thanh toán'));
  }

  remove(): void {
    const code = this.code();
    if (!code) return;
    this.api.deleteDraft(code).subscribe({
      next: () => {
        this.toast.show(`Đã xóa đơn nháp #${code}`);
        this.router.navigate(['/quan-tri/don-nhap']);
      },
      error: (err: ApiError) => this.toast.show(err.message, 'danger'),
    });
  }

  // ===== Khách hàng =====

  onCustSearch(v: string): void {
    this.custQuery.set(v);
    this.custSearch$.next(v.trim());
  }

  pickCustomer(c: ICustomerRow): void {
    this.prevCustomer.set(null);
    this.customerUserId.set(c._id);
    this.customer.set({ fullName: c.fullName, phone: c.phone || '', ...(c.email ? { email: c.email } : {}) });
    this.customerOrders.set(c.orderCount || 0);
    this.custResults.set([]);
    this.custQuery.set('');
    this.newCustomer.set(false);
    this.loadAddresses(c._id);
    this.changed();
  }

  private loadAddresses(id: string): void {
    if (!this.auth.can('KHACH_HANG.XEM')) return;
    this.api.getCustomer(id).subscribe({
      next: (d) => {
        this.addresses.set(d.addresses.map((a) => ({ ...a, _id: a._id })));
        this.customerOrders.set(d.orderCount);
      },
      error: () => this.addresses.set([]),
    });
  }

  setNewCust(key: string, v: string): void {
    this.newCust.update((c) => ({ ...c, [key]: v }));
  }

  useNewCustomer(): void {
    const c = this.newCust();
    const phone = c.phone.replace(/[\s.]/g, '');
    this.newCustPhoneTouched.set(true);
    if (c.fullName.trim().length < 2 || !/^0\d{9}$/.test(phone)) {
      this.toast.show('Nhập họ tên và số điện thoại 10 số', 'danger');
      return;
    }
    this.prevCustomer.set(null);
    this.customerUserId.set(null);
    this.addresses.set([]);
    this.customerOrders.set(0);
    this.customer.set({ fullName: c.fullName.trim(), phone, ...(c.email.trim() ? { email: c.email.trim() } : {}) });
    this.newCustomer.set(false);
    this.changed();
  }

  // Không lưu ngay: đơn nháp chỉ đổi khách khi đã chọn khách mới (trước đây xóa và tự lưu nên mất khách).
  // Đơn gấp gắn với khách gửi yêu cầu nên không có nút Đổi (server cũng chặn)
  clearCustomer(): void {
    const c = this.customer();
    if (!c || this.isUrgent()) return;
    this.prevCustomer.set({ userId: this.customerUserId(), customer: c, orders: this.customerOrders(), addresses: this.addresses() });
    this.customerUserId.set(null);
    this.customer.set(null);
  }

  restoreCustomer(): void {
    const p = this.prevCustomer();
    if (!p) return;
    this.customerUserId.set(p.userId);
    this.customer.set(p.customer);
    this.customerOrders.set(p.orders);
    this.addresses.set(p.addresses);
    this.prevCustomer.set(null);
    this.newCustomer.set(false);
    this.custResults.set([]);
    this.custQuery.set('');
  }

  // ===== Sản phẩm =====

  onProdSearch(v: string): void {
    this.prodQuery.set(v);
    this.prodSearch$.next(v.trim());
  }

  private loadProduct(slug: string | null, then?: (p: IProductDetail) => void): void {
    if (!slug) return;
    const cached = Object.values(this.productInfo()).find((p) => p.slug === slug);
    if (cached) {
      then?.(cached);
      return;
    }
    this.products.getProduct(slug).subscribe({
      next: (p) => {
        this.productInfo.update((m) => ({ ...m, [p._id]: p }));
        then?.(p);
      },
      error: (err: ApiError) => this.toast.show(err.message, 'danger'),
    });
  }

  addProduct(p: IProduct): void {
    this.prodResults.set([]);
    this.prodQuery.set('');
    this.loadProduct(p.slug, (d) => {
      const v = d.variants.find((x) => x.stock > 0) || d.variants[0];
      if (!v) return;
      this.itemsArray.push(this.lineGroup({ productId: d._id, variantSku: v.sku, quantity: 1, personalization: null }));
    });
  }

  removeLine(i: number): void {
    this.itemsArray.removeAt(i);
  }

  infoOf(i: number): IProductDetail | null {
    return this.productInfo()[this.itemsArray.at(i).value.productId] || null;
  }

  quoteLine(i: number) {
    return this.quote()?.items[i] || null;
  }

  personalizeProduct(i: number): IPersonalizeProduct | null {
    const p = this.infoOf(i);
    if (!p) return null;
    return { _id: p._id, name: p.name, slug: p.slug, image: p.images[0] ?? null, axis: p.axis, personalization: p.personalization, stickerSets: p.stickerSets };
  }

  openPersonalize(i: number): void {
    this.personalizeIndex.set(i);
    this.dialog.set('personalize');
  }

  applyPersonalize(r: PersonalizeResult): void {
    const i = this.personalizeIndex()!;
    this.itemsArray.at(i).patchValue({ personalization: r.personalization, ...(r.variantSku ? { variantSku: r.variantSku } : {}) });
    this.dialog.set(null);
  }

  // ===== Giao hàng, gói quà, giảm giá, thanh toán, thẻ =====

  saveShipping(s: DraftShipping): void {
    this.shipping.set(s);
    this.dialog.set(null);
    this.changed();
  }

  applyGift(g: GiftWrapRequest): void {
    this.giftWrap.set(g);
    this.dialog.set(null);
    this.changed();
  }

  // Mẫu gói quà đang áp dụng có còn là mẫu khách chọn lúc gửi yêu cầu gấp không
  isCustomerWrap(): boolean {
    const a = this.quote()?.giftWrap;
    const b = this.draft()?.customerGiftWrap;
    if (!a || !b) return false;
    if (a.source === 'GOI_Y' || b.source === 'GOI_Y') return a.source === b.source && a.templateId === b.templateId;
    return a.paper.code === b.paper.code && a.ribbon.code === b.ribbon.code && a.card.code === b.card.code && (a.message || '') === (b.message || '');
  }

  removeGift(): void {
    this.giftWrap.set(null);
    this.changed();
  }

  setVouchers(codes: string[]): void {
    this.voucherCodes.set(codes);
    this.changed();
  }

  setOption(key: string): void {
    this.option.set(key);
    this.changed();
  }

  addTag(): void {
    const t = this.tagInput().trim();
    if (!t || this.tags().includes(t) || this.tags().length >= 10) return;
    this.tags.update((l) => [...l, t]);
    this.tagInput.set('');
    this.changed();
  }

  removeTag(t: string): void {
    this.tags.update((l) => l.filter((x) => x !== t));
    this.changed();
  }

  shippingText(): string {
    const s = this.shipping();
    if (!s) return '';
    const a = s.shippingAddress;
    return `${a.recipientName} | ${a.phone} | ${a.street}, ${a.ward}, ${a.province}${s.recipientType === 'OTHER' && s.deliveryDate ? ' | giao ' + s.deliveryDate.split('-').reverse().join('/') + ' ' + s.deliveryWindow : ''}`;
  }

  optionText(key: string, due: number): string {
    return key === 'DEPOSIT_COD' ? `${OPTION_LABEL[key]} (cọc ${due.toLocaleString('vi-VN')}đ)` : OPTION_LABEL[key];
  }
}
