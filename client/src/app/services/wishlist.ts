import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Observable, finalize, of, tap } from 'rxjs';
import { DesignApiService } from './design-apiservice';
import { AuthService } from './auth';
import { LoginPromptService } from './login-prompt';
import { ToastService } from './toast';

// Danh sách yêu thích của Member (UC-CRT-02): giữ tập mã sản phẩm trong Signal để mọi thẻ sản phẩm tô trái tim đúng
// (class binding - Chương II). Guest bấm trái tim thì mời đăng nhập (1Ea). Đang gửi yêu cầu thì bỏ qua lần bấm tiếp
// theo của cùng sản phẩm, nên bấm nhanh nhiều lần vẫn ra đúng 1 thao tác (AC1; server cũng dùng $addToSet).
@Injectable({ providedIn: 'root' })
export class WishlistService {
  private readonly api = inject(DesignApiService);
  private readonly auth = inject(AuthService);
  private readonly prompt = inject(LoginPromptService);
  private readonly toast = inject(ToastService);

  readonly ids = signal<Set<string>>(new Set());
  readonly count = computed(() => this.ids().size);
  private readonly pending = new Set<string>();

  constructor() {
    effect(() => {
      const user = this.auth.currentUser();
      untracked(() => {
        if (user?.role === 'member') this.api.getWishlistIds().subscribe({ next: (ids) => this.ids.set(new Set(ids)), error: () => {} });
        else this.ids.set(new Set());
      });
    });
  }

  has(productId: string): boolean {
    return this.ids().has(productId);
  }

  // Bấm trái tim: thêm nếu chưa có, gỡ nếu đã có
  toggle(productId: string): void {
    if (this.auth.currentUser()?.role !== 'member') {
      this.prompt.ask('Đăng nhập để lưu sản phẩm yêu thích');
      return;
    }
    if (this.pending.has(productId)) return;
    const adding = !this.has(productId);
    this.pending.add(productId);
    const call = adding ? this.api.addToWishlist(productId) : this.api.removeFromWishlist(productId);
    call.pipe(finalize(() => this.pending.delete(productId))).subscribe({
      next: (ids) => {
        this.ids.set(new Set(ids));
        this.toast.show(adding ? 'Đã thêm vào Yêu thích' : 'Đã bỏ khỏi Yêu thích', adding ? 'success' : 'info');
      },
      error: (err) => this.toast.show(err.message, 'danger'),
    });
  }

  // Thêm (không gỡ), dùng cho "Chuyển vào yêu thích" ở giỏ (UC-CRT-03 3e)
  add(productId: string): Observable<string[]> {
    if (this.has(productId)) return of([...this.ids()]);
    return this.api.addToWishlist(productId).pipe(tap((ids) => this.ids.set(new Set(ids))));
  }

  remove(productId: string): Observable<string[]> {
    return this.api.removeFromWishlist(productId).pipe(tap((ids) => this.ids.set(new Set(ids))));
  }
}
