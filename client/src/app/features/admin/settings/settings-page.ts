import { Component, ViewChild, computed, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ValidationErrors, Validators } from '@angular/forms';
import { Observable, Subject } from 'rxjs';
import { AdminStoreApiService } from '../../../services/admin-store-apiservice';
import { ToastService } from '../../../services/toast';
import { ApiError } from '../../../classes/api-error';
import { FAQ_CATEGORY_LABEL, IFaq, IPolicyItem, IStoreSettings } from '../../../classes/admin-catalog';
import { HasUnsavedChanges } from '../../../guards/unsaved-changes-guard';
import { RichEditor } from '../shared/rich-editor/rich-editor';
import { removeAccents } from '../../../shared/vn-text';
import { VndPipe } from '../../../shared/vnd-pipe';
import { ConfirmService } from '../../../services/confirm';

type Tab = 'fees' | 'info' | 'policies' | 'faq' | 'insights';
const RETURN_WINDOW_DAYS = 7; // BR-12, chỉ đổi qua Change Request (02 Mục 5)

// BR-40: đơn có món cá nhân hóa cần Online 100% hoặc Cọc + COD; đơn không cá nhân hóa cần Online 100% hoặc COD toàn bộ
const paymentsValidator = (g: AbstractControl): ValidationErrors | null => {
  const v = g.value;
  return (v.onlineFull || v.depositCod) && (v.onlineFull || v.codFull) ? null : { payments: 'Cần giữ ít nhất 1 phương thức cho mỗi loại đơn' };
};

// SCR-59 Cài đặt cửa hàng (UC-CAT-07) - chỉ vai trò Quản trị. 5 tab: Phí và thanh toán, Thông tin cửa hàng, Chính sách
// (trình soạn + chèn biến + xem trước), Chatbot FAQ (bảng, thêm/sửa, bật/tắt, thử hỏi), Ngưỡng gợi ý.
// Nút "Lưu thay đổi" lưu tab đang mở; đổi phí hỏi xác nhận trước (bước 4, BR-35).
@Component({
  selector: 'app-settings-page',
  standalone: false,
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.scss',
})
export class SettingsPage implements HasUnsavedChanges {
  private readonly confirmBox = inject(ConfirmService);
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(AdminStoreApiService);
  private readonly toast = inject(ToastService);
  private readonly vnd = new VndPipe();
  @ViewChild(RichEditor) editor?: RichEditor;

  readonly tabs: { key: Tab; label: string }[] = [
    { key: 'fees', label: 'Phí và thanh toán' },
    { key: 'info', label: 'Thông tin cửa hàng' },
    { key: 'policies', label: 'Chính sách' },
    { key: 'faq', label: 'Chatbot FAQ' },
    { key: 'insights', label: 'Ngưỡng gợi ý' },
  ];
  readonly faqLabel = FAQ_CATEGORY_LABEL;
  readonly faqCategories = Object.keys(FAQ_CATEGORY_LABEL) as IFaq['category'][];
  readonly tab = signal<Tab>('fees');
  readonly loading = signal(true);
  readonly errMessage = signal('');
  readonly saving = signal(false);
  readonly settings = signal<IStoreSettings | null>(null);
  readonly confirmFees = signal(false);
  readonly serverErrors = signal<Record<string, string>>({});

  readonly form = this.fb.nonNullable.group({
    fees: this.fb.nonNullable.group({
      shippingFee: [30000, [Validators.required, Validators.min(0)]],
      depositPercent: [50, [Validators.required, Validators.min(10), Validators.max(100)]],
      stickerFee: [5000, [Validators.required, Validators.min(0)]],
    }),
    payments: this.fb.nonNullable.group({ onlineFull: [true], depositCod: [true], codFull: [true] }, { validators: paymentsValidator }),
    info: this.fb.nonNullable.group({
      storeName: ['', [Validators.required, Validators.maxLength(60)]],
      hotline: [''],
      email: ['', [Validators.email]],
      returnAddress: [''],
      workingHours: [''],
      social: this.fb.nonNullable.group({
        facebook: ['', [Validators.pattern(/^(https?:\/\/.*)?$/)]],
        zalo: ['', [Validators.pattern(/^(https?:\/\/.*)?$/)]],
        instagram: ['', [Validators.pattern(/^(https?:\/\/.*)?$/)]],
        tiktok: ['', [Validators.pattern(/^(https?:\/\/.*)?$/)]],
      }),
    }),
    insights: this.fb.nonNullable.group({
      stockoutDays: [7, [Validators.required, Validators.min(1), Validators.max(60)]],
      expiryDays: [7, [Validators.required, Validators.min(1), Validators.max(60)]],
      abandonedCartDays: [7, [Validators.required, Validators.min(1), Validators.max(60)]],
    }),
  });

