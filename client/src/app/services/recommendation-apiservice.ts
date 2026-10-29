import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Observable, catchError, map, throwError } from 'rxjs';
import { ApiError } from '../classes/api-error';
import { IAiQuota, IRecommendInput, IRecommendation } from '../classes/recommendation';

// Tư vấn quà AI SCR-10 (07 Mục 2.4, UC-DIS-05): API-59 gợi ý / tinh chỉnh, API-198 lượt thử còn lại.
@Injectable({ providedIn: 'root' })
export class RecommendationApiService {
  constructor(private _http: HttpClient) {}

  private options(): Object {
    const headers = new HttpHeaders().set('Content-Type', 'application/json;charset=utf-8');
    return { headers: headers, responseType: 'text', withCredentials: true };
  }

  // API-198
  getQuota(): Observable<IAiQuota> {
    return this._http.get<any>('/api/recommendations/quota', this.options()).pipe(
      map((res) => JSON.parse(res) as IAiQuota),
      catchError(this.handleError),
    );
  }

  // API-59 lượt mới: khảo sát
  recommend(input: IRecommendInput): Observable<IRecommendation> {
    return this.post(input);
  }

  // API-59 tinh chỉnh (8a, 8c): cùng sessionId, kèm câu tinh chỉnh và/hoặc tiêu chí mới; không trừ lượt
  refine(sessionId: string, refineText: string | null, input?: IRecommendInput): Observable<IRecommendation> {
    return this.post({ sessionId, ...(refineText ? { refineText } : {}), ...(input || {}) });
  }

  private post(body: object): Observable<IRecommendation> {
    return this._http.post<any>('/api/recommendations', JSON.stringify(body), this.options()).pipe(
      map((res) => JSON.parse(res) as IRecommendation),
      catchError(this.handleError),
    );
  }

  handleError(error: HttpErrorResponse) {
    return throwError(() => ApiError.from(error));
  }
}
