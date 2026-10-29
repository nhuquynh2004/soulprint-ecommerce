import { Icon } from '../../shared/icon/icon';
import { TestBed } from '@angular/core/testing';
import { RouterModule } from '@angular/router';
import { Footer } from './footer';

describe('Footer', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RouterModule.forRoot([])],
      declarations: [Footer, Icon],
    }).compileComponents();
  });

  it('hiển thị được', async () => {
    const fixture = TestBed.createComponent(Footer);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Tra cứu đơn hàng');
  });
});
