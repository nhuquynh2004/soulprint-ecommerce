import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { Icon } from './icon/icon';
import { ProductCard } from './product-card/product-card';
import { Rating } from './rating/rating';
import { Pagination } from './pagination/pagination';
import { VndPipe } from './vnd-pipe';
import { Dialog } from './dialog/dialog';
import { PasswordField } from './password-field/password-field';
import { Toasts } from './toasts/toasts';
import { ChangePassword } from '../features/account/change-password/change-password';
import { PersonalizeDialog } from './personalize-dialog/personalize-dialog';
import { GiftDialog } from './gift-dialog/gift-dialog';
import { LoginPrompt } from './login-prompt/login-prompt';

// Component dùng chung cho cả module gốc và các module tải lười (Tài khoản, Quản trị).
// Một component NgModule chỉ được khai báo ở 1 module, nên gom vào đây rồi export.
// S4: hộp thoại cá nhân hóa (SCR-04), gói quà (SCR-06) dùng ở trang sản phẩm, giỏ hàng, Thiết kế đã lưu
import { OrderView } from './order-view/order-view';
// S9: ô tải ảnh, chọn địa chỉ lấy hàng, tài khoản nhận tiền hoàn (đổi trả, bảo hành, đánh giá, nhận lại hàng)
import { PhotoInput } from './photo-input/photo-input';
import { AddressSelect } from './address-select/address-select';
import { RefundAccount } from './refund-account/refund-account';
import { RangeSlider } from './range-slider/range-slider';
// Ô chọn có gõ tìm cho Tỉnh/Thành, Phường/Xã
import { SearchSelect } from './search-select/search-select';
import { SearchOptionsPipe } from './search-select/search-options-pipe';
import { AutosizeTextarea } from './autosize-textarea';
import { TabScroll } from './tab-scroll';
// Lịch chọn ngày giao
import { DateCalendar } from './date-calendar/date-calendar';
// Dòng mời đặt số lượng lớn
import { BulkOrderNote } from './bulk-order-note/bulk-order-note';
// Mã QR và liên kết thanh toán gửi khách
import { PayQr } from './pay-qr/pay-qr';
// Hộp xác nhận chung thay confirm() của trình duyệt
import { ConfirmHost } from './confirm-host/confirm-host';
const SHARED = [Icon, ProductCard, Rating, Pagination, VndPipe, Dialog, PasswordField, Toasts, ChangePassword, PersonalizeDialog, GiftDialog, LoginPrompt, OrderView, PhotoInput, AddressSelect, RefundAccount, SearchSelect, SearchOptionsPipe, AutosizeTextarea, TabScroll, DateCalendar, BulkOrderNote, PayQr, RangeSlider, ConfirmHost];

@NgModule({
  declarations: SHARED,
  imports: [CommonModule, RouterModule, FormsModule, ReactiveFormsModule],
  exports: [...SHARED, CommonModule, RouterModule, FormsModule, ReactiveFormsModule],
})
export class SharedModule {}
