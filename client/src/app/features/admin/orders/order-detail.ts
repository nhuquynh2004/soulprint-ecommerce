import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { phoneError } from '../../../shared/form-validators';
import { watchOrderVersion } from '../../../services/order-sync';
import { ChatDockService } from '../../../services/chat-dock';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, debounceTime, of, switchMap } from 'rxjs';
import { ActivatedRoute, Router } from '@angular/router';
import { AdminOrderApiService } from '../../../services/admin-order-apiservice';
import { AuthService } from '../../../services/auth';
import { ToastService } from '../../../services/toast';
import { DvhcApiService } from '../../../services/dvhc-apiservice';
import { ProductApiService } from '../../../services/product-apiservice';
import { IProduct, IProductDetail } from '../../../classes/product';
import { IPersonalization, IPersonalizeProduct, toCartPersonalization } from '../../../classes/cart';
import { PersonalizeResult } from '../../../shared/personalize-dialog/personalize-dialog';
import { ApiError } from '../../../classes/api-error';
import {
  CARRIERS, DISPOSAL_METHODS, EXCEPTION_TYPES, IActivity, IAdminOrder, IAdminOrderItem, IMentionable, IPackingSlip, ISwapPreview, PRIORITY_LABEL, REFUSAL_REASONS,
  UNFULFILLABLE_REASONS,
} from '../../../classes/admin-order';
import { ORDER_STATUS_LABEL } from '../../../classes/order';
import { DELIVERY_SLOTS } from '../../../classes/aftersales';
import { RowMenuItem } from '../shared/row-menu/row-menu';

// So khớp tên không dấu, không phân biệt hoa thường (gõ "@quyen" ra "Quyên")
const foldVn = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

// Dòng trong bảng Sửa sản phẩm trong đơn: itemId null là món thêm; dirty: đã sửa so với lúc đặt
interface EditRow {
  key: string;
  itemId: string | null;
  product: IProductDetail | null;
  name: string;
  image: string | null;
  variantSku: string;
  variantName: string;
  quantity: number;
  personalization: IPersonalization | null;
  removed: boolean;
  dirty: boolean;
  asked: boolean;
}

type DialogKind = 'confirm' | 'finish' | 'ship' | 'deliver' | 'cod' | 'exception' | 'unfulfillable' | 'ufCancel' | 'ufClear' | 'refused' | 'shelf' | 'dispose';

const MAX_FILES = 3;

