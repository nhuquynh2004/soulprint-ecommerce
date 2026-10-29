// Phần dùng chung của màn "Cá nhân hóa và gói quà" (UC-CAT-06): đọc trường form, trạng thái hiển thị tính từ thời gian,
// sinh mã, tồn vật liệu. Controller admin-sticker và admin-giftwrap gọi các hàm ở đây.
const { database, ObjectId } = require("../config/db")
const HttpError = require("../utils/httpError")

const toId = (v) => (v && ObjectId.isValid(String(v)) ? new ObjectId(String(v)) : null)
const str = (v, max) => (typeof v === "string" ? v.normalize("NFC").trim().slice(0, max) : "")
const can = (req, code) => req.isFullAccess || req.permissions.has(code)
const AXES = ["THE_THAO", "ANIME", "GAME"]
const BADGES = ["HOT", "MOI"]
const KINDS = ["THUONG", "BST_MUA"]
const imageOk = (v) => !v || /^\/(api\/files|images)\//.test(v)

function dateOrNull(v) {
  if (v === null || v === undefined || v === "") return null
  const d = new Date(v)
  return isNaN(d) ? undefined : d
}

// Trạng thái hiển thị (06 Mục 2.10, 2.12; giống collections): Ẩn / Đã lên lịch / Hết hạn / Đang hiện
function displayStatus(doc, now = new Date()) {
  if (doc.isActive === false) return "AN"
  if (doc.kind === "BST_MUA") {
    if (doc.startAt && new Date(doc.startAt) > now) return "DA_LEN_LICH"
    if (doc.endAt && new Date(doc.endAt) < now) return "HET_HAN"
  }
  return "DANG_HIEN"
}

// Phần chung của bộ sticker và mẫu gói quà: loại, tên BST/mùa, nhãn, liên kết BST, thời gian (UC-CAT-06 5Ea)
async function readSeason(body, existing, fields) {
  const pick = (k) => (body[k] !== undefined ? body[k] : existing ? existing[k] : undefined)
  const kind = KINDS.includes(pick("kind")) ? pick("kind") : "THUONG"
  const out = { kind, seasonLabel: null, badge: null, collectionId: null, startAt: null, endAt: null }
  if (kind === "BST_MUA") {
    out.seasonLabel = str(pick("seasonLabel"), 60) || null
    out.badge = BADGES.includes(pick("badge")) ? pick("badge") : null
    const cid = pick("collectionId")
    out.collectionId = cid ? toId(cid) : null
    if (cid && (!out.collectionId || !(await database.collection("collections").findOne({ _id: out.collectionId }, { projection: { _id: 1 } })))) {
      fields.collectionId = "Bộ sưu tập không tồn tại"
    }
    out.startAt = dateOrNull(pick("startAt"))
    out.endAt = dateOrNull(pick("endAt"))
    if (!out.seasonLabel) fields.seasonLabel = "Nhập tên BST/mùa hiển thị cho khách"
    if (!out.startAt) fields.startAt = "Chọn thời gian bắt đầu"
    if (!out.endAt) fields.endAt = "Chọn thời gian kết thúc"
    if (out.startAt && out.endAt && out.endAt <= out.startAt) fields.endAt = "Ngày kết thúc phải sau ngày bắt đầu"
  }
  return out
}

function assertNoErrors(fields) {
  if (Object.keys(fields).length) throw new HttpError(422, "VALIDATION_ERROR", Object.values(fields)[0], { fields })
}

// Mã tự sinh dạng PREFIX-01, PREFIX-02... không trùng với tập mã đã có
function nextCode(prefix, taken) {
  for (let i = 1; ; i++) {
    const code = `${prefix}-${String(i).padStart(2, "0")}`
    if (!taken.has(code)) return code
  }
}

// Bỏ dấu, lấy chữ cái đầu làm tiền tố mã: "Áo đấu" -> "AD"
function initials(name) {
  const plain = String(name || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toUpperCase()
  const letters = plain.split(/[^A-Z0-9]+/).filter(Boolean).map((w) => w[0]).join("")
  return (letters || "X").slice(0, 4)
}

// Mã số tăng dần trong counters (06 Mục 4.9), VD phiếu nhập "stock-receipt"
async function nextSequence(name) {
  const doc = await database.collection("counters").findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" })
  return doc.seq
}

// Trạng thái tồn của vật liệu (UC-CAT-06 1e): Hết hàng / Sắp hết / Còn hàng
function stockStatus(m) {
  const stock = m.stock || 0
  if (stock <= 0) return "HET_HANG"
  if (stock <= (m.lowStockThreshold || 0)) return "SAP_HET"
  return "CON_HANG"
}

// "Đang giữ cho đơn": số đơn đã tạo, chưa giao cho vận chuyển có dùng vật liệu (06 Mục 2.11). orders có từ S5;
// mỗi gói quà dùng 1 đơn vị mỗi vật liệu (BR-36).
const HOLDING_STATUSES = ["CHO_XAC_NHAN", "CHO_XU_LY", "DANG_CA_NHAN_HOA", "DANG_CHUAN_BI"]
async function committedByCode() {
  const rows = await database
    .collection("orders")
    .aggregate([
      { $match: { orderStatus: { $in: HOLDING_STATUSES }, giftWrap: { $ne: null } } },
      { $project: { codes: ["$giftWrap.paper.code", "$giftWrap.ribbon.code", "$giftWrap.card.code"] } },
      { $unwind: "$codes" },
      { $match: { codes: { $ne: null } } },
      { $group: { _id: "$codes", n: { $sum: 1 } } },
    ])
    .toArray()
  return new Map(rows.map((r) => [r._id, r.n]))
}

// Kiểm tra quyền theo thao tác của API bulk (07 Mục 1.1)
function assertCan(req, code) {
  if (!can(req, code)) throw new HttpError(403, "FORBIDDEN", "Bạn không có quyền thực hiện thao tác này")
}

module.exports = {
  toId, str, can, AXES, BADGES, KINDS, imageOk, dateOrNull, displayStatus, readSeason, assertNoErrors,
  nextCode, initials, nextSequence, stockStatus, committedByCode, assertCan,
}
