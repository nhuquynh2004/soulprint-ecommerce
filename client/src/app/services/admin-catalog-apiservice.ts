import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, retry, throwError } from 'rxjs';
import { ApiError } from '../classes/api-error';
import {
  IAdminCategory,
  IAdminProduct,
  IAdminProductList,
  IAdminTag,
  IAiGap,
  IAiGapList,
  IBulkResult,
  ISaveResult,
  ITagGroup,
} from '../classes/admin-catalog';

// Quản trị catalog (07_API_Spec.md Mục 2.13) - S3: sản phẩm, danh mục, tag và nhóm tag, tải ảnh.
// Mỗi nhóm có đủ 5 lệnh REST như slide Chương VI: GET danh sách, GET một, POST, PUT (_id trong body), DELETE.
@Injectable({ providedIn: 'root' })
export class AdminCatalogApiService {
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

  // ===== Sản phẩm =====

  // API-65 ?q, category, axis, status, stockStatus, tag, sort, page
  getProducts(query: Record<string, string | number | undefined>): Observable<IAdminProductList> {
    return this._http.get<any>('/api/admin/products', this.textOptions(query)).pipe(
      map((res) => JSON.parse(res) as IAdminProductList),
      retry(3),
      catchError(this.handleError),
    );
  }

  // API-214 SKU kế tiếp theo trục, danh mục, BST chọn tay (BR-46)
  nextSku(query: { axis: string; categoryId: string; collectionId?: string }): Observable<{ sku: string; prefix: string; next: number }> {
    return this._http.get<any>('/api/admin/products/next-sku', this.textOptions(query)).pipe(
      map((res) => JSON.parse(res) as { sku: string; prefix: string; next: number }),
      catchError(this.handleError),
    );
  }

  // API-66
  getProduct(id: string): Observable<IAdminProduct> {
    return this._http.get<any>('/api/admin/products/' + id, this.textOptions()).pipe(
      map((res) => JSON.parse(res) as IAdminProduct),
      retry(3),
      catchError(this.handleError),
    );
  }

