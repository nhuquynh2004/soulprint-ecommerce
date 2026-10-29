// Đơn hàng phía khách (07_API_Spec.md API-42 đến API-46, API-55 đến API-58, API-21, API-22, API-192 - S7).
// Nút hành động lấy từ `actions` server tính (UC-CNL-01 ghi chú kỹ thuật), client không tự suy luận quy tắc.
import { IPersonalization } from './cart';
import { IShippingAddress, RecipientType, VoucherType } from './checkout';
import { IAfterSalesRequest, IItemWarranty, IReturnRequest, IReview, IWarrantyRequest } from './aftersales';

export type OrderStatus = 'CHO_XAC_NHAN' | 'DANG_CA_NHAN_HOA' | 'DANG_CHUAN_BI' | 'DANG_VAN_CHUYEN' | 'DA_GIAO' | 'HOAN_THANH' | 'DA_HUY';
export type OrderTab = 'tat-ca' | 'cho-xac-nhan' | 'dang-xu-ly' | 'dang-giao' | 'da-giao' | 'da-huy' | 'doi-tra-bao-hanh';
export type OrderRange = '3m' | '6m' | '12m' | 'all';

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  CHO_XAC_NHAN: 'Chờ xác nhận',
  DANG_CA_NHAN_HOA: 'Đang cá nhân hóa',
  DANG_CHUAN_BI: 'Đang chuẩn bị',
  DANG_VAN_CHUYEN: 'Đang vận chuyển',
  DA_GIAO: 'Đã giao',
  HOAN_THANH: 'Hoàn thành',
  DA_HUY: 'Đã hủy',
};

export const ORDER_TABS: { key: OrderTab; label: string }[] = [
  { key: 'tat-ca', label: 'Tất cả' },
  { key: 'cho-xac-nhan', label: 'Chờ xác nhận' },
  { key: 'dang-xu-ly', label: 'Đang xử lý' },
  { key: 'dang-giao', label: 'Đang giao' },
  { key: 'da-giao', label: 'Đã giao' },
  { key: 'da-huy', label: 'Đã hủy' },
  { key: 'doi-tra-bao-hanh', label: 'Đổi trả và bảo hành' },
];

export const ORDER_RANGES: { key: OrderRange; label: string }[] = [
  { key: '3m', label: '3 tháng gần nhất' },
  { key: '6m', label: '6 tháng gần nhất' },
  { key: '12m', label: '12 tháng gần nhất' },
  { key: 'all', label: 'Tất cả' },
];

// Lý do hủy (UC-CNL-02 bước 2)
export const CANCEL_REASONS: { key: string; label: string }[] = [
  { key: 'DOI_NOI_DUNG', label: 'Muốn đổi nội dung cá nhân hóa' },
  { key: 'DOI_DIA_CHI', label: 'Muốn đổi địa chỉ, thời gian nhận' },
  { key: 'DAT_TRUNG', label: 'Đặt trùng đơn' },
  { key: 'CHON_QUA_KHAC', label: 'Đã chọn được món quà khác' },
  { key: 'KHAC', label: 'Lý do khác' },
];

// Ngân hàng thường dùng cho ô "Ngân hàng" (tài khoản nhận tiền hoàn)
export const BANKS = [
  'Vietcombank', 'VietinBank', 'BIDV', 'Agribank', 'Techcombank', 'MB Bank', 'ACB', 'VPBank', 'TPBank', 'Sacombank',
  'VIB', 'HDBank', 'SHB', 'OCB', 'MSB', 'SeABank', 'Eximbank', 'LPBank', 'Nam A Bank', 'Bac A Bank',
];

export interface IOrderActions {
  cancel: boolean;
  received: boolean;
  reorder: boolean;
  review: boolean;
  return: boolean;
  refund: boolean;
  redelivery: boolean;
  // Khách sửa đơn trước khi xác nhận (UC-TRK-06)
  editShipping?: boolean;
  editPersonalization?: boolean;
  // S9: có dòng còn bảo hành; nhập lại tài khoản khi chuyển khoản hoàn tiền thất bại (UC-CNL-05 5a)
  warranty?: boolean;
  refundAccount?: boolean;
}

