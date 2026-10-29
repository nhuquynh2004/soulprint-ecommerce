import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, throwError } from 'rxjs';
import { ApiError } from '../classes/api-error';
import { ExportDataset, IOverview, IReportQuery, IReportSections } from '../classes/report';

// Báo cáo tổng quan SCR-40 (07 - S12, UC-CAT-03): API-88 số liệu theo khối, API-89 tệp CSV.
@Injectable({ providedIn: 'root' })
export class ReportApiService {
  constructor(private _http: HttpClient) {}

  private options(query: Record<string, string | undefined>): Object {
    const headers = new HttpHeaders().set('Content-Type', 'text/plain;charset=utf-8');
    let params = new HttpParams();
    for (const [k, v] of Object.entries(query)) if (v) params = params.set(k, v);
    return { headers: headers, responseType: 'text', withCredentials: true, params: params };
  }

  // API-88 section=overview: chỉ số, biểu đồ, trạng thái, bán chạy, trục, danh mục, Gợi ý hành động, Thiết lập cửa hàng
  getOverview(q: IReportQuery): Observable<IOverview> {
    return this._http.get<any>('/api/admin/reports', this.options({ ...q, section: 'overview' })).pipe(
      map((res) => JSON.parse(res) as IOverview),
      catchError(this.handleError),
    );
  }

  // API-88 các nhóm bên dưới: customers, vouchers, reviews, personalization, ai
  getSection<K extends keyof IReportSections>(section: K, q: IReportQuery): Observable<IReportSections[K]> {
    return this._http.get<any>('/api/admin/reports', this.options({ ...q, section })).pipe(
      map((res) => (JSON.parse(res) as IReportSections)[section]),
      catchError(this.handleError),
    );
  }

  // API-89: nội dung tệp CSV (có BOM UTF-8)
  exportCsv(dataset: ExportDataset, q: IReportQuery & { kind?: string }): Observable<string> {
    return this._http.get<any>('/api/admin/reports/export', this.options({ ...q, dataset })).pipe(catchError(this.handleError));
  }

  handleError(error: HttpErrorResponse) {
    return throwError(() => ApiError.from(error));
  }
}
