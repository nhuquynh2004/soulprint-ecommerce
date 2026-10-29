import { Icon } from './icon';
import { TestBed } from '@angular/core/testing';

describe('Icon', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ declarations: [Icon] }).compileComponents();
  });

  it('dùng tệp SVG theo tên làm mask và đặt kích thước', async () => {
    const fixture = TestBed.createComponent(Icon);
    fixture.componentRef.setInput('name', 'cart');
    fixture.componentRef.setInput('size', 20);
    await fixture.whenStable();
    const span = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.sp-icon')!;
    expect(span.style.getPropertyValue('--sp-icon')).toContain('/assets/icons/cart.svg');
    expect(span.style.width).toBe('20px');
    expect(span.getAttribute('aria-hidden')).toBe('true');
  });
});
