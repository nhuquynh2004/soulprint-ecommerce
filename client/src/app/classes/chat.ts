// Kiểu dữ liệu chat "Sâu Béo" (07_API_Spec.md Mục 2.9, API-104 đến API-107, API-176, API-177) - S11.

export type ChatStatus = 'BOT' | 'CHO_NHAN_VIEN' | 'DANG_HO_TRO' | 'DA_DONG';
export type ChatSender = 'KHACH' | 'BOT' | 'ADMIN' | 'HE_THONG';
export type Sentiment = 'TICH_CUC' | 'TRUNG_TINH' | 'TIEU_CUC';

export interface IChatMessage {
  _id: string;
  sender: ChatSender;
  text: string;
  senderName: string | null;
  link: { label: string; url: string } | null;
  // Thẻ yêu cầu đặt gấp trong chat
  card?: { type: 'DAT_GAP'; code: string; status: string; title: string; text: string; url: string } | null;
  createdAt: string;
  // Chỉ phía nhân viên (UC-CSK-03 AC3)
  originalText?: string | null;
  softened?: boolean;
}

export interface ISupportStatus {
  online: boolean;
  offHours: boolean;
  hours: string;
}

// API-60, API-61, API-62, API-63, API-197 đều trả trạng thái hội thoại kèm các tin mới
export interface IChatState {
  conversationId: string;
  status: ChatStatus;
  statusLabel: string;
  queuePosition: number | null;
  waitMinutes: number | null;
  agentName: string | null;
  contact: string | null;
  leftMessage: boolean;
  support?: ISupportStatus;
  quickTopics?: string[];
  escalation?: 'QUEUED' | 'LEAVE_MESSAGE' | null;
  offHours?: boolean;
  messages: IChatMessage[];
}

// API-62 khi tin gay gắt (UC-CSK-03): chưa lưu tin, chờ khách chọn bản gửi
export interface ISoftenProposal {
  needsConfirm: true;
  softened: string;
}

export type SendResult = IChatState | ISoftenProposal;
export const isProposal = (r: SendResult): r is ISoftenProposal => (r as ISoftenProposal).needsConfirm === true;

// Tin trong khung chat của khách: tin đã gửi, hoặc tin chưa gửi được (mất kết nối - SCR-29 MatKetNoi)
export interface IChatBubble extends IChatMessage {
  failed?: boolean;
}

export const CHAT_MESSAGE_MAX = 1000;
export const CHAT_NOTE_MAX = 500;
export const POLL_MS = 4000; // Hỏi lại mỗi 3-5 giây

// ===== Phía nhân viên (SCR-52) =====

export interface IQueueItem {
  _id: string;
  status: ChatStatus;
  customerName: string;
  isMember: boolean;
  topic: string;
  sentiment: Sentiment;
  sentimentLabel: string;
  escalatedAt: string | null;
  lastMessageAt: string;
  waitMinutes: number;
  leftMessage: boolean;
  lastText: string | null;
  lastSender: ChatSender | null;
  labels: IChatLabel[];
  urgentOpen: boolean;
  isMine: boolean;
  assignedName: string | null;
  unread: boolean;
  remindMinutes: number;
}

export interface IChatLabel {
  code: ChatLabelCode;
  label: string;
}

export type ChatLabelCode = 'DAT_GAP' | 'KHIEU_NAI' | 'DOI_TRA' | 'DON_HANG' | 'TU_VAN';

export interface IQueueList {
  onDuty: boolean;
  finishing: boolean;
  canReply: boolean;
  onDutyStaff: string[];
  waitingCount: number;
  queue?: IQueueItem[];
  mine?: IQueueItem[];
  others?: IQueueItem[];
  closed?: IQueueItem[];
  remindCount?: number;
  urgentCount?: number;
  labels?: IChatLabel[];
}

// Phiên trước của cùng khách (một khách là một hội thoại xuyên suốt)
export interface IEarlierSession {
  _id: string;
  createdAt: string;
  closedAt: string | null;
  topic: string | null;
  messages: IChatMessage[];
}

export interface IUrgentBrief {
  code: string;
  status: string;
  statusLabel: string;
  requestedDate: string;
  deliveryDate: string;
  total: number | null;
  urgentFee: number;
  orderCode: string | null;
  createdAt: string;
}

export interface IInternalNote {
  _id: string;
  at: string;
  by: string;
  byName: string;
  text: string;
}

export interface ICustomerPanel {
  _id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  isMember: boolean; // Tài khoản chờ kích hoạt chưa là thành viên
  memberSince: string | null;
  firstOrderAt: string | null;
  orderCount: number;
  totalSpent: number;
  recentOrders: {
    code: string;
    orderStatus: string;
    orderStatusLabel: string;
    paymentStatusLabel: string;
    total: number;
    createdAt: string;
    firstItem: string;
    moreItems: number;
  }[];
  previousConversations: { _id: string; status: ChatStatus; topic: string | null; summary: string | null; lastMessageAt: string }[];
}

export interface IConversationDetail {
  _id: string;
  status: ChatStatus;
  statusLabel: string;
  assignedName: string | null;
  isMine: boolean;
  canReply: boolean;
  canClose: boolean;
  blockedReason: string | null;
  sentiment: Sentiment;
  sentimentLabel: string;
  labels: IChatLabel[];
  labelsManual: boolean;
  urgentOpen: boolean;
  messages: IChatMessage[];
  // Chỉ có ở lần đọc đầy đủ (không có ?after)
  customerName?: string;
  isMember?: boolean;
  topic?: string | null;
  contact?: string | null;
  leftMessage?: boolean;
  summary?: string | null;
  escalatedAt?: string | null;
  createdAt?: string;
  notes?: IInternalNote[];
  customer?: ICustomerPanel | null;
  quickReplies?: { label: string; text: string }[];
  earlier?: IEarlierSession[];
  urgentRequests?: IUrgentBrief[];
}

export interface IDutyResult {
  onDuty: boolean;
  finishing: boolean;
  reassigned: number;
  remaining: number;
  returnedToQueue?: number;
}

// Màu chỉ báo cảm xúc (UC-CSK-02 bước 3): xanh, cam, đỏ
export const SENTIMENT_TONE: Record<Sentiment, 'success' | 'warning' | 'danger'> = {
  TICH_CUC: 'success',
  TRUNG_TINH: 'warning',
  TIEU_CUC: 'danger',
};

// Chữ viết tắt trên avatar: "Nguyễn Minh Anh" -> "MA"
export function initials(name: string | null | undefined): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const pick = parts.length >= 2 ? parts.slice(-2) : parts;
  return pick.map((p) => p.charAt(0).toUpperCase()).join('');
}

// Liên hệ để lại ngoài giờ: SĐT 10 số bắt đầu bằng 0 hoặc email (giống server chatRules.validContact)
export function validContact(value: string): boolean {
  const c = String(value || '').trim();
  if (c.includes('@')) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c) && c.length <= 100;
  return /^0\d{9}$/.test(c.replace(/[\s.-]/g, ''));
}
