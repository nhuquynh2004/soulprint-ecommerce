import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { IAddress } from '../../../classes/user';

// Hộp thoại "Kho địa chỉ" ở SCR-07 (UC-PAY-02 nhánh 2b, 4a): component con nhận danh sách bằng @Input,
// trả địa chỉ đã chọn (kèm ý muốn đặt làm "Địa chỉ của tôi") bằng @Output - Component Interaction, Chương II.
@Component({
  selector: 'app-address-picker',
  standalone: false,
  templateUrl: './address-picker.html',
  styleUrl: './address-picker.scss',
})
export class AddressPicker implements OnInit {
  @Input({ required: true }) addresses: IAddress[] = [];
  @Input() currentId: string | null = null;
  @Input() showSetDefault = true;
  @Output() picked = new EventEmitter<{ address: IAddress; setAsDefault: boolean }>();
  @Output() addNew = new EventEmitter<void>();
  @Output() closed = new EventEmitter<void>();

  selectedId = '';
  setAsDefault = false;

  ngOnInit(): void {
    this.selectedId = this.currentId || this.addresses.find((a) => a.isDefault)?._id || this.addresses[0]?._id || '';
  }

  get selected(): IAddress | undefined {
    return this.addresses.find((a) => a._id === this.selectedId);
  }

  use(): void {
    const address = this.selected;
    if (address) this.picked.emit({ address, setAsDefault: this.setAsDefault && !address.isDefault });
  }
}
