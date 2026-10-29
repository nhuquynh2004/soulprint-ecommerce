// Vận hành đơn phía quản trị (07_API_Spec.md API-90 đến API-96, API-103, API-158 đến API-160, API-194), đơn nháp
// (API-97, API-152 đến API-157, API-193), khách hàng và đánh giá (API-98, API-138 đến API-142) - S8.
import { IGiftWrapView, IPersonalization } from './cart';
import { IShippingAddress } from './checkout';
import { OrderStatus, ITimelineStep } from './order';

export type Priority = 'KHAN_CAP' | 'CAN_CHU_Y' | 'BINH_THUONG';
export type OrderView = 'all' | 'urgent' | 'attention' | 'approval' | 'to-confirm' | 'personalizing' | 'to-pack' | 'shipping' | 'delivered' | 'cancelled' | 'storage';

export const PRIORITY_LABEL: Record<Priority, string> = { KHAN_CAP: 'Khẩn cấp', CAN_CHU_Y: 'Cần chú ý', BINH_THUONG: 'Bình thường' };

// Tab SCR-47: 2 tab theo mức ưu tiên BR-32 rồi các tab theo đúng thứ tự quy trình xử lý đơn; hint hiện dưới thanh tab
export const ORDER_VIEWS: { key: OrderView; label: string; hint: string }[] = [
  { key: 'all', label: 'Tất cả', hint: 'Mọi đơn, xếp theo mức ưu tiên rồi tới hạn xử lý gần nhất.' },
  { key: 'urgent', label: 'Khẩn cấp', hint: 'Làm trước tiên: đơn gấp chưa giao, hoàn tiền chờ xử lý hoặc lỗi, đổi trả chờ duyệt, COD lệch tiền, sản phẩm chờ khách chọn thay thế.' },
  { key: 'attention', label: 'Cần chú ý', hint: 'Đơn trễ hạn (chờ xác nhận hoặc chờ đóng gói quá 24 giờ, cá nhân hóa quá 3 ngày), hàng lưu kho sắp hết hạn, bảo hành chờ xử lý.' },
  { key: 'approval', label: 'Chờ duyệt', hint: 'Ngoại lệ đặc biệt nhân viên gửi Quản trị duyệt (voucher bồi hoàn, hoàn tiền ngoài quy trình, hủy đơn đã cá nhân hóa, bỏ tặng voucher xin lỗi). Mở đơn để Duyệt hoặc Từ chối.' },
  { key: 'to-confirm', label: 'Chờ xác nhận', hint: 'Đơn mới: kiểm tra thanh toán, tồn kho, nội dung in/khắc, địa chỉ rồi bấm Xác nhận đơn. Hạn 24 giờ.' },
  { key: 'personalizing', label: 'Đang cá nhân hóa', hint: 'Đã xác nhận, đang in/khắc hoặc làm thiết kế. Hạn 3 ngày, làm xong bấm Hoàn tất cá nhân hóa.' },
  { key: 'to-pack', label: 'Chờ đóng gói', hint: 'In phiếu đóng gói, lấy hàng và mẫu gói quà theo phiếu, rồi Giao cho vận chuyển. Hạn 24 giờ.' },
  { key: 'shipping', label: 'Đang giao', hint: 'Đã có mã vận đơn. Cập nhật Giao thành công (nhập số COD đã thu) hoặc Khách từ chối nhận.' },
  { key: 'delivered', label: 'Đã giao', hint: 'Đã giao tới khách và đơn đã hoàn thành.' },
  { key: 'cancelled', label: 'Đã hủy', hint: 'Đơn đã hủy. Khoản hoàn tiền (nếu có) xử lý ở Yêu cầu hậu mãi, tab Chờ hoàn tiền.' },
];

export const CARRIERS: { key: string; label: string }[] = [
  { key: 'GHN', label: 'GHN' },
  { key: 'GHTK', label: 'GHTK' },
  { key: 'SPX', label: 'SPX' },
  { key: 'VIETTEL_POST', label: 'Viettel Post' },
  { key: 'KHAC', label: 'Khác' },
];

