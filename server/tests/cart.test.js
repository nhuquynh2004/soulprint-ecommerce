// Unit test cá nhân hóa và giỏ hàng (services/personalization.js, services/cart.js), không cần kết nối MongoDB
const test = require("node:test")
const assert = require("node:assert/strict")

const { ObjectId } = require("mongodb")
const pz = require("../services/personalization")
const { mergeLines, totals } = require("../services/cartLines")

const aoDau = { name: "Áo đấu CLB in tên số áo", personalization: { allowed: true, types: ["IN_KHAC"], engrave: { mode: "AO_DAU", topMaxChars: 12, bottomMaxChars: 12, numberMaxDigits: 2 } } }
const binh = { name: "Bình giữ nhiệt", personalization: { allowed: true, types: ["IN_KHAC"], engrave: { mode: "THUONG", maxChars: 20 } } }
const anime = new ObjectId()
const hoodie = { name: "Áo hoodie anime", axis: "ANIME", categoryId: anime, personalization: { allowed: true, types: ["IN_KHAC", "THIET_KE"], engrave: { mode: "THUONG" } } }
const stickers = new Map(["AN-SAO", "AN-MEO", "AN-KIEM", "HLW-BINGO"].map((code) => [code, { code, name: code, image: null }]))

const rule = (code) => (err) => err.status === 422 && err.extra.rule === code

test("In/Khắc chế độ Thường: cắt khoảng trắng, quá giới hạn bị từ chối (BR-18)", () => {
  assert.deepEqual(pz.normalizePersonalization({ type: "IN_KHAC", text: "  MINH ANH " }, binh, stickers), { type: "IN_KHAC", mode: "THUONG", text: "MINH ANH" })
  assert.throws(() => pz.normalizePersonalization({ type: "IN_KHAC", text: "Chúc mừng sinh nhật anh" }, binh, stickers), rule("BR-18"))
  assert.throws(() => pz.normalizePersonalization({ type: "IN_KHAC", text: "   " }, binh, stickers), rule("BR-18"))
})

test("đếm theo ký tự hiển thị: chữ có dấu gõ tổ hợp vẫn tính 1 ký tự (BR-18)", () => {
  const decomposed = "Nguyễn Hồng Nhung Tú".normalize("NFD") // 20 ký tự hiển thị
  assert.ok(decomposed.length > 20)
  const p = pz.normalizePersonalization({ type: "IN_KHAC", text: decomposed }, binh, stickers)
  assert.equal(pz.charCount(p.text), 20)
})

test("In/Khắc chế độ Áo đấu: ít nhất 1 ô, số áo chỉ chữ số (UC-CRT-01 AC6, 5Ec)", () => {
  const p = pz.normalizePersonalization({ type: "IN_KHAC", top: "MINH ANH", number: "10", bottom: "" }, aoDau, stickers)
  assert.deepEqual(p, { type: "IN_KHAC", mode: "AO_DAU", top: "MINH ANH", number: "10", bottom: "" })
  assert.throws(() => pz.normalizePersonalization({ type: "IN_KHAC", top: "", number: "", bottom: "" }, aoDau, stickers), rule("BR-18"))
  assert.throws(() => pz.normalizePersonalization({ type: "IN_KHAC", number: "1O" }, aoDau, stickers), rule("BR-18"))
  assert.throws(() => pz.normalizePersonalization({ type: "IN_KHAC", number: "100" }, aoDau, stickers), rule("BR-18"))
})

test("hình thức sản phẩm không cho phép bị từ chối (BR-19, UC-CRT-01 AC4)", () => {
  assert.throws(() => pz.normalizePersonalization({ type: "THIET_KE", stickers: ["AN-SAO"] }, binh, stickers), rule("BR-19"))
  assert.equal(pz.normalizePersonalization(null, binh, stickers), null)
})

test("Thiết kế: 1 đến 3 sticker, bỏ lời nhắn, sticker hết mùa bị từ chối (BR-20, BR-33)", () => {
  const ok = pz.normalizePersonalization({ type: "THIET_KE", stickers: ["AN-SAO", "AN-MEO"], message: " Chúc mừng " }, hoodie, stickers)
  assert.deepEqual(ok, { type: "THIET_KE", stickers: ["AN-SAO", "AN-MEO"] })
  assert.throws(() => pz.normalizePersonalization({ type: "THIET_KE", stickers: ["AN-SAO", "AN-MEO", "AN-KIEM", "HLW-BINGO"] }, hoodie, stickers), rule("BR-20"))
  assert.throws(() => pz.normalizePersonalization({ type: "THIET_KE", stickers: ["AN-SAO", "AN-SAO"] }, hoodie, stickers), rule("BR-20"))
  // Chỉ có lời nhắn, không sticker: không còn hợp lệ
  assert.throws(() => pz.normalizePersonalization({ type: "THIET_KE", stickers: [], message: "Chúc mừng" }, hoodie, stickers), rule("BR-20"))
  assert.throws(() => pz.normalizePersonalization({ type: "THIET_KE", stickers: [] }, hoodie, stickers), rule("BR-20"))
  assert.throws(() => pz.normalizePersonalization({ type: "THIET_KE", stickers: ["GM-PIXEL"] }, hoodie, stickers), rule("BR-33"))
})

