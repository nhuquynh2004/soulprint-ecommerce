import { Component, EventEmitter, Input, OnChanges, Output, computed, signal } from '@angular/core';

export interface IRange {
  min: number;
  max: number;
}

// Thanh kéo 2 đầu (ds bundle.css .sp-range, style ở styles/_components.scss): 2 input range chồng lên nhau, núm này
// không vượt núm kia. Dùng ở SCR-10 Tư vấn quà AI và bộ lọc SCR-02.
// (valueChange) phát khi đang kéo; (committed) phát khi thả núm, bộ lọc dùng để không gọi API theo từng bước kéo.
@Component({
  selector: 'app-range-slider',
  standalone: false,
  template: `
    <div class="sp-range__head">
      <span class="sp-label" [class.visually-hidden]="hideLabel">{{ label }}</span>
      @if (ready) {
        <span class="sp-range__value">{{ text(live()) }}</span>
      } @else {
        <span class="sp-skel" style="width: 120px; height: 1em" aria-hidden="true"></span>
      }
    </div>
    <div class="sp-range">
      <div class="sp-range__track">
        <span class="sp-range__fill" [style.left.%]="fill().left" [style.right.%]="fill().right"></span>
        <input
          type="range"
          [min]="min"
          [max]="max"
          [step]="step"
          [value]="live().min"
          (input)="move('min', $any($event.target))"
          (change)="commit()"
          [attr.aria-label]="label + ' tối thiểu'"
          [attr.aria-valuetext]="ariaText(live().min, 'min')"
        />
        <input
          type="range"
          [min]="min"
          [max]="max"
          [step]="step"
          [value]="live().max"
          (input)="move('max', $any($event.target))"
          (change)="commit()"
          [attr.aria-label]="label + ' tối đa'"
          [attr.aria-valuetext]="ariaText(live().max, 'max')"
        />
      </div>
      <div class="sp-range__labels">
        <span>{{ minLabel }}</span><span [style.visibility]="ready ? 'visible' : 'hidden'">{{ maxLabel }}</span>
      </div>
    </div>
  `,
})
export class RangeSlider implements OnChanges {
  @Input({ required: true }) label = '';
  // Bộ lọc SCR-02: tên nhóm đã ở tiêu đề nhóm, chỉ giữ cho trình đọc màn hình
  @Input() hideLabel = false;
  @Input() min = 0;
  @Input() max = 100;
  @Input() step = 1;
  @Input({ required: true }) value: IRange = { min: 0, max: 100 };
  @Input() minLabel = '';
  @Input() maxLabel = '';
  // false: đầu trên chưa biết (đang tải), hiện khung chờ thay số
  @Input() ready = true;
  @Input() text: (v: IRange) => string = (v) => `${v.min} - ${v.max}`;
  @Input() ariaText: (n: number, end: 'min' | 'max') => string = (n) => String(n);
  @Output() valueChange = new EventEmitter<IRange>();
  @Output() committed = new EventEmitter<IRange>();

  readonly live = signal<IRange>({ min: 0, max: 100 });
  private readonly bounds = signal({ lo: 0, hi: 100 });
  readonly fill = computed(() => {
    const { lo, hi } = this.bounds();
    const v = this.live();
    const span = hi - lo || 1;
    return { left: ((v.min - lo) / span) * 100, right: 100 - ((v.max - lo) / span) * 100 };
  });

  ngOnChanges(): void {
    this.bounds.set({ lo: this.min, hi: this.max });
    this.live.set({ min: Math.max(this.min, this.value.min), max: Math.min(this.max, this.value.max) });
  }

  // Núm không vượt núm kia: giữ cách nhau ít nhất 1 bước; ghi lại vào ô để núm đứng đúng chỗ khi bị chặn
  move(end: 'min' | 'max', el: HTMLInputElement): void {
    const value = Number(el.value);
    const { min, max } = this.live();
    const next = end === 'min' ? { min: Math.min(value, max - this.step), max } : { min, max: Math.max(value, min + this.step) };
    if (String(next[end]) !== el.value) el.value = String(next[end]);
    this.live.set(next);
    this.valueChange.emit(next);
  }

  commit(): void {
    this.committed.emit(this.live());
  }
}
