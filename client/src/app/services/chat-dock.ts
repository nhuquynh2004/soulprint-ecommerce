import { Injectable, signal } from '@angular/core';

export interface DockWindow {
  id: string;
  name: string;
  minimized: boolean;
  draft?: string; // tin mở đầu điền sẵn vào ô soạn tin khi mở từ đơn hàng
}

const KEY = 'sp.chatDock';
const MAX_WINDOWS = 2;

// Chat nổi khu quản trị kiểu Messenger web: danh sách hội thoại mở từ nút chat trên thanh đầu, tối đa 2 cửa sổ
// ở góc dưới phải, thu gọn được, giữ khi chuyển trang (sessionStorage của tab). Trang khác gọi open() để mở hội thoại.
@Injectable({ providedIn: 'root' })
export class ChatDockService {
  readonly listOpen = signal(false);
  readonly windows = signal<DockWindow[]>(this.restore());

  open(id: string, name: string, draft?: string): void {
    const list = this.windows();
    const found = list.find((w) => w.id === id);
    let next: DockWindow[];
    if (found) next = list.map((w) => (w.id === id ? { ...w, minimized: false, ...(draft ? { draft } : {}) } : w));
    else next = [...list, { id, name, minimized: false, ...(draft ? { draft } : {}) }].slice(-MAX_WINDOWS);
    this.save(next);
    this.listOpen.set(false);
  }

  close(id: string): void {
    this.save(this.windows().filter((w) => w.id !== id));
  }

  toggleMin(id: string): void {
    this.save(this.windows().map((w) => (w.id === id ? { ...w, minimized: !w.minimized } : w)));
  }

  // Cửa sổ đã lấy tin mở đầu vào ô soạn: bỏ để lần mở sau không điền lại
  takeDraft(id: string): string {
    const w = this.windows().find((x) => x.id === id);
    if (!w?.draft) return '';
    this.save(this.windows().map((x) => (x.id === id ? { ...x, draft: undefined } : x)));
    return w.draft;
  }

  rename(id: string, name: string): void {
    if (this.windows().some((w) => w.id === id && w.name !== name)) this.save(this.windows().map((w) => (w.id === id ? { ...w, name } : w)));
  }

  private save(list: DockWindow[]): void {
    this.windows.set(list);
    try {
      sessionStorage.setItem(KEY, JSON.stringify(list));
    } catch {
      // trình duyệt chặn lưu trữ: cửa sổ vẫn mở trong lần xem này
    }
  }

  private restore(): DockWindow[] {
    try {
      const v = JSON.parse(sessionStorage.getItem(KEY) || '[]');
      return Array.isArray(v) ? v.filter((w) => w && typeof w.id === 'string').slice(-MAX_WINDOWS) : [];
    } catch {
      return [];
    }
  }
}
