export type AccountRole = 'COMPANY' | 'STORE';

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
};

export type AuthResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: User;
};
