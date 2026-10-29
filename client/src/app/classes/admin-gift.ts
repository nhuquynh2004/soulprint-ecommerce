// Màn "Cá nhân hóa và gói quà" SCR-56 (UC-CAT-06, 07_API_Spec.md Mục 2.15).
export type DisplayStatus = 'DANG_HIEN' | 'DA_LEN_LICH' | 'HET_HAN' | 'AN';
export type SeasonKind = 'THUONG' | 'BST_MUA';
export type Badge = 'HOT' | 'MOI' | null;
export type MaterialKind = 'GIAY_GOI' | 'RUY_BANG' | 'THIEP';
export type StockStatus = 'CON_HANG' | 'SAP_HET' | 'HET_HANG';

export interface ISeasonFields {
  kind: SeasonKind;
  seasonLabel: string | null;
  badge: Badge;
  collectionId: string | null;
  startAt: string | null;
  endAt: string | null;
}

export interface IAdminSticker {
  code: string;
  name: string;
  image: string;
  isActive: boolean;
  sortOrder: number;
}

export interface IStickerSetAdmin extends ISeasonFields {
  _id: string;
  name: string;
  categoryIds: string[];
  axes: string[];
  stickers: IAdminSticker[];
  sortOrder: number;
  isActive: boolean;
  displayStatus: DisplayStatus;
  productCount: number;
}

export interface IMaterialRefAdmin {
  code: string;
  name: string;
}

export interface IGiftTemplateAdmin extends ISeasonFields {
  _id: string;
  code: string;
  name: string;
  description: string;
  image: string;
  paper: IMaterialRefAdmin;
  ribbon: IMaterialRefAdmin;
  card: IMaterialRefAdmin;
  sortOrder: number;
  isActive: boolean;
  displayStatus: DisplayStatus;
  outOfStock: string[];
}

export interface IMaterialAdmin {
  _id: string;
  kind: MaterialKind;
  code: string;
  name: string;
  description: string;
  unit: string;
  image: string;
  sortOrder: number;
  isActive: boolean;
  stock: number;
  lowStockThreshold: number;
  avgCost?: number; // chỉ có khi có quyền GOI_QUA.NHAP_KHO (BR-36)
  committed: number;
  stockStatus: StockStatus;
  templateCount: number;
}

export interface IStockMovement {
  _id: string;
  materialId: string;
  materialCode: string;
  type: 'NHAP' | 'DIEU_CHINH' | 'XUAT_DON' | 'HOAN_DON';
  quantity: number;
  unitCost?: number | null;
  supplier: string | null;
  receiptCode: string | null;
  receivedAt: string | null;
  note: string | null;
  reason: string | null;
  orderCode: string | null;
  stockAfter: number;
  createdAt: string;
}

export interface IMovementPage {
  items: IStockMovement[];
  page: number;
  pageSize: number;
  total: number;
  summary?: { ordersLast30Days: number };
}

export interface IBulkResult {
  updated: number;
  skipped: { id: string; name: string; reason: string }[];
}

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  DANG_HIEN: 'Đang hiện',
  DA_LEN_LICH: 'Chờ lịch',
  HET_HAN: 'Hết hạn',
  AN: 'Ẩn',
};

export const MATERIAL_KIND_LABEL: Record<MaterialKind, string> = {
  GIAY_GOI: 'Giấy gói',
  RUY_BANG: 'Ruy băng',
  THIEP: 'Thiệp',
};

export const STOCK_LABEL: Record<StockStatus, string> = {
  CON_HANG: 'Còn hàng',
  SAP_HET: 'Sắp hết',
  HET_HANG: 'Hết hàng',
};

export const ADJUST_REASONS = [
  { value: 'HONG', label: 'Hỏng' },
  { value: 'KIEM_KE', label: 'Kiểm kê' },
  { value: 'KHAC', label: 'Khác' },
];