  // API-67
  createProduct(data: Partial<IAdminProduct>): Observable<ISaveResult<IAdminProduct>> {
    return this._http.post<any>('/api/admin/products', JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as ISaveResult<IAdminProduct>),
      catchError(this.handleError),
    );
  }

  // API-68 (_id trong body); gửi một phần, VD {_id, status} để Ẩn/Hiển thị lại/Ngừng bán
  updateProduct(data: Partial<IAdminProduct> & { _id: string }): Observable<ISaveResult<IAdminProduct>> {
    return this._http.put<any>('/api/admin/products', JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as ISaveResult<IAdminProduct>),
      catchError(this.handleError),
    );
  }

  // API-69
  deleteProduct(id: string): Observable<void> {
    return this._http.delete<any>('/api/admin/products/' + id, this.textOptions()).pipe(
      map(() => undefined),
      catchError(this.handleError),
    );
  }

  // API-163
  duplicateProduct(id: string): Observable<ISaveResult<IAdminProduct>> {
    return this._http.post<any>(`/api/admin/products/${id}/duplicate`, '', this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as ISaveResult<IAdminProduct>),
      catchError(this.handleError),
    );
  }

  // API-161 {action: SHOW|HIDE|ARCHIVE|DELETE, ids[]} hoặc {action: UPDATE_STOCK, items[]}
  bulkProducts(data: { action: string; ids?: string[]; items?: { variantSku: string; stock: number; lowStockThreshold?: number }[] }): Observable<IBulkResult> {
    return this._http.post<any>('/api/admin/products/bulk', JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as IBulkResult),
      catchError(this.handleError),
    );
  }

  // API-162 - đường dẫn tải CSV (mở bằng thẻ a, cookie phiên đi kèm)
  exportUrl(ids: string[] = []): string {
    return '/api/admin/products/export' + (ids.length ? '?ids=' + ids.join(',') : '');
  }

  // API-79
  bulkTags(data: { productIds: string[]; addTagIds: string[]; removeTagIds: string[] }): Observable<{ updated: number; failed: { id: string; reason: string }[] }> {
    return this._http.put<any>('/api/admin/products/bulk-tags', JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as { updated: number; failed: { id: string; reason: string }[] }),
      catchError(this.handleError),
    );
  }

  // ===== Tải ảnh base64 =====

  // API-70 - tối đa 10 ảnh mỗi lần
  upload(files: { name: string; dataUrl: string }[]): Observable<{ fileId: string; url: string }[]> {
    return this._http.post<any>('/api/admin/uploads', JSON.stringify({ files }), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as { fileId: string; url: string }[]),
      catchError(this.handleError),
    );
  }

  // ===== Danh mục =====

  // API-71 cây danh mục
  getCategories(): Observable<IAdminCategory[]> {
    return this._http.get<any>('/api/admin/categories', this.textOptions()).pipe(
      map((res) => JSON.parse(res) as IAdminCategory[]),
      retry(3),
      catchError(this.handleError),
    );
  }

  // API-72
  createCategory(data: Partial<IAdminCategory>): Observable<IAdminCategory> {
    return this._http.post<any>('/api/admin/categories', JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as IAdminCategory),
      catchError(this.handleError),
    );
  }

  // API-73 (_id trong body); dùng cả cho kéo thả thứ tự {_id, sortOrder}
  updateCategory(data: Partial<IAdminCategory> & { _id: string }): Observable<IAdminCategory> {
    return this._http.put<any>('/api/admin/categories', JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as IAdminCategory),
      catchError(this.handleError),
    );
  }

  // API-74
  deleteCategory(id: string): Observable<void> {
    return this._http.delete<any>('/api/admin/categories/' + id, this.textOptions()).pipe(
      map(() => undefined),
      catchError(this.handleError),
    );
  }

  // API-164 {action: SHOW|HIDE|DELETE, ids[]}
  bulkCategories(data: { action: string; ids: string[] }): Observable<IBulkResult> {
    return this._http.post<any>('/api/admin/categories/bulk', JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as IBulkResult),
      catchError(this.handleError),
    );
  }

  // ===== Tag và nhóm tag =====

  // API-186
  getTagGroups(): Observable<ITagGroup[]> {
    return this._http.get<any>('/api/admin/tag-groups', this.textOptions()).pipe(
      map((res) => JSON.parse(res) as ITagGroup[]),
      retry(3),
      catchError(this.handleError),
    );
  }

  // API-187
  createTagGroup(data: Partial<ITagGroup>): Observable<ITagGroup> {
    return this._http.post<any>('/api/admin/tag-groups', JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as ITagGroup),
      catchError(this.handleError),
    );
  }

  // API-188 (code trong body)
  updateTagGroup(data: Partial<ITagGroup> & { code: string }): Observable<ITagGroup> {
    return this._http.put<any>('/api/admin/tag-groups', JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as ITagGroup),
      catchError(this.handleError),
    );
  }

  // API-189
  deleteTagGroup(code: string): Observable<void> {
    return this._http.delete<any>('/api/admin/tag-groups/' + code, this.textOptions()).pipe(
      map(() => undefined),
      catchError(this.handleError),
    );
  }

  // API-75 ?group
  getTags(group?: string): Observable<IAdminTag[]> {
    return this._http.get<any>('/api/admin/tags', this.textOptions({ group })).pipe(
      map((res) => JSON.parse(res) as IAdminTag[]),
      retry(3),
      catchError(this.handleError),
    );
  }

  // API-76
  createTag(data: Partial<IAdminTag>): Observable<IAdminTag> {
    return this._http.post<any>('/api/admin/tags', JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as IAdminTag),
      catchError(this.handleError),
    );
  }

  // API-77 (_id trong body)
  updateTag(data: Partial<IAdminTag> & { _id: string }): Observable<IAdminTag> {
    return this._http.put<any>('/api/admin/tags', JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as IAdminTag),
      catchError(this.handleError),
    );
  }

  // API-78
  deleteTag(id: string): Observable<void> {
    return this._http.delete<any>('/api/admin/tags/' + id, this.textOptions()).pipe(
      map(() => undefined),
      catchError(this.handleError),
    );
  }

  // API-80 ?status, q - counts đếm trên toàn bộ dữ liệu
  getAiGaps(query: { status?: string; q?: string } = {}): Observable<IAiGapList> {
    return this._http.get<any>('/api/admin/ai/gaps', this.textOptions(query)).pipe(
      map((res) => JSON.parse(res) as IAiGapList),
      retry(3),
      catchError(this.handleError),
    );
  }

  // API-81
  resolveAiGap(id: string): Observable<IAiGap> {
    return this._http.put<any>('/api/admin/ai/gaps/' + id, JSON.stringify({ status: 'DA_XU_LY' }), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as IAiGap),
      catchError(this.handleError),
    );
  }

  handleError(error: HttpErrorResponse) {
    return throwError(() => ApiError.from(error));
  }
}
