import { Injectable, effect, inject, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { OrderApiService } from './order-apiservice';
import { AuthService } from './auth';
import { INotice } from '../classes/order';

// Thẻ nổi góc màn hình khi có thông báo mới hoặc tin nhắn mới của nhân viên
export interface INoticePopup {
  id: string;
  kind: 'notice' | 'chat';
  title: string;
  body: string;
  link: string | null;
}

const POLL_MS = 60 * 1000;
const POPUP_MS = 8000;

// Số thông báo chưa đọc (Signal) cho nhãn ở menu Tài khoản; trang Thông báo cập nhật lại khi đọc (SCR-23).
// Chuông trên header cửa hàng đọc 5 thông báo mới nhất; Member đang mở web thì cứ 60 giây đọc lại (API-21),
// thông báo mới chưa đọc hiện thẻ nổi 8 giây. Lần đọc đầu chỉ ghi nhận, không hiện lại thông báo cũ.
@Injectable({ providedIn: 'root' })
export class NoticeService {
  private readonly api = inject(OrderApiService);
  private readonly auth = inject(AuthService);
  readonly unread = signal(0);
  readonly latest = signal<INotice[]>([]);
  readonly popups = signal<INoticePopup[]>([]);
  // Thông báo mới: trang chi tiết đơn đang mở đúng đơn thì tải lại ngay
  readonly arrived$ = new Subject<INoticePopup>();
  // Hộp nổi bật giữa màn hình, hiện 1 lần (VD voucher xin lỗi); đóng hoặc bấm xem thì ghi đã xem
  readonly highlight = signal<{ _id: string; kind: string; title: string; body: string; link: string | null } | null>(null);

  private seen = new Set<string>();
  private primed = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    effect(() => {
      const member = this.auth.currentUser()?.role === 'member';
      if (member) this.start();
      else this.stop();
    });
  }

  private start(): void {
    if (this.timer) return;
    this.refresh();
    this.timer = setInterval(() => this.refresh(), POLL_MS);
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.primed = false;
    this.seen.clear();
    this.latest.set([]);
    this.unread.set(0);
  }

  refresh(): void {
    this.api.getNotices('', 1, 5).subscribe({
      next: (d) => {
        this.unread.set(d.unreadCount);
        this.latest.set(d.items);
        if (d.highlight && this.highlight()?._id !== d.highlight._id) this.highlight.set(d.highlight);
        for (const n of d.items) {
          if (this.primed && !this.seen.has(n._id) && !n.readAt) this.push({ id: n._id, kind: 'notice', title: n.title, body: n.body, link: n.link });
          this.seen.add(n._id);
        }
        this.primed = true;
      },
      error: () => {},
    });
  }

  push(p: INoticePopup): void {
    if (this.popups().some((x) => x.id === p.id)) return;
    this.arrived$.next(p);
    this.popups.update((l) => [...l, p].slice(-3));
    setTimeout(() => this.dismiss(p.id), POPUP_MS);
  }

  closeHighlight(): void {
    const h = this.highlight();
    if (!h) return;
    this.highlight.set(null);
    this.seen.add(h._id);
    this.latest.update((l) => l.map((x) => (x._id === h._id && !x.readAt ? { ...x, readAt: new Date().toISOString() } : x)));
    this.api.markRead(h._id).subscribe({ next: () => this.refresh(), error: () => {} });
  }

  dismiss(id: string): void {
    this.popups.update((l) => l.filter((x) => x.id !== id));
  }

  markRead(n: INotice): void {
    if (n.readAt) return;
    const now = new Date().toISOString();
    this.latest.update((l) => l.map((x) => (x._id === n._id ? { ...x, readAt: now } : x)));
    this.unread.update((v) => Math.max(0, v - 1));
    this.api.markRead(n._id).subscribe({ error: () => {} });
  }

  markAllRead(): void {
    const now = new Date().toISOString();
    this.latest.update((l) => l.map((x) => (x.readAt ? x : { ...x, readAt: now })));
    this.unread.set(0);
    this.api.markAllRead().subscribe({ error: () => {} });
  }
}