export interface IRefundInfo {
  amount: number;
  status: 'CHO_XU_LY' | 'DA_HOAN' | 'THAT_BAI';
  method: 'BANK_TRANSFER' | 'GATEWAY' | 'VOUCHER';
  bankName: string | null;
  account: string;
  createdAt: string;
  processedAt: string | null;
  failReason?: string | null;
  needsAccount?: boolean;
  // Lý do hoàn; phần dư khi đơn đổi đang chờ chuyển khoản thì đổi sang voucher được (API-219)
  reason?: string;
  voucherCode?: string | null;
  canTakeVoucher?: boolean;
}

// API-216 preview: số liệu cho hộp xác nhận trước khi sửa làm đổi giá trị đơn
export interface IChangePreview {
  before: { total: number; paid: number; remainingAmount: number };
  after: { total: number; remainingAmount: number };
  settlement: { extra: number; surplus: number };
  valueChanged: boolean;
  editsLeft: number;
}

// Thẻ đơn SCR-18 (API-42)
export interface IOrderCard {
  code: string;
  createdAt: string;
  orderStatus: OrderStatus;
  paymentStatus: string;
  total: number;
  paidAmount: number;
  depositAmount: number;
  remainingAmount: number;
  refundedAmount: number;
  paymentMethod: 'COD' | 'ONLINE';
  hasPersonalizedItems: boolean;
  itemCount: number;
  firstItem: { name: string; variantName: string; image: string | null; quantity: number; unitPrice: number; personalizationText: string | null };
  cancelCase: 'TH1' | 'TH2' | 'TH3' | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  cancelBy: string | null;
  storageStatus: string | null;
  storageDeadline: string | null;
  returnStatus: string;
  carrier: string | null;
  trackingCode: string | null;
  refund: IRefundInfo | null;
  needAction: boolean;
  actions: IOrderActions;
  // Thẻ "Đơn gấp" giữ tới khi hoàn thành
  urgent?: boolean;
}

// Yêu cầu đặt gấp chưa thành đơn hiện chung tab Chờ xác nhận / Đã hủy
export interface IUrgentCard {
  code: string;
  status: 'CHO_XEM_XET' | 'DA_CHOT' | 'TU_CHOI' | 'KHACH_HUY';
  statusLabel: string;
  createdAt: string;
  requestedDate: string;
  deliveryDate: string;
  total: number | null;
  itemCount: number;
  firstItem: { name: string; variantName: string | null; image: string | null; quantity: number; personalizationText: string | null };
  rejectReason: string | null;
  url: string;
}

export interface IOrderList {
  tab: OrderTab;
  range: OrderRange;
  counts: Record<OrderTab, number>;
  needAction: number;
  everOrdered: boolean;
  items: IOrderCard[];
  requests?: IAfterSalesRequest[];
  urgentRequests?: IUrgentCard[];
  page: number;
  totalPages: number;
}

export interface ITimelineStep {
  status: OrderStatus;
  label: string;
  at: string | null;
  state: 'done' | 'current' | 'todo' | 'cancelled';
  expected: { from: string; to: string } | null;
}

