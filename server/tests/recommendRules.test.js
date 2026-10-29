// Unit test quy tắc tư vấn quà (services/recommendRules.js) và adapter RecommendationEngine (6Ec), không cần MongoDB.
// Tag lấy từ data/seed/tags.json như CSDL sau khi seed.
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const os = require("os")
const path = require("path")
const r = require("../services/recommendRules")
const engines = require("../services/recommendationEngine")
const params = require("../config/params")

const tagInfo = r.buildTagInfo(require("../../data/seed/tags.json"))

test("3Ea: không có trường nào thì hasAnyField = false; 'Khác' ở Người nhận vẫn tính là đã chọn", () => {
  assert.equal(r.hasAnyField(r.readCriteria({}, tagInfo)), false)
  assert.equal(r.hasAnyField(r.readCriteria({ occasions: [], note: "  " }, tagInfo)), false)
  assert.equal(r.hasAnyField(r.readCriteria({ recipient: "khac" }, tagInfo)), true)
  assert.equal(r.hasAnyField(r.readCriteria({ budgetMax: 500000 }, tagInfo)), true)
})

test("đọc khảo sát: slug theo đúng nhóm, Tính cách gồm cả Phong cách, slug lạ bị bỏ qua", () => {
  const c = r.readCriteria({ recipient: "ban-trai", occasions: ["sinh-nhat", "khong-co"], hobbies: ["bong-da", "sinh-nhat"], personalities: ["hai-huoc", "nang-dong"] }, tagInfo)
  assert.equal(c.recipient, "DOI_TUONG:ban-trai")
  assert.deepEqual(c.occasions, ["DIP_TANG:sinh-nhat"])
  assert.deepEqual(c.hobbies, ["SO_THICH:bong-da"])
  assert.deepEqual(c.personalities, ["TINH_CACH:hai-huoc", "PHONG_CACH:nang-dong"])
})

test("đọc khảo sát: 400 khi tuổi ngoài 6-40 hoặc ngân sách âm; tự đổi chỗ min > max", () => {
  assert.throws(() => r.readCriteria({ ageMin: 3 }, tagInfo), (e) => e.status === 400 && !!e.extra.fields.ageMin)
  assert.throws(() => r.readCriteria({ budgetMax: -1 }, tagInfo), (e) => e.status === 400 && !!e.extra.fields.budgetMax)
  assert.throws(() => r.readCriteria({ budgetMax: "abc" }, tagInfo), (e) => e.status === 400)
  const c = r.readCriteria({ ageMin: 30, ageMax: 18, budgetMin: 600000, budgetMax: 200000 }, tagInfo)
  assert.deepEqual([c.ageMin, c.ageMax, c.budgetMin, c.budgetMax], [18, 30, 200000, 600000])
})

test("AC3: 'anh ấy mê chơi game' rút ra tag Game PC, Game mobile", () => {
  const ex = r.extractFromNote("anh ấy mê chơi game", tagInfo)
  assert.ok(ex.tags.includes("SO_THICH:game-pc"))
  assert.ok(ex.tags.includes("SO_THICH:game-mobile"))
  assert.equal(ex.understood, true)
})

test("bước 5: so khớp không dấu, theo từ đồng nghĩa và đủ từ khác thứ tự", () => {
  assert.deepEqual(r.extractFromNote("Tối thích xem ANIME ninja", tagInfo).tags, ["SO_THICH:anime-manga"]) // từ đồng nghĩa "anime"
  assert.deepEqual(r.extractFromNote("cuối tuần hay đá bóng", tagInfo).tags, ["SO_THICH:bong-da"]) // không lẫn Bóng rổ
  assert.ok(r.extractFromNote("quà noel", tagInfo).tags.includes("DIP_TANG:giang-sinh"))
  const ex = r.extractFromNote("bạn trai 25 tuổi, tầm 500k", tagInfo)
  assert.deepEqual([ex.ageMin, ex.budgetMax], [25, 500000])
  assert.equal(r.readMoney(" 1 2 trieu "), 1200000)
  assert.equal(r.readMoney(" 300 000 d "), 300000)
})

test("5Ea: không rút được gì thì ghi chú, vẫn xếp hạng bằng trường đã chọn", () => {
  const c = r.readCriteria({ hobbies: ["gym"], note: "xyz không rõ" }, tagInfo)
  const out = r.applyNote(c, tagInfo)
  assert.deepEqual(out.notes, [r.NOTE_NOT_UNDERSTOOD])
  assert.deepEqual(out.criteria.hobbies, ["SO_THICH:gym"])
  assert.deepEqual(out.criteria.noteTags, [])
})

test("applyNote: tag trùng trường đã chọn không thêm lần 2; tuổi, ngân sách trong mô tả chỉ dùng khi form để trống", () => {
  const c = r.readCriteria({ hobbies: ["bong-da"], budgetMax: 300000, note: "mê bóng đá và gym, tầm 900k, 20 tuổi" }, tagInfo)
  const x = r.applyNote(c, tagInfo).criteria
  assert.deepEqual(x.noteTags, ["SO_THICH:gym"])
  assert.equal(x.budgetMax, 300000)
  assert.deepEqual([x.ageMin, x.ageMax], [20, 20])
})

test("8a: 'Có gì rẻ hơn không?' giảm ngân sách 30%; chưa có ngân sách thì lấy giá cao nhất của kết quả trước", () => {
  const c = r.readCriteria({ hobbies: ["anime-manga"], budgetMin: 400000, budgetMax: 500000 }, tagInfo)
  const x = r.applyRefine(c, "Có gì rẻ hơn không?", tagInfo)
  assert.equal(x.understood, true)
  assert.equal(x.criteria.budgetMax, 350000)
  assert.equal(x.criteria.budgetMin, 0) // min lớn hơn max mới thì bỏ
  const y = r.applyRefine(r.readCriteria({ hobbies: ["gym"] }, tagInfo), "rẻ hơn chút", tagInfo, { maxPrice: 690000 })
  assert.equal(y.criteria.budgetMax, 483000)
})

