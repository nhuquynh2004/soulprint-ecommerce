// API-146 GET /api/policies/:slug - trang chính sách SCR-30, thay biến {{...}} bằng giá trị đang áp dụng (BR-35).
// Nhân viên Quản trị thêm ?raw=true để lấy bản có biến cho trình soạn chính sách (UC-CAT-07 1b).
const { database } = require("../config/db")
const HttpError = require("../utils/httpError")
const { getStoreSettings, variableValues, fillVariables } = require("../services/settings")

async function getPolicy(req, res) {
  const policy = await database.collection("policies").findOne({ slug: req.params["slug"] })
  if (!policy) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy trang chính sách")

  const raw = req.query.raw === "true" && !!req.staff && req.isFullAccess
  const content = raw ? policy.content || "" : fillVariables(policy.content, variableValues(await getStoreSettings()))
  res.send({ slug: policy.slug, title: policy.title, content, updatedAt: policy.updatedAt })
}

module.exports = { getPolicy }
