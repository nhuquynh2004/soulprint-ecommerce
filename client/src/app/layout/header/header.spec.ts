import { Icon } from '../../shared/icon/icon';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Header } from './header';
import { ThemeService } from '../../services/theme';

describe('Header', () => {
  let fixture: ComponentFixture<Header>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RouterModule.forRoot([]), FormsModule],
      providers: [provideHttpClient(), provideHttpClientTesting()],
      declarations: [Header, Icon],
    }).compileComponents();

    fixture = TestBed.createComponent(Header);
    await fixture.whenStable();
  });

  it('công tắc Sáng/Tối 2 nút đổi chế độ, bấm nút đang chọn thì giữ nguyên', () => {
    const theme = TestBed.inject(ThemeService);
    const el = fixture.nativeElement as HTMLElement;
    const target = theme.mode() === 'dark' ? 'Chế độ Sáng' : 'Chế độ Tối';
    const current = theme.mode() === 'dark' ? 'Chế độ Tối' : 'Chế độ Sáng';
    const before = theme.mode();
    el.querySelector<HTMLButtonElement>(`button[aria-label="${current}"]`)!.click();
    expect(theme.mode()).toBe(before);
    el.querySelector<HTMLButtonElement>(`button[aria-label="${target}"]`)!.click();
    expect(theme.mode()).not.toBe(before);
  });

  it('tìm kiếm chuyển sang /tim-kiem kèm query param q', () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture.componentInstance.search('  áo đấu ');
    expect(navigate).toHaveBeenCalledWith(['/tim-kiem'], { queryParams: { q: 'áo đấu' } });
  });

  it('không tìm khi ô tìm kiếm trống', () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
    fixture.componentInstance.search('   ');
    expect(navigate).not.toHaveBeenCalled();
  });
});