test("8a: thêm, bỏ tiêu chí, khắc tên; câu không hiểu thì understood = false", () => {
  const c = r.readCriteria({ occasions: ["sinh-nhat"], hobbies: ["anime-manga"] }, tagInfo)
  const x = r.applyRefine(c, "Thêm lựa chọn bóng đá, bỏ sinh nhật", tagInfo).criteria
  assert.deepEqual(x.hobbies, ["SO_THICH:anime-manga", "SO_THICH:bong-da"])
  assert.deepEqual(x.occasions, [])
  assert.equal(r.applyRefine(c, "Có món khắc được tên không?", tagInfo).criteria.preferPersonalized, true)
  assert.equal(r.applyRefine(c, "Món nào giao nhanh nhất?", tagInfo).understood, false)
  assert.deepEqual(c.hobbies, ["SO_THICH:anime-manga"]) // không sửa khảo sát gốc
})

test("lượt thử Guest lấy số lớn hơn giữa cookie và session; Member không giới hạn", () => {
  assert.equal(params.GUEST_AI_TRIALS, 3)
  assert.equal(r.usedTrials("2", 1), 2)
  assert.equal(r.usedTrials(undefined, 3), 3)
  assert.equal(r.usedTrials("abc", undefined), 0)
  assert.deepEqual(r.quotaOf(false, 1, 3), { member: false, limit: 3, remaining: 2 })
  assert.deepEqual(r.quotaOf(false, 5, 3), { member: false, limit: 3, remaining: 0 })
  assert.deepEqual(r.quotaOf(true, 9, 3), { member: true, limit: null, remaining: null })
})

test("bước 7: câu tóm tắt và chip tiêu chí theo thiết kế", () => {
  const c = r.readCriteria({ recipient: "ban-trai", occasions: ["sinh-nhat"], hobbies: ["bong-da", "anime-manga"], ageMin: 18, ageMax: 32, budgetMin: 200000, budgetMax: 600000 }, tagInfo)
  assert.equal(r.summaryOf(c, tagInfo), "Tìm quà sinh nhật cho bạn trai mê bóng đá và anime manga, 18 - 32 tuổi, tầm 200.000đ - 600.000đ")
  assert.deepEqual(r.chipsOf(c, tagInfo).map((x) => x.label), ["Bạn trai", "Sinh nhật", "Bóng đá", "Anime manga", "18 - 32 tuổi", "200.000đ - 600.000đ"])
  assert.equal(r.summaryOf(r.readCriteria({ budgetMax: 100000 }, tagInfo), tagInfo), "Tìm quà, dưới 100.000đ")
  assert.equal(r.gapKeyOf(r.readCriteria({ hobbies: ["gym"], budgetMax: 100000 }, tagInfo), tagInfo), "Gym + Dưới 100.000đ")
})

test("toInput / fromInput giữ nguyên khảo sát (lưu aiSessions.criteria rồi đọc lại khi tinh chỉnh)", () => {
  const c = r.applyNote(r.readCriteria({ recipient: "khac", personalities: ["nang-dong"], note: "thích game", ageMin: 20, ageMax: 40, budgetMax: 500000 }, tagInfo), tagInfo).criteria
  const back = r.fromInput(r.toInput(c, tagInfo), tagInfo)
  for (const f of ["recipient", "otherRecipient", "occasions", "hobbies", "personalities", "noteTags", "ageMin", "ageMax", "budgetMin", "budgetMax", "note"]) assert.deepEqual(back[f], c[f], f)
  assert.equal(r.toInput(c, tagInfo).recipient, "khac")
})

test("6Ec: thiếu hoặc hỏng model.json thì dùng dự phòng cosine (DU_PHONG); file đúng thì HOC_MAY kèm modelVersion", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-model-"))
  const warn = console.warn
  const log = console.log
  console.warn = console.log = () => {}
  try {
    assert.equal(engines.loadEngine(path.join(dir, "khong-co.json")).code, "DU_PHONG")
    fs.writeFileSync(path.join(dir, "hong.json"), "{ khong phai json")
    assert.equal(engines.loadEngine(path.join(dir, "hong.json")).code, "DU_PHONG")
    fs.writeFileSync(path.join(dir, "thieu.json"), JSON.stringify({ weights: [1, 2], bias: 0 }))
    assert.equal(engines.loadEngine(path.join(dir, "thieu.json")).code, "DU_PHONG")
    const real = engines.loadEngine(path.join(__dirname, "..", "ml", "model.json"))
    assert.equal(real.code, "HOC_MAY")
    assert.match(real.modelVersion, /^\d{4}-\d{2}-\d{2}$/)
  } finally {
    console.warn = warn
    console.log = log
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("NFR-PERF-03: xếp hạng catalog 60 sản phẩm bằng mô hình thật dưới 10 giây (thực tế vài ms)", () => {
  const { items, tagInfo: ti } = require("../ml/catalog").loadSeedCatalog()
  const log = console.log
  console.log = () => {}
  const eng = engines.loadEngine(path.join(__dirname, "..", "ml", "model.json"))
  console.log = log
  const started = Date.now()
  const out = eng.recommend(r.applyNote(r.readCriteria({ note: "anh ấy mê chơi game" }, ti), ti).criteria, items, ti)
  assert.ok(Date.now() - started < 10000)
  assert.ok(out.results.length >= 3)
  assert.ok(out.results.every((x) => x.reasons.length >= 1))
})