export const SOURCES: { key: string; label: string }[] = [
  { key: 'WEBSITE', label: 'Website' },
  { key: 'DIEN_THOAI', label: 'Điện thoại' },
  { key: 'ZALO', label: 'Zalo' },
  { key: 'FACEBOOK', label: 'Facebook' },
  { key: 'EMAIL', label: 'Email' },
  { key: 'KHAC', label: 'Khác' },
];

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  CHUA_THANH_TOAN: 'Chưa thanh toán',
  DA_COC: 'Đã cọc',
  DA_THANH_TOAN: 'Đã thanh toán',
  HOAN_TIEN_MOT_PHAN: 'Hoàn một phần',
  DA_HOAN_TIEN: 'Đã hoàn tiền',
};

export const EXCEPTION_TYPES: { key: string; label: string; hint: string }[] = [
  { key: 'SUA_THONG_TIN', label: 'Sửa thông tin giao hàng', hint: 'Khi khách liên hệ trước lúc giao' },
  { key: 'DOI_SAN_PHAM', label: 'Sửa sản phẩm trong đơn', hint: 'Đổi, thêm, bỏ món; tiền tự bù trừ' },
  { key: 'HUY_DON', label: 'Hủy đơn ngoại lệ', hint: 'Phân loại hoàn tiền như hủy thường' },
  { key: 'HOAN_TIEN', label: 'Hoàn tiền ngoài quy trình', hint: 'Không vượt số đã trả' },
  { key: 'CAP_VOUCHER', label: 'Cấp voucher bồi hoàn', hint: 'Voucher riêng cho khách' },
  { key: 'GIA_HAN', label: 'Gia hạn thời gian xử lý', hint: 'Báo khách ngày giao mới' },
  { key: 'KHAC', label: 'Khác', hint: 'Mô tả ở ghi chú' },
];

export const UNFULFILLABLE_REASONS: { key: string; label: string; template: string }[] = [
  { key: 'HET_HANG', label: 'Hết hàng', template: 'Xin lỗi bạn, sản phẩm trong đơn vừa hết hàng và chưa có ngày nhập lại.' },
  { key: 'HET_VAT_LIEU', label: 'Hết vật liệu cá nhân hóa', template: 'Xin lỗi bạn, vật liệu để cá nhân hóa sản phẩm đang hết và chưa có ngày nhập lại.' },
  { key: 'KHONG_THUC_HIEN_DUOC', label: 'Nội dung in/khắc không thực hiện được', template: 'Xin lỗi bạn, nội dung in/khắc bạn chọn không thể thực hiện được trên sản phẩm này.' },
  { key: 'KHAC', label: 'Lý do khác', template: '' },
];

export const REFUSAL_REASONS: { key: string; label: string }[] = [
  { key: 'KHONG_CO_MAT', label: 'Người nhận không có mặt' },
  { key: 'KHONG_DONG_Y_NHAN', label: 'Người nhận không đồng ý nhận' },
  { key: 'SAI_DIA_CHI', label: 'Sai địa chỉ (lỗi phía giao hàng)' },
];

export const DISPOSAL_METHODS: { key: string; label: string }[] = [
  { key: 'TAI_CHE', label: 'Tái chế' },
  { key: 'TIEU_HUY', label: 'Tiêu hủy' },
  { key: 'KHAC', label: 'Khác' },
];

// Vật liệu gói quà của đơn: mã, tên, ảnh (ảnh để nhân viên đóng gói lấy đúng mẫu)
export interface IGiftPart {
  code?: string;
  name: string;
  image?: string | null;
}

export interface IItemPreview {
  _id: string;
  name: string;
  variantName: string;
  image: string | null;
  quantity: number;
  personalizationText: string | null;
  isPersonalized: boolean;
  fulfillStatus: string;
}

export interface IAdminOrderRow {
  code: string;
  createdAt: string;
  customer: { fullName: string; phone: string };
  itemCount: number;
  itemsPreview: IItemPreview[];
  total: number;
  paymentStatus: string;
  paymentBadge: string;
  paymentMethod: string;
  urgentCode: string | null;
  orderStatus: OrderStatus;
  orderStatusLabel: string;
  carrier: string | null;
  tags: string[];
  hasPersonalizedItems: boolean;
  source: string;
  createdBy: string;
  priority: Priority;
  priorityReason: string | null;
  slaDeadline: string | null;
  slaRemaining: string | null;
  noteCount: number;
}

