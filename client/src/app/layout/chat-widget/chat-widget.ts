import { Component, ElementRef, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { ChatService } from '../../services/chat';
import { AuthService } from '../../services/auth';
import { CHAT_MESSAGE_MAX, IChatBubble, validContact } from '../../classes/chat';

// SCR-29 Cửa sổ chat "Sâu Béo" - widget nổi trên mọi trang khách (UC-CSK-01, CSK-02, CSK-03).
// Trạng thái hội thoại và polling nằm ở ChatService để nút "Chat với Soulprint" ở SCR-19 mở được cùng một cửa sổ.
// Tài khoản nhân viên không chat với chính cửa hàng nên không hiện widget.
@Component({
  selector: 'app-chat-widget',
  standalone: false,
  templateUrl: './chat-widget.html',
  styleUrl: './chat-widget.scss',
})
export class ChatWidget {
  readonly chat = inject(ChatService);
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  @ViewChild('log') log?: ElementRef<HTMLElement>;
  @ViewChild('box') box?: ElementRef<HTMLTextAreaElement>;

  readonly max = CHAT_MESSAGE_MAX;
  readonly leaveContact = signal('');
  readonly leaveText = signal('');
  readonly leaveTouched = signal(false);

  // Lời nhắc "Cần giúp chọn quà?": không hiện ở trang đơn hàng, thanh toán (che khối Thanh toán); trang khác
  // tự thu gọn sau 8 giây, lần mở sau vẫn hiện (chỉ bấm X mới tắt hẳn)
  private readonly tipPage = signal(true);
  private readonly tipTimedOut = signal(false);
  readonly tipVisible = computed(() => this.chat.showTip() && !this.chat.conversationId() && this.tipPage() && !this.tipTimedOut());

  // Đang nối nhân viên mà khách chưa nhắn gì: bỏ lời chào của bot
  readonly shown = computed(() => {
    const list = this.chat.messages();
    return this.chat.staffMode() && !list.some((m) => m.sender === 'KHACH') ? list.filter((m) => m.sender !== 'BOT') : list;
  });

  readonly tooLong = computed(() => this.chat.draft().length > this.max);
  readonly canSend = computed(() => !!this.chat.draft().trim() && !this.tooLong() && !this.chat.sending() && !this.chat.offline() && !this.chat.closed());
  // Lỗi tại ô của form để lại lời nhắn: kiểm ở client trước, server trả lỗi thì hiện lỗi server
  readonly leaveContactError = computed(() => {
    const server = this.chat.leaveErrors()['contact'];
    if (server) return server;
    if (!this.leaveTouched()) return '';
    const c = this.leaveContact().trim();
    if (!c) return 'Vui lòng nhập số điện thoại hoặc email';
    return validContact(c) ? '' : 'Số điện thoại hoặc email chưa đúng';
  });
  readonly leaveTextError = computed(() => {
    const server = this.chat.leaveErrors()['text'];
    if (server) return server;
    if (!this.leaveTouched()) return '';
    const t = this.leaveText().trim();
    if (!t) return 'Vui lòng nhập nội dung';
    return t.length > this.max ? `Nội dung tối đa ${this.max} ký tự` : '';
  });

  constructor() {
    // Tin mới thì cuộn xuống cuối khung chat
    effect(() => {
      this.chat.messages();
      this.chat.proposal();
      this.chat.leaveOpen();
      if (this.chat.isOpen()) setTimeout(() => this.scrollToEnd());
    });
    // Mở form để lại lời nhắn: Member điền sẵn SĐT tài khoản
    effect(() => {
      if (this.chat.leaveOpen() && !this.leaveContact()) this.leaveContact.set(this.auth.currentUser()?.phone || '');
    });
    // Liên kết trong thông báo "Soulprint đã trả lời bạn" (/?chat=1) mở luôn cửa sổ chat
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe((e) => {
      const url = (e as NavigationEnd).urlAfterRedirects;
      if (url.includes('chat=1') && !this.auth.isStaff()) this.chat.open();
      // Trang có form (đăng nhập, đăng ký, đặt lại mật khẩu) cũng không hiện để bong bóng không che ô nhập
      this.tipPage.set(!/^\/(tai-khoan\/don-hang|thanh-toan|dat-hang|dat-gap|tra-cuu-don|gio-hang|dang-nhap|dang-ky|quen-mat-khau|dat-mat-khau)/.test(url));
    });
    setTimeout(() => this.tipTimedOut.set(true), 8000);
  }

  toggle(): void {
    if (this.chat.isOpen()) this.chat.close();
    else {
      this.chat.open();
      setTimeout(() => this.box?.nativeElement.focus());
    }
  }

  submit(): void {
    if (this.canSend()) this.chat.send(this.chat.draft());
  }

  // Ô nhập nhiều dòng: Enter gửi, Shift+Enter xuống dòng; đang gõ dấu (bộ gõ ghép chữ) thì bỏ qua
  onEnter(e: KeyboardEvent): void {
    if (e.shiftKey || e.isComposing) return;
    e.preventDefault();
    this.submit();
  }

  topic(t: string): void {
    this.chat.send(t);
  }

  // Chip "Hủy đơn": mở chi tiết đơn với hộp thoại hủy, lý do "Đơn hàng không thể thực hiện" chọn sẵn
  cancelOrder(code: string): void {
    this.chat.orderReplies.set(null);
    this.chat.close();
    this.router.navigate(['/tai-khoan/don-hang', code], { queryParams: { huy: 'khong-the-thuc-hien' } });
  }

  submitLeave(): void {
    this.leaveTouched.set(true);
    this.chat.leaveErrors.set({});
    if (this.leaveContactError() || this.leaveTextError()) return;
    this.chat.escalate({ contact: this.leaveContact().trim(), text: this.leaveText().trim() });
  }

  follow(url: string): void {
    this.router.navigateByUrl(url);
    // Màn hình nhỏ: cửa sổ chat che trang nên thu lại khi chuyển trang
    if (window.innerWidth < 576) this.chat.close();
  }

  // Bot và nhân viên hiện tên trên bong bóng; tin của khách căn phải
  isMine(m: IChatBubble): boolean {
    return m.sender === 'KHACH';
  }

  private scrollToEnd(): void {
    const el = this.log?.nativeElement;
    if (el) el.scrollTop = el.scrollHeight;
  }
}
