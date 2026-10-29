import { Component, ElementRef, HostListener, Input, forwardRef, inject, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { removeAccents } from '../vn-text';

export interface SearchOption {
  value: string | number;
  label: string;
}

// Bỏ tiền tố hành chính để gõ tắt được: "Thành phố Hồ Chí Minh" -> "ho chi minh", chữ đầu "hcm"
const PREFIX = /^(thanh pho|tinh|phuong|xa|dac khu|thi tran)\s+/;

// Ô chọn có gõ tìm thay <select> ở ô Tỉnh/Thành, Phường/Xã: gõ không dấu vẫn ra ("hcm", "ho chi minh"),
// chọn bằng chuột hoặc phím mũi tên + Enter, Esc để đóng. Cài ControlValueAccessor nên dùng được với
// formControlName (Reactive Form) và [(ngModel)] (Template-driven) như PasswordField.
@Component({
  selector: 'app-search-select',
  standalone: false,
  templateUrl: './search-select.html',
  styleUrl: './search-select.scss',
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => SearchSelect), multi: true }],
})
export class SearchSelect implements ControlValueAccessor {
  @Input() inputId = '';
  @Input() placeholder = 'Chọn';
  @Input() invalid = false;
  @Input() loading = false;
  @Input() ariaLabel = '';
  // Giá trị coi như "chưa chọn" (checkout dùng 0 cho tỉnh, chuỗi rỗng cho phường)
  @Input() emptyValue: string | number = '';

  @Input() set options(list: SearchOption[] | null) {
    this.all = (list || []).map((o) => {
      const plain = removeAccents(o.label);
      const short = plain.replace(PREFIX, '');
      const initials = short.split(/\s+/).map((w) => w[0] || '').join('');
      return { ...o, plain, short, initials };
    });
    this.syncText();
  }

  private readonly host = inject(ElementRef<HTMLElement>);
  private all: (SearchOption & { plain: string; short: string; initials: string })[] = [];
  private value: string | number = '';
  private onChange: (v: string | number) => void = () => {};
  onTouched: () => void = () => {};

  readonly listId = `sp-ss-${Math.random().toString(36).slice(2, 9)}`;
  readonly open = signal(false);
  readonly active = signal(0);
  readonly results = signal<SearchOption[]>([]);
  text = '';
  disabled = false;

  get hasOptions(): boolean {
    return this.all.length > 0;
  }

  writeValue(v: string | number): void {
    this.value = v ?? this.emptyValue;
    this.syncText();
  }

  registerOnChange(fn: (v: string | number) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.disabled = disabled;
  }

  // Ô hiện tên của giá trị đang chọn
  private syncText(): void {
    this.text = this.all.find((o) => String(o.value) === String(this.value))?.label || '';
  }

  private filter(q: string): SearchOption[] {
    const plain = removeAccents(q).trim().replace(/\s+/g, ' ');
    if (!plain) return this.all;
    const compact = plain.replace(/\s/g, '').replace(/^tp/, '');
    const hit = this.all.filter((o) => o.plain.includes(plain) || o.short.includes(plain) || (compact.length >= 2 && o.initials.startsWith(compact)));
    // Khớp đầu tên lên trước: gõ "ha" thì "Hà Nội" đứng trước "Thanh Hóa"
    return hit.sort((a, b) => Number(!a.short.startsWith(plain)) - Number(!b.short.startsWith(plain)));
  }

  show(): void {
    if (this.disabled || !this.hasOptions) return;
    const list = this.filter('');
    this.results.set(list);
    this.active.set(Math.max(0, list.findIndex((o) => String(o.value) === String(this.value))));
    this.open.set(true);
    queueMicrotask(() => this.scrollActive());
  }

  onInput(text: string): void {
    this.text = text;
    this.results.set(this.filter(text));
    this.active.set(0);
    this.open.set(true);
  }

  // Chuột: chọn ngay ở pointerdown và giữ focus ô nhập. Chạm: để trình duyệt cuộn danh sách, chọn ở click
  // (click chỉ phát khi nhấc tay mà không vuốt) - trước đây chạm là chọn nên không cuộn được trên điện thoại
  onItemDown(e: PointerEvent, o: SearchOption): void {
    if (e.pointerType !== 'mouse') return;
    e.preventDefault();
    this.picked = true;
    this.pick(o);
  }

  private picked = false;

  pick(o: SearchOption): void {
    if (this.picked && !this.open()) {
      this.picked = false; // click theo sau pointerdown của chuột
      return;
    }
    this.picked = false;
    this.value = o.value;
    this.text = o.label;
    this.open.set(false);
    this.onChange(o.value);
  }

  // Rời ô mà chưa chọn: xóa chữ thì bỏ chọn, gõ dở thì trả lại tên đang chọn
  close(): void {
    if (!this.open()) return;
    this.open.set(false);
    if (!this.text.trim() && String(this.value) !== String(this.emptyValue)) {
      this.value = this.emptyValue;
      this.onChange(this.emptyValue);
    }
    this.syncText();
    this.onTouched();
  }

  onKey(e: KeyboardEvent): void {
    const n = this.results().length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!this.open()) return this.show();
      if (n) this.active.set((this.active() + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
      this.scrollActive();
    } else if (e.key === 'Enter') {
      if (this.open() && n) {
        e.preventDefault();
        this.pick(this.results()[this.active()]);
      }
    } else if (e.key === 'Escape' && this.open()) {
      e.preventDefault();
      this.close();
    } else if (e.key === 'Tab') {
      this.close();
    }
  }

  private scrollActive(): void {
    this.host.nativeElement.querySelector(`#${this.listId}-${this.active()}`)?.scrollIntoView({ block: 'nearest' });
  }

  @HostListener('document:pointerdown', ['$event'])
  onOutside(e: Event): void {
    if (!this.host.nativeElement.contains(e.target as Node)) this.close();
  }
}
