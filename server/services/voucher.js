// Voucher phía khách và phần cấp mã dùng chung (UC-PAY-03, UC-ACC-05, UC-CAT-02, BR-23).
// Luật thuần (điều kiện, số giảm) ở checkoutMath.js; ở đây đọc/ghi vouchers, userVouchers, orders.
const { database } = require("../config/db")
const params = require("../config/params")
const math = require("./checkoutMath")

const vouchers = () => database.collection("vouchers")
const grants = () => database.collection("userVouchers")
const DAY = 24 * 60 * 60 * 1000

// Hạn của voucher được cấp = min(ngày cấp + validDays, endAt) (06 Mục 3.4)
function grantExpiry(v, at) {
  const end = v.endAt ? new Date(v.endAt) : null
  if (!v.validDays) return end
  const byDays = new Date(at.getTime() + v.validDays * DAY)
  return end && end < byDays ? end : byDays
}

// Cấp voucher cho danh sách Member (bỏ qua người đã có). Trả số người được cấp mới.
async function grantTo(v, userIds, at = new Date()) {
  if (!userIds.length) return 0
  const ops = userIds.map((userId) => ({
    updateOne: {
      filter: { userId, voucherId: v._id },
      update: {
        $setOnInsert: { userId, voucherId: v._id, code: v.code, source: v.source || "CAMPAIGN", assignedAt: at, expiresAt: grantExpiry(v, at), usedCount: 0, lastOrderCode: null, createdAt: at },
      },
      upsert: true,
    },
  }))
  const result = await grants().bulkWrite(ops, { ordered: false })
  return result.upsertedCount || 0
}

// Phân phối khi voucher được tạo/kích hoạt (UC-CAT-02 bước 5): Mọi thành viên, Thành viên mới còn trong 30 ngày, Danh sách chọn
async function distribute(v, now = new Date()) {
  if (v.status !== "HOAT_DONG") return 0
  const users = database.collection("users")
  const base = { role: "member", status: "HOAT_DONG" }
  let ids = []
  if (v.audience === "ALL_MEMBERS") ids = (await users.find(base, { projection: { _id: 1 } }).toArray()).map((u) => u._id)
  else if (v.audience === "NEW_MEMBERS") {
    const since = new Date(now.getTime() - params.NEW_MEMBER_DAYS * DAY)
    ids = (await users.find({ ...base, createdAt: { $gte: since } }, { projection: { _id: 1 } }).toArray()).map((u) => u._id)
  } else if (v.audience === "SELECTED") ids = v.selectedUserIds || []
  return grantTo(v, ids, now)
}

// Cấp các voucher "Tặng tự động khi đăng ký" cho Member mới (UC-ACC-01 bước 6, UC-ACC-04 bước 4).
// Trả mã đầu tiên để màn đăng ký hiện lời chào (VD SOULPRINT10).
async function issueSignupVouchers(userId, now = new Date()) {
  const list = await vouchers()
    .find({ status: "HOAT_DONG", autoOnSignup: true, endAt: { $gt: now } })
    .sort({ createdAt: 1, _id: 1 })
    .toArray()
  const usable = list.filter((v) => !math.usedUp(v))
  for (const v of usable) await grantTo(v, [userId], now)
  return usable.length ? usable[0].code : null
}

// Giới hạn lượt của riêng người này: perUserLimit + lượt cộng thêm khi được cấp lại (userVouchers.extraUses)
const withGrantLimit = (v, grant) => (v && v.perUserLimit && grant && grant.extraUses ? { ...v, perUserLimit: v.perUserLimit + grant.extraUses } : v)

// Số lần người dùng đã dùng mã: đếm đơn của tài khoản có mã đó (đơn Guest cũng gắn tài khoản theo SĐT - UC-PAY-01)
async function usedByUser(userId, code) {
  if (!userId) return 0
  return database.collection("orders").countDocuments({ userId, "vouchers.code": code })
}

// Kiểm tra danh sách mã cho các dòng được chọn. Mỗi nhóm (giảm giá, miễn phí vận chuyển) giữ mã đầu tiên hợp lệ.
// user: Member đang đăng nhập (hoặc null); ownerId: tài khoản sẽ giữ đơn (Guest theo SĐT) để đếm lượt mỗi người.
async function evaluate(codes, { user, ownerId, lines, shippingFee, now = new Date() }) {
  const list = codes.length ? await vouchers().find({ code: { $in: codes } }).toArray() : []
  const byCode = new Map(list.map((v) => [v.code, v]))
  const applied = []
  const errors = []
  const taken = new Set()
  for (const code of codes) {
    const v = byCode.get(code)
    const kind = v ? math.kindOf(v.type) : null
    if (v && taken.has(kind)) {
      errors.push({ code, kind, message: "Mỗi đơn chỉ dùng 1 mã giảm giá và 1 mã miễn phí vận chuyển" })
      continue
    }
    const grant = v && user ? await grants().findOne({ userId: user._id, voucherId: v._id }) : null
    const problem = math.voucherProblem(withGrantLimit(v, grant), {
      now, user, grant, usedByUser: v ? await usedByUser(ownerId || (user && user._id), code) : 0, lines, shippingFee,
    })
    if (problem) {
      // problem.code là mã lỗi (VOUCHER_EXPIRED...), code là mã voucher khách nhập
      errors.push({ ...problem, errorCode: problem.code, code, kind })
      continue
    }
    taken.add(kind)
    applied.push({ voucher: v, kind, discount: math.discountOf(v, lines, shippingFee) })
  }
  return { applied, errors }
}

