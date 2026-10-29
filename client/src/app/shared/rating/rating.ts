import { Component, Input } from '@angular/core';

// Sao đánh giá (component Rating của bộ thiết kế): sao đầy, nửa sao, sao rỗng + điểm và số đánh giá.
@Component({
  selector: 'app-rating',
  standalone: false,
  templateUrl: './rating.html',
  styleUrl: './rating.scss',
})
export class Rating {
  @Input() value = 0;
  @Input() count: number | null = null;
  @Input() size = 16;
  @Input() showScore = true;

  get stars(): ('star' | 'star-half' | 'star-line')[] {
    return [1, 2, 3, 4, 5].map((i) => (this.value >= i ? 'star' : this.value >= i - 0.5 ? 'star-half' : 'star-line'));
  }

  get score(): string {
    return this.value.toFixed(1).replace('.', ',');
  }
}
