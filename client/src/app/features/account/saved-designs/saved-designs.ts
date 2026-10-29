import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DesignApiService } from '../../../services/design-apiservice';
import { CartService } from '../../../services/cart';
import { ToastService } from '../../../services/toast';
import { ApiError } from '../../../classes/api-error';
import { ISavedDesign, describePersonalization } from '../../../classes/cart';

type Tab = 'CA_NHAN_HOA' | 'GOI_QUA';

// SCR-21 Thiết kế đã lưu (UC-ACC-06): 2 tab Thiết kế In/Khắc và Mẫu gói quà. Đủ GET, PUT, DELETE (API-14, 16, 17);
// "Áp dụng" mẫu gói quà gọi API-35 gắn vào giỏ; "Dùng lại" thiết kế In/Khắc mở trang sản phẩm với hộp thoại điền sẵn.
@Component({
  selector: 'app-saved-designs',
  standalone: false,
  templateUrl: './saved-designs.html',
  styleUrls: ['../account-page.scss', './saved-designs.scss'],
})
export class SavedDesigns {
  private readonly api = inject(DesignApiService);
  private readonly cart = inject(CartService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  readonly tab = signal<Tab>('CA_NHAN_HOA');
  readonly designs = signal<ISavedDesign[]>([]);
  readonly loading = signal(true);
  readonly errMessage = signal('');
  readonly busy = signal(false);
  readonly editing = signal<ISavedDesign | null>(null);
  readonly confirmDelete = signal<ISavedDesign | null>(null);
  readonly describe = describePersonalization;

  readonly personal = computed(() => this.designs().filter((d) => d.kind === 'CA_NHAN_HOA'));
  readonly gifts = computed(() => this.designs().filter((d) => d.kind === 'GOI_QUA'));
  readonly shown = computed(() => (this.tab() === 'CA_NHAN_HOA' ? this.personal() : this.gifts()));

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.errMessage.set('');
    this.api.getDesigns().subscribe({
      next: (list) => {
        this.designs.set(list);
        this.loading.set(false);
      },
      error: (err: ApiError) => {
        this.loading.set(false);
        this.errMessage.set(err.message || 'Không tải được thiết kế. Thử lại');
      },
    });
  }

  // Thiết kế In/Khắc: mở trang sản phẩm với ?thietKe=<id> (UC-ACC-06 2a, AC4)
  reuse(d: ISavedDesign): void {
    if (!d.usable || !d.product?.slug) return;
    this.router.navigate(['/san-pham', d.product.slug], { queryParams: { thietKe: d._id } });
  }

  // Mẫu gói quà: gắn vào giỏ hàng hiện tại, giá 0đ (3a, AC1)
  applyGift(d: ISavedDesign): void {
    this.busy.set(true);
    this.cart.setGiftWrap({ source: 'CUA_TOI', designId: d._id }).subscribe({
      next: () => {
        this.busy.set(false);
        this.toast.show('Đã thêm gói quà vào giỏ hàng');
      },
      error: (err: ApiError) => {
        this.busy.set(false);
        this.toast.show(err.message, 'danger');
      },
    });
  }

  onSaved(d: ISavedDesign): void {
    this.designs.update((list) => list.map((x) => (x._id === d._id ? d : x)));
    this.editing.set(null);
  }

  remove(d: ISavedDesign): void {
    this.busy.set(true);
    this.api.deleteDesign(d._id).subscribe({
      next: () => {
        this.busy.set(false);
        this.confirmDelete.set(null);
        this.designs.update((list) => list.filter((x) => x._id !== d._id));
        this.toast.show('Đã xóa thiết kế');
      },
      error: (err: ApiError) => {
        this.busy.set(false);
        this.toast.show(err.message, 'danger');
      },
    });
  }
}
