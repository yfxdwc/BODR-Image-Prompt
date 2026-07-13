// 2026-07-11 BIP auth/RBAC: 跟后端 /api/auth/* + /api/admin/* 通信. 走 cookie 自动带 (credentials: 'include').

import type { AuthUser, TokenPair, LoginPayload, RegisterPayload } from './types';

const API = '/api';

let inflightRefresh: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (inflightRefresh) return inflightRefresh;
  inflightRefresh = (async () => {
    try {
      const r = await fetch(API + '/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      return r.ok;
    } catch {
      return false;
    } finally {
      // 释放, 下次 401 仍能重试
      setTimeout(() => { inflightRefresh = null; }, 0);
    }
  })();
  return inflightRefresh;
}

async function request<T>(path: string, init?: RequestInit, _retried = false): Promise<T> {
  const r = await fetch(API + path, {
    ...init,
    credentials: 'include',  // 跨 cloudflare tunnel 也能带上 cookie
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  // 2026-07-14 主人拍: 长期登录. access 1h 过期时静默 refresh 一次再重放请求.
  if (r.status === 401 && !_retried && path !== '/auth/login' && path !== '/auth/refresh' && path !== '/auth/register') {
    const ok = await tryRefresh();
    if (ok) return request<T>(path, init, true);
  }
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

  // 2026-07-14 主人拍: 长期登录. access 过期前用 refresh cookie 静默续签.
  refresh: () => request<TokenPair>('/auth/refresh', { method: 'POST', body: '{}' }),

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
