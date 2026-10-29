import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Observable, catchError, map, retry, throwError } from 'rxjs';
import {
  IAppliedVoucher, IMyVouchers, IOrderCreated, IOrderRequest, IOrderSummary, IPaymentCreated, IPaymentResult, IPaymentView, IQuote, IWalletVoucher, RecipientType, VoucherTab,
} from '../classes/checkout';
import { ApiError } from '../classes/api-error';

// Đặt hàng, voucher, thanh toán online phía khách (API-13, API-36 đến API-40, API-43, API-191) theo khuôn slide 6.7.
// API-36, 37 là POST nhưng chỉ tính toán (không ghi) nên retry được; API-38, 40, 191 ghi dữ liệu thì không retry.
@Injectable({ providedIn: 'root' })
export class CheckoutApiService {
  constructor(private _http: HttpClient) {}

  private textOptions(): Object {
    const headers = new HttpHeaders().set('Content-Type', 'text/plain;charset=utf-8');
    return { headers: headers, responseType: 'text', withCredentials: true };
  }

  private jsonOptions(): Object {
    const headers = new HttpHeaders().set('Content-Type', 'application/json;charset=utf-8');
    return { headers: headers, responseType: 'text', withCredentials: true };
  }

  // API-37 bảng tiền, voucher, lựa chọn thanh toán cho các dòng đang chọn
  quote(data: { recipientType: RecipientType; voucherCodes: string[]; contact?: { phone: string }; shippingAddress?: { province: string } }): Observable<IQuote> {
    return this._http.post<any>('/api/checkout/quote', JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as IQuote),
      retry(2),
      catchError(this.handleError),
    );
  }

  // API-36 kiểm tra 1 mã (appliedCodes để biết mã mới thay mã nào)
  checkVoucher(code: string, appliedCodes: string[]): Observable<IAppliedVoucher> {
    return this._http.post<any>('/api/checkout/voucher', JSON.stringify({ code, appliedCodes }), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as IAppliedVoucher),
      catchError(this.handleError),
    );
  }

  // API-36 không gửi mã: kho ưu đãi kèm lý do chưa dùng được (UC-ACC-05 3b)
  getWallet(): Observable<IWalletVoucher[]> {
    return this._http.post<any>('/api/checkout/voucher', JSON.stringify({}), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as IWalletVoucher[]),
      retry(2),
      catchError(this.handleError),
    );
  }

  // API-38 đặt hàng
  createOrder(data: IOrderRequest): Observable<IOrderCreated> {
    return this._http.post<any>('/api/orders', JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as IOrderCreated),
      catchError(this.handleError),
    );
  }

  // API-39 giao dịch thanh toán (SCR-08, trang thất bại SCR-09, điền sẵn SCR-07)
  getPayment(id: string): Observable<IPaymentView> {
    return this._http.get<any>('/api/payments/' + encodeURIComponent(id), this.textOptions()).pipe(
      map((res) => JSON.parse(res) as IPaymentView),
      retry(2),
      catchError(this.handleError),
    );
  }

  // API-40 cổng giả lập: khách bấm Thanh toán thành công / thất bại / Hủy
  simulatePayment(id: string, result: 'success' | 'fail' | 'cancel'): Observable<IPaymentResult> {
    return this._http.post<any>('/api/payments/' + encodeURIComponent(id) + '/simulate', JSON.stringify({ result }), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as IPaymentResult),
      catchError(this.handleError),
    );
  }

  // API-191 "Thử lại" / "Tạo phiên thanh toán mới"
  retryPayment(id: string): Observable<IPaymentCreated> {
    return this._http.post<any>('/api/payments/' + encodeURIComponent(id) + '/retry', JSON.stringify({}), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as IPaymentCreated),
      catchError(this.handleError),
    );
  }

  // API-43 đơn vừa đặt (SCR-09)
  getOrder(code: string): Observable<IOrderSummary> {
    return this._http.get<any>('/api/orders/' + encodeURIComponent(code), this.textOptions()).pipe(
      map((res) => JSON.parse(res) as IOrderSummary),
      retry(3),
      catchError(this.handleError),
    );
  }

  // API-13 Ưu đãi của tôi
  getMyVouchers(tab: VoucherTab): Observable<IMyVouchers> {
    return this._http.get<any>('/api/account/vouchers?tab=' + tab, this.textOptions()).pipe(
      map((res) => JSON.parse(res) as IMyVouchers),
      retry(3),
      catchError(this.handleError),
    );
  }

  handleError(error: HttpErrorResponse) {
    return throwError(() => ApiError.from(error));
  }
}
