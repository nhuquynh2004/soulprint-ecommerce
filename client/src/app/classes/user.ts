// Mô hình người dùng, địa chỉ, nhân viên, vai trò (API-04, API-09, API-134, API-178, API-183 - 07_API_Spec.md).

export type Gender = 'NAM' | 'NU' | 'KHAC';
export type UserStatus = 'CHO_KICH_HOAT' | 'HOAT_DONG' | 'BI_KHOA';

export interface IUser {
  _id: string;
  fullName: string;
  email: string | null;
  phone: string;
  role: 'member' | 'admin';
  gender: Gender | null;
  birthday: string | null;
  status: UserStatus;
  // Chỉ tài khoản nhân viên (API-04, API-131)
  staffRoles?: { code: string; name: string }[];
  isFullAccess?: boolean;
  permissions?: string[];
  // Tài khoản tạo bằng Google chưa đặt mật khẩu thì hasPassword = false
  hasPassword?: boolean;
  googleLinked?: boolean;
}

export class User implements IUser {
  _id = '';
  fullName = '';
  email: string | null = null;
  phone = '';
  role: 'member' | 'admin' = 'member';
  gender: Gender | null = null;
  birthday: string | null = null;
  status: UserStatus = 'HOAT_DONG';
  staffRoles: { code: string; name: string }[] = [];
  isFullAccess = false;
  permissions: string[] = [];
  hasPassword = true;
  googleLinked = false;

  constructor(data?: Partial<IUser>) {
    Object.assign(this, data);
  }

  // "Nguyễn Minh Anh" -> "MA" (avatar chữ cái)
  get initials(): string {
    const words = this.fullName.trim().split(/\s+/);
    return ((words.length > 1 ? words[words.length - 2][0] : '') + (words[words.length - 1]?.[0] || '')).toUpperCase();
  }

  // Tên gọi ngắn: 2 chữ cuối ("Minh Anh")
  get shortName(): string {
    return this.fullName.trim().split(/\s+/).slice(-2).join(' ');
  }

  // Nhân viên có quyền này không (vai trò Quản trị luôn có - BR-34)
  can(permission: string): boolean {
    return this.isFullAccess || this.permissions.includes(permission);
  }
}

// Tài khoản nhận tiền hoàn đã lưu ở SCR-15 (API-226); account là số đã che "****3456"
export interface ISavedRefundAccount {
  bankName: string;
  accountName: string;
  account: string;
  savedAt: string | null;
}

export interface IAddress {
  _id: string;
  recipientName: string;
  phone: string;
  province: string;
  ward: string;
  street: string;
  isDefault: boolean;
}

export interface IPermissionOverride {
  permission: string;
  type: 'CAP_THEM' | 'THU_HOI';
  expiresAt: string | null;
}

// Một dòng bảng Nhân viên (SCR-57)
export interface IStaff {
  _id: string;
  fullName: string;
  email: string | null;
  phone: string;
  staffRoles: { code: string; name: string }[];
  extraCount: number;
  revokedCount: number;
  overrides: IPermissionOverride[];
  status: UserStatus;
  lockReason: string | null;
  lastLoginAt: string | null;
  createdAt: string | null;
}

export interface IRole {
  _id: string;
  code: string;
  name: string;
  description: string;
  type: 'MAC_DINH' | 'TUY_CHINH';
  isFullAccess: boolean;
  permissions: string[];
  permissionCount: number;
  staffCount?: number;
  updatedAt: string | null;
  updatedBy?: string | null;
  staff?: { _id: string; fullName: string; status: UserStatus }[];
}

// Danh mục quyền (API-183): 1 khu vực = 1 dòng của ma trận
export interface IPermissionArea {
  group: string;
  area: string;
  areaLabel: string;
  screens: string[];
  adminOnly: boolean;
  actions: { code: string; label: string; column: 'XEM' | 'TAO' | 'SUA' | 'XOA' | 'KHAC' }[];
}

export interface ISession {
  id: string;
  device: string;
  ipMasked: string;
  createdAt: string | null;
  lastSeenAt: string | null;
  current: boolean;
}

// Địa giới hành chính 2 cấp (External API provinces.open-api.vn/api/v2 - 07 Mục 1.6)
export interface IWard {
  code: number;
  name: string;
}

export interface IProvince {
  code: number;
  name: string;
  wards?: IWard[];
}

export const STATUS_LABEL: Record<UserStatus, string> = {
  HOAT_DONG: 'Đang hoạt động',
  CHO_KICH_HOAT: 'Chờ kích hoạt',
  BI_KHOA: 'Đã khóa',
};
