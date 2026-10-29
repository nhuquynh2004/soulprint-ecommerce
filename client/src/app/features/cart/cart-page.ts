import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Observable } from 'rxjs';
import { CartService } from '../../services/cart';
import { WishlistService } from '../../services/wishlist';
import { AuthService } from '../../services/auth';
import { LoginPromptService } from '../../services/login-prompt';
import { ToastService } from '../../services/toast';
import { ProductApiService } from '../../services/product-apiservice';
import { ApiError } from '../../classes/api-error';
import { GiftWrapRequest, ICart, ICartItem, IPersonalization, IPersonalizeProduct, charCount, describePersonalization } from '../../classes/cart';
import { IProduct, IVariant } from '../../classes/product';
import { PersonalizeResult, PersonalizeTab } from '../../shared/personalize-dialog/personalize-dialog';

// SCR-05 Giỏ hàng (UC-CRT-03, UC-CRT-04). Dữ liệu giỏ nằm trong Signal của CartService; computed() suy ra
// trạng thái "Chọn tất cả", số dòng đã chọn. Mọi thao tác gọi API rồi nhận lại giỏ đã tính lại ở server, nên tạm tính
// luôn đúng với dữ liệu đã lưu và không cần tải lại trang (AC1). Sửa In/Khắc ngay trên dòng; Thiết kế và đổi biến thể
// mở hộp thoại SCR-04; gói quà mở hộp thoại SCR-06.
@Component({
  selector: 'app-cart-page',
  standalone: false,
  templateUrl: './cart-page.html',
  styleUrl: './cart-page.scss',
})
export class CartPage {
  protected readonly cartService = inject(CartService);
  private readonly wishlist = inject(WishlistService);
  private readonly auth = inject(AuthService);
  private readonly prompt = inject(LoginPromptService);
  private readonly toast = inject(ToastService);
  private readonly productApi = inject(ProductApiService);
  // Mã mang từ "Dùng ngay" ở Ưu đãi của tôi khi giỏ chưa chọn dòng (UC-ACC-05 bước 4): chuyển tiếp sang SCR-07
  readonly checkoutParams: Record<string, string> = ((ma): Record<string, string> => (ma ? { ma } : {}))(inject(ActivatedRoute).snapshot.queryParamMap.get('ma'));

  readonly cart = this.cartService.cart;
  readonly loading = signal(true);
  readonly loadError = signal('');
  readonly busy = signal(false);
  readonly suggestions = signal<IProduct[]>([]);
  readonly describe = describePersonalization;

  readonly items = computed(() => this.cart()?.items ?? []);
  readonly selectable = computed(() => this.items().filter((it) => !it.warning));
  readonly allSelected = computed(() => this.selectable().length > 0 && this.selectable().every((it) => it.selected));
  readonly someSelected = computed(() => this.selectable().some((it) => it.selected));
  readonly generalWarnings = computed(() => (this.cart()?.warnings ?? []).filter((w) => !w.itemId));

  // Sửa In/Khắc tại chỗ: dòng đang sửa và nội dung đang gõ
  readonly editingId = signal<string | null>(null);
  readonly editText = signal('');
  readonly editOver = signal(false);
  readonly editTop = signal('');
  readonly editNumber = signal('');
  readonly editBottom = signal('');
  readonly editError = signal('');

  // Hộp thoại SCR-04 mở từ giỏ (Thiết kế, đổi biến thể - UC-CRT-03 3d)
  readonly pzItem = signal<ICartItem | null>(null);
  readonly pzProduct = signal<IPersonalizeProduct | null>(null);
  readonly pzVariants = signal<IVariant[]>([]);
  readonly pzTab = signal<PersonalizeTab | null>(null);
  readonly pzError = signal('');

  readonly giftOpen = signal(false);
  readonly giftError = signal('');
  readonly confirmRemove = signal<ICartItem | null>(null);

