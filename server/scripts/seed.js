// Nạp dữ liệu mẫu data/seed/*.json vào MongoDB (npm run seed).
// Cách làm: xóa mọi collection của CSDL đang trỏ tới -> nạp lại từng collection -> tạo index theo 06_DataModel.md.
// File seed liên kết bằng slug/SKU/email; script đổi sang ObjectId khi nạp (data/seed/README.md).
const path = require("path")
const fs = require("fs")
const { client, clientPromise, database, dbName, ObjectId } = require("../config/db")
const { hashPassword } = require("../utils/password")

const SEED_DIR = path.join(__dirname, "..", "..", "data", "seed")
const readFile = (name) => JSON.parse(fs.readFileSync(path.join(SEED_DIR, name + ".json"), "utf8"))
const now = new Date()
// Dữ liệu thay cho file JSON cùng tên (scripts/seed-dataset.js truyền catalog và tài khoản của dataset 1,5 năm)
let source = {}
const read = (name) => (source[name] ? JSON.parse(JSON.stringify(source[name])) : readFile(name))

// Chuỗi thời gian trong JSON (trường kết thúc bằng "At", hoặc birthday) đổi thành Date.
function toDates(value) {
  if (Array.isArray(value)) return value.map(toDates)
  if (value && typeof value === "object") {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = typeof v === "string" && (k.endsWith("At") || k === "birthday") ? new Date(v) : toDates(v)
    }
    return out
  }
  return value
}

// Thêm _id, createdAt, updatedAt cho mỗi document (giữ createdAt có sẵn của dataset).
const withMeta = (doc) => ({ _id: new ObjectId(), ...toDates(doc), createdAt: doc.createdAt ? new Date(doc.createdAt) : now, updatedAt: now })

// Băm mỗi mật khẩu một lần rồi dùng lại (dataset có hơn 1.000 tài khoản cùng mật khẩu demo)
const hashed = new Map()
async function hashOnce(password) {
  if (!hashed.has(password)) hashed.set(password, await hashPassword(password))
  return hashed.get(password)
}

function lookup(map, key, what) {
  const id = map.get(key)
  if (!id) throw new Error(`Seed lỗi: không tìm thấy ${what} "${key}"`)
  return id
}

async function insert(name, docs) {
  if (docs.length) await database.collection(name).insertMany(docs)
  console.log(`  ${name}: ${docs.length}`)
}

