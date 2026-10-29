// Unit test quy tắc chat "Sâu Béo" (services/chatRules.js), không cần kết nối MongoDB
const test = require("node:test")
const assert = require("node:assert/strict")
const r = require("../services/chatRules")

const FAQS = [
  { _id: 1, keywords: ["phi ship", "van chuyen", "giao hang", "bao lau"], answer: "Phí đồng giá 30.000đ/đơn.", isActive: true },
  { _id: 2, keywords: ["doi tra", "tra hang", "hoan tien"], answer: "Đổi trả trong 7 ngày.", isActive: true },
  { _id: 3, keywords: ["bao lau nhan hang"], answer: "2-4 ngày.", isActive: true },
  { _id: 4, keywords: ["ai", "tu van"], answer: "Thử Tìm quà cùng AI.", isActive: true },
  { _id: 5, keywords: ["sticker"], answer: "Tắt.", isActive: false },
]
// 2026-10-13 10:00 giờ Việt Nam = 03:00 UTC
const vn = (h) => new Date(Date.UTC(2026, 9, 13, (h - 7 + 24) % 24, 0))

test("UC-CSK-01 AC1: hỏi không dấu vẫn ra câu phí vận chuyển", () => {
  assert.equal(r.matchFaq("phi ship bao nhieu", FAQS)._id, 1)
  assert.equal(r.matchFaq("Phí ship về Đà Nẵng bao nhiêu vậy?", FAQS)._id, 1)
})

test("UC-CAT-07 AC3: từ khóa dài khớp được ưu tiên", () => {
  assert.equal(r.matchFaq("bao lâu nhận hàng vậy", FAQS)._id, 3)
})

test("so khớp trọn từ", () => {
  assert.equal(r.matchFaq("mình bị giao sai màu", FAQS), null)
  assert.equal(r.matchFaq("thêm sticker được không", FAQS), null)
  assert.equal(r.matchFaq("AI tư vấn giúp mình", FAQS)._id, 4)
})

test("UC-CSK-01 5a: dấu hiệu khiếu nại, đòi gặp người thật", () => {
  assert.ok(r.wantsHuman("Tôi muốn khiếu nại"))
  assert.ok(r.wantsHuman("Shop lừa đảo à"))
  assert.ok(r.wantsHuman("Mình muốn đổi chữ in trên áo của đơn SP2610150001"))
  assert.ok(!r.wantsHuman("Chính sách đổi trả thế nào?"))
})

test("UC-CSK-01 bước 5: nhận biết câu hỏi về đơn", () => {
  assert.equal(r.orderCodeIn("đơn sp2610080003 sao chưa tới"), "SP2610080003")
  assert.ok(r.asksOrder("Đơn của mình giao chưa vậy"))
  assert.ok(r.asksOrder("Shop làm ăn chưa tốt, đơn trễ 2 ngày rồi"))
  assert.ok(!r.asksOrder("Phí ship bao nhiêu"))
})

test("UC-CSK-03: phát hiện gay gắt bằng từ điển có dấu, không bắt nhầm 'ngủ'", () => {
  assert.ok(r.isHarsh("Shop làm ăn tệ hại thật"))
  assert.ok(r.isHarsh("ĐƠN CỦA TÔI ĐÂU RỒI!!!"))
  assert.ok(!r.isHarsh("Tối qua mình ngủ quên nên chưa nhận hàng"))
  assert.ok(!r.isHarsh("Phí ship bao nhiêu?"))
})

test("UC-CSK-03: bản chuyển ngữ bỏ từ nặng, không còn chấm than dồn dập", () => {
  const s = r.soften("Shop làm ăn tệ hại, đơn trễ 2 ngày rồi!!!")
  assert.ok(s && !/tệ hại/.test(s) && !/!/.test(s))
  assert.match(s, /chưa tốt/)
  assert.match(s, /nhé\.$/)
  const caps = r.soften("ĐƠN CỦA TÔI ĐÂU RỒI!!!")
  assert.equal(caps.slice(0, 6), "Đơn củ")
})

