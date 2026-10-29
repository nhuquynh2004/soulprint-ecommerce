import { Component, Input, inject } from '@angular/core';
import { ToastService } from '../../services/toast';

// Vùng hiện thông báo nhanh (đặt 1 lần ở App và ở khung quản trị). rộng tối thiểu 320px ở
// máy tính để câu ngắn không rớt 1 chữ xuống dòng; phía khách nằm trên nút chat nổi, không đè nút.
@Component({
  selector: 'app-toasts',
  standalone: false,
  template: `
    <div class="sp-toasts" [class.sp-toasts--above-chat]="aboveChat" aria-live="polite" role="status">
      @for (t of toast.items(); track t.id) {
        <div class="sp-toast" [class]="'sp-toast--' + t.tone">
          <app-icon [name]="t.tone === 'danger' ? 'alert-circle' : t.tone === 'info' ? 'info' : 'check-circle'" [size]="20" />
          <span>{{ t.text }}</span>
          <button class="btn" type="button" (click)="toast.dismiss(t.id)" aria-label="Đóng thông báo"><app-icon name="close" [size]="16" /></button>
        </div>
      }
    </div>
  `,
  styles: `
    .sp-toasts {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 1080;
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-width: min(420px, calc(100vw - 32px));
    }
    /* Nút chat nổi: 64px cách đáy 24px (màn hẹp 56px cách 16px) */
    .sp-toasts--above-chat { bottom: 100px; }
    @media (max-width: 575.98px) { .sp-toasts--above-chat { bottom: 84px; } }
    @media (min-width: 768px) { .sp-toast { min-width: 320px; } }
    .sp-toast {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 6px 10px 14px;
      border-radius: var(--sp-radius-lg);
      background: var(--sp-color-surface);
      border: 1px solid var(--sp-color-border);
      border-left: 4px solid var(--sp-color-success);
      box-shadow: var(--sp-shadow-lg);
      color: var(--sp-color-text);
      font-weight: 500;
    }
    .sp-toast span { flex: 1; }
    .sp-toast--success app-icon:first-child { color: var(--sp-color-success); }
    .sp-toast--danger { border-left-color: var(--sp-color-danger); }
    .sp-toast--danger app-icon:first-child { color: var(--sp-color-danger); }
    .sp-toast--info { border-left-color: var(--sp-color-primary); }
    .sp-toast--info app-icon:first-child { color: var(--sp-color-primary); }
    .sp-toast .btn { padding: 6px; display: inline-flex; }
  `,
})
export class Toasts {
  @Input() aboveChat = false;
  protected readonly toast = inject(ToastService);
}
