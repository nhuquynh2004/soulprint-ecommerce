import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { OrderApiService } from '../../../services/order-apiservice';
import { NoticeService } from '../../../services/notice';
import { ApiError } from '../../../classes/api-error';
import { INotice, INoticeList, NoticeGroup, noticeBucket } from '../../../classes/order';

const ICON: Record<string, string> = { DON_HANG: 'package', HOAN_TIEN: 'ticket', DOI_TRA: 'rotate', BAO_HANH: 'shield', HO_TRO: 'headset', TAI_KHOAN: 'user', UU_DAI: 'percent' };

// SCR-23 Thông báo (UC-TRK-02 1a): tab Tất cả / Đơn hàng / Ưu đãi / Hệ thống, gom theo Hôm nay / Tuần này /
// Trước đó; bấm thông báo thì đánh dấu đã đọc (API-22) và mở trang liên quan; "Đánh dấu đã đọc tất cả" (API-192).
@Component({
  selector: 'app-notices',
  standalone: false,
  templateUrl: './notices.html',
  styleUrl: './notices.scss',
})
export class Notices {
  private readonly api = inject(OrderApiService);
  private readonly notice = inject(NoticeService);
  private readonly router = inject(Router);

  readonly tabs: { key: NoticeGroup | ''; label: string }[] = [
    { key: '', label: 'Tất cả' },
    { key: 'don-hang', label: 'Đơn hàng' },
    { key: 'uu-dai', label: 'Ưu đãi' },
    { key: 'he-thong', label: 'Hệ thống' },
  ];
  readonly group = signal<NoticeGroup | ''>('');
  readonly data = signal<INoticeList | null>(null);
  readonly error = signal('');
  readonly icon = ICON;

  // Gom theo ngày, giữ thứ tự mới nhất trước
  readonly buckets = computed(() => {
    const out: { label: string; items: INotice[] }[] = [];
    for (const n of this.data()?.items || []) {
      const label = noticeBucket(n.createdAt);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(n);
      else out.push({ label, items: [n] });
    }
    return out;
  });

  constructor() {
    this.load();
  }

  load(page = 1): void {
    this.error.set('');
    if (page === 1) this.data.set(null);
    this.api.getNotices(this.group(), page).subscribe({
      next: (d) => {
        const prev = this.data();
        this.data.set(page > 1 && prev ? { ...d, items: [...prev.items, ...d.items] } : d);
        this.notice.unread.set(d.unreadCount);
      },
      error: (err: ApiError) => this.error.set(err.status === 0 ? err.message : 'Không tải được thông báo. Thử lại'),
    });
  }

  setGroup(g: NoticeGroup | ''): void {
    this.group.set(g);
    this.load();
  }

  open(n: INotice): void {
    if (!n.readAt) {
      this.api.markRead(n._id).subscribe({ error: () => {} });
      this.notice.unread.update((c) => Math.max(0, c - 1));
    }
    if (n.link) this.router.navigateByUrl(n.link);
    else this.data.update((d) => (d ? { ...d, items: d.items.map((x) => (x._id === n._id ? { ...x, readAt: new Date().toISOString() } : x)) } : d));
  }

  markAll(): void {
    this.api.markAllRead().subscribe({
      next: () => {
        this.notice.unread.set(0);
        this.load();
      },
      error: () => {},
    });
  }
}
