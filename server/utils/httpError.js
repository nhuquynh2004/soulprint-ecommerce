// Lỗi nghiệp vụ có mã HTTP và mã lỗi theo 07_API_Spec.md Mục 1.4.
// Controller/service chỉ cần `throw new HttpError(404, "NOT_FOUND", "Không tìm thấy sản phẩm")`,
// middleware errorHandler sẽ trả về đúng dạng { error: { code, message, ... } }.
class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message)
    this.status = status
    this.code = code
    this.extra = extra // VD { fields }, { rule: "BR-27" }, { retryAfter: 900 }
  }
}

module.exports = HttpError
