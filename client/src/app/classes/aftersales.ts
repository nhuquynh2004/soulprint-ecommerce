// Hậu mãi phía khách và quản trị (S9): đổi trả (UC-TRK-04), bảo hành (UC-TRK-05), đánh giá (UC-TRK-03),
// yêu cầu hậu mãi (UC-OPS-07). Nhãn trùng với server (afterSalesRules.js); nút được phép lấy từ `actions` của server.
import { IShippingAddress } from './checkout';

export type ReturnReason = 'LOI_IN_KHAC' | 'HU_HONG' | 'GIAO_SAI' | 'KHONG_DUNG_MO_TA' | 'DOI_Y';

// 5 lý do của SCR-25; photo: bắt buộc ảnh (BR-31); soulprintFault: lỗi từ Soulprint, món cá nhân hóa được chọn (BR-14)
export const RETURN_REASONS: { key: ReturnReason; label: string; photo: boolean; soulprintFault: boolean }[] = [
  { key: 'LOI_IN_KHAC', label: 'Lỗi in/khắc (sai chữ, mờ, lệch)', photo: true, soulprintFault: true },
  { key: 'HU_HONG', label: 'Hư hỏng, bể vỡ khi nhận', photo: true, soulprintFault: true },
  { key: 'GIAO_SAI', label: 'Giao sai sản phẩm, sai size', photo: false, soulprintFault: true },
  { key: 'KHONG_DUNG_MO_TA', label: 'Không đúng mô tả', photo: false, soulprintFault: true },
  { key: 'DOI_Y', label: 'Đổi ý, không còn nhu cầu', photo: false, soulprintFault: false },
];

export const RESOLUTIONS: { key: 'GIAO_LAI' | 'HOAN_TIEN'; label: string; hint: string }[] = [
  { key: 'GIAO_LAI', label: 'Giao hàng lại', hint: 'Soulprint làm lại hoặc đổi sản phẩm đúng như đơn đã đặt rồi giao lại cho bạn' },
  { key: 'HOAN_TIEN', label: 'Trả hàng, hoàn tiền', hint: 'Hoàn tiền vào tài khoản ngân hàng sau khi Soulprint nhận lại hàng' },
];

export const WARRANTY_SYMPTOMS: { key: string; label: string }[] = [
  { key: 'KHONG_HOAT_DONG', label: 'Không hoạt động' },
  { key: 'CHAP_CHON', label: 'Hoạt động chập chờn' },
  { key: 'HONG_MOT_PHAN', label: 'Hỏng một phần' },
  { key: 'BONG_MO_IN_KHAC', label: 'Lớp in/khắc bong, mờ' },
  { key: 'KHAC', label: 'Khác' },
];

export const RATING_LABELS: Record<number, string> = { 1: 'Rất tệ', 2: 'Chưa hài lòng', 3: 'Bình thường', 4: 'Hài lòng', 5: 'Rất hài lòng' };

export const REVIEW_LIKES: { key: string; label: string }[] = [
  { key: 'CA_NHAN_HOA_DEP', label: 'Cá nhân hóa đẹp' },
  { key: 'DONG_GOI_DEP', label: 'Đóng gói đẹp' },
  { key: 'GIAO_NHANH', label: 'Giao nhanh' },
  { key: 'DUNG_MO_TA', label: 'Đúng mô tả' },
  { key: 'DANG_TIEN', label: 'Đáng tiền' },
];

// Giới hạn chữ của mô tả, nhận xét (AFTERSALES_TEXT_MAX), lý do từ chối (BR-16)
export const TEXT_MAX = 500;
export const REASON_MIN = 10;

export interface IProgressStep {
  label: string;
  at: string | null;
  state: 'done' | 'current' | 'todo';
}

export interface IReject {
  reasonCode: string;
  reasonLabel: string;
  detail: string;
  evidence: string[];
  allowResubmit?: boolean;
  at: string;
}

