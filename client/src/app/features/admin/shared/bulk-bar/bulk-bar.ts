import { Component, EventEmitter, Input, Output } from '@angular/core';

export interface BulkAction {
  key: string;
  label: string;
  icon: string;
  danger?: boolean;
  // Nút mờ kèm gợi ý khi chưa dùng được (VD Chép vào đơn nháp cần đúng 1 đơn)
  disabledHint?: string;
}

// Thanh thao tác hàng loạt (SCR-41-ChonNhieu, SCR-43-ChonNhieu, SCR-54-ChonNhieu): thay chỗ ô tìm khi có dòng được chọn,
// hiện "Đã chọn [n] [đơn vị]", các nút thao tác và nút X bỏ chọn. Trang cha xử lý (action).
@Component({
  selector: 'app-bulk-bar',
  standalone: false,
  templateUrl: './bulk-bar.html',
  styleUrl: './bulk-bar.scss',
})
export class BulkBar {
  @Input({ required: true }) count = 0;
  @Input() unit = 'mục';
  @Input() actions: BulkAction[] = [];
  @Input() busy = false;
  @Output() action = new EventEmitter<string>();
  @Output() cleared = new EventEmitter<void>();
}
