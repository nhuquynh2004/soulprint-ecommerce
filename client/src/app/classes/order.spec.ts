import { expectedLabel, noticeBucket } from './order';

// Ngày dự kiến của mốc chưa tới trên timeline SCR-19
describe('expectedLabel', () => {
  it('một ngày: "Dự kiến 17/10"', () => {
    expect(expectedLabel({ from: '2026-10-17', to: '2026-10-17' })).toBe('Dự kiến 17/10');
  });

  it('khoảng trong cùng tháng: "Dự kiến 19 - 20/10"; khác tháng ghi đủ', () => {
    expect(expectedLabel({ from: '2026-10-19', to: '2026-10-20' })).toBe('Dự kiến 19 - 20/10');
    expect(expectedLabel({ from: '2026-10-31', to: '2026-11-01' })).toBe('Dự kiến 31/10 - 01/11');
  });

  it('không có dự kiến thì rỗng', () => {
    expect(expectedLabel(null)).toBe('');
  });
});

// Gom thông báo theo ngày SCR-23
describe('noticeBucket', () => {
  const now = new Date(2026, 9, 12, 15, 0);

  it('cùng ngày là Hôm nay', () => {
    expect(noticeBucket(new Date(2026, 9, 12, 0, 5).toISOString(), now)).toBe('Hôm nay');
  });

  it('trong 6 ngày trước là Tuần này, xa hơn là Trước đó', () => {
    expect(noticeBucket(new Date(2026, 9, 10, 9, 0).toISOString(), now)).toBe('Tuần này');
    expect(noticeBucket(new Date(2026, 9, 1, 9, 0).toISOString(), now)).toBe('Trước đó');
  });
});
