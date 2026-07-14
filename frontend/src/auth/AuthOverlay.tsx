// 2026-07-11 BIP auth/RBAC: 当 AuthContext.status !== 'authenticated' 时, 整页覆盖一个登录/注册/待审 overlay.
// 三种状态切换: login / register / pending.

import { useEffect, useState } from 'react';
import { useAuth } from './AuthContext';

export function AuthOverlay() {
  const { status, login, register, user } = useAuth();
  const [mode, setMode] = useState<'login' | 'register' | 'pending'>('login');
  const [error, setError] = useState<string | null>(null);
  // 2026-07-14 主人拍: 锁定账户 (HTTP 423) 时, 用专用提示
  const [locked, setLocked] = useState<{ reason: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // 表单 state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [pendingInfo, setPendingInfo] = useState<{ email: string; request_id: string } | null>(null);

  useEffect(() => {
    if (status === 'authenticated') setError(null);
  }, [status]);

  if (status === 'loading' || status === 'authenticated') return null;

  const submitLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login({ username: username.trim(), password });
    } catch (err: any) {
      // 2026-07-14 主人拍: 423 account_locked 错误码 (FastAPI 返回 detail={code, reason, message})
      const status = (err && (err as any).status) as number | undefined;
      if (status === 423) {
        // 401 时 err.message 已是 string; 423 时 detail 是对象. request() 把 detail 透出到 err.message
        // 这里用 message 作为显示文本, 同时把 detail 解析后给锁定提示.
        try {
          const parsed = JSON.parse(err.message);
          if (parsed && parsed.code === "account_locked") {
            setLocked({ reason: parsed.reason || "请联系管理员", message: parsed.message || "账号已被锁定" });
            setError(null);
            setBusy(false);
            return;
          }
        } catch { /* fallthrough */ }
      }
      setError(err?.message || 'login failed');
      setLocked(null);
    } finally {
      setBusy(false);
    }
  };

  const submitRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await register({
        email: email.trim(),
        username: username.trim(),
        password,
        reason: reason.trim() || undefined,
        display_name: displayName.trim() || undefined,
      });
      setPendingInfo({ email: email.trim(), request_id: r.request_id });
      setMode('pending');
    } catch (err: any) {
      setError(err?.message || 'registration failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-overlay" role="dialog" aria-modal="true" aria-labelledby="auth-overlay-title">
      <div className="auth-overlay-card">
        <div className="auth-overlay-eyebrow">BODR Image Prompt</div>

        {mode === 'login' && (
          <>
            <h2 id="auth-overlay-title">登录</h2>
            <p className="auth-overlay-sub">使用您的账号访问私有 prompt 资料库</p>
            <form onSubmit={submitLogin} className="auth-overlay-form">
              <label>
                <span>用户名或邮箱</span>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  autoComplete="username"
                  required
                  disabled={busy}
                  autoFocus
                />
              </label>
              <label>
                <span>密码</span>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  disabled={busy}
                />
              </label>
              {locked && (
                <div className="auth-overlay-locked" role="alert">
                  <div className="auth-overlay-locked-title">🔒 您的账号已被锁定</div>
                  <div className="auth-overlay-locked-msg">{locked.message}</div>
                  {locked.reason && <div className="auth-overlay-locked-reason">原因: {locked.reason}</div>}
                  <div className="auth-overlay-locked-hint">请使用本页"申请注册"重新提交一份新申请，并在理由中说明身份。</div>
                  <button
                    type="button"
                    className="auth-overlay-link"
                    onClick={() => { setLocked(null); setMode('register'); setError(null); }}
                  >
                    前往重新申请 →
                  </button>
                </div>
              )}
              {!locked && error && <div className="auth-overlay-error">{error}</div>}
              <button type="submit" className="auth-overlay-submit primary" disabled={busy}>
                {busy ? '登录中…' : '登录'}
              </button>
              <button
                type="button"
                className="auth-overlay-link"
                onClick={() => { setMode('register'); setError(null); }}
                disabled={busy}
              >
                没有账号? 申请注册 →
              </button>
            </form>
          </>
        )}

        {mode === 'register' && (
          <>
            <h2 id="auth-overlay-title">申请账号</h2>
            <p className="auth-overlay-sub">提交后等待管理员审批通过即可登录</p>
            <form onSubmit={submitRegister} className="auth-overlay-form">
              <label>
                <span>邮箱 *</span>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} required disabled={busy} autoFocus />
              </label>
              <label>
                <span>用户名 * <small>(3-32 字符, A-Z a-z 0-9 _ -)</small></span>
                <input type="text" value={username} onChange={e => setUsername(e.target.value)} required disabled={busy} />
              </label>
              <label>
                <span>显示名</span>
                <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)} disabled={busy} />
              </label>
              <label>
                <span>密码 * <small>(≥8 字符)</small></span>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} required disabled={busy} />
              </label>
              <label>
                <span>申请理由 <small>(可选)</small></span>
                <textarea value={reason} onChange={e => setReason(e.target.value)} disabled={busy} rows={3} />
              </label>
              {error && <div className="auth-overlay-error">{error}</div>}
              <button type="submit" className="auth-overlay-submit primary" disabled={busy}>
                {busy ? '提交中…' : '提交申请'}
              </button>
              <button
                type="button"
                className="auth-overlay-link"
                onClick={() => { setMode('login'); setError(null); }}
                disabled={busy}
              >
                ← 返回登录
              </button>
            </form>
          </>
        )}

        {mode === 'pending' && (
          <>
            <h2 id="auth-overlay-title">等待审批</h2>
            <p className="auth-overlay-sub">
              您的账号申请已提交 (<code>{pendingInfo?.email}</code>)。
              管理员审核通过后您将可以登录。审核结果会通过您注册时填写的邮箱或站内通知。
            </p>
            <p className="auth-overlay-sub muted">request id: <code>{pendingInfo?.request_id}</code></p>
            <button
              type="button"
              className="auth-overlay-link"
              onClick={() => { setMode('login'); setPendingInfo(null); }}
            >
              ← 返回登录
            </button>
          </>
        )}
      </div>
    </div>
  );
}
