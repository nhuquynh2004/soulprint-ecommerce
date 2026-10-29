import { Component, Input } from '@angular/core';

// Nội dung cá nhân hóa trong đơn (bản chụp): Thiết kế lưu sticker kèm tên, ảnh; In/Khắc thường hoặc áo đấu
export interface PzSnapshot {
  type: 'IN_KHAC' | 'THIET_KE';
  mode?: 'THUONG' | 'AO_DAU';
  text?: string;
  top?: string;
  number?: string;
  bottom?: string;
  stickers?: (string | { code: string; name?: string; image?: string | null })[];
  message?: string;
}

// Dòng mô tả cho phiếu đóng gói và tóm tắt: ghi rõ tên, mã sticker, từng dòng áo đấu, lời nhắn
export function pzDetailLines(p: PzSnapshot | null | undefined): string[] {
  if (!p) return [];
  if (p.type === 'IN_KHAC') {
    if (p.mode === 'AO_DAU') return [`Áo đấu: Dòng trên "${p.top || ''}" | Số áo "${p.number || ''}" | Dòng dưới "${p.bottom || ''}"`];
    return [`In/Khắc: "${p.text || ''}"`];
  }
  const stickers = (p.stickers || []).map((s) => (typeof s === 'string' ? s : s.name && s.name !== s.code ? `${s.name} (${s.code})` : s.code));
  const out = [`Thiết kế ${stickers.length} sticker: ${stickers.join(', ') || 'không có'}`];
  if (p.message) out.push(`Lời nhắn in trên sản phẩm: "${p.message}"`);
  return out;
}

// Khối "Cá nhân hóa" ở SCR-48 và hộp xem trước (cùng kiểu khối Gói quà): nhân viên thấy từng sticker (ảnh, tên, mã),
// nội dung In/Khắc hoặc 3 dòng áo đấu, lời nhắn; ng-content cho nút Xem trước
@Component({
  selector: 'app-pz-preview',
  standalone: false,
  template: `
    <div class="sp-pzp__head">
      <app-icon name="wand" [size]="18" />
      <strong>{{ title() }}</strong>
      <span class="ms-auto d-inline-flex align-items-center gap-2"><ng-content /></span>
    </div>
    <div class="sp-pzp__parts">
      @for (p of parts(); track $index) {
        <figure [class.is-text]="!p.sticker">
          @if (p.sticker) {
            @if (p.image) {
              <img [src]="p.image" alt="" width="48" height="48" />
            } @else {
              <span class="sp-pzp__noimg"><app-icon name="wand" [size]="18" /></span>
            }
          }
          <figcaption>
            <small>{{ p.label }}</small>
            <span>{{ p.value || '(trống)' }}</span>
            @if (p.code && p.code !== p.value) {
              <code>{{ p.code }}</code>
            }
          </figcaption>
        </figure>
      }
    </div>
    @if (pz.message) {
      <p class="sp-pzp__msg">Lời nhắn in trên sản phẩm: “{{ pz.message }}”</p>
    }
  `,
  styles: `
    :host { display: block; padding: 12px; border: 1px solid var(--sp-color-warning); border-radius: var(--sp-radius-md); background: var(--sp-color-warning-subtle); }
    .sp-pzp__head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-size: 14px; }
    .sp-pzp__parts { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
    figure { display: flex; align-items: center; gap: 8px; margin: 0; padding: 6px 8px; border-radius: var(--sp-radius-sm); background: var(--sp-color-surface); }
    img, .sp-pzp__noimg { flex: none; width: 48px; height: 48px; border-radius: var(--sp-radius-sm); object-fit: cover; }
    .sp-pzp__noimg { display: inline-flex; align-items: center; justify-content: center; background: var(--sp-color-primary-subtle); color: var(--sp-color-primary); }
    figcaption { display: flex; flex-direction: column; min-width: 0; font-size: 13px; line-height: 18px; }
    figcaption small { font-size: 11px; color: var(--sp-color-text-muted); text-transform: uppercase; letter-spacing: .04em; }
    figcaption span { font-weight: 600; overflow-wrap: anywhere; }
    figure.is-text figcaption span { font-size: 16px; line-height: 22px; letter-spacing: .02em; }
    code { font-size: 11px; color: var(--sp-color-text-muted); }
    .sp-pzp__msg { margin: 10px 0 0; font-size: 13px; font-style: italic; }
  `,
})
export class PzPreview {
  @Input({ required: true }) pz!: PzSnapshot;

  title(): string {
    const p = this.pz;
    if (p.type === 'THIET_KE') return `Cá nhân hóa: Thiết kế (${(p.stickers || []).length} sticker)`;
    return p.mode === 'AO_DAU' ? 'Cá nhân hóa: In/Khắc áo đấu' : 'Cá nhân hóa: In/Khắc';
  }

  parts(): { label: string; value: string; code?: string; image?: string | null; sticker?: boolean }[] {
    const p = this.pz;
    if (p.type === 'IN_KHAC') {
      if (p.mode === 'AO_DAU') {
        return [
          { label: 'Dòng trên', value: p.top || '' },
          { label: 'Số áo', value: p.number || '' },
          { label: 'Dòng dưới', value: p.bottom || '' },
        ];
      }
      return [{ label: 'Nội dung in/khắc', value: p.text || '' }];
    }
    return (p.stickers || []).map((s, i) =>
      typeof s === 'string'
        ? { label: `Sticker ${i + 1}`, value: s, sticker: true }
        : { label: `Sticker ${i + 1}`, value: s.name || s.code, code: s.code, image: s.image || null, sticker: true },
    );
  }
}
