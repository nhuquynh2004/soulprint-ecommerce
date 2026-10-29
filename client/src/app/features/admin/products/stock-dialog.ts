import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { AdminCatalogApiService } from '../../../services/admin-catalog-apiservice';
import { ApiError } from '../../../classes/api-error';
import { IAdminProductRow } from '../../../classes/admin-catalog';

interface StockLine {
  product: string;
  sku: string;
  name: string;
  stock: number;
  lowStockThreshold: number;
  oldStock: number;
  oldThreshold: number;
}

// Hộp thoại "Cập nhật tồn kho" của thanh thao tác hàng loạt SCR-41 (API-161 UPDATE_STOCK, quyền SAN_PHAM.CAP_NHAT_TON):
// mỗi biến thể một dòng tồn kho và ngưỡng sắp hết; chỉ gửi dòng đã đổi.
@Component({
  selector: 'app-stock-dialog',
  standalone: false,
  template: `
    <app-dialog title="Cập nhật tồn kho" [subtitle]="lines().length + ' biến thể của ' + products.length + ' sản phẩm'" size="lg" (closed)="done.emit('')">
      @if (error()) {
        <div class="sp-alert sp-alert--danger" role="alert"><app-icon name="alert-circle" [size]="20" /><p>{{ error() }}</p></div>
      }
      <div class="sp-table-wrap">
        <table class="table sp-atable align-middle mb-0" style="min-width: 560px">
          <thead>
            <tr><th scope="col">Biến thể</th><th scope="col" style="width: 130px">Tồn kho</th><th scope="col" style="width: 150px">Ngưỡng sắp hết</th></tr>
          </thead>
          <tbody>
            @for (l of lines(); track l.sku) {
              <tr>
                <td><strong>{{ l.product }}</strong><small class="d-block text-body-secondary">{{ l.name }}, {{ l.sku }}</small></td>
                <td><input class="form-control" type="number" min="0" step="1" [attr.aria-label]="'Tồn kho ' + l.sku" [(ngModel)]="l.stock" /></td>
                <td><input class="form-control" type="number" min="0" step="1" [attr.aria-label]="'Ngưỡng sắp hết ' + l.sku" [(ngModel)]="l.lowStockThreshold" /></td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      @if (products.length === 0) {
        <p class="text-body-secondary mt-2 mb-0">Chọn sản phẩm ở trang hiện tại để cập nhật tồn kho.</p>
      }
      <div dialog-footer class="d-flex justify-content-end gap-2">
        <button class="btn btn-outline-secondary" type="button" (click)="done.emit('')">Hủy</button>
        <button class="btn btn-primary" type="button" [disabled]="saving()" (click)="save()">Lưu tồn kho</button>
      </div>
    </app-dialog>
  `,
})
export class StockDialog implements OnInit {
  @Input({ required: true }) products: IAdminProductRow[] = [];
  @Output() done = new EventEmitter<string>();

  private readonly api = inject(AdminCatalogApiService);
  readonly lines = signal<StockLine[]>([]);
  readonly saving = signal(false);
  readonly error = signal('');

  ngOnInit(): void {
    this.lines.set(
      this.products.flatMap((p) =>
        p.variants
          .filter((v) => v.sku)
          .map((v) => ({
            product: p.name,
            sku: v.sku,
            name: v.name,
            stock: v.stock,
            lowStockThreshold: v.lowStockThreshold ?? 5,
            oldStock: v.stock,
            oldThreshold: v.lowStockThreshold ?? 5,
          })),
      ),
    );
  }

  save(): void {
    const changed = this.lines().filter((l) => Number(l.stock) !== l.oldStock || Number(l.lowStockThreshold) !== l.oldThreshold);
    const bad = changed.find((l) => !Number.isInteger(Number(l.stock)) || Number(l.stock) < 0 || !Number.isInteger(Number(l.lowStockThreshold)) || Number(l.lowStockThreshold) < 0);
    if (bad) return this.error.set(`${bad.sku}: tồn kho và ngưỡng phải là số nguyên không âm`);
    if (!changed.length) return this.done.emit('');
    this.saving.set(true);
    this.api
      .bulkProducts({ action: 'UPDATE_STOCK', items: changed.map((l) => ({ variantSku: l.sku, stock: Number(l.stock), lowStockThreshold: Number(l.lowStockThreshold) })) })
      .subscribe({
        next: (r) => {
          this.saving.set(false);
          if (r.skipped.length) this.error.set(r.skipped.map((s) => `${s.id}: ${s.reason}`).join('; '));
          else this.done.emit(`Đã cập nhật tồn kho ${r.updated} biến thể`);
        },
        error: (err: ApiError) => {
          this.saving.set(false);
          this.error.set(err.message);
        },
      });
  }
}
