import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, retry, throwError } from 'rxjs';
import { ApiError } from '../classes/api-error';
import { IProduct } from '../classes/product';
import {
  IAdminCollection,
  IAdminHome,
  IBanner,
  IBulkResult,
  ICollectionRule,
  IFaq,
  IHomeSection,
  IPickedProduct,
  IPolicyItem,
  IStoreSettings,
} from '../classes/admin-catalog';

// Bộ sưu tập, trang chủ, banner (07 Mục 2.14) và Cài đặt cửa hàng, chính sách, FAQ (Mục 2.16) - S3.
@Injectable({ providedIn: 'root' })
export class AdminStoreApiService {
  constructor(private _http: HttpClient) {}

  private textOptions(params?: Record<string, string | number | undefined | null>): Object {
    const headers = new HttpHeaders().set('Content-Type', 'text/plain;charset=utf-8');
    let httpParams = new HttpParams();
    for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') httpParams = httpParams.set(k, String(v));
    return { headers: headers, responseType: 'text', withCredentials: true, params: httpParams };
  }

  private jsonOptions(): Object {
    const headers = new HttpHeaders().set('Content-Type', 'application/json;charset=utf-8');
    return { headers: headers, responseType: 'text', withCredentials: true };
  }

  // ===== Bộ sưu tập =====

  // API-109 ?status, type, showOnHome, q, sort, page
  getCollections(query: Record<string, string | number | undefined>): Observable<{ items: IAdminCollection[]; page: number; pageSize: number; total: number; counts: Record<string, number> }> {
    return this._http.get<any>('/api/admin/collections', this.textOptions(query)).pipe(
      map((res) => JSON.parse(res)),
      retry(3),
      catchError(this.handleError),
    );
  }

  // API-109 (một BST, mở form sửa)
  getCollection(id: string): Observable<IAdminCollection> {
    return this._http.get<any>('/api/admin/collections/' + id, this.textOptions()).pipe(
      map((res) => JSON.parse(res) as IAdminCollection),
      retry(3),
      catchError(this.handleError),
    );
  }