// overrides: { roles, products, users, ... } thay file JSON cùng tên. Trả các bảng tra để nạp tiếp lịch sử.
async function seed(overrides = {}) {
  source = overrides
  await clientPromise
  console.log(`Xóa và nạp lại CSDL "${dbName}"...`)
  // Xóa từng collection thay vì dropDatabase: user Atlas chỉ có quyền readWrite, không có dropDatabase.
  for (const { name } of await database.listCollections({}, { nameOnly: true }).toArray()) {
    await database.collection(name).drop()
  }

  // Vai trò
  const roles = read("roles").map(withMeta)
  await insert("roles", roles)

  // Danh mục (parentSlug -> parentId)
  const categories = read("categories").map(withMeta)
  const categoryId = new Map(categories.map((c) => [c.slug, c._id]))
  for (const c of categories) {
    c.parentId = c.parentSlug ? lookup(categoryId, c.parentSlug, "danh mục") : null
    delete c.parentSlug
  }
  await insert("categories", categories)

  // Nhóm tag và tag
  await insert("tagGroups", read("tagGroups").map(withMeta))
  const tags = read("tags").map(withMeta)
  const tagId = new Map(tags.map((t) => [t.slug, t._id]))
  await insert("tags", tags)

  // Sản phẩm (categorySlug -> categoryId, tagSlugs -> tagIds)
  const products = read("products").map(withMeta)
  // Ngày tạo so le để nhãn "Mới" (NEW_PRODUCT_DAYS) và sắp xếp "Mới nhất" có ý nghĩa khi demo:
  // trong mỗi trục, sản phẩm thứ i tạo cách đây i*7 ngày (5 sản phẩm mỗi trục còn "Mới").
  // Dataset có sẵn ngày lên kệ thật nên giữ nguyên.
  if (!overrides.products) {
    products.forEach((p, i) => {
      p.createdAt = p.updatedAt = new Date(now.getTime() - (i % 12) * 7 * 24 * 60 * 60 * 1000)
    })
  }
  for (const p of products) {
    p.categoryId = lookup(categoryId, p.categorySlug, "danh mục")
    p.tagIds = (p.tagSlugs || []).map((s) => lookup(tagId, s, "tag"))
    delete p.categorySlug
    delete p.tagSlugs
  }
  const productId = new Map(products.map((p) => [p.sku, p._id]))
  await insert("products", products)

  // Bộ sưu tập (productSkus -> productIds)
  const collections = read("collections").map(withMeta)
  for (const c of collections) {
    c.productIds = (c.productSkus || []).map((s) => lookup(productId, s, "sản phẩm"))
    delete c.productSkus
  }
  const collectionId = new Map(collections.map((c) => [c.slug, c._id]))
  await insert("collections", collections)

  // Người dùng: băm mật khẩu demo, grantedByEmail -> grantedBy
  const rawUsers = read("users")
  const users = []
  for (const raw of rawUsers) {
    const { password, ...u } = withMeta(raw)
    if (password) Object.assign(u, await hashOnce(password))
    if (u.status === "HOAT_DONG") u.activatedAt = u.activatedAt || u.createdAt
    u.addresses = (u.addresses || []).map((a) => ({ _id: new ObjectId(), ...a }))
    for (const k of ["wishlist", "searchHistory"]) u[k] = u[k] || []
    if (u.role === "member") Object.assign(u, { failedLogins: u.failedLogins || 0, lockedUntil: null })
    u.staffRoles = u.staffRoles || []
    u.permissionOverrides = u.permissionOverrides || []
    users.push(u)
  }
  const userId = new Map(users.map((u) => [u.email, u._id]))
  for (const u of users) {
    u.permissionOverrides = u.permissionOverrides.map(({ grantedByEmail, ...o }) => ({
      ...o,
      grantedBy: lookup(userId, grantedByEmail, "người cấp quyền"),
      grantedAt: now,
    }))
  }
  await insert("users", users)

  // Voucher (scope.slugs -> scope.ids theo danh mục)
  const vouchers = read("vouchers").map(withMeta)
  for (const v of vouchers) {
    const { kind, slugs = [], ids = [] } = v.scope
    const map = kind === "CATEGORY" ? categoryId : productId
    v.scope = { kind, ids: kind === "ALL" ? [] : [...ids, ...slugs.map((s) => lookup(map, s, "phạm vi voucher"))], excludeProductIds: [] }
    Object.assign(v, { usedCount: 0, discountGiven: 0, history: [], selectedUserIds: [] })
    for (const k of ["maxDiscount", "maxBudget", "validDays"]) v[k] = v[k] ?? null
  }
  await insert("vouchers", vouchers)

  // Cá nhân hóa và gói quà (collectionSlug -> collectionId, categorySlugs -> categoryIds)
  const linkCollection = (d) => {
    d.collectionId = d.collectionSlug ? lookup(collectionId, d.collectionSlug, "bộ sưu tập") : null
    delete d.collectionSlug
    return d
  }
  await insert("giftWrapMaterials", read("giftWrapMaterials").map(withMeta))
  await insert("giftWrapTemplates", read("giftWrapTemplates").map(withMeta).map(linkCollection))
  const stickerSets = read("stickerSets").map(withMeta).map(linkCollection)
  for (const s of stickerSets) {
    s.categoryIds = (s.categorySlugs || []).map((c) => lookup(categoryId, c, "danh mục"))
    delete s.categorySlugs
  }
  await insert("stickerSets", stickerSets)

  // Trang chủ và cài đặt cửa hàng (khối collection: collectionSlug -> collectionId)
  await insert("homeBanners", read("homeBanners").map(withMeta))
  const settings = read("siteSettings").map(withMeta)
  for (const s of settings.filter((s) => s.key === "home")) {
    for (const sections of [s.draft.sections, s.published.sections]) {
      for (const sec of sections.filter((x) => x.type === "collection")) {
        const { collectionSlug, ...rest } = sec.settings
        sec.settings = { collectionId: lookup(collectionId, collectionSlug, "bộ sưu tập"), ...rest }
      }
    }
    s.publishedAt = now
  }
  await insert("siteSettings", settings)

  await insert("faqs", read("faqs").map(withMeta))
  await insert("policies", read("policies").map(withMeta))

  await createIndexes()
  return { categoryId, tagId, productId, collectionId, userId, products, users, collections, vouchers }
}

