import { Injectable, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Observable, catchError, map, of, retry, shareReplay, switchMap, throwError, timeout } from 'rxjs';
import { IProvince, IWard } from '../classes/user';
import { ApiError } from '../classes/api-error';

// Gọi External API địa giới hành chính 2 cấp (slide 6.3, 07_API_Spec.md Mục 1.6).
// Đường dẫn /dvhc đi qua proxy (dev: proxy.conf.json, production: vercel.json) tới provinces.open-api.vn/api/v2.
// API ngoài lỗi hoặc quá 5 giây thì đọc tệp dự phòng /data/dvhc.json do server phục vụ.
@Injectable({ providedIn: 'root' })
export class DvhcApiService {
  constructor(private _http: HttpClient) {}

  readonly usingFallback = signal(false);
  private provinces$?: Observable<IProvince[]>;
  private fallback$?: Observable<IProvince[]>;

  private getOptions(): Object {
    const headers = new HttpHeaders().set('Content-Type', 'text/plain;charset=utf-8');
    return { headers: headers, responseType: 'text' };
  }

  private getFallback(): Observable<IProvince[]> {
    this.fallback$ ??= this._http.get<any>('/data/dvhc.json', this.getOptions()).pipe(
      map((res) => JSON.parse(res) as IProvince[]),
      retry(3),
      catchError(this.handleError),
      shareReplay(1),
    );
    this.usingFallback.set(true);
    return this.fallback$;
  }

  // 34 tỉnh/thành
  getProvinces(): Observable<IProvince[]> {
    this.provinces$ ??= this._http.get<any>('/dvhc/p/', this.getOptions()).pipe(
      timeout(5000),
      map((res) => (JSON.parse(res) as IProvince[]).map(({ code, name }) => ({ code, name }))),
      retry(3),
      catchError(() => this.getFallback().pipe(map((list) => list.map(({ code, name }) => ({ code, name }))))),
      shareReplay(1),
    );
    return this.provinces$;
  }

  // Phường/xã của 1 tỉnh (?depth=2)
  getWards(provinceCode: number): Observable<IWard[]> {
    if (this.usingFallback()) return this.fallbackWards(provinceCode);
    return this._http.get<any>(`/dvhc/p/${provinceCode}?depth=2`, this.getOptions()).pipe(
      timeout(5000),
      map((res) => ((JSON.parse(res) as IProvince).wards || []).map(({ code, name }) => ({ code, name }))),
      retry(3),
      catchError(() => this.fallbackWards(provinceCode)),
    );
  }

  private fallbackWards(provinceCode: number): Observable<IWard[]> {
    return this.getFallback().pipe(switchMap((list) => of(list.find((p) => p.code === provinceCode)?.wards || [])));
  }

  handleError(error: HttpErrorResponse) {
    return throwError(() => ApiError.from(error));
  }
}
