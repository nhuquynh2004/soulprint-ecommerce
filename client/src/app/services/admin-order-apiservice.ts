import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, retry, throwError } from 'rxjs';
import { ApiError } from '../classes/api-error';
import {
  IAdminOrder, IAdminOrderList, IActivity, IMention, IMentionable, ICustomerDetail, ICustomerRow, IDraft, IDraftQuote, IDraftRow, IOrderBulkResult,
  IOrderMetric, IReviewRow, IStorageRow, ISwapPreview,
  IDraftVoucher,
} from '../classes/admin-order';

type Query = Record<string, string | number | boolean | undefined | null>;

// Vận hành đơn, đơn nháp, hàng lưu kho, khách hàng và đánh giá phía quản trị (07 Mục 2.17, 2.18, 2.20 - S8) theo khuôn
// slide 6.7: GET có retry, PUT/POST/DELETE ghi dữ liệu không retry để không làm 2 lần.
@Injectable({ providedIn: 'root' })
export class AdminOrderApiService {
  constructor(private _http: HttpClient) {}

  private textOptions(query?: Query): Object {
    const headers = new HttpHeaders().set('Content-Type', 'text/plain;charset=utf-8');
    let params = new HttpParams();
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== '') params = params.set(k, String(v));
    return { headers: headers, responseType: 'text', withCredentials: true, params: params };
  }

  private jsonOptions(): Object {
    const headers = new HttpHeaders().set('Content-Type', 'application/json;charset=utf-8');
    return { headers: headers, responseType: 'text', withCredentials: true };
  }

  private get<T>(url: string, query?: Query): Observable<T> {
    return this._http.get<any>(url, this.textOptions(query)).pipe(
      map((res) => JSON.parse(res) as T),
      retry(2),
      catchError(this.handleError),
    );
  }

  private send<T>(method: 'post' | 'put', url: string, body: unknown = {}): Observable<T> {
    return this._http[method]<any>(url, JSON.stringify(body), this.jsonOptions()).pipe(
      map((res) => (res ? (JSON.parse(res) as T) : (null as T))),
      catchError(this.handleError),
    );
  }

  private o(code: string): string {
    return '/api/admin/orders/' + encodeURIComponent(code);
  }

  // ===== Đơn hàng =====

  // API-90
  getOrders(query: Query): Observable<IAdminOrderList> {
    return this.get('/api/admin/orders', query);
  }

  // API-90 view=storage (SCR-51)
  getStorage(query: Query): Observable<IAdminOrderList<IStorageRow>> {
    return this.get('/api/admin/orders', { ...query, view: 'storage' });
  }

  // API-158
  getStats(days: 7 | 30): Observable<{ days: number; metrics: IOrderMetric[] }> {
    return this.get('/api/admin/orders/stats', { days });
  }

  // API-91
  getOrder(code: string): Observable<IAdminOrder> {
    return this.get(this.o(code));
  }

  // API-230 phiên bản đơn để SCR-48 tự tải lại
  getOrderVersion(code: string): Observable<{ version: string }> {
    return this.get(this.o(code) + '/version');
  }

  // API-92
  changeStatus(code: string, body: Record<string, unknown>): Observable<IAdminOrder> {
    return this.send('put', this.o(code) + '/status', body);
  }

  // API-93
  reconcileCod(code: string, collectedAmount: number): Observable<IAdminOrder> {
    return this.send('put', this.o(code) + '/cod', { collectedAmount });
  }

  // API-94
  markUnfulfillable(code: string, body: Record<string, unknown>): Observable<IAdminOrder> {
    return this.send('put', this.o(code) + '/unfulfillable', body);
  }

  // API-95
  markRefused(code: string, body: Record<string, unknown>): Observable<IAdminOrder> {
    return this.send('put', this.o(code) + '/refused', body);
  }

  // API-96
  addException(code: string, body: Record<string, unknown>): Observable<IAdminOrder> {
    return this.send('post', this.o(code) + '/exceptions', body);
  }

  // API-96 DOI_SAN_PHAM preview: khung so sánh tiền trước khi xác nhận đổi sản phẩm (BR-47)
  previewSwap(code: string, changes: Record<string, unknown>): Observable<ISwapPreview> {
    return this.send('post', this.o(code) + '/exceptions', { type: 'DOI_SAN_PHAM', preview: true, changes });
  }

  // API-96 SUA_THONG_TIN preview: số khách trả thêm khi đổi kiểu nhận
  previewRecipient(code: string, recipientType: 'SELF' | 'OTHER'): Observable<ISwapPreview> {
    return this.send('post', this.o(code) + '/exceptions', { type: 'SUA_THONG_TIN', preview: true, changes: { recipientType } });
  }

  // API-218 hủy thay đổi chờ khách trả thêm
  // API-222 gửi Quản trị duyệt ngoại lệ đặc biệt; API-223 duyệt hoặc từ chối (BR-48)
  requestApproval(code: string, api: 'EXCEPTION' | 'UNFULFILLABLE', body: Record<string, unknown>): Observable<IAdminOrder> {
    return this._http.post<any>(this.o(code) + '/approval-requests', { api, body }, this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as IAdminOrder),
      catchError(this.handleError),
    );
  }

  decideApproval(id: string, decision: 'DUYET' | 'TU_CHOI', reason = ''): Observable<IAdminOrder> {
    return this._http.put<any>('/api/admin/approval-requests/' + encodeURIComponent(id), { decision, reason }, this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as IAdminOrder),
      catchError(this.handleError),
    );
  }

  // API-224 chép đơn vào đơn nháp mới
  copyToDraft(code: string): Observable<{ draftCode: string; skipped: string[] }> {
    return this._http.post<any>(this.o(code) + '/copy-to-draft', {}, this.jsonOptions()).pipe(
      map((res) => JSON.parse(res)),
      catchError(this.handleError),
    );
  }

  // API-225 voucher khách của đơn nháp dùng được, tính theo nội dung form đang soạn
  getDraftVouchersForm(form: Record<string, unknown>): Observable<{ items: IDraftVoucher[] }> {
    return this._http.post<any>('/api/admin/draft-orders/vouchers', JSON.stringify(form), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res)),
      catchError(this.handleError),
    );
  }

  // API-221 mở chat với khách của đơn, tin mở đầu điền sẵn; khách chưa kích hoạt thì conversationId null
  openConversation(code: string): Observable<{ conversationId: string | null; customerName: string; phone: string | null; draft: string }> {
    return this._http.post<any>(this.o(code) + '/conversation', {}, this.jsonOptions()).pipe(
      map((res) => JSON.parse(res)),
      catchError(this.handleError),
    );
  }

  // API-220 gửi lại liên kết thanh toán thêm đã hết hạn
  resendPendingChange(code: string): Observable<IAdminOrder> {
    return this._http.post<any>(this.o(code) + '/pending-change/resend', {}, this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as IAdminOrder),
      catchError(this.handleError),
    );
  }

  cancelPendingChange(code: string): Observable<IAdminOrder> {
    return this._http.delete<any>(this.o(code) + '/pending-change', this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as IAdminOrder),
      catchError(this.handleError),
    );
  }

  // API-217 xác nhận khách đã trả với cổng giả lập (đơn nháp, thay đổi đơn)
  confirmPayment(paymentCode: string): Observable<{ status: string; orderCode?: string; failMessage?: string }> {
    return this.send('post', '/api/admin/payments/' + encodeURIComponent(paymentCode) + '/confirm', {});
  }

  // API-103
  dispose(code: string, method: string): Observable<{ code: string; refund: number }> {
    return this.send('put', this.o(code) + '/dispose', { confirm: true, method, checked: true });
  }

  // API-194
  setShelf(code: string, shelf: string): Observable<{ code: string; storageShelf: string }> {
    return this.send('put', this.o(code) + '/storage', { shelf });
  }

  // Khối Thẻ SCR-48
  setTags(code: string, tags: string[]): Observable<{ tags: string[] }> {
    return this.send('put', this.o(code) + '/tags', { tags });
  }

  // API-160; mentions: _id nhân viên được gắn thẻ @
  addNote(code: string, text: string, files: { name: string; dataUrl: string }[], mentions: string[] = []): Observable<IActivity> {
    return this.send('post', this.o(code) + '/notes', { text, files, mentions });
  }

  // API-209 gợi ý tên khi gõ @
  getMentionable(): Observable<IMentionable[]> {
    return this.get('/api/admin/staff/mentionable');
  }

  // API-210 lần mình được gắn thẻ
  getMentions(): Observable<{ unread: number; items: IMention[] }> {
    return this.get('/api/admin/mentions');
  }

  // API-211 đánh dấu đã đọc (ids trống là tất cả)
  readMentions(ids: string[] = []): Observable<{ unread: number }> {
    return this.send('put', '/api/admin/mentions/read', { ids });
  }

  // API-159 (ADD_TAGS, REMOVE_TAGS, PRINT_PACKING_SLIP)
  bulkOrders(body: { codes: string[]; action: string; tags?: string[] }): Observable<IOrderBulkResult> {
    return this.send('post', '/api/admin/orders/bulk', body);
  }

  // API-159 EXPORT_CSV: trả nội dung tệp CSV
  exportCsv(codes: string[], kind: 'orders' | 'storage' = 'orders'): Observable<string> {
    return this._http.post<any>('/api/admin/orders/bulk', JSON.stringify({ codes, action: 'EXPORT_CSV', kind }), this.jsonOptions()).pipe(catchError(this.handleError));
  }

  // ===== Đơn nháp =====

  // API-152
  getDrafts(query: Query): Observable<{ items: IDraftRow[]; counts: Record<string, number>; page: number; pageSize: number; total: number }> {
    return this.get('/api/admin/draft-orders', query);
  }

  // API-154
  getDraft(code: string): Observable<{ draft: IDraft; quote: IDraftQuote }> {
    return this.get('/api/admin/draft-orders/' + encodeURIComponent(code));
  }

  // API-97
  quoteDraft(body: Partial<IDraft>): Observable<IDraftQuote> {
    return this.send('post', '/api/admin/draft-orders/quote', body);
  }

  // API-153
  createDraft(body: Partial<IDraft>): Observable<{ draft: IDraft; quote: IDraftQuote }> {
    return this.send('post', '/api/admin/draft-orders', body);
  }

  // API-155 (code trong body)
  updateDraft(body: Partial<IDraft> & { code: string }): Observable<{ draft: IDraft; quote: IDraftQuote }> {
    return this.send('put', '/api/admin/draft-orders', body);
  }

  // API-156
  deleteDraft(code: string): Observable<null> {
    return this._http.delete<any>('/api/admin/draft-orders/' + encodeURIComponent(code), this.textOptions()).pipe(
      map(() => null),
      catchError(this.handleError),
    );
  }

  // API-157
  completeDraft(code: string, mode: 'CREATE_ORDER' | 'PAYMENT_LINK'): Observable<{ mode: string; orderCode?: string; paymentUrl?: string; expiresAt?: string; amount?: number }> {
    return this.send('post', '/api/admin/draft-orders/' + encodeURIComponent(code) + '/complete', { mode });
  }

  // API-205 chốt, mở lại, từ chối đơn gấp
  urgentAction(code: string, action: 'CONFIRM' | 'REOPEN' | 'REJECT', reason = ''): Observable<{ draft: IDraft; quote: IDraftQuote }> {
    return this.send('post', '/api/admin/draft-orders/' + encodeURIComponent(code) + '/urgent', { action, reason });
  }

  // API-193
  bulkDrafts(body: { codes: string[]; action: string; tags?: string[] }): Observable<{ updated: number; failed: { code: string; reason: string }[]; orders: string[]; links: { code: string; paymentUrl: string; expiresAt: string; amount: number }[] }> {
    return this.send('post', '/api/admin/draft-orders/bulk', body);
  }

  // ===== Khách hàng, đánh giá =====

  // API-98
  getCustomers(query: Query): Observable<{ items: ICustomerRow[]; page: number; pageSize: number; total: number; allCount: number; newThisMonth: number }> {
    return this.get('/api/admin/customers', query);
  }

  // API-138
  getCustomer(id: string): Observable<ICustomerDetail> {
    return this.get('/api/admin/customers/' + encodeURIComponent(id));
  }

  // API-139
  updateCustomer(id: string, body: Record<string, unknown>): Observable<ICustomerDetail> {
    return this.send('put', '/api/admin/customers/' + encodeURIComponent(id), body);
  }

  // API-140
  resendActivation(id: string): Observable<{ sent: boolean; devLink: string | null }> {
    return this.send('post', '/api/admin/customers/' + encodeURIComponent(id) + '/activation-link');
  }

  // API-141
  getReviews(query: Query): Observable<{ items: IReviewRow[]; page: number; pageSize: number; total: number; counts: { all: number; shown: number; hidden: number } }> {
    return this.get('/api/admin/reviews', query);
  }

  // API-142
  setReviewVisibility(reviewIds: string[], isHidden: boolean, reason = ''): Observable<{ updated: number }> {
    return this.send('put', '/api/admin/reviews/visibility', { reviewIds, isHidden, reason });
  }

  // API-233: trả lời đánh giá, text rỗng là xóa trả lời
  replyReview(id: string, text: string): Observable<{ review: Pick<IReviewRow, '_id' | 'reply'> }> {
    return this.send('put', '/api/admin/reviews/reply', { _id: id, text });
  }

  handleError(error: HttpErrorResponse) {
    return throwError(() => ApiError.from(error));
  }
}
