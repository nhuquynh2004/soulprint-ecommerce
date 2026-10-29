import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import {
  IEngraveConfig,
  IPersonalization,
  IPersonalizeProduct,
  ISavedDesign,
  STICKER_MAX,
  charCount,
  engraveConfigOf,
} from '../../classes/cart';
import { IVariant } from '../../classes/product';
import { AuthService } from '../../services/auth';
import { DesignApiService } from '../../services/design-apiservice';
import { LoginPromptService } from '../../services/login-prompt';
import { ToastService } from '../../services/toast';

export type PersonalizeTab = 'NONE' | 'IN_KHAC' | 'THIET_KE';
export interface PersonalizeResult {
  personalization: IPersonalization | null;
  variantSku?: string;
}

// SCR-04 Hộp thoại cá nhân hóa (UC-CRT-01 bước 3-6, nhánh 2a, 4a, 5a; UC-CRT-03 nhánh 3d).
// Signal giữ nội dung đang nhập, computed() tính tạm tính và điều kiện bật nút "Áp dụng" ngay khi gõ (Chương II).
// @switch hiển thị ô nhập theo tab và theo chế độ In/Khắc Thường/Áo đấu. Kết quả gửi lên trang cha qua @Output applied.
// Member bấm Áp dụng thì tự lưu vào Thiết kế đã lưu (ô tên điền sẵn tên tự động, bỏ tick để không lưu); đầu form
// có các thiết kế đã lưu của chính sản phẩm này, bấm để nạp lại nội dung.
@Component({
  selector: 'app-personalize-dialog',
  standalone: false,
  templateUrl: './personalize-dialog.html',
  styleUrl: './personalize-dialog.scss',
})
export class PersonalizeDialog implements OnInit {
  @Input({ required: true }) product!: IPersonalizeProduct;
  @Input() variantLabel = '';
  @Input() unitPrice = 0;
  @Input() quantity = 1;
  @Input() stickerFee = 5000;
  @Input() initial: IPersonalization | null = null;
  @Input() startTab: PersonalizeTab | null = null;
  // Mở từ giỏ hàng: cho đổi biến thể (UC-CRT-03 3d)
  @Input() variants: IVariant[] = [];
  @Input() variantSku = '';
  @Input() applyLabel = 'Áp dụng';
  // Đơn nháp (S8): nhân viên soạn hộ khách nên không tự lưu thiết kế vào tài khoản của mình
  @Input() allowSave = true;
  // Nhân viên mở hộp (đổi sản phẩm ở SCR-48): bỏ các câu nhắn riêng cho khách
  @Input() staffMode = false;
  // Khách sửa cá nhân hóa của đơn (UC-TRK-06): không có tab "Không cá nhân hóa"
  @Input() allowNone = true;
  @Input() error = '';
  @Input() busy = false;
  @Output() applied = new EventEmitter<PersonalizeResult>();
  @Output() closed = new EventEmitter<void>();

  private readonly auth = inject(AuthService);
  private readonly designApi = inject(DesignApiService);
  private readonly prompt = inject(LoginPromptService);
  private readonly toast = inject(ToastService);

  readonly STICKER_MAX = STICKER_MAX;

  readonly tab = signal<PersonalizeTab>('NONE');
  readonly text = signal('');
  readonly top = signal('');
  readonly number = signal('');
  readonly bottom = signal('');
  readonly stickers = signal<string[]>([]);
  // Ô In/Khắc vừa bị gõ quá giới hạn (5Ea): đủ giới hạn vẫn bình thường, gõ thêm mới báo đỏ
  readonly overField = signal<'text' | 'top' | 'bottom' | null>(null);
  readonly sku = signal('');
  readonly breakOpen = signal(false);
  readonly limitHint = signal(false);
  readonly saveOn = signal(true);
  readonly designName = signal('');
  readonly myDesigns = signal<ISavedDesign[]>([]);
  readonly loadedId = signal<string | null>(null);

