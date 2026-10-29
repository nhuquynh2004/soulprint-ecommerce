import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, retry, throwError } from 'rxjs';
import { ApiError } from '../classes/api-error';
import { IRequestDetail, IRequestList, KIND_PATH, RequestKind } from '../classes/aftersales';

type Query = Record<string, string | number | undefined | null>;

// Yêu cầu hậu mãi phía quản trị (07 Mục 2.19 - S9): API-99 danh sách, API-196 chi tiết, API-100 đổi trả, API-101 bảo hành,
// API-102 hoàn tiền. Theo khuôn slide 6.7: GET có retry, PUT ghi dữ liệu không retry để không làm 2 lần.
@Injectable({ providedIn: 'root' })
export class AdminRequestApiService {
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

  // API-99
  getRequests(query: Query): Observable<IRequestList> {
    return this._http.get<any>('/api/admin/requests', this.textOptions(query)).pipe(
      map((res) => JSON.parse(res) as IRequestList),
      retry(2),
      catchError(this.handleError),
    );
  }

  // API-196
  getRequest(kind: RequestKind, id: string): Observable<IRequestDetail> {
    return this._http.get<any>(`/api/admin/requests/${KIND_PATH[kind]}/${encodeURIComponent(id)}`, this.textOptions()).pipe(
      map((res) => JSON.parse(res) as IRequestDetail),
      retry(2),
      catchError(this.handleError),
    );
  }

  // API-100, API-101, API-102: body theo thao tác; trả chi tiết mới
  update(kind: RequestKind, id: string, body: Record<string, unknown>): Observable<IRequestDetail> {
    return this._http.put<any>(`/api/admin/${KIND_PATH[kind]}/${encodeURIComponent(id)}`, JSON.stringify(body), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as IRequestDetail),
      catchError(this.handleError),
    );
  }

  handleError(error: HttpErrorResponse) {
    return throwError(() => ApiError.from(error));
  }
}
