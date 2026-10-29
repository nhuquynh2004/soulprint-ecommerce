import { Component, EventEmitter, Input, Output } from '@angular/core';

// Phân trang (SCR-02): Trước, các số trang (rút gọn bằng "..."), Sau.
@Component({
  selector: 'app-pagination',
  standalone: false,
  templateUrl: './pagination.html',
  styleUrl: './pagination.scss',
})
export class Pagination {
  @Input() page = 1;
  @Input() pageSize = 12;
  @Input() total = 0;
  @Output() pageChange = new EventEmitter<number>();

  get pageCount(): number {
    return Math.max(1, Math.ceil(this.total / this.pageSize));
  }

  // VD trang 6/12: 1 ... 5 6 7 ... 12 (0 là dấu "...")
  get pages(): number[] {
    const n = this.pageCount;
    if (n <= 7) return Array.from({ length: n }, (_, i) => i + 1);
    const set = new Set([1, n, this.page - 1, this.page, this.page + 1]);
    const list = [...set].filter((p) => p >= 1 && p <= n).sort((a, b) => a - b);
    const out: number[] = [];
    list.forEach((p, i) => {
      if (i && p - list[i - 1] > 1) out.push(0);
      out.push(p);
    });
    return out;
  }

  go(p: number): void {
    if (p >= 1 && p <= this.pageCount && p !== this.page) this.pageChange.emit(p);
  }
}