// SCR-48 Chi tiết đơn (UC-OPS-01 bước 5-10, OPS-03, OPS-04, OPS-05, OPS-06): tiêu đề có nhãn trạng thái, thanh toán,
// ưu tiên; thanh tiến trình gọn chỉ để xem (chuyển trạng thái bằng nút chính); khối Sản phẩm với In/Khắc nổi bật;
// Ghi chú của khách; Khách hàng có nút sao chép; Thanh toán; Thẻ; Lịch sử (ô ghi chú + đính kèm, dòng thời gian).
// Nút và hộp thoại lấy từ adminActions server tính theo trạng thái và quyền (client không tự suy luận).
@Component({
  selector: 'app-order-detail',
  standalone: false,
  templateUrl: './order-detail.html',
  styleUrl: './order-detail.scss',
})
export class OrderDetail {
  private readonly api = inject(AdminOrderApiService);
  protected readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dvhc = inject(DvhcApiService);
  private readonly products = inject(ProductApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly carriers = CARRIERS;
  readonly refusalReasons = REFUSAL_REASONS;
  readonly unfulfillableReasons = UNFULFILLABLE_REASONS;
  readonly disposalMethods = DISPOSAL_METHODS;
  readonly priorityLabel = PRIORITY_LABEL;

  readonly order = signal<IAdminOrder | null>(null);
  readonly loading = signal(true);
  readonly errMessage = signal('');
  readonly busy = signal(false);
  readonly dialog = signal<DialogKind | null>(null);
  readonly formError = signal('');
  readonly slips = signal<IPackingSlip[] | null>(null);

  // Hộp thoại xác nhận (6a, 6b)
  readonly checks = signal<string[]>([]);
  // Giao cho vận chuyển (bước 8)
  readonly carrier = signal('');
  readonly trackingCode = signal('');
  // Giao thành công (bước 9)
  readonly deliveredAt = signal('');
  readonly codCollected = signal<number | null>(null);
  readonly codReason = signal('');
  // Xử lý ngoại lệ (OPS-03)
  private readonly dock = inject(ChatDockService);
  readonly exType = signal('');
  readonly exReason = signal('');
  readonly exAddress = signal({ recipientName: '', phone: '', province: '', ward: '', street: '', noteForShipper: '' });
  readonly exPhoneTouched = signal(false);
  readonly exPhoneErr = computed(() => phoneError(this.exAddress().phone, this.exPhoneTouched()));
  // Đổi kiểu nhận (2a): sang Giao người nhận cần ngày, khung giờ; số trả thêm tính trước ở server
  readonly exRecipient = signal<'SELF' | 'OTHER'>('SELF');
  readonly exDeliveryDate = signal('');
  readonly exDeliveryWindow = signal('');
  readonly exSwitchPreview = signal<ISwapPreview | null>(null);
  readonly exSwitching = computed(() => this.exType() === 'SUA_THONG_TIN' && !!this.order() && this.exRecipient() !== this.order()!.recipientType);
  readonly deliverySlots = DELIVERY_SLOTS;
  // Sửa sản phẩm trong đơn (2d): bảng các dòng như giỏ, đổi, thêm, bỏ nhiều món rồi xem bù trừ BR-47 1 lần
  readonly editRows = signal<EditRow[]>([]);
  readonly swapTarget = signal(''); // key dòng đang tìm sản phẩm để đổi; rỗng là thêm món mới
  readonly swapQuery = signal('');
  readonly swapResults = signal<IProduct[]>([]);
  readonly pzRowKey = signal(''); // dòng đang mở hộp cá nhân hóa
  readonly pzRow = computed(() => this.editRows().find((r) => r.key === this.pzRowKey()) || null);
  readonly swapPreview = signal<ISwapPreview | null>(null);
  readonly swapPreviewError = signal('');
  private readonly swapSearch$ = new Subject<string>();
  private readonly swapQuote$ = new Subject<void>();
  readonly exAmount = signal<number | null>(null);
  readonly exVoucherValue = signal<number | null>(50000);
  readonly exVoucherDays = signal(30);
  readonly exDate = signal('');
  readonly provinces = signal<string[]>([]);
  readonly wards = signal<string[]>([]);
  // Không thể thực hiện (OPS-06): chọn món rồi báo khách; hủy kèm voucher xin lỗi; gỡ đánh dấu
  readonly ufItems = signal<string[]>([]);
  readonly ufReasonCode = signal('HET_HANG');
  readonly ufReason = signal('');
  readonly ufMessage = signal(UNFULFILLABLE_REASONS[0].template);
  readonly ufHours = signal(48); // hạn khách trả lời 4/24/48 giờ (BR-30)
  readonly ufGift = signal(true); // tặng voucher xin lỗi QUATANG10 (BR-30)
  // Hủy ngoại lệ: nguyên nhân do Soulprint thì mặc định tặng voucher xin lỗi
  readonly exCause = signal<'SOULPRINT' | 'KHACH'>('SOULPRINT');
  readonly exGift = signal(true);
  readonly exSkipReason = signal('');
  // Khách tự hủy khi đang hỏi: không gửi voucher thì cần lý do; khách chưa kích hoạt thì sao chép tin nhắn
  readonly apologySkipReason = signal('');
  readonly chatCopy = signal<{ customerName: string; phone: string | null; draft: string } | null>(null);
  readonly ufSkipReason = signal('');
  readonly ufCancelMessage = signal('');
  readonly ufClearReason = signal('');
  // Từ chối nhận (OPS-04)
  readonly rfReason = signal('KHONG_DONG_Y_NHAN');
  readonly rfFee = signal<number | null>(30000);
  readonly rfNote = signal('');
  // Lưu kho (OPS-05)
  readonly shelf = signal('');
  readonly disposeMethod = signal('');
  readonly disposeChecked = signal(false);
  // Ghi chú, thẻ
  readonly noteText = signal('');
  readonly noteFiles = signal<{ name: string; dataUrl: string; size: number }[]>([]);
  // Gắn thẻ @nhân viên: danh sách gợi ý, từ đang gõ sau @, người đã chọn
  readonly staffList = signal<IMentionable[]>([]);
  readonly mentionQuery = signal<string | null>(null);
  readonly mentioned = signal<IMentionable[]>([]);
  readonly mentionOptions = computed(() => {
    const q = this.mentionQuery();
    if (q === null) return [];
    const key = foldVn(q);
    return this.staffList()
      .filter((s) => !this.mentioned().some((m) => m._id === s._id) && foldVn(s.fullName).includes(key))
      .slice(0, 6);
  });
  readonly tagInput = signal('');
  readonly previewItem = signal<IAdminOrderItem | null>(null);

  // Đơn đang có yêu cầu chờ duyệt thì người cần duyệt không chọn được loại đặc biệt (server cũng chặn 409)
  readonly approvalLocked = computed(() => !!this.order()?.approvalRequest && !this.auth.can('DON_HANG.NGOAI_LE_DAC_BIET'));
  readonly exceptionTypes = computed(() =>
    EXCEPTION_TYPES.filter((t) => this.order()?.exceptionTypes.includes(t.key) && !(this.approvalLocked() && this.needsApproval('EXCEPTION', { type: t.key, cause: 'KHACH' }))),
  );
  readonly activeItems = computed(() => (this.order()?.items || []).filter((it) => (it.fulfillStatus || 'BINH_THUONG') === 'BINH_THUONG'));
  readonly personalizedItems = computed(() => (this.order()?.items || []).filter((it) => it.isPersonalized && it.personalizationText));
  readonly confirmReady = computed(() => {
    const o = this.order();
    if (!o) return false;
    return o.requiredChecks.every((k) => this.checks().includes(k)) && o.confirmChecks.every((c) => c.ok);
  });
  readonly codDiff = computed(() => {
    const o = this.order();
    const v = this.codCollected();
    return o && v !== null ? v - o.codDue : 0;
  });

  // Đơn vừa đổi ở nơi khác trong lúc nhân viên đang mở hộp thoại
  readonly staleBanner = signal(false);
  // Ô có lỗi từ server, để báo ngay dưới ô
  readonly formField = signal('');
  // Hỏi lại trước khi hủy thay đổi chờ thanh toán, khách có thể đang mở liên kết
  readonly pendingCancelAsk = signal(false);

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((p) => this.load(p.get('code')!));
    // NFR-REL-06: khách hủy, sửa, trả thêm hoặc nhân viên khác xử lý thì tự tải lại
    watchOrderVersion({
      check: () => this.api.getOrderVersion(this.order()!.code),
      current: () => this.order()?.version,
      changed: () => {
        if (this.busy()) return; // thao tác của chính nhân viên đang chạy, xong sẽ nhận đơn mới
        if (this.dialog() || this.swapConfirm() || this.chatCopy() || this.pendingCancelAsk()) this.staleBanner.set(true);
        else this.load(undefined, true);
      },
      destroyRef: this.destroyRef,
    });
    this.swapSearch$
      .pipe(
        debounceTime(300),
        switchMap((q) => (q.trim().length >= 2 ? this.products.getProducts({ q: q.trim(), pageSize: 8 }).pipe(catchError(() => of({ items: [] as IProduct[] }))) : of({ items: [] as IProduct[] }))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((r) => this.swapResults.set((r as { items: IProduct[] }).items));
    // Tính trước tiền khi đổi lựa chọn (API-96 preview, không ghi gì)
    this.swapQuote$
      .pipe(
        debounceTime(250),
        switchMap(() => {
          const o = this.order();
          const body = this.swapChanges();
          if (!o || !body) return of(null);
          return this.api.previewSwap(o.code, body).pipe(
            catchError((err: ApiError) => {
              this.swapPreviewError.set(err.message);
              return of(null);
            }),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((p) => {
        this.swapPreview.set(p);
        if (p) this.swapPreviewError.set('');
      });
  }

  // announce: đơn đổi ở nơi khác, chỉ báo khi phiên bản thật sự khác
  load(code = this.order()?.code || '', announce = false): void {
    this.errMessage.set('');
    this.staleBanner.set(false);
    const before = this.order()?.version;
    this.api.getOrder(code).subscribe({
      next: (o) => {
        this.order.set(o);
        if (announce && before && o.version !== before) this.toast.show('Đơn vừa được cập nhật', 'info');
        this.loading.set(false);
      },
      error: (err: ApiError) => {
        this.errMessage.set(err.status === 404 ? 'Không tìm thấy đơn hàng' : err.message);
        this.loading.set(false);
      },
    });
  }

  // ===== Hiển thị =====

  priorityClass(o: IAdminOrder): string {
    return o.priority === 'KHAN_CAP' ? 'urgent' : o.priority === 'CAN_CHU_Y' ? 'attention' : 'normal';
  }

  // Thanh tiến trình chỉ để xem, gợi ý bấm nút chính màu xanh ở đầu trang
  stepHint(o: IAdminOrder): string {
    const n = o.adminActions.next;
    if (!n) return '';
    return `Bấm nút “${n.label}” ở đầu trang để ${n.to === 'DANG_VAN_CHUYEN' ? 'nhập đơn vị vận chuyển và mã vận đơn' : n.to === 'DA_GIAO' ? 'ghi nhận giao thành công' : o.orderStatus === 'CHO_XAC_NHAN' ? 'kiểm tra và xác nhận đơn' : 'hoàn tất cá nhân hóa'} (${ORDER_STATUS_LABEL[n.to]})`;
  }

  // Khối Khách hàng: tài khoản chờ kích hoạt chưa là thành viên
  memberLine(o: IAdminOrder): string {
    const u = o.customerUser;
    if (!u) return '';
    const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString('vi-VN', { month: '2-digit', year: 'numeric' }) : '');
    const head = u.isMember ? `Thành viên từ ${fmt(u.memberSince)}` : `Chưa là thành viên${u.firstOrderAt ? ' | mua lần đầu ' + fmt(u.firstOrderAt) : ''}`;
    return `${head} | ${u.orderCount} đơn | đã chi ${u.totalSpent.toLocaleString('vi-VN')}đ`;
  }

  openNext(): void {
    const o = this.order()!;
    const to = o.adminActions.next?.to;
    if (!to) return;
    if (o.orderStatus === 'CHO_XAC_NHAN') this.open('confirm');
    else if (to === 'DANG_CHUAN_BI') this.open('finish');
    else if (to === 'DANG_VAN_CHUYEN') this.open('ship');
    else if (to === 'DA_GIAO') this.open('deliver');
  }

  open(kind: DialogKind): void {
    const o = this.order()!;
    this.formError.set('');
    this.formField.set('');
    if (kind === 'confirm') this.checks.set([]);
    if (kind === 'ship') {
      this.carrier.set(o.carrier || '');
      this.trackingCode.set(o.trackingCode || '');
    }
    if (kind === 'deliver') {
      this.deliveredAt.set(this.localNow());
      this.codCollected.set(o.codDue > 0 ? o.codDue : null);
      this.codReason.set('');
    }
    if (kind === 'cod') this.codCollected.set(o.codDue);
    if (kind === 'exception') this.pickException(this.exceptionTypes()[0]?.key || '');
    if (kind === 'unfulfillable') {
      this.ufHours.set(48);
      this.ufItems.set(this.activeItems().length === 1 ? [this.activeItems()[0]._id] : []);
      this.setUfReason('HET_HANG');
    }
    if (kind === 'ufCancel') {
      this.ufGift.set(true);
      this.ufSkipReason.set('');
      this.ufCancelMessage.set(`Xin lỗi bạn, Soulprint không thực hiện được đơn ${o.code}: ${o.unfulfillable?.reason || ''}.`);
    }
    if (kind === 'ufClear') this.ufClearReason.set('');
    if (kind === 'refused') {
      this.rfReason.set('KHONG_DONG_Y_NHAN');
      this.rfFee.set(o.shippingFee || 30000);
      this.rfNote.set('');
    }
    if (kind === 'shelf') this.shelf.set(o.storageShelf || '');
    if (kind === 'dispose') {
      this.disposeMethod.set('');
      this.disposeChecked.set(false);
    }
    this.dialog.set(kind);
  }

  close(): void {
    this.dialog.set(null);
  }

  private localNow(): string {
    const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
  }

  toggleCheck(key: string): void {
    this.checks.update((c) => (c.includes(key) ? c.filter((x) => x !== key) : [...c, key]));
  }

  copy(text: string | undefined | null, label: string): void {
    if (!text) return;
    navigator.clipboard?.writeText(text).then(
      () => this.toast.show(`Đã sao chép ${label}`),
      () => this.toast.show('Trình duyệt không cho sao chép', 'danger'),
    );
  }

  addressText(o: IAdminOrder): string {
    const a = o.shippingAddress;
    return [a.street, a.ward, a.province].filter(Boolean).join(', ');
  }

  menu(): RowMenuItem[] {
    const a = this.order()!.adminActions;
    const m: RowMenuItem[] = [];
    // Xử lý ngoại lệ và Không thể thực hiện là nút ngoài, menu chỉ còn thao tác ít dùng
    if (a.refused) m.push({ key: 'refused', label: 'Ghi nhận từ chối nhận hàng', icon: 'x-circle', danger: true });
    if (a.shelf) m.push({ key: 'shelf', label: 'Ghi vị trí kệ', icon: 'archive' });
    if (a.dispose) m.push({ key: 'dispose', label: 'Tiêu hủy hàng lưu kho', icon: 'trash', danger: true });
    return m;
  }

  // ===== Gửi API =====

  // ===== Ngoại lệ đặc biệt cần duyệt (BR-48) =====
  readonly approvalReason = signal('');

  // Cùng quy tắc với server (opsRules.specialOf): có quyền thì làm thẳng, không thì gửi Quản trị duyệt
  needsApproval(api: 'EXCEPTION' | 'UNFULFILLABLE', body: Record<string, unknown>): boolean {
    if (this.auth.can('DON_HANG.NGOAI_LE_DAC_BIET')) return false;
    const o = this.order();
    const skip = !!(body['apologyVoucher'] as { skip?: boolean } | undefined)?.skip;
    if (api === 'UNFULFILLABLE') return skip;
    const type = body['type'];
    if (type === 'CAP_VOUCHER' || type === 'HOAN_TIEN') return true;
    if (type === 'HUY_DON') return !!o?.personalizationStartedAt || (body['cause'] !== 'KHACH' && skip);
    return false;
  }

  // Gửi thao tác: cần duyệt thì gửi yêu cầu (API-222), không thì làm ngay
  private runOrApprove(api: 'EXCEPTION' | 'UNFULFILLABLE', body: Record<string, unknown>, call: ReturnType<AdminOrderApiService['getOrder']>, ok: string): void {
    const o = this.order()!;
    if (this.needsApproval(api, body)) this.run(this.api.requestApproval(o.code, api, body), 'Đã gửi Quản trị duyệt, bạn nhận kết quả ở chuông Nhắc đến bạn');
    else this.run(call, ok);
  }

  // Exception đặc biệt: nút chính ghi "Gửi Quản trị duyệt" khi thiếu quyền
  exceptionBody(): Record<string, unknown> {
    const body: Record<string, unknown> = { type: this.exType() };
    if (this.exType() === 'HUY_DON') {
      body['cause'] = this.exCause();
      if (this.exCause() === 'SOULPRINT' && !this.exGift()) body['apologyVoucher'] = { skip: true };
    }
    return body;
  }

  decideApproval(decision: 'DUYET' | 'TU_CHOI'): void {
    const r = this.order()?.approvalRequest;
    if (!r) return;
    this.run(this.api.decideApproval(r._id, decision, this.approvalReason().trim()), decision === 'DUYET' ? 'Đã duyệt và thực hiện' : 'Đã từ chối yêu cầu');
    this.approvalReason.set('');
  }

  // API-224: chép đơn này vào đơn nháp mới
  copyToDraft(): void {
    const o = this.order()!;
    this.busy.set(true);
    this.api.copyToDraft(o.code).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.toast.show(r.skipped.length ? `Đã tạo đơn nháp ${r.draftCode}. Không chép được: ${r.skipped.join(', ')}` : `Đã chép vào đơn nháp ${r.draftCode}`, r.skipped.length ? 'info' : 'success');
        this.router.navigate(['/quan-tri/don-nhap', r.draftCode]);
      },
      error: (err: ApiError) => {
        this.busy.set(false);
        this.toast.show(err.message, 'danger');
      },
    });
  }

  private run(req: ReturnType<AdminOrderApiService['getOrder']>, ok: string): void {
    this.busy.set(true);
    this.formError.set('');
    req.subscribe({
      next: (o) => {
        this.busy.set(false);
        this.order.set(o);
        this.staleBanner.set(false);
        this.dialog.set(null);
        this.pendingCancelAsk.set(false);
        this.toast.show(ok);
      },
      error: (err: ApiError) => {
        this.busy.set(false);
        // 6Ea, AC4: trạng thái vừa đổi (khách hủy) - báo và tải lại
        if (err.status === 409) {
          // Dữ liệu cũ (người khác vừa cập nhật): tải lại và báo rõ; gửi duyệt trùng không phải dữ liệu cũ
          this.dialog.set(null);
          this.swapConfirm.set(false);
          this.pendingCancelAsk.set(false);
          const stale = !['ALREADY_REQUESTED', 'ALREADY_PROCESSED'].includes(err.code || '');
          this.toast.show(stale ? `${err.message}. Đơn vừa được cập nhật, bạn xem lại rồi thao tác lại` : err.message, 'danger');
          this.load();
          return;
        }
        const fields = err.extra?.["fields"] as Record<string, string> | undefined;
        this.formField.set(fields ? Object.keys(fields).find((k) => fields[k]) || '' : '');
        this.formError.set(fields ? Object.values(fields).filter(Boolean)[0] || err.message : err.message);
      },
    });
  }

  confirmOrder(): void {
    const o = this.order()!;
    this.run(this.api.changeStatus(o.code, { to: o.adminActions.next!.to, checks: this.checks() }), `Đã xác nhận đơn ${o.code}`);
  }

  finishPersonalization(): void {
    const o = this.order()!;
    this.run(this.api.changeStatus(o.code, { to: 'DANG_CHUAN_BI' }), 'Đã chuyển sang Đang chuẩn bị');
  }

  ship(): void {
    const o = this.order()!;
    this.run(this.api.changeStatus(o.code, { to: 'DANG_VAN_CHUYEN', carrier: this.carrier(), trackingCode: this.trackingCode().trim() }), 'Đã giao cho vận chuyển, khách được thông báo mã vận đơn');
  }

  deliver(): void {
    const o = this.order()!;
    const body: Record<string, unknown> = { to: 'DA_GIAO', deliveredAt: this.deliveredAt() ? new Date(this.deliveredAt()).toISOString() : undefined };
    if (o.codDue > 0) {
      body['codCollected'] = this.codCollected();
      if (this.codDiff() !== 0) body['codDiscrepancyReason'] = this.codReason().trim();
    }
    this.run(this.api.changeStatus(o.code, body), this.codDiff() !== 0 ? 'Đã ghi nhận giao thành công, đơn cần đối soát COD' : 'Đã ghi nhận giao thành công');
  }

  reconcile(): void {
    const o = this.order()!;
    this.run(this.api.reconcileCod(o.code, Number(this.codCollected())), 'Đã đối soát, đơn đã thanh toán đủ');
  }

  // ===== Xử lý ngoại lệ =====

  pickException(key: string): void {
    const o = this.order()!;
    this.exType.set(key);
    this.exReason.set('');
    this.formError.set('');
    this.exCause.set('SOULPRINT');
    this.exGift.set(true);
    this.exSkipReason.set('');
    if (key === 'SUA_THONG_TIN') {
      const a = o.shippingAddress;
      this.exAddress.set({ recipientName: a.recipientName, phone: a.phone, province: a.province, ward: a.ward, street: a.street, noteForShipper: a.noteForShipper || '' });
      this.exRecipient.set(o.recipientType);
      this.exDeliveryDate.set('');
      this.exDeliveryWindow.set('');
      this.exSwitchPreview.set(null);
      this.loadProvinces();
      this.loadWards(a.province);
    }
    if (key === 'DOI_SAN_PHAM') this.startEdit();
    if (key === 'HOAN_TIEN') this.exAmount.set(o.refundable);
    if (key === 'GIA_HAN') this.exDate.set(o.expectedDeliveryDate || '');
  }

  // Bảng sửa: mỗi món chưa hoàn tiền 1 dòng; tải chi tiết sản phẩm để chọn phân loại, cá nhân hóa
  private startEdit(): void {
    const asked = this.order()!.unfulfillable?.itemIds || [];
    this.editRows.set(
      this.activeItems().map((it) => ({
        key: it._id, itemId: it._id, product: null, name: it.name, image: it.image, variantSku: it.variantSku, variantName: it.variantName, quantity: it.quantity,
        personalization: it.personalization ? toCartPersonalization(it.personalization) : null, removed: false, dirty: false, asked: asked.includes(it._id),
      })),
    );
    this.swapTarget.set('');
    this.swapQuery.set('');
    this.swapResults.set([]);
    this.swapPreview.set(null);
    this.swapPreviewError.set('');
    for (const it of this.activeItems()) {
      if (!it.slug) continue;
      this.products.getProduct(it.slug).subscribe({ next: (p) => this.patchRow(it._id, { product: p }, false), error: () => undefined });
    }
  }

  private patchRow(key: string, patch: Partial<EditRow>, dirty = true): void {
    this.editRows.update((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch, dirty: r.dirty || dirty } : r)));
    if (dirty) this.requoteSwap();
  }

