import { IGiftWrapView } from './cart';
import { IActivation, IPaymentOption, IQuoteItem, RecipientType } from './checkout';

// Đặt gấp: yêu cầu khách gửi khi cần nhận trước ngày giao sớm nhất; shop chốt rồi khách mới thanh toán
export type UrgentStatus = 'CHO_XEM_XET' | 'DA_CHOT' | 'DA_DAT' | 'TU_CHOI' | 'KHACH_HUY';

export interface IUrgentCreated {
  code: string;
  token: string;
  url: string;
  conversationId: string;
}

// API-202
export interface IUrgentView {
  code: string;
  status: UrgentStatus;
  statusLabel: string;
  createdAt: string;
  locked: boolean;
  version: number;
  requestedDate: string;
  earliestDate: string;
  deliveryDate: string;
  deliveryWindow: string | null;
  recipientType: RecipientType;
  customer: { fullName: string; phone: string; email?: string };
  shippingAddress: { recipientName: string; phone: string; province: string; ward: string; street: string; noteForShipper?: string };
  noteForShop: string;
  items: IQuoteItem[];
  giftWrap: IGiftWrapView | null;
  money: {
    subtotal: number; personalizationFee: number; giftWrapFee: number; shippingFee: number; urgentFee: number; discount: number;
    total: number; hasPersonalized: boolean; depositAmount: number; remainingAmount: number;
  } | null;
  vouchers: { code: string; name: string; discount: number }[];
  paymentOptions: IPaymentOption[];
  paymentFixed?: boolean; // Shop đã chốt phương thức, paymentOptions chỉ còn 1
  confirmedAt: string | null;
  rejectReason: string | null;
  orderCode: string | null;
  conversationId: string | null;
  pendingPayment: { paymentId: string; paymentUrl: string; amount: number } | null;
}

// API-203: COD tạo đơn ngay; cần trả online thì chuyển tới cổng
export interface IUrgentCheckout {
  orderCode?: string;
  total?: number;
  activation?: IActivation;
  paymentId?: string;
  paymentUrl?: string;
  amount?: number;
}

export const URGENT_STEPS: { key: UrgentStatus; label: string }[] = [
  { key: 'CHO_XEM_XET', label: 'Shop xem xét' },
  { key: 'DA_CHOT', label: 'Shop đã chốt' },
  { key: 'DA_DAT', label: 'Đã đặt hàng' },
];
