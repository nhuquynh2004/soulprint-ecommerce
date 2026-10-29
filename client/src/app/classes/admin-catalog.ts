// Dữ liệu khu quản trị catalog và cửa hàng (S3) - khớp 06_DataModel.md và phản hồi API của 07_API_Spec.md.

export type ProductStatus = 'BAN_NHAP' | 'DANG_HIEN_THI' | 'DA_AN' | 'NGUNG_BAN';
export type StockStatus = 'CON_HANG' | 'SAP_HET' | 'HET_HANG';
export type Axis = 'THE_THAO' | 'ANIME' | 'GAME';

export const PRODUCT_STATUS_LABEL: Record<ProductStatus, string> = {
  BAN_NHAP: 'Bản nháp',
  DANG_HIEN_THI: 'Đang bán',
  DA_AN: 'Ẩn',
  NGUNG_BAN: 'Lưu trữ',
};
export const STOCK_LABEL: Record<StockStatus, string> = { CON_HANG: 'Còn hàng', SAP_HET: 'Sắp hết', HET_HANG: 'Hết hàng' };
export const AXIS_LABEL: Record<Axis, string> = { THE_THAO: 'Thể thao', ANIME: 'Anime', GAME: 'Game' };

export interface IOptionValue {
  value: string;
  code: string;
  sortOrder?: number;
  isHidden?: boolean;
  images?: string[];
}

export interface IOptionGroup {
  name: string;
  sortOrder?: number;
  hasImages: boolean;
  values: IOptionValue[];
}

export interface IVariant {
  sku: string | null;
  name: string;
  attributes: Record<string, string>;
  priceDelta: number;
  stock: number;
  lowStockThreshold: number;
  isActive: boolean;
}

export interface IAdminProductRow {
  _id: string;
  name: string;
  sku: string | null;
  slug: string | null;
  image: string | null;
  price: number | null;
  salePrice: number | null;
  status: ProductStatus;
  axis: Axis | null;
  category: string | null;
  totalStock: number;
  stockStatus: StockStatus;
  hasOrders: boolean;
  variants: { sku: string; name: string; stock: number; isActive: boolean; lowStockThreshold: number }[];
}

export interface IAdminProductList {
  items: IAdminProductRow[];
  page: number;
  pageSize: number;
  total: number;
  counts: Record<string, number>;
  stockCounts: Record<string, number>;
}

export interface IAdminProduct {
  _id?: string;
  name: string;
  sku: string | null;
  slug: string | null;
  brand: string;
  shortDescription: string;
  description: string;
  status: ProductStatus;
  categoryId: string | null;
  axis: Axis | null;
  isFeatured: boolean;
  featuredOrder: number | null;
  aiEligible: boolean;
  outOfStockBehavior: 'HIEN_TAM_HET' | 'AN_KHI_HET';
  images: string[];
  price: number | null;
  salePrice: number | null;
  costPrice?: number | null;
  saleStartAt: string | null;
  saleEndAt: string | null;
  personalization: {
    allowed: boolean;
    types: ('IN_KHAC' | 'THIET_KE')[];
    engrave?: { mode: 'THUONG' | 'AO_DAU'; maxChars?: number; topMaxChars?: number; bottomMaxChars?: number; numberMaxDigits?: number };
  };
  specs: { material: string; size: string; weight: string; origin: string; care: string };
  warrantyMonths: number;
  sizeChart: { columns: string[]; rows: string[][]; note: string } | null;
  tagIds: string[];
  ageMin: number | null;
  ageMax: number | null;
  optionGroups: IOptionGroup[];
  variants: IVariant[];
  hasOrders?: boolean;
  totalStock?: number;
  stockStatus?: StockStatus;
  updatedAt?: string;
}

// Lỗi kiểm tra kèm số vùng của form SCR-42 (UC-CAT-01 7Ea)
export interface IFieldIssue {
  field: string;
  message: string;
  area: number;
}

export interface ISaveResult<T> {
  product: T;
  warnings: string[];
}

export interface IBulkResult {
  updated: number;
  skipped: { id: string; name?: string; reason: string }[];
}

export interface IAdminCategory {
  _id: string;
  name: string;
  slug: string;
  code?: string; // mã trong SKU sản phẩm (BR-46)
  description: string;
  image: string;
  parentId: string | null;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
  children?: IAdminCategory[];
}

export interface ITagGroup {
  _id: string;
  code: string;
  name: string;
  description: string;
  kind: 'LIST' | 'RANGE';
  rangeField: 'PRICE' | 'AGE' | null;
  isFilter: boolean;
  isSystem: boolean;
  sortOrder: number;
  tagCount: number;
}

export interface IAdminTag {
  _id: string;
  name: string;
  slug: string;
  group: string;
  synonyms: string[];
  isFilter: boolean;
  description: string;
  range?: { min: number; max: number | null };
  productCount: number;
}

export interface IAiGap {
  _id: string;
  criteriaKey: string;
  sampleInput: string;
  count: number;
  lastSeenAt: string;
  status: 'MOI' | 'DA_XU_LY';
}

