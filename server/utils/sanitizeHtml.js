// Lọc HTML do nhân viên soạn (mô tả sản phẩm, chính sách, khối chữ trang chủ) theo danh sách thẻ cho phép
// (06 Mục 2.4, NFR-SEC-14): chỉ p, strong, em, ul, ol, li, a[href], br. Thẻ khác bị bỏ (giữ chữ bên trong),
// script/style bị bỏ cả nội dung, mọi thuộc tính bị bỏ trừ href an toàn của thẻ a. Không cài thư viện.
const ALLOWED = new Set(["p", "strong", "em", "ul", "ol", "li", "a", "br"])
const RENAME = { b: "strong", i: "em" }

const escapeAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

// Chỉ nhận liên kết http(s), đường dẫn nội bộ, mailto, tel; chặn javascript:, data:...
function isSafeUrl(url) {
  const u = String(url || "").trim()
  return /^(https?:\/\/|\/(?!\/)|mailto:|tel:|#)/i.test(u) && !/^\s*(javascript|data|vbscript):/i.test(u)
}

function sanitizeHtml(html) {
  let s = String(html || "")
  s = s.replace(/<(script|style|iframe|object|embed|template|svg|math)\b[\s\S]*?<\/\1\s*>/gi, "")
  s = s.replace(/<(script|style|iframe|object|embed|template|svg|math)\b[^>]*\/?>/gi, "")
  s = s.replace(/<!--[\s\S]*?-->/g, "")
  s = s.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (whole, rawTag, attrs) => {
    const tag = RENAME[rawTag.toLowerCase()] || rawTag.toLowerCase()
    if (!ALLOWED.has(tag)) return ""
    if (whole.startsWith("</")) return tag === "br" ? "" : `</${tag}>`
    if (tag === "br") return "<br>"
    if (tag === "a") {
      const m = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs)
      const url = m ? (m[1] ?? m[2] ?? m[3]) : ""
      return isSafeUrl(url) ? `<a href="${escapeAttr(url)}" rel="noopener">` : "<a>"
    }
    return `<${tag}>`
  })
  // Dấu < còn sót (không phải thẻ hợp lệ) đổi thành ký tự an toàn
  return s.replace(/<(?!\/?(p|strong|em|ul|ol|li|a|br)\b)/gi, "&lt;").trim()
}

// Văn bản thuần (để kiểm tra nội dung rỗng)
const textOf = (html) => String(html || "").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim()

module.exports = { sanitizeHtml, textOf, isSafeUrl }
