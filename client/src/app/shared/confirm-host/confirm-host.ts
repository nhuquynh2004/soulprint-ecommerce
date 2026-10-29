import { Component, inject } from '@angular/core';
import { ConfirmService } from '../../services/confirm';

// Nơi vẽ hộp xác nhận chung (ConfirmService), đặt 1 lần ở app.html cho cả trang khách và khu quản trị
@Component({
  selector: 'app-confirm-host',
  standalone: false,
  template: `
    @if (confirm.current(); as c) {
      <app-dialog [title]="c.title" size="sm" (closed)="confirm.answer(false)">
        @if (c.message) {
          <p class="mb-0">{{ c.message }}</p>
        }
        <div dialog-footer class="d-flex justify-content-end gap-2">
          <button class="btn btn-outline-secondary" type="button" (click)="confirm.answer(false)">{{ c.cancelText || 'Quay lại' }}</button>
          <button class="btn" [class.btn-danger]="c.danger" [class.btn-primary]="!c.danger" type="button" (click)="confirm.answer(true)">{{ c.okText || 'Đồng ý' }}</button>
        </div>
      </app-dialog>
    }
  `,
})
export class ConfirmHost {
  protected readonly confirm = inject(ConfirmService);
}
