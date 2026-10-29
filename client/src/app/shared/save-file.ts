// Tải nội dung văn bản (CSV) về máy: gắn thẻ <a> vào trang rồi bấm, thu hồi URL sau khi trình duyệt đã bắt đầu tải.
// Thu hồi ngay sau click (cách cũ) làm một số trình duyệt (Firefox, Safari) không tải được tệp.
// Thêm lại BOM UTF-8: server có gửi BOM nhưng trình duyệt bỏ BOM khi đọc phản hồi dạng text, thiếu BOM thì Excel đọc
// tệp theo ANSI làm vỡ dấu tiếng Việt.
export function saveTextFile(content: string, fileName: string, type = 'text/csv;charset=utf-8'): void {
  const bom = type.startsWith('text/csv') && !content.startsWith('﻿') ? '﻿' : '';
  const url = URL.createObjectURL(new Blob([bom + content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
