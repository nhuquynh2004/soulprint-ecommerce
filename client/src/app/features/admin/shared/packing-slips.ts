import { AfterViewInit, Component, EventEmitter, Input, Output } from '@angular/core';
import { IPackingSlip } from '../../../classes/admin-order';
import { PzSnapshot, pzDetailLines } from './pz-preview';

// Phiếu đóng gói (UC-OPS-01 5c): mã đơn, sản phẩm, biến thể, nội dung cá nhân hóa, gói quà, ghi chú cho cửa hàng,
// địa chỉ, ĐVVC. In bằng trang in của trình duyệt (window.print) với CSS @media print (styles.scss: .sp-print-area).
// Trên màn hình phiếu nằm ngoài khung nhìn; in xong phát (done) để trang cha gỡ phiếu.
@Component({
  selector: 'app-packing-slips',
  standalone: false,
  template: `
    <div class="sp-print-area" aria-hidden="true">
      @for (s of slips; track s.code) {
        <section class="sp-slip">
          <header>
            <div>
              <strong>Soulprint - Phiếu đóng gói</strong>
              <div>Đơn {{ s.code }} | {{ s.createdAt | date: 'dd/MM/yyyy HH:mm' }}</div>
            </div>
            <div class="text-end">
              @if (s.carrier) {
                <div>{{ s.carrier }} {{ s.trackingCode }}</div>
              }
              <div>Thu khi giao (COD): <strong>{{ s.codDue | vnd }}</strong></div>
            </div>
          </header>
          <div class="sp-slip__addr">
            <div><b>Người nhận:</b> {{ s.shippingAddress.recipientName }} | {{ s.shippingAddress.phone }}</div>
            <div><b>Địa chỉ:</b> {{ s.shippingAddress.street }}, {{ s.shippingAddress.ward }}, {{ s.shippingAddress.province }}</div>
            @if (s.shippingAddress.noteForShipper) {
              <div><b>Ghi chú cho shipper:</b> {{ s.shippingAddress.noteForShipper }}</div>
            }
          </div>
          <table>
            <thead>
              <tr><th>Sản phẩm</th><th>Biến thể / SKU</th><th>SL</th><th>Nội dung cá nhân hóa</th><th>Đã soát</th></tr>
            </thead>
            <tbody>
              @for (it of s.items; track $index) {
                <tr>
                  <td>{{ it.name }}</td>
                  <td>{{ it.variantName }}<br /><small>{{ it.sku }}</small></td>
                  <td>{{ it.quantity }}</td>
                  <td>
                    @for (l of lines(it); track $index) {
                      <strong class="d-block">{{ l }}</strong>
                    } @empty {
                      -
                    }
                  </td>
                  <td>☐</td>
                </tr>
              }
            </tbody>
          </table>
          @if (s.giftWrap) {
            <!-- ghi mã vật liệu để nhân viên đóng gói lấy đúng mẫu -->
            <p><b>Gói quà:</b> {{ s.giftWrap.name }}</p>
            <ul>
              @if (s.giftWrap.paper) { <li>Giấy gói: {{ s.giftWrap.paper.name }}{{ s.giftWrap.paper.code ? ' (' + s.giftWrap.paper.code + ')' : '' }}</li> }
              @if (s.giftWrap.ribbon) { <li>Ruy băng: {{ s.giftWrap.ribbon.name }}{{ s.giftWrap.ribbon.code ? ' (' + s.giftWrap.ribbon.code + ')' : '' }}</li> }
              @if (s.giftWrap.card) { <li>Thiệp: {{ s.giftWrap.card.name }}{{ s.giftWrap.card.code ? ' (' + s.giftWrap.card.code + ')' : '' }}</li> }
            </ul>
            @if (s.giftWrap.message) {
              <p><b>Lời nhắn trên thiệp:</b> “{{ s.giftWrap.message }}”</p>
            }
          }
          @if (s.noteForShop) {
            <p><b>Ghi chú của khách cho cửa hàng:</b> {{ s.noteForShop }}</p>
          }
        </section>
      }
    </div>
  `,
})
export class PackingSlips implements AfterViewInit {
  // Ghi rõ tên, mã sticker, từng dòng áo đấu, lời nhắn để nhân viên làm đúng
  lines(it: { personalization?: unknown; personalizationText: string | null }): string[] {
    const d = pzDetailLines(it.personalization as PzSnapshot | null);
    return d.length ? d : it.personalizationText ? [it.personalizationText] : [];
  }

  @Input({ required: true }) slips: IPackingSlip[] = [];
  @Output() done = new EventEmitter<void>();

  ngAfterViewInit(): void {
    // Chờ trình duyệt vẽ phiếu rồi mới mở hộp thoại in
    setTimeout(() => {
      window.print();
      this.done.emit();
    }, 50);
  }
}
