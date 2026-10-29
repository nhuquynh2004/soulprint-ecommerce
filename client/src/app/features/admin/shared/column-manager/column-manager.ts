import { Component, ElementRef, EventEmitter, HostListener, Input, OnInit, Output, inject, signal } from '@angular/core';

export interface ColumnDef {
  key: string;
  label: string;
  required?: boolean;
}

export interface ColumnState {
  key: string;
  visible: boolean;
}

// Quản lý cột của bảng quản trị (SCR-47-QuanLyCot, UC-OPS-01 3c): ô ẩn/hiện từng cột, kéo biểu tượng 6 chấm
// (hoặc nút lên/xuống khi dùng bàn phím) để đổi thứ tự, "Khôi phục mặc định". Lưu trên trình duyệt theo storageKey;
// localStorage lỗi (trình duyệt chặn) thì vẫn dùng được, chỉ không nhớ sau khi tải lại.
@Component({
  selector: 'app-column-manager',
  standalone: false,
  template: `
    <div class="sp-colman">
      <button class="btn btn-outline-secondary d-inline-flex align-items-center gap-2" type="button" (click)="open.set(!open())" [attr.aria-expanded]="open()">
        <app-icon name="grid" [size]="18" /> <span class="d-none d-md-inline">Cột</span>
      </button>
      @if (open()) {
        <div class="sp-colman__panel" role="dialog" aria-label="Quản lý cột">
          <div class="sp-colman__head">Cột {{ visibleCount() }}/{{ state().length }} đang hiện</div>
          <ul>
            @for (c of state(); track c.key; let i = $index) {
              <li
                draggable="true"
                [class.is-drag]="dragFrom() === i"
                (dragstart)="dragFrom.set(i)"
                (dragover)="$event.preventDefault()"
                (drop)="drop(i)"
                (dragend)="dragFrom.set(null)"
              >
                <app-icon name="grip" [size]="16" class="sp-colman__grip" />
                <label class="form-check m-0 flex-grow-1">
                  <input class="form-check-input" type="checkbox" [checked]="c.visible" [disabled]="isRequired(c.key)" (change)="toggle(c.key)" />
                  <span class="form-check-label">{{ labelOf(c.key) }}</span>
                </label>
                <button type="button" class="sp-colman__mv" [disabled]="i === 0" [attr.aria-label]="'Đưa ' + labelOf(c.key) + ' lên'" (click)="move(i, i - 1)"><app-icon name="chevron-up" [size]="16" /></button>
                <button type="button" class="sp-colman__mv" [disabled]="i === state().length - 1" [attr.aria-label]="'Đưa ' + labelOf(c.key) + ' xuống'" (click)="move(i, i + 1)"><app-icon name="chevron-down" [size]="16" /></button>
              </li>
            }
          </ul>
          <p class="sp-colman__hint">Kéo biểu tượng 6 chấm để đổi thứ tự cột</p>
          <button type="button" class="btn btn-link btn-sm p-0" (click)="reset()">Khôi phục mặc định</button>
        </div>
      }
    </div>
  `,
  styles: `
    .sp-colman { position: relative; }
    .sp-colman__panel {
      position: absolute; right: 0; top: calc(100% + 6px); z-index: 30; width: 280px; padding: var(--sp-space-3);
      border: 1px solid var(--sp-color-border); border-radius: var(--sp-radius-md); background: var(--sp-color-surface); box-shadow: var(--sp-shadow-md);
    }
    .sp-colman__head { margin-bottom: var(--sp-space-2); font-size: 13px; font-weight: 700; color: var(--sp-color-text-muted); }
    ul { margin: 0; padding: 0; list-style: none; }
    li { display: flex; align-items: center; gap: 6px; padding: 6px 4px; border-radius: var(--sp-radius-sm); cursor: grab; }
    li:hover { background: var(--sp-color-surface-alt); }
    li.is-drag { opacity: 0.5; }
    .sp-colman__grip { color: var(--sp-color-text-muted); }
    .sp-colman__mv { display: inline-flex; padding: 2px; border: 0; border-radius: var(--sp-radius-sm); background: none; color: var(--sp-color-text-muted); }
    .sp-colman__mv:disabled { opacity: 0.3; }
    .sp-colman__hint { margin: var(--sp-space-2) 0 4px; font-size: 12px; color: var(--sp-color-text-muted); }
  `,
})
export class ColumnManager implements OnInit {
  @Input({ required: true }) columns: ColumnDef[] = [];
  @Input({ required: true }) storageKey = '';
  @Output() changed = new EventEmitter<ColumnState[]>();

  readonly open = signal(false);
  readonly state = signal<ColumnState[]>([]);
  readonly dragFrom = signal<number | null>(null);
  private readonly host = inject(ElementRef<HTMLElement>);

  ngOnInit(): void {
    this.state.set(this.load());
    this.changed.emit(this.state());
  }

  visibleCount(): number {
    return this.state().filter((c) => c.visible).length;
  }

  labelOf(key: string): string {
    return this.columns.find((c) => c.key === key)?.label || key;
  }

  isRequired(key: string): boolean {
    return !!this.columns.find((c) => c.key === key)?.required;
  }

  toggle(key: string): void {
    this.commit(this.state().map((c) => (c.key === key ? { ...c, visible: !c.visible } : c)));
  }

  move(from: number, to: number): void {
    if (to < 0 || to >= this.state().length) return;
    const next = [...this.state()];
    const [c] = next.splice(from, 1);
    next.splice(to, 0, c);
    this.commit(next);
  }

  drop(to: number): void {
    const from = this.dragFrom();
    if (from !== null && from !== to) this.move(from, to);
    this.dragFrom.set(null);
  }

  reset(): void {
    try {
      localStorage.removeItem(this.storageKey);
    } catch {
      // trình duyệt chặn bộ nhớ: bỏ qua
    }
    this.commit(this.defaults(), false);
  }

  private defaults(): ColumnState[] {
    return this.columns.map((c) => ({ key: c.key, visible: true }));
  }

  // Giữ cột mới thêm vào bảng (chưa có trong lựa chọn đã lưu) ở cuối, bỏ cột không còn
  private load(): ColumnState[] {
    try {
      const saved = JSON.parse(localStorage.getItem(this.storageKey) || 'null') as ColumnState[] | null;
      if (Array.isArray(saved)) {
        const known = saved.filter((s) => this.columns.some((c) => c.key === s.key)).map((s) => ({ key: s.key, visible: this.isRequired(s.key) || !!s.visible }));
        for (const c of this.columns) if (!known.some((s) => s.key === c.key)) known.push({ key: c.key, visible: true });
        return known;
      }
    } catch {
      // dữ liệu lưu hỏng hoặc bị chặn: dùng mặc định
    }
    return this.defaults();
  }

  private commit(next: ColumnState[], save = true): void {
    this.state.set(next);
    if (save) {
      try {
        localStorage.setItem(this.storageKey, JSON.stringify(next));
      } catch {
        // không lưu được thì chỉ áp dụng trong phiên này
      }
    }
    this.changed.emit(next);
  }

  @HostListener('document:click', ['$event'])
  onDocClick(e: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(e.target as Node)) this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    this.open.set(false);
  }
}
