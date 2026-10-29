import { Component, Input, computed, signal } from '@angular/core';

// Đường xu hướng nhỏ của thanh Phân tích SCR-47 (UC-OPS-01 bước 3): SVG thuần, không thư viện biểu đồ
@Component({
  selector: 'app-sparkline',
  standalone: false,
  template: `
    <svg [attr.viewBox]="'0 0 ' + w + ' ' + h" [attr.width]="w" [attr.height]="h" aria-hidden="true" focusable="false">
      <polyline [attr.points]="points()" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" />
    </svg>
  `,
  styles: `:host { display: inline-flex; color: var(--sp-color-primary); }`,
})
export class Sparkline {
  readonly w = 88;
  readonly h = 26;
  private readonly data = signal<number[]>([]);

  @Input() set values(v: number[] | null | undefined) {
    this.data.set(v || []);
  }

  readonly points = computed(() => {
    const d = this.data();
    if (!d.length) return '';
    const max = Math.max(...d, 1);
    const min = Math.min(...d, 0);
    const step = d.length > 1 ? this.w / (d.length - 1) : 0;
    return d.map((v, i) => `${(i * step).toFixed(1)},${(this.h - 2 - ((v - min) / (max - min || 1)) * (this.h - 4)).toFixed(1)}`).join(' ');
  });
}
