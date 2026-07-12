// 2026-07-11 BIP auth/RBAC: 全局 user 状态. App.tsx 顶层包 <AuthProvider>, 任何子组件用 useAuth() 取 user.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AuthUser, LoginPayload, RegisterPayload } from './types';
import { authApi } from './api';

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated';

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  login: (payload: LoginPayload) => Promise<void>;
  logout: () => Promise<void>;
  register: (payload: RegisterPayload) => Promise<{ user_id: string; request_id: string; status: string }>;
  refresh: () => Promise<void>;  // 重新探测 /api/auth/me
  isAdmin: boolean;
  isUser: boolean;  // user OR admin
}

const AuthCtx = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  // 防止 StrictMode 双调用
  const initRan = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const u = await authApi.me();
      if (u && (u.role === 'admin' || u.role === 'user')) {
        setUser(u);
        setStatus('authenticated');
      } else {
        setUser(null);
        setStatus('anonymous');
      }
    } catch (e: any) {
      // 401 = 未登录, 其他 = 网络错误, 都按匿名处理 (前端不让进)
      setUser(null);
      setStatus('anonymous');
    }
  }, []);

  // 首次挂载探测 (StrictMode 安全)
  useEffect(() => {
    if (initRan.current) return;
    initRan.current = true;
    void refresh();
  }, [refresh]);

  const login = useCallback(async (payload: LoginPayload) => {
    // 2026-07-12 主人拍: 登录后直接用 login 响应里的 user, 不再调 refresh().
    // refresh() 会立刻发 /me 请求, 但浏览器对 Set-Cookie 的处理可能还没生效,
    // 导致 /me 拿不到 cookie 返回 401 -> 内容区报错 -> 必须刷新页面才好.
    // login 响应已经包含完整 user, 直接用它即可避免这个时序问题.
    const tokens = await authApi.login(payload);
    if (tokens?.user && (tokens.user.role === 'admin' || tokens.user.role === 'user')) {
      setUser(tokens.user);
      setStatus('authenticated');
    } else {
      // 兜底: 万一 role 不是 admin/user (理论上 login 路由已拒) 仍然 refresh
      await refresh();
    }
  }, [refresh]);

  const logout = useCallback(async () => {
    try { await authApi.logout(); } catch {}
    setUser(null);
    setStatus('anonymous');
  }, []);

  const register = useCallback(async (payload: RegisterPayload) => {
    return authApi.register(payload);
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    status,
    user,
    login,
    logout,
    register,
    refresh,
    isAdmin: user?.role === 'admin',
    isUser: user?.role === 'admin' || user?.role === 'user',
  }), [status, user, login, logout, register, refresh]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
