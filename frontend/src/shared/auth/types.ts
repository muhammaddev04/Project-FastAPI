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
  /** P02 verification status of the organization. */
  verification_status?: 'NOT_SUBMITTED' | 'PENDING' | 'APPROVED' | 'REJECTED' | null;
  /** CR-003: 5-minute signed URL of the company logo / store image; null when there is none. Never stored. */
  logo_url?: string | null;
};

/** P01 §10: the Company/Store choice (and organization name) given at registration; null when none was given. */
export type Onboarding = { org_type: OrgType | null; org_name: string | null };

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
  /** CR-001/CR-003: phone verification is not part of the product yet, so this stays null. */
  phone_verified_at: string | null;
  /** CR-003: 5-minute signed URL of the user's own avatar; null when there is none. Never stored. */
  avatar_url?: string | null;
  last_login_at: string | null;
  created_at: string;
  memberships: Membership[];
  onboarding: Onboarding;
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
