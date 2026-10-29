import { Component, EventEmitter, Input, OnChanges, Output, computed, signal } from '@angular/core';

const MONTHS = ['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6', 'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12'];
const DAY = 86400000;
const ymdOf = (t: number) => new Date(t).toISOString().slice(0, 10);

// Lịch chọn ngày giao: lưới tháng bắt đầu Thứ hai; ngày ngoài [min, max] mờ, không bấm được; đánh dấu hôm nay
// và ngày sớm nhất (marked). Ngày dạng yyyy-MM-dd theo giờ Việt Nam do server tính, client không tự cộng ngày.
@Component({
  selector: 'app-date-calendar',
  standalone: false,
  templateUrl: './date-calendar.html',
  styleUrl: './date-calendar.scss',
})
export class DateCalendar implements OnChanges {
  @Input({ required: true }) min = '';
  @Input({ required: true }) max = '';
  @Input() value = '';
  @Input() today = '';
  @Input() marked = '';
  @Input() markLabel = 'Sớm nhất';
  @Input() label = 'Chọn ngày';
  @Output() picked = new EventEmitter<string>();

  // Tháng đang xem: yyyy-MM
  readonly month = signal('');
  private readonly bounds = signal({ min: '', max: '', value: '', today: '', marked: '' });

  ngOnChanges(): void {
    this.bounds.set({ min: this.min, max: this.max, value: this.value, today: this.today, marked: this.marked });
    const start = (this.value && this.value >= this.min ? this.value : this.min || this.today).slice(0, 7);
    if (!this.month() || this.month() < this.min.slice(0, 7) || this.month() > this.max.slice(0, 7)) this.month.set(start);
  }

  readonly title = computed(() => {
    const [y, m] = this.month().split('-');
    return y ? `${MONTHS[Number(m) - 1]}, ${y}` : '';
  });
  readonly canPrev = computed(() => this.month() > this.bounds().min.slice(0, 7));
  readonly canNext = computed(() => this.month() < this.bounds().max.slice(0, 7));

  // 6 tuần x 7 ngày; ô ngoài tháng để trống
  readonly cells = computed(() => {
    const m = this.month();
    if (!m) return [];
    const b = this.bounds();
    const first = Date.parse(m + '-01T00:00:00Z');
    const lead = (new Date(first).getUTCDay() + 6) % 7;
    const out: { ymd: string; day: number; off: boolean; on: boolean; today: boolean; marked: boolean; inMonth: boolean }[] = [];
    for (let i = 0; i < 42; i++) {
      const t = first + (i - lead) * DAY;
      const ymd = ymdOf(t);
      const inMonth = ymd.slice(0, 7) === m;
      out.push({ ymd, day: new Date(t).getUTCDate(), inMonth, off: !inMonth || ymd < b.min || ymd > b.max, on: ymd === b.value, today: ymd === b.today, marked: ymd === b.marked });
    }
    // Bỏ tuần cuối nếu trống hẳn
    return out.slice(35).every((c) => !c.inMonth) ? out.slice(0, 35) : out;
  });

  shift(delta: number): void {
    const [y, m] = this.month().split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    this.month.set(d.toISOString().slice(0, 7));
  }

  pick(c: { ymd: string; off: boolean }): void {
    if (!c.off) this.picked.emit(c.ymd);
  }

  ariaOf(c: { ymd: string; today: boolean; marked: boolean; off: boolean }): string {
    const [y, m, d] = c.ymd.split('-');
    return `${d}/${m}/${y}${c.today ? ', hôm nay' : ''}${c.marked ? ', ' + this.markLabel.toLowerCase() : ''}${c.off ? ', không chọn được' : ''}`;
  }
}
