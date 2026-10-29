import { Component, Input } from '@angular/core';

// Biểu tượng SVG của bộ thiết kế (public/assets/icons, 24×24).
// Tệp SVG tô màu cố định nên hiển thị bằng CSS mask + nền currentColor: biểu tượng tự theo màu chữ
// ở cả chế độ Sáng và Tối. Biểu tượng chỉ để trang trí; nút chỉ có biểu tượng phải có aria-label.
@Component({
  selector: 'app-icon',
  standalone: false,
  templateUrl: './icon.html',
  styleUrl: './icon.scss',
})
export class Icon {
  @Input({ required: true }) name = '';
  @Input() size = 24;
}
