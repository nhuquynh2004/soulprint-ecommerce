import { convertToParamMap } from '@angular/router';
import { EMPTY_FILTER, countCriteria, isPriceOnly, parseAge, parsePrice, readFilter, toApiQuery, toQueryParams, toggle } from './filter-state';

describe('filter-state (UC-DIS-04: bộ lọc nằm trên URL)', () => {
  it('đọc URL ra bộ lọc rồi ghi lại đúng URL cũ (AC2: chép URL sang tab mới ra cùng bộ lọc)', () => {
    const url = { tags: 'sinh-nhat,tot-nghiep,bong-da', axis: 'anime', gia: '0-300000', sort: 'gia-tang', page: '2' };
    const f = readFilter(convertToParamMap(url));
    expect(f.tags).toEqual(['sinh-nhat', 'tot-nghiep', 'bong-da']);
    expect(f.page).toBe(2);
    const back = Object.fromEntries(Object.entries(toQueryParams(f)).filter(([, v]) => v !== null));
    expect(back).toEqual({ tags: 'sinh-nhat,tot-nghiep,bong-da', axis: 'anime', gia: '0-300000', sort: 'gia-tang', page: 2 });
  });

  it('giá trị đánh giá lạ bị bỏ qua, trang không hợp lệ về 1', () => {
    const f = readFilter(convertToParamMap({ rating: '9', page: 'abc' }));
    expect(f.rating).toBeNull();
    expect(f.page).toBe(1);
  });

  it('ngân sách "min-max" và "min-" (không giới hạn trên)', () => {
    expect(parsePrice('0-300000')).toEqual({ min: 0, max: 300000 });
    expect(parsePrice('1000000-')).toEqual({ min: 1000000, max: null });
    expect(parsePrice(null)).toBeNull();
  });

  it('độ tuổi "min-max", 99 là không giới hạn trên', () => {
    expect(parseAge('18-25')).toEqual({ min: 18, max: 25 });
    expect(parseAge('36-99')).toEqual({ min: 36, max: 99 });
    expect(parseAge('abc')).toBeNull();
    expect(parseAge(null)).toBeNull();
  });

  it('tham số API: ngân sách tách thành priceMin/priceMax, danh mục cố định của /danh-muc/:slug', () => {
    const q = toApiQuery({ ...EMPTY_FILTER, price: '300000-500000' }, 12, 'me-man');
    expect(q['priceMin']).toBe(300000);
    expect(q['priceMax']).toBe(500000);
    expect(q['category']).toBe('me-man');
    expect(q['pageSize']).toBe(12);
  });

  it('chỉ lọc giá (không tiêu chí khác) thì dùng API-184 (nhánh 2c)', () => {
    expect(isPriceOnly({ ...EMPTY_FILTER, price: '0-300000' }, false)).toBe(true);
    expect(isPriceOnly({ ...EMPTY_FILTER, price: '0-300000', sort: 'gia-giam' }, false)).toBe(true);
    expect(isPriceOnly({ ...EMPTY_FILTER, price: '0-300000', tags: ['bong-da'] }, false)).toBe(false);
    expect(isPriceOnly({ ...EMPTY_FILTER, price: '0-300000', sort: 'moi-nhat' }, false)).toBe(false);
    expect(isPriceOnly({ ...EMPTY_FILTER, price: '0-300000' }, true)).toBe(false);
  });

  it('đếm số tiêu chí cho nút "Lọc (n)" ở Mobile (AC4)', () => {
    expect(countCriteria({ ...EMPTY_FILTER, tags: ['a', 'b'], axes: ['anime'], price: '0-300000' })).toBe(4);
  });

  it('bật/tắt một giá trị trong nhóm', () => {
    expect(toggle(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggle(['a', 'b'], 'a')).toEqual(['b']);
  });
});