  editedCount(): number {
    return this.editRows().filter((r) => !r.removed).length;
  }

  // 2dEc: đơn phải còn ít nhất 1 món
  toggleRemove(r: EditRow): void {
    if (!r.itemId) {
      this.editRows.update((rows) => rows.filter((x) => x.key !== r.key));
      this.requoteSwap();
      return;
    }
    if (!r.removed && this.editedCount() <= 1) return;
    if (this.swapTarget() === r.key) this.swapTarget.set('');
    this.patchRow(r.key, { removed: !r.removed }, false);
    this.requoteSwap();
  }

  // "Đổi sản phẩm" ở 1 dòng: ô tìm chuyển sang đổi dòng đó; bấm lại để quay về thêm món
  targetRow(key: string): void {
    this.swapTarget.set(this.swapTarget() === key ? '' : key);
    this.swapQuery.set('');
    this.swapResults.set([]);
  }

  targetName(): string {
    return this.editRows().find((r) => r.key === this.swapTarget())?.name || '';
  }

  searchSwap(q: string): void {
    this.swapQuery.set(q);
    this.swapActive.set(-1);
    this.swapSearch$.next(q);
  }

  // Chọn kết quả bằng phím mũi tên, Enter; Esc đóng danh sách
  readonly swapActive = signal(-1);
  swapKey(e: KeyboardEvent): void {
    const n = this.swapResults().length;
    if (!n) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.swapActive.update((i) => (e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n));
    } else if (e.key === 'Enter' && this.swapActive() >= 0) {
      e.preventDefault();
      this.chooseSwapProduct(this.swapResults()[this.swapActive()]);
    } else if (e.key === 'Escape') {
      this.swapResults.set([]);
    }
  }

  // Chọn kết quả tìm: đổi sản phẩm của dòng đang chọn (giữ số lượng) hoặc thêm dòng mới số lượng 1
  chooseSwapProduct(p: IProduct): void {
    this.swapResults.set([]);
    this.swapQuery.set('');
    const target = this.swapTarget();
    this.products.getProduct(p.slug).subscribe({
      next: (d) => {
        const sku = (d.variants.find((v) => v.stock > 0) || d.variants[0])?.sku || '';
        const base = { product: d, name: d.name, image: d.images[0] ?? null, variantSku: sku, variantName: '', personalization: null };
        if (target) {
          this.swapTarget.set('');
          this.patchRow(target, base);
          return;
        }
        this.editRows.update((rows) => [...rows, { ...base, key: 'new-' + Date.now(), itemId: null, quantity: 1, removed: false, dirty: true, asked: false }]);
        this.requoteSwap();
      },
      error: (err: ApiError) => this.toast.show(err.message, 'danger'),
    });
  }

  setRowVariant(r: EditRow, sku: string): void {
    this.patchRow(r.key, { variantSku: sku });
  }

  setRowQty(r: EditRow, n: number): void {
    this.patchRow(r.key, { quantity: Math.max(1, Math.min(10, Math.round(n) || 1)) });
  }

  rowPersonalizeProduct(r: EditRow): IPersonalizeProduct | null {
    const p = r.product;
    if (!p) return null;
    return { _id: p._id, name: p.name, slug: p.slug, image: p.images[0] ?? null, axis: p.axis, personalization: p.personalization, stickerSets: p.stickerSets };
  }

  rowUnitPrice(r: EditRow): number {
    const v = r.product?.variants.find((x) => x.sku === r.variantSku);
    return r.product && v ? r.product.finalPrice + (v.priceDelta || 0) : 0;
  }

  applyRowPersonalize(res: PersonalizeResult): void {
    const key = this.pzRowKey();
    this.pzRowKey.set('');
    this.patchRow(key, { personalization: res.personalization, ...(res.variantSku ? { variantSku: res.variantSku } : {}) });
  }

  personalizationText(p: IPersonalization | null): string {
    if (!p) return 'Không cá nhân hóa';
    if (p.type === 'THIET_KE') return `Thiết kế: ${p.stickers.length} sticker${p.message ? ', lời nhắn "' + p.message + '"' : ''}`;
    return p.mode === 'AO_DAU' ? `In/Khắc áo đấu: ${[p.top, p.number, p.bottom].filter(Boolean).join(' | ')}` : `In/Khắc: ${p.text}`;
  }

  // API-96 changes.lines: dòng chưa sửa chỉ gửi itemId (server giữ nguyên, giá lúc đặt); dòng bỏ không gửi
  private swapChanges(): Record<string, unknown> | null {
    const rows = this.editRows();
    if (!rows.some((r) => r.dirty || r.removed || !r.itemId)) return null;
    if (rows.some((r) => !r.removed && r.dirty && !r.variantSku)) return null;
    const lines = rows
      .filter((r) => !r.removed)
      .map((r) => (!r.dirty ? { itemId: r.itemId } : { ...(r.itemId ? { itemId: r.itemId } : {}), productId: r.product?._id, variantSku: r.variantSku, quantity: r.quantity, personalization: r.personalization }));
    return { lines };
  }

  // Tóm tắt trong hộp xác nhận
  editSummary(): string[] {
    return this.editRows().flatMap((r) => (r.removed ? [`Bỏ ${r.name}`] : !r.itemId ? [`Thêm ${r.name} x${r.quantity}`] : r.dirty ? [`Sửa ${r.name}`] : []));
  }

  private requoteSwap(): void {
    this.swapPreview.set(null);
    this.swapPreviewError.set('');
    this.swapQuote$.next();
  }

  // Thẻ "Đang hỏi khách": khách đồng ý đổi thì mở Sửa sản phẩm, ô tìm sẵn sàng đổi dòng đã đánh dấu (UC-OPS-06 5a)
  swapAskedItem(): void {
    const o = this.order()!;
    this.open('exception');
    this.pickException('DOI_SAN_PHAM');
    const first = o.unfulfillable?.itemIds.find((id) => this.activeItems().some((it) => it._id === id));
    if (first) this.swapTarget.set(first);
    if (o.unfulfillable?.reason) this.exReason.set(`Khách đồng ý đổi sản phẩm (${o.unfulfillable.reason})`);
  }

  loadProvinces(): void {
    if (this.provinces().length) return;
    this.dvhc.getProvinces().subscribe({ next: (list) => this.provinces.set(list.map((p) => p.name)), error: () => this.provinces.set([]) });
  }

  setExAddress(key: string, value: string): void {
    this.exAddress.update((a) => ({ ...a, [key]: value, ...(key === 'province' ? { ward: '' } : {}) }));
    if (key === 'province') this.loadWards(value);
  }

  loadWards(province: string): void {
    this.wards.set([]);
    this.dvhc.getProvinces().subscribe((list) => {
      const p = list.find((x) => x.name === province);
      if (p) this.dvhc.getWards(p.code).subscribe((w) => this.wards.set(w.map((x) => x.name)));
    });
  }

  // Đổi kiểu nhận: sang Giao người nhận thì xóa người nhận để nhập người được tặng; về Giao cho tôi thì điền người mua
  setExRecipient(t: 'SELF' | 'OTHER'): void {
    const o = this.order()!;
    this.exRecipient.set(t);
    this.exSwitchPreview.set(null);
    if (t === o.recipientType) {
      const a = o.shippingAddress;
      this.exAddress.update((x) => ({ ...x, recipientName: a.recipientName, phone: a.phone }));
      return;
    }
    this.exAddress.update((x) => (t === 'OTHER' ? { ...x, recipientName: '', phone: '' } : { ...x, recipientName: o.customer.fullName, phone: o.customer.phone }));
    this.exPhoneTouched.set(false);
    this.api.previewRecipient(o.code, t).subscribe({
      next: (p) => this.exSwitchPreview.set(p),
      error: (err: ApiError) => this.formError.set(err.message),
    });
  }

  // Đổi sản phẩm: hộp xác nhận nêu rõ thu thêm, hoàn tiền hay đổi số thu khi giao trước khi lưu (BR-47)
  readonly swapConfirm = signal(false);

  submitException(): void {
    const o = this.order()!;
    const type = this.exType();
    if (type === 'DOI_SAN_PHAM' && !this.swapConfirm()) {
      this.swapConfirm.set(true);
      return;
    }
    this.swapConfirm.set(false);
    const body: Record<string, unknown> = { type, reason: this.exReason().trim() };
    if (type === 'SUA_THONG_TIN') {
      body['changes'] = this.exSwitching()
        ? { shippingAddress: this.exAddress(), recipientType: this.exRecipient(), deliveryDate: this.exDeliveryDate(), deliveryWindow: this.exDeliveryWindow() }
        : { shippingAddress: this.exAddress() };
    }
    if (type === 'DOI_SAN_PHAM') body['changes'] = this.swapChanges() || {};
    if (type === 'HOAN_TIEN') body['amount'] = Number(this.exAmount());
    if (type === 'CAP_VOUCHER') body['voucher'] = { value: Number(this.exVoucherValue()), validDays: Number(this.exVoucherDays()) };
    if (type === 'GIA_HAN') body['expectedDeliveryDate'] = this.exDate();
    if (type === 'HUY_DON') {
      body['cause'] = this.exCause();
      if (this.exCause() === 'SOULPRINT') body['apologyVoucher'] = this.exGift() ? {} : { skip: true, reason: this.exSkipReason().trim() };
    }
    const extra = (type === 'DOI_SAN_PHAM' ? this.swapPreview() : this.exSwitching() ? this.exSwitchPreview() : null)?.settlement.extra || 0;
    this.runOrApprove('EXCEPTION', body, this.api.addException(o.code, body), extra > 0 ? `Đã tạo yêu cầu khách trả thêm ${extra.toLocaleString('vi-VN')}đ, gửi mã QR cho khách` : 'Đã lưu can thiệp, ghi vào lịch sử thao tác');
  }

  // ===== Không thể thực hiện =====

  setUfReason(code: string): void {
    this.ufReasonCode.set(code);
    this.ufMessage.set(UNFULFILLABLE_REASONS.find((r) => r.key === code)?.template || '');
  }

  toggleUfItem(id: string): void {
    this.ufItems.update((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  }

  // Bước 1-4: báo khách, đơn "Đang hỏi khách"
  submitUnfulfillable(): void {
    const o = this.order()!;
    this.run(
      this.api.markUnfulfillable(o.code, { action: 'ASK', itemIds: this.ufItems(), reasonCode: this.ufReasonCode(), reason: this.ufReason().trim(), message: this.ufMessage().trim(), responseHours: this.ufHours() }),
      `Đã báo khách, hạn trả lời ${this.ufHours()} giờ. Nhắn khách hỏi có muốn đổi sản phẩm không`,
    );
  }

  // Bước 6-8: hủy toàn đơn, hoàn 100% đã trả, voucher xin lỗi (bỏ tặng cần lý do - 6a)
  submitUfCancel(): void {
    const o = this.order()!;
    const apologyVoucher = this.ufGift() ? {} : { skip: true, reason: this.ufSkipReason().trim() };
    const body = { action: 'CANCEL', message: this.ufCancelMessage().trim(), apologyVoucher };
    this.runOrApprove('UNFULFILLABLE', body, this.api.markUnfulfillable(o.code, body), 'Đã hủy đơn, khách nhận thông báo hoàn tiền');
  }

  // Khách tự hủy khi đang hỏi (UC-OPS-06 5d): gửi hoặc không gửi voucher xin lỗi
  sendApology(): void {
    const o = this.order()!;
    this.run(this.api.markUnfulfillable(o.code, { action: 'APOLOGY', apologyVoucher: {} }), 'Đã gửi voucher xin lỗi cho khách');
  }

  skipApology(): void {
    const o = this.order()!;
    const body = { action: 'APOLOGY', apologyVoucher: { skip: true, reason: this.apologySkipReason().trim() } };
    this.runOrApprove('UNFULFILLABLE', body, this.api.markUnfulfillable(o.code, body), 'Đã ghi nhận không gửi voucher');
  }

  // "Chat với khách" (UC-OPS-06 bước 4): mở đúng hội thoại của khách, tin mở đầu điền sẵn
  chatCustomer(): void {
    const o = this.order()!;
    this.busy.set(true);
    this.api.openConversation(o.code).subscribe({
      next: (r) => {
        this.busy.set(false);
        if (r.conversationId) this.dock.open(r.conversationId, r.customerName, r.draft);
        else this.chatCopy.set({ customerName: r.customerName, phone: r.phone, draft: r.draft });
      },
      error: (err: ApiError) => {
        this.busy.set(false);
        this.toast.show(err.message, 'danger');
      },
    });
  }

  copyChatDraft(): void {
    const c = this.chatCopy();
    if (!c) return;
    navigator.clipboard?.writeText(c.draft).then(
      () => this.toast.show('Đã sao chép tin nhắn'),
      () => this.toast.show('Không sao chép được, bạn chọn và sao chép tay', 'danger'),
    );
  }

  submitUfClear(): void {
    const o = this.order()!;
    this.run(this.api.markUnfulfillable(o.code, { action: 'CLEAR', reason: this.ufClearReason().trim() }), 'Đã gỡ đánh dấu không thể thực hiện');
  }

  // ===== Thay đổi chờ khách trả thêm (BR-47) =====

  confirmPendingPayment(): void {
    const o = this.order()!;
    const p = o.pendingChange;
    if (!p) return;
    this.busy.set(true);
    this.api.confirmPayment(p.paymentCode).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.toast.show(r.status === 'SUCCESS' ? 'Đã xác nhận thanh toán, đơn đã cập nhật' : r.failMessage || 'Không áp dụng được thay đổi, tiền đã được hoàn', r.status === 'SUCCESS' ? 'success' : 'danger');
        this.load();
      },
      error: (err: ApiError) => {
        this.busy.set(false);
        this.toast.show(err.message, 'danger');
        this.load();
      },
    });
  }

  resendPending(): void {
    const o = this.order()!;
    this.run(this.api.resendPendingChange(o.code), 'Đã gửi lại liên kết thanh toán thêm, gửi mã QR mới cho khách');
  }

  cancelPending(): void {
    const o = this.order()!;
    this.run(this.api.cancelPendingChange(o.code), 'Đã hủy thay đổi, đơn giữ nguyên');
  }

  // Số sẽ hoàn khi hủy ngoại lệ theo nguyên nhân
  cancelPreview(o: IAdminOrder): string {
    if (!(o.paidAmount > 0)) return 'Khách chưa trả tiền, không phát sinh hoàn.';
    if (this.exCause() === 'SOULPRINT') return `Hoàn 100% đã trả: ${o.refundable.toLocaleString('vi-VN')}đ, kể cả phần cá nhân hóa (lỗi do Soulprint).`;
    if (o.personalizationStartedAt && o.hasPersonalizedItems) return 'Đơn đã bắt đầu cá nhân hóa (TH3): hoàn ngay 0đ. Phần hàng cá nhân hóa không được hoàn; khách được nhận lại hàng trong 14 ngày, phần hàng không cá nhân hóa hoàn khi tiêu hủy.';
    return `Hoàn ${o.refundable.toLocaleString('vi-VN')}đ đã trả (TH2).`;
  }

  paymentLabel(purpose: string, o: IAdminOrder): string {
    if (purpose === 'ORDER_CHANGE') return 'Trả thêm khi đổi đơn';
    if (purpose === 'SUBSTITUTION') return 'Trả phần chênh đổi sản phẩm'; // giao dịch cũ (trước khi đổi sản phẩm có bù trừ)
    if (purpose === 'REDELIVERY') return 'Phí nhận lại hàng';
    return o.depositAmount ? 'Đã cọc (online)' : 'Đã thanh toán online';
  }

  ufDeadline(): Date {
    return new Date(Date.now() + this.ufHours() * 3600 * 1000);
  }

  // ===== Từ chối nhận, lưu kho =====

  setRfReason(code: string): void {
    this.rfReason.set(code);
    // 2a: sai địa chỉ do lỗi phía giao hàng thì phí phát sinh mặc định 0đ
    if (code === 'SAI_DIA_CHI') this.rfFee.set(0);
  }

  refusedPreview(): string {
    const o = this.order()!;
    if (!(o.paidAmount > 0)) return 'Khách chưa trả đồng nào: đơn hủy, khách có thể đặt lại.';
    const started = o.hasPersonalizedItems && o.timeline.some((t) => t.status === 'DANG_CA_NHAN_HOA' && t.at);
    if (started) return `Món cá nhân hóa được chuyển vào Hàng lưu kho, giữ 14 ngày (đến ${this.inDays(14)}). Khách nhận lại phải trả phí giao lại.`;
    return `Khách được hoàn ${Math.max(0, o.paidAmount - o.refundedAmount - (Number(this.rfFee()) || 0)).toLocaleString('vi-VN')}đ (đã trừ phí phát sinh).`;
  }

  private inDays(n: number): string {
    const d = new Date(Date.now() + n * 86400000);
    return d.toLocaleDateString('vi-VN');
  }

  submitRefused(): void {
    const o = this.order()!;
    this.run(this.api.markRefused(o.code, { reason: this.rfReason(), refusedShippingFee: Number(this.rfFee()) || 0, note: this.rfNote().trim() }), 'Đã ghi nhận từ chối nhận hàng');
  }

  submitShelf(): void {
    const o = this.order()!;
    this.busy.set(true);
    this.api.setShelf(o.code, this.shelf().trim()).subscribe({
      next: () => {
        this.busy.set(false);
        this.dialog.set(null);
        this.toast.show('Đã ghi vị trí kệ');
        this.load();
      },
      error: (err: ApiError) => {
        this.busy.set(false);
        this.formError.set(err.message);
      },
    });
  }

  submitDispose(): void {
    const o = this.order()!;
    this.busy.set(true);
    this.api.dispose(o.code, this.disposeMethod()).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.dialog.set(null);
        this.toast.show(r.refund ? `Đã tiêu hủy, tạo yêu cầu hoàn ${r.refund.toLocaleString('vi-VN')}đ phần hàng thường` : 'Đã tiêu hủy hàng lưu kho');
        this.load();
      },
      error: (err: ApiError) => {
        this.busy.set(false);
        this.formError.set(err.message);
      },
    });
  }

  // ===== In phiếu, thẻ, ghi chú =====

  print(): void {
    const o = this.order()!;
    this.api.bulkOrders({ codes: [o.code], action: 'PRINT_PACKING_SLIP' }).subscribe({
      next: (r) => {
        if (r.slips?.length) this.slips.set(r.slips);
        else this.toast.show(r.failed[0]?.reason || 'Không in được phiếu', 'danger');
      },
      error: (err: ApiError) => this.toast.show(err.message, 'danger'),
    });
  }

  afterPrint(): void {
    this.slips.set(null);
    this.load();
  }

  addTag(): void {
    const o = this.order()!;
    const t = this.tagInput().trim();
    if (!t) return;
    if (o.tags.length >= 10) {
      this.toast.show('Mỗi đơn tối đa 10 thẻ', 'danger');
      return;
    }
    this.saveTags([...o.tags, t]);
    this.tagInput.set('');
  }

  removeTag(t: string): void {
    this.saveTags(this.order()!.tags.filter((x) => x !== t));
  }

  private saveTags(tags: string[]): void {
    const o = this.order()!;
    this.api.setTags(o.code, tags).subscribe({
      next: (r) => this.order.set({ ...o, tags: r.tags }),
      error: (err: ApiError) => this.toast.show(err.message, 'danger'),
    });
  }

  // Đính kèm tối đa 3 tệp ảnh JPG/PNG (≤ 2MB) hoặc PDF (≤ 5MB), gửi base64
  pickFiles(input: HTMLInputElement): void {
    const files = Array.from(input.files || []);
    input.value = '';
    for (const f of files) {
      if (this.noteFiles().length >= MAX_FILES) {
        this.toast.show('Đính kèm tối đa 3 tệp', 'danger');
        break;
      }
      const okType = ['image/jpeg', 'image/png', 'application/pdf'].includes(f.type);
      const limit = f.type === 'application/pdf' ? 5 : 2;
      if (!okType || f.size > limit * 1024 * 1024) {
        this.toast.show(`${f.name}: chỉ nhận ảnh JPG, PNG ≤ 2MB hoặc PDF ≤ 5MB`, 'danger');
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => this.noteFiles.update((l) => [...l, { name: f.name, dataUrl: String(reader.result), size: f.size }]);
      reader.readAsDataURL(f);
    }
  }

  removeFile(i: number): void {
    this.noteFiles.update((l) => l.filter((_, j) => j !== i));
  }

  // Gõ trong ô ghi chú: có "@từ" ngay trước con trỏ thì mở gợi ý tên (tải danh sách lần đầu)
  onNoteInput(el: HTMLTextAreaElement): void {
    this.noteText.set(el.value);
    const before = el.value.slice(0, el.selectionStart ?? el.value.length);
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(before);
    this.mentionQuery.set(m ? m[2] : null);
    if (m && !this.staffList().length) this.api.getMentionable().subscribe({ next: (l) => this.staffList.set(l), error: () => {} });
  }

  pickMention(el: HTMLTextAreaElement, s: IMentionable): void {
    const pos = el.selectionStart ?? el.value.length;
    const before = el.value.slice(0, pos).replace(/@[^\s@]{0,30}$/, '@' + s.fullName + ' ');
    const text = before + el.value.slice(pos);
    el.value = text;
    this.noteText.set(text);
    this.mentionQuery.set(null);
    if (this.mentioned().length < 5) this.mentioned.update((l) => [...l, s]);
    el.focus();
    el.setSelectionRange(before.length, before.length);
  }

  removeMention(id: string): void {
    this.mentioned.update((l) => l.filter((m) => m._id !== id));
  }

  // Tách ghi chú thành đoạn thường và đoạn @Tên để tô nổi
  noteParts(a: IActivity): { text: string; mention: boolean }[] {
    const names = (a.mentions || []).map((n) => '@' + n);
    if (!a.detail || !names.length) return [{ text: a.detail || '', mention: false }];
    const re = new RegExp('(' + names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'g');
    return a.detail.split(re).filter(Boolean).map((t) => ({ text: t, mention: names.includes(t) }));
  }

  saveNote(): void {
    const o = this.order()!;
    const text = this.noteText().trim();
    if (!text) return;
    this.busy.set(true);
    // Chỉ gửi người còn "@Tên" trong nội dung (người dùng có thể đã xóa chữ sau khi chọn)
    const mentions = this.mentioned().filter((m) => text.includes('@' + m.fullName)).map((m) => m._id);
    this.api.addNote(o.code, text, this.noteFiles().map(({ name, dataUrl }) => ({ name, dataUrl })), mentions).subscribe({
      next: (entry) => {
        this.busy.set(false);
        this.noteText.set('');
        this.noteFiles.set([]);
        this.mentioned.set([]);
        this.mentionQuery.set(null);
        if (entry.mentions?.length) this.toast.show('Đã lưu ghi chú và báo cho ' + entry.mentions.join(', '));
        this.order.set({ ...o, activity: [entry, ...o.activity] });
      },
      error: (err: ApiError) => {
        this.busy.set(false);
        this.toast.show(err.message, 'danger');
      },
    });
  }

  kb(size: number): string {
    return size >= 1024 * 1024 ? (size / 1024 / 1024).toFixed(1) + ' MB' : Math.round(size / 1024) + ' KB';
  }

  back(): void {
    this.router.navigate(['/quan-tri/don-hang']);
  }
}
