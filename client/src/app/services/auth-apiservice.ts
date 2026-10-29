import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Observable, catchError, map, retry, throwError } from 'rxjs';
import { IUser, ISession } from '../classes/user';
import { ApiError } from '../classes/api-error';

// Gọi API xác thực (07_API_Spec.md Mục 2.1, 2.11) theo khuôn service slide 6.7.
// POST, DELETE không retry để không đăng nhập/gửi mã 2 lần. withCredentials để gửi kèm cookie phiên sid (Chương VIII).
@Injectable({ providedIn: 'root' })
export class AuthApiService {
  constructor(private _http: HttpClient) {}

  private textOptions(): Object {
    const headers = new HttpHeaders().set('Content-Type', 'text/plain;charset=utf-8');
    return { headers: headers, responseType: 'text', withCredentials: true };
  }

  private jsonOptions(): Object {
    const headers = new HttpHeaders().set('Content-Type', 'application/json;charset=utf-8');
    return { headers: headers, responseType: 'text', withCredentials: true };
  }

  private parse<T>(res: string): T {
    return (res ? JSON.parse(res) : null) as T;
  }

  // API-01
  register(data: object): Observable<{ user: IUser; welcomeVoucher: string | null; cartCount: number }> {
    return this._http.post<any>('/api/auth/register', JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => this.parse<{ user: IUser; welcomeVoucher: string | null; cartCount: number }>(res)),
      catchError(this.handleError),
    );
  }

  // API-02 khách đăng nhập
  login(login: string, password: string, rememberMe: boolean): Observable<{ user: IUser; cartCount: number }> {
    return this._http.post<any>('/api/auth/login', JSON.stringify({ login, password, rememberMe }), this.jsonOptions()).pipe(
      map((res) => this.parse<{ user: IUser; cartCount: number }>(res)),
      catchError(this.handleError),
    );
  }

  // API-131 nhân viên đăng nhập
  staffLogin(login: string, password: string, rememberMe: boolean): Observable<{ user: IUser; landing: string }> {
    return this._http.post<any>('/api/admin/auth/login', JSON.stringify({ login, password, rememberMe }), this.jsonOptions()).pipe(
      map((res) => this.parse<{ user: IUser; landing: string }>(res)),
      catchError(this.handleError),
    );
  }

  // API-03 (khách), API-212 (nhân viên)
  logout(staff = false): Observable<void> {
    return this._http.post<any>(staff ? '/api/admin/auth/logout' : '/api/auth/logout', '', this.jsonOptions()).pipe(
      map(() => undefined),
      catchError(this.handleError),
    );
  }

  // API-04 (cửa hàng), API-213 (khu quản trị)
  me(staff = false): Observable<IUser | null> {
    return this._http.get<any>(staff ? '/api/admin/auth/me' : '/api/auth/me', this.textOptions()).pipe(
      map((res) => this.parse<{ user: IUser | null }>(res).user),
      retry(3),
      catchError(this.handleError),
    );
  }

  // API-05 gửi mã xác minh quên mật khẩu
  forgotPassword(login: string): Observable<{ message: string; maskedTarget: string; resendAfter: number; devCode?: string }> {
    return this._http.post<any>('/api/auth/forgot-password', JSON.stringify({ login }), this.jsonOptions()).pipe(
      map((res) => this.parse<{ message: string; maskedTarget: string; resendAfter: number; devCode?: string }>(res)),
      catchError(this.handleError),
    );
  }

  // API-185 xác minh mã
  verifyResetCode(login: string, code: string): Observable<{ resetToken: string }> {
    return this._http.post<any>('/api/auth/verify-reset-code', JSON.stringify({ login, code }), this.jsonOptions()).pipe(
      map((res) => this.parse<{ resetToken: string }>(res)),
      catchError(this.handleError),
    );
  }

  // API-06 (GET) thông tin chỉ đọc của SCR-14
  setPasswordInfo(token: string): Observable<{ purpose: string; fullName: string; phone: string; role: string }> {
    return this._http.get<any>('/api/auth/set-password/' + encodeURIComponent(token), this.textOptions()).pipe(
      map((res) => this.parse<{ purpose: string; fullName: string; phone: string; role: string }>(res)),
      catchError(this.handleError),
    );
  }

  // API-06 (POST) đặt mật khẩu: đặt lại hoặc kích hoạt
  setPassword(data: object): Observable<{ purpose: string; role: string; fullName: string; loggedIn: boolean }> {
    return this._http.post<any>('/api/auth/set-password', JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => this.parse<{ purpose: string; role: string; fullName: string; loggedIn: boolean }>(res)),
      catchError(this.handleError),
    );
  }

  // API-132 phiên đăng nhập của nhân viên
  getSessions(): Observable<ISession[]> {
    return this._http.get<any>('/api/admin/auth/sessions', this.textOptions()).pipe(
      map((res) => this.parse<ISession[]>(res)),
      retry(3),
      catchError(this.handleError),
    );
  }

  // API-133 đăng xuất 1 thiết bị hoặc "others"
  deleteSession(id: string): Observable<void> {
    return this._http.delete<any>('/api/admin/auth/sessions/' + encodeURIComponent(id), this.textOptions()).pipe(
      map(() => undefined),
      catchError(this.handleError),
    );
  }

  handleError(error: HttpErrorResponse) {
    return throwError(() => ApiError.from(error));
  }
}
