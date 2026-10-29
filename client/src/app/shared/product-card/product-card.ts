import { Component, EventEmitter, Input, OnChanges, Output, inject } from '@angular/core';
import { AXIS_INFO, IProduct, Product } from '../../classes/product';
import { WishlistService } from '../../services/wishlist';

// Thẻ sản phẩm (component ProductCard của bộ thiết kế). Component Interaction theo Chương II:
// @Input nhận sản phẩm từ trang cha, @Output báo sự kiện yêu thích cho trang cha (SCR-22 cập nhật lưới).
// Trái tim đọc WishlistService nên mọi thẻ ở mọi trang đều tô đúng trạng thái (UC-CRT-02, class binding).
@Component({
  selector: 'app-product-card',
  standalone: false,
  templateUrl: './product-card.html',
  styleUrl: './product-card.scss',
})
export class ProductCard implements OnChanges {
  @Input({ required: true }) product!: IProduct;
  @Input() compact = false;
  @Output() favorite = new EventEmitter<IProduct>();

  model = new Product();
  readonly axes = AXIS_INFO;
  protected readonly wishlist = inject(WishlistService);

  toggleFavorite(): void {
    this.wishlist.toggle(this.product._id);
    this.favorite.emit(this.product);
  }

  ngOnChanges(): void {
    this.model = new Product(this.product);
  }
}