// API-80
export interface IAiGapList {
  items: IAiGap[];
  counts: { MOI: number; DA_XU_LY: number };
}

export type CollectionDisplayStatus = 'BAN_NHAP' | 'AN' | 'DANG_HIEN' | 'DA_LEN_LICH' | 'HET_HAN';
export const COLLECTION_STATUS_LABEL: Record<CollectionDisplayStatus, string> = {
  BAN_NHAP: 'Bản nháp',
  AN: 'Ẩn',
  DANG_HIEN: 'Đang hiện',
  DA_LEN_LICH: 'Đã lên lịch',
  HET_HAN: 'Hết hạn',
};

export interface ICollectionRule {
  field: 'CATEGORY' | 'AXIS' | 'TAG' | 'PRICE' | 'CREATED_WITHIN_DAYS' | 'IN_STOCK' | 'ON_SALE';
  operator: 'EQ' | 'NE' | 'LT' | 'GT';
  value: string | number | boolean;
}

export interface IAdminCollection {
  _id?: string;
  name: string;
  slug: string;
  description: string;
  coverImage: string | null;
  type: 'THU_CONG' | 'TU_DONG';
  code?: string | null; // mã BST trong SKU sản phẩm, chỉ BST chọn tay (BR-46)
  productIds: string[];
  rules: ICollectionRule[];
  matchMode: 'ALL' | 'ANY' | null;
  sortBy: 'THU_CONG' | 'LIEN_QUAN' | 'BAN_CHAY' | 'MOI_NHAT' | 'TEN_AZ' | 'TEN_ZA' | 'GIA_TANG' | 'GIA_GIAM'; // LIEN_QUAN, TEN_AZ, TEN_ZA
  startAt: string | null;
  endAt: string | null;
  status: 'BAN_NHAP' | 'HIEN_THI' | 'AN';
  showOnHome: boolean;
  sortOrder?: number;
  displayStatus?: CollectionDisplayStatus;
  productCount?: number;
  products?: IPickedProduct[];
}

export interface IPickedProduct {
  _id: string;
  name: string;
  sku: string | null;
  images?: string[];
  image?: string | null;
  price: number | null;
  salePrice: number | null;
  status: ProductStatus;
}

export type HomeSectionType =
  | 'banners'
  | 'categories'
  | 'axes'
  | 'recipientGroups'
  | 'featured'
  | 'collection'
  | 'productList'
  | 'featuredReviews'
  | 'richText'
  | 'video';
export interface IHomeSection {
  id: string;
  type: HomeSectionType;
  visible: boolean;
  settings: {
    title?: string;
    description?: string;
    limit?: number;
    collectionId?: string | null;
    source?: { kind: 'NEW' | 'BEST_SELLING' | 'CATEGORY' | 'AXIS' | 'TAG'; id?: string | null };
    body?: string;
    ctaLabel?: string;
    ctaLink?: string;
    showViewAll?: boolean; // nút Xem tất cả
    youtubeId?: string | null; // khối Video
    youtubeUrl?: string;
    caption?: string;
  };
}

export interface IBanner {
  _id?: string;
  title: string;
  subtitle: string;
  imageDesktop: string;
  imageMobile: string;
  ctaLabel: string;
  ctaLink: string;
  startAt: string | null;
  endAt: string | null;
  sortOrder?: number;
  isActive: boolean;
}

export interface IAdminHome {
  draft: { sections: IHomeSection[] };
  published: { sections: IHomeSection[] };
  publishedAt: string | null;
  banners: IBanner[];
  featured: IPickedProduct[];
  hasUnpublishedChanges: boolean;
}

export interface IStoreSettings {
  fees: { shippingFee: number; depositRate: number; stickerFee: number };
  payments: { onlineFull: boolean; depositCod: boolean; codFull: boolean };
  insights: { stockoutDays: number; expiryDays: number; abandonedCartDays: number };
  info: {
    storeName: string;
    hotline: string;
    email: string;
    returnAddress: string;
    workingHours: string;
    social: { facebook: string; zalo: string; instagram: string; tiktok: string };
  };
  variables: Record<string, string>;
  warnings?: string[];
}

export interface IPolicyItem {
  slug: string;
  title: string;
  sortOrder: number;
  updatedAt?: string;
}

export interface IFaq {
  _id?: string;
  question: string;
  answer: string;
  keywords: string[];
  category: 'VAN_CHUYEN' | 'THANH_TOAN' | 'DOI_TRA' | 'CA_NHAN_HOA' | 'GOI_QUA' | 'KHAC';
  isActive: boolean;
  sortOrder?: number;
  hitCount?: number;
}

export const FAQ_CATEGORY_LABEL: Record<IFaq['category'], string> = {
  VAN_CHUYEN: 'Vận chuyển',
  THANH_TOAN: 'Thanh toán',
  DOI_TRA: 'Đổi trả',
  CA_NHAN_HOA: 'Cá nhân hóa',
  GOI_QUA: 'Gói quà',
  KHAC: 'Khác',
};
