import { FormControl, FormGroup } from '@angular/forms';
import { futureDateValidator, matchValidator, phoneError, phoneValidator, selectCountValidator, strongPasswordValidator } from './form-validators';
import { formatCountdown } from '../classes/checkout';

describe('form-validators (Chương V: custom và cross-field validator)', () => {
  it('SĐT 10 số bắt đầu bằng 0, cho phép gõ dấu cách', () => {
    expect(phoneValidator(new FormControl('0901 234 567'))).toBeNull();
    expect(phoneValidator(new FormControl('1901234567'))).not.toBeNull();
    expect(phoneValidator(new FormControl('090123'))).not.toBeNull();
  });

  it('phoneError: chỉ báo khi đã rời ô hoặc gõ đủ 10 ký tự', () => {
    expect(phoneError('09012', false)).toBe('');
    expect(phoneError('09012', true)).toContain('10 số');
    expect(phoneError('09012345ab', false)).toContain('chữ số');
    expect(phoneError('0901 234 567', true)).toBe('');
  });

  it('đồng hồ đếm ngược: từ 1 giờ hiện HH:MM:SS, dưới 1 giờ MM:SS', () => {
    expect(formatCountdown(86303)).toBe('23:58:23');
    expect(formatCountdown(3600)).toBe('01:00:00');
    expect(formatCountdown(3599)).toBe('59:59');
    expect(formatCountdown(-5)).toBe('00:00');
  });

  it('mật khẩu mạnh: ≥ 8 ký tự, chữ hoa, số, ký tự đặc biệt (NFR-SEC-02)', () => {
    expect(strongPasswordValidator(new FormControl('Abc12345!'))).toBeNull();
    expect(strongPasswordValidator(new FormControl('abc12345!'))).not.toBeNull();
    expect(strongPasswordValidator(new FormControl('Abc12345'))).not.toBeNull();
  });

  it('xác nhận mật khẩu khác thì báo "Mật khẩu xác nhận không khớp" ở ô xác nhận (UC-ACC-01 AC3)', () => {
    const g = new FormGroup(
      { password: new FormControl('Abc12345!'), confirmPassword: new FormControl('Abc12345?') },
      { validators: matchValidator('password', 'confirmPassword') },
    );
    expect(g.valid).toBe(false);
    expect(g.get('confirmPassword')?.errors?.['mismatch']).toBe('Mật khẩu xác nhận không khớp');
    g.get('confirmPassword')?.setValue('Abc12345!');
    expect(g.valid).toBe(true);
  });

  it('chọn 1 hoặc 2 vai trò (UC-ACC-07 4Eb)', () => {
    const v = selectCountValidator(1, 2, 'Chọn 1 hoặc 2 vai trò');
    expect(v(new FormControl([]))).toEqual({ selectCount: 'Chọn 1 hoặc 2 vai trò' });
    expect(v(new FormControl(['KHO']))).toBeNull();
    expect(v(new FormControl(['KHO', 'BAN_HANG', 'QUAN_TRI']))).not.toBeNull();
  });

  it('ngày hết hạn quyền riêng phải sau hôm nay (BR-38)', () => {
    const today = new Date().toLocaleDateString('en-CA');
    const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('en-CA');
    expect(futureDateValidator(new FormControl(today))).not.toBeNull();
    expect(futureDateValidator(new FormControl(tomorrow))).toBeNull();
    expect(futureDateValidator(new FormControl(''))).toBeNull();
  });
});
