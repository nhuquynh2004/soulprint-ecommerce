// Catalog công khai (07_API_Spec.md Mục 2.3, 2.14, 2.16) - S1 Khám phá sản phẩm.
// Thứ tự khai báo: các đường dẫn cố định (/products/suggest, /products/filter/price) phải đứng trước /products/:slug,
// nếu không Express sẽ hiểu "suggest" là một slug.
const express = require("express")
const product = require("../controllers/product.controller")
const { getCategories } = require("../controllers/category.controller")
const { getTags } = require("../controllers/tag.controller")
const { getHome } = require("../controllers/home.controller")
const { getCollectionBySlug, listOpenCollections } = require("../controllers/collection.controller")
const { getPublicSettings } = require("../controllers/setting.controller")
const { getPolicy } = require("../controllers/policy.controller")
const { getFile } = require("../controllers/file.controller")

const router = express.Router()

router.get("/home", getHome) // API-23
router.get("/categories", getCategories) // API-24
router.get("/tags", getTags) // API-25
router.get("/products", product.getProducts) // API-26
router.get("/products/filter/price", product.filterByPrice) // API-184
router.get("/products/suggest", product.suggest) // API-27
router.get("/products/:id/reviews", product.getReviews) // API-29
router.get("/products/:slug", product.getProductBySlug) // API-28
router.get("/collections", listOpenCollections) // API-207
router.get("/collections/:slug", getCollectionBySlug) // API-108
router.get("/settings/public", getPublicSettings) // API-143
router.get("/policies/:slug", getPolicy) // API-146
router.get("/files/:id", getFile) // API-64

module.exports = router
