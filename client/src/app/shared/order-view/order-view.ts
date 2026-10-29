import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { IOrderDetail, expectedLabel } from '../../classes/order';

const CARRIER: Record<string, string> = { GHN: 'GHN', GHTK: 'GHTK', SPX: 'SPX Express', VIETTEL_POST: 'Viettel Post', KHAC: 'Đơn vị khác' };

// Thân chi tiết đơn dùng chung cho SCR-19 (Member) và SCR-24 (tra cứu, chế độ chỉ xem - thông tin đã che ở server):
// timeline 6 mốc hoặc "Lịch sử chi tiết", sản phẩm, bảng tiền, giao hàng. Thẻ trạng thái và nút do trang cha hiện.
@Component({
  selector: 'app-order-view',
  standalone: false,
  templateUrl: './order-view.html',
  styleUrl: './order-view.scss',
})
export class OrderView {
  @Input({ required: true }) order!: IOrderDetail;
  // Chủ đơn (SCR-19): hiện nút Đánh giá, Yêu cầu bảo hành theo dòng (S9); tra cứu (SCR-24) thì không
  @Input() itemActions = false;
  @Output() review = new EventEmitter<string>();
  @Output() warranty = new EventEmitter<string>();
  // Khách sửa đơn trước khi xác nhận (UC-TRK-06): sửa cá nhân hóa 1 món, sửa thông tin giao hàng
  @Output() editPersonalization = new EventEmitter<string>();
  @Output() editShipping = new EventEmitter<void>();

  readonly showHistory = signal(false);
  readonly expected = expectedLabel;
  readonly carrier = CARRIER;

  get delivered(): boolean {
    return this.order.orderStatus === 'DA_GIAO' || this.order.orderStatus === 'HOAN_THANH';
  }

  // Đơn đã hủy chỉ hiện tới mốc Đã hủy, bỏ các mốc chưa tới
  get steps(): IOrderDetail['timeline'] {
    const o = this.order;
    return o.orderStatus === 'DA_HUY' ? o.timeline.filter((s) => s.state !== 'todo') : o.timeline;
  }

  get itemQuantity(): number {
    return this.order.items.reduce((n, it) => n + it.quantity, 0);
  }

  // Dòng "Đã cọc"/"Đã thanh toán" online và dòng "Đã thu khi nhận hàng" (đơn cọc + COD sau khi giao tách 2 dòng)
  get onlinePaid(): number {
    return Math.max(0, this.order.paidAmount - (this.order.codPaid || 0));
  }

  get paidLabel(): string {
    const o = this.order;
    if (o.depositAmount > 0 && this.onlinePaid === o.depositAmount) return 'Đã cọc online';
    return 'Đã thanh toán online';
  }

  get remainingDue(): number {
    const o = this.order;
    if (o.orderStatus === 'DA_HUY') return 0;
    return Math.max(0, o.total - o.paidAmount);
  }
}
