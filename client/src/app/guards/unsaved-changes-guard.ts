import { CanDeactivateFn } from '@angular/router';
import { Observable } from 'rxjs';

// Form có dữ liệu chưa lưu (SCR-42 sản phẩm, SCR-54 bộ sưu tập, SCR-55 trang chủ, SCR-59 cài đặt) cài interface này.
// confirmLeave() mở hộp thoại "Rời trang khi chưa lưu?" của chính form (SCR-42-RoiTrang) và trả kết quả người dùng chọn.
export interface HasUnsavedChanges {
  hasUnsavedChanges(): boolean;
  confirmLeave(): Observable<boolean> | Promise<boolean> | boolean;
}

// Functional Guard CanDeactivateFn theo slide Chương IV: rời trang khi form đã sửa mà chưa lưu thì hỏi lại.
export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = (component) => {
  if (!component.hasUnsavedChanges()) return true;
  return component.confirmLeave();
};
