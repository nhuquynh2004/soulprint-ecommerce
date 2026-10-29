import { VndPipe } from './vnd-pipe';
import { Pagination } from './pagination/pagination';

describe('VndPipe', () => {
  const pipe = new VndPipe();

  it('định dạng tiền VNĐ có dấu chấm ngăn cách', () => {
    expect(pipe.transform(399000)).toBe('399.000đ');
    expect(pipe.transform(1250000)).toBe('1.250.000đ');
    expect(pipe.transform(0)).toBe('0đ');
    expect(pipe.transform(null)).toBe('');
  });
});

describe('Pagination', () => {
  it('ít trang thì hiện đủ, nhiều trang thì rút gọn bằng dấu "..."', () => {
    const p = new Pagination();
    p.pageSize = 12;
    p.total = 36;
    expect(p.pages).toEqual([1, 2, 3]);
    p.total = 12 * 12;
    p.page = 6;
    expect(p.pages).toEqual([1, 0, 5, 6, 7, 0, 12]);
  });
});
