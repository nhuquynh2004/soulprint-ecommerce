import { Component, Input, inject } from '@angular/core';
import { ChatService } from '../../services/chat';

// Dòng mời đặt số lượng lớn ở trang chi tiết sản phẩm, giỏ hàng, trang chủ. Chưa có luồng đặt hàng loạt
// riêng (ghi ở phần mở rộng của báo cáo), nên bấm vào mở chat CSKH và điền sẵn câu hỏi để nhân viên tư vấn, báo giá.
@Component({
  selector: 'app-bulk-order-note',
  standalone: false,
  templateUrl: './bulk-order-note.html',
  styleUrl: './bulk-order-note.scss',
})
export class BulkOrderNote {
  private readonly chat = inject(ChatService);

  // Tên sản phẩm đang xem (trang chi tiết) để câu hỏi điền sẵn nói rõ món cần đặt
  @Input() productName = '';
  // 'inline' = dòng nhỏ trong cột mua hàng, giỏ hàng; 'band' = dải ngang cuối trang chủ
  @Input() variant: 'inline' | 'band' = 'inline';

  openChat(): void {
    const item = this.productName ? `sản phẩm "${this.productName}"` : 'quà tặng';
    // Báo giá số lượng lớn cần nhân viên: tin khách gửi đi thẳng nhân viên, không qua Sâu Béo
    this.chat.openToStaff(`Chào Soulprint, mình muốn đặt số lượng lớn ${item}. Số lượng khoảng: `);
  }
}