  constructor() {
    this.cartService.refresh().subscribe({
      next: (c) => {
        this.loading.set(false);
        if (!c.count) this.loadSuggestions();
      },
      error: (err: ApiError) => {
        this.loading.set(false);
        this.loadError.set(err.message || 'Không tải được giỏ hàng. Thử lại');
      },
    });
  }

  reload(): void {
    this.loading.set(true);
    this.loadError.set('');
    this.cartService.refresh().subscribe({
      next: () => this.loading.set(false),
      error: (err: ApiError) => {
        this.loading.set(false);
        this.loadError.set(err.message);
      },
    });
  }

  private loadSuggestions(): void {
    this.productApi.getProducts({ sort: 'pho-bien', pageSize: 4 }).subscribe({ next: (r) => this.suggestions.set(r.items), error: () => {} });
  }

  // Chạy một thao tác giỏ, báo lỗi bằng thông báo nhanh; trả về false nếu lỗi
  private run(call: Observable<ICart>, done?: (c: ICart) => void, onError?: (err: ApiError) => void): void {
    this.busy.set(true);
    call.subscribe({
      next: (c) => {
        this.busy.set(false);
        done?.(c);
        if (!c.count) this.loadSuggestions();
      },
      error: (err: ApiError) => {
        this.busy.set(false);
        if (onError) onError(err);
        else this.toast.show(err.message, 'danger');
      },
    });
  }

  // ===== Chọn dòng (bước 7, API-118, API-33) =====
  toggleAll(): void {
    this.run(this.cartService.selectAll(!this.allSelected()));
  }

  toggleItem(it: ICartItem): void {
    if (it.warning) return;
    this.run(this.cartService.update(it._id, { selected: !it.selected }));
  }

  // ===== Số lượng (3a) =====
  changeQty(it: ICartItem, step: number): void {
    const q = it.quantity + step;
    if (q < 1) {
      this.confirmRemove.set(it); // giảm về 0 thì hỏi xóa dòng
      return;
    }
    this.run(this.cartService.update(it._id, { quantity: q }));
  }

  // ===== Xóa, chuyển vào yêu thích (3b, 3e) =====
  remove(it: ICartItem): void {
    this.confirmRemove.set(null);
    this.run(this.cartService.remove(it._id), () => this.toast.show('Đã xóa sản phẩm khỏi giỏ hàng', 'info'));
  }

  moveToWishlist(it: ICartItem): void {
    if (this.auth.currentUser()?.role !== 'member') {
      this.prompt.ask('Đăng nhập để lưu sản phẩm yêu thích');
      return;
    }
    this.busy.set(true);
    this.wishlist.add(it.productId).subscribe({
      next: () => this.run(this.cartService.remove(it._id), () => this.toast.show('Đã chuyển vào Yêu thích')),
      error: (err: ApiError) => {
        this.busy.set(false);
        this.toast.show(err.message, 'danger');
      },
    });
  }

  // ===== Sửa In/Khắc tại chỗ (bước 3-6) =====
  startEdit(it: ICartItem): void {
    const p = it.personalization;
    this.editingId.set(it._id);
    this.editError.set('');
    this.editOver.set(false);
    this.editText.set(p?.type === 'IN_KHAC' && p.mode === 'THUONG' ? p.text : '');
    this.editTop.set(p?.type === 'IN_KHAC' && p.mode === 'AO_DAU' ? p.top : '');
    this.editNumber.set(p?.type === 'IN_KHAC' && p.mode === 'AO_DAU' ? p.number : '');
    this.editBottom.set(p?.type === 'IN_KHAC' && p.mode === 'AO_DAU' ? p.bottom : '');
  }

  cancelEdit(): void {
    this.editingId.set(null);
  }

  count(v: string): number {
    return charCount(v);
  }

