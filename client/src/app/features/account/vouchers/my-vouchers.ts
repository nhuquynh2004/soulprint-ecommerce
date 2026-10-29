import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CheckoutApiService } from '../../../services/checkout-apiservice';
import { CartService } from '../../../services/cart';
import { ToastService } from '../../../services/toast';
import { IMyVouchers, IWalletVoucher, VoucherTab, voucherBadge } from '../../../classes/checkout';

// SCR-20 Ưu đãi của tôi (UC-ACC-05): 3 tab Có thể dùng / Sắp hết hạn / Đã dùng, hết hạn; "Dùng ngay" mang mã
// sang SCR-07 (giỏ chưa chọn dòng thì mở giỏ, giữ mã); biểu tượng sao chép. @switch theo tab, class binding thẻ mờ.
@Component({
  selector: 'app-my-vouchers',
  standalone: false,
  templateUrl: './my-vouchers.html',
  styleUrls: ['../account-page.scss', './my-vouchers.scss'],
})
export class MyVouchers {
  private readonly api = inject(CheckoutApiService);
  private readonly cart = inject(CartService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  readonly badge = voucherBadge;
  readonly tabs: { key: VoucherTab; label: string }[] = [
    { key: 'CO_THE_DUNG', label: 'Có thể dùng' },
    { key: 'SAP_HET_HAN', label: 'Sắp hết hạn' },
    { key: 'DA_DUNG_HET_HAN', label: 'Đã dùng, hết hạn' },
  ];
  readonly tab = signal<VoucherTab>('CO_THE_DUNG');
  readonly data = signal<IMyVouchers | null>(null);
  readonly error = signal('');

  constructor() {
    this.load();
  }

  load(): void {
    this.error.set('');
    this.data.set(null);
    this.api.getMyVouchers(this.tab()).subscribe({
      next: (d) => this.data.set(d),
      error: () => this.error.set('Không tải được danh sách ưu đãi'),
    });
  }

  setTab(t: VoucherTab): void {
    this.tab.set(t);
    this.load();
  }

  // Nhãn dưới con số ở cuống thẻ
  label(v: IWalletVoucher): string {
    if (v.type === 'FREESHIP') return 'Phí ship';
    return v.type === 'PERCENT' ? 'Giảm theo %' : 'Giảm tiền';
  }

  condition(v: IWalletVoucher): string {
    const vnd = (n: number) => n.toLocaleString('vi-VN') + 'đ';
    const parts: string[] = [];
    if (v.type === 'PERCENT') parts.push(`Giảm ${v.value}%${v.maxDiscount ? ' tối đa ' + vnd(v.maxDiscount) : ''}`);
    else if (v.type === 'FIXED') parts.push(`Giảm ${vnd(v.value)}`);
    else parts.push(`Miễn phí vận chuyển tối đa ${vnd(v.value)}`);
    if (v.minOrderValue) parts.push(`đơn từ ${vnd(v.minOrderValue)}`);
    return parts.join(' ');
  }

  // "Dùng ngay" (UC-ACC-05 bước 4): giỏ có dòng được chọn thì mở thanh toán với mã, không thì mở giỏ
  use(v: IWalletVoucher): void {
    const selected = this.cart.cart()?.selectedCount ?? 0;
    this.router.navigate([selected ? '/thanh-toan' : '/gio-hang'], { queryParams: { ma: v.code } });
    if (!selected) this.toast.show(`Chọn sản phẩm trong giỏ để dùng mã ${v.code}`);
  }

  copy(v: IWalletVoucher): void {
    navigator.clipboard?.writeText(v.code).then(
      () => this.toast.show(`Đã sao chép mã ${v.code}`),
      () => this.toast.show('Không sao chép được, vui lòng chép tay mã ' + v.code, 'danger'),
    );
  }
}
