// Mô hình sản phẩm phía client theo khuôn slide (interface IProduct + class Product có giá trị mặc định).
// Dữ liệu đến từ API-26, API-28 (07_API_Spec.md Mục 2.3).

export type Axis = 'THE_THAO' | 'ANIME' | 'GAME';
export type PersonalizationType = 'IN_KHAC' | 'THIET_KE';

export interface IProductLabels {
  isNew: boolean;
  isBestSeller: boolean;
  personalization: PersonalizationType[];
}

// Thẻ sản phẩm (danh sách, trang chủ, "Có thể bạn quan tâm")
export interface IProduct {
  _id: string;
  name: string;
  slug: string;
  image: string | null;
  price: number; // giá gốc
  finalPrice: number; // giá hiệu lực (giá sale nếu đang trong thời gian sale)
  onSale: boolean;
  discountPercent: number;
  saleEndAt: string | null;
  axis: Axis;
  ratingAvg: number;
  ratingCount: number;
  labels: IProductLabels;
  inStock: boolean;
}

export class Product implements IProduct {
  _id = '';
  name = '';
  slug = '';
  image: string | null = null;
  price = 0;
  finalPrice = 0;
  onSale = false;
  discountPercent = 0;
  saleEndAt: string | null = null;
  axis: Axis = 'THE_THAO';
  ratingAvg = 0;
  ratingCount = 0;
  labels: IProductLabels = { isNew: false, isBestSeller: false, personalization: [] };
  inStock = true;

  constructor(data?: Partial<IProduct>) {
    Object.assign(this, data);
  }

  // Ảnh lưu dạng đường dẫn /images/... hoặc /api/files/:id; proxy (dev) và vercel.json (production)
  // chuyển các đường dẫn này sang server, nên dùng thẳng. Chưa có ảnh thì trả ảnh giữ chỗ.
  getImageUrl(): string {
    return this.image || Product.PLACEHOLDER;
  }

  static readonly PLACEHOLDER = '/assets/brand/soulprint-mark.png';
}

export interface IOptionValue {
  value: string;
  code: string;
  images?: string[];
}

export interface IOptionGroup {
  name: string;
  hasImages: boolean;
  values: IOptionValue[];
}

export interface IVariant {
  sku: string;
  name: string;
  attributes: Record<string, string>;
  priceDelta: number;
  stock: number;
}

export interface ISizeChart {
  columns: string[];
  rows: string[][];
  note?: string;
}

export interface IStickerSet {
  _id: string;
  name: string;
  kind: 'THUONG' | 'BST_MUA';
  seasonLabel: string | null;
  badge: 'HOT' | 'MOI' | null;
  stickers: { code: string; name: string; image: string }[];
}

// Chi tiết sản phẩm SCR-03 (API-28)
export interface IProductDetail extends IProduct {
  sku: string;
  shortDescription: string;
  description: string;
  sizeChart: ISizeChart | null;
  brand: string;
  images: string[];
  optionGroups: IOptionGroup[];
  variants: IVariant[];
  personalization: { allowed: boolean; types?: PersonalizationType[]; engrave?: Record<string, unknown> };
  specs: { material?: string; size?: string; weight?: string; origin?: string; care?: string };
  warrantyMonths: number;
  ageMin: number | null;
  ageMax: number | null;
  category: { _id: string; name: string; slug: string } | null;
  tags: { _id: string; name: string; slug: string; group: string }[];
  stickerSets: IStickerSet[];
  related: IProduct[];
}

// Danh sách phân trang (07 Mục 1.2)
export interface IPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface IReview {
  _id: string;
  userName: string;
  rating: number;
  comment?: string;
  images?: string[];
  variantName?: string;
  // Điểm thích; tên đã che ở server khi khách chọn "Ẩn tên"
  likes?: { code: string; label: string }[];
  createdAt: string;
  // Trả lời của Soulprint (UC-OPS-08 1b)
  reply?: { text: string; at: string } | null;
}

export interface IReviewPage extends IPage<IReview> {
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
  ratingAvg: number;
  ratingCount: number;
}

export interface ISuggestion {
  type: 'product' | 'category' | 'history';
  label: string;
  slug: string;
  image?: string | null;
}

export const AXIS_INFO: Record<Axis, { slug: string; name: string; icon: string; css: string }> = {
  THE_THAO: { slug: 'the-thao', name: 'Thể thao', icon: 'ball', css: 'sport' },
  ANIME: { slug: 'anime', name: 'Anime', icon: 'shuriken', css: 'anime' },
  GAME: { slug: 'game', name: 'Game', icon: 'gamepad', css: 'game' },
};
