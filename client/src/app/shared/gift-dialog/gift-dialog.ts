import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { GIFT_MESSAGE_MAX, GiftWrapRequest, IGiftMaterial, IGiftTemplate, IGiftWrapView, IGiftWraps, ISavedDesign, charCount } from '../../classes/cart';
import { CartApiService } from '../../services/cart-apiservice';
import { DesignApiService } from '../../services/design-apiservice';
import { AuthService } from '../../services/auth';
import { ToastService } from '../../services/toast';
import { ApiError } from '../../classes/api-error';

type GiftTab = 'GOI_Y' | 'CUA_TOI' | 'TAO_MOI';
type Slot = 'paper' | 'ribbon' | 'card';
const SLOT_KIND = { paper: 'GIAY_GOI', ribbon: 'RUY_BANG', card: 'THIEP' } as const;

// SCR-06 Hộp thoại gói quà (UC-CRT-04, UC-ACC-06): 3 tab Mẫu gợi ý / Mẫu của tôi / Tạo mới 3 bước, dùng @switch (Chương II).
// mode "cart": chọn gói quà cho giỏ, gửi yêu cầu API-35 lên trang cha qua @Output applied.
// mode "edit": sửa một mẫu gói quà đã lưu ở SCR-21 (chỉ hiện các bước Tạo mới, lưu bằng API-16).
// staff (đơn nháp, đơn gấp): tab 2 là "Mẫu của khách" (mẫu khách chọn lúc gửi, chọn để quay lại mẫu gốc);
// Tạo mới điền sẵn mẫu đang áp dụng để nhân viên sửa giúp khách, giữ tên mẫu; không có "Lưu thành mẫu của tôi".
@Component({
  selector: 'app-gift-dialog',
  standalone: false,
  templateUrl: './gift-dialog.html',
  styleUrl: './gift-dialog.scss',
})
export class GiftDialog implements OnInit {
  @Input() mode: 'cart' | 'edit' = 'cart';
  @Input() current: IGiftWrapView | null = null;
  @Input() editDesign: ISavedDesign | null = null;
  @Input() busy = false;
  @Input() error = '';
  @Input() staff = false;
  @Input() customerWrap: IGiftWrapView | null = null;
  @Output() applied = new EventEmitter<GiftWrapRequest>();
  @Output() saved = new EventEmitter<ISavedDesign>();
  @Output() closed = new EventEmitter<void>();

