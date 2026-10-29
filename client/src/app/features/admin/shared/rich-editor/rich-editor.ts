import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnChanges, Output, ViewChild, signal } from '@angular/core';

// Trình soạn mô tả nhỏ (UC-CAT-01 vùng 5, UC-CAT-07 1b): đậm, nghiêng, danh sách, liên kết; tự làm bằng contenteditable
// và lệnh document.execCommand, không cài thư viện. Server vẫn lọc HTML theo danh sách thẻ cho phép (NFR-SEC-14).
// Chèn biến chính sách ({{phi_van_chuyen}}...) qua insertText(); trang cha gọi bằng @ViewChild.
@Component({
  selector: 'app-rich-editor',
  standalone: false,
  template: `
    <div class="sp-rte" [class.is-disabled]="disabled">
      <div class="sp-rte__bar" role="toolbar" aria-label="Định dạng">
        <button type="button" title="Đậm" aria-label="Đậm" (mousedown)="$event.preventDefault()" (click)="cmd('bold')" [disabled]="disabled"><app-icon name="bold" [size]="18" /></button>
        <button type="button" title="Nghiêng" aria-label="Nghiêng" (mousedown)="$event.preventDefault()" (click)="cmd('italic')" [disabled]="disabled"><app-icon name="italic" [size]="18" /></button>
        <span class="sp-rte__sep"></span>
        <button type="button" title="Danh sách" aria-label="Danh sách" (mousedown)="$event.preventDefault()" (click)="cmd('insertUnorderedList')" [disabled]="disabled"><app-icon name="list-ul" [size]="18" /></button>
        <button type="button" title="Danh sách số" aria-label="Danh sách số" (mousedown)="$event.preventDefault()" (click)="cmd('insertOrderedList')" [disabled]="disabled"><app-icon name="list-ol" [size]="18" /></button>
        <span class="sp-rte__sep"></span>
        <button type="button" title="Liên kết" aria-label="Chèn liên kết" (mousedown)="$event.preventDefault()" (click)="link()" [disabled]="disabled"><app-icon name="link" [size]="18" /></button>
        <ng-content select="[editor-tools]" />
      </div>
      <div
        #area
        class="sp-rte__area"
        [attr.contenteditable]="!disabled"
        role="textbox"
        aria-multiline="true"
        [attr.aria-label]="label"
        [style.min-height.px]="minHeight"
        (input)="emit()"
        (blur)="emit()"
      ></div>
      <small class="sp-rte__count">{{ textLength() }}/{{ maxLength }} ký tự</small>
    </div>
  `,
  styleUrl: './rich-editor.scss',
})
export class RichEditor implements AfterViewInit, OnChanges {
  @Input() value = '';
  @Input() label = 'Nội dung';
  @Input() maxLength = 2000;
  @Input() minHeight = 160;
  @Input() disabled = false;
  @Output() valueChange = new EventEmitter<string>();
  @ViewChild('area') area!: ElementRef<HTMLDivElement>;

  readonly textLength = signal(0);
  private lastEmitted: string | null = null; // HTML đang có trong ô (sau lần vẽ hoặc lần gõ gần nhất)
  private renderedFrom: string | null = null; // giá trị trang cha đã vẽ vào ô, null khi người dùng đã gõ

  ngAfterViewInit(): void {
    this.render();
  }

  // Giá trị từ trang cha đổi (VD tải xong sản phẩm, Hủy thay đổi) thì vẽ lại; giá trị do chính trình soạn phát ra thì bỏ qua
  ngOnChanges(): void {
    if (this.area && this.value !== this.lastEmitted && this.value !== this.renderedFrom) this.render();
  }

  private render(): void {
    this.area.nativeElement.innerHTML = this.value || '';
    this.renderedFrom = this.value;
    this.lastEmitted = this.area.nativeElement.innerHTML; // trình duyệt có thể chuẩn hóa HTML, không coi là thay đổi
    this.textLength.set(this.area.nativeElement.innerText.trim().length);
  }

  cmd(name: string): void {
    this.area.nativeElement.focus();
    document.execCommand(name);
    this.emit();
  }

  link(): void {
    const url = prompt('Nhập đường dẫn (VD /san-pham hoặc https://...)');
    if (!url) return;
    this.area.nativeElement.focus();
    document.execCommand('createLink', false, url);
    this.emit();
  }

  // Chèn chữ tại con trỏ (biến chính sách)
  insertText(text: string): void {
    this.area.nativeElement.focus();
    document.execCommand('insertText', false, text);
    this.emit();
  }

  emit(): void {
    const html = this.area.nativeElement.innerHTML;
    this.textLength.set(this.area.nativeElement.innerText.trim().length);
    if (html === this.lastEmitted) return;
    this.lastEmitted = html;
    this.renderedFrom = null;
    this.valueChange.emit(html);
  }
}
