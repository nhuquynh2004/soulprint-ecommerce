import { Injectable, signal } from '@angular/core';

// Lời mời đăng nhập dùng chung (UC-CRT-02 1Ea, UC-CRT-03 3e, UC-CRT-01 5a): hộp thoại nhỏ có nút Đăng nhập,
// quay lại đúng trang sau khi đăng nhập (returnUrl). Hiển thị bởi component LoginPrompt đặt ở App.
@Injectable({ providedIn: 'root' })
export class LoginPromptService {
  readonly message = signal('');

  ask(message: string): void {
    this.message.set(message);
  }

  close(): void {
    this.message.set('');
  }
}
