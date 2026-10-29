import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { IProduct } from './product';

// Tư vấn quà AI (UC-DIS-05, 07 API-59, API-198). Khảo sát gửi slug tag; noteTags là khóa "NHOM:slug" server rút từ mô tả.

export const AGE_MIN = 6;
export const AGE_MAX = 40; // 40 là "40+"
export const BUDGET_MAX = 1000000; // đầu trên tối thiểu; kéo hết về đầu trên là không giới hạn
// Đầu trên thực tế = giá cao nhất của sản phẩm được gợi ý (API-198 budgetMax), đặt khi mở form
let budgetTop = BUDGET_MAX;
export const budgetTopOf = () => budgetTop;
export function setBudgetTop(n: number | null | undefined): void {
  budgetTop = Math.max(BUDGET_MAX, Number(n) || 0);
}
export const BUDGET_STEP = 50000;

export interface IRecommendInput {
  recipient: string | null; // slug nhóm DOI_TUONG hoặc "khac"
  occasions: string[];
  hobbies: string[];
  personalities: string[]; // slug nhóm TINH_CACH hoặc PHONG_CACH
  noteTags?: string[];
  ageMin: number | null;
  ageMax: number | null;
  budgetMin: number | null;
  budgetMax: number | null;
  note: string;
  preferPersonalized?: boolean;
}

export interface IAiProduct extends IProduct {
  defaultVariantSku: string | null; // 1 biến thể còn hàng: thêm thẳng vào giỏ
  needsOptions: boolean; // nhiều biến thể: mở SCR-03 để chọn
}

export interface IAiResult {
  product: IAiProduct;
  score: number; // xác suất "phù hợp" 0-1
  reasons: string[];
  overBudget: boolean;
}

export interface IAiCombo {
  name: string;
  products: IAiProduct[];
  total: number;
  overBudget: boolean;
  reasons: string[];
  canAddAll: boolean;
}

export interface ICriterionChip {
  key: string;
  type: 'recipient' | 'occasions' | 'hobbies' | 'personalities' | 'noteTags' | 'age' | 'budget';
  value: string | null; // khóa "NHOM:slug" với chip tag
  label: string;
}

export interface IAiQuota {
  member: boolean;
  limit: number | null;
  remaining: number | null;
  budgetMax?: number;
}

export interface IRecommendation {
  sessionId: string;
  summary: string;
  input: IRecommendInput;
  criteria: ICriterionChip[];
  results: IAiResult[];
  combos: IAiCombo[];
  matchedAll: boolean;
  relaxSuggestions: { label: string; input: IRecommendInput }[];
  notes: string[];
  quota: IAiQuota;
}

// Giá trị form SCR-10 (Reactive Form)
export interface IAdvisorForm {
  recipient: string | null;
  occasions: string[];
  hobbies: string[];
  personalities: string[];
  age: { min: number; max: number };
  budget: { min: number; max: number };
  note: string;
}

export const ageChosen = (a: { min: number; max: number }) => a.min > AGE_MIN || a.max < AGE_MAX;
export const budgetChosen = (b: { min: number; max: number }) => b.min > 0 || b.max < budgetTop;

// Số tiêu chí đã chọn (dòng "x tiêu chí đã chọn")
export function criteriaCount(v: IAdvisorForm): number {
  return (
    (v.recipient ? 1 : 0) +
    v.occasions.length +
    v.hobbies.length +
    v.personalities.length +
    (ageChosen(v.age) ? 1 : 0) +
    (budgetChosen(v.budget) ? 1 : 0) +
    (v.note.trim() ? 1 : 0)
  );
}

// 3Ea: validator nhóm "ít nhất một thông tin" (form-level custom validator - Chương V)
export const atLeastOneCriterion: ValidatorFn = (group: AbstractControl): ValidationErrors | null =>
  criteriaCount(group.value as IAdvisorForm) > 0 ? null : { atLeastOne: true };