export interface IStorageRow {
  code: string;
  storageCode: string | null;
  storageShelf: string | null;
  storageStatus: string;
  group: 'dang-luu' | 'sap-het-han' | 'cho-tieu-huy' | 'da-tieu-huy';
  disposal: { method: string; at: string; by: string | null } | null; // nhóm Đã tiêu hủy
  storageReason: string;
  storedAt: string | null;
  storageDeadline: string | null;
  daysLeft: number | null;
  customer: { fullName: string; phone: string };
  userId: string | null;
  items: IItemPreview[];
  paidAmount: number;
  priority: Priority;
}

export interface IAdminOrderList<T = IAdminOrderRow> {
  view: OrderView;
  counts: Record<OrderView, number>;
  storageCounts: Record<string, number> | null;
  tags: string[];
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  monthCount: number;
}

export interface IOrderMetric {
  key: string;
  label: string;
  value: number;
  previous: number;
  change: number | null;
  unit: string;
  series: number[];
}

export interface IActivity {
  at: string;
  kind: 'status' | 'note' | 'log';
  actor: { name: string; initials: string; kind: 'system' | 'customer' | 'staff' };
  text: string;
  detail: string | null;
  attachments: { url: string; name: string; size: number; mimeType: string }[];
  mentions?: string[]; // tên nhân viên được gắn thẻ @ trong ghi chú
}

// API-209, API-210
export interface IMentionable {
  _id: string;
  fullName: string;
  initials: string;
}

export interface IMention {
  _id: string;
  orderCode: string;
  byName: string;
  excerpt: string;
  createdAt: string;
  readAt: string | null;
}

export interface IConfirmCheck {
  key: string;
  ok: boolean;
  label: string;
}

export interface IAdminActions {
  next: { to: OrderStatus; label: string } | null;
  print: boolean;
  note: boolean;
  tags: boolean;
  exception: boolean;
  unfulfillable: boolean;
  asking: boolean; // đơn đang hỏi khách: hủy, gỡ đánh dấu, khách đổi sản phẩm
  pendingChange: boolean; // thay đổi chờ khách trả thêm: xác nhận, hủy thay đổi
  resendChange?: boolean; // liên kết trả thêm đã hết hạn: gửi lại (API-220)
  switchRecipient?: boolean; // đổi Giao cho tôi <-> Giao người nhận trong Sửa thông tin giao hàng (UC-OPS-03 2a)
  apology?: boolean; // khách tự hủy khi đang hỏi: gửi hoặc không gửi voucher xin lỗi (API-94 APOLOGY)
  refused: boolean;
  reconcileCod: boolean;
  shelf: boolean;
  dispose: boolean;
}

export interface IAdminOrderItem extends IItemPreview {
  productId: string;
  slug: string | null;
  sku: string | null;
  variantSku: string;
  unitPrice: number;
  lineValue: number;
  personalization: IPersonalization | null;
  personalizationFeePerUnit: number;
  stock: number | null;
  unfulfillable: { reason: string; message: string; responseDeadline: string | null } | null;
  substitute: { name: string; variantName: string; unitPrice: number } | null;
}

