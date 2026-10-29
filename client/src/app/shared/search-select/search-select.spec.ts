import { TestBed } from '@angular/core/testing';
import { SearchSelect } from './search-select';

describe('SearchSelect', () => {
  const provinces = [
    { value: 1, label: 'Thành phố Hà Nội' },
    { value: 79, label: 'Thành phố Hồ Chí Minh' },
    { value: 38, label: 'Tỉnh Thanh Hóa' },
  ];

  async function create() {
    await TestBed.configureTestingModule({ declarations: [SearchSelect] }).compileComponents();
    const fixture = TestBed.createComponent(SearchSelect);
    fixture.componentRef.setInput('options', provinces);
    await fixture.whenStable();
    return fixture.componentInstance;
  }

  it('gõ không dấu và gõ tắt chữ đầu vẫn ra tỉnh', async () => {
    const c = await create();
    c.onInput('ho chi minh');
    expect(c.results().map((o) => o.value)).toEqual([79]);
    c.onInput('hcm');
    expect(c.results().map((o) => o.value)).toEqual([79]);
    c.onInput('tp hcm');
    expect(c.results().map((o) => o.value)).toEqual([79]);
  });

  it('khớp đầu tên đứng trước và chọn bằng phím', async () => {
    const c = await create();
    let picked: string | number = '';
    c.registerOnChange((v) => (picked = v));
    c.onInput('ha');
    expect(c.results()[0].value).toBe(1);
    c.onKey(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(picked).toBe(1);
    expect(c.text).toBe('Thành phố Hà Nội');
  });

  it('gõ dở rồi rời ô thì trả lại tên đang chọn', async () => {
    const c = await create();
    c.writeValue(38);
    c.show();
    c.onInput('xyz');
    c.close();
    expect(c.text).toBe('Tỉnh Thanh Hóa');
  });
});
