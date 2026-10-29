import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Observable, catchError, map, retry, throwError } from 'rxjs';
import { ICart } from '../classes/cart';
import { IChangePreview, ICancelRequest, ILookupList, ILookupSent, INoticeList, IOrderDetail, IOrderList, IRefundInfo, NoticeGroup, OrderRange, OrderTab } from '../classes/order';
import { ApiError } from '../classes/api-error';
import { IReturnRequest, IReview, IWarrantyRequest } from '../classes/aftersales';

// Đơn hàng của tôi, tra cứu đơn, thông báo (API-21, 22, 42 đến 46, 55 đến 58, 192) theo khuôn slide 6.7.
// S9: nhận lại hàng, nhận tiền hoàn, đổi trả, bảo hành, đánh giá (API-47, 48, 50 đến 54, 195).
// GET retry được; PUT/POST ghi dữ liệu (hủy, đặt lại, gửi OTP) thì không retry để không làm 2 lần.
@Injectable({ providedIn: 'root' })
export class OrderApiService {
  constructor(private _http: HttpClient) {}

  private textOptions(): Object {
    const headers = new HttpHeaders().set('Content-Type', 'text/plain;charset=utf-8');
    return { headers: headers, responseType: 'text', withCredentials: true };
  }

  private jsonOptions(): Object {
    const headers = new HttpHeaders().set('Content-Type', 'application/json;charset=utf-8');
    return { headers: headers, responseType: 'text', withCredentials: true };
  }

