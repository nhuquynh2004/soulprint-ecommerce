import { Component, EventEmitter, Input, OnInit, Output, signal } from '@angular/core';
import { BANKS } from '../../classes/order';
import { RefundAccountValue } from '../../classes/aftersales';

// Khối "Tài khoản nhận tiền hoàn" dùng ở SCR-25 (trả hàng hoàn tiền) và SCR-28 (nhận tiền hoàn, nhập lại tài
// khoản): tài khoản đã lưu (che số) hoặc form Ngân hàng, Số tài khoản, Tên chủ tài khoản, "Lưu tài khoản cho lần sau".
// editOnly (SCR-15): chỉ form, không có "Lưu cho lần sau" và "Dùng tài khoản đã lưu"; sửa thì điền sẵn ngân hàng, tên.
// Phát (changed) mỗi lần đổi; null khi chưa nhập đủ.
@Component({
  selector: 'app-refund-account',
  standalone: false,
  templateUrl: './refund-account.html',
  styleUrl: './refund-account.scss',
})
export class RefundAccount implements OnInit {
  @Input() saved: { bankName: string; accountName: string; account: string } | null = null;
  // Nhập lại sau khi chuyển khoản thất bại: không dùng lại tài khoản cũ
  @Input() forceNew = false;
  @Input() fieldErrors: Record<string, string> = {};
  @Input() editOnly = false;
  // Trang cha bấm gửi khi còn thiếu: báo lỗi mọi ô như đã rời ô
  @Input() touchAll = false;
  @Output() changed = new EventEmitter<RefundAccountValue | null>();

  readonly banks = BANKS;
  readonly useSaved = signal(false);
  account = { bankName: '', accountNumber: '', accountName: '' };
  saveAccount = true;
  // Ô đã rời: báo lỗi tại chỗ thay vì chỉ khóa nút gửi
  readonly touched = signal<Record<string, boolean>>({});

  ngOnInit(): void {
    if (this.editOnly && this.saved) Object.assign(this.account, { bankName: this.saved.bankName, accountName: this.saved.accountName });
    this.useSaved.set(!!this.saved && !this.forceNew && !this.editOnly);
    this.emit();
  }

  setSaved(v: boolean): void {
    this.useSaved.set(v);
    this.emit();
  }

  touch(field: string): void {
    this.touched.update((t) => ({ ...t, [field]: true }));
  }

  // Số tài khoản chỉ nhận chữ số, tối đa 20 (quy tắc như server)
  onNumber(el: HTMLInputElement): void {
    const digits = el.value.replace(/\D/g, '').slice(0, 20);
    if (el.value !== digits) el.value = digits;
    this.account.accountNumber = digits;
    this.emit();
  }

  // Lỗi hiện dưới ô: lỗi server trả về ưu tiên, không thì kiểm tại chỗ khi đã rời ô
  error(field: 'bankName' | 'accountNumber' | 'accountName'): string {
    const server = this.fieldErrors['refundAccount.' + field];
    if (server) return server;
    if (!this.touched()[field] && !this.touchAll) return '';
    const a = this.account;
    if (field === 'bankName') return a.bankName ? '' : 'Vui lòng chọn ngân hàng';
    if (field === 'accountNumber') {
      const n = a.accountNumber.length;
      return n >= 6 && n <= 20 ? '' : `Số tài khoản gồm 6 đến 20 chữ số (đang có ${n})`;
    }
    return a.accountName.trim().length >= 2 ? '' : 'Nhập tên chủ tài khoản như trên thẻ';
  }

  // Tên chủ tài khoản in hoa không dấu như trên thẻ
  normalizeName(): void {
    this.touch('accountName');
    this.account.accountName = this.account.accountName.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toUpperCase();
    this.emit();
  }

  emit(): void {
    if (this.useSaved() && this.saved) {
      this.changed.emit({ useSavedAccount: true });
      return;
    }
    const a = this.account;
    const ok = !!a.bankName && /^\d{6,20}$/.test(a.accountNumber.replace(/[\s.-]/g, '')) && a.accountName.trim().length >= 2;
    this.changed.emit(ok ? { refundAccount: { ...a }, saveAccount: this.saveAccount } : null);
  }
}
