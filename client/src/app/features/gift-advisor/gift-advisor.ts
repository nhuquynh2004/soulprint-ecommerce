import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl } from '@angular/forms';
import { Router } from '@angular/router';
import { Observable, combineLatest, map, startWith, timer } from 'rxjs';
import { ApiError } from '../../classes/api-error';
import { ITag } from '../../classes/catalog';
import { Product } from '../../classes/product';
import {
  AGE_MAX,
  AGE_MIN,
  BUDGET_MAX,
  budgetTopOf,
  setBudgetTop,
  BUDGET_STEP,
  DRAFT_KEY,
  IAdvisorForm,
  IAiCombo,
  IAiProduct,
  IAiQuota,
  ICriterionChip,
  IRecommendInput,
  IRecommendation,
  ageChosen,
  ageLabel,
  atLeastOneCriterion,
  budgetChosen,
  budgetLabel,
  criteriaCount,
  fmtVnd,
  introOf,
  pct,
  toFilterParams,
  toFormValue,
  toRequest,
  withoutChip,
} from '../../classes/recommendation';
import { AuthService } from '../../services/auth';
import { CartService } from '../../services/cart';
import { CatalogApiService } from '../../services/catalog-apiservice';
import { RecommendationApiService } from '../../services/recommendation-apiservice';
import { ToastService } from '../../services/toast';
import { WishlistService } from '../../services/wishlist';

type View = 'form' | 'loading' | 'result' | 'quota' | 'error';
interface ITile {
  slug: string;
  name: string;
  icon: string;
}

// Biểu tượng thẻ người nhận theo slug (nhóm DOI_TUONG); tag Admin thêm sau dùng biểu tượng chung
const RECIPIENT_ICONS: Record<string, string> = { ba: 'user', 'ban-trai': 'heart', chong: 'users', 'anh-em-trai': 'users', sep: 'briefcase', 'ban-be': 'party' };
const MIN_LOADING_MS = 700; // giữ trạng thái "Sâu đang chọn quà" đủ lâu để khách đọc được (server trả trong vài chục ms)

