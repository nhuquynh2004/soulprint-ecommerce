import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { watchOrderVersion } from '../../../../services/order-sync';
import { NoticeService } from '../../../../services/notice';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { OrderApiService } from '../../../../services/order-apiservice';
import { ChatService } from '../../../../services/chat';
import { CartService } from '../../../../services/cart';
import { ConfirmService } from '../../../../services/confirm';
import { ToastService } from '../../../../services/toast';
import { ApiError } from '../../../../classes/api-error';
import { IChangePreview, IOrderDetail, ORDER_STATUS_LABEL, expectedLabel } from '../../../../classes/order';
import { IPersonalization, IPersonalizeProduct, toCartPersonalization } from '../../../../classes/cart';
import { ProductApiService } from '../../../../services/product-apiservice';
import { PersonalizeResult } from '../../../../shared/personalize-dialog/personalize-dialog';
import { IReturnRequest } from '../../../../classes/aftersales';

// SCR-19 Chi tiết đơn (UC-TRK-02 bước 4-8, CNL-01, CNL-02, CNL-03). Route tham số :code (Chương IV); thẻ trạng thái
// phía trên timeline chọn bằng @switch theo trạng thái đơn (Chương II); nút lấy từ `actions` của API-43.
// S9: thẻ yêu cầu đổi trả, bảo hành; hộp thoại đánh giá (SCR-27), nhận lại hàng và nhận tiền hoàn (SCR-28).
@Component({
  selector: 'app-order-detail',
  standalone: false,
  templateUrl: './order-detail.html',
  styleUrl: './order-detail.scss',
})
export class OrderDetail {
  private readonly api = inject(OrderApiService);
  private readonly cartService = inject(CartService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly router = inject(Router);
  private readonly chat = inject(ChatService);
  private readonly route = inject(ActivatedRoute);
  // Đổi theo route: liên kết trong chat, thông báo trỏ tới đơn khác thì Angular giữ component, chỉ đổi tham số
  code = this.route.snapshot.paramMap.get('code') || '';

  readonly order = signal<IOrderDetail | null>(null);
  readonly error = signal('');
  readonly cancelOpen = signal(false);
  readonly busy = signal(false);
  readonly justReceived = signal(false);
  // UC-TRK-06: hộp thoại sửa thông tin giao hàng; sửa cá nhân hóa 1 món (SCR-04)
  readonly editShippingOpen = signal(false);
  readonly pzItemId = signal('');
  readonly pzProduct = signal<IPersonalizeProduct | null>(null);
  readonly pzInitial = signal<IPersonalization | null>(null);
  readonly pzQuantity = signal(1);
  readonly pzUnitPrice = signal(0);
  readonly pzBusy = signal(false);
  readonly pzError = signal('');
  // Hộp xác nhận trước khi sửa làm đổi giá trị đơn (BR-47); hết lượt sửa thì mời liên hệ Soulprint
  readonly pzConfirm = signal<{ personalization: unknown; preview: IChangePreview } | null>(null);
  readonly pzRefund = signal<'BANK' | 'VOUCHER'>('BANK');
  readonly pzLimit = signal(false);
  readonly voucherBusy = signal(false);
  private readonly products = inject(ProductApiService);
  readonly statusLabel = ORDER_STATUS_LABEL;
  // S9: hộp thoại đánh giá theo dòng sản phẩm, hộp thoại sau hủy
  readonly reviewFor = signal<string | null>(null);
  readonly afterCancel = signal<'redelivery' | 'refund' | null>(null);
  // Yêu cầu đang hiện (bỏ yêu cầu đã hủy), mới nhất trước
  readonly requests = computed(() => {
    const o = this.order();
    return o ? [...(o.returns || []).filter((r) => r.status !== 'DA_HUY'), ...(o.warranties || [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : [];
  });

  // Dòng phụ dưới tiêu đề: dự kiến giao (mốc Đã giao) hoặc lý do hủy
  readonly subline = computed(() => {
    const o = this.order();
    if (!o) return '';
    if (o.orderStatus === 'DA_HUY') return o.cancelBy === 'MEMBER' || o.cancelCause === 'KHACH' ? 'Đơn đã hủy theo yêu cầu của bạn' : 'Đơn đã hủy';
    const delivered = o.timeline.find((t) => t.status === 'DA_GIAO');
    if (delivered?.at) return `Đã giao lúc ${new Date(delivered.at).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' })}`;
    return delivered?.expected ? expectedLabel(delivered.expected).replace('Dự kiến', 'Dự kiến giao') : '';
  });

  // Dòng lý do hủy: hủy ngoại lệ theo yêu cầu của khách không ghi "Soulprint hủy đơn"
  readonly cancelLine = computed(() => {
    const o = this.order();
    if (!o?.cancelReason) return '';
    const detail = o.cancelDetail && o.cancelDetail !== o.cancelReason ? o.cancelDetail : '';
    if (o.cancelCause === 'KHACH') return `Đơn đã hủy theo yêu cầu của bạn${detail ? ': ' + detail : ''}`;
    return `Lý do hủy: ${o.cancelReason}${detail ? ' - ' + detail : ''}`;
  });

  private readonly destroyRef = inject(DestroyRef);
  private readonly notices = inject(NoticeService);
  // Đơn vừa đổi ở nơi khác trong lúc khách đang mở hộp thoại
  readonly staleBanner = signal(false);

  private loading = false;

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((p) => {
      const code = p.get('code') || '';
      if (code === this.code && this.order()) return;
      this.code = code;
      this.order.set(null);
      this.load();
    });
    // ?huy=, ?sua=, ?thanhToan= xử lý mỗi lần tham số đổi, kể cả khi khách đang ở chính trang đơn
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((q) => {
      const o = this.order();
      if (o && o.code === this.code && !this.loading) this.handleQuery(o, q);
    });
    // NFR-REL-06: đơn đổi ở nơi khác thì tự tải lại; đang mở hộp thoại thì chỉ báo để khách tự tải lại
    watchOrderVersion({
      check: () => this.api.getOrderVersion(this.code),
      current: () => this.order()?.version,
      changed: () => this.onRemoteChange(),
      destroyRef: this.destroyRef,
    });
    this.notices.arrived$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((n) => {
      if (n.link && n.link.includes(this.code)) this.onRemoteChange();
    });
  }

  private dialogOpen(): boolean {
    return this.cancelOpen() || this.editShippingOpen() || !!this.pzProduct() || !!this.pzConfirm() || this.pzLimit() || !!this.afterCancel() || this.reviewFor() !== null || this.busy();
  }

  // Thông báo mới và lần hỏi phiên bản có thể cùng gọi tới đây: đang tải thì bỏ qua, toast chỉ khi phiên bản thật sự đổi
  onRemoteChange(): void {
    if (this.dialogOpen()) {
      this.staleBanner.set(true);
      return;
    }
    if (this.loading) return;
    const before = this.order()?.version;
    this.load((o) => {
      if (before && o.version !== before) this.toast.show('Đơn vừa được cập nhật', 'info');
    });
  }

  reloadNow(): void {
    this.staleBanner.set(false);
    this.load();
  }

  load(done?: (o: IOrderDetail) => void): void {
    this.error.set('');
    this.staleBanner.set(false);
    this.loading = true;
    const code = this.code;
    this.api.getOrder(code).subscribe({
      next: (o) => {
        this.loading = false;
        if (code !== this.code) return;
        this.order.set(o);
        this.handleQuery(o, this.route.snapshot.queryParamMap);
        done?.(o);
      },
      error: (err: ApiError) => {
        this.loading = false;
        this.error.set(err.status === 404 ? 'Không tìm thấy đơn hàng' : 'Không tải được đơn hàng. Thử lại');
      },
    });
  }

  private handleQuery(o: IOrderDetail, q: ParamMap): void {
    // Từ hộp thoại hủy ở danh sách đơn: ?sua=shipping|personalization mở hộp thoại sửa (UC-CNL-02 3b)
    const sua = q.get('sua');
    if (sua === 'shipping' || sua === 'personalization') {
      this.router.navigate([], { relativeTo: this.route, queryParams: { sua: null }, replaceUrl: true });
      if (o.actions?.editShipping) this.onEditInstead(sua);
    }
    // Chip "Hủy đơn" trong chat: mở hộp thoại hủy, lý do "Đơn hàng không thể thực hiện" chọn sẵn
    if (q.get('huy') === 'khong-the-thuc-hien') {
      this.router.navigate([], { relativeTo: this.route, queryParams: { huy: null }, replaceUrl: true });
      if (o.actions?.cancel) this.cancelOpen.set(true);
    }
    // Cổng trả về sau khi khách tự sửa đơn hoặc nhận lại hàng mà thanh toán chưa xong
    const tt = q.get('thanhToan');
    if (tt === 'huy' || tt === 'that-bai') {
      this.router.navigate([], { relativeTo: this.route, queryParams: { thanhToan: null, gd: null }, replaceUrl: true });
      this.toast.show(`${tt === 'huy' ? 'Bạn đã hủy thanh toán' : 'Thanh toán chưa thành công'}, đơn hàng chưa thay đổi. Bạn chưa bị trừ tiền.`, 'info');
    }
  }

  // "Chat với Soulprint": mở cửa sổ chat, điền sẵn mã đơn để khách viết tiếp
  chatAbout(code: string): void {
    this.chat.open(`Mình cần hỗ trợ đơn ${code}: `);
  }

  // "Trả lời Soulprint" ở đơn đang được hỏi: nối thẳng nhân viên, tự gửi câu mở đầu, hiện 3 lựa chọn nhanh
  replySoulprint(code: string): void {
    this.chat.openToStaff(`Mình cần hỗ trợ đơn ${code}`, { orderCode: code, send: true, replies: true });
  }

  onCancelled(o: IOrderDetail): void {
    this.cancelOpen.set(false);
    this.order.set(o);
    this.toast.show(o.refund ? 'Đã hủy đơn, yêu cầu hoàn tiền đã được ghi nhận' : 'Đã hủy đơn hàng');
  }

  // UC-CNL-02 3b: chọn lý do đổi nội dung hoặc địa chỉ thì sửa đơn thay vì hủy
  onEditInstead(kind: 'shipping' | 'personalization'): void {
    this.cancelOpen.set(false);
    if (kind === 'shipping') {
      this.editShippingOpen.set(true);
      return;
    }
    const first = this.order()?.items.find((it) => it.canEditPersonalization);
    if (first) this.openPersonalize(first._id);
  }

  onEdited(o: IOrderDetail): void {
    this.editShippingOpen.set(false);
    this.order.set(o);
    this.toast.show('Đã cập nhật đơn hàng');
  }

  onEditStale(): void {
    this.editShippingOpen.set(false);
    this.pzProduct.set(null);
    this.toast.show('Đơn hàng đã được xử lý tiếp, không thể sửa', 'danger');
    this.load();
  }

  // Mở SCR-04 điền sẵn nội dung hiện tại; cấu hình cá nhân hóa lấy từ trang sản phẩm (API-28)
  openPersonalize(itemId: string): void {
    const it = this.order()?.items.find((x) => x._id === itemId);
    if (!it?.slug) return;
    this.pzError.set('');
    this.products.getProduct(it.slug).subscribe({
      next: (p) => {
        this.pzItemId.set(itemId);
        this.pzInitial.set(it.personalization ? toCartPersonalization(it.personalization) : null);
        this.pzQuantity.set(it.quantity);
        this.pzUnitPrice.set(it.unitPrice);
        this.pzProduct.set({ _id: p._id, name: p.name, slug: p.slug, image: it.image ?? p.images[0] ?? null, axis: p.axis, personalization: p.personalization, stickerSets: p.stickerSets });
      },
      error: (err: ApiError) => this.toast.show(err.message, 'danger'),
    });
  }

  // API-216 bước xem trước: tổng không đổi thì lưu luôn; đổi thì hiện hộp xác nhận; hết lượt thì mời liên hệ
  savePersonalize(r: PersonalizeResult): void {
    if (this.pzBusy() || !r.personalization) return;
    this.pzBusy.set(true);
    this.pzError.set('');
    this.api.updatePersonalization(this.code, this.pzItemId(), r.personalization, { preview: true }).subscribe({
      next: (res) => {
        this.pzBusy.set(false);
        const p = res.preview!;
        if (!p.valueChanged) {
          this.commitPersonalize(r.personalization);
          return;
        }
        if (p.editsLeft <= 0) {
          this.pzLimit.set(true);
          return;
        }
        this.pzRefund.set('BANK');
        this.pzConfirm.set({ personalization: r.personalization, preview: p });
      },
      error: (err: ApiError) => this.onPersonalizeError(err),
    });
  }

  confirmPersonalize(): void {
    const c = this.pzConfirm();
    if (c) this.commitPersonalize(c.personalization, this.pzRefund());
  }

  // Hết lượt sửa làm đổi giá trị: mở chat với nhân viên, điền sẵn mã đơn (4d)
  contactForEdit(): void {
    this.pzLimit.set(false);
    this.pzProduct.set(null);
    this.chat.openToStaff(`Mình muốn sửa nội dung cá nhân hóa đơn ${this.code}: `, { orderCode: this.code });
  }

  // API-219: nhận voucher dùng ngay thay cho chờ chuyển khoản phần chênh (BR-47 b)
  // UC-TRK-06 4b: hỏi lại trước khi đổi khoản hoàn chuyển khoản sang voucher, vì không đổi ngược lại được
  async takeVoucher(): Promise<void> {
    if (this.voucherBusy()) return;
    const amount = this.order()?.refund?.amount || 0;
    const ok = await this.confirm.ask({
      title: `Nhận voucher ${amount.toLocaleString('vi-VN')}đ thay cho chuyển khoản?`,
      message: 'Voucher dùng cho đơn sau trong 90 ngày. Đã nhận voucher thì không đổi lại sang chuyển khoản được.',
      okText: 'Nhận voucher',
      cancelText: 'Quay lại',
    });
    if (!ok) return;
    this.voucherBusy.set(true);
    this.api.refundToVoucher(this.code).subscribe({
      next: (r) => {
        this.voucherBusy.set(false);
        this.toast.show(`Đã hoàn ${r.voucher.value.toLocaleString('vi-VN')}đ bằng voucher ${r.voucher.code} trong Ưu đãi của tôi`);
        this.load();
      },
      error: (err: ApiError) => {
        this.voucherBusy.set(false);
        this.toast.show(err.message, 'danger');
        this.load();
      },
    });
  }

  private onPersonalizeError(err: ApiError): void {
    this.pzBusy.set(false);
    if (err.status === 409) {
      this.onEditStale();
      return;
    }
    if (err.code === 'VALUE_EDIT_LIMIT') {
      this.pzConfirm.set(null);
      this.pzLimit.set(true);
      return;
    }
    this.pzError.set(err.message);
  }

  // API-216 lưu thật: áp dụng ngay, hoặc phải trả thêm thì chuyển tới cổng thanh toán (4a)
  private commitPersonalize(personalization: unknown, refundMethod: 'BANK' | 'VOUCHER' = 'BANK'): void {
    this.pzBusy.set(true);
    this.api.updatePersonalization(this.code, this.pzItemId(), personalization, { refundMethod }).subscribe({
      next: (res) => {
        this.pzBusy.set(false);
        this.pzConfirm.set(null);
        if (res.payment) {
          this.toast.show(`Bạn cần thanh toán thêm ${res.payment.amount.toLocaleString('vi-VN')}đ`);
          location.href = res.payment.paymentUrl;
          return;
        }
        this.pzProduct.set(null);
        if (res.order) this.order.set(res.order);
        const vnd = (n: number) => n.toLocaleString('vi-VN') + 'đ';
        this.toast.show(
          res.refundVoucher
            ? `Đã cập nhật. Phần chênh ${vnd(res.refundVoucher.value)} được hoàn vào Ưu đãi của tôi`
            : res.refund
              ? `Đã cập nhật. Soulprint sẽ hoàn ${vnd(res.refund.amount)}${res.refund.needsAccount ? ', bạn nhập tài khoản nhận tiền ở đơn hàng' : ' về tài khoản ngân hàng của bạn'} trong 1 - 3 ngày làm việc`
              : 'Đã cập nhật nội dung cá nhân hóa',
        );
      },
      error: (err: ApiError) => this.onPersonalizeError(err),
    });
  }

  // 4Ea: nhân viên vừa xử lý tiếp đơn
  onStale(): void {
    this.cancelOpen.set(false);
    this.toast.show('Đơn hàng đã được xử lý tiếp, không thể hủy', 'danger');
    this.load();
  }

  // API-45 "Đã nhận hàng" (bước 7-8): đơn Hoàn thành, mời đánh giá
  received(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.api.received(this.code).subscribe({
      next: (o) => {
        this.busy.set(false);
        this.order.set(o);
        this.justReceived.set(true);
      },
      error: (err: ApiError) => {
        this.busy.set(false);
        this.toast.show(err.message, 'danger');
        this.load();
      },
    });
  }

  // Đánh giá, sửa, xóa xong (SCR-27): tải lại để nút theo dòng đổi thành "Sửa đánh giá"/"Đã đánh giá"
  onReviewed(message: string): void {
    this.reviewFor.set(null);
    this.toast.show(message);
    this.load();
  }

  // Bảo hành theo dòng (SCR-26)
  openWarranty(itemId: string): void {
    this.router.navigate(['/tai-khoan/don-hang', this.code, 'bao-hanh'], { queryParams: { item: itemId } });
  }

  onAfterCancel(message: string): void {
    this.afterCancel.set(null);
    this.toast.show(message);
    this.load();
  }

  // API-51 hủy yêu cầu đổi trả còn chờ duyệt (8a)
  cancelReturn(r: IReturnRequest): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.api.cancelReturn(r._id).subscribe({
      next: () => {
        this.busy.set(false);
        this.toast.show(`Đã hủy yêu cầu ${r.code}`);
        this.load();
      },
      error: (err: ApiError) => {
        this.busy.set(false);
        this.toast.show(err.message, 'danger');
        this.load();
      },
    });
  }

  // API-46 Đặt lại / Mua lại (UC-CNL-03)
  reorder(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.api.reorder(this.code).subscribe({
      next: (r) => {
        this.cartService.refresh().subscribe({ error: () => {} });
        if (r.skipped.length) this.toast.show('Một số sản phẩm không còn khả dụng: ' + r.skipped.join(', '), 'danger');
        this.router.navigate(['/gio-hang']);
      },
      error: (err: ApiError) => {
        this.busy.set(false);
        // 2Ea: không còn sản phẩm nào thì ở lại chi tiết đơn
        this.toast.show(err.extra['skipped']?.length ? `${err.message}: ${err.extra['skipped'].join(', ')}` : err.message, 'danger');
      },
    });
  }
}
