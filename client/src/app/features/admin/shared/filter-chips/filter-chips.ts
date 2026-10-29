import { Component, EventEmitter, Input, Output } from '@angular/core';

export interface FilterChip {
  key: string;
  label: string;
}

// Chip bộ lọc đang áp dụng có dấu x (UC-CAT-05 bước 1, UC-CAT-06 bước 1): bấm x bỏ một bộ lọc, "Xóa bộ lọc" bỏ hết.
@Component({
  selector: 'app-filter-chips',
  standalone: false,
  template: `
    @if (chips.length) {
      <div class="sp-fchips" aria-label="Bộ lọc đang áp dụng">
        @for (c of chips; track c.key) {
          <span class="sp-fchip">
            {{ c.label }}
            <button type="button" [attr.aria-label]="'Bỏ bộ lọc ' + c.label" (click)="removed.emit(c.key)"><app-icon name="close" [size]="14" /></button>
          </span>
        }
        <button type="button" class="btn btn-link btn-sm" (click)="clearedAll.emit()">Xóa bộ lọc</button>
      </div>
    }
  `,
  styles: `
    .sp-fchips { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-space-2); margin-bottom: var(--sp-space-3); }
    .sp-fchip {
      display: inline-flex; align-items: center; gap: 4px; min-height: 32px; padding: 0 6px 0 12px;
      border-radius: var(--sp-radius-pill); background: var(--sp-color-primary-subtle); color: var(--sp-color-primary);
      font-size: 13px; font-weight: 600;
      button { display: inline-flex; padding: 4px; border: 0; border-radius: 50%; background: none; color: inherit; }
    }
  `,
})
export class FilterChips {
  @Input() chips: FilterChip[] = [];
  @Output() removed = new EventEmitter<string>();
  @Output() clearedAll = new EventEmitter<void>();
}
