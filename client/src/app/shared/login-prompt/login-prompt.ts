import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { LoginPromptService } from '../../services/login-prompt';

// Hộp thoại mời đăng nhập (UC-CRT-02 1Ea, AC2): nút Đăng nhập mang returnUrl để quay lại đúng trang.
@Component({
  selector: 'app-login-prompt',
  standalone: false,
  template: `
    @if (prompt.message()) {
      <app-dialog title="Đăng nhập để tiếp tục" size="sm" (closed)="prompt.close()">
        <p class="m-0">{{ prompt.message() }}</p>
        <div dialog-footer class="d-flex gap-2 justify-content-end w-100">
          <button class="btn btn-outline-secondary" type="button" (click)="prompt.close()">Để sau</button>
          <button class="btn btn-primary" type="button" (click)="login()">Đăng nhập</button>
        </div>
      </app-dialog>
    }
  `,
})
export class LoginPrompt {
  protected readonly prompt = inject(LoginPromptService);
  private readonly router = inject(Router);

  login(): void {
    const returnUrl = this.router.url;
    this.prompt.close();
    this.router.navigate(['/dang-nhap'], { queryParams: { returnUrl } });
  }
}
