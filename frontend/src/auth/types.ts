// 2026-07-11 BIP auth/RBAC
export type AuthRole = 'admin' | 'user' | 'pending' | 'rejected';

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  role: AuthRole;
  display_name: string | null;
  created_at: string;
  approved_at: string | null;
  last_login_at: string | null;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  access_expires_at: string;
  refresh_expires_at: string;
  user: AuthUser;
}

export interface RegisterPayload {
  email: string;
  username: string;
  password: string;
  reason?: string;
  display_name?: string;
}

export interface LoginPayload {
  username: string;  // accepts username or email
  password: string;
}
