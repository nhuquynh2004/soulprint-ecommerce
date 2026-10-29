import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { FormArray, FormBuilder, FormControl, FormGroup, Validators } from '@angular/forms';
import { StaffApiService } from '../../../services/staff-apiservice';
import { ApiError } from '../../../classes/api-error';
import { IPermissionArea, IPermissionOverride, IRole, IStaff } from '../../../classes/user';
import { firstError, futureDateValidator, phoneValidator, selectCountValidator } from '../../../shared/form-validators';

type OverrideForm = FormGroup<{
  type: FormControl<'CAP_THEM' | 'THU_HOI'>;
  permission: FormControl<string>;
  expiry: FormControl<'none' | 'date'>;
  expiresAt: FormControl<string>;
}>;

// Hộp thoại Thêm / Sửa nhân viên (UC-ACC-07 luồng chính, nhánh 1a, 1d).
// Reactive Form: validator nhóm ô chọn "1 hoặc 2 vai trò", FormArray quyền riêng, validator ngày sau hôm nay (Chương V).
@Component({
  selector: 'app-staff-dialog',
  standalone: false,
  templateUrl: './staff-dialog.html',
})
export class StaffDialog implements OnInit {
  @Input() staff: IStaff | null = null;
  @Input() roles: IRole[] = [];
  @Input() catalog: IPermissionArea[] = [];
  @Input() isSelf = false;
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<{ message: string; devLink?: string; removed?: string[] }>();

  private readonly fb = inject(FormBuilder);
  private readonly api = inject(StaffApiService);

  readonly saving = signal(false);
  readonly errMessage = signal('');
  readonly advancedOpen = signal(false);
  readonly selectedRoles = signal<string[]>([]);

  readonly form = this.fb.nonNullable.group({
    fullName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(60)]],
    email: ['', [Validators.required, Validators.email]],
    phone: ['', [Validators.required, phoneValidator]],
    staffRoles: [[] as string[], [selectCountValidator(1, 2, 'Chọn 1 hoặc 2 vai trò')]],
    overrides: this.fb.array<OverrideForm>([]),
  });

  get overrides(): FormArray<OverrideForm> {
    return this.form.controls.overrides;
  }

  // Quyền của các vai trò đang chọn (để lọc danh sách Cấp thêm / Thu hồi - BR-38)
  readonly rolePermissions = computed(() => new Set(this.roles.filter((r) => this.selectedRoles().includes(r.code)).flatMap((r) => r.permissions)));
  readonly hasAdminRole = computed(() => this.selectedRoles().includes('QUAN_TRI'));

  ngOnInit(): void {
    const s = this.staff;
    if (s) {
      this.form.patchValue({ fullName: s.fullName, email: s.email || '', phone: s.phone, staffRoles: s.staffRoles.map((r) => r.code) });
      this.form.controls.email.disable(); // email dùng để đăng nhập, không sửa
      for (const o of s.overrides) this.overrides.push(this.overrideGroup(o));
      if (s.overrides.length) this.advancedOpen.set(true);
      this.overrides.markAsPristine();
    }
    this.selectedRoles.set(this.form.controls.staffRoles.value);
  }

  private overrideGroup(o?: IPermissionOverride): OverrideForm {
    const group = this.fb.nonNullable.group({
      type: [(o?.type || 'CAP_THEM') as 'CAP_THEM' | 'THU_HOI'],
      permission: [o?.permission || '', Validators.required],
      expiry: [(o?.expiresAt ? 'date' : 'none') as 'none' | 'date'],
      expiresAt: [o?.expiresAt ? new Date(o.expiresAt).toLocaleDateString('en-CA') : '', futureDateValidator],
    });
    return group;
  }

  toggleRole(code: string): void {
    const current = this.form.controls.staffRoles.value;
    const next = current.includes(code) ? current.filter((c) => c !== code) : [...current, code];
    this.form.controls.staffRoles.setValue(next);
    this.form.controls.staffRoles.markAsTouched();
    this.selectedRoles.set(next);
  }

  addOverride(): void {
    this.overrides.push(this.overrideGroup());
    this.overrides.markAsDirty();
  }

  removeOverride(i: number): void {
    this.overrides.removeAt(i);
    this.overrides.markAsDirty();
  }

  // Danh sách quyền hợp lệ theo loại: Cấp thêm = vai trò chưa có; Thu hồi = vai trò đang có
  options(type: 'CAP_THEM' | 'THU_HOI'): { group: string; items: { code: string; label: string }[] }[] {
    const has = this.rolePermissions();
    return this.catalog
      .filter((a) => !a.adminOnly)
      .map((a) => ({
        group: a.areaLabel,
        items: a.actions.filter((x) => (type === 'CAP_THEM' ? !has.has(x.code) : has.has(x.code))).map((x) => ({ code: x.code, label: x.label })),
      }))
      .filter((g) => g.items.length);
  }

  error(name: string): string {
    return firstError(this.form.get(name), { minlength: 'Họ tên cần 2-60 ký tự' });
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    if (v.overrides.some((o) => o.expiry === 'date' && !o.expiresAt)) {
      this.errMessage.set('Chọn ngày hết hạn cho quyền riêng có thời hạn');
      return;
    }
    const overrides = this.hasAdminRole()
      ? []
      : v.overrides.map((o) => ({ permission: o.permission, type: o.type, expiresAt: o.expiry === 'date' && o.expiresAt ? o.expiresAt : null }));
    this.saving.set(true);
    this.errMessage.set('');

    if (!this.staff) {
      this.api.createStaff({ fullName: v.fullName, email: v.email, phone: v.phone.replace(/[\s.]/g, ''), staffRoles: v.staffRoles, permissionOverrides: overrides }).subscribe({
        next: (res) => this.saved.emit({ message: res.message, devLink: res.devLink }),
        error: (err: ApiError) => this.fail(err),
      });
      return;
    }

    // Sửa: chỉ gửi quyền riêng khi Quản trị có đổi ở mục Nâng cao; không đổi thì server tự gỡ quyền không còn tác dụng
    const body: Record<string, unknown> = { _id: this.staff._id, fullName: v.fullName, phone: v.phone.replace(/[\s.]/g, ''), staffRoles: v.staffRoles };
    if (this.overrides.dirty && !this.isSelf) body['permissionOverrides'] = overrides;
    this.api.updateStaff(body).subscribe({
      next: (res) => this.saved.emit({ message: `Đã lưu thay đổi cho ${res.staff.fullName}`, removed: res.removedOverrides.map((o) => o.permission) }),
      error: (err: ApiError) => this.fail(err),
    });
  }

  private fail(err: ApiError): void {
    this.saving.set(false);
    const fields = (err.extra?.['fields'] || {}) as Record<string, string>;
    for (const [name, msg] of Object.entries(fields)) {
      const control = this.form.get(name);
      if (control) {
        control.setErrors({ server: msg });
        control.markAsTouched();
      }
    }
    this.errMessage.set(err.message);
  }
}
