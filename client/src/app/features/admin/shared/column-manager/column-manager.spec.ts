import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ColumnManager, ColumnDef } from './column-manager';
import { Sparkline } from '../sparkline';

const COLUMNS: ColumnDef[] = [
  { key: 'priority', label: 'Ưu tiên' },
  { key: 'code', label: 'Mã đơn', required: true },
  { key: 'total', label: 'Tổng tiền' },
  { key: 'tags', label: 'Thẻ' },
];
const KEY = 'sp.cols.test';

function create(): ColumnManager {
  TestBed.configureTestingModule({ declarations: [ColumnManager], schemas: [NO_ERRORS_SCHEMA] });
  const f = TestBed.createComponent(ColumnManager);
  f.componentInstance.columns = COLUMNS;
  f.componentInstance.storageKey = KEY;
  f.detectChanges();
  return f.componentInstance;
}

// Quản lý cột SCR-47 (UC-OPS-01 3c, AC9)
describe('ColumnManager', () => {
  beforeEach(() => localStorage.removeItem(KEY));

  it('mặc định hiện đủ cột theo thứ tự khai báo', () => {
    const c = create();
    expect(c.state().map((s) => s.key)).toEqual(['priority', 'code', 'total', 'tags']);
    expect(c.visibleCount()).toBe(4);
  });

  it('ẩn cột Thẻ, đưa Tổng tiền lên sau Mã đơn: tải lại vẫn giữ (AC9)', () => {
    const c = create();
    c.toggle('tags');
    c.move(0, 2);
    TestBed.resetTestingModule();
    const again = create();
    expect(again.state().map((s) => s.key)).toEqual(['code', 'total', 'priority', 'tags']);
    expect(again.state().find((s) => s.key === 'tags')!.visible).toBe(false);
  });

  it('Khôi phục mặc định về đủ cột và thứ tự ban đầu (AC9)', () => {
    const c = create();
    c.toggle('tags');
    c.move(3, 0);
    c.reset();
    expect(c.state().map((s) => s.key)).toEqual(['priority', 'code', 'total', 'tags']);
    expect(c.visibleCount()).toBe(4);
  });

  it('cột bắt buộc (Mã đơn) luôn hiện kể cả khi dữ liệu lưu bị sửa tay', () => {
    localStorage.setItem(KEY, JSON.stringify([{ key: 'code', visible: false }, { key: 'priority', visible: true }]));
    const c = create();
    expect(c.state().find((s) => s.key === 'code')!.visible).toBe(true);
    // cột mới chưa có trong dữ liệu lưu được thêm vào cuối
    expect(c.state().map((s) => s.key)).toEqual(['code', 'priority', 'total', 'tags']);
  });
});

// Đường xu hướng thanh Phân tích (API-158)
describe('Sparkline', () => {
  it('chuỗi n giá trị thành n điểm trải hết chiều rộng', () => {
    TestBed.configureTestingModule({ declarations: [Sparkline] });
    const f = TestBed.createComponent(Sparkline);
    f.componentInstance.values = [0, 5, 10];
    const pts = f.componentInstance.points().split(' ');
    expect(pts.length).toBe(3);
    expect(pts[0].startsWith('0.0,')).toBe(true);
    expect(pts[2].startsWith('88.0,')).toBe(true);
  });
});