// Thông tin voucher gọn để hiện trên thẻ (SCR-07, SCR-20)
function card(v) {
  return {
    code: v.code,
    name: v.name,
    description: v.description || "",
    type: v.type,
    kind: math.kindOf(v.type),
    value: v.value,
    maxDiscount: v.maxDiscount || null,
    minOrderValue: v.minOrderValue || 0,
    startAt: v.startAt || null,
    endAt: v.endAt || null,
  }
}

// Voucher của người xem: được cấp riêng (Member) + công khai bật "Hiện trong kho ưu đãi"
async function walletVouchers(user, now = new Date()) {
  const myGrants = user ? await grants().find({ userId: user._id }).toArray() : []
  const grantIds = myGrants.map((g) => g.voucherId)
  const list = await vouchers()
    .find({
      status: { $in: ["HOAT_DONG", "TAM_NGUNG", "LUU_TRU"] },
      $or: [{ _id: { $in: grantIds } }, { audience: "PUBLIC", showInWallet: { $ne: false }, status: "HOAT_DONG" }],
    })
    .toArray()
  const grantBy = new Map(myGrants.map((g) => [String(g.voucherId), g]))
  return list.map((v) => ({ voucher: v, grant: grantBy.get(String(v._id)) || null }))
}

// Hộp "Chọn từ kho ưu đãi" (API-36 không gửi mã): các mã có thể dùng kèm lý do nếu chưa đủ điều kiện (UC-ACC-05 3b)
async function walletForCheckout({ user, lines, shippingFee, now = new Date() }) {
  const out = []
  for (const { voucher: v, grant } of await walletVouchers(user, now)) {
    if (v.status !== "HOAT_DONG" || (v.endAt && new Date(v.endAt) < now)) continue
    if (grant && grant.expiresAt && new Date(grant.expiresAt) < now) continue
    const problem = math.voucherProblem(withGrantLimit(v, grant), { now, user, grant, usedByUser: await usedByUser(user && user._id, v.code), lines, shippingFee })
    if (problem && ["VOUCHER_USED_UP", "VOUCHER_INVALID"].includes(problem.code)) continue
    out.push({
      ...card(v),
      expiresAt: (grant && grant.expiresAt) || v.endAt || null,
      eligible: !problem,
      reason: problem ? problem.message : null,
      discount: problem ? 0 : math.discountOf(v, lines, shippingFee),
    })
  }
  return out.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.discount - a.discount)
}

// "Ưu đãi của tôi" (API-13, UC-ACC-05): 3 tab, mỗi thẻ có trạng thái và số ngày còn lại
async function accountVouchers(user, tab, now = new Date()) {
  const rows = []
  for (const { voucher: v, grant } of await walletVouchers(user, now)) {
    const expiresAt = (grant && grant.expiresAt) || v.endAt || null
    const used = await usedByUser(user._id, v.code)
    const limit = withGrantLimit(v, grant).perUserLimit
    let status
    if (used > 0 && limit && used >= limit) status = "DA_DUNG"
    else if (v.status !== "HOAT_DONG" || (expiresAt && new Date(expiresAt) < now) || math.usedUp(v)) status = "HET_HAN"
    else if (v.startAt && new Date(v.startAt) > now) status = "CHUA_DEN_HAN"
    else status = "CO_THE_DUNG"
    // Voucher công khai chưa từng dùng mà đã hết, hoặc voucher bị lưu trữ (Admin "xóa") mà người này chưa dùng,
    // thì không đưa vào lịch sử của người này
    if (status === "HET_HAN" && (!grant || (v.status === "LUU_TRU" && !used))) continue
    const daysLeft = expiresAt ? Math.max(0, Math.ceil((new Date(expiresAt) - now) / DAY)) : null
    let lastOrderCode = grant ? grant.lastOrderCode || null : null
    if (status === "DA_DUNG" && !lastOrderCode) {
      const last = await database.collection("orders").findOne({ userId: user._id, "vouchers.code": v.code }, { sort: { createdAt: -1 }, projection: { code: 1 } })
      lastOrderCode = last ? last.code : null
    }
    rows.push({ ...card(v), expiresAt, status, daysLeft, usesLeft: limit ? Math.max(0, limit - used) : null, lastOrderCode, source: v.source || null })
  }
  const usable = rows.filter((r) => r.status === "CO_THE_DUNG" || r.status === "CHUA_DEN_HAN")
  const groups = {
    CO_THE_DUNG: usable,
    SAP_HET_HAN: usable.filter((r) => r.status === "CO_THE_DUNG" && r.daysLeft !== null && r.daysLeft <= params.VOUCHER_EXPIRING_DAYS),
    DA_DUNG_HET_HAN: rows.filter((r) => r.status === "DA_DUNG" || r.status === "HET_HAN"),
  }
  const key = groups[tab] ? tab : "CO_THE_DUNG"
  const items = groups[key].sort((a, b) => (a.status === "CHUA_DEN_HAN") - (b.status === "CHUA_DEN_HAN") || new Date(a.expiresAt || 8.64e15) - new Date(b.expiresAt || 8.64e15))
  return {
    counts: { CO_THE_DUNG: groups.CO_THE_DUNG.length, SAP_HET_HAN: groups.SAP_HET_HAN.length, DA_DUNG_HET_HAN: groups.DA_DUNG_HET_HAN.length },
    items,
  }
}

module.exports = { grantExpiry, grantTo, distribute, issueSignupVouchers, usedByUser, evaluate, card, walletForCheckout, accountVouchers }