// Chi tiết đơn SCR-19, SCR-24 (API-43)
export interface IOrderDetail {
  code: string;
  createdAt: string;
  urgent?: boolean;
  customer: { fullName: string; phone: string; email?: string };
  items: {
    _id: string; name: string; variantName: string; image: string | null; slug: string | null; quantity: number; unitPrice: number; lineValue: number;
    personalization: IPersonalization | any; personalizationText: string | null; personalizationFeePerUnit: number; isPersonalized: boolean; fulfillStatus: string;
    substitute?: { name: string; variantName: string; image: string | null; unitPrice: number } | null; canEditPersonalization?: boolean; canAddPersonalization?: boolean;
    reviewed?: boolean; review?: IReview | null; warranty?: IItemWarranty | null;
  }[];
  giftWrap: { name: string; message?: string } | null;
  recipientType: RecipientType;
  shippingAddress: IShippingAddress & { deliveryDate?: string; deliveryWindow?: string; noteForShipper?: string };
  noteForShop: string;
  subtotal: number;
  personalizationFee: number;
  giftWrapFee: number;
  shippingFee: number;
  discount: number;
  vouchers: { code: string; type: VoucherType; value: number; discount: number }[];
  total: number;
  depositAmount: number;
  remainingAmount: number;
  paidAmount: number;
  codPaid?: number; // phần đã thu COD khi giao, phần còn lại của paidAmount là tiền online
  urgentFee?: number;
  urgentCode?: string | null;
  refundedAmount: number;
  paymentMethod: 'COD' | 'ONLINE';
  remainingMethod: 'COD' | null;
  orderStatus: OrderStatus;
  paymentStatus: string;
  returnStatus: string;
  carrier: string | null;
  trackingCode: string | null;
  deliveredAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  cancelDetail: string | null;
  cancelBy: string | null;
  // Hủy ngoại lệ: nguyên nhân Do khách (KHACH) hay Do Soulprint (SOULPRINT)
  cancelCause?: 'KHACH' | 'SOULPRINT' | null;
  cancelCase: 'TH1' | 'TH2' | 'TH3' | null;
  storageStatus: string | null;
  storageDeadline: string | null;
  refund: IRefundInfo | null;
  timeline: ITimelineStep[];
  history: { field: string; label: string; at: string; byRole: string | null; note: string | null }[];
  actions: IOrderActions | null;
  needAction: boolean;
  version?: string; // so với API-229 để tự tải lại
  accountPending: boolean;
  cancelRefundAmount: number | null;
  refundAccount: { bankName: string; accountName: string; account: string } | null;
  expectedDeliveryDate?: string | null;
  // Soulprint đang hỏi khách vì có món không thực hiện được; thay đổi chờ khách trả thêm; khoảng ngày giao khi sửa
  asking?: { message: string; responseDeadline: string | null; itemNames: string[] } | null;
  pendingChange?: { amount: number; summary: string; expiresAt: string; paymentId: string; paymentUrl: string } | null;
  // Lượt khách tự sửa làm đổi tổng còn lại (BR-47)
  valueEditsLeft?: number;
  editDelivery?: { hcm: { min: string; max: string }; other: { min: string; max: string }; slots: string[] } | null;
  // Hậu mãi (S9)
  returns?: IReturnRequest[];
  warranties?: IWarrantyRequest[];
  returnDeadline?: string | null;
  returnDaysLeft?: number;
  sourceOrderCode?: string | null;
  replacementFor?: { kind: 'DOI_TRA' | 'BAO_HANH'; requestCode: string } | null;
  redeliveryCount?: number;
  redelivery?: { shippingFee: number; remaining: number; total: number } | null;
}

export interface ICancelRequest {
  reason: string;
  detail?: string;
  refundAccount?: { bankName: string; accountNumber: string; accountName: string };
  useSavedAccount?: boolean;
  saveAccount?: boolean;
}

// Tra cứu đơn (API-55 đến API-57)
export interface ILookupSent {
  maskedPhone: string;
  expiresIn: number;
  resendAfter: number;
  devCode?: string;
}
export interface ILookupList {
  maskedPhone: string;
  accountStatus: string | null;
  items: { code: string; createdAt: string; total: number; orderStatus: OrderStatus; paymentStatus: string; itemCount: number; firstItem: { name: string; image: string | null } }[];
}

// Thông báo (API-21)
export type NoticeGroup = 'don-hang' | 'uu-dai' | 'he-thong';
export interface INotice {
  _id: string;
  type: string;
  group: NoticeGroup;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}
export interface INoticeList {
  items: INotice[];
  // Hộp thông báo nổi bật chưa xem (VD voucher xin lỗi)
  highlight?: { _id: string; kind: string; title: string; body: string; link: string | null } | null;
  unreadCount: number;
  counts: Record<NoticeGroup, number>;
  page: number;
  totalPages: number;
}

// Ngày dd/MM theo giờ máy (trình duyệt ở Việt Nam - GMT+7)
const dm = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;

// Ngày dự kiến của mốc chưa tới: "Dự kiến 17/10" hoặc "Dự kiến 19 - 20/10"
export function expectedLabel(e: { from: string; to: string } | null): string {
  if (!e) return '';
  const from = new Date(e.from + 'T00:00:00');
  const to = new Date(e.to + 'T00:00:00');
  if (e.from === e.to) return `Dự kiến ${dm(from)}`;
  return from.getMonth() === to.getMonth() ? `Dự kiến ${from.getDate()} - ${dm(to)}` : `Dự kiến ${dm(from)} - ${dm(to)}`;
}

// Nhóm thông báo theo ngày: Hôm nay / Tuần này / Trước đó (SCR-23)
export function noticeBucket(createdAt: string, now = new Date()): 'Hôm nay' | 'Tuần này' | 'Trước đó' {
  const d = new Date(createdAt);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (d >= start) return 'Hôm nay';
  if (start.getTime() - d.getTime() < 6 * 86400000) return 'Tuần này';
  return 'Trước đó';
}
