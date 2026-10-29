import { Component, Input } from '@angular/core';

export interface GiftPreviewData {
  name: string;
  source?: 'GOI_Y' | 'CUA_TOI' | 'TAO_MOI' | string; // nguồn mẫu để nhân viên biết mẫu chọn sẵn hay khách tự tạo
  image?: string | null;
  paper?: { code?: string; name: string; image?: string | null } | null;
  ribbon?: { code?: string; name: string; image?: string | null } | null;
  card?: { code?: string; name: string; image?: string | null } | null;
  message?: string;
}

// Khối "Gói quà: [tên]" ở đơn nháp, đơn gấp, chi tiết đơn: ảnh, tên và mã giấy gói, ruy băng, thiệp để nhân viên
// duyệt mẫu và nhân viên đóng gói lấy đúng vật liệu; ng-content cho nút Đổi, Bỏ hoặc phí.
@Component({
  selector: 'app-gift-preview',
  standalone: false,
  template: `
    <div class="sp-gprev__head">
      <app-icon name="gift" [size]="18" />
      <strong>Gói quà: {{ gift.name }}</strong>
      @if (sourceLabel()) {
        <small class="sp-gprev__src">{{ sourceLabel() }}</small>
      }
      <span class="ms-auto d-inline-flex align-items-center gap-2"><ng-content /></span>
    </div>
    <div class="sp-gprev__parts">
      @for (p of parts(); track p.label) {
        <figure>
          @if (p.image) {
            <img [src]="p.image" alt="" width="48" height="48" />
          } @else {
            <span class="sp-gprev__noimg"><app-icon name="gift" [size]="18" /></span>
          }
          <figcaption>
            <small>{{ p.label }}</small>
            <span>{{ p.name }}</span>
            @if (p.code && p.code !== p.name) {
              <code>{{ p.code }}</code>
            }
          </figcaption>
        </figure>
      }
    </div>
    @if (gift.message) {
      <p class="sp-gprev__msg">Lời nhắn trên thiệp: “{{ gift.message }}”</p>
    }
  `,
  styles: `
    :host { display: block; padding: 12px; border: 1px solid var(--sp-color-border); border-radius: var(--sp-radius-md); background: var(--sp-color-surface-alt); }
    .sp-gprev__head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-size: 14px; }
    .sp-gprev__parts { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
    figure { display: flex; align-items: center; gap: 8px; margin: 0; padding: 6px; border-radius: var(--sp-radius-sm); background: var(--sp-color-surface); }
    img, .sp-gprev__noimg { flex: none; width: 48px; height: 48px; border-radius: var(--sp-radius-sm); object-fit: cover; }
    .sp-gprev__noimg { display: inline-flex; align-items: center; justify-content: center; background: var(--sp-color-primary-subtle); color: var(--sp-color-primary); }
    figcaption { display: flex; flex-direction: column; min-width: 0; font-size: 13px; line-height: 18px; }
    figcaption small { font-size: 11px; color: var(--sp-color-text-muted); text-transform: uppercase; letter-spacing: .04em; }
    figcaption span { font-weight: 600; }
    code { font-size: 11px; color: var(--sp-color-text-muted); }
    .sp-gprev__msg { margin: 10px 0 0; font-size: 13px; font-style: italic; }
    .sp-gprev__src { font-size: 12px; color: var(--sp-color-text-muted); }
  `,
})
export class GiftPreview {
  @Input({ required: true }) gift!: GiftPreviewData;

  sourceLabel(): string {
    return ({ GOI_Y: 'Mẫu gợi ý', CUA_TOI: 'Mẫu của khách', TAO_MOI: 'Khách tự tạo' } as Record<string, string>)[this.gift.source || ''] || '';
  }

  parts(): { label: string; name: string; code?: string; image?: string | null }[] {
    const g = this.gift;
    const out = [
      { label: 'Giấy gói', x: g.paper },
      { label: 'Ruy băng', x: g.ribbon },
      { label: 'Thiệp', x: g.card },
    ];
    return out.filter((p) => !!p.x).map((p) => ({ label: p.label, name: p.x!.name, code: p.x!.code, image: p.x!.image }));
  }
}
