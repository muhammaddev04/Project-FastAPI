/** Mirrors backend app/modules/identity/schemas.py (GET /api/v1/me, GET /api/v1/members). */
export type OrgType = 'COMPANY' | 'STORE';
export type CompanyRole = 'OWNER' | 'MANAGER' | 'OPERATOR' | 'WAREHOUSE' | 'COURIER';
export type StoreRole = 'OWNER' | 'SELLER';
export type Role = CompanyRole | StoreRole;
export type MembershipStatus = 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
export type Language = 'tg' | 'ru' | 'en';

export type Membership = {
  id: string;
  organization_id: string;
  org_type: OrgType;
  org_name: string;
  org_status: 'ACTIVE' | 'SUSPENDED' | 'BLOCKED';
  role: Role;
  status: MembershipStatus;
  joined_at: string;
  permissions: string[];
};

export type Me = {
  id: string;
  /** CR-001: email is the sign-in identifier; phone is an optional contact. */
  email: string;
  phone: string | null;
  full_name: string;
  email_verified: boolean;
  language: Language;
  status: 'ACTIVE' | 'BLOCKED';
  is_superadmin: boolean;
  phone_verified_at: string | null;
  last_login_at: string | null;
  created_at: string;
  memberships: Membership[];
};

export type Member = {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: Role;
  status: MembershipStatus;
  joined_at: string;
};

export type Page<T> = { count: number; limit: number; offset: number; results: T[] };
