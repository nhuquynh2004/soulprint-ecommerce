import { Component, inject, signal } from '@angular/core';
import { AdminOrderApiService } from '../../../services/admin-order-apiservice';
import { AuthService } from '../../../services/auth';
import { ToastService } from '../../../services/toast';
import { ApiError } from '../../../classes/api-error';
import { DISPOSAL_METHODS, IStorageRow } from '../../../classes/admin-order';
import { saveTextFile } from '../../../shared/save-file';

type Group = '' | 'dang-luu' | 'sap-het-han' | 'cho-tieu-huy' | 'da-tieu-huy';

// SCR-51 Hàng lưu kho (UC-OPS-05): 3 thẻ đếm, tab Đang lưu / Sắp hết hạn / Chờ tiêu hủy, mã lưu + vị trí kệ,
// sản phẩm In/Khắc, lý do, hạn lưu; "Liên hệ khách", "Ghi vị trí kệ" (API-194), "Tiêu hủy" (API-103), "Xuất danh sách".
@Component({
  selector: 'app-storage-page',
  standalone: false,
  templateUrl: './storage-page.html',
  styleUrl: './storage-page.scss',
})
export class StoragePage {
  private readonly api = inject(AdminOrderApiService);
  protected readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  readonly methods = DISPOSAL_METHODS;
  readonly tabs: { key: Group; label: string }[] = [
    { key: '', label: 'Tất cả' },
    { key: 'dang-luu', label: 'Đang lưu' },
    { key: 'sap-het-han', label: 'Sắp hết hạn' },
    { key: 'cho-tieu-huy', label: 'Chờ tiêu hủy' },
    { key: 'da-tieu-huy', label: 'Đã tiêu hủy' }, // tra cứu, không tính vào Tất cả
  ];

  readonly group = signal<Group>('');
  readonly page = signal(1);
  readonly items = signal<IStorageRow[]>([]);
  readonly counts = signal<Record<string, number>>({});
  readonly total = signal(0);
  readonly pageSize = signal(20);
  readonly loading = signal(true);
  readonly errMessage = signal('');
  readonly busy = signal(false);

  readonly contact = signal<IStorageRow | null>(null);
  readonly shelfFor = signal<IStorageRow | null>(null);
  readonly shelf = signal('');
  readonly disposeFor = signal<IStorageRow | null>(null);
  readonly method = signal('');
  readonly checked = signal(false);
  readonly formError = signal('');

  constructor() {
    this.load();
  }

  allCount(): number {
    const c = this.counts();
    return (c['dang-luu'] || 0) + (c['sap-het-han'] || 0) + (c['cho-tieu-huy'] || 0);
  }

  load(): void {
    this.errMessage.set('');
    this.api.getStorage({ storage: this.group(), page: this.page() }).subscribe({
      next: (d) => {
        this.items.set(d.items);
        this.counts.set(d.storageCounts || {});
        this.total.set(d.total);
        this.pageSize.set(d.pageSize);
        this.loading.set(false);
      },
      error: (err: ApiError) => {
        this.errMessage.set(err.message);
        this.loading.set(false);
      },
    });
  }

  setGroup(g: Group): void {
    this.group.set(g);
    this.page.set(1);
    this.load();
  }

  goPage(p: number): void {
    this.page.set(p);
    this.load();
  }

  deadlineText(r: IStorageRow): string {
    if (r.daysLeft === null) return '';
    return r.daysLeft >= 0 ? `còn ${r.daysLeft} ngày` : `quá ${-r.daysLeft} ngày`;
  }

  levelClass(r: IStorageRow): string {
    return r.group === 'cho-tieu-huy' ? 'urgent' : r.group === 'sap-het-han' ? 'attention' : 'normal';
  }

  openShelf(r: IStorageRow): void {
    this.formError.set('');
    this.shelf.set(r.storageShelf || '');
    this.shelfFor.set(r);
  }

  saveShelf(): void {
    const r = this.shelfFor()!;
    this.busy.set(true);
    this.api.setShelf(r.code, this.shelf().trim()).subscribe({
      next: () => {
        this.busy.set(false);
        this.shelfFor.set(null);
        this.toast.show(`Đã ghi vị trí kệ cho ${r.storageCode}`);
        this.load();
      },
      error: (err: ApiError) => {
        this.busy.set(false);
        this.formError.set(err.message);
      },
    });
  }

  openDispose(r: IStorageRow): void {
    this.formError.set('');
    this.method.set('');
    this.checked.set(false);
    this.disposeFor.set(r);
  }

  doDispose(): void {
    const r = this.disposeFor()!;
    this.busy.set(true);
    this.api.dispose(r.code, this.method()).subscribe({
      next: (res) => {
        this.busy.set(false);
        this.disposeFor.set(null);
        this.toast.show(res.refund ? `Đã tiêu hủy ${r.storageCode}, tạo yêu cầu hoàn ${res.refund.toLocaleString('vi-VN')}đ phần hàng thường` : `Đã tiêu hủy ${r.storageCode}`);
        this.load();
      },
      error: (err: ApiError) => {
        this.busy.set(false);
        this.formError.set(err.message);
      },
    });
  }

  // Xuất danh sách đang hiển thị (API-159 EXPORT_CSV kind=storage)
  exportList(): void {
    const codes = this.items().map((r) => r.code);
    if (!codes.length) return;
    this.api.exportCsv(codes, 'storage').subscribe({
      next: (csv) => {
        saveTextFile(csv, `hang-luu-kho-${new Date().toISOString().slice(0, 10)}.csv`);
      },
      error: (err: ApiError) => this.toast.show(err.message, 'danger'),
    });
  }

  copyPhone(phone: string): void {
    navigator.clipboard?.writeText(phone).then(() => this.toast.show('Đã sao chép số điện thoại'));
  }
}
