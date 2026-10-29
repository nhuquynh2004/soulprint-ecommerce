import { Component, Input, forwardRef, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { PASSWORD_RULES } from '../form-validators';

// Ô mật khẩu có nút mắt ẩn/hiện (component PasswordField của bộ thiết kế).
// Cài ControlValueAccessor nên dùng được với cả [(ngModel)] (Template-driven) và formControlName (Reactive Form).
@Component({
  selector: 'app-password-field',
  standalone: false,
  templateUrl: './password-field.html',
  styleUrl: './password-field.scss',
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => PasswordField), multi: true }],
})
export class PasswordField implements ControlValueAccessor {
  @Input() inputId = '';
  @Input() placeholder = '';
  @Input() autocomplete = 'current-password';
  @Input() invalid = false;
  // Hiện danh sách điều kiện đổi màu theo từng điều kiện đạt (SCR-14, SCR-16, SCR-53)
  @Input() showRules = false;

  readonly rules = PASSWORD_RULES;
  readonly visible = signal(false);
  value = '';
  disabled = false;
  private onChange: (v: string) => void = () => {};
  onTouched: () => void = () => {};

  writeValue(v: string): void {
    this.value = v || '';
  }

  registerOnChange(fn: (v: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.disabled = disabled;
  }

  onInput(v: string): void {
    this.value = v;
    this.onChange(v);
  }

  passed(rule: (typeof PASSWORD_RULES)[number]): boolean {
    return rule.test(this.value);
  }

  get strength(): { label: string; level: number } {
    const n = this.rules.filter((r) => r.test(this.value)).length;
    if (!this.value) return { label: '', level: 0 };
    return n <= 2 ? { label: 'Yếu', level: 1 } : n === 3 ? { label: 'Trung bình', level: 2 } : { label: 'Mạnh', level: 3 };
  }
}