// Index theo 06_DataModel.md (chỉ các collection đã có ở P3; các slice sau bổ sung khi tạo collection mới).
async function createIndexes() {
  const vi = { locale: "vi", strength: 1 }
  const plan = {
    users: [
      [{ phone: 1 }, { unique: true, partialFilterExpression: { phone: { $type: "string" } } }], // Tài khoản Google có thể chưa có SĐT
      [{ googleId: 1 }, { unique: true, sparse: true }],
      [{ email: 1 }, { unique: true, sparse: true }],
      [{ role: 1, status: 1 }],
      [{ staffRoles: 1 }],
      [{ "permissionOverrides.expiresAt": 1 }, { sparse: true }],
    ],
    roles: [[{ code: 1 }, { unique: true }], [{ name: 1 }, { unique: true, collation: vi }]],
    categories: [[{ slug: 1 }, { unique: true }], [{ code: 1 }, { unique: true, sparse: true }], [{ isActive: 1, sortOrder: 1 }]], // code: mã trong SKU (BR-46)
    tagGroups: [[{ code: 1 }, { unique: true }], [{ name: 1 }, { unique: true, collation: vi }]],
    tags: [[{ group: 1, slug: 1 }, { unique: true }]],
    files: [[{ ownerType: 1, ownerId: 1 }]],
    products: [
      // Bản nháp chưa có slug, SKU (null): unique chỉ xét giá trị là chuỗi để lưu được nhiều bản nháp
      [{ slug: 1 }, { unique: true, partialFilterExpression: { slug: { $type: "string" } } }],
      [{ sku: 1 }, { unique: true, partialFilterExpression: { sku: { $type: "string" } } }],
      [{ "variants.sku": 1 }, { unique: true, partialFilterExpression: { "variants.sku": { $type: "string" } } }],
      [{ status: 1, categoryId: 1 }],
      [{ status: 1, axis: 1 }],
      [{ tagIds: 1 }],
      [{ soldCount: -1 }],
      [{ name: "text", shortDescription: "text" }, { default_language: "none" }],
    ],
    collections: [[{ slug: 1 }, { unique: true }], [{ code: 1 }, { unique: true, partialFilterExpression: { code: { $type: "string" } } }], [{ status: 1, showOnHome: 1, sortOrder: 1 }]], // code: mã trong SKU (BR-46)
    vouchers: [[{ code: 1 }, { unique: true }], [{ status: 1, endAt: 1 }]],
    giftWrapTemplates: [[{ isActive: 1, kind: 1, sortOrder: 1 }], [{ code: 1 }, { unique: true, partialFilterExpression: { code: { $type: "string" } } }]],
    giftWrapMaterials: [[{ code: 1 }, { unique: true }], [{ kind: 1, isActive: 1, sortOrder: 1 }]],
    stickerSets: [[{ isActive: 1, kind: 1, sortOrder: 1 }], [{ "stickers.code": 1 }, { unique: true }]],
    stockMovements: [[{ materialId: 1, createdAt: -1 }]],
    carts: [[{ userId: 1 }, { unique: true }]],
    designs: [[{ userId: 1, kind: 1, createdAt: -1 }]],
    siteSettings: [[{ key: 1 }, { unique: true }]],
    policies: [[{ slug: 1 }, { unique: true }]],
    tokens: [[{ tokenHash: 1 }, { unique: true }], [{ expiresAt: 1 }, { expireAfterSeconds: 604800 }]],
    otps: [[{ target: 1, purpose: 1 }], [{ purgeAt: 1 }, { expireAfterSeconds: 0 }]],
    userVouchers: [[{ userId: 1, voucherId: 1 }, { unique: true }]],
    orders: [
      [{ code: 1 }, { unique: true }],
      [{ userId: 1, createdAt: -1 }],
      [{ "customer.phone": 1 }],
      [{ orderStatus: 1, createdAt: -1 }],
      [{ orderStatus: 1, deliveredAt: 1 }],
      [{ storageStatus: 1, storageDeadline: 1 }],
      [{ tags: 1 }],
      [{ "vouchers.voucherId": 1, createdAt: -1 }], // thống kê và xuất CSV lượt dùng voucher
    ],
    payments: [[{ orderCode: 1 }], [{ status: 1, expiresAt: 1 }], [{ code: 1 }, { unique: true }]],
    // Không hoàn 2 lần cho cùng đơn và lý do khi yêu cầu chưa thất bại (06 Mục 4.5)
    refunds: [
      [{ orderCode: 1, reason: 1 }, { unique: true, partialFilterExpression: { status: { $in: ["CHO_XU_LY", "DA_HOAN"] } }, name: "orderCode_reason_open" }],
      [{ status: 1, slaDeadline: 1 }],
    ],
    // Hậu mãi (06 Mục 4.6 đến 4.7) - S9
    returnRequests: [[{ orderCode: 1 }], [{ code: 1 }, { unique: true }], [{ status: 1, slaDeadline: 1 }], [{ userId: 1, createdAt: -1 }]],
    warrantyRequests: [[{ orderCode: 1 }], [{ code: 1 }, { unique: true }], [{ orderItemId: 1, status: 1 }], [{ userId: 1, createdAt: -1 }]],
    reviews: [[{ productId: 1, createdAt: -1 }], [{ orderItemId: 1 }, { unique: true }]],
    notifications: [[{ userId: 1, createdAt: -1 }]],
    // Báo cáo tổng quan (06 Mục 2.5, 5.1) - S12
    productDailyStats: [[{ productId: 1, date: 1 }, { unique: true }], [{ date: 1 }]],
    // Tư vấn quà AI (06 Mục 5.1, 5.2) - S10
    aiSessions: [[{ createdAt: -1 }], [{ "results.productId": 1 }], [{ userId: 1, createdAt: -1 }]],
    aiGaps: [[{ criteriaKey: 1 }, { unique: true }], [{ status: 1, count: -1 }]],
    staffMentions: [[{ adminId: 1, createdAt: -1 }]],
    // Chăm sóc khách hàng (06 Mục 5.3, 5.4) - S11
    conversations: [[{ status: 1, escalatedAt: 1 }], [{ userId: 1 }], [{ assignedAdminId: 1, status: 1 }]],
    messages: [[{ conversationId: 1, createdAt: 1 }]],
    adminLogs: [[{ targetType: 1, targetId: 1, createdAt: -1 }]],
    sessions: [[{ "session.userId": 1 }], [{ "session.staffId": 1 }]], // staffId: phiên khu quản trị
  }
  for (const [name, indexes] of Object.entries(plan)) {
    for (const [keys, options = {}] of indexes) await database.collection(name).createIndex(keys, options)
  }
  console.log("  Đã tạo index.")
}

module.exports = { seed, createIndexes }

if (require.main === module) {
  seed()
    .then(() => console.log("Xong."))
    .catch((err) => {
      console.error(err.message)
      process.exitCode = 1
    })
    .finally(() => client.close())
}
