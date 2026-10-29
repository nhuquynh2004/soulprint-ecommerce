import { Directive, DoCheck, ElementRef, HostListener, inject } from '@angular/core';

// Ô ghi chú tự cao theo nội dung: áp cho mọi textarea.form-control, khách không phải kéo góc để đổi cỡ.
// Chiều cao tối thiểu theo thuộc tính rows, tối đa 320px rồi mới cuộn (style ở _components.scss).
// Kiểm cả khi giá trị đổi từ code (ngModel, formControl patchValue) chứ không chỉ khi gõ.
@Directive({ selector: 'textarea.form-control', standalone: false })
export class AutosizeTextarea implements DoCheck {
  private readonly el = inject(ElementRef<HTMLTextAreaElement>).nativeElement as HTMLTextAreaElement;
  private last: string | null = null;

  @HostListener('input')
  resize(): void {
    this.last = this.el.value;
    this.el.style.height = 'auto';
    this.el.style.height = `${this.el.scrollHeight + this.el.offsetHeight - this.el.clientHeight}px`;
  }

  ngDoCheck(): void {
    if (this.el.value !== this.last) queueMicrotask(() => this.resize());
  }
}
