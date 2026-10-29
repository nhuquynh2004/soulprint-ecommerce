import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { SharedModule } from '../shared-module';

// Chỗ giữ cho mục thuộc slice sau (VD Đơn hàng của tôi - S7, Voucher - S5) để menu không dẫn tới trang 404.
// Component standalone: dùng được ở cả khu Tài khoản và khu Quản trị.
@Component({
  selector: 'app-coming-soon',
  imports: [SharedModule],
  template: `
    <div class="sp-state my-3">
      <span class="sp-state__ic"><app-icon name="clock" [size]="32" /></span>
      <h1 class="h4">{{ heading }}</h1>
      <p>Mục này đang được hoàn thiện và sẽ có trong bản cập nhật tới.</p>
    </div>
  `,
})
export class ComingSoon {
  readonly heading = (inject(ActivatedRoute).snapshot.data['heading'] as string) || 'Đang hoàn thiện';
}
