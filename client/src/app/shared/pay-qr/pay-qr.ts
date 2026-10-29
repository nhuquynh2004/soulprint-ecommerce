import { Component, Input, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { timer } from 'rxjs';
import { demoQrCells, formatCountdown } from '../../classes/checkout';
import { ToastService } from '../../services/toast';

// Khối gửi liên kết thanh toán cho khách (đơn nháp có trả trước, đổi sản phẩm phải trả thêm): mã QR, liên kết,
// nút sao chép liên kết và sao chép tin nhắn để nhân viên gửi qua kênh đang trao đổi. Cổng giả lập nên mã QR là minh họa
// (cùng cách vẽ với SCR-08); với cổng thật, QR là ảnh do cổng trả về.
// Một bố cục chung cho đơn nháp và thanh toán thêm: đồng hồ hạn, khe [payqr-actions] cho nút xác nhận, hủy (rộng bằng nhau).
@Component({
  selector: 'app-pay-qr',
  standalone: false,
  templateUrl: './pay-qr.html',
  styleUrl: './pay-qr.scss',
})
export class PayQr {
  private readonly toast = inject(ToastService);

  private readonly code$ = signal('');
  @Input({ required: true }) set code(v: string) {
    this.code$.set(v || '');
  }
  get code(): string {
    return this.code$();
  }
  // Đường dẫn tương đối (/cong-thanh-toan/...) hoặc tuyệt đối
  @Input({ required: true }) url = '';
  @Input() amount = 0;
  @Input() expiresAt: string | Date | null = null;
  // Câu mở đầu tin nhắn gửi khách, VD "Đơn SP... cần thanh toán thêm"
  @Input() messageIntro = '';

  readonly cells = computed(() => demoQrCells(this.code$() || 'SOULPRINT'));
  private readonly now = signal(Date.now());
  // Còn lại tới hạn liên kết, HH:MM:SS khi từ 1 giờ
  readonly left = computed(() => {
    if (!this.expiresAt) return '';
    const s = Math.round((new Date(this.expiresAt).getTime() - this.now()) / 1000);
    return s > 0 ? formatCountdown(s) : '';
  });

  constructor() {
    timer(0, 1000)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.now.set(Date.now()));
  }

  fullUrl(): string {
    return /^https?:/.test(this.url) ? this.url : location.origin + this.url;
  }

  message(): string {
    const exp = this.expiresAt ? new Date(this.expiresAt).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '';
    return `${this.messageIntro ? this.messageIntro + '. ' : ''}Số tiền ${this.amount.toLocaleString('vi-VN')}đ. Bạn thanh toán qua liên kết: ${this.fullUrl()}${exp ? ` (hạn đến ${exp})` : ''}. Cảm ơn bạn đã chọn Soulprint!`;
  }

  copy(text: string, label: string): void {
    navigator.clipboard?.writeText(text).then(
      () => this.toast.show(`Đã sao chép ${label}`),
      () => this.toast.show('Trình duyệt không cho sao chép', 'danger'),
    );
  }
}
