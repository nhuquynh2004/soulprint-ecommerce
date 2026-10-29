import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { IAfterSalesRequest, IReturnRequest, IWarrantyRequest } from '../../../../classes/aftersales';

// Thẻ một yêu cầu đổi trả hoặc bảo hành (UC-TRK-04 8b, 8c; UC-TRK-05 bước 5): mã, trạng thái, hình thức và lý do, tiến
// trình, hướng dẫn gửi hàng khi đã duyệt, lý do và bằng chứng khi bị từ chối, đơn thay thế. Dùng ở SCR-19 và tab
// "Đổi trả và bảo hành" của SCR-18 (compact: kèm mã đơn gốc và nút xem đơn).
@Component({
  selector: 'app-request-card',
  standalone: false,
  templateUrl: './request-card.html',
  styleUrl: './request-card.scss',
})
export class RequestCard {
  @Input({ required: true }) request!: IAfterSalesRequest;
  @Input() compact = false;
  @Input() busy = false;
  @Output() cancelReturn = new EventEmitter<IReturnRequest>();

  get ret(): IReturnRequest | null {
    return this.request.kind === 'RETURN' ? this.request : null;
  }

  get war(): IWarrantyRequest | null {
    return this.request.kind === 'WARRANTY' ? this.request : null;
  }

  get title(): string {
    const r = this.request;
    if (r.kind === 'RETURN') {
      return { DANG_YEU_CAU: 'Đang xử lý yêu cầu đổi trả', DONG_Y: 'Yêu cầu đổi trả đã được duyệt', DA_NHAN_HANG: 'Soulprint đã nhận hàng trả về', DA_HOAN_TAT: 'Đổi trả hoàn tất', TU_CHOI: 'Yêu cầu đổi trả chưa được chấp nhận', DA_HUY: 'Đã hủy yêu cầu đổi trả' }[r.status];
    }
    return { DANG_XEM_XET: 'Đang xem xét yêu cầu bảo hành', DA_DUYET: 'Yêu cầu bảo hành đã được duyệt', DA_NHAN_HANG: 'Đang kiểm tra, sửa chữa', HOAN_TAT: 'Bảo hành hoàn tất', TU_CHOI: 'Yêu cầu bảo hành chưa được chấp nhận' }[r.status];
  }

  get products(): string {
    const r = this.request;
    return r.kind === 'RETURN' ? r.items.map((i) => `${i.name}${i.quantity > 1 ? ' x' + i.quantity : ''}`).join(', ') : r.item.name;
  }

  get image(): string | null {
    const r = this.request;
    return r.kind === 'RETURN' ? r.items[0]?.image || null : r.item.image;
  }

  get stopped(): boolean {
    return this.request.status === 'TU_CHOI';
  }

  // Bằng chứng là video MP4 (chỉ biết khi ảnh không hiển thị được): hiện biểu tượng video, bấm để mở
  readonly notImage = signal(new Set<string>());

  markVideo(url: string): void {
    this.notImage.set(new Set([...this.notImage(), url]));
  }
}
