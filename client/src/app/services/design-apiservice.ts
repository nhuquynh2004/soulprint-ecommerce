import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Observable, catchError, map, retry, throwError } from 'rxjs';
import { IPersonalization, ISavedDesign, IWishItem } from '../classes/cart';
import { ApiError } from '../classes/api-error';

// Thiết kế đã lưu (API-14 đến API-17) và yêu thích (API-18 đến API-20) của Member, khuôn slide 6.7.
@Injectable({ providedIn: 'root' })
export class DesignApiService {
  constructor(private _http: HttpClient) {}

  private textOptions(): Object {
    const headers = new HttpHeaders().set('Content-Type', 'text/plain;charset=utf-8');
    return { headers: headers, responseType: 'text', withCredentials: true };
  }

  private jsonOptions(): Object {
    const headers = new HttpHeaders().set('Content-Type', 'application/json;charset=utf-8');
    return { headers: headers, responseType: 'text', withCredentials: true };
  }

  // API-14
  getDesigns(kind?: 'GOI_QUA' | 'CA_NHAN_HOA'): Observable<ISavedDesign[]> {
    return this._http.get<any>('/api/account/designs' + (kind ? '?kind=' + kind : ''), this.textOptions()).pipe(
      map((res) => JSON.parse(res) as ISavedDesign[]),
      retry(3),
      catchError(this.handleError),
    );
  }

  // API-15: mẫu gói quà hoặc thiết kế In/Khắc của sản phẩm
  createDesign(
    data:
      | { kind: 'GOI_QUA'; name: string; paper: string; ribbon: string; card: string; message: string }
      | { kind: 'CA_NHAN_HOA'; name?: string; productId: string; personalization: IPersonalization },
  ): Observable<ISavedDesign> {
    return this._http.post<any>('/api/account/designs', JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as ISavedDesign),
      catchError(this.handleError),
    );
  }

  // API-16 PUT, _id trong body (slide 6.7.4)
  updateDesign(data: { _id: string; name?: string; paper?: string; ribbon?: string; card?: string; message?: string }): Observable<ISavedDesign> {
    return this._http.put<any>('/api/account/designs', JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as ISavedDesign),
      catchError(this.handleError),
    );
  }

  // API-17
  deleteDesign(id: string): Observable<void> {
    return this._http.delete<any>('/api/account/designs/' + id, this.textOptions()).pipe(
      map(() => undefined),
      catchError(this.handleError),
    );
  }

  // API-18 danh sách đầy đủ (SCR-22)
  getWishlist(): Observable<IWishItem[]> {
    return this._http.get<any>('/api/account/wishlist', this.textOptions()).pipe(
      map((res) => JSON.parse(res) as IWishItem[]),
      retry(3),
      catchError(this.handleError),
    );
  }

  // API-18 chỉ mã sản phẩm để tô trái tim trên thẻ
  getWishlistIds(): Observable<string[]> {
    return this._http.get<any>('/api/account/wishlist?ids=true', this.textOptions()).pipe(
      map((res) => JSON.parse(res) as string[]),
      retry(3),
      catchError(this.handleError),
    );
  }

  // API-19
  addToWishlist(productId: string): Observable<string[]> {
    return this._http.post<any>('/api/account/wishlist', JSON.stringify({ productId }), this.jsonOptions()).pipe(
      map((res) => (JSON.parse(res) as { wishlist: string[] }).wishlist),
      catchError(this.handleError),
    );
  }

  // API-20
  removeFromWishlist(productId: string): Observable<string[]> {
    return this._http.delete<any>('/api/account/wishlist/' + productId, this.textOptions()).pipe(
      map((res) => (JSON.parse(res) as { wishlist: string[] }).wishlist),
      catchError(this.handleError),
    );
  }

  handleError(error: HttpErrorResponse) {
    return throwError(() => ApiError.from(error));
  }
}
