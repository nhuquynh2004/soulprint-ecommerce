import { initials, isProposal, validContact } from './chat';

// Hàm dùng chung của chat SCR-29, SCR-52 (UC-CSK-01 đến CSK-04)
describe('chat', () => {
  it('initials lấy chữ đầu của 2 từ cuối, tên rỗng thì "?"', () => {
    expect(initials('Nguyễn Minh Anh')).toBe('MA');
    expect(initials('  lan ')).toBe('L');
    expect(initials(null)).toBe('?');
  });

  it('validContact nhận SĐT 10 số bắt đầu bằng 0 (có dấu cách, chấm) hoặc email', () => {
    expect(validContact('0901 234 567')).toBe(true);
    expect(validContact('0901.234.567')).toBe(true);
    expect(validContact('khach@example.com')).toBe(true);
    expect(validContact('901234567')).toBe(false);
    expect(validContact('abc')).toBe(false);
    expect(validContact('khach@example')).toBe(false);
  });

  it('isProposal nhận ra đề xuất chuyển ngữ (UC-CSK-03), chưa lưu tin', () => {
    expect(isProposal({ needsConfirm: true, softened: 'Mình chưa hài lòng' } as never)).toBe(true);
    expect(isProposal({ messages: [] } as never)).toBe(false);
  });
});
