import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

// Khung xem trước trang chủ (SCR-55) là iframe tới /?preview=draft của chính website.
// Angular chặn [src] của iframe nếu chưa đánh dấu tin cậy; chỉ nhận đường dẫn nội bộ bắt đầu bằng "/".
@Pipe({ name: 'safeUrl', standalone: false })
export class SafeUrlPipe implements PipeTransform {
  private readonly sanitizer = inject(DomSanitizer);

  transform(url: string): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(/^\/(?!\/)/.test(url) ? url : '/');
  }
}
