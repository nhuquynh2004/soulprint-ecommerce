import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { IAiProduct, IAiResult, pct } from '../../../classes/recommendation';
import { Product } from '../../../classes/product';
import { WishlistService } from '../../../services/wishlist';

// Một món gợi ý trên SCR-10 (UC-DIS-05 bước 7, 8). Component Interaction (Chương II): @Input nhận kết quả từ trang
// Tư vấn quà, @Output `add` báo trang cha thêm vào giỏ (trang cha biết sessionId để ghi aiSessions - AC5).
@Component({
  selector: 'app-ai-result-card',
  standalone: false,
  templateUrl: './ai-result-card.html',
  styleUrl: './ai-result-card.scss',
})
export class AiResultCard {
  @Input({ required: true }) item!: IAiResult;
  @Input() index = 0;
  @Input() top = false; // "Sâu chọn nhất" khi khớp đủ tiêu chí
  @Input() sessionId: string | null = null;
  @Input() adding = false;
  @Output() add = new EventEmitter<IAiProduct>();

  readonly pct = pct;
  readonly placeholder = Product.PLACEHOLDER;
  protected readonly wishlist = inject(WishlistService);

  // Lý do "Cao hơn ngân sách", "Chưa đúng ..." tô màu cảnh báo (6Ea)
  isWarn(reason: string): boolean {
    return reason.startsWith('Cao hơn') || reason.startsWith('Chưa đúng') || reason.startsWith('Thấp hơn');
  }
}
