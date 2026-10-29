import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, retry, throwError } from 'rxjs';
import { IBulkResult, IGiftTemplateAdmin, IMaterialAdmin, IMovementPage, IStickerSetAdmin } from '../classes/admin-gift';
import { ApiError } from '../classes/api-error';

// Cá nhân hóa và gói quà (API-119 đến API-130, API-171 đến API-175) theo khuôn slide 6.7:
// HttpHeaders + responseType "text" + JSON.parse + catchError; chỉ GET có retry(3); PUT gửi _id trong body.
@Injectable({ providedIn: 'root' })
export class AdminGiftApiService {
  constructor(private _http: HttpClient) {}

  private textOptions(params?: HttpParams): Object {
    const headers = new HttpHeaders().set('Content-Type', 'text/plain;charset=utf-8');
    return { headers: headers, responseType: 'text', withCredentials: true, params };
  }

  private jsonOptions(): Object {
    const headers = new HttpHeaders().set('Content-Type', 'application/json;charset=utf-8');
    return { headers: headers, responseType: 'text', withCredentials: true };
  }

  private get<T>(url: string, query: Record<string, string> = {}): Observable<T> {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(query)) if (v) params = params.set(k, v);
    return this._http.get<any>(url, this.textOptions(params)).pipe(
      map((res) => JSON.parse(res) as T),
      retry(3),
      catchError(this.handleError),
    );
  }

  private send<T>(method: 'post' | 'put', url: string, body: object): Observable<T> {
    const json = JSON.stringify(body);
    const request = method === 'post' ? this._http.post<any>(url, json, this.jsonOptions()) : this._http.put<any>(url, json, this.jsonOptions());
    return request.pipe(
      map((res) => JSON.parse(res) as T),
      catchError(this.handleError),
    );
  }

  private remove(url: string): Observable<void> {
    return this._http.delete<any>(url, this.textOptions()).pipe(
      map(() => undefined),
      catchError(this.handleError),
    );
  }

  // ===== Bộ sticker =====
  getStickerSets(query: Record<string, string> = {}): Observable<IStickerSetAdmin[]> {
    return this.get('/api/admin/sticker-sets', query); // API-119
  }
  createStickerSet(data: object): Observable<IStickerSetAdmin> {
    return this.send('post', '/api/admin/sticker-sets', data); // API-120
  }
  updateStickerSet(data: object): Observable<IStickerSetAdmin> {
    return this.send('put', '/api/admin/sticker-sets', data); // API-121
  }
  deleteStickerSet(id: string): Observable<void> {
    return this.remove('/api/admin/sticker-sets/' + id); // API-122
  }
  bulkStickerSets(data: object): Observable<IBulkResult> {
    return this.send('post', '/api/admin/sticker-sets/bulk', data); // API-171
  }

  // ===== Mẫu gói quà =====
  getTemplates(query: Record<string, string> = {}): Observable<IGiftTemplateAdmin[]> {
    return this.get('/api/admin/gift-wrap-templates', query); // API-123
  }
  createTemplate(data: object): Observable<IGiftTemplateAdmin> {
    return this.send('post', '/api/admin/gift-wrap-templates', data); // API-124
  }
  updateTemplate(data: object): Observable<IGiftTemplateAdmin> {
    return this.send('put', '/api/admin/gift-wrap-templates', data); // API-125
  }
  deleteTemplate(id: string): Observable<void> {
    return this.remove('/api/admin/gift-wrap-templates/' + id); // API-126
  }
  bulkTemplates(data: object): Observable<IBulkResult> {
    return this.send('post', '/api/admin/gift-wrap-templates/bulk', data); // API-172
  }

  // ===== Vật liệu, kho =====
  getMaterials(query: Record<string, string> = {}): Observable<IMaterialAdmin[]> {
    return this.get('/api/admin/gift-wrap-materials', query); // API-127
  }
  createMaterial(data: object): Observable<IMaterialAdmin> {
    return this.send('post', '/api/admin/gift-wrap-materials', data); // API-128
  }
  updateMaterial(data: object): Observable<IMaterialAdmin> {
    return this.send('put', '/api/admin/gift-wrap-materials', data); // API-129
  }
  deleteMaterial(id: string): Observable<void> {
    return this.remove('/api/admin/gift-wrap-materials/' + id); // API-130
  }
  bulkMaterials(data: object): Observable<IBulkResult> {
    return this.send('post', '/api/admin/gift-wrap-materials/bulk', data); // API-173
  }
  getMovements(query: Record<string, string> = {}): Observable<IMovementPage> {
    return this.get('/api/admin/stock-movements', query); // API-174
  }
  createMovement(data: object): Observable<{ receiptCode: string | null }> {
    return this.send('post', '/api/admin/stock-movements', data); // API-175
  }

  handleError(error: HttpErrorResponse) {
    return throwError(() => ApiError.from(error));
  }
}