  // Không cho gõ quá giới hạn của sản phẩm, gõ thêm thì báo đỏ (BR-18); số áo chỉ chữ số
  onEdit(field: 'text' | 'top' | 'bottom', it: ICartItem, el: HTMLInputElement): void {
    const e = it.engrave!;
    const max = field === 'text' ? e.maxChars! : field === 'top' ? e.topMaxChars! : e.bottomMaxChars!;
    const chars = Array.from(el.value.normalize('NFC'));
    if (chars.length > max) {
      el.value = chars.slice(0, max).join('');
      this.editOver.set(true);
      this.editError.set(`Tối đa ${max} ký tự. Cần nội dung dài hơn, bạn nhắn Soulprint để được hỗ trợ`);
    } else if (chars.length < max && this.editOver()) {
      this.editOver.set(false);
      this.editError.set('');
    }
    (field === 'text' ? this.editText : field === 'top' ? this.editTop : this.editBottom).set(el.value);
  }

  onEditNumber(it: ICartItem, el: HTMLInputElement): void {
    el.value = el.value.replace(/\D/g, '').slice(0, it.engrave!.numberMaxDigits);
    this.editNumber.set(el.value);
  }

  editContent(it: ICartItem): IPersonalization | null {
    if (it.engrave?.mode === 'AO_DAU') {
      const top = this.editTop().trim();
      const number = this.editNumber().trim();
      const bottom = this.editBottom().trim();
      return top || number || bottom ? { type: 'IN_KHAC', mode: 'AO_DAU', top, number, bottom } : null;
    }
    const text = this.editText().trim();
    return text ? { type: 'IN_KHAC', mode: 'THUONG', text } : null;
  }

  saveEdit(it: ICartItem): void {
    const content = this.editContent(it);
    if (!content) {
      this.editError.set('Nhập nội dung in/khắc');
      return;
    }
    this.run(
      this.cartService.update(it._id, { personalization: content }),
      () => this.editingId.set(null),
      (err) => this.editError.set(err.message), // 6Ea: báo lỗi tại ô nhập, không lưu
    );
  }

  // ===== Hộp thoại SCR-04 cho Thiết kế, đổi biến thể (3d) =====
  openDialog(it: ICartItem, tab?: PersonalizeTab): void {
    if (!it.slug) return;
    this.pzError.set('');
    this.productApi.getProduct(it.slug).subscribe({
      next: (p) => {
        this.pzProduct.set({ _id: p._id, name: p.name, slug: p.slug, image: it.image, axis: p.axis, personalization: p.personalization, stickerSets: p.stickerSets });
        this.pzVariants.set(p.variants);
        this.pzItem.set(it);
        this.pzTab.set(tab ?? (it.personalization ? it.personalization.type : 'NONE'));
      },
      error: (err: ApiError) => this.toast.show(err.message, 'danger'),
    });
  }

  closeDialog(): void {
    this.pzItem.set(null);
    this.pzTab.set(null);
  }

  onDialogApplied(it: ICartItem, r: PersonalizeResult): void {
    const data: { personalization: IPersonalization | null; variantSku?: string } = { personalization: r.personalization };
    if (r.variantSku && r.variantSku !== it.variantSku) data.variantSku = r.variantSku;
    this.run(
      this.cartService.update(it._id, data),
      () => this.closeDialog(),
      (err) => this.pzError.set(err.message), // AC3: biến thể mới hết hàng thì báo lỗi, dòng giữ biến thể cũ
    );
  }

  // ===== Gói quà (3c, UC-CRT-04) =====
  onGiftApplied(req: GiftWrapRequest): void {
    this.giftError.set('');
    this.run(
      this.cartService.setGiftWrap(req),
      (c) => {
        this.giftOpen.set(false);
        if (c.giftWrap) this.toast.show(`Gói quà: ${c.giftWrap.name} - Miễn phí`);
      },
      (err) => this.giftError.set(err.message),
    );
  }

  toggleGift(): void {
    const g = this.cart()?.giftWrap;
    if (g) this.run(this.cartService.setGiftWrap({ selected: !g.selected }));
  }
}
