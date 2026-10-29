import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthService } from './auth';

// 3 từ khóa tìm gần nhất của Member (UC-DIS-03): lưu localStorage theo tài khoản, không gọi API.
// Hiện trong hộp gợi ý của ô tìm (Header) và ở trang Tìm kiếm khi chưa nhập từ khóa.
const MAX = 3;
const keyOf = (userId: string) => 'sp_recent_q_' + userId;

function read(key: string): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string').slice(0, MAX) : [];
  } catch {
    return [];
  }
}

function write(key: string, list: string[]): void {
  try {
    if (list.length) localStorage.setItem(key, JSON.stringify(list));
    else localStorage.removeItem(key);
  } catch {
    // trình duyệt chặn lưu trữ: chỉ không nhớ lịch sử
  }
}

@Injectable({ providedIn: 'root' })
export class RecentSearchService {
  private readonly auth = inject(AuthService);
  private readonly version = signal(0); // đọc lại localStorage sau mỗi lần ghi

  readonly items = computed(() => {
    this.version();
    const u = this.auth.currentUser();
    return u && u.role === 'member' ? read(keyOf(u._id)) : [];
  });

  add(keyword: string): void {
    const u = this.auth.currentUser();
    const q = keyword.trim().slice(0, 100);
    if (!u || u.role !== 'member' || !q) return;
    const key = keyOf(u._id);
    write(key, [q, ...read(key).filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, MAX));
    this.version.update((v) => v + 1);
  }

  clear(): void {
    const u = this.auth.currentUser();
    if (!u) return;
    write(keyOf(u._id), []);
    this.version.update((v) => v + 1);
  }
}
