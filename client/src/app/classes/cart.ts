// Giỏ hàng, cá nhân hóa, gói quà, thiết kế đã lưu, yêu thích (07_API_Spec.md Mục 2.2, 2.3, 2.5 - S4).
import { IProduct, IStickerSet, PersonalizationType } from './product';

// Nội dung cá nhân hóa của 1 dòng giỏ (06 Mục 3.1)
export interface IEngraveNormal {
  type: 'IN_KHAC';
  mode: 'THUONG';
  text: string;
}
export interface IEngraveJersey {
  type: 'IN_KHAC';
  mode: 'AO_DAU';
  top: string;
  number: string;
  bottom: string;
}
export interface IDesignContent {
  type: 'THIET_KE';
  stickers: string[];
  // Lời nhắn in trên sản phẩm chỉ còn ở dữ liệu cũ (bỏ ô này)
  message?: string;
  stickerDetails?: { code: string; name: string; image: string | null }[];
}
export type IPersonalization = IEngraveNormal | IEngraveJersey | IDesignContent;

// Cấu hình In/Khắc của sản phẩm (BR-18)
export interface IEngraveConfig {
  mode: 'THUONG' | 'AO_DAU';
  maxChars?: number;
  topMaxChars?: number;
  bottomMaxChars?: number;
  numberMaxDigits?: number;
}

export interface ICartWarning {
  itemId?: string;
  code: string;
  message: string;
}

export interface ICartItem {
  _id: string;
  productId: string;
  slug: string | null;
  name: string;
  image: string | null;
  variantSku: string;
  variantName: string;
  attributes: Record<string, string>;
  hasOptions: boolean;
  quantity: number;
  selected: boolean;
  personalization: IPersonalization | null;
  personalizationTypes: PersonalizationType[];
  engrave: IEngraveConfig | null;
  unitPrice: number;
  originalUnitPrice: number | null;
  personalizationFeePerUnit: number;
  lineValue: number;
  // Dòng thêm từ "Đặt lại" mà giá khác đơn cũ (UC-CNL-03 3a)
  priceChanged?: boolean;
  stock: number;
  warning: ICartWarning | null;
}

export interface IMaterialRef {
  code: string;
  name: string;
  image?: string | null;
}

export interface IGiftWrapView {
  source: 'GOI_Y' | 'CUA_TOI' | 'TAO_MOI';
  templateId: string | null;
  designId: string | null;
  name: string;
  image: string | null;
  paper: IMaterialRef;
  ribbon: IMaterialRef;
  card: IMaterialRef;
  message: string;
  selected: boolean;
  available: boolean;
}

export interface ICart {
  items: ICartItem[];
  giftWrap: IGiftWrapView | null;
  count: number;
  selectedCount: number;
  selectedQuantity: number;
  hasPersonalization: boolean;
  subtotal: number;
  personalizationFee: number;
  giftWrapFee: number;
  shippingFee: number;
  estimatedTotal: number;
  stickerFee: number;
  warnings: ICartWarning[];
  addedItemId?: string;
}

// Mẫu gói quà gợi ý và vật liệu (API-30)
export interface IGiftTemplate {
  _id: string;
  code: string | null;
  name: string;
  description: string;
  image: string | null;
  paper: IMaterialRef;
  ribbon: IMaterialRef;
  card: IMaterialRef;
  available: boolean;
}

export interface IGiftGroup {
  seasonLabel: string | null;
  badge: 'HOT' | 'MOI' | null;
  kind: 'THUONG' | 'BST_MUA';
  templates: IGiftTemplate[];
}

export interface IGiftMaterial {
  code: string;
  name: string;
  description: string;
  image: string | null;
  available: boolean;
}

export interface IGiftWraps {
  suggested: IGiftGroup[];
  materials: { GIAY_GOI: IGiftMaterial[]; RUY_BANG: IGiftMaterial[]; THIEP: IGiftMaterial[] };
}

