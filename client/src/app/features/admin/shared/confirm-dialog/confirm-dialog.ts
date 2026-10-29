import { Component, EventEmitter, Input, Output } from '@angular/core';

// Hộp thoại xác nhận dùng chung (xóa, lưu trữ, rời trang khi chưa lưu): dựa trên app-dialog,
// nội dung thêm truyền qua ng-content. Nút chính màu đỏ khi danger.
@Component({
  selector: 'app-confirm-dialog',
  standalone: false,
  template: `
    <app-dialog [title]="title" size="sm" (closed)="cancel.emit()">
      @if (message) {
        <p class="mb-2">{{ message }}</p>
      }
      <ng-content />
      <div dialog-footer class="d-flex justify-content-end gap-2">
        <button class="btn btn-outline-secondary" type="button" (click)="cancel.emit()">{{ cancelLabel }}</button>
        <button class="btn" [class.btn-danger]="danger" [class.btn-primary]="!danger" type="button" [disabled]="busy" (click)="confirm.emit()">
          {{ confirmLabel }}
        </button>
      </div>
    </app-dialog>
  `,
})
export class ConfirmDialog {
  @Input({ required: true }) title = '';
  @Input() message = '';
  @Input() confirmLabel = 'Xác nhận';
  @Input() cancelLabel = 'Hủy';
  @Input() danger = false;
  @Input() busy = false;
  @Output() confirm = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();
}
