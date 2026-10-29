import { ParamMap, Params } from '@angular/router';

// Trạng thái bộ lọc của SCR-02 (UC-DIS-04). URL là nơi lưu duy nhất: đọc từ query params, đổi lọc thì ghi lại URL,
// nên sao chép URL mở ở tab khác vẫn ra cùng kết quả (AC2) và nút Back của trình duyệt quay lại bộ lọc trước.
export interface FilterState {
  q: string;
  categories: string[]; // slug danh mục (chỉ ở /san-pham và /tim-kiem; /danh-muc/:slug lấy từ đường dẫn)
  axes: string[]; // the-thao, anime, game
  tags: string[]; // slug tag, nhiều nhóm
  price: string | null; // "min-max" (UC-DIS-04 nhánh 2c: ?gia=0-300000), max có thể bỏ trống
  age: string | null; // "18-25"
  rating: number | null; // 3 hoặc 4
  chip: string | null;
  sort: string | null;
  page: number;
}

export const EMPTY_FILTER: FilterState = {
  q: '',
  categories: [],
  axes: [],
  tags: [],
  price: null,
  age: null,
  rating: null,
  chip: null,
  sort: null,
  page: 1,
};

export const CHIPS = [
  { value: 'ban-chay', label: 'Bán chạy' },
  { value: 'moi', label: 'Mới' },
  { value: 'giam-gia', label: 'Đang giảm giá' },
  { value: 'danh-gia-cao', label: 'Đánh giá cao' },
  { value: 'goi-y-ai', label: 'Gợi ý bởi AI' },
];

// Chip "Dưới 300.000đ" là lối tắt của Ngân sách (UC-DIS-04 AC5)
export const UNDER_300K = '0-300000';

export const SORTS = [
  { value: '', label: 'Phổ biến nhất' },
  { value: 'gia-tang', label: 'Giá tăng dần' },
  { value: 'gia-giam', label: 'Giá giảm dần' },
  { value: 'moi-nhat', label: 'Mới nhất' },
];

export const AXES = [
  { value: 'the-thao', label: 'Thể thao' },
  { value: 'anime', label: 'Anime' },
  { value: 'game', label: 'Game' },
];

// Giá trị URL của 1 tag nhóm khoảng: Ngân sách -> ?gia=300000-500000 (bỏ trống max là không giới hạn), Độ tuổi -> ?age=18-25
export function rangeValue(field: 'PRICE' | 'AGE' | null | undefined, range: { min: number; max: number | null }): string {
  return field === 'AGE' ? `${range.min}-${range.max ?? 99}` : `${range.min}-${range.max ?? ''}`;
}

export const RATINGS = [
  { value: 4, label: 'Từ 4 sao' },
  { value: 3, label: 'Từ 3 sao' },
];

const list = (v: string | null) => (v ? v.split(',').filter(Boolean) : []);

export function readFilter(query: ParamMap): FilterState {
  const rating = Number(query.get('rating'));
  return {
    q: (query.get('q') || '').trim(),
    categories: list(query.get('category')),
    axes: list(query.get('axis')),
    tags: list(query.get('tags')),
    price: query.get('gia'),
    age: query.get('age'),
    rating: rating === 3 || rating === 4 ? rating : null,
    chip: query.get('chip'),
    sort: query.get('sort'),
    page: Math.max(1, Number(query.get('page')) || 1),
  };
}

// Query params cho URL (bỏ giá trị rỗng để URL gọn)
export function toQueryParams(f: FilterState): Params {
  return {
    q: f.q || null,
    category: f.categories.join(',') || null,
    axis: f.axes.join(',') || null,
    tags: f.tags.join(',') || null,
    gia: f.price,
    age: f.age,
    rating: f.rating,
    chip: f.chip,
    sort: f.sort,
    page: f.page > 1 ? f.page : null,
  };
}

export function parsePrice(price: string | null): { min: number; max: number | null } | null {
  if (!price) return null;
  const [a, b] = price.split('-');
  const min = Number(a) || 0;
  const max = b === undefined || b === '' ? null : Number(b);
  return Number.isFinite(min) && (max === null || Number.isFinite(max)) ? { min, max } : null;
}

// ?age=18-25 (99 là không giới hạn trên, như mức "Từ 36 tuổi")
export function parseAge(age: string | null): { min: number; max: number } | null {
  if (!age) return null;
  const [a, b] = age.split('-').map(Number);
  return Number.isFinite(a) && Number.isFinite(b) ? { min: a, max: b } : null;
}

// Tham số gửi API-26 / API-108
export function toApiQuery(f: FilterState, pageSize: number, fixedCategory?: string): Record<string, string | number | null> {
  const price = parsePrice(f.price);
  return {
    q: f.q || null,
    category: fixedCategory || f.categories.join(',') || null,
    axis: f.axes.join(',') || null,
    tags: f.tags.join(',') || null,
    priceMin: price ? price.min : null,
    priceMax: price ? price.max : null,
    age: f.age,
    rating: f.rating,
    chip: f.chip,
    sort: f.sort,
    page: f.page,
    pageSize,
  };
}

// Số tiêu chí đang áp dụng trên thanh lọc (nút "Lọc (n)" ở Mobile - UC-DIS-04 AC4)
export function countCriteria(f: FilterState): number {
  return f.categories.length + f.axes.length + f.tags.length + (f.price ? 1 : 0) + (f.age ? 1 : 0) + (f.rating ? 1 : 0);
}

// Chỉ lọc theo giá (không tiêu chí nào khác) thì dùng API-184 theo mẫu slide (UC-DIS-04 nhánh 2c)
export function isPriceOnly(f: FilterState, hasFixedScope: boolean): boolean {
  return (
    !!parsePrice(f.price) &&
    !hasFixedScope &&
    !f.q &&
    !f.categories.length &&
    !f.axes.length &&
    !f.tags.length &&
    !f.age &&
    !f.rating &&
    !f.chip &&
    (!f.sort || f.sort === 'gia-tang' || f.sort === 'gia-giam')
  );
}

export function toggle(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
}
