import { HttpErrorResponse } from '@angular/common/http';

// Lỗi API đã đọc từ dạng chung { error: { code, message, ... } } (07_API_Spec.md Mục 1.2).
// handleError của các service trả lớp này để component biết mã HTTP (VD 404 thì hiện "Không tìm thấy sản phẩm").
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code = '',
    public extra: Record<string, any> = {},
  ) {
    super(message);
  }

  static from(error: HttpErrorResponse): ApiError {
    let body: any = error.error;
    // responseType "text" nên phần lỗi là chuỗi JSON
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        body = null;
      }
    }
    const err = body?.error;
    if (err) {
      const { code, message, ...extra } = err;
      return new ApiError(message, error.status, code, extra);
    }
    const message =
      error.status === 0 ? 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.' : 'Có lỗi xảy ra, vui lòng thử lại sau';
    return new ApiError(message, error.status);
  }
}
