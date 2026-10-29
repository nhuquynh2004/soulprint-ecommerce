import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Observable, catchError, map, retry, throwError } from 'rxjs';
import { GiftWrapRequest, ICart, IGiftWraps, IPersonalization } from '../classes/cart';
import { ApiError } from '../classes/api-error';

// Giỏ hàng (API-30 đến API-35, API-118) theo khuôn slide 6.7: HttpHeaders + responseType "text" + JSON.parse + catchError.
// Chỉ GET có retry(3); POST/PUT/DELETE không retry để không thêm trùng dòng giỏ. withCredentials để gửi cookie phiên
// (giỏ Guest nằm trong session).
@Injectable({ providedIn: 'root' })
export class CartApiService {
  constructor(private _http: HttpClient) {}

  private textOptions(): Object {
    const headers = new HttpHeaders().set('Content-Type', 'text/plain;charset=utf-8');
    return { headers: headers, responseType: 'text', withCredentials: true };
  }

  private jsonOptions(): Object {
    const headers = new HttpHeaders().set('Content-Type', 'application/json;charset=utf-8');
    return { headers: headers, responseType: 'text', withCredentials: true };
  }

  // API-30 mẫu gói quà gợi ý và vật liệu
  getGiftWraps(): Observable<IGiftWraps> {
    return this._http.get<any>('/api/gift-wraps', this.textOptions()).pipe(
      map((res) => JSON.parse(res) as IGiftWraps),
      retry(3),
      catchError(this.handleError),
    );
  }

  // API-31
  getCart(): Observable<ICart> {
    return this._http.get<any>('/api/cart', this.textOptions()).pipe(
      map((res) => JSON.parse(res) as ICart),
      retry(3),
      catchError(this.handleError),
    );
  }

  // API-32 (buyNow: chỉ chọn dòng vừa thêm - UC-CRT-01 bước 9)
  // aiSessionId: thêm từ thẻ gợi ý SCR-10 hoặc SCR-03 mở với ?ai= (UC-DIS-05 AC5)
  addItem(data: { productId: string; variantSku?: string; quantity: number; personalization?: IPersonalization | null; aiSessionId?: string | null }, buyNow = false): Observable<ICart> {
    const url = '/api/cart/items' + (buyNow ? '?buyNow=true' : '');
    return this._http.post<any>(url, JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as ICart),
      catchError(this.handleError),
    );
  }

  // API-33
  updateItem(itemId: string, data: { variantSku?: string; quantity?: number; personalization?: IPersonalization | null; selected?: boolean }): Observable<ICart> {
    return this._http.put<any>('/api/cart/items/' + itemId, JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as ICart),
      catchError(this.handleError),
    );
  }

  // API-34
  removeItem(itemId: string): Observable<ICart> {
    return this._http.delete<any>('/api/cart/items/' + itemId, this.textOptions()).pipe(
      map((res) => JSON.parse(res) as ICart),
      catchError(this.handleError),
    );
  }

  // API-118
  setSelection(data: { all: boolean } | { itemIds: string[]; selected: boolean }): Observable<ICart> {
    return this._http.put<any>('/api/cart/selection', JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as ICart),
      catchError(this.handleError),
    );
  }

  // API-35: chọn mẫu, bật/tắt ô chọn dòng gói quà ({selected}), hoặc gỡ ({source: null})
  setGiftWrap(data: GiftWrapRequest | { selected: boolean } | { source: null }): Observable<ICart> {
    return this._http.put<any>('/api/cart/gift-wrap', JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as ICart),
      catchError(this.handleError),
    );
  }

  handleError(error: HttpErrorResponse) {
    return throwError(() => ApiError.from(error));
  }
}
