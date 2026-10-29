// Tệp tải lên dạng base64 trong JSON (slide Chương VI 6.7.3 và Chương VII): lưu chuỗi base64 trong collection files.
// API-70 POST /api/admin/uploads, API-64 GET /api/files/:id.
const { database, ObjectId } = require("../config/db")
const params = require("../config/params")
const HttpError = require("../utils/httpError")

const MB = 1024 * 1024
const TYPES = {
  "image/jpeg": { max: params.MAX_IMAGE_MB, magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/png": { max: params.MAX_IMAGE_MB, magic: (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  "image/webp": { max: params.MAX_IMAGE_MB, magic: (b) => b.slice(0, 4).toString() === "RIFF" && b.slice(8, 12).toString() === "WEBP" },
  "application/pdf": { max: params.MAX_PDF_MB, magic: (b) => b.slice(0, 5).toString() === "%PDF-" },
  // Video bằng chứng của cửa hàng khi từ chối đổi trả (UC-OPS-07 3a): MP4 có hộp "ftyp" ở byte 4
  "video/mp4": { max: params.EVIDENCE_MAX_VIDEO_MB, magic: (b) => b.slice(4, 8).toString() === "ftyp", video: true },
}

// "data:image/png;base64,iVBOR..." -> kiểm tra loại, dung lượng sau khi giải mã, phần đầu tệp khớp loại (NFR-SEC-09).
// opts.types: loại được nhận (mặc định ảnh và PDF, không video); opts.imageMaxMB: giới hạn ảnh riêng (ảnh hậu mãi 10MB - BR-31)
function decodeDataUrl(dataUrl, name, { types = null, imageMaxMB = null } = {}) {
  const m = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ""))
  if (!m) throw new HttpError(400, "VALIDATION_ERROR", `${name}: dữ liệu ảnh không hợp lệ`)
  const mimeType = m[1].toLowerCase()
  const rule = TYPES[mimeType]
  const allowed = types || Object.keys(TYPES).filter((t) => !TYPES[t].video)
  if (!rule || !allowed.includes(mimeType)) throw new HttpError(400, "VALIDATION_ERROR", `${name}: ${types ? "định dạng tệp không được hỗ trợ" : "chỉ nhận ảnh JPG, PNG, WebP hoặc PDF"}`)
  const max = imageMaxMB && mimeType.startsWith("image/") ? imageMaxMB : rule.max
  const data = m[2].replace(/\s/g, "")
  const buffer = Buffer.from(data, "base64")
  if (buffer.length > max * MB) throw new HttpError(400, "VALIDATION_ERROR", `${name}: tệp quá ${max}MB`)
  if (!rule.magic(buffer)) throw new HttpError(400, "VALIDATION_ERROR", `${name}: nội dung tệp không khớp định dạng`)
  return { mimeType, data, size: buffer.length }
}

// API-70 - tối đa 10 tệp mỗi lần
async function upload(req, res) {
  const files = Array.isArray(req.body.files) ? req.body.files : []
  if (!files.length || files.length > 10) throw new HttpError(400, "VALIDATION_ERROR", "Chọn từ 1 đến 10 tệp")
  const docs = files.map((f, i) => {
    const name = String((f && f.name) || `tep-${i + 1}`).slice(0, 120)
    return {
      ...decodeDataUrl(f && f.dataUrl, name),
      name,
      visibility: f && f.visibility === "RIENG_TU" ? "RIENG_TU" : "CONG_KHAI",
      ownerType: null,
      ownerId: null,
      uploadedBy: req.user._id,
      createdAt: new Date(),
    }
  })
  const result = await database.collection("files").insertMany(docs)
  res.status(201).send(Object.values(result.insertedIds).map((id) => ({ fileId: id, url: `/api/files/${id}` })))
}

// API-64 - trả nội dung tệp, cache 7 ngày; tệp riêng tư (ảnh đổi trả, bảo hành, bằng chứng từ chối) chỉ nhân viên và
// khách chủ yêu cầu (ownerUserId) xem được
async function getFile(req, res) {
  const id = req.params["id"]
  if (!ObjectId.isValid(id)) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy tệp")
  const file = await database.collection("files").findOne({ _id: new ObjectId(id) })
  if (!file) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy tệp")
  const isOwner = !!req.user && !!file.ownerUserId && String(file.ownerUserId) === String(req.user._id)
  if (file.visibility === "RIENG_TU" && !req.staff && !isOwner) {
    throw new HttpError(404, "NOT_FOUND", "Không tìm thấy tệp")
  }
  res.set("Content-Type", file.mimeType)
  res.set("Cache-Control", file.visibility === "RIENG_TU" ? "private, no-store" : "public, max-age=604800")
  res.send(Buffer.from(file.data, "base64"))
}

module.exports = { upload, getFile, decodeDataUrl }
