import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { CartApiService } from './cart-apiservice';
import { AuthService } from './auth';
import { GiftWrapRequest, ICart, IPersonalization } from '../classes/cart';

// Trạng thái giỏ hàng dùng chung (Signal - Chương II): header đọc count() để hiện số trên biểu tượng giỏ,
// trang giỏ đọc cart(). Mọi thao tác trả về giỏ mới từ server (giá luôn tính lại ở server - UC-CRT-03 AC2).
// Đổi người dùng (đăng nhập, đăng xuất) thì tải lại: Guest đọc giỏ session, Member đọc giỏ đã gộp.
@Injectable({ providedIn: 'root' })
export class CartService {
  private readonly api = inject(CartApiService);
  private readonly auth = inject(AuthService);

  readonly cart = signal<ICart | null>(null);
  readonly count = computed(() => this.cart()?.count ?? 0);

  constructor() {
    effect(() => {
      const user = this.auth.currentUser();
      untracked(() => {
        if (user?.role === 'admin') this.cart.set(null); // nhân viên không mua hàng (BR-34)
        else this.refresh().subscribe({ error: () => {} });
      });
    });
  }

  private keep = (c: ICart) => this.cart.set(c);

  refresh(): Observable<ICart> {
    return this.api.getCart().pipe(tap(this.keep));
  }

  add(data: { productId: string; variantSku?: string; quantity: number; personalization?: IPersonalization | null; aiSessionId?: string | null }, buyNow = false): Observable<ICart> {
    return this.api.addItem(data, buyNow).pipe(tap(this.keep));
  }

  update(itemId: string, data: { variantSku?: string; quantity?: number; personalization?: IPersonalization | null; selected?: boolean }): Observable<ICart> {
    return this.api.updateItem(itemId, data).pipe(tap(this.keep));
  }

  remove(itemId: string): Observable<ICart> {
    return this.api.removeItem(itemId).pipe(tap(this.keep));
  }

  selectAll(all: boolean): Observable<ICart> {
    return this.api.setSelection({ all }).pipe(tap(this.keep));
  }

  setGiftWrap(data: GiftWrapRequest | { selected: boolean } | { source: null }): Observable<ICart> {
    return this.api.setGiftWrap(data).pipe(tap(this.keep));
  }
}
