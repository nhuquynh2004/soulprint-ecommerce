import { Component, DestroyRef, ElementRef, EventEmitter, HostListener, Input, Output, inject, signal } from '@angular/core';

export interface RowMenuItem {
  key: string;
  label: string;
  icon: string;
  danger?: boolean;
}

// Menu "..." cuối mỗi dòng bảng quản trị (SCR-41, SCR-43, SCR-54) và tiêu đề nhóm tag (SCR-44-MenuNhom).
// Bấm ra ngoài hoặc Esc thì đóng; chọn mục thì phát (picked) với key.
// Danh sách nổi (position fixed theo vị trí nút) nên không bị khung cuộn của bảng cắt hay kéo giãn khi bảng ít dòng;
// sát đáy màn hình thì mở lên trên; cuộn trang hoặc bảng thì đóng.
@Component({
  selector: 'app-row-menu',
  standalone: false,
  template: `
    <div class="sp-rowmenu">
      <button #btn class="btn sp-rowmenu__btn" type="button" (click)="toggle(btn)" [attr.aria-expanded]="open()" [attr.aria-label]="label">
        <app-icon name="more" [size]="20" />
      </button>
      @if (open()) {
        <div class="sp-rowmenu__list sp-rowmenu__list--float" role="menu" [style.top.px]="pos().top" [style.right.px]="pos().right">
          @for (i of items; track i.key) {
            <button role="menuitem" type="button" [class.text-danger]="i.danger" (click)="pick(i.key)">
              <app-icon [name]="i.icon" [size]="18" /> {{ i.label }}
            </button>
          }
        </div>
      }
    </div>
  `,
})
export class RowMenu {
  @Input({ required: true }) items: RowMenuItem[] = [];
  @Input() label = 'Thao tác';
  @Output() picked = new EventEmitter<string>();

  readonly open = signal(false);
  readonly pos = signal({ top: 0, right: 0 });
  private readonly host = inject(ElementRef<HTMLElement>);

  constructor() {
    // Bắt cả sự kiện cuộn trong khung bảng (không nổi lên window)
    const close = () => this.open() && this.open.set(false);
    document.addEventListener('scroll', close, true);
    inject(DestroyRef).onDestroy(() => document.removeEventListener('scroll', close, true));
  }

  toggle(btn: HTMLElement): void {
    if (this.open()) {
      this.open.set(false);
      return;
    }
    const r = btn.getBoundingClientRect();
    const h = this.items.length * 40 + 14;
    const up = r.bottom + h + 8 > window.innerHeight && r.top > h + 8;
    this.pos.set({ top: up ? r.top - h - 4 : r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
    this.open.set(true);
  }

  pick(key: string): void {
    this.open.set(false);
    this.picked.emit(key);
  }

  @HostListener('document:click', ['$event'])
  onDocClick(e: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(e.target as Node)) this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  @HostListener('window:resize')
  onEsc(): void {
    this.open.set(false);
  }
}
