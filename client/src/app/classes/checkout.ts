// Đặt hàng, voucher, thanh toán online phía khách (07_API_Spec.md API-13, API-36 đến API-40, API-43, API-191 - S5, S6).
import { IGiftWrapView, IPersonalization } from './cart';

export type RecipientType = 'SELF' | 'OTHER';
export type VoucherType = 'PERCENT' | 'FIXED' | 'FREESHIP';
export type VoucherKind = 'DISCOUNT' | 'FREESHIP';

// Lựa chọn thanh toán (02 Mục 3.3): COD toàn bộ, cọc online + COD phần còn lại, online 100%
export interface IPaymentOption {
  key: 'COD' | 'DEPOSIT_COD' | 'ONLINE';
  paymentChoice: 'COD' | 'ONLINE';
  remainingMethod: 'COD' | null;
  amountDueNow: number;
}

export interface IAppliedVoucher {
  code: string;
  name: string;
  type: VoucherType;
  kind: VoucherKind;
  value: number;
  discount: number;
  replaces?: string | null;
}

export interface IQuoteItem {
  _id: string;
  productId: string;
  slug: string | null;
  name: string;
  image: string | null;
  variantName: string;
  quantity: number;
  personalization: IPersonalization | null;
  unitPrice: number;
  originalUnitPrice: number | null;
  personalizationFeePerUnit: number;
  lineValue: number;
  isPersonalized: boolean;
}

export interface IQuote {
  items: IQuoteItem[];
  giftWrap: IGiftWrapView | null;
  recipientType: RecipientType;
  subtotal: number;
  personalizationFee: number;
  giftWrapFee: number;
  shippingFee: number;
  discount: number;
  total: number;
  hasPersonalized: boolean;
  depositAmount: number;
  remainingAmount: number;
  vouchers: IAppliedVoucher[];
  voucherErrors: { code: string; message: string; hint: string | null; loginHint: boolean }[];
  paymentOptions: IPaymentOption[];
  allowedMethods: string[];
  amountDueNow: number | null;
  canSendToOther: boolean;
  delivery: IDeliveryRange;
}

// Ngày giao sớm nhất: ngày đặt + 1 nếu đặt từ 12:00 + 3 nếu có cá nhân hóa + vận chuyển (TP.HCM 2, tỉnh khác 4)
export interface IDeliveryRange {
  min: string;
  max: string;
  urgentMin: string; // Đặt gấp chọn được từ ngày này (ngày mai)
  urgentMax?: string; // tới ngày này (trước ngày giao thường sớm nhất), server tính
  slots: string[];
  earliest: { date: string; afterCutoff: boolean; personalizationDays: number; shippingDays: number; inHcm: boolean; knownProvince: boolean };
}

// Thẻ voucher trong kho ưu đãi (API-36 không gửi mã) và "Ưu đãi của tôi" (API-13)
export interface IWalletVoucher {
  code: string;
  name: string;
  description: string;
  type: VoucherType;
  kind: VoucherKind;
  value: number;
  maxDiscount: number | null;
  minOrderValue: number;
  startAt: string | null;
  endAt: string | null;
  expiresAt: string | null;
  eligible?: boolean;
  reason?: string | null;
  discount?: number;
  status?: 'CO_THE_DUNG' | 'CHUA_DEN_HAN' | 'DA_DUNG' | 'HET_HAN';
  daysLeft?: number | null;
  usesLeft?: number | null; // Số lượt còn, > 1 khi được cấp lại voucher xin lỗi
  lastOrderCode?: string | null;
}

export type VoucherTab = 'CO_THE_DUNG' | 'SAP_HET_HAN' | 'DA_DUNG_HET_HAN';
export interface IMyVouchers {
  counts: Record<VoucherTab, number>;
  items: IWalletVoucher[];
}

export interface IShippingAddress {
  recipientName: string;
  phone: string;
  province: string;
  ward: string;
  street: string;
  sourceAddressId?: string | null;
}