export interface IAdminOrder {
  code: string;
  createdAt: string;
  source: string;
  sourceLabel: string;
  createdBy: string;
  draftCode: string | null;
  customer: { fullName: string; phone: string; email?: string };
  // Tài khoản chờ kích hoạt không là thành viên (isMember = false, ghi "mua lần đầu MM/yyyy")
  customerUser: { _id: string; status: string; isMember: boolean; memberSince: string | null; firstOrderAt: string | null; orderCount: number; totalSpent: number } | null;
  items: IAdminOrderItem[];
  hasPersonalizedItems: boolean;
  giftWrap: { name: string; source?: string; paper?: IGiftPart; ribbon?: IGiftPart; card?: IGiftPart; message?: string } | null;
  recipientType: 'SELF' | 'OTHER';
  shippingAddress: IShippingAddress & { noteForShipper?: string; deliveryDate?: string; deliveryWindow?: string };
  noteForShop: string;
  subtotal: number;
  personalizationFee: number;
  giftWrapFee: number;
  shippingFee: number;
  discount: number;
  vouchers: { code: string; type: string; discount: number }[];
  total: number;
  depositAmount: number;
  remainingAmount: number;
  paidAmount: number;
  refundedAmount: number;
  codDue: number;
  codPaid: number; // số đã thu COD khi giao
  urgentFee?: number;
  urgentCode?: string | null;
  codCollectedAt: string | null;
  paymentMethod: string;
  payments: { code: string; amount: number; paidAt: string; purpose: string; status: string }[];
  orderStatus: OrderStatus;
  orderStatusLabel: string;
  paymentStatus: string;
  paymentBadge: string;
  returnStatus: string;
  priority: Priority;
  priorityReason: string | null;
  slaDeadline: string | null;
  slaRemaining: string | null;
  timeline: ITimelineStep[];
  carrier: string | null;
  carrierLabel: string | null;
  trackingCode: string | null;
  deliveredAt: string | null;
  codDiscrepancy: { expected: number; collected: number; reason: string; at: string } | null;
  expectedDeliveryDate: string | null;
  deliveryExtended?: boolean; // đã gia hạn thời gian xử lý (UC-OPS-03 2e)
  packingSlipPrintedAt: string | null;
  cancelledAt: string | null;
  cancelBy: string | null;
  cancelCase: string | null;
  cancelReason: string | null;
  cancelDetail: string | null;
  refusalReason: string | null;
  refusedShippingFee: number;
  refusalNote: string | null;
  storageStatus: string | null;
  storageDeadline: string | null;
  storageCode: string | null;
  storageShelf: string | null;
  disposal: { method: string; at: string } | null;
  refunds: { _id: string; reason: string; amount: number; status: string; method: string; voucherCode: string | null; hasAccount?: boolean; createdAt: string }[];
  unfulfillable: IAsking | null;
  pendingChange: IPendingChange | null;
  // Liên kết trả thêm đã hết hạn, nhân viên gửi lại một chạm
  lastExpiredChange?: { summary: string; amount: number; expiredAt: string } | null;
  // Yêu cầu duyệt ngoại lệ đặc biệt đang chờ (BR-48)
  approvalRequest?: { _id: string; type: string; label: string; summary: string; amount: number; requestedName: string; createdAt: string; canDecide: boolean } | null;
  personalizationStartedAt?: string | null;
  version?: string; // so với API-230 để tự tải lại
  tags: string[];
  adminActions: IAdminActions;
  exceptionTypes: string[];
  refundable: number;
  confirmChecks: IConfirmCheck[];
  requiredChecks: string[];
  activity: IActivity[];
}

export interface IPackingSlip {
  code: string;
  createdAt: string;
  customer: { fullName: string; phone: string };
  recipientType: string;
  shippingAddress: IShippingAddress & { noteForShipper?: string };
  noteForShop: string;
  giftWrap: IAdminOrder['giftWrap'];
  carrier: string | null;
  trackingCode: string | null;
  codDue: number;
  total: number;
  items: { name: string; variantName: string; sku: string; quantity: number; personalizationText: string | null; personalization?: unknown }[];
}

export interface IOrderBulkResult {
  updated: number;
  failed: { code: string; reason: string }[];
  slips?: IPackingSlip[];
}

// ===== Đơn nháp =====

export type DraftStatus = 'MO' | 'DA_GUI_LINK' | 'HOAN_TAT';
export const DRAFT_STATUS_LABEL: Record<DraftStatus, string> = { MO: 'Mở', DA_GUI_LINK: 'Đã gửi liên kết', HOAN_TAT: 'Đã thành đơn' };

