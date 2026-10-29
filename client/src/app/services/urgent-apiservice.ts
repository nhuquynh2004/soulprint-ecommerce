import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Observable, catchError, map, retry, throwError } from 'rxjs';
import { IOrderRequest } from '../classes/checkout';
import { IUrgentCheckout, IUrgentCreated, IUrgentView } from '../classes/urgent';
import { ApiError } from '../classes/api-error';

// Đặt gấp phía khách (API-201 đến API-204) theo khuôn slide 6.7. Token ?t= để Guest mở trên thiết bị khác.
@Injectable({ providedIn: 'root' })
export class UrgentApiService {
  constructor(private _http: HttpClient) {}

  private textOptions(): Object {
    const headers = new HttpHeaders().set('Content-Type', 'text/plain;charset=utf-8');
    return { headers: headers, responseType: 'text', withCredentials: true };
  }

  private jsonOptions(): Object {
    const headers = new HttpHeaders().set('Content-Type', 'application/json;charset=utf-8');
    return { headers: headers, responseType: 'text', withCredentials: true };
  }

  // API-201 gửi yêu cầu đặt gấp từ trang Thanh toán
  create(data: Omit<IOrderRequest, 'acceptPolicy' | 'paymentChoice'>): Observable<IUrgentCreated> {
    return this._http.post<any>('/api/urgent-requests', JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as IUrgentCreated),
      catchError(this.handleError),
    );
  }

  // API-202 xem yêu cầu
  get(code: string, token = ''): Observable<IUrgentView> {
    const q = token ? '?t=' + encodeURIComponent(token) : '';
    return this._http.get<any>('/api/urgent-requests/' + encodeURIComponent(code) + q, this.textOptions()).pipe(
      map((res) => JSON.parse(res) as IUrgentView),
      retry(2),
      catchError(this.handleError),
    );
  }

  // API-203 đặt hàng và thanh toán đơn gấp đã chốt
  checkout(code: string, data: { version: number; paymentChoice: 'COD' | 'ONLINE'; remainingMethod: 'COD' | null; acceptPolicy: boolean; t?: string }): Observable<IUrgentCheckout> {
    return this._http.post<any>('/api/urgent-requests/' + encodeURIComponent(code) + '/checkout', JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as IUrgentCheckout),
      catchError(this.handleError),
    );
  }

  // API-204 khách hủy yêu cầu
  cancel(code: string, token = ''): Observable<IUrgentView> {
    return this._http.post<any>('/api/urgent-requests/' + encodeURIComponent(code) + '/cancel', JSON.stringify({ t: token || undefined }), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as IUrgentView),
      catchError(this.handleError),
    );
  }

  handleError(error: HttpErrorResponse) {
    return throwError(() => ApiError.from(error));
  }
}
