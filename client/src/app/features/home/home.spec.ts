import { Icon } from '../../shared/icon/icon';
import { ProductCard } from '../../shared/product-card/product-card';
import { Rating } from '../../shared/rating/rating';
import { VndPipe } from '../../shared/vnd-pipe';
import { BulkOrderNote } from '../../shared/bulk-order-note/bulk-order-note';
import { TestBed } from '@angular/core/testing';
import { RouterModule } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Home } from './home';

describe('Home', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RouterModule.forRoot([])],
      declarations: [Home, Icon, ProductCard, Rating, VndPipe, BulkOrderNote],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  it('không có banner nào thì dùng banner mặc định, các khối hiện theo thứ tự API trả về', async () => {
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    const sections = [
      { id: 'banners', type: 'banners', settings: {}, data: { items: [] } },
      {
        id: 'categories',
        type: 'categories',
        settings: { title: 'Mua theo nhu cầu' },
        data: { items: [{ _id: '1', name: 'Trạm bù nước', slug: 'tram-bu-nuoc', description: '' }] },
      },
    ];
    http.expectOne('/api/home').flush(JSON.stringify({ sections }));
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Tìm món quà hoàn hảo dành tặng chàng');
    expect(el.textContent).toContain('Mua theo nhu cầu');
    expect(el.querySelector('a[href="/danh-muc/tram-bu-nuoc"]')).toBeTruthy();
  });

  it('lỗi tải thì hiện "Không tải được nội dung" và nút Thử lại (UC-DIS-01 2Eb)', async () => {
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    // retry(3): lần gọi đầu + 3 lần thử lại
    for (let i = 0; i < 4; i++) http.expectOne('/api/home').flush('lỗi', { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Không tải được nội dung');
    expect(el.querySelector('button')?.textContent).toContain('Thử lại');
  });
});
