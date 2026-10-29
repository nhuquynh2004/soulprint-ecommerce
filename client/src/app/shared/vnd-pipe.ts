import { Pipe, PipeTransform } from '@angular/core';

// Định dạng tiền VNĐ: 399000 -> "399.000đ" (tiền lưu số nguyên VNĐ).
@Pipe({ name: 'vnd', standalone: false })
export class VndPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    if (value === null || value === undefined || isNaN(value)) return '';
    return Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.') + 'đ';
  }
}