  private get<T>(url: string): Observable<T> {
    return this._http.get<any>(url, this.textOptions()).pipe(
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

  // API-42 Đơn hàng của tôi
  getOrders(tab: OrderTab, range: OrderRange, page = 1): Observable<IOrderList> {
    return this.get<IOrderList>(`/api/orders?tab=${tab}&range=${range}&page=${page}`);
  }

  // API-43 chi tiết đơn (chủ đơn hoặc phiên tra cứu)
  getOrder(code: string): Observable<IOrderDetail> {
    return this.get<IOrderDetail>('/api/orders/' + encodeURIComponent(code));
  }

  // API-229 phiên bản đơn để tự tải lại khi đơn đổi ở nơi khác
  getOrderVersion(code: string): Observable<{ version: string }> {
    return this.get<{ version: string }>('/api/orders/' + encodeURIComponent(code) + '/version');
  }

  // API-44 hủy đơn
  cancel(code: string, body: ICancelRequest): Observable<IOrderDetail> {
    return this.send<IOrderDetail>('put', '/api/orders/' + encodeURIComponent(code) + '/cancel', body);
  }

  // API-45 đã nhận hàng
  received(code: string): Observable<IOrderDetail> {
    return this.send<IOrderDetail>('put', '/api/orders/' + encodeURIComponent(code) + '/received');
  }

  // API-46 đặt lại / mua lại
  reorder(code: string): Observable<{ cart: ICart; added: number; skipped: string[] }> {
    return this.send('post', '/api/orders/' + encodeURIComponent(code) + '/reorder');
  }

  // API-215 sửa thông tin giao hàng khi đơn chờ xác nhận (UC-TRK-06)
  // 202 {payment} khi đổi sang Giao người nhận cần trả thêm (UC-TRK-06 2a)
  updateShipping(code: string, body: Record<string, unknown>): Observable<{ order?: IOrderDetail; payment?: { paymentId: string; paymentUrl: string; amount: number } }> {
    return this.send('put', '/api/orders/' + encodeURIComponent(code) + '/shipping', body);
  }

  // API-216 sửa cá nhân hóa 1 món (UC-TRK-06): preview trả số liệu cho hộp xác nhận; 200 {order, refundVoucher?, refund?}
  // hoặc 202 {payment} khi phải trả thêm; refundMethod: cách nhận phần dư (BR-47 b)
  updatePersonalization(
    code: string,
    itemId: string,
    personalization: unknown,
    opts: { preview?: boolean; refundMethod?: 'BANK' | 'VOUCHER' } = {},
  ): Observable<{
    order?: IOrderDetail;
    refundVoucher?: { code: string; value: number } | null;
    refund?: { amount: number; needsAccount: boolean } | null;
    payment?: { paymentId: string; paymentUrl: string; amount: number };
    preview?: IChangePreview;
  }> {
    return this.send('put', '/api/orders/' + encodeURIComponent(code) + '/items/' + encodeURIComponent(itemId) + '/personalization', { personalization, ...opts });
  }

  // API-219 nhận voucher dùng ngay thay cho chờ chuyển khoản phần dư khi đơn đổi (BR-47 b)
  refundToVoucher(code: string): Observable<{ voucher: { code: string; value: number } }> {
    return this.send('post', '/api/orders/' + encodeURIComponent(code) + '/refunds/voucher', {});
  }

  // ===== Hậu mãi (S9) =====

  // API-47 nhận lại hàng TH3: trả giao dịch REDELIVERY để chuyển tới cổng thanh toán
  redelivery(code: string, body: Record<string, unknown>): Observable<{ paymentId: string; paymentUrl: string; amount: number; breakdown: { shippingFee: number; remaining: number; total: number } }> {
    return this.send('post', '/api/orders/' + encodeURIComponent(code) + '/redelivery', body);
  }

  // API-48 nhận tiền hoàn TH2 hoặc nhập lại tài khoản (UC-CNL-05 5a)
  refundRequest(code: string, body: Record<string, unknown>): Observable<{ refund: IRefundInfo }> {
    return this.send('post', '/api/orders/' + encodeURIComponent(code) + '/refund-request', body);
  }

  // API-50, API-51 đổi trả
  createReturn(code: string, body: Record<string, unknown>): Observable<{ returnRequest: IReturnRequest }> {
    return this.send('post', '/api/orders/' + encodeURIComponent(code) + '/returns', body);
  }

  cancelReturn(id: string): Observable<null> {
    return this.remove('/api/returns/' + encodeURIComponent(id));
  }

  // API-52 bảo hành
  createWarranty(code: string, body: Record<string, unknown>): Observable<{ warrantyRequest: IWarrantyRequest }> {
    return this.send('post', '/api/orders/' + encodeURIComponent(code) + '/warranty', body);
  }

  // API-53, API-54, API-195 đánh giá
  createReview(body: Record<string, unknown>): Observable<{ review: IReview }> {
    return this.send('post', '/api/reviews', body);
  }

  updateReview(body: Record<string, unknown>): Observable<{ review: IReview }> {
    return this.send('put', '/api/reviews', body);
  }

  deleteReview(id: string): Observable<null> {
    return this.remove('/api/reviews/' + encodeURIComponent(id));
  }

  private remove(url: string): Observable<null> {
    return this._http.delete<any>(url, this.textOptions()).pipe(
      map(() => null),
      catchError(this.handleError),
    );
  }

  // API-55, 56, 57, 58 tra cứu đơn
  lookupOtp(target: string): Observable<ILookupSent> {
    return this.send<ILookupSent>('post', '/api/lookup/otp', { target });
  }

  lookupVerify(target: string, otp: string): Observable<{ maskedPhone: string; expiresIn: number }> {
    return this.send('post', '/api/lookup/verify', { target, otp });
  }

  lookupOrders(): Observable<ILookupList> {
    return this._http.get<any>('/api/lookup/orders', this.textOptions()).pipe(
      map((res) => JSON.parse(res) as ILookupList),
      catchError(this.handleError),
    );
  }

  resendActivation(): Observable<{ sent: boolean; maskedPhone: string; devLink?: string | null }> {
    return this.send('post', '/api/lookup/activation-link');
  }

  // API-21, 22, 192 thông báo
  getNotices(group: NoticeGroup | '' = '', page = 1, pageSize = 20): Observable<INoticeList> {
    return this.get<INoticeList>(`/api/notifications?page=${page}&pageSize=${pageSize}${group ? '&group=' + group : ''}`);
  }

  markRead(id: string): Observable<null> {
    return this.send<null>('put', '/api/notifications/' + encodeURIComponent(id) + '/read');
  }

  markAllRead(): Observable<{ updated: number }> {
    return this.send('put', '/api/notifications/read-all');
  }

  handleError(error: HttpErrorResponse) {
    return throwError(() => ApiError.from(error));
  }
}
