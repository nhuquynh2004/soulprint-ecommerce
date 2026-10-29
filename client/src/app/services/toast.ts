import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  text: string;
  tone: 'success' | 'danger' | 'info';
}

// Thông báo nhanh góc màn hình (VD "Đã cập nhật thông tin cá nhân thành công"), tự ẩn sau 4 giây; lỗi 6 giây để kịp đọc.
@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly items = signal<Toast[]>([]);
  private next = 1;

  show(text: string, tone: Toast['tone'] = 'success'): void {
    const id = this.next++;
    this.items.update((list) => [...list, { id, text, tone }]);
    setTimeout(() => this.dismiss(id), tone === 'danger' ? 6000 : 4000);
  }

  dismiss(id: number): void {
    this.items.update((list) => list.filter((t) => t.id !== id));
  }
}
