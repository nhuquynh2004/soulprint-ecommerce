// API-25 GET /api/tags?filter=true - tag nhóm theo tagGroups (UC-DIS-04 thanh lọc, UC-DIS-05).
// Nhóm lấy từ collection tagGroups theo thứ tự Admin đặt; nhóm khoảng (Độ tuổi, Ngân sách) trả kèm range
// để client đổi thành priceMin/priceMax hoặc age.
// Trả kèm isFilter để SCR-02 gọi không filter, vẫn có tên tag của nhóm đã tắt cho dòng "Đang lọc".
const { database } = require("../config/db")

async function getTags(req, res) {
  const onlyFilter = req.query.filter === "true"
  const [groups, tags] = await Promise.all([
    database.collection("tagGroups").find(onlyFilter ? { isFilter: true } : {}).sort({ sortOrder: 1, _id: 1 }).toArray(),
    database.collection("tags").find(onlyFilter ? { isFilter: true } : {}).sort({ _id: 1 }).toArray(),
  ])
  res.send(
    groups
      .map((g) => ({
        group: g.code,
        label: g.name,
        kind: g.kind,
        rangeField: g.rangeField || null,
        isFilter: !!g.isFilter,
        items: tags
          .filter((t) => t.group === g.code)
          .sort((a, b) => (g.kind === "RANGE" ? (a.range?.min ?? 0) - (b.range?.min ?? 0) : 0))
          .map(({ _id, name, slug, range, isFilter }) => ({ _id, name, slug, isFilter: !!isFilter, ...(range ? { range } : {}) })),
      }))
      .filter((g) => g.items.length)
  )
}

module.exports = { getTags }
