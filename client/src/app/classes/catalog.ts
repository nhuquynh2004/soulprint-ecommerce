// Mô hình dữ liệu catalog: danh mục, tag, trang chủ, bộ sưu tập, chính sách, cài đặt công khai
// (API-23, 24, 25, 108, 143, 146 - 07_API_Spec.md).
import { IPage, IProduct } from './product';

// API-207: BST đang mở cho menu xổ "Bộ sưu tập"
export interface IOpenCollection {
  _id: string;
  name: string;
  slug: string;
  coverImage: string | null;
  productCount: number;
}

export interface ICategory {
  _id: string;
  name: string;
  slug: string;
  description: string;
  image: string | null;
  productCount: number;
}

export interface ITag {
  _id: string;
  name: string;
  slug: string;
  range?: { min: number; max: number | null }; // tag nhóm khoảng
  isFilter?: boolean; // Tag tắt vẫn trả về để hiện tên ở dòng "Đang lọc"
}

// API-25: nhóm LIST là tag gắn tay (lọc ?tags=); nhóm RANGE là khoảng giá/tuổi, lọc bằng ?gia= hoặc ?age=
export interface ITagGroup {
  group: string;
  label: string;
  kind?: 'LIST' | 'RANGE';
  rangeField?: 'PRICE' | 'AGE' | null;
  isFilter?: boolean; // Nhóm tắt (Sở thích, Phong cách...) không hiện trên thanh lọc
  items: ITag[];
}

export interface ICollection {
  _id: string;
  name: string;
  slug: string;
  description: string;
  coverImage: string | null;
  startAt?: string | null;
  endAt?: string | null;
  total?: number;
}

export interface ICollectionPage extends IPage<IProduct> {
  collection: ICollection;
}

export interface IBanner {
  _id: string;
  title: string;
  subtitle: string;
  imageDesktop: string;
  imageMobile: string;
  ctaLabel: string;
  ctaLink: string;
}

export interface IHomeAxis {
  code: string;
  slug: string;
  name: string;
  productCount: number;
}

export interface IHomeReview {
  _id: string;
  userName: string;
  rating: number;
  comment: string;
  createdAt: string;
  product: { name: string; slug: string };
}

// Một khối trang chủ: data phụ thuộc type (06 Mục 2.8)
export interface IHomeSection {
  id: string;
  type: 'banners' | 'categories' | 'axes' | 'recipientGroups' | 'featured' | 'collection' | 'productList' | 'featuredReviews' | 'richText' | 'video';
  settings: { title?: string; limit?: number; body?: string; ctaLabel?: string; ctaLink?: string; tone?: string; showViewAll?: boolean; youtubeId?: string; caption?: string };
  data: { items: any[]; collection?: ICollection };
}

export interface IStoreSettings {
  shippingFee: number;
  depositRate: number;
  stickerFee: number;
  store: { storeName: string; hotline: string; email: string; workingHours: string; social: Record<string, string> };
}

export interface IPolicy {
  slug: string;
  title: string;
  content: string;
  updatedAt?: string;
}

// 6 trang chính sách (SCR-30), dùng cho mục lục và footer
export const POLICIES: { slug: string; title: string }[] = [
  { slug: 'doi-tra', title: 'Đổi trả và hoàn tiền' },
  { slug: 'bao-hanh', title: 'Bảo hành' },
  { slug: 'thanh-toan', title: 'Thanh toán và đặt cọc' },
  { slug: 'van-chuyen', title: 'Vận chuyển' },
  { slug: 'bao-mat', title: 'Bảo mật' },
  { slug: 'dieu-khoan', title: 'Điều khoản sử dụng' },
];

// Biểu tượng cho 6 danh mục nhu cầu (bộ biểu tượng của thiết kế)
export const CATEGORY_ICONS: Record<string, string> = {
  'tram-bu-nuoc': 'bottle',
  'khong-gian-chill': 'sofa',
  'vat-bat-ly-than': 'bag',
  'me-man': 'medal',
  'diem-nhan-ca-nhan': 'shirt',
  giftbox: 'gift',
};
