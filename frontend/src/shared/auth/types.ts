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
  phone: string;
  full_name: string;
  email: string | null;
  email_verified: boolean;
  language: Language;
  status: 'ACTIVE' | 'BLOCKED';
  is_superadmin: boolean;
  phone_verified_at: string;
  last_login_at: string | null;
  created_at: string;
  memberships: Membership[];
};

export type Member = {
  id: string;
  user_id: string;
  full_name: string;
  phone: string;
  role: Role;
  status: MembershipStatus;
  joined_at: string;
};

export type Page<T> = { count: number; limit: number; offset: number; results: T[] };
