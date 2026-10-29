import { Injectable, signal } from '@angular/core';

export interface ConfirmOptions {
  title: string;
  message?: string;
  okText?: string;
  cancelText?: string;
  danger?: boolean;
}

// Hộp xác nhận chung của web thay cho confirm() của trình duyệt: trang gọi ask() và chờ kết quả,
// app-confirm-host ở app.html vẽ hộp thoại. Mở hộp mới khi hộp cũ còn thì hộp cũ coi như chọn Quay lại.
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  readonly current = signal<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);

  ask(options: ConfirmOptions): Promise<boolean> {
    this.current()?.resolve(false);
    return new Promise((resolve) => this.current.set({ ...options, resolve }));
  }

  answer(ok: boolean): void {
    const c = this.current();
    this.current.set(null);
    c?.resolve(ok);
  }
}
