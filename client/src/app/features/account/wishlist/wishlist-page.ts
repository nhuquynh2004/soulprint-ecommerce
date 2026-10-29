import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DesignApiService } from '../../../services/design-apiservice';
import { WishlistService } from '../../../services/wishlist';
import { CartService } from '../../../services/cart';
import { ToastService } from '../../../services/toast';
import { ApiError } from '../../../classes/api-error';
import { IWishItem } from '../../../classes/cart';

// SCR-22 Danh sách yêu thích (UC-CRT-02 bước 3-4, nhánh 4a, 4b, 4Ea, 4Eb). Lưới mới nhất trước; bỏ yêu thích thì lưới
// cập nhật ngay; sản phẩm ngừng kinh doanh hoặc tạm hết hàng có nhãn và nút thêm giỏ bị vô hiệu (AC3).
@Component({
  selector: 'app-wishlist-page',
  standalone: false,
  templateUrl: './wishlist-page.html',
  styleUrls: ['../account-page.scss', './wishlist-page.scss'],
})
export class WishlistPage {
  private readonly api = inject(DesignApiService);
  private readonly wishlist = inject(WishlistService);
  private readonly cart = inject(CartService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  readonly items = signal<IWishItem[]>([]);
  readonly loading = signal(true);
  readonly errMessage = signal('');
  readonly adding = signal<string | null>(null);

  readonly outCount = computed(() => this.items().filter((x) => x.status !== 'DANG_BAN').length);

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.errMessage.set('');
    this.api.getWishlist().subscribe({
      next: (list) => {
        this.items.set(list);
        this.loading.set(false);
      },
      error: (err: ApiError) => {
        this.loading.set(false);
        this.errMessage.set(err.message || 'Không tải được danh sách yêu thích. Thử lại');
      },
    });
  }

  // 4b: bỏ yêu thích, lưới cập nhật ngay
  unfavorite(item: IWishItem): void {
    this.wishlist.remove(item._id).subscribe({
      next: () => {
        this.items.update((list) => list.filter((x) => x._id !== item._id));
        this.toast.show('Đã bỏ khỏi Yêu thích', 'info');
      },
      error: (err: ApiError) => this.toast.show(err.message, 'danger'),
    });
  }

  // 4a: sang UC-CRT-01. Sản phẩm 1 biến thể thêm thẳng vào giỏ; nhiều biến thể thì mở trang sản phẩm để chọn
  addToCart(item: IWishItem): void {
    if (item.status !== 'DANG_BAN') return;
    if (item.needsOptions || !item.defaultVariantSku) {
      this.router.navigate(['/san-pham', item.slug]);
      return;
    }
    this.adding.set(item._id);
    this.cart.add({ productId: item._id, variantSku: item.defaultVariantSku, quantity: 1 }).subscribe({
      next: () => {
        this.adding.set(null);
        this.toast.show('Đã thêm vào giỏ hàng');
      },
      error: (err: ApiError) => {
        this.adding.set(null);
        this.toast.show(err.message, 'danger');
      },
    });
  }
}
