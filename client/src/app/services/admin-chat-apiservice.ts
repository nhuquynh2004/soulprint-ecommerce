import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, throwError } from 'rxjs';
import { ApiError } from '../classes/api-error';
import { IChatMessage, IConversationDetail, IDutyResult, IInternalNote, IQueueList, IChatLabel } from '../classes/chat';

// Hỗ trợ khách hàng phía nhân viên (07 - S11, UC-CSK-04): API-104 hàng đợi, API-105 chi tiết (nhận hội thoại),
// API-106 trả lời, API-107 kết thúc, API-176 ghi chú nội bộ, API-177 bật/tắt Đang trực.
// Polling nên GET không retry (lượt sau tự hỏi lại); ghi dữ liệu không retry để không gửi 2 lần.
@Injectable({ providedIn: 'root' })
export class AdminChatApiService {
  constructor(private _http: HttpClient) {}

  private textOptions(query?: Record<string, string | undefined>): Object {
    const headers = new HttpHeaders().set('Content-Type', 'text/plain;charset=utf-8');
    let params = new HttpParams();
    for (const [k, v] of Object.entries(query || {})) if (v) params = params.set(k, v);
    return { headers: headers, responseType: 'text', withCredentials: true, params: params };
  }

  private jsonOptions(): Object {
    const headers = new HttpHeaders().set('Content-Type', 'application/json;charset=utf-8');
    return { headers: headers, responseType: 'text', withCredentials: true };
  }

  private path(id: string, rest = ''): string {
    return `/api/admin/chat/conversations/${encodeURIComponent(id)}${rest}`;
  }

  // API-104: status=DA_DONG lấy hội thoại đã đóng
  getQueue(status?: 'DA_DONG'): Observable<IQueueList> {
    return this._http.get<any>('/api/admin/chat/conversations', this.textOptions({ status })).pipe(
      map((res) => JSON.parse(res) as IQueueList),
      catchError(this.handleError),
    );
  }

  // API-105: after = id tin cuối để chỉ lấy tin mới
  getConversation(id: string, after?: string): Observable<IConversationDetail> {
    return this._http.get<any>(this.path(id), this.textOptions({ after })).pipe(
      map((res) => JSON.parse(res) as IConversationDetail),
      catchError(this.handleError),
    );
  }

  // API-106
  reply(id: string, text: string): Observable<IChatMessage> {
    return this._http.post<any>(this.path(id, '/messages'), JSON.stringify({ text }), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as IChatMessage),
      catchError(this.handleError),
    );
  }

  // API-107
  close(id: string): Observable<{ status: string }> {
    return this._http.put<any>(this.path(id, '/close'), JSON.stringify({}), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as { status: string }),
      catchError(this.handleError),
    );
  }

  // API-206 sửa nhãn; auto=true trả về nhãn tự động
  setLabels(id: string, labels: string[] | null): Observable<{ labels: IChatLabel[]; labelsManual: boolean }> {
    const body = labels ? { labels } : { auto: true };
    return this._http.put<any>(this.path(id, '/labels'), JSON.stringify(body), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as { labels: IChatLabel[]; labelsManual: boolean }),
      catchError(this.handleError),
    );
  }

  // API-176
  addNote(id: string, text: string): Observable<IInternalNote> {
    return this._http.post<any>(this.path(id, '/notes'), JSON.stringify({ text }), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as IInternalNote),
      catchError(this.handleError),
    );
  }

  // API-177: tắt trực khi còn hội thoại thì gửi kèm handover (UC-CSK-04 1a)
  setDuty(onDuty: boolean, handover?: 'REASSIGN' | 'FINISH_FIRST'): Observable<IDutyResult> {
    const body = onDuty ? { onDuty } : handover ? { onDuty, handover } : { onDuty };
    return this._http.put<any>('/api/admin/me/duty', JSON.stringify(body), this.jsonOptions()).pipe(
      map((res) => JSON.parse(res) as IDutyResult),
      catchError(this.handleError),
    );
  }

  handleError(error: HttpErrorResponse) {
    return throwError(() => ApiError.from(error));
  }
}
