import { charCount, describePersonalization, engraveConfigOf } from './cart';

// Hàm hiển thị nội dung cá nhân hóa trên dòng giỏ và đếm ký tự như server (BR-18)
describe('cart helpers', () => {
  it('mô tả In/Khắc Áo đấu và Thiết kế', () => {
    expect(describePersonalization({ type: 'IN_KHAC', mode: 'AO_DAU', top: 'MINH ANH', number: '10', bottom: '' })).toBe('MINH ANH 10');
    expect(describePersonalization({ type: 'IN_KHAC', mode: 'THUONG', text: 'HUY 1990' })).toBe('HUY 1990');
    expect(
      describePersonalization({ type: 'THIET_KE', stickers: ['A', 'B'], message: 'Chúc mừng', stickerDetails: [{ code: 'A', name: 'Bóng', image: null }, { code: 'B', name: 'Cúp', image: null }] }),
    ).toBe('Bóng, Cúp, "Chúc mừng"');
    expect(describePersonalization(null)).toBe('');
  });

  it('đếm ký tự hiển thị sau chuẩn hóa NFC, bỏ khoảng trắng đầu cuối', () => {
    expect(charCount('  Nguyễn  ')).toBe(6);
    expect(charCount('Nguyễn'.normalize('NFD'))).toBe(6);
  });

  it('cấu hình In/Khắc điền mặc định 20 và 20/20/3', () => {
    expect(engraveConfigOf({ personalization: { engrave: { mode: 'THUONG' } } }).maxChars).toBe(20);
    const j = engraveConfigOf({ personalization: { engrave: { mode: 'AO_DAU' } } });
    expect([j.topMaxChars, j.bottomMaxChars, j.numberMaxDigits]).toEqual([20, 20, 3]);
  });
});
