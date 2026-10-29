import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, interval } from 'rxjs';
import { AdminChatApiService } from '../../../services/admin-chat-apiservice';
import { ChatDockService } from '../../../services/chat-dock';
import { IQueueItem, IQueueList } from '../../../classes/chat';

const POLL_LIST_MS = 8000;

// Khung chat nổi khu quản trị: danh sách hội thoại (mở từ nút chat trên thanh đầu) và các cửa sổ ở góc dưới phải.
// Ẩn trên trang Hỗ trợ khách hàng vì trang đó đã có đầy đủ. Danh sách chỉ hỏi lại khi đang mở.
@Component({
  selector: 'app-chat-dock',
  standalone: false,
  templateUrl: './chat-dock.html',
  styleUrl: './chat-dock.scss',
})
export class ChatDock {
  private readonly api = inject(AdminChatApiService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly dock = inject(ChatDockService);

  readonly onSupportPage = signal(this.router.url.startsWith('/quan-tri/ho-tro'));
  readonly data = signal<IQueueList | null>(null);
  readonly error = signal('');

  // Của tôi trước (đang hỗ trợ), rồi đang chờ nhận, rồi người khác đang hỗ trợ
  readonly groups = computed(() => {
    const d = this.data();
    if (!d) return [];
    return [
      { key: 'mine', title: 'Bạn đang hỗ trợ', items: d.mine || [] },
      { key: 'queue', title: 'Đang chờ nhận', items: d.queue || [] },
      { key: 'others', title: 'Nhân viên khác', items: d.others || [] },
    ].filter((g) => g.items.length);
  });

  constructor() {
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        this.onSupportPage.set(this.router.url.startsWith('/quan-tri/ho-tro'));
        this.dock.listOpen.set(false);
      });
    // Mở danh sách (nút chat trên thanh đầu đổi dock.listOpen) thì tải ngay
    effect(() => {
      if (this.dock.listOpen()) untracked(() => this.load());
    });
    interval(POLL_LIST_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.dock.listOpen()) this.load();
      });
  }

  load(): void {
    this.api.getQueue().subscribe({
      next: (d) => {
        this.data.set(d);
        this.error.set('');
      },
      error: (err) => this.error.set(err.message),
    });
  }

  open(c: IQueueItem): void {
    this.dock.open(c._id, c.customerName);
  }

  ago(iso: string): string {
    const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    return m < 1 ? 'vừa xong' : m < 60 ? `${m} phút` : m < 1440 ? `${Math.floor(m / 60)} giờ` : `${Math.floor(m / 1440)} ngày`;
  }
}