export interface IOrderRequest {
  contact?: { fullName: string; phone: string; email?: string };
  recipientType: RecipientType;
  shippingAddress: IShippingAddress;
  setAsDefault?: boolean;
  deliveryDate?: string;
  deliveryWindow?: string;
  noteForShop?: string;
  noteForShipper?: string;
  voucherCodes: string[];
  acceptPolicy: boolean;
  paymentChoice: 'COD' | 'ONLINE';
  remainingMethod?: 'COD' | null;
  expectedTotal?: number;
}

export type IActivation = { needed: boolean; devLink?: string | null; created?: boolean; hasAccount?: boolean } | null;

// API-38: đơn COD trả orderCode; đơn cần trả online trả giao dịch để chuyển tới cổng (SCR-08)
export interface IOrderCreated {
  orderCode?: string;
  total?: number;
  activation?: IActivation;
  paymentId?: string;
  paymentUrl?: string;
}

// Giao dịch thanh toán online (API-39) cho SCR-08 và trang thất bại SCR-09 (S6)
export type PaymentStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'REFUNDED';
export interface IPaymentView {
  _id: string;
  code: string;
  amount: number;
  purpose: 'ORDER' | 'REDELIVERY' | 'ORDER_CHANGE';
  status: PaymentStatus;
  expired: boolean;
  expiresAt: string;
  serverTime: string;
  failReason: 'THAT_BAI' | 'KHACH_HUY' | 'HET_HAN' | string | null;
  failMessage: string | null;
  orderCode: string | null;
  description: string;
  payerName: string | null;
  total: number | null;
  remainingAmount: number;
  itemCount: number;
  checkout: Partial<IOrderRequest> | null;
  draftCode?: string | null;
  // ORDER_CHANGE: liên kết nhân viên gửi, còn thử lại được khi thay đổi vẫn đang chờ
  linkShared?: boolean;
  canRetry?: boolean;
  // Liên kết đơn nháp: hạn liên kết đã gửi khách, Thử lại trong hạn này
  linkExpiresAt?: string | null;
}

// API-40 kết quả mô phỏng; API-191 giao dịch mới
export interface IPaymentResult {
  status: PaymentStatus;
  orderCode?: string;
  failReason?: string;
  failMessage?: string;
  activation?: IActivation;
  redirectUrl: string;
}
export interface IPaymentCreated {
  paymentId: string;
  paymentUrl: string;
  code: string;
  amount: number;
}

// Đơn hàng cho SCR-09 (API-43, phần tóm tắt)
export interface IOrderSummary {
  code: string;
  createdAt: string;
  customer: { fullName: string; phone: string; email?: string };
  items: { name: string; variantName: string; image: string | null; quantity: number; unitPrice: number; lineValue: number; personalization: any; isPersonalized: boolean }[];
  giftWrap: { name: string } | null;
  recipientType: RecipientType;
  shippingAddress: IShippingAddress & { deliveryDate?: string; deliveryWindow?: string; noteForShipper: string };
  noteForShop: string;
  subtotal: number;
  personalizationFee: number;
  shippingFee: number;
  discount: number;
  vouchers: { code: string; type: VoucherType; value: number; discount: number }[];
  total: number;
  depositAmount: number;
  remainingAmount: number;
  paidAmount: number;
  paymentMethod: 'COD' | 'ONLINE';
  orderStatus: string;
  paymentStatus: string;
  accountPending: boolean;
  expectedDeliveryDate?: string | null; // Ngày giao dự kiến server tính lúc đặt
  urgentFee?: number;
}

// Lựa chọn thanh toán khách đã chọn, đọc lại từ thông tin đã lưu của giao dịch (SCR-07 điền sẵn)
export function optionKeyOf(c: Pick<IOrderRequest, 'paymentChoice' | 'remainingMethod'>): IPaymentOption['key'] {
  if (c.paymentChoice === 'COD') return 'COD';
  return c.remainingMethod === 'COD' ? 'DEPOSIT_COD' : 'ONLINE';
}

