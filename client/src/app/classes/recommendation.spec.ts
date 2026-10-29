import {
  AGE_MAX,
  AGE_MIN,
  BUDGET_MAX,
  IAdvisorForm,
  IRecommendInput,
  atLeastOneCriterion,
  budgetLabel,
  criteriaCount,
  pct,
  toFilterParams,
  toFormValue,
  toRequest,
  withoutChip,
} from './recommendation';

// Form và chip tiêu chí của Tư vấn quà AI SCR-10 (UC-DIS-05)
const EMPTY: IAdvisorForm = {
  recipient: null,
  occasions: [],
  hobbies: [],
  personalities: [],
  age: { min: AGE_MIN, max: AGE_MAX },
  budget: { min: 0, max: BUDGET_MAX },
  note: '',
};
const input = (o: Partial<IRecommendInput>): IRecommendInput => ({ ...toRequest(EMPTY), ...o });

describe('recommendation', () => {
  it('3Ea: form trống thì validator nhóm báo atLeastOne; thanh kéo ở 2 đầu không tính là đã chọn', () => {
    expect(atLeastOneCriterion({ value: EMPTY } as never)).toEqual({ atLeastOne: true });
    expect(atLeastOneCriterion({ value: { ...EMPTY, note: '  ' } } as never)).toEqual({ atLeastOne: true });
    expect(atLeastOneCriterion({ value: { ...EMPTY, budget: { min: 0, max: 500000 } } } as never)).toBeNull();
  });

  it('đếm tiêu chí: mỗi lựa chọn 1, độ tuổi và ngân sách mỗi thứ 1, mô tả 1', () => {
    const v: IAdvisorForm = { ...EMPTY, recipient: 'ban-trai', occasions: ['sinh-nhat'], hobbies: ['bong-da', 'anime-manga'], age: { min: 18, max: 32 }, budget: { min: 200000, max: 600000 }, note: 'mê Messi' };
    expect(criteriaCount(v)).toBe(7);
    expect(criteriaCount(EMPTY)).toBe(0);
  });

  it('toRequest: 1.000.000đ+ là không giới hạn trên, 0đ là không có mức tối thiểu', () => {
    expect(toRequest({ ...EMPTY, budget: { min: 0, max: 500000 } })).toEqual(partial({ budgetMin: null, budgetMax: 500000 }));
    expect(toRequest({ ...EMPTY, budget: { min: 200000, max: BUDGET_MAX } })).toEqual(partial({ budgetMin: 200000, budgetMax: null }));
    expect(toRequest({ ...EMPTY, age: { min: 18, max: AGE_MAX } })).toEqual(partial({ ageMin: 18, ageMax: 40 }));
  });

  it('toFormValue ngược lại toRequest (Sửa tiêu chí, điền lại sau khi đăng nhập)', () => {
    const v: IAdvisorForm = { ...EMPTY, recipient: 'khac', personalities: ['nang-dong'], age: { min: 20, max: 30 }, budget: { min: 100000, max: 700000 }, note: 'thích game' };
    expect(toFormValue(toRequest(v))).toEqual(v);
  });

  it('8c: bỏ chip theo loại, giữ noteTags còn lại', () => {
    const i = input({ recipient: 'ban-trai', occasions: ['sinh-nhat', 'valentine'], noteTags: ['SO_THICH:game-pc', 'SO_THICH:game-mobile'], ageMin: 18, ageMax: 25, budgetMax: 500000 });
    expect(withoutChip(i, { key: 'x', type: 'occasions', value: 'DIP_TANG:sinh-nhat', label: 'Sinh nhật' }).occasions).toEqual(['valentine']);
    expect(withoutChip(i, { key: 'x', type: 'noteTags', value: 'SO_THICH:game-pc', label: 'Game PC' }).noteTags).toEqual(['SO_THICH:game-mobile']);
    expect(withoutChip(i, { key: 'x', type: 'recipient', value: 'DOI_TUONG:ban-trai', label: 'Bạn trai' }).recipient).toBeNull();
    const noBudget = withoutChip(i, { key: 'budget', type: 'budget', value: null, label: 'Dưới 500.000đ' });
    expect([noBudget.budgetMin, noBudget.budgetMax]).toEqual([null, null]);
    expect(i.occasions).toEqual(['sinh-nhat', 'valentine']); // không sửa tiêu chí gốc
  });

  it('8b: tiêu chí sang query params SCR-02 (?tags, ?gia, ?age); người nhận "Khác" không thành tag', () => {
    const p = toFilterParams(input({ recipient: 'khac', occasions: ['sinh-nhat'], hobbies: ['bong-da'], noteTags: ['SO_THICH:gym'], budgetMax: 500000, ageMin: 18, ageMax: 25 }));
    expect(p).toEqual({ tags: 'sinh-nhat,bong-da,gym', gia: '0-500000', age: '18-25' });
    expect(toFilterParams(input({}))).toEqual({ tags: null, gia: null, age: null });
  });

  it('hiển thị: phần trăm phù hợp 1-99, nhãn ngân sách 1.000.000đ+', () => {
    expect(pct(0.925)).toBe(93);
    expect(pct(0)).toBe(1);
    expect(pct(1)).toBe(99);
    expect(budgetLabel({ min: 200000, max: BUDGET_MAX })).toBe('200.000đ - 1.000.000đ+');
  });
});

// So khớp một phần object
function partial(part: Partial<IRecommendInput>) {
  return expect.objectContaining(part);
}
