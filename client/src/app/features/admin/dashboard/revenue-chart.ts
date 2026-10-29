import { Component, ElementRef, Input, computed, signal } from '@angular/core';
import { ISeriesPoint } from '../../../classes/report';

// Biểu đồ doanh thu theo ngày/tuần/tháng của SCR-40 vẽ bằng SVG (UC-CAT-03 ghi chú kỹ thuật: không thư viện biểu đồ).
// Đường + vùng tô, trục Y làm tròn theo triệu đồng, rê chuột (hoặc chạm) vào biểu đồ hiện điểm gần nhất kèm số đơn.
@Component({
  selector: 'app-revenue-chart',
  standalone: false,
  template: `
    <div class="rc" (mouseleave)="hover.set(-1)">
      <div class="plot">
      <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" preserveAspectRatio="none" role="img" [attr.aria-label]="ariaLabel()"
        (mousemove)="move($event)" (touchstart)="move($event)">
        @for (t of ticks(); track t.y) {
          <line class="grid" [attr.x1]="PL" [attr.x2]="W - PR" [attr.y1]="t.y" [attr.y2]="t.y" />
        }
        <path class="area" [attr.d]="area()" />
        <path class="line" [attr.d]="line()" />
        @if (hover() >= 0) {
          <line class="cursor" [attr.x1]="xs()[hover()]" [attr.x2]="xs()[hover()]" [attr.y1]="PT" [attr.y2]="H - PB" />
          <circle class="dot" [attr.cx]="xs()[hover()]" [attr.cy]="ys()[hover()]" r="5" />
        }
      </svg>
      <div class="ylab" aria-hidden="true">
        @for (t of ticks(); track t.y) {
          <span [style.top.%]="(t.y / H) * 100">{{ t.label }}</span>
        }
      </div>
      @if (hover() >= 0 && points[hover()]; as p) {
        <div class="tip" [style.left.%]="(xs()[hover()] / W) * 100" [class.is-right]="hover() > points.length / 2">
          <strong>{{ p.revenue | vnd }}</strong>
          <span>{{ p.label }} | {{ p.orders }} đơn</span>
        </div>
      }
      </div>
      <div class="xlab" aria-hidden="true">
        @for (x of xLabels(); track x.i) {
          <span [style.left.%]="(xs()[x.i] / W) * 100">{{ x.label }}</span>
        }
      </div>
    </div>
  `,
  styleUrl: './revenue-chart.scss',
})
export class RevenueChart {
  @Input({ required: true }) set data(v: ISeriesPoint[]) {
    this.points = v || [];
    this.series.set(this.points.map((p) => p.revenue || 0));
  }
  points: ISeriesPoint[] = [];

  readonly W = 640;
  readonly H = 240;
  readonly PL = 44;
  readonly PR = 8;
  readonly PT = 10;
  readonly PB = 10;

  private readonly series = signal<number[]>([]);
  readonly hover = signal(-1);

  constructor(private host: ElementRef<HTMLElement>) {}

  // Trục Y: mức cao nhất làm tròn lên bội số đẹp của triệu đồng, 5 vạch
  readonly max = computed(() => {
    const m = Math.max(0, ...this.series());
    if (!m) return 1_000_000;
    const step = [1, 2, 5, 10, 20, 50, 100, 200, 500].map((x) => x * 200_000).find((s) => s * 5 >= m) || Math.ceil(m / 5 / 1_000_000) * 1_000_000;
    return step * 5;
  });
  readonly ticks = computed(() =>
    Array.from({ length: 6 }, (_, i) => {
      const v = (this.max() / 5) * i;
      return { y: this.yOf(v), label: v >= 1_000_000 ? `${Math.round((v / 1_000_000) * 10) / 10}tr`.replace('.', ',') : v ? `${Math.round(v / 1000)}k` : '0' };
    }),
  );
  readonly xs = computed(() => {
    const n = this.series().length;
    const w = this.W - this.PL - this.PR;
    return this.series().map((_, i) => this.PL + (n <= 1 ? w / 2 : (w * i) / (n - 1)));
  });
  readonly ys = computed(() => this.series().map((v) => this.yOf(v)));
  readonly line = computed(() => this.xs().map((x, i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${this.ys()[i].toFixed(1)}`).join(' '));
  readonly area = computed(() => {
    const xs = this.xs();
    if (!xs.length) return '';
    const base = this.H - this.PB;
    return `${this.line()} L${xs[xs.length - 1].toFixed(1)},${base} L${xs[0].toFixed(1)},${base} Z`;
  });
  // Tối đa 6 nhãn trục X chia đều
  readonly xLabels = computed(() => {
    const n = this.points.length;
    if (!n) return [];
    const step = Math.max(1, Math.ceil((n - 1) / 5));
    const idx = Array.from({ length: n }, (_, i) => i).filter((i) => i % step === 0);
    if (idx[idx.length - 1] !== n - 1 && n - 1 - idx[idx.length - 1] >= step / 2) idx.push(n - 1);
    return idx.map((i) => ({ i, label: this.points[i].label }));
  });
  readonly ariaLabel = computed(() => `Biểu đồ doanh thu ${this.points.length} mốc, cao nhất ${Math.max(0, ...this.series()).toLocaleString('vi-VN')}đ`);

  private yOf(v: number): number {
    const h = this.H - this.PT - this.PB;
    return this.PT + h - (v / this.max()) * h;
  }

  move(e: MouseEvent | TouchEvent): void {
    const svg = this.host.nativeElement.querySelector('svg');
    if (!svg || !this.points.length) return;
    const rect = svg.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0]?.clientX : e.clientX;
    if (clientX === undefined) return;
    const x = ((clientX - rect.left) / rect.width) * this.W;
    const xs = this.xs();
    let best = 0;
    for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - x) < Math.abs(xs[best] - x)) best = i;
    this.hover.set(best);
  }
}
