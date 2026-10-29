import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Observable, catchError, map, retry, throwError } from 'rxjs';
import { IAddress, ISavedRefundAccount, IUser } from '../classes/user';
import { ApiError } from '../classes/api-error';

// Tài khoản và sổ địa chỉ (API-07 đến API-12), tài khoản nhận tiền hoàn (API-226 đến API-228) - đủ GET, POST, PUT (_id trong body), DELETE theo slide 6.7.
// Chỉ GET có retry(3); POST, PUT, DELETE không retry để không tạo trùng địa chỉ.
@Injectable({ providedIn: 'root' })
export class AccountApiService {
  constructor(private _http: HttpClient) {}

  private textOptions(): Object {
    const headers = new HttpHeaders().set('Content-Type', 'text/plain;charset=utf-8');
    return { headers: headers, responseType: 'text', withCredentials: true };
  }

  private jsonOptions(): Object {
    const headers = new HttpHeaders().set('Content-Type', 'application/json;charset=utf-8');
    return { headers: headers, responseType: 'text', withCredentials: true };
  }

  // API-07
  updateProfile(data: object): Observable<IUser> {
    return this._http.put<any>('/api/account/profile', JSON.stringify(data), this.jsonOptions()).pipe(
      map((res) => (JSON.parse(res) as { user: IUser }).user),
      catchError(this.handleError),
    );
  }

  // API-08
  changePassword(data: object): Observable<void> {
    return this._http.put<any>('/api/account/password', JSON.stringify(data), this.jsonOptions()).pipe(
      map(() => undefined),
      catchError(this.handleError),
    );
  }

  // API-09
  getAddresses(): Observable<IAddress[]> {
    return this._http.get<any>('/api/account/addresses', this.textOptions()).pipe(
      map((res) => JSON.parse(res) as IAddress[]),
      retry(3),
      catchError(this.handleError),
    );
  }

  // API-10
  addAddress(address: Omit<IAddress, '_id'>): Observable<IAddress> {
    return this._http.post<any>('/api/account/addresses', JSON.stringify(address), this.jsonOptions()).pipe(
      map((res) => (JSON.parse(res) as { address: IAddress }).address),
      catchError(this.handleError),
    );
  }

  // API-11 PUT sửa cả tài nguyên, _id trong body (slide 6.7.4)
  updateAddress(address: IAddress): Observable<IAddress> {
    return this._http.put<any>('/api/account/addresses', JSON.stringify(address), this.jsonOptions()).pipe(
      map((res) => (JSON.parse(res) as { address: IAddress }).address),
      catchError(this.handleError),
    );
  }

  // API-12
  deleteAddress(id: string): Observable<void> {
    return this._http.delete<any>('/api/account/addresses/' + id, this.textOptions()).pipe(
      map(() => undefined),
      catchError(this.handleError),
    );
  }

  // API-226 tài khoản nhận tiền hoàn đã lưu, che số
  getRefundAccount(): Observable<ISavedRefundAccount | null> {
    return this._http.get<any>('/api/account/refund-account', this.textOptions()).pipe(
      map((res) => (JSON.parse(res) as { account: ISavedRefundAccount | null }).account),
      retry(3),
      catchError(this.handleError),
    );
  }

  // API-227 tài khoản là tài nguyên duy nhất của Member nên không có _id
  saveRefundAccount(account: { bankName: string; accountNumber: string; accountName: string }): Observable<ISavedRefundAccount> {
    return this._http.put<any>('/api/account/refund-account', JSON.stringify(account), this.jsonOptions()).pipe(
      map((res) => (JSON.parse(res) as { account: ISavedRefundAccount }).account),
      catchError(this.handleError),
    );
  }

  // API-228
  deleteRefundAccount(): Observable<void> {
    return this._http.delete<any>('/api/account/refund-account', this.textOptions()).pipe(
      map(() => undefined),
      catchError(this.handleError),
    );
  }

  handleError(error: HttpErrorResponse) {
    return throwError(() => ApiError.from(error));
  }
}
