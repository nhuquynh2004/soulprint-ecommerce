// Unit test quy tắc báo cáo tổng quan (services/reportRules.js), không cần kết nối MongoDB
const test = require("node:test")
const assert = require("node:assert/strict")
const r = require("../services/reportRules")

// 15/10/2026 10:00 giờ Việt Nam
const NOW = new Date("2026-10-15T03:00:00Z")

test("UC-CAT-03 AC8: hôm nay 15/10, 7 ngày gần nhất là 09/10 đến 15/10; kỳ trước 02/10 đến 08/10", () => {
  const x = r.resolveRange({ preset: "7-ngay" }, NOW)
  assert.equal(x.from, "2026-10-09")
  assert.equal(x.to, "2026-10-15")
  assert.equal(x.days, 7)
  assert.equal(x.prev.from, "2026-10-02")
  assert.equal(x.prev.to, "2026-10-08")
  // Mốc là 0:00 giờ Việt Nam
  assert.equal(x.start.toISOString(), "2026-10-08T17:00:00.000Z")
  assert.equal(x.end.toISOString(), "2026-10-15T17:00:00.000Z")
})

test("Bước 1: mặc định 30 ngày; Tháng này, Tháng trước, Hôm nay", () => {
  assert.equal(r.resolveRange({}, NOW).from, "2026-09-16")
  assert.deepEqual([r.resolveRange({ preset: "thang-nay" }, NOW).from, r.resolveRange({ preset: "thang-nay" }, NOW).to], ["2026-10-01", "2026-10-15"])
  const last = r.resolveRange({ preset: "thang-truoc" }, NOW)
  assert.deepEqual([last.from, last.to, last.days], ["2026-09-01", "2026-09-30", 30])
  assert.equal(r.resolveRange({ preset: "hom-nay" }, NOW).days, 1)
  // 0:30 sáng 16/10 giờ Việt Nam vẫn là ngày 16/10
  assert.equal(r.resolveRange({ preset: "hom-nay" }, new Date("2026-10-15T17:30:00Z")).from, "2026-10-16")
})

test("UC-CAT-03 4Ea: Tùy chọn ngày kết thúc trước ngày bắt đầu thì báo lỗi", () => {
  assert.throws(() => r.resolveRange({ from: "2026-10-10", to: "2026-10-01" }, NOW), (e) => e.status === 422)
  assert.throws(() => r.resolveRange({ from: "2026-02-30", to: "2026-03-01" }, NOW), (e) => e.status === 422)
  assert.equal(r.resolveRange({ from: "2026-10-01", to: "2026-10-10" }, NOW).days, 10)
})

test("So với kỳ trước: % thay đổi, tỷ lệ theo điểm %; kỳ trước 0 thì không so", () => {
  assert.equal(r.changePct(112, 100), 12)
  assert.equal(r.changePct(5, 0), null)
  assert.deepEqual(r.metric(91.3, 90.1, "points"), { value: 91.3, previous: 90.1, change: 1.2, changeKind: "points" })
})

test("UC-CAT-03 AC3: khoảng không có đơn - tỷ lệ là null (giao diện hiện '-'), không chia cho 0", () => {
  assert.equal(r.ratePct(0, 0), null)
  assert.equal(r.ratePct(4, 10), 40) // AC6: 4/10 đơn có cá nhân hóa = 40%
})

test("Nhóm biểu đồ: ngày, tuần bắt đầu thứ Hai, tháng; nhóm liên tục kể cả ngày không có đơn", () => {
  assert.equal(r.bucketOf("2026-10-15", "week"), "2026-10-12") // 15/10/2026 là thứ Năm
  assert.equal(r.bucketOf("2026-10-15", "month"), "2026-10-01")
  assert.deepEqual(r.buckets("2026-10-01", "2026-10-03", "day"), ["2026-10-01", "2026-10-02", "2026-10-03"])
  assert.equal(r.buckets("2026-09-16", "2026-10-15", "week").length, 5)
  assert.equal(r.pickGroupBy(undefined, 30), "day")
  assert.equal(r.pickGroupBy(undefined, 90), "week")
  assert.equal(r.pickGroupBy("month", 7), "month")
})

test("UC-CAT-03 AC4: tồn 10, 14 ngày bán 28 (2/ngày) thì dự kiến hết sau 5 ngày; không bán thì không dự kiến", () => {
  assert.equal(r.daysUntilStockout(10, 28), 5)
  assert.equal(r.daysUntilStockout(10, 0), null)
})

test("Gợi ý hành động xếp Khẩn cấp lên đầu, cùng mức thì hạn gần trước; chữ hạn ngắn", () => {
  const list = r.sortInsights([
    { type: "AI_GAPS", severity: "BINH_THUONG" },
    { type: "STORAGE", severity: "CAN_CHU_Y", dueAt: new Date("2026-10-18T00:00:00Z") },
    { type: "STOCKOUT", severity: "CAN_CHU_Y", dueAt: new Date("2026-10-17T00:00:00Z") },
    { type: "URGENT_ORDERS", severity: "KHAN_CAP" },
  ])
  assert.deepEqual(list.map((x) => x.type), ["URGENT_ORDERS", "STOCKOUT", "STORAGE", "AI_GAPS"])
  assert.equal(r.SEVERITY_OF.STORAGE, "CAN_CHU_Y") // AC9
  assert.equal(r.dueText(new Date("2026-10-17T03:00:00Z"), NOW), "còn 2 ngày")
  assert.equal(r.dueText(new Date("2026-10-15T08:00:00Z"), NOW), "còn 5 giờ")
  assert.equal(r.dueText(new Date("2026-10-14T03:00:00Z"), NOW), "chờ 24 giờ")
})

test("Quy tắc 3 và 4: nhiều lượt xem ít thêm giỏ; voucher còn dưới 10% lượt", () => {
  assert.equal(r.lowConversion(150, 2), true)
  assert.equal(r.lowConversion(150, 3), false)
  assert.equal(r.lowConversion(99, 0), false)
  assert.equal(r.voucherLow({ totalQuantity: 100, usedCount: 91 }), true)
  assert.equal(r.voucherLow({ totalQuantity: 100, usedCount: 90 }), false)
  assert.equal(r.voucherLow({ totalQuantity: null, usedCount: 500 }), false)
})

test("UC-CAT-03 AC10: Thiết lập cửa hàng 3/5 đã xong", () => {
  const s = r.setupCards({ homePublished: true, feesSaved: true, activeStickerSets: 0, activeTemplates: 0, policyCount: 6, activeFaqs: 11, otherActiveStaff: 0 })
  assert.equal(s.doneCount, 3)
  assert.equal(s.total, 5)
  assert.deepEqual(s.cards.filter((c) => !c.done).map((c) => c.key), ["personalization", "staff"])
})

test("UC-CAT-03 AC2: CSV có BOM UTF-8, ô có dấu phẩy hoặc ngoặc kép được bọc", () => {
  const csv = r.toCsv([["Sản phẩm", "Ghi chú"], ["Áo đấu", 'Có "khắc", tên']])
  assert.equal(csv.charCodeAt(0), 0xfeff)
  assert.ok(csv.includes('"Có ""khắc"", tên"'))
})
