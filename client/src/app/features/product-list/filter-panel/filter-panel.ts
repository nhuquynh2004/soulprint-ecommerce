import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { ICategory, ITagGroup } from '../../../classes/catalog';
import { AGE_MAX, AGE_MIN, BUDGET_MAX, BUDGET_STEP, fmtVnd } from '../../../classes/recommendation';
import { IRange } from '../../../shared/range-slider/range-slider';
import { AXES, FilterState, RATINGS, countCriteria, parseAge, parsePrice, toggle } from '../filter-state';

// Thanh lọc bên trái SCR-02 (UC-DIS-04 bước 1). Dùng 2 lần: cột trái ở Desktop và ngăn kéo ở Mobile/Tablet.
// Không giữ trạng thái riêng: nhận state qua @Input, báo thay đổi qua @Output để trang cha ghi vào URL.
// 6 nhóm - Danh mục kèm "Theo đam mê", nhóm tag đang bật isFilter theo thứ tự Admin đặt, Đánh giá.
// Nhóm khoảng Độ tuổi, Ngân sách là thanh kéo như SCR-10, đổi thành ?age= hoặc ?gia= khi thả núm.
@Component({
  selector: 'app-filter-panel',
  standalone: false,
  templateUrl: './filter-panel.html',
  styleUrl: './filter-panel.scss',
})
export class FilterPanel implements OnChanges {
  @Input({ required: true }) state!: FilterState;
  @Input() categories: ICategory[] = [];
  @Input() tagGroups: ITagGroup[] = [];
  // multi: chọn nhiều danh mục (/san-pham, /tim-kiem); links: đang ở /danh-muc/:slug, bấm để chuyển danh mục
  @Input() categoryMode: 'multi' | 'links' | 'hidden' = 'multi';
  @Input() currentCategory = '';
  @Output() changed = new EventEmitter<Partial<FilterState>>();
  @Output() cleared = new EventEmitter<void>();

  readonly axes = AXES;
  readonly ratings = RATINGS;
  readonly ageMin = AGE_MIN;
  readonly ageMax = AGE_MAX;
  readonly budgetStep = BUDGET_STEP;

  shownGroups: ITagGroup[] = [];
  // Đầu trên Ngân sách: mốc cao nhất của các mức trong nhóm (VD "Trên 1.000.000đ"), tối thiểu 1.000.000đ
  budgetTop = BUDGET_MAX;
  ageValue: IRange = { min: AGE_MIN, max: AGE_MAX };
  priceValue: IRange = { min: 0, max: BUDGET_MAX };

  ngOnChanges(): void {
    // Nhóm tắt trên bộ lọc vẫn có trong tagGroups để trang cha lấy tên tag cho dòng "Đang lọc"
    this.shownGroups = this.tagGroups
      .filter((g) => g.isFilter !== false)
      .map((g) => ({ ...g, items: g.items.filter((t) => t.isFilter !== false) }))
      .filter((g) => g.items.length);
    const price = this.tagGroups.find((g) => g.kind === 'RANGE' && g.rangeField === 'PRICE');
    this.budgetTop = Math.max(BUDGET_MAX, ...(price?.items || []).map((t) => t.range?.max ?? t.range?.min ?? 0));
    const p = parsePrice(this.state.price);
    this.priceValue = { min: Math.min(p?.min ?? 0, this.budgetTop - BUDGET_STEP), max: p?.max == null ? this.budgetTop : Math.min(p.max, this.budgetTop) };
    const a = parseAge(this.state.age);
    this.ageValue = { min: Math.max(AGE_MIN, Math.min(a?.min ?? AGE_MIN, AGE_MAX - 1)), max: Math.min(AGE_MAX, a?.max ?? AGE_MAX) };
  }

  get count(): number {
    return countCriteria(this.state);
  }

  toggleCategory(slug: string): void {
    this.changed.emit({ categories: toggle(this.state.categories, slug) });
  }

  toggleAxis(value: string): void {
    this.changed.emit({ axes: toggle(this.state.axes, value) });
  }

  toggleTag(slug: string): void {
    this.changed.emit({ tags: toggle(this.state.tags, slug) });
  }

  // Kéo hết 2 đầu là bỏ lọc; đầu trên ở mốc cao nhất là không giới hạn (?gia=500000- , ?age=18-99 như mức "Từ 36 tuổi")
  setPrice(v: IRange): void {
    const open = v.max >= this.budgetTop;
    this.changed.emit({ price: v.min <= 0 && open ? null : `${v.min}-${open ? '' : v.max}` });
  }

  setAge(v: IRange): void {
    const open = v.max >= AGE_MAX;
    this.changed.emit({ age: v.min <= AGE_MIN && open ? null : `${v.min}-${open ? 99 : v.max}` });
  }

  readonly priceText = (v: IRange) => `${fmtVnd(v.min)} - ${v.max >= this.budgetTop ? fmtVnd(this.budgetTop) + '+' : fmtVnd(v.max)}`;
  readonly priceAria = (n: number, end: 'min' | 'max') => (end === 'max' && n >= this.budgetTop ? 'Không giới hạn' : fmtVnd(n));
  readonly ageText = (v: IRange) => `${v.min} - ${v.max >= AGE_MAX ? '40+' : v.max} tuổi`;
  readonly ageAria = (n: number, end: 'min' | 'max') => (end === 'max' && n >= AGE_MAX ? '40 tuổi trở lên' : n + ' tuổi');

  setRating(value: number): void {
    this.changed.emit({ rating: this.state.rating === value ? null : value });
  }

  selectedIn(group: ITagGroup): number {
    if (group.kind === 'RANGE') return (group.rangeField === 'AGE' ? this.state.age : this.state.price) ? 1 : 0;
    return group.items.filter((t) => this.state.tags.includes(t.slug)).length;
  }
}
