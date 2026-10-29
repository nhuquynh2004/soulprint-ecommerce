import { formatCountdown, optionKeyOf, voucherBadge } from './checkout';

// Nhãn ưu đãi ngắn trên thẻ voucher (SCR-20, hộp "Chọn từ kho ưu đãi" ở SCR-07)
describe('voucherBadge', () => {
  it('giảm theo % hiện -10%', () => {
    expect(voucherBadge({ type: 'PERCENT', value: 10 })).toBe('-10%');
  });

  it('giảm số tiền chẵn nghìn hiện -50K, lẻ thì hiện đủ', () => {
    expect(voucherBadge({ type: 'FIXED', value: 50000 })).toBe('-50K');
    expect(voucherBadge({ type: 'FIXED', value: 12500 })).toBe('-12500đ');
  });

  it('miễn phí vận chuyển hiện 0đ', () => {
    expect(voucherBadge({ type: 'FREESHIP', value: 30000 })).toBe('0đ');
  });
});

// SCR-07 điền lại lựa chọn thanh toán khi quay về từ cổng
describe('optionKeyOf', () => {
  it('COD toàn bộ', () => {
    expect(optionKeyOf({ paymentChoice: 'COD', remainingMethod: null })).toBe('COD');
  });

  it('online, phần còn lại COD là đặt cọc', () => {
    expect(optionKeyOf({ paymentChoice: 'ONLINE', remainingMethod: 'COD' })).toBe('DEPOSIT_COD');
  });

  it('online không có phần còn lại là trả trước 100%', () => {
    expect(optionKeyOf({ paymentChoice: 'ONLINE', remainingMethod: null })).toBe('ONLINE');
    expect(optionKeyOf({ paymentChoice: 'ONLINE' })).toBe('ONLINE');
  });
});

// Đồng hồ phiên thanh toán SCR-08 (hạn 15 phút)
describe('formatCountdown', () => {
  it('15 phút hiện 15:00, 1 phút 5 giây hiện 01:05', () => {
    expect(formatCountdown(900)).toBe('15:00');
    expect(formatCountdown(65)).toBe('01:05');
  });

  it('hết giờ hoặc số âm hiện 00:00', () => {
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(-12)).toBe('00:00');
  });
});
