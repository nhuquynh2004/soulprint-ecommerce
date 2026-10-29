import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

// Validator dùng chung cho Reactive Form (slide Chương V): custom validator và cross-field validator.
// Quy tắc giống server (utils/validators.js) để báo lỗi ngay khi rời ô; server vẫn kiểm tra lại.

// SĐT 10 số, bắt đầu bằng 0 (cho phép gõ có dấu cách)
export const phoneValidator: ValidatorFn = (control) => {
  const v = String(control.value || '').replace(/[\s.]/g, '');
  return !v || /^0\d{9}$/.test(v) ? null : { phone: 'Số điện thoại cần 10 số, bắt đầu bằng 0' };
};

// Cùng quy tắc cho ô nhập dùng signal (không Reactive Form): báo khi đã rời ô hoặc gõ đủ 10 ký tự
export function phoneError(raw: string, touched = true): string {
  const v = String(raw || '').replace(/[\s.]/g, '');
  if (!v || (!touched && v.length < 10)) return '';
  if (/\D/.test(v)) return 'Số điện thoại chỉ gồm chữ số';
  return /^0\d{9}$/.test(v) ? '' : 'Số điện thoại cần 10 số, bắt đầu bằng 0';
}

// Các điều kiện mật khẩu (NFR-SEC-02) - dùng cả cho danh sách đổi màu theo từng điều kiện
export const PASSWORD_RULES = [
  { key: 'length', label: 'Tối thiểu 8 ký tự', test: (v: string) => v.length >= 8 },
  { key: 'upper', label: 'Có chữ hoa', test: (v: string) => /[A-Z]/.test(v) },
  { key: 'digit', label: 'Có chữ số', test: (v: string) => /\d/.test(v) },
  { key: 'special', label: 'Có ký tự đặc biệt', test: (v: string) => /[^A-Za-z0-9]/.test(v) },
];

export const strongPasswordValidator: ValidatorFn = (control) => {
  const v = String(control.value || '');
  if (!v) return null;
  return PASSWORD_RULES.every((r) => r.test(v)) ? null : { weakPassword: 'Mật khẩu cần tối thiểu 8 ký tự, gồm chữ hoa, số và ký tự đặc biệt' };
};

// Cross-field: ô xác nhận phải khớp ô mật khẩu (đặt ở FormGroup). Lỗi gắn vào ô xác nhận để hiện dưới ô đó.
export function matchValidator(field: string, confirmField: string): ValidatorFn {
  return (group: AbstractControl): ValidationErrors | null => {
    const a = group.get(field)?.value;
    const confirm = group.get(confirmField);
    if (!confirm) return null;
    const mismatch = !!confirm.value && a !== confirm.value;
    const errors = { ...(confirm.errors || {}) };
    if (mismatch) errors['mismatch'] = 'Mật khẩu xác nhận không khớp';
    else delete errors['mismatch'];
    confirm.setErrors(Object.keys(errors).length ? errors : null);
    return mismatch ? { mismatch: true } : null;
  };
}

// Nhóm ô chọn: chọn từ min đến max mục (VD "Chọn 1 hoặc 2 vai trò" - UC-ACC-07 4Eb)
export function selectCountValidator(min: number, max: number, message: string): ValidatorFn {
  return (control) => {
    const list = control.value as unknown[];
    const n = Array.isArray(list) ? list.length : 0;
    return n >= min && n <= max ? null : { selectCount: message };
  };
}

// Ngày (yyyy-mm-dd) phải sau hôm nay (BR-38). Trống = không thời hạn.
export const futureDateValidator: ValidatorFn = (control) => {
  if (!control.value) return null;
  const today = new Date().toLocaleDateString('en-CA');
  return String(control.value) > today ? null : { futureDate: 'Ngày hết hạn phải sau hôm nay' };
};

// Thông báo lỗi đầu tiên của 1 ô (validator trả chuỗi thông báo hoặc lỗi chuẩn của Angular)
export function firstError(control: AbstractControl | null, labels: Record<string, string> = {}): string {
  if (!control || !control.errors || !(control.touched || control.dirty)) return '';
  const [key, value] = Object.entries(control.errors)[0];
  if (typeof value === 'string') return value;
  if (labels[key]) return labels[key];
  if (key === 'required') return 'Vui lòng nhập thông tin này';
  if (key === 'email') return 'Email không hợp lệ';
  if (key === 'minlength') return `Cần ít nhất ${value.requiredLength} ký tự`;
  if (key === 'maxlength') return `Tối đa ${value.requiredLength} ký tự`;
  return 'Giá trị không hợp lệ';
}

// Cross-field (UC-CAT-01, ghi chú kỹ thuật): giá sale phải nhỏ hơn giá bán; thời gian kết thúc sale sau thời gian bắt đầu.
// Đặt ở FormGroup giá; lỗi gắn vào ô giá sale / ô kết thúc để hiện ngay dưới ô.
export const salePriceValidator: ValidatorFn = (group: AbstractControl): ValidationErrors | null => {
  const price = Number(group.get('price')?.value);
  const saleCtl = group.get('salePrice');
  const endCtl = group.get('saleEndAt');
  const sale = saleCtl?.value;
  const start = group.get('saleStartAt')?.value;
  const end = endCtl?.value;
  const result: ValidationErrors = {};
  const setErr = (ctl: AbstractControl | null | undefined, key: string, msg: string | null) => {
    if (!ctl) return;
    const errors = { ...(ctl.errors || {}) };
    if (msg) errors[key] = msg;
    else delete errors[key];
    ctl.setErrors(Object.keys(errors).length ? errors : null);
  };
  const saleBad = sale !== null && sale !== '' && !(Number(sale) > 0 && price > 0 && Number(sale) < price);
  setErr(saleCtl, 'saleGtePrice', saleBad ? 'Giá sale phải nhỏ hơn giá bán' : null);
  if (saleBad) result['saleGtePrice'] = true;
  const endBad = !!start && !!end && new Date(end) <= new Date(start);
  setErr(endCtl, 'endBeforeStart', endBad ? 'Thời gian kết thúc phải sau thời gian bắt đầu' : null);
  if (endBad) result['endBeforeStart'] = true;
  return Object.keys(result).length ? result : null;
};

// Cross-field: ngày kết thúc phải sau ngày bắt đầu (UC-CAT-05, UC-CAT-06 5Ea). Đặt ở FormGroup có startAt, endAt.
export const dateRangeValidator: ValidatorFn = (g: AbstractControl): ValidationErrors | null => {
  const s = g.get('startAt')?.value;
  const e = g.get('endAt')?.value;
  return s && e && new Date(e) <= new Date(s) ? { dateRange: 'Ngày kết thúc phải sau ngày bắt đầu' } : null;
};

// Đổi ISO sang giá trị ô datetime-local (giờ máy người dùng)
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
