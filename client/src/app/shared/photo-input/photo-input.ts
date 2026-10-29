import { Component, Input, forwardRef, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

const MB = 1024 * 1024;
// Ảnh thu nhỏ cạnh dài tối đa 1600px trước khi gửi: giữ đủ rõ để thấy lỗi, chuỗi base64 nhỏ
const MAX_SIDE = 1600;

// Đọc ảnh bằng FileReader (slide 6.7.3) rồi vẽ lại lên canvas thành JPEG để giảm dung lượng gửi đi
function shrinkImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode'));
      img.onload = () => {
        const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d')!;
        // Nền trắng cho ảnh PNG trong suốt
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

// Ô tải ảnh (và video) dùng chung cho đổi trả SCR-25, bảo hành SCR-26, đánh giá SCR-27, bằng chứng từ chối SCR-50.
// Là ControlValueAccessor nên gắn được formControlName trong Reactive Form (Chương V); giá trị là mảng chuỗi:
// data URL của ảnh mới hoặc đường dẫn /api/files/<id> của ảnh đã lưu (khi sửa đánh giá).
@Component({
  selector: 'app-photo-input',
  standalone: false,
  templateUrl: './photo-input.html',
  styleUrl: './photo-input.scss',
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => PhotoInput), multi: true }],
})
export class PhotoInput implements ControlValueAccessor {
  @Input() max = 5;
  @Input() maxMB = 10;
  // Chỉ nhân viên gửi video bằng chứng (khách không gửi video)
  @Input() allowVideo = false;
  @Input() videoMaxMB = 8;
  @Input() hint = '';
  @Input() invalid = false;
  @Input() inputId = 'photo-' + Math.random().toString(36).slice(2, 8);

  readonly items = signal<string[]>([]);
  readonly error = signal('');
  readonly reading = signal(false);
  disabled = false;

  private onChange: (v: string[]) => void = () => {};
  onTouched: () => void = () => {};

  writeValue(v: string[] | null): void {
    this.items.set(Array.isArray(v) ? v : []);
  }

  registerOnChange(fn: (v: string[]) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.disabled = disabled;
  }

  isVideo(x: string): boolean {
    return x.startsWith('data:video/');
  }

  get videoCount(): number {
    return this.items().filter((x) => this.isVideo(x)).length;
  }

  get imageCount(): number {
    return this.items().length - this.videoCount;
  }

  get accept(): string {
    return this.allowVideo ? 'image/jpeg,image/png,video/mp4' : 'image/jpeg,image/png';
  }

  async pick(input: HTMLInputElement): Promise<void> {
    const files = Array.from(input.files || []);
    input.value = '';
    if (!files.length) return;
    this.error.set('');
    this.reading.set(true);
    const next = [...this.items()];
    for (const f of files) {
      const video = f.type === 'video/mp4';
      if (!video && !['image/jpeg', 'image/png'].includes(f.type)) {
        this.error.set(`${f.name}: chỉ nhận ảnh JPG, PNG${this.allowVideo ? ' hoặc video MP4' : ''}`);
        continue;
      }
      if (video && !this.allowVideo) {
        this.error.set('Chỉ gửi ảnh, không gửi video');
        continue;
      }
      if (video ? next.some((x) => this.isVideo(x)) : next.filter((x) => !this.isVideo(x)).length >= this.max) {
        this.error.set(video ? 'Tối đa 1 video' : `Tối đa ${this.max} ảnh`);
        continue;
      }
      const limit = video ? this.videoMaxMB : this.maxMB;
      if (f.size > limit * MB) {
        this.error.set(`${video ? 'Video' : 'Ảnh'} vượt quá ${limit}MB, vui lòng chọn tệp khác`);
        continue;
      }
      try {
        next.push(video ? await readAsDataUrl(f) : await shrinkImage(f));
      } catch {
        this.error.set(`${f.name}: không đọc được tệp`);
      }
    }
    this.reading.set(false);
    this.items.set(next);
    this.onChange(next);
    this.onTouched();
  }

  remove(i: number): void {
    const next = this.items().filter((_, k) => k !== i);
    this.items.set(next);
    this.onChange(next);
    this.onTouched();
  }
}