// Yêu cầu chọn gói quà gửi API-35
export type GiftWrapRequest =
  | { source: 'GOI_Y'; templateId: string; message?: string }
  | { source: 'CUA_TOI'; designId: string; message?: string }
  | { source: 'TAO_MOI'; name?: string; custom: { paper: string; ribbon: string; card: string; message: string } };

// Thiết kế đã lưu (API-14)
export interface IMaterialStatus extends IMaterialRef {
  available: boolean;
}

export interface ISavedDesign {
  _id: string;
  kind: 'GOI_QUA' | 'CA_NHAN_HOA';
  name: string;
  createdAt: string;
  updatedAt: string;
  // GOI_QUA
  paper?: IMaterialStatus;
  ribbon?: IMaterialStatus;
  card?: IMaterialStatus;
  message?: string;
  available?: boolean;
  // CA_NHAN_HOA
  productId?: string;
  personalization?: IPersonalization;
  product?: { name: string; slug: string | null; image: string | null; status: string | null; available: boolean };
  usable?: boolean;
  stickerGone?: boolean;
}

// Yêu thích (API-18)
export interface IWishItem extends IProduct {
  status: 'DANG_BAN' | 'TAM_HET' | 'NGUNG_KINH_DOANH';
  needsOptions?: boolean;
  defaultVariantSku?: string | null;
}

// Dữ liệu sản phẩm hộp thoại cá nhân hóa cần (lấy từ API-28)
export interface IPersonalizeProduct {
  _id: string;
  name: string;
  slug: string;
  image: string | null;
  axis: string;
  personalization: { allowed: boolean; types?: PersonalizationType[]; engrave?: Record<string, unknown> };
  stickerSets: IStickerSet[];
}

export const STICKER_MAX = 3; // BR-20
export const GIFT_MESSAGE_MAX = 200; // UC-CRT-04 2b

// Cấu hình In/Khắc đầy đủ, điền mặc định khi Admin bỏ trống (02 Mục 5)
export function engraveConfigOf(p: { personalization: { engrave?: Record<string, unknown> } }): IEngraveConfig {
  const e = (p.personalization.engrave || {}) as Partial<IEngraveConfig>;
  if (e.mode === 'AO_DAU') {
    return { mode: 'AO_DAU', topMaxChars: e.topMaxChars || 20, bottomMaxChars: e.bottomMaxChars || 20, numberMaxDigits: e.numberMaxDigits || 3 };
  }
  return { mode: 'THUONG', maxChars: e.maxChars || 20 };
}

// Mô tả ngắn nội dung cá nhân hóa trên dòng giỏ: "MINH ANH 10 VO DICH", "Bí ngô, Dơi, \"Chúc mừng\""
export function describePersonalization(p: IPersonalization | null | undefined): string {
  if (!p) return '';
  if (p.type === 'IN_KHAC') return p.mode === 'AO_DAU' ? [p.top, p.number, p.bottom].filter(Boolean).join(' ') : p.text;
  const parts: string[] = [];
  if (p.stickers.length) parts.push((p.stickerDetails?.map((s) => s.name).join(', ') || `${p.stickers.length} sticker`));
  if (p.message) parts.push(`"${p.message}"`);
  return parts.join(', ');
}

// Đếm ký tự hiển thị như server (BR-18): chuẩn hóa NFC, bỏ khoảng trắng đầu/cuối
export function charCount(value: string): number {
  return Array.from((value || '').normalize('NFC').trim()).length;
}

// Cá nhân hóa trong đơn lưu sticker dạng {code, name, image}; hộp thoại SCR-04 nhận mã sticker
export function toCartPersonalization(p: IPersonalization): IPersonalization {
  if (p.type !== 'THIET_KE') return p;
  const list = (p.stickers || []) as unknown as (string | { code: string; name: string; image: string | null })[];
  return { ...p, stickers: list.map((x) => (typeof x === 'string' ? x : x.code)), stickerDetails: list.filter((x) => typeof x !== 'string') as { code: string; name: string; image: string | null }[] };
}
