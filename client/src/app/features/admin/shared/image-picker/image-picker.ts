import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AdminCatalogApiService } from '../../../../services/admin-catalog-apiservice';
import { prepareImage } from './image-file';

// Ô ảnh dùng chung của các form quản trị: ảnh sản phẩm (tối đa 10, ảnh đầu là ảnh đại diện), ảnh theo giá trị biến thể,
// ảnh danh mục, ảnh bìa bộ sưu tập, ảnh banner (max = 1). Tải lên bằng API-70 rồi phát danh sách URL /api/files/<id>.
// Kéo thả đổi thứ tự bằng sự kiện drag and drop của HTML5 (không thư viện - ghi chú kỹ thuật UC-CAT-05).
@Component({
  selector: 'app-image-picker',
  standalone: false,
  templateUrl: './image-picker.html',
  styleUrl: './image-picker.scss',
})
export class ImagePicker {
  @Input() images: string[] = [];
  @Input() max = 10;
  @Input() label = 'Thêm ảnh';
  @Input() compact = false;
  @Output() imagesChange = new EventEmitter<string[]>();

  private readonly api = inject(AdminCatalogApiService);
  readonly uploading = signal(false);
  readonly error = signal('');
  private dragFrom: number | null = null;

  async onFiles(input: HTMLInputElement): Promise<void> {
    const files = Array.from(input.files || []).slice(0, this.max - this.images.length);
    input.value = '';
    if (!files.length) return;
    this.error.set('');
    this.uploading.set(true);
    try {
      const prepared = await Promise.all(files.map(async (f) => ({ name: f.name, dataUrl: await prepareImage(f) })));
      const saved = await firstValueFrom(this.api.upload(prepared));
      this.emit(this.max === 1 ? [saved[0].url] : [...this.images, ...saved.map((s) => s.url)]);
    } catch (err: any) {
      this.error.set(err?.message || 'Tải ảnh thất bại');
    } finally {
      this.uploading.set(false);
    }
  }

  remove(i: number): void {
    this.emit(this.images.filter((_, k) => k !== i));
  }

  makeMain(i: number): void {
    const list = [...this.images];
    const [img] = list.splice(i, 1);
    this.emit([img, ...list]);
  }

  onDragStart(i: number): void {
    this.dragFrom = i;
  }

  onDrop(i: number, e: DragEvent): void {
    e.preventDefault();
    if (this.dragFrom === null || this.dragFrom === i) return;
    const list = [...this.images];
    const [img] = list.splice(this.dragFrom, 1);
    list.splice(i, 0, img);
    this.dragFrom = null;
    this.emit(list);
  }

  private emit(list: string[]): void {
    this.images = list;
    this.imagesChange.emit(list);
  }
}