  // API-110
  createCollection(data: Partial<IAdminCollection>): Observable<IAdminCollection> {
    return this._http.post<any>('/api/admin/collections', JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as IAdminCollection),
      catchError(this.handleError),
    );
  }

  // API-111 (_id trong body)
  updateCollection(data: Partial<IAdminCollection> & { _id: string }): Observable<IAdminCollection> {
    return this._http.put<any>('/api/admin/collections', JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as IAdminCollection),
      catchError(this.handleError),
    );
  }

  // API-112
  deleteCollection(id: string): Observable<void> {
    return this._http.delete<any>('/api/admin/collections/' + id, this.textOptions()).pipe(
      map(() => undefined),
      catchError(this.handleError),
    );
  }

  // API-167 {action: SHOW|HIDE|ADD_TO_HOME|REMOVE_FROM_HOME|DELETE, ids[]}
  bulkCollections(data: { action: string; ids: string[] }): Observable<IBulkResult> {
    return this._http.post<any>('/api/admin/collections/bulk', JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as IBulkResult),
      catchError(this.handleError),
    );
  }

  // API-168
  duplicateCollection(id: string): Observable<IAdminCollection> {
    return this._http.post<any>(`/api/admin/collections/${id}/duplicate`, '', this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as IAdminCollection),
      catchError(this.handleError),
    );
  }

  // API-169 xem trước BST tự động
  previewRules(data: { rules: ICollectionRule[]; matchMode: string; sortBy: string }): Observable<{ count: number; items: IProduct[] }> {
    return this._http.post<any>('/api/admin/collections/rules-preview', JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as { count: number; items: IProduct[] }),
      catchError(this.handleError),
    );
  }

  // ===== Trang chủ và banner =====

  // API-113
  getHome(): Observable<IAdminHome> {
    return this._http.get<any>('/api/admin/home', this.textOptions()).pipe(
      map((res) => JSON.parse(res) as IAdminHome),
      retry(3),
      catchError(this.handleError),
    );
  }

  // API-114 lưu bản nháp
  saveHomeDraft(data: { sections: IHomeSection[]; featured?: { productId: string; order: number }[] }): Observable<{ draft: { sections: IHomeSection[] }; hasUnpublishedChanges: boolean; featured: IPickedProduct[] }> {
    return this._http.put<any>('/api/admin/home', JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res)),
      catchError(this.handleError),
    );
  }

  // API-170
  publishHome(): Observable<{ publishedAt: string; hasUnpublishedChanges: boolean }> {
    return this._http.post<any>('/api/admin/home/publish', '', this.jsonOptions()).pipe(
      map((res) => JSON.parse(res)),
      catchError(this.handleError),
    );
  }

  // API-115
  createBanner(data: Partial<IBanner>): Observable<IBanner> {
    return this._http.post<any>('/api/admin/banners', JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as IBanner),
      catchError(this.handleError),
    );
  }

  // API-116 (_id trong body)
  updateBanner(data: Partial<IBanner> & { _id: string }): Observable<IBanner> {
    return this._http.put<any>('/api/admin/banners', JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as IBanner),
      catchError(this.handleError),
    );
  }

  // API-117
  deleteBanner(id: string): Observable<void> {
    return this._http.delete<any>('/api/admin/banners/' + id, this.textOptions()).pipe(
      map(() => undefined),
      catchError(this.handleError),
    );
  }

  // ===== Cài đặt cửa hàng =====

  // API-144
  getSettings(): Observable<IStoreSettings> {
    return this._http.get<any>('/api/admin/settings', this.textOptions()).pipe(
      map((res) => JSON.parse(res) as IStoreSettings),
      retry(3),
      catchError(this.handleError),
    );
  }

  // API-145 gửi phần nào sửa phần đó
  updateSettings(data: Partial<IStoreSettings>): Observable<IStoreSettings> {
    return this._http.put<any>('/api/admin/settings', JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as IStoreSettings),
      catchError(this.handleError),
    );
  }

  // Danh sách trang chính sách (kèm API-147)
  getPolicies(): Observable<IPolicyItem[]> {
    return this._http.get<any>('/api/admin/policies', this.textOptions()).pipe(
      map((res) => JSON.parse(res) as IPolicyItem[]),
      retry(3),
      catchError(this.handleError),
    );
  }

  // API-146 ?raw=true (bản có biến) hoặc bản đã thay biến để xem trước
  getPolicy(slug: string, raw: boolean): Observable<{ slug: string; title: string; content: string; updatedAt?: string }> {
    return this._http.get<any>('/api/policies/' + slug, this.textOptions(raw ? { raw: 'true' } : {})).pipe(
      map((res) => JSON.parse(res)),
      retry(3),
      catchError(this.handleError),
    );
  }

  // API-147 (slug trong body)
  updatePolicy(data: { slug: string; title: string; content: string }): Observable<{ slug: string; title: string; content: string; updatedAt: string }> {
    return this._http.put<any>('/api/admin/policies', JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res)),
      catchError(this.handleError),
    );
  }

  // API-148 ?category, q
  getFaqs(query: { category?: string; q?: string } = {}): Observable<IFaq[]> {
    return this._http.get<any>('/api/admin/faqs', this.textOptions(query)).pipe(
      map((res) => JSON.parse(res) as IFaq[]),
      retry(3),
      catchError(this.handleError),
    );
  }

  // API-149
  createFaq(data: Partial<IFaq>): Observable<IFaq> {
    return this._http.post<any>('/api/admin/faqs', JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as IFaq),
      catchError(this.handleError),
    );
  }

  // API-150 (_id trong body)
  updateFaq(data: Partial<IFaq> & { _id: string }): Observable<IFaq> {
    return this._http.put<any>('/api/admin/faqs', JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as IFaq),
      catchError(this.handleError),
    );
  }

  // API-151
  deleteFaq(id: string): Observable<void> {
    return this._http.delete<any>('/api/admin/faqs/' + id, this.textOptions()).pipe(
      map(() => undefined),
      catchError(this.handleError),
    );
  }

  handleError(error: HttpErrorResponse) {
    return throwError(() => ApiError.from(error));
  }
}