export interface IDraftRow {
  code: string;
  createdAt: string;
  updatedAt: string;
  hasNote: boolean;
  status: DraftStatus;
  customer: { fullName: string; phone: string; email?: string; userId: string | null; orderCount: number } | null;
  total: number | null;
  tags: string[];
  source: string | null;
  orderCode: string | null;
  primaryAction: 'CREATE_ORDER' | 'PAYMENT_LINK' | null;
  kind?: 'THUONG' | 'DAT_GAP';
  urgentStatus?: string | null;
  requestedDate?: string | null;
}

export interface IDraftLine {
  _id?: string;
  productId: string;
  variantSku: string;
  quantity: number;
  personalization: IPersonalization | null;
}

export interface IDraft {
  code: string;
  status: DraftStatus;
  createdAt: string;
  updatedAt: string;
  createdByName?: string | null;
  // Mẫu gói quà gốc khách chọn khi gửi yêu cầu gấp
  customerGiftWrap?: IGiftWrapView | null;
  customerUserId: string | null;
  customer: { fullName: string; phone: string; email?: string } | null;
  items: IDraftLine[];
  giftWrap: unknown | null;
  recipientType: 'SELF' | 'OTHER';
  shippingAddress: (IShippingAddress & { noteForShipper?: string }) | null;
  deliveryDate: string | null;
  deliveryWindow: string | null;
  noteForShop: string;
  voucherCodes: string[];
  paymentChoice: 'COD' | 'ONLINE' | null;
  remainingMethod: 'COD' | null;
  source: string | null;
  tags: string[];
  internalNote: string;
  paymentUrl: string | null;
  // Giao dịch đang gửi (vẽ QR, xác nhận tay với cổng giả lập) và tóm tắt đơn đã tạo (mẫu tin nhắn gửi khách)
  payment?: { code: string; amount: number; canConfirm: boolean } | null;
  order?: { code: string; total: number; paidAmount: number; remainingAmount: number; expectedDeliveryDate: string | null } | null;
  paymentExpiresAt: string | null;
  orderCode: string | null;
  linkExpired: boolean;
  // Khách vừa trả không thành công, liên kết còn hạn để khách Thử lại
  payFailedAt?: string | null;
  // Đặt gấp
  kind?: 'THUONG' | 'DAT_GAP';
  urgentFee?: number;
  urgent?: IDraftUrgent | null;
}

export interface IDraftUrgent {
  status: 'CHO_XEM_XET' | 'DA_CHOT' | 'DA_DAT' | 'TU_CHOI' | 'KHACH_HUY';
  requestedDate: string;
  earliestDate: string;
  conversationId: string | null;
  confirmedAt: string | null;
  version: number;
  rejectReason: string | null;
  history: { at: string; action: string; byName: string | null; note: string | null }[];
}

// Trạng thái yêu cầu gấp phía quản trị (nói rõ ai đang phải làm gì)
export const URGENT_STATUS_LABEL: Record<string, string> = {
  CHO_XEM_XET: 'Chờ shop chốt', DA_CHOT: 'Chờ khách thanh toán', DA_DAT: 'Đã thành đơn', TU_CHOI: 'Shop từ chối', KHACH_HUY: 'Khách đã hủy',
};

export interface IDraftQuoteItem {
  _id: string;
  productId: string;
  slug: string | null;
  name: string;
  image: string | null;
  variantSku: string;
  variantName: string;
  quantity: number;
  personalization: (IPersonalization & { stickerDetails?: { code: string; name: string }[] }) | null;
  personalizationTypes: string[];
  engrave: unknown;
  hasOptions: boolean;
  unitPrice: number;
  personalizationFeePerUnit: number;
  lineValue: number;
  stock: number;
  warning: { code: string; message: string } | null;
}

export interface IPaymentOption {
  key: 'COD' | 'DEPOSIT_COD' | 'ONLINE';
  paymentChoice: 'COD' | 'ONLINE';
  remainingMethod: 'COD' | null;
  amountDueNow: number;
}

