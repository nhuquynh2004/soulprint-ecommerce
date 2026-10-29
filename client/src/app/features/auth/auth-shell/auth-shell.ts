import { Component, Input } from '@angular/core';

// Khung 2 cột của SCR-11 đến SCR-14: cột trái nền đại dương (lời chào, lợi ích, Sâu Béo), cột phải là form.
// tab = 'login' | 'register' thì hiện thanh chuyển Đăng nhập / Đăng ký trên form.
@Component({
  selector: 'app-auth-shell',
  standalone: false,
  templateUrl: './auth-shell.html',
  styleUrl: './auth-shell.scss',
})
export class AuthShell {
  @Input() heading = 'Chào mừng bạn quay lại';
  @Input() lead = 'Đăng nhập để tiếp tục chọn quà và theo dõi các đơn đang cá nhân hóa.';
  @Input() tab: 'login' | 'register' | null = null;
  @Input() returnUrl: string | null = null;
  @Input() benefits: { icon: string; text: string }[] = [
    { icon: 'wand', text: 'Lưu thiết kế In/Khắc để dùng lại cho lần sau' },
    { icon: 'package', text: 'Theo dõi đơn, tiền cọc và tiến độ cá nhân hóa' },
    { icon: 'map-pin', text: 'Sổ địa chỉ: chọn nhanh khi giao cho người nhận' },
    { icon: 'ticket', text: 'Thành viên mới nhận ngay mã SOULPRINT10 giảm 10%' },
  ];
}
