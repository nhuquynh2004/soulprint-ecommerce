import { Component, DestroyRef, ElementRef, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval } from 'rxjs';
import { AdminChatApiService } from '../../../services/admin-chat-apiservice';
import { ToastService } from '../../../services/toast';
import { ApiError } from '../../../classes/api-error';
import {
  CHAT_MESSAGE_MAX, CHAT_NOTE_MAX, ChatLabelCode, IChatMessage, IConversationDetail, IQueueItem, IQueueList, SENTIMENT_TONE, Sentiment, initials,
} from '../../../classes/chat';

// Nhóm lọc ở cột trái: theo hàng đợi, người phụ trách, nhãn; "Đã đóng" đọc danh sách riêng
type Group = 'ALL' | 'WAITING' | 'MINE' | ChatLabelCode | 'CLOSED';
const GROUPS: { key: Group; label: string }[] = [
  { key: 'ALL', label: 'Tất cả' },
  { key: 'WAITING', label: 'Chờ nhận' },
  { key: 'MINE', label: 'Của tôi' },
  { key: 'DAT_GAP', label: 'Đơn gấp' },
  { key: 'DON_HANG', label: 'Đơn hàng' },
  { key: 'DOI_TRA', label: 'Đổi trả' },
  { key: 'KHIEU_NAI', label: 'Khiếu nại' },
  { key: 'TU_VAN', label: 'Tư vấn' },
  { key: 'CLOSED', label: 'Đã đóng' },
];
const LABEL_CODES: { code: ChatLabelCode; label: string }[] = [
  { code: 'DAT_GAP', label: 'Đơn gấp' },
  { code: 'KHIEU_NAI', label: 'Khiếu nại' },
  { code: 'DOI_TRA', label: 'Đổi trả, bảo hành' },
  { code: 'DON_HANG', label: 'Đơn hàng' },
  { code: 'TU_VAN', label: 'Tư vấn' },
];
// Tin cùng người gửi cách nhau dưới 3 phút thì gom (không lặp avatar, tên) như Messenger
const GROUP_GAP_MS = 3 * 60 * 1000;

type Row =
  | { kind: 'divider'; key: string; text: string; tone?: 'session' }
  | { kind: 'msg'; key: string; m: IChatMessage; first: boolean; last: boolean; earlier: boolean };

