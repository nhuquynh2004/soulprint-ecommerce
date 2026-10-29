// Đọc ảnh người dùng chọn thành chuỗi base64 (slide 6.7.3 dùng FileReader.readAsDataURL).
// Ảnh lớn được vẽ lại trên canvas, cạnh dài tối đa 1600px, nén WebP để dưới giới hạn 2MB của API-70.
const MAX_SIDE = 1600;
const MAX_BYTES = 2 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Không đọc được ảnh'));
    img.src = src;
  });
}

// Trả dataUrl sẵn sàng gửi lên server; ném lỗi kèm câu báo cho người dùng (5Eb)
export async function prepareImage(file: File, maxMb = 10): Promise<string> {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error(`${file.name}: chỉ nhận ảnh JPG, PNG hoặc WebP`);
  if (file.size > maxMb * 1024 * 1024) throw new Error(`${file.name}: ảnh quá ${maxMb}MB`);
  const original = await readAsDataUrl(file);
  const img = await loadImage(original);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  if (scale === 1 && file.size <= MAX_BYTES) return original;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.85, 0.7, 0.55]) {
    const out = canvas.toDataURL('image/webp', quality);
    if (out.length * 0.75 <= MAX_BYTES) return out;
  }
  throw new Error(`${file.name}: ảnh vẫn quá 2MB sau khi nén, hãy chọn ảnh nhỏ hơn`);
}