test("phí cá nhân hóa: sticker × 5.000đ, lời nhắn miễn phí, In/Khắc 0đ (UC-CRT-01 AC3)", () => {
  const p = { type: "THIET_KE", stickers: ["AN-SAO", "AN-MEO"], message: "Chúc mừng" }
  const fee = pz.feePerUnit(p, 5000)
  assert.equal(fee, 10000)
  assert.equal((200000 + fee) * 2, 420000)
  assert.equal(pz.feePerUnit({ type: "IN_KHAC", mode: "THUONG", text: "A" }, 5000), 0)
  assert.equal(pz.feePerUnit(null, 5000), 0)
})

test("khóa nội dung: thứ tự sticker không làm khác dòng (UC-CRT-01 8a)", () => {
  assert.equal(pz.personalizationKey({ type: "THIET_KE", stickers: ["B", "A"], message: "" }), pz.personalizationKey({ type: "THIET_KE", stickers: ["A", "B"], message: "" }))
  assert.notEqual(pz.personalizationKey({ type: "IN_KHAC", mode: "THUONG", text: "A" }), pz.personalizationKey(null))
})

test("bộ sticker: bộ mùa chỉ trong thời gian hiển thị, xếp trước, lọc theo trục (UC-CRT-01 AC7, UC-CAT-06 AC1, AC2)", async () => {
  const sets = [
    { _id: 1, name: "Sân cỏ", kind: "THUONG", axes: ["THE_THAO"], categoryIds: [], sortOrder: 1, isActive: true, stickers: [{ code: "TT-BONG", isActive: true }] },
    { _id: 2, name: "Anime", kind: "THUONG", axes: ["ANIME"], categoryIds: [], sortOrder: 2, isActive: true, stickers: [{ code: "AN-SAO", isActive: true }, { code: "AN-AN", isActive: false }] },
    { _id: 3, name: "Halloween", kind: "BST_MUA", seasonLabel: "Halloween 2026", badge: "HOT", axes: [], categoryIds: [], sortOrder: 9, isActive: true, startAt: new Date("2026-10-15"), endAt: new Date("2026-11-02T23:59:59"), stickers: [{ code: "HLW-BINGO", isActive: true }] },
  ]
  const during = await pz.stickerSetsFor(hoodie, new Date("2026-10-20"), sets)
  assert.deepEqual(during.map((s) => s._id), [3, 2])
  assert.equal(during[0].seasonLabel, "Halloween 2026")
  assert.deepEqual(during[1].stickers.map((x) => x.code), ["AN-SAO"])
  const after = await pz.stickerSetsFor(hoodie, new Date("2026-11-03"), sets)
  assert.deepEqual(after.map((s) => s._id), [2])
  assert.deepEqual(await pz.stickerSetsFor(binh, new Date("2026-10-20"), sets), [])
})

test("tổng tạm tính chỉ tính dòng được chọn, không cảnh báo (UC-CRT-03 AC5, AC7)", () => {
  const line = (price, selected, warning = null) => ({ unitPrice: price, quantity: 1, personalizationFeePerUnit: 0, selected, warning, personalization: null })
  const t = totals([line(100000, true), line(200000, true), line(300000, false)], 30000)
  assert.equal(t.subtotal, 300000)
  assert.equal(t.selectedCount, 2)
  assert.equal(t.estimatedTotal, 330000)
  const ac7 = totals([line(399000, true), line(290000, true), line(50000, true, { code: "HET_HANG" })], 30000)
  assert.equal(ac7.subtotal, 689000)
  assert.equal(ac7.estimatedTotal, 719000)
  assert.equal(totals([line(100000, false)], 30000).shippingFee, 0)
})

test("gộp giỏ khi đăng nhập: cộng dòng trùng không vượt tồn, dòng khác thêm mới, được chọn (02 Mục 2 ghi chú 2)", () => {
  const member = [{ _id: "m1", productId: "P1", variantSku: "A", quantity: 2, selected: false, personalization: null }]
  const guest = [
    { _id: "g1", productId: "P1", variantSku: "A", quantity: 5, selected: false, personalization: null },
    { _id: "g2", productId: "P2", variantSku: "B", quantity: 1, selected: false, personalization: { type: "IN_KHAC", mode: "THUONG", text: "HUY" } },
  ]
  const merged = mergeLines(member, guest, (l) => (l.productId === "P1" ? 4 : 10))
  assert.equal(merged.length, 2)
  const p1 = merged.find((x) => x.productId === "P1")
  assert.equal(p1.quantity, 4)
  assert.equal(p1.selected, true)
  assert.equal(merged[0]._id, "g2")
  assert.equal(merged[0].selected, true)
  assert.equal(member[0].quantity, 2, "không sửa mảng gốc")
})

test("tên gợi ý khi lưu thiết kế In/Khắc (UC-ACC-06 AC3)", () => {
  assert.equal(pz.suggestDesignName(aoDau, { type: "IN_KHAC", mode: "AO_DAU", top: "MINH ANH", number: "10", bottom: "" }), "Áo đấu - MINH ANH 10")
  assert.equal(pz.suggestDesignName(hoodie, { type: "THIET_KE", stickers: ["A", "B"], message: "" }), "Áo hoodie - 2 sticker")
})