// Đồng hồ đếm ngược phiên thanh toán SCR-08: mm:ss, số âm hiện 00:00
// Đồng hồ đếm ngược: từ 1 giờ trở lên HH:MM:SS, dưới 1 giờ MM:SS
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const pad = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  return h > 0 ? `${pad(h)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

// Nhãn ưu đãi ngắn trên thẻ voucher: "-10%", "-50K", "0đ Phí ship" (SCR-20)
export function voucherBadge(v: { type: VoucherType; value: number }): string {
  if (v.type === 'PERCENT') return `-${v.value}%`;
  if (v.type === 'FREESHIP') return '0đ';
  return v.value % 1000 === 0 ? `-${v.value / 1000}K` : `-${v.value}đ`;
}

// ===== Quản trị voucher (API-82 đến API-87, API-165, API-166, API-190 - UC-CAT-02) =====
export type VoucherDisplayStatus = 'BAN_NHAP' | 'DA_LEN_LICH' | 'DANG_HOAT_DONG' | 'TAM_NGUNG' | 'HET_HAN' | 'HET_LUOT' | 'LUU_TRU';
export const VOUCHER_STATUS_LABEL: Record<VoucherDisplayStatus, string> = {
  DANG_HOAT_DONG: 'Đang hoạt động',
  DA_LEN_LICH: 'Đã lên lịch',
  TAM_NGUNG: 'Tạm ngừng',
  HET_HAN: 'Hết hạn',
  HET_LUOT: 'Hết lượt',
  BAN_NHAP: 'Bản nháp',
  LUU_TRU: 'Đã lưu trữ',
};
export type VoucherAudience = 'PUBLIC' | 'ALL_MEMBERS' | 'NEW_MEMBERS' | 'SELECTED';

export interface IAdminVoucher {
  _id?: string;
  code: string;
  name: string;
  description: string;
  type: VoucherType;
  value: number | null;
  maxDiscount: number | null;
  minOrderValue: number;
  minItems: number;
  scope: { kind: 'ALL' | 'CATEGORY' | 'PRODUCT'; ids: string[]; excludeProductIds: string[] };
  audience: VoucherAudience;
  selectedUserIds: string[];
  source?: string;
  totalQuantity: number | null;
  perUserLimit: number | null;
  maxBudget: number | null;
  startAt: string | null;
  endAt: string | null;
  validDays: number | null;
  showInWallet: boolean;
  autoOnSignup: boolean;
  status?: 'BAN_NHAP' | 'HOAT_DONG' | 'TAM_NGUNG' | 'LUU_TRU';
  displayStatus?: VoucherDisplayStatus;
  usedCount?: number;
  discountGiven?: number;
  selectedCount?: number;
  createdAt?: string;
  // Chỉ có ở API-83
  scopeItems?: { _id: string; name: string; sku?: string }[];
  excludedProducts?: { _id: string; name: string; sku?: string }[];
  selectedUsers?: ICustomerBrief[];
  createdByName?: string | null;
  fullyEditable?: boolean;
  stats?: { used: number; totalQuantity: number | null; revenue: number; discountTotal: number; granted: number; useRate: number | null; daily: { date: string; count: number }[] };
}

export interface ICustomerBrief {
  _id: string;
  fullName: string;
  phone: string;
  email?: string | null;
}

// Mã QR minh họa của cổng giả lập: lưới 25×25 sinh từ mã giao dịch, có 3 ô định vị ở góc như QR thật (không quét được).
// Dùng ở SCR-08 và khối gửi liên kết thanh toán cho khách (đơn nháp, đổi sản phẩm).
export function demoQrCells(code: string): { x: number; y: number }[] {
  let h = 2166136261;
  const next = () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return (h >>> 0) % 100;
  };
  for (const ch of code) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const n = 25;
  const finder = (x: number, y: number) => {
    for (const [fx, fy] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
      const dx = x - fx;
      const dy = y - fy;
      if (dx >= 0 && dx < 7 && dy >= 0 && dy < 7) {
        return dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4) ? 1 : 0;
      }
      if (dx >= -1 && dx <= 7 && dy >= -1 && dy <= 7) return 0;
    }
    return -1;
  };
  const cells: { x: number; y: number }[] = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const f = finder(x, y);
      if (f === 1 || (f === -1 && next() < 48)) cells.push({ x, y });
    }
  }
  return cells;
}