test("UC-CSK-02 AC2: nhiều tin tiêu cực thì đỏ; cảm ơn thì xanh; câu hỏi thường thì cam", () => {
  assert.equal(r.sentiment(["Đơn trễ quá", "Hàng bị móp, thất vọng", "Không ai trả lời"]).sentiment, "TIEU_CUC")
  assert.equal(r.sentiment(["Cảm ơn shop, áo đẹp quá"]).sentiment, "TICH_CUC")
  assert.equal(r.sentiment(["Phí ship bao nhiêu?"]).sentiment, "TRUNG_TINH")
  assert.equal(r.SENTIMENT_LABEL.TIEU_CUC, "Bực bội")
})

test("UC-CSK-02 AC3: tóm tắt ghép câu hỏi chính, bỏ chào hỏi và nút gợi ý; chủ đề là câu đầu tiên", () => {
  const texts = ["chào", "Phí vận chuyển", "Phí ship về Đà Nẵng bao nhiêu?", "Mình muốn đổi số áo đơn SP2610150001"]
  assert.equal(r.summarize(texts), 'Khách hỏi: "Phí ship về Đà Nẵng bao nhiêu?"; "Mình muốn đổi số áo đơn SP2610150001".')
  assert.equal(r.topicOf(texts), "Phí ship về Đà Nẵng bao nhiêu?")
  assert.equal(r.summarize(["hi"]), null) // 2Ea
  assert.equal(r.topicOf([]), "Khách muốn gặp nhân viên")
})

test("UC-CSK-02 4Ea: giờ hỗ trợ 8:00-22:00 giờ Việt Nam và câu hẹn phản hồi", () => {
  assert.ok(r.isSupportHours(vn(8)))
  assert.ok(r.isSupportHours(vn(21)))
  assert.ok(!r.isSupportHours(vn(22)))
  assert.ok(!r.isSupportHours(vn(2)))
  assert.equal(r.replyPromise(vn(22)), "Nhân viên phản hồi trước 9:00 sáng mai.")
  assert.equal(r.replyPromise(vn(6)), "Nhân viên phản hồi trước 9:00 sáng nay.")
  assert.equal(r.replyPromise(vn(10)), "Nhân viên sẽ phản hồi bạn sớm nhất.")
})

test("thời gian chờ dự kiến = vị trí × 3 phút", () => {
  assert.equal(r.waitMinutes(2), 6)
  assert.equal(r.waitMinutes(0), 3)
})

test("UC-CSK-04 AC1: hàng đợi đỏ lên đầu rồi chờ lâu trước", () => {
  const q = r.sortQueue([
    { _id: "xanh", sentiment: "TICH_CUC", escalatedAt: new Date("2026-10-13T01:00:00Z") },
    { _id: "do", sentiment: "TIEU_CUC", escalatedAt: new Date("2026-10-13T02:00:00Z") },
    { _id: "cam", sentiment: "TRUNG_TINH", escalatedAt: new Date("2026-10-13T00:30:00Z") },
  ])
  assert.deepEqual(q.map((c) => c._id), ["do", "cam", "xanh"])
})

test("UC-CSK-04 AC5: bàn giao cho người ít việc nhất, chia đều; không ai trực thì trả hàng đợi", () => {
  const plan = r.planHandover(["c1", "c2", "c3"], [{ _id: "B", load: 1 }, { _id: "C", load: 0 }])
  assert.deepEqual(plan.map((p) => p.to._id), ["C", "B", "C"])
  assert.deepEqual(r.planHandover(["c1"], []), [{ id: "c1", to: null }])
})

test("liên hệ để lại ngoài giờ là SĐT hoặc email", () => {
  assert.equal(r.validContact("0901 234 567"), "0901234567")
  assert.equal(r.validContact("Minh.Anh@Gmail.com"), "minh.anh@gmail.com")
  assert.equal(r.validContact("12345"), null)
  assert.equal(r.validContact(""), null)
})

