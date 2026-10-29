import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, throwError } from 'rxjs';
import { ApiError } from '../classes/api-error';
import { IChatState, SendResult } from '../classes/chat';

// Chat "Sâu Béo" phía khách (07 Mục 2.9 - S11): API-60 mở hội thoại, API-61 tin mới (polling), API-62 gửi tin,
// API-63 chuyển nhân viên, API-197 hủy chờ. Không retry: polling tự hỏi lại ở lượt sau, POST không gửi 2 lần.
// Lối vào có ý định rõ (báo giá, trả lời đơn đang hỏi) gửi thẳng nhân viên, kèm mã đơn; DOI_SAN_PHAM hỏi tiếp sản phẩm
export interface ChatSendExtra {
  toStaff?: boolean;
  orderCode?: string;
  intent?: 'DOI_SAN_PHAM';
}

@Injectable({ providedIn: 'root' })
export class ChatApiService {
  constructor(private _http: HttpClient) {}

  private textOptions(after?: string): Object {
    const headers = new HttpHeaders().set('Content-Type', 'text/plain;charset=utf-8');
    let params = new HttpParams();
    if (after) params = params.set('after', after);
    return { headers: headers, responseType: 'text', withCredentials: true, params: params };
  }

  private jsonOptions(): Object {
    const headers = new HttpHeaders().set('Content-Type', 'application/json;charset=utf-8');
    return { headers: headers, responseType: 'text', withCredentials: true };
  }

  private path(id: string, rest = ''): string {
    return `/api/chat/conversations/${encodeURIComponent(id)}${rest}`;
  }

  // API-60
  open(customerName?: string): Observable<IChatState> {
    return this._http.post<any>('/api/chat/conversations', JSON.stringify(customerName ? { customerName } : {}), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as IChatState),
      catchError(this.handleError),
    );
  }

  // API-61
  poll(id: string, after?: string): Observable<IChatState> {
    return this._http.get<any>(this.path(id, '/messages'), this.textOptions(after)).pipe(
      map((res) => JSON.parse(res) as IChatState),
      catchError(this.handleError),
    );
  }

  // API-62: confirmSoftened khi khách đã chọn ở hộp chuyển ngữ (UC-CSK-03); extra: nối thẳng nhân viên, mã đơn, ý định
  send(id: string, text: string, confirmSoftened?: 'SOFTENED' | 'ORIGINAL', extra: ChatSendExtra = {}): Observable<SendResult> {
    const body = { text, ...(confirmSoftened ? { confirmSoftened } : {}), ...extra };
    return this._http.post<any>(this.path(id, '/messages'), JSON.stringify(body), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as SendResult),
      catchError(this.handleError),
    );
  }

  // API-63: ngoài giờ gửi kèm liên hệ và lời nhắn
  escalate(id: string, leave?: { contact: string; text: string }): Observable<IChatState> {
    return this._http.post<any>(this.path(id, '/escalate'), JSON.stringify(leave || {}), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as IChatState),
      catchError(this.handleError),
    );
  }

  // API-197
  cancelEscalation(id: string): Observable<IChatState> {
    return this._http.post<any>(this.path(id, '/cancel-escalation'), JSON.stringify({}), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as IChatState),
      catchError(this.handleError),
    );
  }

  // API-208 đang chat với nhân viên thì quay lại Sâu Béo
  backToBot(id: string): Observable<IChatState> {
    return this._http.post<any>(this.path(id, '/back-to-bot'), JSON.stringify({}), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as IChatState),
      catchError(this.handleError),
    );
  }

  handleError(error: HttpErrorResponse) {
    return throwError(() => ApiError.from(error));
  }
}
