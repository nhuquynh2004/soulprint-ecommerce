import { Icon } from '../../shared/icon/icon';
import { TestBed } from '@angular/core/testing';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NotFound } from './not-found';

describe('NotFound', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RouterModule.forRoot([]), FormsModule],
      declarations: [NotFound, Icon],
    }).compileComponents();
  });

  it('hiển thị được', async () => {
    const fixture = TestBed.createComponent(NotFound);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Sâu Béo lạc giữa đại dương');
  });
});
