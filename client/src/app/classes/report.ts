// Kiểu dữ liệu báo cáo tổng quan SCR-40 (UC-CAT-03; 07 API-88, API-89).
// Trường tài chính là null khi người xem không có TONG_QUAN.XEM_DOANH_THU (AC7).

export type ReportPreset = 'hom-nay' | '7-ngay' | '30-ngay' | 'thang-nay' | 'thang-truoc' | 'tuy-chon';
export type GroupBy = 'day' | 'week' | 'month';
export type Severity = 'KHAN_CAP' | 'CAN_CHU_Y' | 'BINH_THUONG';
export type ExportDataset = 'orders' | 'revenue' | 'top-products' | 'personalization';

export const PRESETS: { key: Exclude<ReportPreset, 'tuy-chon'>; label: string }[] = [
  { key: 'hom-nay', label: 'Hôm nay' },
  { key: '7-ngay', label: '7 ngày gần nhất' },
  { key: '30-ngay', label: '30 ngày gần nhất' },
  { key: 'thang-nay', label: 'Tháng này' },
  { key: 'thang-truoc', label: 'Tháng trước' },
];

export const GROUP_LABEL: Record<GroupBy, string> = { day: 'ngày', week: 'tuần', month: 'tháng' };

export interface IReportRange {
  preset: ReportPreset;
  from: string;
  to: string;
  days: number;
  label: string;
  prevFrom: string;
  prevTo: string;
}

export interface IMetric {
  value: number | null;
  previous: number | null;
  change: number | null;
  changeKind: 'pct' | 'points';
}

export interface IInsight {
  type: string;
  message: string;
  detail: string;
  link: string;
  severity: Severity;
  severityLabel: string;
  dueAt: string | null;
  due: string | null;
}

export interface ISetupCard {
  key: string;
  title: string;
  description: string;
  link: string;
  done: boolean;
}

export interface IStatusCount {
  status: string;
  label: string;
  count: number;
}

export interface ISeriesPoint {
  key: string;
  label: string;
  orders: number;
  revenue: number | null;
}

export interface ITopProduct {
  productId: string;
  name: string;
  sku: string;
  image: string | null;
  quantity: number;
  revenue: number | null;
  stock: number | null;
  lowStock: boolean;
}

export interface IShare {
  key: string;
  label: string;
  revenue: number;
  orders: number;
  pct: number;
}

interface IReportHead {
  range: IReportRange;
  canFinance: boolean;
}

export interface IOverview extends IReportHead {
  groupBy: GroupBy;
  kpis: {
    revenue: IMetric | null;
    collected: IMetric | null;
    aov: IMetric | null;
    customers: IMetric;
    orders: IMetric;
    completionRate: IMetric;
    cancelRate: IMetric;
    packingCount: number | null;
  };
  series: ISeriesPoint[];
  statuses: IStatusCount[];
  topProducts: ITopProduct[];
  axes: IShare[] | null;
  categories: IShare[] | null;
  insights: IInsight[];
  setup: { cards: ISetupCard[]; doneCount: number; total: number } | null;
  firstOrderAt: string | null;
}

export interface ICustomersSection {
  funnel: { views: number; wishlists: number; addToCarts: number; orders: number };
  topViewed: { productId: string; name: string; views: number; addToCarts: number; rate: number | null }[];
  abandoned: { days: number; carts: number; lines: number; value: number | null; topProducts: { productId: string; name: string; count: number }[] };
}

export interface IVouchersSection {
  totalUses: number;
  totalDiscount: number | null;
  items: { code: string; type: string; uses: number; discount: number | null }[];
}

export interface IReviewsSection {
  count: number;
  avg: number | null;
  best: { productId: string; name: string; count: number; avg: number }[];
  worst: { productId: string; name: string; count: number; avg: number }[];
}

export interface IPersonalizationSection {
  orders: number;
  personalizedOrders: number;
  personalizedRate: number | null;
  fee: number | null;
  engraveItems: number;
  designItems: number;
  topStickers: { code: string; name: string; uses: number }[];
  topStickerSets: { name: string; kind: string; uses: number }[];
  stickerKinds: { THUONG: number; BST_MUA: number };
  giftWrapOrders: number;
  giftWrapRate: number | null;
  giftWrapSources: { GOI_Y: number; CUA_TOI: number; TAO_MOI: number };
  topTemplates: { name: string; uses: number; kind: string }[];
  templateKinds: { THUONG: number; BST_MUA: number };
}

export interface IAiSection {
  sessions: number;
  suggested: number;
  clicks: number;
  orders: number;
  gapRate: number | null;
}

export interface IReportSections {
  customers?: ICustomersSection;
  vouchers?: IVouchersSection;
  reviews?: IReviewsSection;
  personalization?: IPersonalizationSection;
  ai?: IAiSection;
}

export interface IReportQuery {
  preset?: string;
  from?: string;
  to?: string;
  groupBy?: string;
}

// "yyyy-MM-dd" -> "dd/MM/yyyy"
export const dmy = (ymd: string): string => ymd.split('-').reverse().join('/');
