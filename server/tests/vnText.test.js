const test = require("node:test")
const assert = require("node:assert")
const { removeAccents, accentInsensitivePattern } = require("../utils/vnText")

const matches = (keyword, text) => new RegExp(accentInsensitivePattern(keyword), "i").test(text)

test("bỏ dấu tiếng Việt, kể cả chữ đ", () => {
  assert.equal(removeAccents("Bình Giữ Nhiệt Đỏ"), "binh giu nhiet do")
})

test("gõ không dấu vẫn khớp tên có dấu (UC-DIS-03 AC1)", () => {
  assert.ok(matches("binh giu nhiet", "Bình giữ nhiệt thể thao 750ml khắc tên"))
})

test("gõ có dấu hoặc sai dấu vẫn khớp, không phân biệt hoa thường", () => {
  assert.ok(matches("BÌNH GIỮ", "Bình giữ nhiệt"))
  assert.ok(matches("bính giư", "Bình giữ nhiệt"))
  assert.ok(matches("do do", "Áo đấu Đỏ đô"))
})

test("không khớp từ khác", () => {
  assert.equal(matches("ban phim", "Bình giữ nhiệt"), false)
})

test("ký tự đặc biệt của regex được thoát", () => {
  assert.ok(matches("750ml (", "Bình 750ml (mới)"))
  assert.equal(matches(".*", "Bình giữ nhiệt"), false)
})