// Form -> body API-59. Thanh kéo ở 2 đầu mặc định nghĩa là không chọn; ngân sách 1.000.000đ+ là không giới hạn trên.
export function toRequest(v: IAdvisorForm): IRecommendInput {
  return {
    recipient: v.recipient,
    occasions: v.occasions,
    hobbies: v.hobbies,
    personalities: v.personalities,
    ageMin: ageChosen(v.age) ? v.age.min : null,
    ageMax: ageChosen(v.age) ? v.age.max : null,
    budgetMin: budgetChosen(v.budget) && v.budget.min > 0 ? v.budget.min : null,
    budgetMax: budgetChosen(v.budget) && v.budget.max < budgetTop ? v.budget.max : null,
    note: v.note.trim(),
  };
}

// Ngược lại: điền form từ tiêu chí đang áp dụng ("Sửa tiêu chí", quay lại sau khi đăng nhập)
export function toFormValue(i: IRecommendInput): IAdvisorForm {
  return {
    recipient: i.recipient,
    occasions: [...i.occasions],
    hobbies: [...i.hobbies],
    personalities: [...i.personalities],
    age: { min: i.ageMin ?? AGE_MIN, max: i.ageMax ?? AGE_MAX },
    budget: { min: i.budgetMin ?? 0, max: Math.min(i.budgetMax ?? budgetTop, budgetTop) },
    note: i.note || '',
  };
}

const slugOf = (key: string | null) => (key ? key.slice(key.indexOf(':') + 1) : '');

// 8c: bỏ 1 chip tiêu chí, giữ noteTags để server không rút lại tag vừa bỏ từ mô tả
export function withoutChip(i: IRecommendInput, chip: ICriterionChip): IRecommendInput {
  const n: IRecommendInput = { ...i, occasions: [...i.occasions], hobbies: [...i.hobbies], personalities: [...i.personalities], noteTags: [...(i.noteTags || [])] };
  const slug = slugOf(chip.value);
  if (chip.type === 'recipient') n.recipient = null;
  else if (chip.type === 'age') n.ageMin = n.ageMax = null;
  else if (chip.type === 'budget') n.budgetMin = n.budgetMax = null;
  else if (chip.type === 'noteTags') n.noteTags = n.noteTags!.filter((k) => k !== chip.value);
  else n[chip.type] = n[chip.type].filter((s) => s !== slug);
  return n;
}

// 8b, 6Eb: tiêu chí -> query params của SCR-02 (OR trong nhóm, AND giữa nhóm như UC-DIS-04)
export function toFilterParams(i: IRecommendInput): Record<string, string | null> {
  const tags = [
    ...(i.recipient && i.recipient !== 'khac' ? [i.recipient] : []),
    ...i.occasions,
    ...i.hobbies,
    ...i.personalities,
    ...(i.noteTags || []).map(slugOf),
  ];
  const hasPrice = (i.budgetMin || 0) > 0 || i.budgetMax != null;
  const hasAge = i.ageMin != null || i.ageMax != null;
  return {
    tags: [...new Set(tags)].join(',') || null,
    gia: hasPrice ? `${i.budgetMin || 0}-${i.budgetMax ?? ''}` : null,
    age: hasAge ? `${i.ageMin ?? AGE_MIN}-${i.ageMax ?? AGE_MAX}` : null,
  };
}

export const pct = (score: number) => Math.max(1, Math.min(99, Math.round(score * 100)));

// Lời mở đầu kết quả: "Sâu chọn được 3 món và 1 combo hợp với anh ấy nè..."
export function introOf(r: IRecommendation): string {
  const combo = r.combos.length ? ` và ${r.combos.length} combo` : '';
  return `Sâu chọn được ${r.results.length} món${combo} hợp với người nhận nè. Lý do Sâu ghi ngay dưới từng món nha!`;
}

export const fmtVnd = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + 'đ';

export const ageLabel = (a: { min: number; max: number }) => `${a.min} - ${a.max >= AGE_MAX ? '40+' : a.max} tuổi`;
export const budgetLabel = (b: { min: number; max: number }) => `${fmtVnd(b.min)} - ${b.max >= budgetTop ? fmtVnd(budgetTop) + '+' : fmtVnd(b.max)}`;

// Tiêu chí còn giữ khi Guest hết lượt rồi đăng nhập (2Ea)
export const DRAFT_KEY = 'sp_ai_draft';