export interface IDraftQuote {
  items: IDraftQuoteItem[];
  giftWrap: IGiftWrapView | null;
  money: { subtotal: number; personalizationFee: number; giftWrapFee: number; shippingFee: number; discount: number; total: number; depositAmount: number; remainingAmount: number; hasPersonalized: boolean } | null;
  vouchers: { code: string; name: string; type: string; kind: string; discount: number }[];
  voucherErrors: { code: string; message: string }[];
  paymentOptions: IPaymentOption[];
  allowedMethods: string[];
  chosenOption: string | null;
  amountDueNow: number | null;
  primaryAction: 'CREATE_ORDER' | 'PAYMENT_LINK';
  stockWarnings: { itemId: string; code: string; message: string }[];
  missing: ('customer' | 'items' | 'shipping')[];
  delivery: { min: string; max: string; urgentMin: string; slots: string[] };
  shippingFee: number | null;
}

// ===== Khách hàng, đánh giá =====

export const CUSTOMER_STATUS_LABEL: Record<string, string> = { HOAT_DONG: 'Đang hoạt động', CHO_KICH_HOAT: 'Chưa kích hoạt', BI_KHOA: 'Đã khóa' };

export interface ICustomerRow {
  _id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  status: string;
  createdAt: string;
  orderCount: number;
  totalSpent: number;
  lastOrderCode: string | null;
  lastOrderAt: string | null;
  loginLocked: boolean;
  lookupLocked: boolean;
}

export interface ICustomerDetail {
  _id: string;
  fullName: string;
  isMember: boolean;
  memberSince: string | null;
  firstOrderAt: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  statusReason: string | null;
  birthday: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  loginLocked: boolean;
  lockedUntil: string | null;
  lookupLocked: boolean;
  addresses: (IShippingAddress & { _id: string; isDefault?: boolean; label?: string })[];
  orderCount: number;
  totalSpent: number;
  orders: { code: string; createdAt: string; orderStatus: OrderStatus; orderStatusLabel: string; total: number }[];
  requests: { _id: string; kind: string; orderCode: string; status: string; createdAt: string }[];
  reviews: { _id: string; rating: number; comment: string; productName: string; orderCode: string; isHidden: boolean; createdAt: string; imageCount: number }[];
  vouchers: { code: string; source: string; assignedAt: string; expiresAt: string | null; usedCount: number }[];
  conversations: { _id: string; summary: string | null; status: string; lastMessageAt: string }[];
}

export interface IReviewRow {
  _id: string;
  rating: number;
  comment: string;
  images: string[];
  userName: string;
  userId: string | null;
  productId: string;
  productName: string;
  productSlug: string | null;
  orderCode: string | null;
  isHidden: boolean;
  hiddenReason: string | null;
  createdAt: string;
  // Trả lời của Soulprint (API-233)
  reply: { text: string; byName: string | null; at: string; updatedAt: string } | null;
}

// ===== Không thể thực hiện (hỏi khách) và đổi đơn có bù trừ (BR-47) =====

export interface IAsking {
  status: 'DANG_HOI_KHACH' | 'DA_DONG';
  itemIds: string[];
  itemNames: string[];
  reasonCode: string;
  reason: string;
  message: string;
  at: string;
  slaDeadline: string;
  responseHours: number;
  responseDeadline: string;
  overdue: boolean;
  outcome?: 'DOI_SAN_PHAM' | 'HUY_DON' | 'GO_DANH_DAU';
  apologyVoucher?: { code?: string; skipped?: boolean; reason?: string };
}

export interface IPendingChange {
  kind: 'DOI_SAN_PHAM' | 'KHACH_SUA';
  paymentId: string;
  paymentCode: string;
  amount: number;
  expiresAt: string;
  paymentUrl: string;
  summary: string;
  createdAt: string;
  canConfirm: boolean;
}

export interface ISwapPreview {
  before: { total: number; paid: number; remainingAmount: number };
  after: { total: number; remainingAmount: number };
  settlement: { extra: number; surplus: number };
}

// API-225: voucher khách của đơn nháp dùng được, kèm đủ điều kiện theo đơn nháp hiện tại
export interface IDraftVoucher {
  code: string;
  name: string;
  description: string;
  type: string;
  value: number;
  maxDiscount: number | null;
  minOrderValue: number;
  expiresAt: string | null;
  eligible: boolean;
  reason: string | null;
  discount: number;
}
