import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, retry, throwError, timer } from 'rxjs';
import { IPage, IProduct, IProductDetail, IReviewPage, ISuggestion } from '../classes/product';
import { ApiError } from '../classes/api-error';

type Query = Record<string, string | number | null | undefined>;

// Gọi API sản phẩm phía khách (07_API_Spec.md Mục 2.3) theo khuôn service của slide 6.7:
// HttpHeaders text/plain, responseType "text", JSON.parse, retry(3) cho GET, catchError(handleError).
// withCredentials để trình duyệt gửi kèm cookie phiên (Chương VIII).
@Injectable({ providedIn: 'root' })
export class ProductApiService {
  constructor(private _http: HttpClient) {}

  private getOptions(params?: Query): Object {
    const headers = new HttpHeaders().set('Content-Type', 'text/plain;charset=utf-8');
    let httpParams = new HttpParams();
    for (const [key, value] of Object.entries(params || {})) {
      if (value !== null && value !== undefined && value !== '') httpParams = httpParams.set(key, String(value));
    }
    return { headers: headers, responseType: 'text', withCredentials: true, params: httpParams };
  }

  // API-26 danh sách có lọc, sắp xếp, phân trang
  getProducts(query: Query): Observable<IPage<IProduct>> {
    return this._http.get<any>('/api/products', this.getOptions(query)).pipe(
      map((res) => JSON.parse(res) as IPage<IProduct>),
      retry(3),
      catchError(this.handleError),
    );
  }

  // API-184 lọc theo giá (mẫu slide 6.7.2 /books/filter/price?min=&max=)
  filterByPrice(min: number, max: number): Observable<IProduct[]> {
    return this._http.get<any>('/api/products/filter/price', this.getOptions({ min, max })).pipe(
      map((res) => JSON.parse(res) as IProduct[]),
      retry(3),
      catchError(this.handleError),
    );
  }

  // API-27 gợi ý khi gõ ô tìm kiếm
  suggest(q: string): Observable<ISuggestion[]> {
    return this._http.get<any>('/api/products/suggest', this.getOptions({ q })).pipe(
      map((res) => JSON.parse(res) as ISuggestion[]),
      retry(3),
      catchError(this.handleError),
    );
  }

  // API-28 chi tiết theo slug
  getProduct(slug: string): Observable<IProductDetail> {
    return this._http.get<any>('/api/products/' + encodeURIComponent(slug), this.getOptions()).pipe(
      map((res) => JSON.parse(res) as IProductDetail),
      retry({ count: 3, delay: skipRetryOn404 }),
      catchError(this.handleError),
    );
  }

  // API-29 đánh giá của sản phẩm
  getReviews(productId: string, rating: number | null, page: number): Observable<IReviewPage> {
    return this._http.get<any>(`/api/products/${productId}/reviews`, this.getOptions({ rating, page })).pipe(
      map((res) => JSON.parse(res) as IReviewPage),
      retry(3),
      catchError(this.handleError),
    );
  }

  handleError(error: HttpErrorResponse) {
    return throwError(() => ApiError.from(error));
  }
}

// 404 là kết quả hợp lệ ("Không tìm thấy..."), không cần thử lại; lỗi khác thử lại ngay như retry(3).
export function skipRetryOn404(error: HttpErrorResponse) {
  return error.status === 404 ? throwError(() => error) : timer(0);
}