  readonly isMember = computed(() => this.auth.currentUser()?.role === 'member');

  engrave: IEngraveConfig = { mode: 'THUONG', maxChars: 20 };

  types(): string[] {
    return this.product.personalization.types || [];
  }

  // Sticker đang áp dụng theo mã, để hiện tên/ảnh trong xem trước và bảng giá
  readonly stickerMap = computed(() => new Map(this.product.stickerSets.flatMap((s) => s.stickers.map((x) => [x.code, x] as const))));
  readonly chosenStickers = computed(() => this.stickers().map((c) => this.stickerMap().get(c)).filter((x) => !!x));

  readonly fee = computed(() => (this.tab() === 'THIET_KE' ? this.stickers().length * this.stickerFee : 0));
  readonly price = computed(() => {
    const v = this.variants.find((x) => x.sku === this.sku());
    return v ? this.unitPrice - (this.variants.find((x) => x.sku === this.variantSku)?.priceDelta ?? 0) + v.priceDelta : this.unitPrice;
  });
  readonly perUnit = computed(() => this.price() + this.fee());
  readonly total = computed(() => this.perUnit() * this.quantity);

  // Nội dung hợp lệ thì mới bật "Áp dụng" (5Ea, 5Eb, 2aEd)
  readonly content = computed<IPersonalization | null>(() => {
    switch (this.tab()) {
      case 'IN_KHAC':
        if (this.engrave.mode === 'AO_DAU') {
          return { type: 'IN_KHAC', mode: 'AO_DAU', top: this.top().trim(), number: this.number().trim(), bottom: this.bottom().trim() };
        }
        return { type: 'IN_KHAC', mode: 'THUONG', text: this.text().trim() };
      case 'THIET_KE':
        return { type: 'THIET_KE', stickers: this.stickers() };
      default:
        return null;
    }
  });

  readonly invalidReason = computed(() => {
    const c = this.content();
    if (!c) return '';
    if (c.type === 'IN_KHAC') {
      if (c.mode === 'THUONG') {
        if (!c.text) return 'Nhập nội dung in/khắc hoặc chọn Không cá nhân hóa';
        if (charCount(c.text) > (this.engrave.maxChars ?? 20)) return `Tối đa ${this.engrave.maxChars} ký tự`;
      } else if (!c.top && !c.number && !c.bottom) return 'Nhập nội dung in/khắc hoặc chọn Không cá nhân hóa';
      return '';
    }
    if (!c.stickers.length) return 'Chọn ít nhất 1 sticker';
    return '';
  });

  // Tên tự động giống server (pz.suggestDesignName): 2 chữ đầu tên sản phẩm - nội dung
  readonly autoName = computed(() => {
    const c = this.content();
    if (!c || this.invalidReason()) return '';
    const short = this.product.name.split(' ').slice(0, 2).join(' ');
    const detail = c.type === 'IN_KHAC' ? (c.mode === 'AO_DAU' ? [c.top, c.number, c.bottom].filter(Boolean).join(' ') : c.text) : `${c.stickers.length} sticker`;
    return `${short} - ${detail}`.slice(0, 60);
  });

  readonly selectedVariantOut = computed(() => {
    const v = this.variants.find((x) => x.sku === this.sku());
    return !!v && v.stock < this.quantity;
  });

  ngOnInit(): void {
    this.engrave = engraveConfigOf(this.product);
    this.sku.set(this.variantSku);
    const p = this.initial;
    if (p?.type === 'IN_KHAC') {
      if (p.mode === 'AO_DAU') {
        this.top.set(p.top);
        this.number.set(p.number);
        this.bottom.set(p.bottom);
      } else this.text.set(p.text);
    } else if (p?.type === 'THIET_KE') {
      this.stickers.set(p.stickers.filter((c) => this.stickerMap().has(c)));
    }
    const fallback: PersonalizeTab = p ? p.type : 'NONE';
    const wanted = this.startTab ?? fallback;
    const tab = wanted === 'NONE' || this.types().includes(wanted) ? wanted : 'NONE';
    this.tab.set(tab === 'NONE' && !this.allowNone ? (this.types()[0] as PersonalizeTab) || 'NONE' : tab);
    if (this.allowSave && this.isMember()) {
      this.designApi.getDesigns('CA_NHAN_HOA').subscribe({
        next: (list) => this.myDesigns.set(list.filter((d) => d.productId === this.product._id && d.usable).slice(0, 6)),
        error: () => this.myDesigns.set([]),
      });
    }
  }

