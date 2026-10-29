import { AfterViewInit, Directive, ElementRef, HostListener, OnDestroy, inject } from '@angular/core';

// Thanh tab, chip, hàng thẻ cuộn ngang: khi không đủ chỗ thì vuốt/kéo ngang, ẩn thanh cuộn,
// mép mờ báo còn nội dung (lớp .has-more-start / .has-more-end, style ở _components.scss),
// tab đang chọn tự cuộn vào giữa. Gắn tự động theo tên lớp nên không phải sửa từng template.
// Không áp cho bảng (.sp-table-wrap): bảng giữ thanh cuộn để biết còn cột.
// máy tính dùng chuột thì (1) nhấn giữ và kéo để cuộn, (2) rê chuột vào 1/3 bên trái hoặc bên phải
// thì thanh tự trượt về phía đó, càng gần mép càng nhanh; 1/3 giữa đứng yên. Điện thoại vẫn vuốt như cũ.
const DRAG_THRESHOLD = 6; // px: kéo ít hơn vẫn tính là bấm tab
const MAX_SPEED = 9; // px mỗi khung hình khi chuột sát mép

@Directive({
  selector:
    '.sp-policy__toc, .sp-chips, .sp-subtabs, .sp-hscroll, .sp-ostep, .sp-otabs, .sp-vtabs, .sp-tabs2, .sp-rqtabs, .db-range, .sp-ntabs, .sp-gallery__thumbs, .sp-tabs__list',
  standalone: false,
  host: { class: 'sp-tabscroll' },
})
export class TabScroll implements AfterViewInit, OnDestroy {
  private readonly el = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
  private observer?: ResizeObserver;
  private mutation?: MutationObserver;

  // Kéo bằng chuột
  private drag: { x: number; left: number; moved: boolean } | null = null;
  // Rê chuột ở mép: tốc độ hiện tại (âm là sang trái) và khung hình đang chạy
  private speed = 0;
  private frame = 0;

  ngAfterViewInit(): void {
    this.observer = new ResizeObserver(() => this.update());
    this.observer.observe(this.el);
    // Tab đổi trạng thái chọn (routerLinkActive, signal) thì cuộn tab đó vào giữa. Bỏ qua thay đổi lớp của chính thanh
    // (has-more-start/end, is-dragging): trước đây cuộn làm đổi lớp mép mờ, thanh tự kéo về tab đang chọn
    this.mutation = new MutationObserver((list) => {
      if (list.some((m) => m.target !== this.el)) this.centerActive();
    });
    this.mutation.observe(this.el, { subtree: true, attributes: true, attributeFilter: ['class', 'aria-selected', 'aria-current'], childList: true });
    this.centerActive('instant');
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    this.mutation?.disconnect();
    cancelAnimationFrame(this.frame);
  }

  @HostListener('scroll')
  update(): void {
    const { scrollLeft, scrollWidth, clientWidth } = this.el;
    this.el.classList.toggle('has-more-start', scrollLeft > 2);
    this.el.classList.toggle('has-more-end', scrollLeft + clientWidth < scrollWidth - 2);
  }

  private get scrollable(): boolean {
    return this.el.scrollWidth > this.el.clientWidth + 2;
  }

  // Chuột không có cuộn ngang: lăn bánh xe dọc thì cuộn ngang khi thanh còn chỗ để cuộn
  @HostListener('wheel', ['$event'])
  onWheel(e: WheelEvent): void {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || !this.scrollable) return;
    const max = this.el.scrollWidth - this.el.clientWidth;
    const next = this.el.scrollLeft + e.deltaY;
    if ((e.deltaY < 0 && this.el.scrollLeft <= 0) || (e.deltaY > 0 && this.el.scrollLeft >= max)) return; // hết đường thì để trang cuộn
    e.preventDefault();
    this.el.scrollLeft = Math.max(0, Math.min(max, next));
  }

  // ===== Kéo bằng chuột =====

  @HostListener('pointerdown', ['$event'])
  onDown(e: PointerEvent): void {
    if (e.pointerType !== 'mouse' || e.button !== 0 || !this.scrollable) return;
    this.drag = { x: e.clientX, left: this.el.scrollLeft, moved: false };
  }

  @HostListener('pointermove', ['$event'])
  onMove(e: PointerEvent): void {
    if (e.pointerType !== 'mouse' || !this.scrollable) return;
    if (this.drag) {
      const dx = e.clientX - this.drag.x;
      if (!this.drag.moved && Math.abs(dx) < DRAG_THRESHOLD) return;
      if (!this.drag.moved) {
        this.drag.moved = true;
        this.el.classList.add('is-dragging');
        this.stopEdge();
      }
      this.el.scrollLeft = this.drag.left - dx;
      return;
    }
    this.edgeScroll(e.clientX);
  }

  @HostListener('document:pointerup')
  onUp(): void {
    if (!this.drag) return;
    const moved = this.drag.moved;
    this.drag = null;
    this.el.classList.remove('is-dragging');
    // Vừa kéo xong thì bỏ cú click theo sau để không chuyển tab ngoài ý muốn
    if (moved) this.el.addEventListener('click', (ev) => (ev.stopPropagation(), ev.preventDefault()), { capture: true, once: true });
  }

  @HostListener('pointerleave')
  onLeave(): void {
    this.stopEdge();
  }

  // ===== Rê chuột ở 1/3 hai bên =====

  private edgeScroll(clientX: number): void {
    const r = this.el.getBoundingClientRect();
    const zone = r.width / 3;
    const fromLeft = clientX - r.left;
    const fromRight = r.right - clientX;
    // Càng sâu vào vùng mép càng nhanh (bình phương để sát ranh giới 1/3 gần như đứng yên)
    const depth = (d: number) => Math.pow(Math.max(0, Math.min(1, (zone - d) / zone)), 2);
    if (fromLeft < zone && this.el.scrollLeft > 0) this.speed = -MAX_SPEED * depth(fromLeft);
    else if (fromRight < zone && this.el.scrollLeft + this.el.clientWidth < this.el.scrollWidth) this.speed = MAX_SPEED * depth(fromRight);
    else this.speed = 0;
    if (this.speed && !this.frame) this.frame = requestAnimationFrame(() => this.tick());
  }

  private tick(): void {
    this.frame = 0;
    if (!this.speed || this.drag) return;
    const max = this.el.scrollWidth - this.el.clientWidth;
    this.el.scrollLeft = Math.max(0, Math.min(max, this.el.scrollLeft + this.speed));
    if ((this.speed < 0 && this.el.scrollLeft <= 0) || (this.speed > 0 && this.el.scrollLeft >= max)) return this.stopEdge();
    this.frame = requestAnimationFrame(() => this.tick());
  }

  private stopEdge(): void {
    this.speed = 0;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private centerActive(behavior: ScrollBehavior = 'smooth'): void {
    requestAnimationFrame(() => {
      this.update();
      if (this.el.scrollWidth <= this.el.clientWidth) return;
      const active = this.el.querySelector<HTMLElement>('.active, .is-on, .is-active, [aria-current="page"], [aria-selected="true"]');
      if (!active || !this.el.contains(active)) return;
      const left = active.offsetLeft - this.el.offsetLeft - (this.el.clientWidth - active.offsetWidth) / 2;
      this.el.scrollTo({ left: Math.max(0, left), behavior });
    });
  }
}