// SCR-52 Hỗ trợ khách hàng kiểu Messenger (UC-CSK-04): cột trái danh sách khách có nhóm lọc và tìm kiếm,
// giữa là khung chat (gom tin liên tiếp, mốc ngày, các phiên trước của cùng khách), phải là đơn gấp, tóm tắt, ghi chú,
// khách hàng (thu gọn được). Danh sách hỏi lại mỗi 8 giây, hội thoại đang mở mỗi 3 giây (polling - Chương III).
@Component({
  selector: 'app-support-page',
  standalone: false,
  templateUrl: './support-page.html',
  styleUrl: './support-page.scss',
})
export class SupportPage {
  private readonly api = inject(AdminChatApiService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly title = inject(Title);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('log') log?: ElementRef<HTMLElement>;

  readonly toneOf = (s: Sentiment) => SENTIMENT_TONE[s] || 'warning';
  readonly initials = initials;
  readonly maxText = CHAT_MESSAGE_MAX;
  readonly maxNote = CHAT_NOTE_MAX;
  readonly groups = GROUPS;
  readonly labelCodes = LABEL_CODES;

  readonly list = signal<IQueueList | null>(null);
  readonly closedItems = signal<IQueueItem[]>([]);
  readonly group = signal<Group>('ALL');
  readonly search = signal('');
  readonly loadError = signal('');
  readonly selectedId = signal('');
  readonly detail = signal<IConversationDetail | null>(null);
  readonly detailError = signal('');
  readonly draft = signal('');
  readonly sending = signal(false);
  readonly noteOpen = signal(false);
  readonly noteText = signal('');
  readonly noteSaving = signal(false);
  readonly showOriginal = signal<Record<string, boolean>>({});
  readonly showEarlier = signal(false);
  readonly showInfo = signal(true);
  readonly showQuick = signal(false);
  readonly labelEdit = signal<ChatLabelCode[] | null>(null);
  // Hộp thoại tắt Đang trực khi còn hội thoại (UC-CSK-04 1a)
  readonly dutyDialog = signal(false);
  readonly handover = signal<'REASSIGN' | 'FINISH_FIRST'>('REASSIGN');
  readonly dutyBusy = signal(false);
  readonly closeConfirm = signal(false);

  readonly mine = computed(() => this.list()?.mine || []);
  // Gộp hàng đợi, của tôi, người khác (Quản trị) thành một danh sách như Messenger; mỗi khách một dòng
  private readonly open = computed(() => {
    const l = this.list();
    if (!l) return [] as IQueueItem[];
    const seen = new Set<string>();
    return [...(l.queue || []), ...(l.mine || []), ...(l.others || [])].filter((c) => !seen.has(c._id) && !!seen.add(c._id));
  });
  readonly counts = computed(() => {
    const o = this.open();
    const out: Record<string, number> = { ALL: o.length, WAITING: 0, MINE: 0, CLOSED: this.closedItems().length };
    for (const c of o) {
      if (c.status === 'CHO_NHAN_VIEN') out['WAITING']++;
      if (c.isMine) out['MINE']++;
      for (const l of c.labels) out[l.code] = (out[l.code] || 0) + 1;
    }
    return out;
  });
  readonly items = computed(() => {
    const g = this.group();
    const q = this.search().trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
    const base = g === 'CLOSED' ? this.closedItems() : this.open();
    const list = base.filter((c) => {
      if (g === 'WAITING' && c.status !== 'CHO_NHAN_VIEN') return false;
      if (g === 'MINE' && !c.isMine) return false;
      if (!['ALL', 'WAITING', 'MINE', 'CLOSED'].includes(g) && !c.labels.some((l) => l.code === g)) return false;
      if (!q) return true;
      const hay = `${c.customerName} ${c.topic} ${c.lastText || ''}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
      return hay.includes(q);
    });
    if (g === 'CLOSED') return list;
    // Cần nhắc trả lời, đơn gấp, chưa đọc lên đầu; rồi tin mới nhất
    const rank = (c: IQueueItem) => (c.remindMinutes > 0 ? 0 : c.urgentOpen ? 1 : c.unread || c.status === 'CHO_NHAN_VIEN' ? 2 : 3);
    return [...list].sort((a, b) => rank(a) - rank(b) || new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
  });
  readonly selectedItem = computed(() => [...this.open(), ...this.closedItems()].find((c) => c._id === this.selectedId()) || null);
  readonly onDutyStaffText = computed(() => {
    const names = this.list()?.onDutyStaff || [];
    if (!names.length) return 'Không còn nhân viên nào đang trực | hội thoại sẽ về hàng đợi chung, khách thấy "Nhân viên sẽ phản hồi bạn sớm nhất"';
    const shown = names.length > 2 ? `${names.slice(0, 2).join(', ')} và ${names.length - 2} người khác` : names.join(' và ');
    return `${shown} đang trực | khách không phải chờ lại từ đầu`;
  });
  readonly noteError = computed(() => (this.noteText().length > this.maxNote ? `Ghi chú tối đa ${this.maxNote} ký tự` : ''));
  readonly canSaveNote = computed(() => !!this.noteText().trim() && !this.noteError() && !this.noteSaving());
  readonly canSend = computed(() => !!this.detail()?.canReply && !!this.draft().trim() && this.draft().length <= this.maxText && !this.sending());

  // Dòng hiển thị trong khung chat: mốc ngày, vạch phiên trước, tin gom theo người gửi
  readonly rows = computed<Row[]>(() => {
    const d = this.detail();
    if (!d) return [];
    const out: Row[] = [];
    const push = (msgs: IChatMessage[], earlier: boolean) => {
      let lastDay = '';
      msgs.forEach((m, i) => {
        const day = new Date(m.createdAt).toDateString();
        if (day !== lastDay) {
          out.push({ kind: 'divider', key: 'd' + m._id, text: this.dayText(m.createdAt) });
          lastDay = day;
        }
        const prev = msgs[i - 1];
        const next = msgs[i + 1];
        const same = (a?: IChatMessage) => !!a && a.sender === m.sender && a.sender !== 'HE_THONG' && Math.abs(new Date(a.createdAt).getTime() - new Date(m.createdAt).getTime()) < GROUP_GAP_MS && new Date(a.createdAt).toDateString() === day;
        out.push({ kind: 'msg', key: m._id, m, first: !same(prev), last: !same(next), earlier });
      });
    };
    if (this.showEarlier()) {
      for (const s of d.earlier || []) {
        out.push({ kind: 'divider', key: 's' + s._id, text: `Phiên ${this.dayText(s.createdAt)}${s.closedAt ? ' | đã đóng' : ''}${s.topic ? ' | ' + s.topic : ''}`, tone: 'session' });
        push(s.messages, true);
      }
      out.push({ kind: 'divider', key: 'now', text: 'Phiên hiện tại', tone: 'session' });
    }
    push(d.messages, false);
    return out;
  });

  private pollingDetail = false;
  private reminded = new Set<string>();
  private readonly baseTitle = this.title.getTitle();

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((p) => {
      const id = p.get('id') || '';
      if (id !== this.selectedId()) this.select(id, false);
    });
    this.loadQueue();
    interval(8000).pipe(takeUntilDestroyed()).subscribe(() => this.loadQueue());
    interval(3000).pipe(takeUntilDestroyed()).subscribe(() => this.pollDetail());
    // Tin mới thì cuộn xuống cuối (không cuộn khi đang xem các phiên trước)
    effect(() => {
      this.detail()?.messages.length;
      if (this.showEarlier()) return;
      setTimeout(() => {
        const el = this.log?.nativeElement;
        if (el) el.scrollTop = el.scrollHeight;
      });
    });
    // Số hội thoại cần xử lý trên tiêu đề tab trình duyệt
    effect(() => {
      const o = this.open();
      const n = o.filter((c) => c.unread || c.status === 'CHO_NHAN_VIEN' || c.remindMinutes > 0).length;
      const base = this.title.getTitle().replace(/^\(\d+\) /, '');
      this.title.setTitle(n ? `(${n}) ${base}` : base);
    });
    this.destroyRef.onDestroy(() => this.title.setTitle(this.title.getTitle().replace(/^\(\d+\) /, '')));
  }

  // ===== Danh sách (API-104) =====

  loadQueue(): void {
    this.api.getQueue().subscribe({
      next: (q) => {
        this.loadError.set('');
        this.list.set(q);
        // Nhắc một lần cho mỗi hội thoại đã xem mà chưa trả lời quá 5 phút
        for (const c of q.mine || []) {
          if (c.remindMinutes > 0 && !this.reminded.has(c._id)) {
            this.reminded.add(c._id);
            this.toast.show(`${c.customerName} đang chờ bạn trả lời ${c.remindMinutes} phút`, 'danger');
          } else if (!c.remindMinutes) this.reminded.delete(c._id);
        }
      },
      error: (e: ApiError) => this.loadError.set(e.message),
    });
    if (this.group() === 'CLOSED') this.loadClosed();
  }

  private loadClosed(): void {
    this.api.getQueue('DA_DONG').subscribe({ next: (q) => this.closedItems.set(q.closed || []), error: () => {} });
  }

  setGroup(g: Group): void {
    this.group.set(g);
    if (g === 'CLOSED') this.loadClosed();
  }

  // ===== Hội thoại (API-105) =====

  select(id: string, navigate = true): void {
    this.selectedId.set(id);
    this.detail.set(null);
    this.detailError.set('');
    this.draft.set('');
    this.noteOpen.set(false);
    this.showEarlier.set(false);
    this.showOriginal.set({});
    this.labelEdit.set(null);
    if (navigate) this.router.navigate([], { relativeTo: this.route, queryParams: { id: id || null }, replaceUrl: true });
    if (!id) return;
    this.api.getConversation(id).subscribe({
      next: (d) => {
        this.detail.set(d);
        this.loadQueue(); // nhận hội thoại, đã đọc thì danh sách đổi
      },
      error: (e: ApiError) => this.detailError.set(e.status === 404 ? 'Không tìm thấy hội thoại' : e.message),
    });
  }

  private pollDetail(): void {
    const d = this.detail();
    if (!d || this.pollingDetail || d.status === 'DA_DONG') return;
    const last = d.messages[d.messages.length - 1];
    this.pollingDetail = true;
    this.api.getConversation(d._id, last?._id).subscribe({
      next: (u) => {
        this.pollingDetail = false;
        const cur = this.detail();
        if (!cur || cur._id !== u._id) return;
        const have = new Set(cur.messages.map((m) => m._id));
        const { messages, ...rest } = u;
        this.detail.set({ ...cur, ...rest, messages: [...cur.messages, ...messages.filter((m) => !have.has(m._id))] });
      },
      error: () => (this.pollingDetail = false),
    });
  }

  // ===== Trả lời (API-106), câu trả lời nhanh =====

  useQuick(text: string): void {
    // Chèn vào ô soạn để nhân viên sửa trước khi gửi (AC6)
    this.draft.set(this.draft().trim() ? `${this.draft().trim()} ${text}` : text);
    this.showQuick.set(false);
  }

  send(): void {
    const d = this.detail();
    if (!d || !this.canSend()) return;
    this.sending.set(true);
    this.api.reply(d._id, this.draft().trim()).subscribe({
      next: (m) => {
        this.sending.set(false);
        this.draft.set('');
        const cur = this.detail();
        if (cur && cur._id === d._id && !cur.messages.some((x) => x._id === m._id)) this.detail.set({ ...cur, messages: [...cur.messages, m] });
        this.loadQueue();
      },
      error: (e: ApiError) => {
        this.sending.set(false);
        this.toast.show(e.message);
        this.select(d._id, false);
      },
    });
  }

  // Enter gửi, Shift+Enter xuống dòng
  onEnter(e: KeyboardEvent): void {
    if (e.shiftKey || e.isComposing) return;
    e.preventDefault();
    this.send();
  }

  // ===== Kết thúc (API-107) =====

  finish(): void {
    const d = this.detail();
    if (!d) return;
    this.closeConfirm.set(false);
    this.api.close(d._id).subscribe({
      next: () => {
        this.toast.show('Đã kết thúc hỗ trợ, khách nhận lời cảm ơn');
        this.select(d._id, false);
        this.loadQueue();
      },
      error: (e: ApiError) => this.toast.show(e.message),
    });
  }

  // ===== Nhãn (API-206) =====

  editLabels(): void {
    this.labelEdit.set((this.detail()?.labels || []).map((l) => l.code));
  }

  toggleLabel(code: ChatLabelCode): void {
    const cur = this.labelEdit() || [];
    this.labelEdit.set(cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code]);
  }

  saveLabels(auto = false): void {
    const d = this.detail();
    const list = this.labelEdit();
    if (!d || (!auto && !list?.length)) return;
    this.api.setLabels(d._id, auto ? null : list).subscribe({
      next: (r) => {
        const cur = this.detail();
        if (cur && cur._id === d._id) this.detail.set({ ...cur, labels: r.labels, labelsManual: r.labelsManual });
        this.labelEdit.set(null);
        this.toast.show(auto ? 'Đã trả về nhãn tự động' : 'Đã lưu nhãn, hệ thống sẽ không tự đổi nhãn hội thoại này');
        this.loadQueue();
      },
      error: (e: ApiError) => this.toast.show(e.message, 'danger'),
    });
  }

  // ===== Ghi chú nội bộ (API-176) =====

  saveNote(): void {
    const d = this.detail();
    if (!d || !this.canSaveNote()) return;
    this.noteSaving.set(true);
    this.api.addNote(d._id, this.noteText().trim()).subscribe({
      next: (n) => {
        this.noteSaving.set(false);
        this.noteOpen.set(false);
        this.noteText.set('');
        const cur = this.detail();
        if (cur && cur._id === d._id) this.detail.set({ ...cur, notes: [n, ...(cur.notes || [])] });
      },
      error: (e: ApiError) => {
        this.noteSaving.set(false);
        this.toast.show(e.message);
      },
    });
  }

  // ===== Đang trực (API-177) =====

  toggleDuty(): void {
    const l = this.list();
    if (!l || this.dutyBusy()) return;
    if (!l.onDuty) return this.applyDuty(true);
    if (l.finishing) return this.applyDuty(true); // đang "xử lý nốt": bật lại nhận hội thoại mới
    if (this.mine().length) {
      this.handover.set('REASSIGN');
      this.dutyDialog.set(true);
      return;
    }
    this.applyDuty(false);
  }

  applyDuty(on: boolean, handover?: 'REASSIGN' | 'FINISH_FIRST'): void {
    this.dutyBusy.set(true);
    this.api.setDuty(on, handover).subscribe({
      next: (r) => {
        this.dutyBusy.set(false);
        this.dutyDialog.set(false);
        if (r.reassigned) this.toast.show(`Đã chuyển ${r.reassigned} hội thoại cho nhân viên đang trực`);
        if (r.returnedToQueue) this.toast.show(`${r.returnedToQueue} hội thoại đã về hàng đợi chung`);
        if (r.finishing) this.toast.show('Không nhận hội thoại mới, tự tắt Đang trực khi xong hội thoại cuối');
        this.loadQueue();
        const d = this.detail();
        if (d) this.select(d._id, false);
      },
      error: (e: ApiError) => {
        this.dutyBusy.set(false);
        if (e.code === 'HANDOVER_REQUIRED') this.dutyDialog.set(true);
        else this.toast.show(e.message);
      },
    });
  }

  // ===== Hiển thị =====

  toggleOriginal(m: IChatMessage): void {
    this.showOriginal.update((s) => ({ ...s, [m._id]: !s[m._id] }));
  }

  copy(text: string): void {
    navigator.clipboard?.writeText(text).then(() => this.toast.show('Đã sao chép'));
  }

  // Thời gian ở danh sách: "vừa xong", "5 phút", "14:20", "Hôm qua", "12/10"
  timeText(iso: string): string {
    const t = new Date(iso);
    const mins = Math.floor((Date.now() - t.getTime()) / 60000);
    if (mins < 1) return 'vừa xong';
    if (mins < 60) return `${mins} phút`;
    const today = new Date();
    if (t.toDateString() === today.toDateString()) return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    const y = new Date(today.getTime() - 86400000);
    if (t.toDateString() === y.toDateString()) return 'Hôm qua';
    return `${String(t.getDate()).padStart(2, '0')}/${String(t.getMonth() + 1).padStart(2, '0')}`;
  }

  dayText(iso: string): string {
    const t = new Date(iso);
    const today = new Date();
    if (t.toDateString() === today.toDateString()) return 'Hôm nay';
    if (t.toDateString() === new Date(today.getTime() - 86400000).toDateString()) return 'Hôm qua';
    return `${String(t.getDate()).padStart(2, '0')}/${String(t.getMonth() + 1).padStart(2, '0')}/${t.getFullYear()}`;
  }

  preview(c: IQueueItem): string {
    if (!c.lastText) return c.topic;
    const who = c.lastSender === 'ADMIN' ? (c.isMine ? 'Bạn: ' : `${c.assignedName || 'Nhân viên'}: `) : c.lastSender === 'BOT' ? 'Sâu Béo: ' : c.lastSender === 'HE_THONG' ? '' : '';
    return who + c.lastText;
  }
}