  // Tab Chính sách
  readonly policies = signal<IPolicyItem[]>([]);
  readonly policySlug = signal<string | null>(null);
  readonly policyTitle = signal('');
  readonly policyContent = signal('');
  readonly policyDirty = signal(false);
  readonly policyPreview = signal(false);
  readonly varMenu = signal(false);
  readonly policyError = signal('');

  // Tab Chatbot FAQ
  readonly faqs = signal<IFaq[]>([]);
  readonly faqQ = signal('');
  readonly faqCat = signal('');
  readonly editingFaq = signal<IFaq | 'new' | null>(null);
  readonly deletingFaq = signal<IFaq | null>(null);
  readonly askText = signal('');
  readonly askResult = signal<{ faq: IFaq | null; keyword: string } | null>(null);

  readonly leaveDialog = signal(false);
  private leave$ = new Subject<boolean>();

  readonly variables = computed(() => Object.entries(this.settings()?.variables || {}).map(([key, label]) => ({ key, label })));
  readonly filteredFaqs = computed(() => {
    const q = removeAccents(this.faqQ());
    return this.faqs().filter(
      (f) => (!this.faqCat() || f.category === this.faqCat()) && (!q || removeAccents(f.question + ' ' + f.answer + ' ' + f.keywords.join(' ')).includes(q)),
    );
  });

  constructor() {
    this.api.getSettings().subscribe({
      next: (s) => {
        this.fill(s);
        this.loading.set(false);
      },
      error: (err: ApiError) => {
        this.errMessage.set(err.message);
        this.loading.set(false);
      },
    });
    this.api.getPolicies().subscribe({ next: (p) => this.policies.set(p), error: () => {} });
    this.loadFaqs();
  }

  private fill(s: IStoreSettings): void {
    this.settings.set(s);
    this.form.reset({
      fees: { shippingFee: s.fees.shippingFee, depositPercent: Math.round(s.fees.depositRate * 100), stickerFee: s.fees.stickerFee },
      payments: s.payments,
      info: s.info,
      insights: s.insights,
    });
  }

  setTab(t: Tab): void {
    this.tab.set(t);
    if (t === 'policies' && !this.policySlug() && this.policies().length) this.openPolicy(this.policies()[0].slug);
  }

  // ===== Lưu tab đang mở =====

  canSave(): boolean {
    const t = this.tab();
    if (t === 'policies') return this.policyDirty();
    if (t === 'faq') return false;
    const group = t === 'fees' ? [this.form.controls.fees, this.form.controls.payments] : [this.form.controls[t]];
    return group.some((g) => g.dirty);
  }

  onSave(): void {
    const t = this.tab();
    if (t === 'policies') return this.savePolicy();
    if (t === 'fees') {
      const g = this.form.controls;
      g.fees.markAllAsTouched();
      if (g.fees.invalid || g.payments.invalid) return;
      // Đổi phí: hỏi xác nhận "Phí mới áp dụng cho giỏ và đơn tạo từ bây giờ" (bước 4)
      if (g.fees.dirty) return this.confirmFees.set(true);
    }
    this.saveSettings();
  }

  saveSettings(): void {
    this.confirmFees.set(false);
    const t = this.tab();
    const v = this.form.getRawValue();
    const ctl = t === 'fees' ? this.form.controls.fees : this.form.controls[t as 'info' | 'insights'];
    ctl.markAllAsTouched();
    if (ctl.invalid) return;
    const data: Partial<IStoreSettings> =
      t === 'fees'
        ? { fees: { shippingFee: Number(v.fees.shippingFee), depositRate: Number(v.fees.depositPercent) / 100, stickerFee: Number(v.fees.stickerFee) }, payments: v.payments }
        : t === 'info'
          ? { info: v.info }
          : { insights: { stockoutDays: Number(v.insights.stockoutDays), expiryDays: Number(v.insights.expiryDays), abandonedCartDays: Number(v.insights.abandonedCartDays) } };
    this.saving.set(true);
    this.serverErrors.set({});
    this.api.updateSettings(data).subscribe({
      next: (s) => {
        this.saving.set(false);
        this.fill(s);
        this.toast.show('Đã lưu cài đặt');
        for (const w of s.warnings || []) this.toast.show(w, 'info');
      },
      error: (err: ApiError) => {
        this.saving.set(false);
        this.serverErrors.set((err.extra['fields'] as Record<string, string>) || {});
        this.toast.show(err.message, 'danger');
      },
    });
  }

  // ===== Chính sách =====

  openPolicy(slug: string): void {
    if (!this.policyDirty()) {
      this.loadPolicy(slug);
      return;
    }
    this.confirmBox.ask({ title: 'Bỏ thay đổi chưa lưu?', message: 'Trang chính sách đang sửa chưa lưu. Bỏ thay đổi để mở trang khác?', okText: 'Bỏ thay đổi', danger: true }).then((ok) => {
      if (ok) this.loadPolicy(slug);
    });
  }

