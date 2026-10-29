// Xử lý chữ tiếng Việt cho tìm kiếm (UC-DIS-03): khách gõ "binh giu nhiet" vẫn tìm ra "Bình giữ nhiệt".
// Cách làm: bỏ dấu từ khóa, rồi đổi mỗi chữ cái thành nhóm các chữ có dấu tương ứng để dùng với $regex của MongoDB
// (VD "binh" -> "b[iìíịỉĩ]nh"). Không cần lưu thêm trường "tên không dấu" trong products.
const ACCENT_GROUPS = {
  a: "aàáạảãâầấậẩẫăằắặẳẵ",
  e: "eèéẹẻẽêềếệểễ",
  i: "iìíịỉĩ",
  o: "oòóọỏõôồốộổỗơờớợởỡ",
  u: "uùúụủũưừứựửữ",
  y: "yỳýỵỷỹ",
  d: "dđ",
}

// "Bình Giữ Nhiệt" -> "binh giu nhiet"
function removeAccents(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, (c) => (c === "đ" ? "d" : "D"))
    .toLowerCase()
    .trim()
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

// Chuỗi regex khớp từ khóa, không phân biệt dấu (hoa thường xử lý bằng option "i").
// Ghi cả chữ hoa trong nhóm vì cờ "i" không chắc gộp được "Đ" với "đ" ở mọi bản MongoDB.
function accentInsensitivePattern(keyword) {
  const plain = removeAccents(keyword).replace(/\s+/g, " ")
  let pattern = ""
  for (const ch of plain) {
    if (ch === " ") pattern += "\\s+"
    else if (ACCENT_GROUPS[ch]) pattern += `[${ACCENT_GROUPS[ch]}${ACCENT_GROUPS[ch].toUpperCase()}]`
    else pattern += escapeRegex(ch)
  }
  return pattern
}

// Sắp xếp theo tên đúng thứ tự tiếng Việt (MongoDB mặc định so byte nên "Đồng hồ" đứng sau "Tượng")
const VI_COLLATION = { locale: "vi" }

module.exports = { removeAccents, accentInsensitivePattern, escapeRegex, VI_COLLATION }
