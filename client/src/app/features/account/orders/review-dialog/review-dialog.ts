import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { OrderApiService } from '../../../../services/order-apiservice';
import { ApiError } from '../../../../classes/api-error';
import { IOrderDetail } from '../../../../classes/order';
import { RATING_LABELS, REVIEW_LIKES, TEXT_MAX } from '../../../../classes/aftersales';

type Item = IOrderDetail['items'][number];

// SCR-27 Hộp thoại đánh giá (UC-TRK-03): chọn 1-5 sao kèm chữ mô tả mức, "Điểm bạn thích", nhận xét có bộ đếm,
// ảnh, "Ẩn tên khi hiển thị đánh giá". Sửa trong 24 giờ (1a), xóa bất cứ lúc nào (1b). Mở từ thẻ đơn SCR-18 hoặc dòng
// sản phẩm SCR-19: tự đọc chi tiết đơn (API-43) để biết sản phẩm nào chưa đánh giá. Chọn sao là @Output của component
// chọn sao - Chương II (ở đây các nút sao phát sự kiện click lên component cha).
@Component({
  selector: 'app-review-dialog',
  standalone: false,
  templateUrl: './review-dialog.html',
  styleUrl: './review-dialog.scss',
})
export class ReviewDialog implements OnInit {
  @Input({ required: true }) code = '';
  @Input() itemId = '';
  @Output() closed = new EventEmitter<void>();
  // Đã gửi, sửa hoặc xóa: trang cha tải lại đơn; message để hiện thông báo
  @Output() saved = new EventEmitter<string>();

  private readonly api = inject(OrderApiService);

  readonly labels = RATING_LABELS;
  readonly likeOptions = REVIEW_LIKES;
  readonly textMax = TEXT_MAX;
  readonly stars = [1, 2, 3, 4, 5];
  readonly order = signal<IOrderDetail | null>(null);
  readonly loadError = signal('');
  readonly selectedId = signal('');
  readonly choosing = signal(false);
  readonly sending = signal(false);
  readonly confirmDelete = signal(false);
  readonly error = signal('');
  readonly hover = signal(0);

  readonly rating = signal(0);
  readonly likes = signal<string[]>([]);
  comment = '';
  images: string[] = [];
  hideName = false;

  // Sản phẩm có thể đánh giá hoặc sửa: chưa đánh giá, hoặc đánh giá còn sửa được
  readonly candidates = computed(() => (this.order()?.items || []).filter((i) => !i.reviewed || i.review));
  readonly item = computed<Item | null>(() => this.order()?.items.find((i) => i._id === this.selectedId()) || null);
  readonly review = computed(() => this.item()?.review || null);
  readonly readOnly = computed(() => !!this.review() && !this.review()!.editable);

  ngOnInit(): void {
    this.api.getOrder(this.code).subscribe({
      next: (o) => {
        this.order.set(o);
        const first = (this.itemId && o.items.find((i) => i._id === this.itemId)) || o.items.find((i) => !i.reviewed) || o.items.find((i) => i.review?.editable);
        if (first) this.select(first._id);
      },
      error: (err: ApiError) => this.loadError.set(err.message),
    });
  }

  select(id: string): void {
    this.selectedId.set(id);
    this.choosing.set(false);
    this.error.set('');
    this.confirmDelete.set(false);
    const r = this.order()!.items.find((i) => i._id === id)?.review;
    this.rating.set(r?.rating || 0);
    this.likes.set(r ? [...r.likes] : []);
    this.comment = r?.comment || '';
    this.images = r ? [...r.images] : [];
    this.hideName = !!r?.hideName;
  }

  toggleLike(key: string): void {
    this.likes.set(this.likes().includes(key) ? this.likes().filter((k) => k !== key) : [...this.likes(), key]);
  }

  submit(): void {
    const it = this.item();
    // 3Ea: chưa chọn sao thì nút bị vô hiệu
    if (!it || !this.rating() || this.sending()) return;
    this.sending.set(true);
    this.error.set('');
    const body = { orderItemId: it._id, rating: this.rating(), likes: this.likes(), comment: this.comment.trim(), images: this.images, hideName: this.hideName };
    const req = this.review() ? this.api.updateReview({ _id: this.review()!._id, ...body }) : this.api.createReview(body);
    req.subscribe({
      next: () => this.saved.emit(this.review() ? 'Đã cập nhật đánh giá' : 'Cảm ơn bạn đã đánh giá'),
      error: (err: ApiError) => {
        this.sending.set(false);
        this.error.set(err.status === 410 ? 'Đã quá 24 giờ, không thể sửa đánh giá' : err.message);
      },
    });
  }

  remove(): void {
    const r = this.review();
    if (!r || this.sending()) return;
    this.sending.set(true);
    this.api.deleteReview(r._id).subscribe({
      next: () => this.saved.emit('Đã xóa đánh giá'),
      error: (err: ApiError) => {
        this.sending.set(false);
        this.error.set(err.message);
      },
    });
  }
}
