import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, retry, shareReplay, throwError } from 'rxjs';
import { ICategory, ICollectionPage, IOpenCollection, IHomeSection, IPolicy, IStoreSettings, ITagGroup } from '../classes/catalog';
import { ApiError } from '../classes/api-error';
import { skipRetryOn404 } from './product-apiservice';

type Query = Record<string, string | number | null | undefined>;

// Trang chủ, danh mục, tag, bộ sưu tập, chính sách, cài đặt công khai (API-23, 24, 25, 108, 143, 146).
// Cùng khuôn service của slide 6.7 như ProductApiService.
@Injectable({ providedIn: 'root' })
export class CatalogApiService {
  constructor(private _http: HttpClient) {}

  // Danh mục và tag ít đổi: giữ kết quả trong lúc dùng trang để header, thanh lọc, trang 404 chỉ gọi 1 lần.
  private collections$?: Observable<IOpenCollection[]>;
  private categories$?: Observable<ICategory[]>;
  private tags$?: Observable<ITagGroup[]>;

  private getOptions(params?: Query): Object {
    const headers = new HttpHeaders().set('Content-Type', 'text/plain;charset=utf-8');
    let httpParams = new HttpParams();
    for (const [key, value] of Object.entries(params || {})) {
      if (value !== null && value !== undefined && value !== '') httpParams = httpParams.set(key, String(value));
    }
    return { headers: headers, responseType: 'text', withCredentials: true, params: httpParams };
  }

  // API-23; preview = true khi khung xem trước của trình chỉnh sửa trang chủ mở /?preview=draft (chỉ phiên nhân viên)
  getHome(preview = false): Observable<IHomeSection[]> {
    return this._http.get<any>('/api/home', this.getOptions(preview ? { preview: 'draft' } : {})).pipe(
      map((res) => (JSON.parse(res) as { sections: IHomeSection[] }).sections),
      retry(3),
      catchError(this.handleError),
    );
  }

  // API-207 BST đang mở (menu xổ Bộ sưu tập) - dùng chung 1 lần tải cho Header
  getOpenCollections(): Observable<IOpenCollection[]> {
    this.collections$ ??= this._http.get<any>('/api/collections', this.getOptions()).pipe(
      map((res) => JSON.parse(res) as IOpenCollection[]),
      retry(2),
      catchError((err) => {
        this.collections$ = undefined;
        return this.handleError(err);
      }),
      shareReplay(1),
    );
    return this.collections$;
  }

  // API-24
  getCategories(): Observable<ICategory[]> {
    this.categories$ ??= this._http.get<any>('/api/categories', this.getOptions()).pipe(
      map((res) => JSON.parse(res) as ICategory[]),
      retry(3),
      catchError((err) => {
        this.categories$ = undefined; // lỗi thì lần sau gọi lại
        return this.handleError(err);
      }),
      shareReplay(1),
    );
    return this.categories$;
  }

  // API-25 đủ nhóm kèm isFilter: thanh lọc tự ẩn nhóm, tag tắt; dòng "Đang lọc" vẫn có tên tag của nhóm tắt
  getFilterTags(): Observable<ITagGroup[]> {
    this.tags$ ??= this._http.get<any>('/api/tags', this.getOptions({})).pipe(
      map((res) => JSON.parse(res) as ITagGroup[]),
      retry(3),
      catchError((err) => {
        this.tags$ = undefined;
        return this.handleError(err);
      }),
      shareReplay(1),
    );
    return this.tags$;
  }

  // API-25 đủ mọi tag (form Tư vấn quà AI SCR-10 lấy lựa chọn từ nhóm tag, kể cả tag không hiện trên thanh lọc)
  getAllTags(): Observable<ITagGroup[]> {
    return this._http.get<any>('/api/tags', this.getOptions()).pipe(
      map((res) => JSON.parse(res) as ITagGroup[]),
      retry(3),
      catchError(this.handleError),
    );
  }

  // API-108 bộ sưu tập kèm sản phẩm đã lọc
  getCollection(slug: string, query: Query): Observable<ICollectionPage> {
    return this._http.get<any>('/api/collections/' + encodeURIComponent(slug), this.getOptions(query)).pipe(
      map((res) => JSON.parse(res) as ICollectionPage),
      retry({ count: 3, delay: skipRetryOn404 }),
      catchError(this.handleError),
    );
  }

  // API-143
  getPublicSettings(): Observable<IStoreSettings> {
    return this._http.get<any>('/api/settings/public', this.getOptions()).pipe(
      map((res) => JSON.parse(res) as IStoreSettings),
      retry(3),
      catchError(this.handleError),
    );
  }

  // API-146
  getPolicy(slug: string): Observable<IPolicy> {
    return this._http.get<any>('/api/policies/' + encodeURIComponent(slug), this.getOptions()).pipe(
      map((res) => JSON.parse(res) as IPolicy),
      retry({ count: 3, delay: skipRetryOn404 }),
      catchError(this.handleError),
    );
  }

  handleError(error: HttpErrorResponse) {
    return throwError(() => ApiError.from(error));
  }
}
