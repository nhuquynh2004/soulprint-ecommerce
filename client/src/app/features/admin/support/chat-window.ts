import { Component, DestroyRef, ElementRef, Input, OnInit, ViewChild, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval } from 'rxjs';
import { AdminChatApiService } from '../../../services/admin-chat-apiservice';
import { ChatDockService, DockWindow } from '../../../services/chat-dock';
import { ApiError } from '../../../classes/api-error';
import { CHAT_MESSAGE_MAX, IChatMessage, IConversationDetail } from '../../../classes/chat';

const POLL_OPEN_MS = 3000;

// Một cửa sổ chat nổi: đọc đầy đủ lần đầu (API-105, mở hội thoại đang chờ thì nhận luôn như SCR-52), sau đó
// hỏi tin mới mỗi 3 giây bằng ?after; thu gọn thì ngừng hỏi. Gửi tin API-106. Enter gửi, Shift+Enter xuống dòng.
@Component({
  selector: 'app-chat-window',
  standalone: false,
  templateUrl: './chat-window.html',
  styleUrl: './chat-window.scss',
})
export class ChatWindow implements OnInit {
  @Input({ required: true }) win!: DockWindow;
  @ViewChild('body') body?: ElementRef<HTMLElement>;

  private readonly api = inject(AdminChatApiService);
  readonly dock = inject(ChatDockService);
  private readonly destroyRef = inject(DestroyRef);

  readonly MAX = CHAT_MESSAGE_MAX;
  readonly conv = signal<IConversationDetail | null>(null);
  readonly messages = signal<IChatMessage[]>([]);
  readonly error = signal('');
  readonly text = signal('');
  readonly sending = signal(false);

  ngOnInit(): void {
    this.loadFull();
    interval(POLL_OPEN_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (!this.win.minimized && this.conv()) this.poll();
      });
  }

  private loadFull(): void {
    this.api.getConversation(this.win.id).subscribe({
      next: (c) => {
        this.conv.set(c);
        this.messages.set(c.messages);
        // Mở từ "Chat với khách" ở đơn hàng: điền sẵn tin mở đầu để nhân viên sửa rồi gửi
        const draft = this.dock.takeDraft(this.win.id);
        if (draft && !this.text()) this.text.set(draft);
        if (c.customerName) this.dock.rename(this.win.id, c.customerName);
        this.scrollEnd();
      },
      error: (err: ApiError) => this.error.set(err.message),
    });
  }

  private poll(): void {
    const last = this.messages().at(-1)?._id;
    this.api.getConversation(this.win.id, last).subscribe({
      next: (c) => {
        this.conv.update((old) => (old ? { ...old, ...c, messages: [] } : c));
        if (c.messages.length) {
          const known = new Set(this.messages().map((m) => m._id));
          this.messages.update((list) => [...list, ...c.messages.filter((m) => !known.has(m._id))]);
          this.scrollEnd();
        }
      },
      error: () => {
        // lỗi mạng thoáng qua: lượt sau hỏi lại
      },
    });
  }

  onKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      this.send();
    }
  }

  send(): void {
    const t = this.text().trim();
    if (!t || this.sending() || !this.conv()?.canReply) return;
    this.sending.set(true);
    this.api.reply(this.win.id, t.slice(0, CHAT_MESSAGE_MAX)).subscribe({
      next: (m) => {
        this.sending.set(false);
        this.text.set('');
        this.messages.update((list) => (list.some((x) => x._id === m._id) ? list : [...list, m]));
        this.scrollEnd();
      },
      error: (err: ApiError) => {
        this.sending.set(false);
        this.error.set(err.message);
      },
    });
  }

  private scrollEnd(): void {
    setTimeout(() => {
      const el = this.body?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  initials(name: string): string {
    return (name || '?').trim().split(/\s+/).slice(-2).map((w) => w[0]).join('').toUpperCase();
  }
}
