import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-not-found',
  standalone: false,
  styleUrl: './not-found.scss',
  templateUrl: './not-found.html',
})
export class NotFound {
  private readonly router = inject(Router);
  keyword = '';

  // Ô tìm trên trang 404 dẫn tới SCR-02 chế độ tìm kiếm (UC-DIS-03)
  search(): void {
    const q = this.keyword.trim();
    this.router.navigate(q ? ['/tim-kiem'] : ['/san-pham'], q ? { queryParams: { q } } : {});
  }
}
