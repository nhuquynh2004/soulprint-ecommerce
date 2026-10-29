import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { forkJoin } from 'rxjs';
import { AdminCatalogApiService } from '../../../services/admin-catalog-apiservice';
import { ApiError } from '../../../classes/api-error';
import { IAdminTag, ITagGroup } from '../../../classes/admin-catalog';

// Hộp thoại "Gắn tag" (UC-CAT-04 bước 4-5, API-79): chọn tag cần thêm hoặc bớt cho các sản phẩm đã chọn.
// Chỉ hiện nhóm Danh sách; tag nhóm Khoảng (Độ tuổi, Ngân sách) tự khớp nên không gắn tay.
@Component({
  selector: 'app-bulk-tag-dialog',
  standalone: false,
  template: `
    <app-dialog title="Gắn tag" [subtitle]="'Áp dụng cho ' + productIds.length + ' sản phẩm'" size="lg" (closed)="done.emit('')">
      @if (error()) {
        <div class="sp-alert sp-alert--danger" role="alert"><app-icon name="alert-circle" [size]="20" /><p>{{ error() }}</p></div>
      }
      <p class="text-body-secondary">Bấm 1 lần để thêm tag, bấm lần nữa để bớt tag khỏi sản phẩm, lần thứ ba để bỏ chọn.</p>
      @for (g of listGroups(); track g.code) {
        <fieldset class="mb-3">
          <legend class="h6">{{ g.name }}</legend>
          <div class="d-flex flex-wrap gap-2">
            @for (t of tagsOf(g.code); track t._id) {
              <button type="button" class="sp-chip" [class.is-on]="state()[t._id] === 'add'" [class.is-remove]="state()[t._id] === 'remove'" (click)="cycle(t._id)">
                @if (state()[t._id] === 'add') { <app-icon name="plus" [size]="14" /> }
                @if (state()[t._id] === 'remove') { <app-icon name="minus" [size]="14" /> }
                {{ t.name }}
              </button>
            }
          </div>
        </fieldset>
      }
      <div dialog-footer class="d-flex justify-content-end align-items-center gap-2">
        <small class="me-auto text-body-secondary">Thêm {{ addIds().length }} | Bớt {{ removeIds().length }}</small>
        <button class="btn btn-outline-secondary" type="button" (click)="done.emit('')">Hủy</button>
        <button class="btn btn-primary" type="button" [disabled]="saving() || (!addIds().length && !removeIds().length)" (click)="apply()">Áp dụng</button>
      </div>
    </app-dialog>
  `,
  styles: `.sp-chip.is-remove { border-color: var(--sp-color-danger); color: var(--sp-color-danger); text-decoration: line-through; }`,
})
export class BulkTagDialog implements OnInit {
  @Input({ required: true }) productIds: string[] = [];
  @Output() done = new EventEmitter<string>();

  private readonly api = inject(AdminCatalogApiService);
  readonly groups = signal<ITagGroup[]>([]);
  readonly tags = signal<IAdminTag[]>([]);
  readonly state = signal<Record<string, 'add' | 'remove'>>({});
  readonly saving = signal(false);
  readonly error = signal('');

  readonly listGroups = computed(() => this.groups().filter((g) => g.kind === 'LIST'));
  readonly addIds = computed(() => Object.keys(this.state()).filter((k) => this.state()[k] === 'add'));
  readonly removeIds = computed(() => Object.keys(this.state()).filter((k) => this.state()[k] === 'remove'));

  ngOnInit(): void {
    forkJoin([this.api.getTagGroups(), this.api.getTags()]).subscribe({
      next: ([g, t]) => {
        this.groups.set(g);
        this.tags.set(t);
      },
      error: (err: ApiError) => this.error.set(err.message),
    });
  }

  tagsOf(code: string): IAdminTag[] {
    return this.tags().filter((t) => t.group === code);
  }

  cycle(id: string): void {
    const next = { ...this.state() };
    next[id] = next[id] === undefined ? 'add' : next[id] === 'add' ? 'remove' : (undefined as any);
    if (!next[id]) delete next[id];
    this.state.set(next);
  }

  apply(): void {
    this.saving.set(true);
    this.api.bulkTags({ productIds: this.productIds, addTagIds: this.addIds(), removeTagIds: this.removeIds() }).subscribe({
      next: (r) => {
        this.saving.set(false);
        this.done.emit(`Đã cập nhật tag cho ${r.updated} sản phẩm` + (r.failed.length ? `, lỗi ${r.failed.length}` : ''));
      },
      error: (err: ApiError) => {
        this.saving.set(false);
        this.error.set(err.message);
      },
    });
  }
}
