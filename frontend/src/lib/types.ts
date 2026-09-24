export type AccountRole = 'COMPANY' | 'STORE';

export type Membership = {
  id: string;
  organization_id: string;
  organization_type: AccountRole;
  organization_name: string;
  role: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
};

export type User = {
  id: string;
  phone: string;
  full_name: string;
  language: string;
  status: string;
  is_superadmin: boolean;
  roles: string[];
  permissions: string[];
  phone_verified_at: string;
  last_login_at: string | null;
  created_at: string;
  account_type: AccountRole;
  memberships: Membership[];
};

export type AuthResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: User;
};

export function primaryMembership(user: User | null): Membership | null {
  return user?.memberships.find((membership) => membership.status === 'ACTIVE') ?? null;
}

export function roleHome(user: User | null): '/company' | '/store' | '/login' {
  const membership = primaryMembership(user);
  if (!membership) return '/login';
  return membership.organization_type === 'STORE' ? '/store' : '/company';
}
