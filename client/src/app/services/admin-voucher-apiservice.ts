import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, retry, throwError } from 'rxjs';
import { ApiError } from '../classes/api-error';
import { IAdminVoucher, ICustomerBrief } from '../classes/checkout';
import { IBulkResult } from '../classes/admin-catalog';

// Quản trị voucher (07 Mục 2.13): đủ 5 lệnh CRUD theo slide 6.7 - GET danh sách, GET 1 voucher, POST, PUT (_id trong
// body), DELETE; thêm thao tác hàng loạt, nhân bản, xuất CSV, khớp tệp SĐT/email, tìm khách (API-98).
@Injectable({ providedIn: 'root' })
export class AdminVoucherApiService {
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

  // API-82 ?status, type, q, sort, page
  getVouchers(query: Record<string, string | number | undefined>): Observable<{ items: IAdminVoucher[]; page: number; pageSize: number; total: number; counts: Record<string, number> }> {
    return this._http.get<any>('/api/admin/vouchers', this.textOptions(query)).pipe(
      map((res) => JSON.parse(res)),
      retry(3),
      catchError(this.handleError),
    );
  }

  // API-83
  getVoucher(id: string): Observable<IAdminVoucher> {
    return this._http.get<any>('/api/admin/vouchers/' + id, this.textOptions()).pipe(
      map((res) => JSON.parse(res) as IAdminVoucher),
      retry(3),
      catchError(this.handleError),
    );
  }

  // API-84 (status BAN_NHAP: Lưu bản nháp)
  createVoucher(data: Partial<IAdminVoucher>): Observable<IAdminVoucher & { distributed: number }> {
    return this._http.post<any>('/api/admin/vouchers', JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res)),
      catchError(this.handleError),
    );
  }

  // API-85 sửa form, hoặc {_id, status} để tạm ngừng / kích hoạt lại
  updateVoucher(data: Partial<IAdminVoucher> & { _id: string }): Observable<IAdminVoucher & { distributed?: number }> {
    return this._http.put<any>('/api/admin/vouchers', JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res)),
      catchError(this.handleError),
    );
  }

  // API-86: 204 xóa thật, 200 {archived: true} chuyển lưu trữ
  deleteVoucher(id: string): Observable<{ archived: boolean }> {
    return this._http.delete<any>('/api/admin/vouchers/' + id, this.textOptions()).pipe(
      map((res) => (res ? JSON.parse(res) : { archived: false })),
      catchError(this.handleError),
    );
  }

  // API-87
  duplicateVoucher(id: string, code = ''): Observable<IAdminVoucher> {
    return this._http.post<any>(`/api/admin/vouchers/${id}/duplicate`, JSON.stringify({ code }), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as IAdminVoucher),
      catchError(this.handleError),
    );
  }

  // API-165 {action: PAUSE | ACTIVATE | DELETE, ids}
  bulkVouchers(data: { action: string; ids: string[] }): Observable<IBulkResult & { archived: string[] }> {
    return this._http.post<any>('/api/admin/vouchers/bulk', JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res)),
      catchError(this.handleError),
    );
  }

  // API-166 CSV lượt dùng (trả chuỗi CSV để tải về); range: khoảng ngày của Báo cáo tổng quan
  exportUsage(ids: string[], range: { from?: string; to?: string } = {}): Observable<string> {
    return this._http.get<any>('/api/admin/vouchers/usage-export', this.textOptions({ ids: ids.join(','), ...range })).pipe(catchError(this.handleError));
  }

  // API-190 khớp danh sách SĐT/email đọc từ tệp
  matchCustomers(contacts: string[]): Observable<{ matched: ICustomerBrief[]; unmatched: string[] }> {
    return this._http.post<any>('/api/admin/vouchers/match-customers', JSON.stringify({ contacts }), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res)),
      catchError(this.handleError),
    );
  }

  // API-98 ô tìm khách
  searchCustomers(q: string): Observable<ICustomerBrief[]> {
    return this._http.get<any>('/api/admin/customers', this.textOptions({ q, status: 'HOAT_DONG', pageSize: 10 })).pipe(
      map((res) => (JSON.parse(res) as { items: ICustomerBrief[] }).items),
      catchError(this.handleError),
    );
  }

  handleError(error: HttpErrorResponse) {
    return throwError(() => ApiError.from(error));
  }
}