  private readonly cartApi = inject(CartApiService);
  private readonly designApi = inject(DesignApiService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  readonly MESSAGE_MAX = GIFT_MESSAGE_MAX;
  readonly isMember = computed(() => this.auth.currentUser()?.role === 'member');

  readonly tab = signal<GiftTab>('GOI_Y');
  readonly data = signal<IGiftWraps | null>(null);
  readonly loadError = signal('');
  readonly mine = signal<ISavedDesign[] | null>(null);
  readonly pickTemplate = signal<string | null>(null);
  readonly pickDesign = signal<string | null>(null);
  readonly pickCustomer = signal(false);

  // Tạo mới: 3 bước
  readonly step = signal(1);
  readonly paper = signal('');
  readonly ribbon = signal('');
  readonly card = signal('');
  readonly message = signal('');
  readonly saveAsMine = signal(false);
  readonly designName = signal('');
  readonly editingId = signal<string | null>(null);
  readonly confirmDelete = signal<ISavedDesign | null>(null);
  // Đang xem, sửa một mẫu gợi ý hoặc mẫu của tôi trước khi áp dụng (các bước như Tạo mới, có lời nhắn)
  readonly base = signal<{ source: 'GOI_Y' | 'CUA_TOI'; id: string; name: string; paper: string; ribbon: string; card: string } | null>(null);
  // Đã đổi giấy, ruy băng hoặc thiệp so với mẫu: Member tự lưu "[tên mẫu] - tùy chỉnh"
  // Tab sáng: đang mở các bước từ 1 mẫu thì sáng tab của mẫu đó, không phải "Tạo mới"
  readonly activeTab = computed<GiftTab>(() => (this.tab() === 'TAO_MOI' && this.base() ? this.base()!.source : this.tab()));
  readonly baseChanged = computed(() => {
    const b = this.base();
    return !!b && (b.paper !== this.paper() || b.ribbon !== this.ribbon() || b.card !== this.card());
  });
  readonly working = signal(false);
  readonly localError = signal('');

  readonly allTemplates = computed(() => this.data()?.suggested.flatMap((g) => g.templates) ?? []);
  readonly pickedTemplate = computed(() => this.allTemplates().find((t) => t._id === this.pickTemplate()) ?? null);
  readonly pickedDesign = computed(() => this.mine()?.find((d) => d._id === this.pickDesign()) ?? null);

  readonly stepSlot = computed<Slot>(() => (['paper', 'ribbon', 'card'] as Slot[])[this.step() - 1]);
  readonly stepItems = computed<IGiftMaterial[]>(() => this.data()?.materials[SLOT_KIND[this.stepSlot()]] ?? []);
  readonly messageCount = computed(() => charCount(this.message()));

  readonly pickLine = computed(() => {
    if (this.tab() === 'GOI_Y') return this.pickedTemplate()?.name ?? '';
    if (this.tab() === 'CUA_TOI') return this.staff ? (this.pickCustomer() ? (this.customerWrap?.name ?? '') : '') : (this.pickedDesign()?.name ?? '');
    return '';
  });

  ngOnInit(): void {
    this.cartApi.getGiftWraps().subscribe({
      next: (d) => this.data.set(d),
      error: (err: ApiError) => this.loadError.set(err.message || 'Không tải được mẫu gói quà. Thử lại'),
    });
    if (this.mode === 'edit' && this.editDesign) {
      this.startEdit(this.editDesign);
      return;
    }
    const c = this.current;
    if (this.staff) {
      // Nhân viên: mẫu đang áp dụng trùng mẫu gốc của khách thì mở sẵn tab Mẫu của khách; Tạo mới luôn điền sẵn mẫu hiện tại
      if (c && this.customerWrap && sameWrap(c, this.customerWrap)) {
        this.pickCustomer.set(true);
        this.tab.set('CUA_TOI');
      } else if (c?.source === 'GOI_Y' && c.templateId) this.pickTemplate.set(c.templateId);
      if (c) {
        this.paper.set(c.paper.code);
        this.ribbon.set(c.ribbon.code);
        this.card.set(c.card.code);
        this.message.set(c.message);
      }
      return;
    }
    if (c?.source === 'GOI_Y' && c.templateId) this.pickTemplate.set(c.templateId);
    if (c?.source === 'CUA_TOI' && c.designId) {
      this.pickDesign.set(c.designId);
      this.openTab('CUA_TOI');
    }
    if (c?.source === 'TAO_MOI') {
      this.paper.set(c.paper.code);
      this.ribbon.set(c.ribbon.code);
      this.card.set(c.card.code);
      this.message.set(c.message);
    }
  }

  openTab(tab: GiftTab): void {
    this.tab.set(tab);
    if (tab !== 'TAO_MOI') this.base.set(null);
    this.localError.set('');
    if (tab === 'CUA_TOI' && !this.staff && this.isMember() && !this.mine()) this.loadMine();
    if (tab === 'TAO_MOI' && !this.editingId()) this.step.set(1);
  }

  private loadMine(): void {
    this.designApi.getDesigns('GOI_QUA').subscribe({ next: (d) => this.mine.set(d), error: () => this.mine.set([]) });
  }

  login(): void {
    const returnUrl = this.router.url;
    this.closed.emit();
    this.router.navigate(['/dang-nhap'], { queryParams: { returnUrl } });
  }

  // ===== Tạo mới =====
  slotValue(slot: Slot): string {
    return slot === 'paper' ? this.paper() : slot === 'ribbon' ? this.ribbon() : this.card();
  }

  choose(m: IGiftMaterial): void {
    if (!m.available) return; // vật liệu hết tồn không chọn được (2Eb, BR-36)
    const slot = this.stepSlot();
    (slot === 'paper' ? this.paper : slot === 'ribbon' ? this.ribbon : this.card).set(m.code);
  }

  materialName(slot: Slot): string {
    const code = this.slotValue(slot);
    return this.data()?.materials[SLOT_KIND[slot]].find((m) => m.code === code)?.name ?? '';
  }

  onMessage(el: HTMLTextAreaElement): void {
    const chars = Array.from(el.value.normalize('NFC'));
    if (chars.length > GIFT_MESSAGE_MAX) el.value = chars.slice(0, GIFT_MESSAGE_MAX).join('');
    this.message.set(el.value);
  }

  next(): void {
    if (this.slotValue(this.stepSlot())) this.step.update((s) => Math.min(3, s + 1));
  }

  back(): void {
    if (this.step() > 1) this.step.update((s) => s - 1);
    else if (this.mode === 'cart') {
      const b = this.base();
      this.editingId.set(null);
      this.base.set(null);
      this.tab.set(b?.source === 'CUA_TOI' ? 'CUA_TOI' : 'GOI_Y');
    }
  }

  // "Áp dụng" một mẫu: mở các bước như Tạo mới đã chọn sẵn vật liệu, mở ở bước Thiệp để khách xem đủ 3 lựa chọn
  // và ghi lời nhắn; quay lại được bước Giấy, Ruy băng để đổi
  customize(source: 'GOI_Y' | 'CUA_TOI', x: { _id: string; name: string; paper?: { code: string } | null; ribbon?: { code: string } | null; card?: { code: string } | null; message?: string }): void {
    const paper = x.paper?.code || '';
    const ribbon = x.ribbon?.code || '';
    const card = x.card?.code || '';
    this.base.set({ source, id: x._id, name: x.name, paper, ribbon, card });
    this.paper.set(paper);
    this.ribbon.set(ribbon);
    this.card.set(card);
    // Mẫu của tôi: lời nhắn đã lưu; mẫu gợi ý: giữ lời nhắn khách đã nhập nếu đang dùng đúng mẫu này
    const cur = this.current;
    const sameCurrent = !!cur && ((source === 'GOI_Y' && cur.templateId === x._id) || (source === 'CUA_TOI' && cur.designId === x._id));
    this.message.set(sameCurrent ? cur!.message || '' : x.message || '');
    this.saveAsMine.set(false);
    this.editingId.set(null);
    this.localError.set('');
    this.step.set(3);
    this.tab.set('TAO_MOI');
    if (!this.staff && this.isMember() && !this.mine()) this.loadMine();
  }

  // Tên "[tên mẫu] - tùy chỉnh", trùng thì thêm số
  private customName(name: string): string {
    const root = `${name} - tùy chỉnh`.slice(0, 54);
    const taken = new Set((this.mine() || []).map((d) => d.name));
    if (!taken.has(root)) return root;
    let i = 2;
    while (taken.has(`${root} ${i}`)) i++;
    return `${root} ${i}`;
  }

  // Tick "Lưu thành mẫu của tôi": điền sẵn tên gợi ý theo vật liệu và đưa con trỏ tới ô tên
  toggleSave(on: boolean): void {
    this.saveAsMine.set(on);
    if (!on || !this.isMember()) return;
    if (!this.designName().trim()) this.designName.set(`Gói quà ${this.materialName('paper')}, ${this.materialName('ribbon')}`.slice(0, 60));
    setTimeout(() => {
      const el = document.getElementById('gd-name') as HTMLInputElement | null;
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      el?.focus();
      el?.select();
    });
  }

  readonly canFinish = computed(
    () => !!this.paper() && !!this.ribbon() && !!this.card() && this.messageCount() <= GIFT_MESSAGE_MAX && (!this.needName() || !!this.designName().trim()),
  );
  needName(): boolean {
    return this.mode === 'edit' || !!this.editingId() || (!this.staff && this.saveAsMine() && this.isMember());
  }

  // "Sửa" một mẫu của tôi: mở các bước Tạo mới đã điền sẵn
  startEdit(d: ISavedDesign): void {
    this.editingId.set(d._id);
    this.designName.set(d.name);
    this.paper.set(d.paper?.code ?? '');
    this.ribbon.set(d.ribbon?.code ?? '');
    this.card.set(d.card?.code ?? '');
    this.message.set(d.message ?? '');
    this.step.set(1);
    this.tab.set('TAO_MOI');
  }

  finish(): void {
    if (!this.canFinish() || this.working()) return;
    const custom = { paper: this.paper(), ribbon: this.ribbon(), card: this.card(), message: this.message().trim() };
    const editId = this.editingId();
    if (editId) {
      // Lưu thay đổi mẫu đã lưu (UC-ACC-06 bước 5-6)
      this.working.set(true);
      this.designApi.updateDesign({ _id: editId, name: this.designName().trim(), ...custom }).subscribe({
        next: (d) => {
          this.working.set(false);
          this.toast.show('Đã cập nhật thiết kế thành công');
          this.mine.update((list) => list?.map((x) => (x._id === d._id ? d : x)) ?? null);
          this.saved.emit(d);
          if (this.mode === 'edit') return;
          this.editingId.set(null);
          this.pickDesign.set(d._id);
          this.tab.set('CUA_TOI');
        },
        error: (err: ApiError) => {
          this.working.set(false);
          this.localError.set(err.message);
        },
      });
      return;
    }
    const b = this.base();
    if (b) {
      // Không đổi vật liệu thì dùng đúng mẫu kèm lời nhắn; đổi thì Member lưu "[tên mẫu] - tùy chỉnh"
      if (!this.baseChanged()) {
        this.applied.emit(b.source === 'GOI_Y' ? { source: 'GOI_Y', templateId: b.id, message: custom.message } : { source: 'CUA_TOI', designId: b.id, message: custom.message });
        return;
      }
      const name = this.customName(b.name);
      if (!this.staff && this.isMember()) {
        this.working.set(true);
        this.designApi.createDesign({ kind: 'GOI_QUA', name, ...custom }).subscribe({
          next: (d) => {
            this.working.set(false);
            this.toast.show(`Đã lưu vào Mẫu của tôi: ${d.name}`);
            this.mine.set(null);
            this.applied.emit({ source: 'CUA_TOI', designId: d._id, message: custom.message });
          },
          error: (err: ApiError) => {
            this.working.set(false);
            this.localError.set(err.message);
          },
        });
        return;
      }
      this.applied.emit({ source: 'TAO_MOI', name, custom });
      return;
    }
    if (this.staff) {
      // Sửa giúp khách: giữ tên mẫu khách đặt (mẫu gợi ý thì thành "Gói quà tự tạo")
      const name = this.current && this.current.source !== 'GOI_Y' ? this.current.name : undefined;
      this.applied.emit({ source: 'TAO_MOI', name, custom });
      return;
    }
    if (this.saveAsMine() && this.isMember()) {
      // Lưu thành mẫu của tôi rồi gắn vào giỏ (4a)
      this.working.set(true);
      this.designApi.createDesign({ kind: 'GOI_QUA', name: this.designName().trim(), ...custom }).subscribe({
        next: (d) => {
          this.working.set(false);
          this.toast.show('Đã lưu mẫu');
          this.mine.set(null);
          this.applied.emit({ source: 'CUA_TOI', designId: d._id });
        },
        error: (err: ApiError) => {
          this.working.set(false);
          this.localError.set(err.message);
        },
      });
      return;
    }
    this.applied.emit({ source: 'TAO_MOI', custom });
  }

  // ===== Mẫu gợi ý, Mẫu của tôi =====
  pick(t: IGiftTemplate): void {
    if (t.available) this.pickTemplate.set(t._id);
  }

  apply(): void {
    if (this.staff && this.tab() === 'CUA_TOI') {
      if (this.pickCustomer() && this.customerWrap) this.applied.emit(requestOf(this.customerWrap));
      return;
    }
    // Mở mẫu để xem, ghi lời nhắn, sửa trước khi áp dụng
    if (this.tab() === 'GOI_Y' && this.pickedTemplate()) this.customize('GOI_Y', this.pickedTemplate()!);
    if (this.tab() === 'CUA_TOI' && this.pickedDesign()) this.applyDesign(this.pickedDesign()!);
  }

  applyDesign(d: ISavedDesign): void {
    if (d.available === false) return;
    this.pickDesign.set(d._id);
    this.customize('CUA_TOI', { _id: d._id, name: d.name, paper: d.paper, ribbon: d.ribbon, card: d.card, message: d.message || '' });
  }

  remove(d: ISavedDesign): void {
    this.designApi.deleteDesign(d._id).subscribe({
      next: () => {
        this.confirmDelete.set(null);
        this.mine.update((list) => list?.filter((x) => x._id !== d._id) ?? null);
        if (this.pickDesign() === d._id) this.pickDesign.set(null);
        this.toast.show('Đã xóa thiết kế');
      },
      error: (err: ApiError) => this.localError.set(err.message),
    });
  }

  badgeText(b: string | null): string {
    return b === 'HOT' ? 'Hot' : b === 'MOI' ? 'Mới' : '';
  }
}

// Cùng một mẫu: cùng mẫu gợi ý, hoặc cùng giấy, ruy băng, thiệp và lời nhắn
function sameWrap(a: IGiftWrapView, b: IGiftWrapView): boolean {
  if (a.source === 'GOI_Y' || b.source === 'GOI_Y') return a.source === b.source && a.templateId === b.templateId;
  return a.paper.code === b.paper.code && a.ribbon.code === b.ribbon.code && a.card.code === b.card.code && (a.message || '') === (b.message || '');
}

// Yêu cầu API-35/đơn nháp để quay lại mẫu gốc của khách
function requestOf(w: IGiftWrapView): GiftWrapRequest {
  if (w.source === 'GOI_Y' && w.templateId) return { source: 'GOI_Y', templateId: w.templateId };
  return { source: 'TAO_MOI', name: w.name, custom: { paper: w.paper.code, ribbon: w.ribbon.code, card: w.card.code, message: w.message || '' } };
}
