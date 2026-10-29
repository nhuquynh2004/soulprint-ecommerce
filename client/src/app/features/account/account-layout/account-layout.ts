import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { AuthService } from '../../../services/auth';
import { NoticeService } from '../../../services/notice';
import { ConfirmService } from '../../../services/confirm';

// Khung trang Tài khoản (SCR-15 đến SCR-23): menu trái + nội dung (router-outlet con).
@Component({
  selector: 'app-account-layout',
  standalone: false,
  templateUrl: './account-layout.html',
  styleUrl: './account-layout.scss',
})
export class AccountLayout {
  private readonly confirmBox = inject(ConfirmService);
  protected readonly auth = inject(AuthService);
  protected readonly notice = inject(NoticeService);
  private readonly router = inject(Router);

  readonly menu = [
    { link: 'thong-tin', icon: 'user', label: 'Thông tin cá nhân' },
    { link: 'mat-khau', icon: 'lock', label: 'Mật khẩu' },
    { link: 'dia-chi', icon: 'map-pin', label: 'Sổ địa chỉ' },
    { link: 'don-hang', icon: 'package', label: 'Đơn hàng của tôi' },
    { link: 'voucher', icon: 'ticket', label: 'Ưu đãi của tôi' },
    { link: 'thiet-ke', icon: 'wand', label: 'Thiết kế đã lưu' },
    { link: 'yeu-thich', icon: 'heart', label: 'Yêu thích' },
    { link: 'thong-bao', icon: 'bell', label: 'Thông báo' },
  ];

  // Các đoạn đường dẫn sau /tai-khoan, VD ['don-hang', 'SP001']
  private readonly parts = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      startWith(null),
      map(() => this.router.url.split(/[?#]/)[0].split('/').slice(2).filter(Boolean)),
    ),
    { initialValue: [] as string[] },
  );

  // Mục cuối của breadcrumb = trang con đang mở (theo SCR-15: Trang chủ > Tài khoản > Thông tin cá nhân)
  readonly current = computed(() => this.menu.find((m) => this.parts()[0] === m.link)?.label || '');
  // Mobile, Tablet: /tai-khoan là trang menu (SCR-15-Mobile-Menu); trang con có liên kết "Tài khoản" để quay lại
  readonly atRoot = computed(() => !this.parts().length);
  readonly topLevel = computed(() => this.parts().length === 1);

  constructor() {
    // Số thông báo chưa đọc ở menu (SCR-23)
    this.notice.refresh();
  }

  // UC-ACC-02 nhánh 6a: hỏi xác nhận rồi hủy phiên, về trang chủ
  logout(): void {
    this.confirmBox.ask({ title: 'Bạn có chắc chắn muốn đăng xuất?', okText: 'Đăng xuất' }).then((ok) => {
      if (ok) this.auth.logout().subscribe(() => this.router.navigate(['/']));
    });
  }
}
