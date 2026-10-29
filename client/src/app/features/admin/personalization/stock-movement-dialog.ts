import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { AdminGiftApiService } from '../../../services/admin-gift-apiservice';
import { ApiError } from '../../../classes/api-error';
import { ADJUST_REASONS, IMaterialAdmin } from '../../../classes/admin-gift';

interface Line {
  materialId: string;
  quantity: number | null;
  unitCost: number | null;
}

// Phiếu nhập và điều chỉnh tồn vật liệu (UC-CAT-06 nhánh 1e, 1eEb, AC7, AC10; API-175). Phiếu nhập: nhà cung cấp bắt buộc,
// ngày nhập, từng dòng số lượng (> 0) kèm đơn vị, giá vốn mỗi đơn vị, thành tiền, tổng tiền phiếu; mã phiếu PN do server cấp.
// Điều chỉnh: số lượng tăng/giảm, lý do bắt buộc (Hỏng, Kiểm kê, Khác), tồn sau điều chỉnh không âm.
@Component({
  selector: 'app-stock-movement-dialog',
  standalone: false,
  styleUrl: './personalization-dialogs.scss',
  template: `
    <app-dialog [title]="type === 'NHAP' ? 'Tạo phiếu nhập' : 'Điều chỉnh tồn'" [subtitle]="type === 'NHAP' ? 'Giá vốn chỉ hiện ở phiếu nhập và chi tiết vật liệu' : 'Tồn sau điều chỉnh không được âm'" size="lg" (closed)="done.emit(null)">
      <div class="sp-pdlg">
        @if (error()) {
          <div class="sp-alert sp-alert--danger" role="alert"><app-icon name="alert-circle" [size]="20" /><p>{{ error() }}</p></div>
        }
        @if (type === 'NHAP') {
          <div class="sp-pdlg__grid">
            <div>
              <label class="form-label" for="r-sup">Nhà cung cấp <span class="text-danger">*</span></label>
              <input id="r-sup" class="form-control" maxlength="100" [value]="supplier()" (input)="supplier.set($any($event.target).value)" [class.is-invalid]="tried() && !supplier().trim()" />
              <div class="invalid-feedback">Nhập tên nhà cung cấp</div>
            </div>
            <div>
              <label class="form-label" for="r-date">Ngày nhập</label>
              <input id="r-date" class="form-control" type="date" [value]="receivedAt()" (input)="receivedAt.set($any($event.target).value)" />
            </div>
          </div>
        } @else {
          <div class="sp-pdlg__grid">
            <div>
              <label class="form-label" for="r-reason">Lý do <span class="text-danger">*</span></label>
              <select id="r-reason" class="form-select" [value]="reason()" (change)="reason.set($any($event.target).value)" [class.is-invalid]="tried() && !reason()">
                <option value="">Chọn lý do</option>
                @for (r of reasons; track r.value) {
                  <option [value]="r.value">{{ r.label }}</option>
                }
              </select>
              <div class="invalid-feedback">Chọn lý do điều chỉnh</div>
            </div>
          </div>
        }

        <div class="sp-rtable" role="table" aria-label="Các dòng vật liệu">
          <div class="sp-rtable__head" role="row">
            <span role="columnheader">Vật liệu</span>
            <span role="columnheader">{{ type === 'NHAP' ? 'Số lượng' : 'Tăng (+) / giảm (-)' }}</span>
            @if (type === 'NHAP') {
              <span role="columnheader">Giá vốn / đơn vị</span>
              <span role="columnheader" class="text-end">Thành tiền</span>
            } @else {
              <span role="columnheader">Có sẵn → sau</span>
            }
            <span></span>
          </div>
          @for (l of lines(); track $index; let i = $index) {
            <div class="sp-rtable__row" role="row">
              <select class="form-select form-select-sm" [attr.aria-label]="'Vật liệu dòng ' + (i + 1)" [value]="l.materialId" (change)="setLine(i, 'materialId', $any($event.target).value)">
                <option value="">Chọn vật liệu</option>
                @for (m of materials; track m._id) {
                  <option [value]="m._id">{{ m.name }} ({{ m.code }})</option>
                }
              </select>
              <div class="input-group input-group-sm">
                <input class="form-control" type="number" [min]="type === 'NHAP' ? 1 : null" [value]="l.quantity ?? ''" (input)="setLine(i, 'quantity', $any($event.target).value)" [attr.aria-label]="'Số lượng dòng ' + (i + 1)" [class.is-invalid]="tried() && !lineQtyOk(l)" />
                <span class="input-group-text">{{ unitOf(l.materialId) }}</span>
              </div>
              @if (type === 'NHAP') {
                <div class="input-group input-group-sm">
                  <input class="form-control" type="number" min="0" [value]="l.unitCost ?? ''" (input)="setLine(i, 'unitCost', $any($event.target).value)" [attr.aria-label]="'Giá vốn dòng ' + (i + 1)" [class.is-invalid]="tried() && !(l.unitCost !== null && l.unitCost >= 0)" />
                  <span class="input-group-text">đ</span>
                </div>
                <strong class="text-end">{{ (l.quantity || 0) * (l.unitCost || 0) | vnd }}</strong>
              } @else {
                <span [class.text-danger]="afterOf(l) < 0">{{ stockOf(l.materialId) }} → {{ afterOf(l) }}</span>
              }
              <button class="btn btn-link btn-sm text-danger" type="button" [attr.aria-label]="'Bỏ dòng ' + (i + 1)" [disabled]="lines().length === 1" (click)="removeLine(i)"><app-icon name="close" [size]="16" /></button>
            </div>
          }
        </div>
        <button class="btn btn-link btn-sm align-self-start p-0" type="button" (click)="addLine()"><app-icon name="plus" [size]="16" /> Thêm vật liệu</button>

        @if (type === 'NHAP') {
          <div class="sp-pdlg__total"><span>Tổng tiền phiếu nhập</span><strong>{{ total() | vnd }}</strong></div>
        }
        <div>
          <label class="form-label" for="r-note">Ghi chú{{ type === 'DIEU_CHINH' && reason() === 'KHAC' ? ' (bắt buộc với lý do Khác)' : '' }}</label>
          <input id="r-note" class="form-control" maxlength="200" [value]="note()" (input)="note.set($any($event.target).value)" />
        </div>
      </div>
      <div dialog-footer class="d-flex justify-content-end gap-2">
        <button class="btn btn-outline-secondary" type="button" (click)="done.emit(null)">Hủy</button>
        <button class="btn btn-primary" type="button" [disabled]="saving()" (click)="save()">{{ type === 'NHAP' ? 'Tạo phiếu nhập' : 'Lưu điều chỉnh' }}</button>
      </div>
    </app-dialog>
  `,
})
export class StockMovementDialog implements OnInit {
  @Input() type: 'NHAP' | 'DIEU_CHINH' = 'NHAP';
  @Input() materials: IMaterialAdmin[] = [];
  @Input() preselected: string[] = [];
  @Output() done = new EventEmitter<string | null>();

