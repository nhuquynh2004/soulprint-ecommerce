import { FormControl, FormGroup } from '@angular/forms';
import { waitingText } from './aftersales';
import { returnRules } from '../features/account/orders/return-request/return-request';

// Validator nhóm của form đổi trả SCR-25 (UC-TRK-04): BR-13, BR-14, BR-31
describe('returnRules', () => {
  const personalized = (id: string) => id === 'khac-ten';
  const form = (items: { orderItemId: string; selected: boolean }[], reason: string, images: string[] = [], conditionConfirmed = false) =>
    new FormGroup(
      {
        items: new FormControl(items),
        reason: new FormControl(reason),
        images: new FormControl(images),
        conditionConfirmed: new FormControl(conditionConfirmed),
      },
      { validators: returnRules(personalized) },
    );

  it('chưa chọn sản phẩm nào thì báo noItem', () => {
    expect(form([{ orderItemId: 'ao', selected: false }], 'DOI_Y').errors).toEqual({ noItem: true });
  });

  it('lỗi in/khắc không có ảnh thì bắt buộc ảnh (BR-31, AC3)', () => {
    expect(form([{ orderItemId: 'ao', selected: true }], 'LOI_IN_KHAC', [], true).errors).toEqual({ photoRequired: true });
    expect(form([{ orderItemId: 'ao', selected: true }], 'LOI_IN_KHAC', ['data:image/jpeg;base64,x'], true).errors).toBeNull();
  });

  it('món cá nhân hóa: không chọn được Đổi ý và luôn cần ảnh (BR-14, AC2)', () => {
    const e = form([{ orderItemId: 'khac-ten', selected: true }], 'DOI_Y').errors!;
    expect(e['personalizedChangeMind']).toBe(true);
    expect(e['photoRequired']).toBe(true);
    expect(e['conditionRequired']).toBeUndefined();
  });

  it('sản phẩm thường cần xác nhận còn tem, nhãn, bao bì (BR-13)', () => {
    expect(form([{ orderItemId: 'ao', selected: true }], 'GIAO_SAI').errors).toEqual({ conditionRequired: true });
    expect(form([{ orderItemId: 'ao', selected: true }], 'GIAO_SAI', [], true).errors).toBeNull();
  });
});

describe('waitingText', () => {
  it('cột Ưu tiên SCR-50: "chờ N giờ", từ 48 giờ đổi sang ngày', () => {
    expect(waitingText(0)).toBe('Vừa gửi');
    expect(waitingText(26)).toBe('Chờ 26 giờ');
    expect(waitingText(50)).toBe('Chờ 2 ngày');
  });
});