test("UC-CSK-01 3Ea, UC-CSK-04 4cEa: giới hạn độ dài tin, ghi chú", () => {
  assert.equal(r.textError("  ", 1000), "Tin nhắn không được để trống")
  assert.equal(r.textError("a".repeat(1001), 1000), "Tin nhắn tối đa 1000 ký tự")
  assert.equal(r.textError("a".repeat(501), 500, "Ghi chú"), "Ghi chú tối đa 500 ký tự")
  assert.equal(r.textError("ok", 500), null)
})

// ===== Nhãn hội thoại, nhắc trả lời =====

test("nhãn tự gắn: đơn gấp, khiếu nại, đổi trả, đơn hàng; không khớp thì Tư vấn", () => {
  assert.deepEqual(r.autoLabels({ texts: ["Shop ơi tư vấn quà cho bạn trai"] }), ["TU_VAN"])
  assert.deepEqual(r.autoLabels({ texts: ["Mình muốn đổi size áo"] }), ["DOI_TRA"])
  assert.deepEqual(r.autoLabels({ texts: ["Đơn SP2610180001 giao chưa shop"] }), ["DON_HANG"])
  assert.deepEqual(r.autoLabels({ texts: ["hàng bị hỏng, mình rất thất vọng"] }), ["KHIEU_NAI", "DOI_TRA"])
  assert.deepEqual(r.autoLabels({ texts: ["cần gấp"], urgentOpen: true }), ["DAT_GAP"])
  assert.deepEqual(r.autoLabels({ texts: ["giao chậm quá"], sentiment: "TIEU_CUC", urgentOpen: true }), ["DAT_GAP", "KHIEU_NAI", "DON_HANG"])
})

test("nhắc trả lời: đã xem tin cuối của khách mà quá 5 phút chưa trả lời", () => {
  const now = new Date("2026-10-18T10:00:00Z")
  const at = (min) => new Date(now.getTime() - min * 60000)
  // Đã xem, chờ 7 phút: nhắc
  assert.equal(r.replyReminder({ lastCustomerAt: at(7), lastStaffAt: at(10), staffSeenAt: at(6), now }).remindMinutes, 7)
  // Chưa xem: là chưa đọc, chưa nhắc
  const unseen = r.replyReminder({ lastCustomerAt: at(7), lastStaffAt: at(10), staffSeenAt: at(8), now })
  assert.equal(unseen.unread, true)
  assert.equal(unseen.remindMinutes, 0)
  // Đã trả lời sau tin của khách: không nhắc
  assert.equal(r.replyReminder({ lastCustomerAt: at(7), lastStaffAt: at(3), staffSeenAt: at(6), now }).needsReply, false)
  // Mới 2 phút: chưa nhắc
  assert.equal(r.replyReminder({ lastCustomerAt: at(2), lastStaffAt: null, staffSeenAt: at(1), now }).remindMinutes, 0)
})

test("hàng đợi: đơn gấp lên đầu, rồi bực bội, rồi chờ lâu", () => {
  const list = [
    { _id: 1, sentiment: "TRUNG_TINH", escalatedAt: "2026-10-18T01:00:00Z" },
    { _id: 2, sentiment: "TIEU_CUC", escalatedAt: "2026-10-18T02:00:00Z" },
    { _id: 3, sentiment: "TRUNG_TINH", escalatedAt: "2026-10-18T03:00:00Z", urgentOpen: true },
  ]
  assert.deepEqual(r.sortQueue(list).map((c) => c._id), [3, 2, 1])
})

test("UC-CSK-01 5a: hỏi đặt số lượng lớn, báo giá thì chuyển nhân viên", () => {
  assert.ok(r.wantsBulk("Chào Soulprint, mình muốn đặt số lượng lớn áo đấu"))
  assert.ok(r.wantsBulk("cho mình xin báo giá đặt sỉ 50 cái"))
  assert.ok(!r.wantsBulk("Phí vận chuyển bao nhiêu?"))
})
