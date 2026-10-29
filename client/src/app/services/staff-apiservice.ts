import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, retry, shareReplay, throwError } from 'rxjs';
import { IPermissionArea, IPermissionOverride, IRole, IStaff } from '../classes/user';
import { ApiError } from '../classes/api-error';

// Nhân viên, vai trò và quyền (API-134 đến 137, API-178 đến 183) - chỉ vai trò Quản trị.
// Vai trò có đủ 5 lệnh REST như slide Chương VI: GET danh sách, GET một, POST, PUT (_id trong body), DELETE.
@Injectable({ providedIn: 'root' })
export class StaffApiService {
  constructor(private _http: HttpClient) {}

  private permissions$?: Observable<IPermissionArea[]>;

  private textOptions(params?: Record<string, string>): Object {
    const headers = new HttpHeaders().set('Content-Type', 'text/plain;charset=utf-8');
    let httpParams = new HttpParams();
    for (const [k, v] of Object.entries(params || {})) if (v) httpParams = httpParams.set(k, v);
    return { headers: headers, responseType: 'text', withCredentials: true, params: httpParams };
  }

  private jsonOptions(): Object {
    const headers = new HttpHeaders().set('Content-Type', 'application/json;charset=utf-8');
    return { headers: headers, responseType: 'text', withCredentials: true };
  }

  // API-134
  getStaff(query: { q?: string; role?: string; status?: string } = {}): Observable<IStaff[]> {
    return this._http.get<any>('/api/admin/staff', this.textOptions(query as Record<string, string>)).pipe(
      map((res) => JSON.parse(res) as IStaff[]),
      retry(3),
      catchError(this.handleError),
    );
  }

  // API-135
  createStaff(data: { fullName: string; email: string; phone: string; staffRoles: string[]; permissionOverrides?: IPermissionOverride[] }): Observable<{ staff: IStaff; message: string; devLink?: string }> {
    return this._http.post<any>('/api/admin/staff', JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as { staff: IStaff; message: string; devLink?: string }),
      catchError(this.handleError),
    );
  }

  // API-136 sửa / khóa / mở khóa (_id trong body)
  updateStaff(data: object): Observable<{ staff: IStaff; removedOverrides: { permission: string; type: string }[] }> {
    return this._http.put<any>('/api/admin/staff', JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as { staff: IStaff; removedOverrides: { permission: string; type: string }[] }),
      catchError(this.handleError),
    );
  }

  // API-137
  resendActivation(id: string): Observable<{ message: string; devLink?: string }> {
    return this._http.post<any>(`/api/admin/staff/${id}/activation-link`, '', this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as { message: string; devLink?: string }),
      catchError(this.handleError),
    );
  }

  // API-178
  getRoles(): Observable<IRole[]> {
    return this._http.get<any>('/api/admin/roles', this.textOptions()).pipe(
      map((res) => JSON.parse(res) as IRole[]),
      retry(3),
      catchError(this.handleError),
    );
  }

  // API-179
  getRole(id: string): Observable<IRole> {
    return this._http.get<any>('/api/admin/roles/' + id, this.textOptions()).pipe(
      map((res) => JSON.parse(res) as IRole),
      retry(3),
      catchError(this.handleError),
    );
  }

  // API-180 tạo mới hoặc nhân bản ({fromRoleId})
  createRole(data: object): Observable<IRole> {
    return this._http.post<any>('/api/admin/roles', JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as IRole),
      catchError(this.handleError),
    );
  }

  // API-181 (_id trong body)
  updateRole(data: object): Observable<{ role: IRole; affectedStaff: { _id: string; fullName: string }[] }> {
    return this._http.put<any>('/api/admin/roles', JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as { role: IRole; affectedStaff: { _id: string; fullName: string }[] }),
      catchError(this.handleError),
    );
  }

  // API-182
  deleteRole(id: string, replacementRoleId?: string): Observable<void> {
    return this._http.delete<any>('/api/admin/roles/' + id, this.textOptions(replacementRoleId ? { replacementRoleId } : {})).pipe(
      map(() => undefined),
      catchError(this.handleError),
    );
  }

  // API-183 danh mục quyền (ít đổi: giữ lại trong lúc dùng trang)
  getPermissionCatalog(): Observable<IPermissionArea[]> {
    this.permissions$ ??= this._http.get<any>('/api/admin/permissions', this.textOptions()).pipe(
      map((res) => JSON.parse(res) as IPermissionArea[]),
      retry(3),
      catchError((err) => {
        this.permissions$ = undefined;
        return this.handleError(err);
      }),
      shareReplay(1),
    );
    return this.permissions$;
  }

  handleError(error: HttpErrorResponse) {
    return throwError(() => ApiError.from(error));
  }
}
