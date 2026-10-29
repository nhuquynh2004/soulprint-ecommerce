import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, RouterModule, convertToParamMap } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { ProductDetail } from './product-detail';
import { IProductDetail } from '../../classes/product';

// Áo đấu TT-DNC-SNBD-001 rút gọn từ seed: nhóm Màu sắc gắn ảnh (Vàng chưa có ảnh), Size; XL chênh +20.000đ; Vàng/XL hết hàng
const AO_DAU = {
  _id: 'p1',
  sku: 'TT-DNC-SNBD-001',
  name: 'Áo đấu CLB in tên số áo',
  slug: 'ao-dau-clb-in-ten-so-ao',
  images: ['/images/products/tt-dnc-snbd-001-1.svg'],
  price: 450000,
  finalPrice: 399000,
  onSale: true,
  discountPercent: 11,
  optionGroups: [
    {
      name: 'Màu sắc',
      hasImages: true,
      values: [
        { value: 'Đỏ đô', code: 'DO', images: ['/do.svg'] },
        { value: 'Xanh navy', code: 'NAVY', images: ['/navy-1.svg', '/navy-2.svg', '/navy-3.svg'] },
        { value: 'Vàng', code: 'VANG', images: [] },
      ],
    },
    { name: 'Size', hasImages: false, values: [{ value: 'M', code: 'M' }, { value: 'L', code: 'L' }, { value: 'XL', code: 'XL' }] },
  ],
  variants: ['Đỏ đô', 'Xanh navy', 'Vàng'].flatMap((color) =>
    ['M', 'L', 'XL'].map((size) => ({
      sku: `${color}-${size}`,
      name: `${color} / ${size}`,
      attributes: { 'Màu sắc': color, Size: size },
      priceDelta: size === 'XL' ? 20000 : 0,
      stock: color === 'Vàng' && size === 'XL' ? 0 : 5,
    })),
  ),
  personalization: { allowed: false },
  specs: {},
  labels: { isNew: false, isBestSeller: false, personalization: [] },
  sizeChart: null,
  related: [],
  tags: [],
  category: null,
  stickerSets: [],
} as unknown as IProductDetail;

describe('ProductDetail - chọn biến thể (UC-DIS-02, BR-39)', () => {
  let component: ProductDetail;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RouterModule.forRoot([])],
      declarations: [ProductDetail],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ slug: AO_DAU.slug })), snapshot: { paramMap: convertToParamMap({ slug: AO_DAU.slug }), queryParamMap: convertToParamMap({}) } } },
      ],
    })
      .overrideComponent(ProductDetail, { set: { template: '' } })
      .compileComponents();

    component = TestBed.createComponent(ProductDetail).componentInstance;
    const http = TestBed.inject(HttpTestingController);
    http.expectOne((r) => r.url === '/api/products/' + AO_DAU.slug).flush(JSON.stringify(AO_DAU));
  });

  const pick = (group: number, value: string) => component.select(component.groups()[group], value);

  it('mở trang thì chọn sẵn tổ hợp còn hàng đầu tiên', () => {
    expect(component.selected()).toEqual({ 'Màu sắc': 'Đỏ đô', Size: 'M' });
    expect(component.unitPrice()).toBe(399000);
  });

  it('AC7: chọn tổ hợp có chênh giá +20.000đ thì giá tăng 20.000đ', () => {
    pick(1, 'XL');
    expect(component.unitPrice()).toBe(419000);
    expect(component.wasPrice()).toBe(470000);
  });

  it('AC6: chọn Xanh navy thì bộ ảnh là 3 ảnh của Xanh navy; Vàng chưa có ảnh thì dùng ảnh chính; đổi Size không đổi ảnh', () => {
    pick(0, 'Xanh navy');
    expect(component.images()).toEqual(['/navy-1.svg', '/navy-2.svg', '/navy-3.svg']);
    pick(1, 'L');
    expect(component.images()).toEqual(['/navy-1.svg', '/navy-2.svg', '/navy-3.svg']);
    pick(0, 'Vàng');
    expect(component.images()).toEqual(['/images/products/tt-dnc-snbd-001-1.svg']);
  });

  it('AC2: chọn tổ hợp hết hàng thì báo hết và có 1 hộp cảnh báo gợi ý size khác', () => {
    pick(0, 'Vàng');
    pick(1, 'XL');
    expect(component.soldOut()).toBe(true);
    expect(component.isOut('Size', 'XL')).toBe(true);
    expect(component.stockWarning()).toBe('Size XL tạm hết hàng. Bạn chọn size M hoặc L nhé');
  });

  it('số lượng không vượt tồn kho', () => {
    component.changeQuantity(10);
    expect(component.quantity()).toBe(5);
    component.changeQuantity(-10);
    expect(component.quantity()).toBe(1);
  });
});