// SCR-10 Tư vấn quà cùng AI (UC-DIS-05). Một trang 5 trạng thái: form khảo sát, đang tải, kết quả,
// hết lượt thử (2Ea), lỗi (6Eb). Form là Reactive Form có validator nhóm "ít nhất một thông tin" (3Ea, Chương V).
@Component({
  selector: 'app-gift-advisor',
  standalone: false,
  templateUrl: './gift-advisor.html',
  styleUrl: './gift-advisor.scss',
})
export class GiftAdvisor implements OnInit {
  private readonly api = inject(RecommendationApiService);
  private readonly catalog = inject(CatalogApiService);
  private readonly cart = inject(CartService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly auth = inject(AuthService);
  protected readonly wishlist = inject(WishlistService);

  readonly AGE_MIN = AGE_MIN;
  readonly AGE_MAX = AGE_MAX;
  readonly budgetTop = signal(budgetTopOf()); // đầu trên thanh Ngân sách theo giá cao nhất (API-198)
  // Chưa biết đầu trên thì chưa hiện số, tránh hiện 1.000.000đ+ rồi nhảy sang giá thật (retest R04)
  readonly budgetReady = signal(budgetTopOf() > BUDGET_MAX);
  readonly BUDGET_STEP = BUDGET_STEP;
  readonly pct = pct;
  readonly ageLabel = ageLabel;
  readonly budgetLabel = budgetLabel;
  readonly placeholder = Product.PLACEHOLDER;

  private readonly fb = inject(FormBuilder).nonNullable;
  readonly form = this.fb.group(
    {
      recipient: new FormControl<string | null>(null),
      occasions: [[] as string[]],
      hobbies: [[] as string[]],
      personalities: [[] as string[]],
      age: this.fb.group({ min: AGE_MIN, max: AGE_MAX }),
      budget: this.fb.group({ min: 0, max: budgetTopOf() }),
      note: '',
    },
    { validators: atLeastOneCriterion },
  );
  private readonly formValue = toSignal(this.form.valueChanges.pipe(map(() => this.form.getRawValue() as IAdvisorForm), startWith(this.form.getRawValue() as IAdvisorForm)), {
    requireSync: true,
  });
  readonly count = computed(() => criteriaCount(this.formValue()));
  // Chữ đọc màn hình của núm thanh kéo (app-range-slider)
  readonly ageAria = (n: number, end: 'min' | 'max') => (end === 'max' && n >= AGE_MAX ? '40 tuổi trở lên' : n + ' tuổi');
  readonly budgetAria = (n: number, end: 'min' | 'max') => (end === 'max' && n >= budgetTopOf() ? 'Không giới hạn' : fmtVnd(n));

  readonly recipients = signal<ITile[]>([]);
  readonly occasions = signal<ITag[]>([]);
  readonly hobbies = signal<ITag[]>([]);
  readonly personalities = signal<ITag[]>([]);
  readonly tagsError = signal(false);

  readonly view = signal<View>('form');
  readonly quota = signal<IAiQuota | null>(null);
  readonly result = signal<IRecommendation | null>(null);
  readonly asked = signal(''); // câu tóm tắt khách vừa hỏi (bóng chat bên phải)
  readonly askedChips = signal<string[]>([]); // chip tiêu chí khi hết lượt sau khi gửi (2Ea)
  readonly refineText = new FormControl('', { nonNullable: true });
  readonly busy = signal(false); // đang tinh chỉnh (giữ kết quả cũ trên màn hình)
  readonly adding = signal<string | null>(null);
  private sessionId: string | null = null; // có thì lần gửi tiếp theo là tinh chỉnh (8a, 8c)
  private lastCall: (() => Observable<IRecommendation>) | null = null;

  readonly isGuest = computed(() => this.auth.currentUser()?.role !== 'member');
  readonly intro = computed(() => (this.result() ? introOf(this.result()!) : ''));
  readonly filterParams = computed(() => {
    const r = this.result();
    return r ? toFilterParams(r.input) : toFilterParams(toRequest(this.formValue()));
  });
  // Câu tinh chỉnh gợi ý (8a): sở thích chưa chọn đầu tiên làm ví dụ "Thêm lựa chọn ..."
  readonly suggestions = computed(() => {
    const r = this.result();
    const extra = this.hobbies().find((t) => !r?.input.hobbies.includes(t.slug));
    return ['Có gì rẻ hơn không?', ...(extra ? [`Thêm lựa chọn ${extra.name}`] : []), 'Có món khắc được tên không?'];
  });

  ngOnInit(): void {
    this.catalog
      .getAllTags()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (groups) => {
          const items = (code: string) => groups.find((g) => g.group === code)?.items || [];
          this.recipients.set([
            ...items('DOI_TUONG').map((t) => ({ slug: t.slug, name: t.name, icon: RECIPIENT_ICONS[t.slug] || 'user' })),
            { slug: 'khac', name: 'Khác', icon: 'more' },
          ]);
          this.occasions.set(items('DIP_TANG'));
          this.hobbies.set(items('SO_THICH'));
          this.personalities.set([...items('TINH_CACH'), ...items('PHONG_CACH')]);
        },
        error: () => this.tagsError.set(true),
      });
    this.restoreDraft();
    this.loadQuota();
  }

  // 2Ea: Guest đã dùng hết lượt thì hiện lời mời đăng nhập ngay khi mở form
  private loadQuota(): void {
    this.api.getQuota().subscribe({
      next: (q) => {
        this.quota.set(q);
        // Nới đầu trên thanh Ngân sách; đang để "không giới hạn" thì giữ không giới hạn ở đầu trên mới
        const old = budgetTopOf();
        setBudgetTop(q.budgetMax);
        this.budgetTop.set(budgetTopOf());
        const b = this.form.controls.budget.controls.max;
        if (b.value >= old) b.setValue(budgetTopOf());
        this.budgetReady.set(true);
        if (!q.member && q.remaining === 0 && this.view() === 'form' && !this.sessionId) this.view.set('quota');
      },
      error: () => this.budgetReady.set(true),
    });
  }

  // Tiêu chí giữ lại khi Guest hết lượt rồi đăng nhập: điền lại form khi quay về
  private restoreDraft(): void {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      sessionStorage.removeItem(DRAFT_KEY);
      this.form.setValue(toFormValue(JSON.parse(raw) as IRecommendInput));
    } catch {
      /* trình duyệt chặn sessionStorage: bỏ qua */
    }
  }

  // ===== Form =====

  pickRecipient(slug: string): void {
    const c = this.form.controls.recipient;
    c.setValue(c.value === slug ? null : slug);
  }

  isOn(field: 'occasions' | 'hobbies' | 'personalities', slug: string): boolean {
    return this.formValue()[field].includes(slug);
  }

  toggle(field: 'occasions' | 'hobbies' | 'personalities', slug: string): void {
    const c = this.form.controls[field];
    c.setValue(c.value.includes(slug) ? c.value.filter((s) => s !== slug) : [...c.value, slug]);
  }


  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const input = toRequest(this.form.getRawValue() as IAdvisorForm);
    const sid = this.sessionId;
    // "Sửa tiêu chí" khi đang có lượt tư vấn: là tinh chỉnh, không trừ lượt (8c)
    this.run(() => (sid ? this.api.refine(sid, null, input) : this.api.recommend(input)), input, false);
  }

  // ===== Gọi API-59 =====

  private run(call: () => Observable<IRecommendation>, input: IRecommendInput | null, keepResult: boolean): void {
    this.lastCall = call;
    if (input) this.asked.set(this.askText(input));
    if (keepResult) this.busy.set(true);
    else this.view.set('loading');
    combineLatest([call(), timer(keepResult ? 0 : MIN_LOADING_MS)])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ([r]) => {
          this.busy.set(false);
          this.result.set(r);
          this.sessionId = r.sessionId;
          this.asked.set(r.summary);
          this.quota.set(r.quota);
          this.view.set('result');
          for (const n of r.notes) this.toast.show(n, 'info');
        },
        error: (err: ApiError) => {
          this.busy.set(false);
          if (err.status === 429) {
            this.quota.set(err.extra['quota'] || this.quota());
            this.askedChips.set(this.chipLabels(input));
            this.view.set('quota');
          } else if (err.status === 400 || err.status === 404) {
            this.toast.show(err.message, 'danger');
            if (err.status === 404) this.sessionId = null;
            this.view.set(this.result() ? 'result' : 'form');
          } else {
            this.view.set('error'); // 6Eb: lượt không bị trừ
          }
        },
      });
  }

  retry(): void {
    if (this.lastCall) this.run(this.lastCall, null, false);
    else this.view.set('form');
  }

  // 8a: câu tinh chỉnh tự gõ hoặc câu gợi ý
  refine(text?: string): void {
    const t = (text ?? this.refineText.value).trim();
    if (!t || !this.sessionId || this.busy()) return;
    const sid = this.sessionId;
    this.refineText.setValue('');
    this.run(() => this.api.refine(sid, t), null, true);
  }

  // 8c: bỏ chip tiêu chí
  removeChip(chip: ICriterionChip): void {
    const r = this.result();
    if (!r || !this.sessionId || this.busy()) return;
    if (r.criteria.length <= 1) {
      this.editCriteria();
      return;
    }
    const sid = this.sessionId;
    const input = withoutChip(r.input, chip);
    this.run(() => this.api.refine(sid, null, input), null, true);
  }

  // 6Ea: gợi ý nới tiêu chí
  relax(input: IRecommendInput): void {
    if (!this.sessionId || this.busy()) return;
    const sid = this.sessionId;
    this.run(() => this.api.refine(sid, null, input), null, true);
  }

  editCriteria(): void {
    const r = this.result();
    if (r) this.form.setValue(toFormValue(r.input));
    this.view.set('form');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // 8d: lượt mới
  restart(): void {
    this.sessionId = null;
    this.result.set(null);
    this.form.reset();
    this.form.controls.budget.controls.max.setValue(budgetTopOf()); // về "không giới hạn" theo đầu trên hiện tại
    this.view.set('form');
    this.loadQuota();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ===== Thêm vào giỏ (AC5) =====

  addToCart(p: IAiProduct): void {
    if (!p.defaultVariantSku) {
      this.router.navigate(['/san-pham', p.slug], { queryParams: { ai: this.sessionId } });
      return;
    }
    this.adding.set(p._id);
    this.cart.add({ productId: p._id, variantSku: p.defaultVariantSku, quantity: 1, aiSessionId: this.sessionId }).subscribe({
      next: () => {
        this.adding.set(null);
        this.toast.show('Đã thêm vào giỏ hàng');
      },
      error: (err: ApiError) => {
        this.adding.set(null);
        this.toast.show(err.message, 'danger');
      },
    });
  }

  addCombo(c: IAiCombo): void {
    const [a, b] = c.products;
    if (!c.canAddAll || !a.defaultVariantSku || !b.defaultVariantSku) return;
    this.adding.set(c.name);
    const add = (p: IAiProduct) => this.cart.add({ productId: p._id, variantSku: p.defaultVariantSku!, quantity: 1, aiSessionId: this.sessionId });
    add(a).subscribe({
      next: () =>
        add(b).subscribe({
          next: () => {
            this.adding.set(null);
            this.toast.show('Đã thêm cả combo vào giỏ hàng');
          },
          error: (err: ApiError) => {
            this.adding.set(null);
            this.toast.show(err.message, 'danger');
          },
        }),
      error: (err: ApiError) => {
        this.adding.set(null);
        this.toast.show(err.message, 'danger');
      },
    });
  }

  // ===== Hết lượt (2Ea) =====

  // Giữ tiêu chí đang chọn để điền lại sau khi đăng nhập / đăng ký
  keepDraft(): void {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(toRequest(this.form.getRawValue() as IAdvisorForm)));
    } catch {
      /* bỏ qua */
    }
  }

  // ===== Hiển thị =====

  imageOf(p: IAiProduct): string {
    return p.image || this.placeholder;
  }

  isWarn(reason: string): boolean {
    return reason.startsWith('Cao hơn') || reason.startsWith('Chưa đúng') || reason.startsWith('Thấp hơn');
  }

  // Câu khách vừa hỏi, dựng từ form khi server chưa trả tóm tắt
  private askText(input: IRecommendInput): string {
    const labels = this.chipLabels(input);
    return labels.length ? 'Tìm quà: ' + labels.join(', ') : 'Tìm quà theo mô tả của bạn';
  }

  private chipLabels(input: IRecommendInput | null): string[] {
    const v = input ? toFormValue(input) : (this.form.getRawValue() as IAdvisorForm);
    const name = (list: { slug: string; name: string }[], slug: string) => list.find((t) => t.slug === slug)?.name || slug;
    return [
      ...(v.recipient ? [name(this.recipients(), v.recipient)] : []),
      ...v.occasions.map((s) => name(this.occasions(), s)),
      ...v.hobbies.map((s) => name(this.hobbies(), s)),
      ...v.personalities.map((s) => name(this.personalities(), s)),
      ...(ageChosen(v.age) ? [ageLabel(v.age)] : []),
      ...(budgetChosen(v.budget) ? [budgetLabel(v.budget)] : []),
    ];
  }
}