export interface IReturnRequest {
  kind: 'RETURN';
  _id: string;
  code: string;
  orderCode: string;
  status: 'DANG_YEU_CAU' | 'DONG_Y' | 'DA_NHAN_HANG' | 'TU_CHOI' | 'DA_HOAN_TAT' | 'DA_HUY';
  statusLabel: string;
  resolution: 'GIAO_LAI' | 'HOAN_TIEN';
  resolutionLabel: string;
  items: {
    orderItemId: string; name: string; variantName: string | null; image: string | null; isPersonalized: boolean; personalizationText: string | null;
    quantity: number; unitPrice: number; lineValue: number; reason: ReturnReason; reasonLabel: string; reasonShort: string;
  }[];
  value: number;
  description: string;
  images: string[];
  conditionConfirmed: boolean;
  pickupAddress: IShippingAddress | null;
  bankInfo: { bankName: string; accountName: string; account?: string; accountNumber?: string } | null;
  returnInstruction: string | null;
  returnAddress: string | null;
  returnCarrier: string | null;
  returnCarrierLabel: string | null;
  returnTrackingCode: string | null;
  reject: IReject | null;
  refundWithoutReturn: boolean;
  refundWithoutReturnReason?: string | null;
  refundAmount: number | null;
  replacementOrderCode: string | null;
  slaDeadline: string;
  createdAt: string;
  decidedAt: string | null;
  receivedAt: string | null;
  completedAt: string | null;
  progress: IProgressStep[];
  canCancel: boolean;
}

export interface IWarrantyRequest {
  kind: 'WARRANTY';
  _id: string;
  code: string;
  orderCode: string;
  status: 'DANG_XEM_XET' | 'DA_DUYET' | 'DA_NHAN_HANG' | 'TU_CHOI' | 'HOAN_TAT';
  statusLabel: string;
  item: { orderItemId: string; name: string; variantName: string | null; image: string | null; quantity: number; personalizationText: string | null };
  symptom: string;
  symptomLabel: string;
  description: string;
  images: string[];
  shippingMethod: 'SHIPPER_LAY' | 'TU_GUI';
  shippingMethodLabel: string;
  pickupAddress: IShippingAddress | null;
  returnAddress: string | null;
  warrantyUntil: string;
  resolution: 'SUA_CHUA' | 'DOI_MOI' | null;
  resolutionLabel: string | null;
  returnInstruction: string | null;
  returnCarrier: string | null;
  returnCarrierLabel: string | null;
  returnTrackingCode: string | null;
  progressNotes: { at: string; text: string }[];
  reject: IReject | null;
  replacementOrderCode: string | null;
  slaDeadline: string;
  createdAt: string;
  decidedAt: string | null;
  receivedAt: string | null;
  completedAt: string | null;
  progress: IProgressStep[];
}

export type IAfterSalesRequest = IReturnRequest | IWarrantyRequest;

export interface IReview {
  _id: string;
  orderItemId: string;
  rating: number;
  ratingLabel: string;
  likes: string[];
  comment: string;
  images: string[];
  hideName: boolean;
  isHidden: boolean;
  createdAt: string;
  editableUntil: string;
  editable: boolean;
}

export interface IItemWarranty {
  months: number;
  until: string | null;
  expired: boolean;
  open: boolean;
  allowed: boolean;
  count: number;
}

// Tài khoản nhận tiền hoàn gửi kèm: tài khoản đã lưu hoặc nhập mới
export type RefundAccountValue = { useSavedAccount: true } | { refundAccount: { bankName: string; accountNumber: string; accountName: string }; saveAccount: boolean };

// Địa chỉ lấy hàng / giao lại: từ sổ địa chỉ hoặc nhập mới
export type AddressValue = { addressId: string; preview: IShippingAddress } | { address: IShippingAddress };

// ===== Quản trị (SCR-50) =====

export type RequestKind = 'RETURN' | 'WARRANTY' | 'REFUND';
export type RequestStage = 'cho-duyet' | 'cho-hoan-tien' | 'dang-gui-ve' | 'da-nhan' | 'hoan-tat' | 'tu-choi';

export const REQUEST_STAGES: { key: RequestStage | ''; label: string }[] = [
  { key: '', label: 'Tất cả' },
  { key: 'cho-duyet', label: 'Chờ duyệt' },
  { key: 'cho-hoan-tien', label: 'Chờ hoàn tiền' },
  { key: 'dang-gui-ve', label: 'Đang gửi hàng về' },
  { key: 'da-nhan', label: 'Đã nhận và kiểm tra' },
  { key: 'hoan-tat', label: 'Hoàn tất' },
  { key: 'tu-choi', label: 'Từ chối' },
];

export const REQUEST_TYPES: { key: RequestKind | ''; label: string }[] = [
  { key: '', label: 'Mọi loại yêu cầu' },
  { key: 'RETURN', label: 'Đổi trả' },
  { key: 'WARRANTY', label: 'Bảo hành' },
  { key: 'REFUND', label: 'Hoàn tiền' },
];

// Đường dẫn API-196 theo loại
export const KIND_PATH: Record<RequestKind, 'returns' | 'warranty' | 'refunds'> = { RETURN: 'returns', WARRANTY: 'warranty', REFUND: 'refunds' };