  private readonly api = inject(AdminGiftApiService);
  readonly reasons = ADJUST_REASONS;
  readonly lines = signal<Line[]>([]);
  readonly supplier = signal('');
  readonly receivedAt = signal(new Date().toISOString().slice(0, 10));
  readonly reason = signal('');
  readonly note = signal('');
  readonly tried = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');

  readonly total = computed(() => this.lines().reduce((s, l) => s + (l.quantity || 0) * (l.unitCost || 0), 0));

  ngOnInit(): void {
    const ids = this.preselected.length ? this.preselected : [''];
    this.lines.set(ids.map((materialId) => ({ materialId, quantity: null, unitCost: null })));
  }

  private find(id: string): IMaterialAdmin | undefined {
    return this.materials.find((m) => m._id === id);
  }

  unitOf(id: string): string {
    return this.find(id)?.unit || 'đv';
  }

  stockOf(id: string): number {
    return this.find(id)?.stock ?? 0;
  }

  afterOf(l: Line): number {
    return this.stockOf(l.materialId) + (l.quantity || 0);
  }

  lineQtyOk(l: Line): boolean {
    if (l.quantity === null || !Number.isInteger(l.quantity)) return false;
    return this.type === 'NHAP' ? l.quantity > 0 : l.quantity !== 0 && this.afterOf(l) >= 0;
  }

  setLine(i: number, key: keyof Line, value: string): void {
    this.lines.update((list) =>
      list.map((l, k) => (k === i ? { ...l, [key]: key === 'materialId' ? value : value === '' ? null : Number(value) } : l)),
    );
  }

  addLine(): void {
    this.lines.update((list) => [...list, { materialId: '', quantity: null, unitCost: null }]);
  }

  removeLine(i: number): void {
    this.lines.update((list) => list.filter((_, k) => k !== i));
  }

  save(): void {
    this.tried.set(true);
    const lines = this.lines();
    const linesOk = lines.every((l) => l.materialId && this.lineQtyOk(l) && (this.type !== 'NHAP' || (l.unitCost !== null && l.unitCost >= 0)));
    if (!linesOk) {
      this.error.set('Kiểm tra lại các dòng vật liệu');
      return;
    }
    if (this.type === 'NHAP' && !this.supplier().trim()) return;
    if (this.type === 'DIEU_CHINH' && (!this.reason() || (this.reason() === 'KHAC' && !this.note().trim()))) {
      this.error.set(this.reason() ? 'Ghi rõ lý do điều chỉnh' : 'Chọn lý do điều chỉnh');
      return;
    }
    const data =
      this.type === 'NHAP'
        ? { type: 'NHAP', supplier: this.supplier().trim(), receivedAt: this.receivedAt(), note: this.note().trim(), lines: lines.map((l) => ({ materialId: l.materialId, quantity: l.quantity, unitCost: l.unitCost })) }
        : { type: 'DIEU_CHINH', reason: this.reason(), note: this.note().trim(), lines: lines.map((l) => ({ materialId: l.materialId, quantity: l.quantity })) };
    this.saving.set(true);
    this.error.set('');
    this.api.createMovement(data).subscribe({
      next: (r) => {
        this.saving.set(false);
        this.done.emit(r.receiptCode || 'DIEU_CHINH');
      },
      error: (err: ApiError) => {
        this.saving.set(false);
        this.error.set(err.message);
      },
    });
  }
}