  private loadPolicy(slug: string): void {
    this.policySlug.set(slug);
    this.policyPreview.set(false);
    this.policyError.set('');
    this.api.getPolicy(slug, true).subscribe({
      next: (p) => {
        this.policyTitle.set(p.title);
        this.policyContent.set(p.content);
        this.policyDirty.set(false);
      },
      error: (err: ApiError) => this.toast.show(err.message, 'danger'),
    });
  }

  // "phi_van_chuyen" -> "{{phi_van_chuyen}}" (viết trong template dễ bị hiểu nhầm là nội suy)
  tokenOf(key: string): string {
    return '{{' + key + '}}';
  }

  insertVar(key: string): void {
    this.varMenu.set(false);
    this.editor?.insertText(`{{${key}}}`);
  }

  // Thay biến bằng giá trị đang áp dụng (BR-35) để xem trước trước khi lưu - cùng bảng biến với server (services/settings.js)
  fillVars(text: string): string {
    const s = this.settings();
    if (!s) return text;
    const values: Record<string, string> = {
      phi_van_chuyen: this.vnd.transform(s.fees.shippingFee),
      ty_le_coc: Math.round(s.fees.depositRate * 100) + '%',
      phi_sticker: this.vnd.transform(s.fees.stickerFee),
      so_ngay_doi_tra: String(RETURN_WINDOW_DAYS),
      hotline: s.info.hotline,
    };
    return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (all, k) => values[k] ?? all);
  }

  savePolicy(): void {
    const slug = this.policySlug();
    if (!slug) return;
    this.saving.set(true);
    this.policyError.set('');
    this.api.updatePolicy({ slug, title: this.policyTitle().trim(), content: this.policyContent() }).subscribe({
      next: (p) => {
        this.saving.set(false);
        this.policyContent.set(p.content);
        this.policyDirty.set(false);
        this.policies.set(this.policies().map((x) => (x.slug === slug ? { ...x, title: p.title, updatedAt: p.updatedAt } : x)));
        this.toast.show('Đã lưu trang chính sách');
      },
      error: (err: ApiError) => {
        this.saving.set(false);
        this.policyError.set(err.message);
      },
    });
  }

  // ===== Chatbot FAQ =====

  loadFaqs(): void {
    this.api.getFaqs().subscribe({ next: (f) => this.faqs.set(f), error: () => {} });
  }

  toggleFaq(f: IFaq): void {
    this.api.updateFaq({ _id: f._id!, isActive: !f.isActive }).subscribe({
      next: (x) => this.faqs.set(this.faqs().map((y) => (y._id === x._id ? { ...x, hitCount: y.hitCount } : y))),
      error: (err: ApiError) => this.toast.show(err.message, 'danger'),
    });
  }

  doDeleteFaq(): void {
    const f = this.deletingFaq()!;
    this.deletingFaq.set(null);
    this.api.deleteFaq(f._id!).subscribe({
      next: () => {
        this.faqs.set(this.faqs().filter((x) => x._id !== f._id));
        this.toast.show('Đã xóa câu hỏi');
      },
      error: (err: ApiError) => this.toast.show(err.message, 'danger'),
    });
  }

  onFaqSaved(message: string): void {
    this.editingFaq.set(null);
    if (message) {
      this.toast.show(message);
      this.loadFaqs();
    }
  }

  // "Thử hỏi" (1c): so khớp từ khóa không dấu như chatbot - chọn câu đang bật có nhiều từ khóa khớp nhất, ưu tiên từ khóa dài
  ask(): void {
    const text = removeAccents(this.askText()).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) return;
    let best: { faq: IFaq; score: number; keyword: string } | null = null;
    for (const f of this.faqs().filter((x) => x.isActive)) {
      const hits = f.keywords.filter((k) => k && text.includes(k));
      const score = hits.reduce((n, k) => n + k.length, 0);
      if (score && (!best || score > best.score)) best = { faq: f, score, keyword: hits.sort((a, b) => b.length - a.length)[0] };
    }
    this.askResult.set(best ? { faq: best.faq, keyword: best.keyword } : { faq: null, keyword: '' });
  }

  // ===== Rời trang =====

  hasUnsavedChanges(): boolean {
    return !this.loading() && (this.form.dirty || this.policyDirty());
  }

  confirmLeave(): Observable<boolean> {
    this.leaveDialog.set(true);
    this.leave$ = new Subject<boolean>();
    return this.leave$;
  }

  answerLeave(ok: boolean): void {
    this.leaveDialog.set(false);
    this.leave$.next(ok);
    this.leave$.complete();
  }
}
