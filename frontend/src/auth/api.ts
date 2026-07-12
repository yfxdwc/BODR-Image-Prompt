// 2026-07-11 BIP auth/RBAC: 跟后端 /api/auth/* + /api/admin/* 通信. 走 cookie 自动带 (credentials: 'include').

import type { AuthUser, TokenPair, LoginPayload, RegisterPayload } from './types';

const API = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(API + path, {
    ...init,
    credentials: 'include',  // 跨 cloudflare tunnel 也能带上 cookie
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      const body = await r.json();
      if (body?.detail) msg = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
    } catch {
      try { msg = (await r.text()) || msg; } catch {}
    }
    const err = new Error(msg);
    (err as any).status = r.status;
    throw err;
  }
  // 204 no content
  if (r.status === 204) return undefined as unknown as T;
  return r.json() as Promise<T>;
}

export const authApi = {
  me: () => request<AuthUser | null>('/auth/me'),

  login: (payload: LoginPayload) =>
    request<TokenPair>('/auth/login', { method: 'POST', body: JSON.stringify(payload) }),

  register: (payload: RegisterPayload) =>
    request<{ user_id: string; request_id: string; status: string }>(
      '/auth/register', { method: 'POST', body: JSON.stringify(payload) },
    ),

  logout: () => request<void>('/auth/logout', { method: 'POST' }),

  // ── admin ──
  listRequests: (status?: 'pending' | 'approved' | 'rejected') =>
    request<{ items: any[]; total: number }>(
      `/admin/requests${status ? `?status=${status}` : ''}`,
    ),

  approveRequest: (requestId: string, reviewNote?: string) =>
    request<any>(`/admin/requests/${requestId}/approve`, {
      method: 'POST', body: JSON.stringify({ review_note: reviewNote ?? '' }),
    }),

  rejectRequest: (requestId: string, reason: string) =>
    request<any>(`/admin/requests/${requestId}/reject`, {
      method: 'POST', body: JSON.stringify({ review_note: reason }),
    }),

  listUsers: () => request<{ items: AuthUser[]; total: number }>('/admin/users'),

  setRole: (userId: string, newRole: 'admin' | 'user' | 'pending' | 'rejected') =>
    request<any>(`/admin/users/${userId}/role?new_role=${newRole}`, { method: 'PATCH' }),

  deleteUser: (userId: string) =>
    request<void>(`/admin/users/${userId}`, { method: 'DELETE' }),

  adminCreateUser: (payload: { email: string; username: string; password: string; role: 'admin' | 'user'; display_name?: string }) =>
    request<any>('/admin/users', { method: 'POST', body: JSON.stringify(payload) }),

  listAudit: (params?: { limit?: number; offset?: number; action?: string; user_id?: string }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    if (params?.action) qs.set('action', params.action);
    if (params?.user_id) qs.set('user_id', params.user_id);
    const q = qs.toString();
    return request<{ items: any[]; total: number }>(`/admin/audit${q ? `?${q}` : ''}`);
  },
};