export interface IRequestActions {
  approve?: boolean;
  reject?: boolean;
  refundNow?: boolean;
  received?: boolean;
  complete?: boolean;
  progressNote?: boolean;
  markPaid?: boolean;
  gatewayRefund?: boolean;
  markFailed?: boolean;
  waitingAccount?: boolean;
}

export interface IRequestRow {
  kind: RequestKind;
  _id: string;
  code: string;
  orderCode: string;
  customerName: string;
  customerPhone: string;
  status: string;
  statusLabel: string;
  stage: RequestStage | null;
  priorityLevel: 'KHAN_CAP' | 'CAN_CHU_Y' | 'BINH_THUONG';
  priorityReason: string | null;
  slaRemaining: string | null;
  slaDeadline: string | null;
  waitingHours: number;
  product: { name: string; variantName: string | null; image: string | null; more: number };
  typeLabel: string;
  reasonLabel: string;
  amount: number | null;
  createdAt: string;
  actions: IRequestActions;
}

export interface IRequestList {
  items: IRequestRow[];
  counts: Record<string, number>;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// API-196: phần chung của 3 loại; các trường riêng đọc theo kind
export interface IRequestDetail {
  kind: RequestKind;
  _id: string;
  code: string;
  orderCode: string;
  status: string;
  statusLabel: string;
  priority: 'KHAN_CAP' | 'CAN_CHU_Y' | 'BINH_THUONG';
  priorityReason: string | null;
  slaRemaining: string | null;
  actions: IRequestActions;
  order: {
    code: string; createdAt: string; deliveredAt: string | null; orderStatusLabel: string; paymentStatus: string; paymentStatusLabel: string; paymentMethod: string;
    total: number; paidAmount: number; refundedAmount: number; refundable: number; customer: { fullName: string; phone: string; email?: string };
    shippingAddress: IShippingAddress; items: { _id: string; name: string; variantName: string | null; image: string | null; quantity: number; lineValue: number; isPersonalized: boolean }[];
    history: { field: string; label: string; at: string; byRole: string | null; note: string | null }[];
  };
  carriers: { value: string; label: string }[];
  rejectReasons: { value: string; label: string; hint: string }[];
  returnAddress: string | null;
  defaultInstruction?: string;
  defaultRefund?: number;
  resolutions?: { value: string; label: string }[];
  // Đổi trả, bảo hành
  items?: IReturnRequest['items'];
  item?: IWarrantyRequest['item'];
  resolution?: string | null;
  resolutionLabel?: string | null;
  description?: string;
  images?: string[];
  conditionConfirmed?: boolean;
  pickupAddress?: IShippingAddress | null;
  bankInfo?: { bankName: string; accountNumber?: string; accountName: string; account?: string } | null;
  returnInstruction?: string | null;
  returnCarrierLabel?: string | null;
  returnTrackingCode?: string | null;
  reject?: IReject | null;
  refundWithoutReturn?: boolean;
  refundWithoutReturnReason?: string | null;
  refundAmount?: number | null;
  replacementOrderCode?: string | null;
  symptomLabel?: string;
  shippingMethodLabel?: string;
  warrantyUntil?: string;
  progressNotes?: { at: string; text: string }[];
  value?: number;
  createdAt: string;
  decidedAt?: string | null;
  receivedAt?: string | null;
  completedAt?: string | null;
  slaDeadline?: string | null;
  // Hoàn tiền
  reason?: string;
  reasonLabel?: string;
  amount?: number;
  method?: 'BANK_TRANSFER' | 'GATEWAY' | 'VOUCHER';
  voucherCode?: string | null; // hoàn bằng voucher
  note?: string | null;
  failReason?: string | null;
  pendingCounted?: number; // phần dư đã tính trước vào refundedAmount nhưng chưa chuyển
  processedAt?: string | null;
}

// Chữ "chờ N giờ" ở cột Ưu tiên
export function waitingText(hours: number): string {
  if (hours < 1) return 'Vừa gửi';
  if (hours < 48) return `Chờ ${hours} giờ`;
  return `Chờ ${Math.floor(hours / 24)} ngày`;
}

// Khung giờ nhận khi nhận lại hàng (DELIVERY_SLOTS - UC-PAY-02 2a, CNL-04 bước 2)
export const DELIVERY_SLOTS: { value: string; label: string }[] = [
  { value: '08:00 - 12:00', label: 'Sáng' },
  { value: '14:00 - 18:00', label: 'Chiều' },
  { value: '18:00 - 21:00', label: 'Tối' },
];
