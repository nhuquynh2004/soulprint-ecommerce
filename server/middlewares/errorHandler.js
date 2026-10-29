// Hai middleware đặt cuối index.js:
// - notFound: không route nào khớp thì trả 404 dạng JSON.
// - errorHandler: mọi lỗi (throw trong controller, lỗi body-parser) đổi về dạng chung của 07_API_Spec.md Mục 1.2.
const HttpError = require("../utils/httpError")

function notFound(req, res) {
  res.status(404).send({ error: { code: "NOT_FOUND", message: "Không tìm thấy đường dẫn " + req.originalUrl } })
}

// Express nhận ra middleware xử lý lỗi nhờ đủ 4 tham số, nên phải giữ `next` dù không dùng.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).send({ error: { code: err.code, message: err.message, ...err.extra } })
  }
  // Lỗi của body-parser: JSON sai cú pháp hoặc vượt giới hạn 50mb.
  if (err.type === "entity.parse.failed") {
    return res.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Dữ liệu gửi lên không phải JSON hợp lệ" } })
  }
  if (err.type === "entity.too.large") {
    return res.status(413).send({ error: { code: "VALIDATION_ERROR", message: "Dữ liệu gửi lên quá lớn" } })
  }
  // Lỗi trùng khóa duy nhất của MongoDB (email, SĐT, slug, mã voucher...).
  if (err.code === 11000) {
    return res.status(409).send({ error: { code: "CONFLICT", message: "Dữ liệu đã tồn tại", fields: err.keyValue } })
  }
  // Lỗi không lường trước: ghi log ở server, không trả chi tiết kỹ thuật cho client.
  console.error(`[500] ${req.method} ${req.originalUrl}`, err)
  res.status(500).send({ error: { code: "SERVER_ERROR", message: "Có lỗi xảy ra, vui lòng thử lại sau" } })
}

module.exports = { notFound, errorHandler }
