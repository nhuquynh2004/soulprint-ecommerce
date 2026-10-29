// Tư vấn quà AI (07 Mục 2.4, UC-DIS-05): API-59 gợi ý và tinh chỉnh, API-198 lượt thử còn lại.
const recommendation = require("../services/recommendation")

// API-59 POST /api/recommendations - khảo sát, hoặc {sessionId, refineText?, ...tiêu chí mới} khi tinh chỉnh
async function recommend(req, res) {
  res.send(await recommendation.recommend(req, res))
}

// API-198 GET /api/recommendations/quota - {member, limit, remaining, budgetMax}
async function getQuota(req, res) {
  res.send({ ...recommendation.quotaFor(req), budgetMax: await recommendation.budgetMax() })
}

module.exports = { recommend, getQuota }
