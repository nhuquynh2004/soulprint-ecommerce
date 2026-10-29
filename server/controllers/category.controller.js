// API-24 GET /api/categories - danh mục đang hiện theo sortOrder, kèm số sản phẩm đang bán (UC-DIS-01, UC-DIS-04).
const { database } = require("../config/db")
const { customerVisible } = require("../services/productQuery")

async function getCategories(req, res) {
  const [categories, counts] = await Promise.all([
    database.collection("categories").find({ isActive: true }).sort({ sortOrder: 1 }).toArray(),
    database
      .collection("products")
      .aggregate([{ $match: customerVisible() }, { $group: { _id: "$categoryId", n: { $sum: 1 } } }])
      .toArray(),
  ])
  const countOf = new Map(counts.map((c) => [String(c._id), c.n]))
  res.send(
    categories.map((c) => ({
      _id: c._id,
      name: c.name,
      slug: c.slug,
      description: c.description || "",
      image: c.image || null,
      parentId: c.parentId || null,
      productCount: countOf.get(String(c._id)) || 0,
    }))
  )
}

module.exports = { getCategories }