  // Bấm 1 thiết kế đã lưu: nạp nội dung, giữ tên để lần lưu sau cập nhật đúng bản đó
  loadDesign(d: ISavedDesign): void {
    const p = d.personalization;
    if (!p || !this.types().includes(p.type)) return;
    if (p.type === 'IN_KHAC') {
      if (p.mode === 'AO_DAU') {
        this.top.set(p.top);
        this.number.set(p.number);
        this.bottom.set(p.bottom);
      } else this.text.set(p.text);
    } else {
      this.stickers.set(p.stickers.filter((c) => this.stickerMap().has(c)).slice(0, STICKER_MAX));
    }
    this.tab.set(p.type);
    this.designName.set(d.name);
    this.loadedId.set(d._id);
  }

  askLogin(): void {
    this.prompt.ask('Đăng nhập để tự lưu thiết kế và dùng lại cho lần tặng sau');
  }

  // Giữ đúng giới hạn khi gõ: không cho gõ thêm quá giới hạn, gõ thêm thì báo đỏ tới khi xóa bớt (5Ea, AC2); số áo chỉ nhận chữ số (5Ec)
  onText(field: 'text' | 'top' | 'bottom', el: HTMLInputElement): void {
    const chars = Array.from(el.value.normalize('NFC'));
    const max = this.maxOf(field);
    if (chars.length > max) {
      el.value = chars.slice(0, max).join('');
      this.overField.set(field);
    } else if (chars.length < max && this.overField() === field) this.overField.set(null);
    this[field].set(el.value);
  }

  maxOf(field: 'text' | 'top' | 'bottom'): number {
    return (field === 'text' ? this.engrave.maxChars : field === 'top' ? this.engrave.topMaxChars : this.engrave.bottomMaxChars) ?? 20;
  }

  onNumber(el: HTMLInputElement): void {
    el.value = el.value.replace(/\D/g, '').slice(0, this.engrave.numberMaxDigits);
    this.number.set(el.value);
  }

  count(value: string): number {
    return charCount(value);
  }

  // Chọn/bỏ sticker; đủ 3 thì không nhận thêm và nhắc (2aEc)
  toggleSticker(code: string): void {
    const list = this.stickers();
    if (list.includes(code)) {
      this.stickers.set(list.filter((c) => c !== code));
      this.limitHint.set(false);
    } else if (list.length >= STICKER_MAX) {
      this.limitHint.set(true);
    } else {
      this.stickers.set([...list, code]);
    }
  }

  apply(): void {
    if (this.invalidReason() || this.busy) return;
    this.autoSave();
    this.applied.emit({ personalization: this.content(), variantSku: this.variants.length ? this.sku() : undefined });
  }

  // Tự lưu: không chặn Áp dụng; trùng nội dung thì server cập nhật tên bản đã có
  private autoSave(): void {
    const content = this.content();
    if (!content || !this.allowSave || !this.saveOn() || !this.isMember()) return;
    const name = this.designName().trim() || this.autoName();
    this.designApi.createDesign({ kind: 'CA_NHAN_HOA', productId: this.product._id, name, personalization: content }).subscribe({
      next: (d) => this.toast.show(`Đã lưu thiết kế "${d.name}" vào Thiết kế đã lưu`),
      error: (err) => this.toast.show(`Chưa lưu được thiết kế: ${err.message}`, 'info'),
    });
  }
}
