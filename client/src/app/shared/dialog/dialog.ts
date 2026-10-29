import { Component, ElementRef, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output, inject } from '@angular/core';

// Hộp thoại dùng chung (component Dialog của bộ thiết kế): tiêu đề, nội dung (ng-content), chân hộp thoại [dialog-footer].
// Đóng bằng nút X, phím Esc hoặc bấm nền tối. Trang cha hiển thị bằng @if và nhận sự kiện (closed).
@Component({
  selector: 'app-dialog',
  standalone: false,
  templateUrl: './dialog.html',
  styleUrl: './dialog.scss',
})
export class Dialog implements OnInit, OnDestroy {
  @Input({ required: true }) title = '';
  @Input() subtitle = '';
  @Input() size: 'sm' | 'md' | 'lg' = 'md';
  @Output() closed = new EventEmitter<void>();

  private readonly host = inject(ElementRef<HTMLElement>);
  private previousFocus: Element | null = null;

  ngOnInit(): void {
    this.previousFocus = document.activeElement;
    document.body.classList.add('sp-no-scroll');
    // Đưa con trỏ vào ô nhập đầu tiên để dùng được bằng bàn phím
    setTimeout(() => {
      const first = this.host.nativeElement.querySelector('input, select, textarea, button:not(.sp-dialog__x)') as HTMLElement | null;
      first?.focus();
    });
  }

  ngOnDestroy(): void {
    document.body.classList.remove('sp-no-scroll');
    (this.previousFocus as HTMLElement | null)?.focus?.();
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    this.closed.emit();
  }
}
