// Đọc catalog cho script giả lập, train và đánh giá - không cần MongoDB.
// Cùng catalog 60 sản phẩm của dataset: data/seed + scripts/dataset/catalog-extra.js, lượt bán và
// điểm đánh giá lấy từ scripts/gen-dataset.js (hạt giống cố định, giống CSDL sau npm run seed:dataset).
// Đổi sản phẩm về dạng "item" của features.js / ranker.js, khóa tag "NHOM:slug".
const path = require("path")
const fs = require("fs")
const { basePrice } = require("../services/pricing")

const SEED = path.join(__dirname, "..", "..", "data", "seed")
const read = (name) => JSON.parse(fs.readFileSync(path.join(SEED, name), "utf8"))

const keyOf = (tag) => `${tag.group}:${tag.slug}`

function loadSeedCatalog(now = new Date("2026-10-20T00:00:00+07:00")) {
  const tags = read("tags.json")
  const groups = read("tagGroups.json")
  const extra = require("../scripts/dataset/catalog-extra")
  const stats = new Map(require("../scripts/gen-dataset").products.map((p) => [p.sku, p]))
  const bySlug = new Map(tags.map((t) => [t.slug, t]))
  const tagInfo = new Map(tags.map((t) => [keyOf(t), { name: t.name, group: t.group, slug: t.slug, synonyms: t.synonyms || [] }]))
  const items = [...read("products.json"), ...extra.products]
    .filter((p) => p.status === "DANG_HIEN_THI" && p.aiEligible !== false)
    .map((p) => ({
      id: p.sku,
      name: p.name,
      price: basePrice(p, now),
      tags: (p.tagSlugs || []).map((s) => bySlug.get(s)).filter(Boolean).map(keyOf),
      ageMin: p.ageMin ?? null,
      ageMax: p.ageMax ?? null,
      rating: stats.get(p.sku)?.ratingAvg || 0,
      sold: stats.get(p.sku)?.soldCount || 0,
      personalizable: !!(p.personalization && p.personalization.allowed),
      axis: p.axis,
    }))
  const byGroup = (code) => tags.filter((t) => t.group === code).map(keyOf)
  return { items, tagInfo, groups, byGroup }
}

module.exports = { loadSeedCatalog, keyOf }
