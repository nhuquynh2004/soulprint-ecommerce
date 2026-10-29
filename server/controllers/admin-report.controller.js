// Báo cáo tổng quan (07_API_Spec.md API-88, API-89) - S12, UC-CAT-03.
const reports = require("../services/reports")

// API-88 GET /api/admin/reports?preset=|from=&to=&groupBy=&section=
async function getReport(req, res) {
  res.send(await reports.report(req, req.query))
}

// API-89 GET /api/admin/reports/export?dataset=orders|revenue|top-products|personalization&kind=&preset=|from=&to=
// Tệp CSV UTF-8 có BOM, tên tệp theo loại dữ liệu và khoảng thời gian
async function exportReport(req, res) {
  const { filename, body } = await reports.exportCsv(req, req.query)
  res.set("Content-Type", "text/csv; charset=utf-8")
  res.set("Content-Disposition", `attachment; filename="${filename}"`)
  res.send(body)
}

module.exports = { getReport, exportReport }
