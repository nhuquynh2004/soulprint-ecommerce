import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Subscription, interval } from 'rxjs';
import { ChatApiService, ChatSendExtra } from './chat-apiservice';
import { AuthService } from './auth';
import { ApiError } from '../classes/api-error';
import { CHAT_MESSAGE_MAX, IChatBubble, IChatMessage, IChatState, ISupportStatus, POLL_MS, isProposal } from '../classes/chat';

// Trạng thái cửa sổ chat "Sâu Béo" dùng chung toàn trang khách (UC-CSK-01 ghi chú kỹ thuật: Service giữ trạng thái hội thoại).
// Tin mới lấy bằng RxJS interval gọi API-61 mỗi 4 giây (Chương III). Cửa sổ đóng mà hội thoại đang chờ hoặc đang
// được nhân viên hỗ trợ thì vẫn hỏi để nút nổi hiện số tin mới.
// Chỉ nhớ mã hội thoại trong sessionStorage của tab (không phải thông tin đăng nhập - NFR-SEC-01); thiếu thì vẫn chạy.
const STORE_ID = 'sp_chat_id';
const STORE_SEEN = 'sp_chat_seen';
const STORE_TIP = 'sp_chat_tip';

function readStore(key: string): string {
  try {
    return sessionStorage.getItem(key) || '';
  } catch {
    return '';
  }
}
function writeStore(key: string, value: string): void {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    // trình duyệt chặn lưu trữ: chỉ không nhớ sau khi tải lại
  }
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly api = inject(ChatApiService);
  private readonly auth = inject(AuthService);

  readonly isOpen = signal(false);
  readonly loading = signal(false);
  readonly conversationId = signal('');
  readonly state = signal<IChatState | null>(null);
  readonly messages = signal<IChatBubble[]>([]);
  readonly support = signal<ISupportStatus | null>(null);
  readonly quickTopics = signal<string[]>([]);
  readonly sending = signal(false);
  readonly draft = signal('');
  // Tin kế tiếp gửi thẳng nhân viên (lối vào có ý định rõ) và mã đơn kèm theo
  private staffNext: { orderCode?: string } | null = null;
  // Mở chat để nối nhân viên ("Liên hệ Soulprint", "Trả lời Soulprint"): đầu cửa sổ ghi đang nối nhân viên, không hiện
  // "Sâu Béo, Đang trực tuyến" và lời chào của bot khi hội thoại chưa có tin của khách
  private readonly toStaff = signal(false);
  readonly staffMode = computed(() => this.toStaff() && this.status() === 'BOT');
  private queued: { text: string; extra: ChatSendExtra } | null = null;
  // Chip trả lời nhanh khi khách trả lời Soulprint ở đơn đang hỏi: Đổi sản phẩm, Hủy đơn, Khác
  readonly orderReplies = signal<string | null>(null);
  readonly error = signal('');
  // Mất kết nối khi polling: hiện "Đang kết nối lại..." (SCR-29 MatKetNoi)
  readonly offline = signal(false);
  // Hộp chuyển ngữ (UC-CSK-03): tin gốc và bản đề xuất, tin chưa lưu
  readonly proposal = signal<{ original: string; softened: string } | null>(null);
  // Form "Để lại lời nhắn" (UC-CSK-02 4Ea)
  readonly leaveOpen = signal(false);
  readonly leaveErrors = signal<Record<string, string>>({});
  readonly showTip = signal(readStore(STORE_TIP) !== 'off');
  private readonly lastSeen = signal(readStore(STORE_SEEN));

  readonly status = computed(() => this.state()?.status || 'BOT');
  readonly closed = computed(() => this.status() === 'DA_DONG');
  readonly waiting = computed(() => this.status() === 'CHO_NHAN_VIEN');
  // Tin mới chưa đọc khi cửa sổ đóng: tin của Sâu Béo, nhân viên đến sau tin cuối khách đã xem
  readonly unread = computed(() => {
    if (this.isOpen()) return 0;
    const seen = this.lastSeen();
    const list = this.messages().filter((m) => !m.failed);
    const from = seen ? list.findIndex((m) => m._id === seen) + 1 : list.length;
    return list.slice(from).filter((m) => m.sender === 'ADMIN' || m.sender === 'BOT').length;
  });
  // Dòng trạng thái ở đầu cửa sổ (SCR-29)
  readonly headline = computed(() => {
    const s = this.state();
    if (this.offline()) return 'Mất kết nối | đang thử lại';
    if (s?.status === 'DANG_HO_TRO') return s.agentName ? `Đang chat với ${s.agentName}` : 'Đang chat với nhân viên';
    if (s?.status === 'CHO_NHAN_VIEN') return s.leftMessage ? 'Đã gửi lời nhắn cho nhân viên' : 'Đang kết nối nhân viên...';
    if (s?.status === 'DA_DONG') return 'Cuộc trò chuyện đã kết thúc';
    if (this.staffMode()) return 'Đang nối với nhân viên Soulprint';
    const sp = this.support();
    if (sp && !sp.online) return sp.offHours ? 'Ngoài giờ | Sâu Béo vẫn trực' : 'Chưa có nhân viên trực | Sâu Béo vẫn trực';
    return 'Đang trực tuyến';
  });

  private poller?: Subscription;
  private polling = false;

  constructor() {
    // Đã chuyển sang chờ hoặc đang chat với nhân viên thì thôi chế độ nối nhân viên
    effect(() => {
      if (this.status() !== 'BOT') untracked(() => this.toStaff.set(false));
    });
    // Đăng nhập, đăng xuất: server đã gộp hội thoại vãng lai vào tài khoản hoặc phiên đã đổi,
    // nên bỏ hội thoại đang nhớ và mở lại để thấy đủ tin cũ của tài khoản
    let lastUser: string | undefined;
    effect(() => {
      const id = this.auth.currentUser()?._id || '';
      untracked(() => {
        if (lastUser !== undefined && lastUser !== id && this.conversationId()) {
          this.forget();
          if (this.isOpen()) this.start();
        }
        lastUser = id;
      });
    });
    // Mở lại trang: hội thoại của tab vẫn còn thì đọc lại để nút nổi đếm tin mới (không tạo hội thoại mới khi chưa mở chat)
    const saved = readStore(STORE_ID);
    if (saved) {
      this.conversationId.set(saved);
      this.api.poll(saved).subscribe({
        next: (s) => {
          this.apply(s, true);
          if (!this.lastSeen()) this.markSeen();
          this.syncPolling();
        },
        error: () => this.forget(),
      });
    }
  }

  // ===== Mở, đóng =====

  // Mở chat ở chế độ gặp nhân viên: send=true thì gửi ngay text (khi hội thoại sẵn sàng), không thì điền sẵn để khách viết
  // tiếp và tin khách gửi sẽ đi thẳng nhân viên. replies: hiện chip Đổi sản phẩm, Hủy đơn, Khác của đơn đang hỏi
  openToStaff(text: string, opts: { orderCode?: string; send?: boolean; replies?: boolean } = {}): void {
    this.orderReplies.set(opts.replies && opts.orderCode ? opts.orderCode : null);
    this.toStaff.set(true);
    if (opts.send) {
      this.staffNext = null;
      this.queued = { text, extra: { toStaff: true, ...(opts.orderCode ? { orderCode: opts.orderCode } : {}) } };
      this.open();
      this.flushQueued();
      return;
    }
    this.staffNext = { orderCode: opts.orderCode };
    this.open(text);
  }

  // Chip "Đổi sản phẩm": gửi kèm ý định để hệ thống hỏi tiếp sản phẩm muốn đổi
  replyChangeProduct(): void {
    const code = this.orderReplies();
    this.orderReplies.set(null);
    this.send('Mình muốn đổi sang sản phẩm khác', undefined, { intent: 'DOI_SAN_PHAM', ...(code ? { orderCode: code } : {}) });
  }

  private flushQueued(): void {
    if (!this.queued || !this.conversationId() || this.loading()) return;
    const q = this.queued;
    this.queued = null;
    this.send(q.text, undefined, q.extra);
  }

  open(prefill?: string): void {
    this.isOpen.set(true);
    this.hideTip();
    if (prefill) this.draft.set(prefill);
    if (!this.conversationId()) this.start();
    else this.markSeen();
    this.syncPolling();
  }

  close(): void {
    this.markSeen();
    this.isOpen.set(false);
    this.syncPolling();
  }

  hideTip(): void {
    this.showTip.set(false);
    writeStore(STORE_TIP, 'off');
  }

  // API-60: tạo hoặc mở lại hội thoại của phiên
  start(): void {
    this.loading.set(true);
    this.error.set('');
    const name = this.auth.currentUser()?.fullName;
    this.api.open(name).subscribe({
      next: (s) => {
        this.loading.set(false);
        this.messages.set([]);
        this.conversationId.set(s.conversationId);
        writeStore(STORE_ID, s.conversationId);
        this.apply(s, true);
        this.markSeen();
        this.syncPolling();
        this.flushQueued();
      },
      error: (e: ApiError) => {
        this.loading.set(false);
        this.error.set(e.message);
      },
    });
  }

  // Trang yêu cầu đặt gấp: gắn khung chat vào hội thoại của yêu cầu (server đã cho phiên này quyền đọc)
  attach(id: string, openNow = false): void {
    if (id && id !== this.conversationId()) {
      this.messages.set([]);
      this.state.set(null);
      this.conversationId.set(id);
      writeStore(STORE_ID, id);
      this.api.poll(id).subscribe({
        next: (s) => {
          this.apply(s, true);
          if (this.isOpen()) this.markSeen();
          this.syncPolling();
        },
        error: () => {},
      });
    }
    if (openNow) this.open();
  }

  // Hội thoại đã đóng: bắt đầu cuộc mới
  restart(): void {
    this.forget();
    this.start();
  }

  private forget(): void {
    this.conversationId.set('');
    this.state.set(null);
    this.messages.set([]);
    this.proposal.set(null);
    this.leaveOpen.set(false);
    writeStore(STORE_ID, '');
    writeStore(STORE_SEEN, '');
    this.lastSeen.set('');
    this.syncPolling();
  }

  // ===== Gửi tin (API-62) =====

  send(text: string, confirm?: 'SOFTENED' | 'ORIGINAL', extra: ChatSendExtra = {}): void {
    const t = text.trim();
    if (!t || t.length > CHAT_MESSAGE_MAX || this.sending() || !this.conversationId()) return;
    this.sending.set(true);
    this.error.set('');
    // Lối vào có ý định rõ: tin đầu khách tự viết cũng đi thẳng nhân viên
    if (this.staffNext && !extra.toStaff) {
      extra = { ...extra, toStaff: true, ...(this.staffNext.orderCode ? { orderCode: this.staffNext.orderCode } : {}) };
      this.staffNext = null;
    }
    this.api.send(this.conversationId(), t, confirm, extra).subscribe({
      next: (r) => {
        this.sending.set(false);
        this.offline.set(false);
        if (isProposal(r)) {
          // UC-CSK-03 AC1: tin chưa xuất hiện trong khung chat
          this.proposal.set({ original: t, softened: r.softened });
          this.draft.set('');
          return;
        }
        this.proposal.set(null);
        this.draft.set('');
        this.dropFailed(t);
        this.apply(r);
        if (r.escalation === 'LEAVE_MESSAGE') this.leaveOpen.set(true);
        this.markSeen();
        this.syncPolling();
      },
      error: (e: ApiError) => {
        this.sending.set(false);
        if (e.status === 0) {
          // Mất kết nối: giữ tin dưới dạng "Chưa gửi được" để bấm Thử lại
          this.dropFailed(t);
          this.messages.update((l) => [...l, this.failedBubble(t)]);
          this.draft.set('');
          this.offline.set(true);
        } else if (e.code === 'CONVERSATION_CLOSED') {
          this.refresh();
        } else {
          this.error.set(e.message);
        }
      },
    });
  }

  retry(bubble: IChatBubble): void {
    this.send(bubble.text);
  }

  // Hộp chuyển ngữ: "Gửi bản này", "Gửi nguyên văn", hoặc đóng để sửa lại (4b)
  chooseSoftened(): void {
    const p = this.proposal();
    if (p) this.send(p.original, 'SOFTENED');
  }
  chooseOriginal(): void {
    const p = this.proposal();
    if (p) this.send(p.original, 'ORIGINAL');
  }
  dismissProposal(): void {
    const p = this.proposal();
    if (p) this.draft.set(p.original);
    this.proposal.set(null);
  }

  private failedBubble(text: string): IChatBubble {
    return { _id: 'tam-' + Date.now(), sender: 'KHACH', text, senderName: null, link: null, createdAt: new Date().toISOString(), failed: true };
  }
  private dropFailed(text: string): void {
    this.messages.update((l) => l.filter((m) => !(m.failed && m.text === text)));
  }

  // ===== Gặp nhân viên (API-63), hủy chờ (API-197) =====

  askHuman(): void {
    const sp = this.support();
    if (sp && !sp.online) {
      this.leaveOpen.set(true);
      return;
    }
    this.escalate();
  }

  escalate(leave?: { contact: string; text: string }): void {
    if (!this.conversationId() || this.sending()) return;
    this.sending.set(true);
    this.leaveErrors.set({});
    this.api.escalate(this.conversationId(), leave).subscribe({
      next: (s) => {
        this.sending.set(false);
        this.leaveOpen.set(false);
        this.apply(s);
        this.markSeen();
        this.syncPolling();
      },
      error: (e: ApiError) => {
        this.sending.set(false);
        if (e.extra['fields']) this.leaveErrors.set(e.extra['fields']);
        else if (e.code === 'INVALID_TRANSITION') this.refresh();
        else this.error.set(e.message);
      },
    });
  }

  cancelWait(): void {
    this.toStaff.set(false);
    if (!this.conversationId() || this.sending()) return;
    this.sending.set(true);
    this.api.cancelEscalation(this.conversationId()).subscribe({
      next: (s) => {
        this.sending.set(false);
        this.apply(s);
        this.markSeen();
        this.syncPolling();
      },
      error: (e: ApiError) => {
        this.sending.set(false);
        this.error.set(e.message);
        this.refresh();
      },
    });
  }

  // API-208: đang chat với nhân viên thì quay lại Sâu Béo, cần lại thì bấm Gặp nhân viên
  backToBot(): void {
    this.toStaff.set(false);
    if (!this.conversationId() || this.sending()) return;
    this.sending.set(true);
    this.api.backToBot(this.conversationId()).subscribe({
      next: (s) => {
        this.sending.set(false);
        this.apply(s);
        this.markSeen();
        this.syncPolling();
      },
      error: (e: ApiError) => {
        this.sending.set(false);
        this.error.set(e.message);
        this.refresh();
      },
    });
  }

  // ===== Polling (API-61) =====

  // Hỏi khi cửa sổ mở, hoặc khi đóng mà đang chờ / đang được hỗ trợ (đếm tin mới)
  private syncPolling(): void {
    const s = this.status();
    const want = !!this.conversationId() && !this.closed() && (this.isOpen() || s === 'CHO_NHAN_VIEN' || s === 'DANG_HO_TRO');
    if (want && !this.poller) {
      this.poller = interval(POLL_MS).subscribe(() => this.refresh());
    } else if (!want && this.poller) {
      this.poller.unsubscribe();
      this.poller = undefined;
    }
  }

  refresh(): void {
    const id = this.conversationId();
    if (!id || this.polling) return;
    this.polling = true;
    const last = [...this.messages()].reverse().find((m) => !m.failed);
    this.api.poll(id, last?._id).subscribe({
      next: (s) => {
        this.polling = false;
        this.offline.set(false);
        this.apply(s);
        if (this.isOpen()) this.markSeen();
        this.syncPolling();
      },
      error: (e: ApiError) => {
        this.polling = false;
        if (e.status === 0) this.offline.set(true);
        else if (e.status === 404) this.forget();
      },
    });
  }

  // Gộp tin mới (bỏ trùng theo _id), cập nhật trạng thái
  private apply(s: IChatState, replace = false): void {
    const { messages, ...rest } = s;
    this.state.set({ ...(this.state() || ({} as IChatState)), ...rest, messages: [] });
    if (s.support) this.support.set(s.support);
    if (s.quickTopics) this.quickTopics.set(s.quickTopics);
    if (replace) {
      this.messages.set(messages);
      return;
    }
    const have = new Set(this.messages().map((m) => m._id));
    const fresh = messages.filter((m: IChatMessage) => !have.has(m._id));
    if (fresh.length) {
      // tin chưa gửi được luôn nằm cuối
      this.messages.update((l) => [...l.filter((m) => !m.failed), ...fresh, ...l.filter((m) => m.failed)]);
    }
    if (s.status !== 'BOT') this.leaveOpen.set(false);
  }

  private markSeen(): void {
    const last = [...this.messages()].reverse().find((m) => !m.failed);
    if (last) {
      this.lastSeen.set(last._id);
      writeStore(STORE_SEEN, last._id);
    }
  }
}
