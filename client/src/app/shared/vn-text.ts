// Bỏ dấu tiếng Việt, sinh đường dẫn và mã giá trị biến thể - cùng quy tắc với server (utils/vnText.js, services/productAdmin.js)
// để form hiện trước slug, SKU biến thể như server sẽ lưu.
export function removeAccents(text: string): string {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

// "Áo đấu CLB" -> "ao-dau-clb"
export function slugify(text: string): string {
  return removeAccents(text).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
}

// "Xanh navy" -> "XANHNAVY"
export function valueCode(value: string): string {
  return removeAccents(value).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'X';
}
