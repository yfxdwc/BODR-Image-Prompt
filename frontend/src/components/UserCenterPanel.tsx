// 2026-07-12 主人拍: 用户中心弹窗. 顶栏用户头像点击弹出.
// 内容:
//   - 顶部 UserPanel (头像/名字/邮箱/角色徽章/登出/去设置)
//   - 下方 tab 区 (admin 用户看: 审批 / 用户 / Audit; 普通用户空)

import { useEffect, useState } from 'react';
import { LogOut, ShieldCheck, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useDrawer } from '../auth/DrawerContext';
import { authApi } from '../auth/api';
import type { Translator } from '../utils/i18n';

interface Props {
  t: Translator;
}

interface PendingRequest {
  id: string;
  user_id: string;
  user_email: string;
  user_username: string;
  requested_at: string;
  reason: string | null;
  status: string;
}

function ConfigUserPanel({ t, onOpenConfig }: { t: Translator; onOpenConfig: () => void }) {
  const { user, isAdmin, logout } = useAuth();
  if (!user) return null;
  const initial = (user.display_name || user.username || '?').slice(0, 1).toUpperCase();
  const roleLabel = user.role === 'admin' ? (t('roleAdmin') || 'Admin') : (t('roleUser') || 'User');
  const handleLogout = () => {
    if (confirm(t('confirmLogout') || '确认登出?')) void logout();
  };
  return (
    <section className="setting-group config-user-panel">
      <div className="config-user-head">
        <div className="config-user-avatar">{initial}</div>
        <div className="config-user-id">
          <strong className="config-user-name">{user.display_name || user.username}</strong>
          <span className="config-user-email muted small">{user.email}</span>
          <span className={`user-menu-role-badge role-${user.role}`}>{roleLabel}</span>
        </div>
      </div>
      <div className="config-user-actions">
        {!isAdmin && (
          <button type="button" className="config-user-action-btn" onClick={onOpenConfig}>
            <ShieldCheck size={16} />
            <span>设置</span>
          </button>
        )}
        <button type="button" className="config-user-action-btn config-user-action-logout" onClick={handleLogout}>
          <LogOut size={16} />
          <span>{t('logout') || '登出'}</span>
        </button>
      </div>
    </section>
  );
}

export default function UserCenterPanel({ t }: Props) {
  const { isAdmin } = useAuth();
  const { userCenterOpen, closeUserCenter, openConfig, adminTabActive } = useDrawer();

  const [tab, setTab] = useState<'requests' | 'users' | 'audit'>('requests');
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (userCenterOpen && adminTabActive) setTab('requests');
  }, [userCenterOpen, adminTabActive]);

  useEffect(() => {
    if (!userCenterOpen || !isAdmin) return;
    setError(null);
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userCenterOpen, isAdmin]);

  const loadAll = async () => {
    try {
      const [reqs, us, au] = await Promise.all([
        authApi.listRequests(),
        authApi.listUsers(),
        authApi.listAudit({ limit: 50 }),
      ]);
      setRequests(reqs.items);
      setUsers(us.items);
      setAudit(au.items);
    } catch (e: any) {
      setError(e?.message || 'load failed');
    }
  };

  const handleApprove = async (rid: string) => {
    setBusyId(rid); setError(null);
    try { await authApi.approveRequest(rid); await loadAll(); }
    catch (e: any) { setError(e?.message || 'approve failed'); }
    finally { setBusyId(null); }
  };

  const handleReject = async (rid: string) => {
    const reason = prompt('拒绝理由 (≥3 字符):');
    if (!reason || reason.trim().length < 3) return;
    setBusyId(rid); setError(null);
    try { await authApi.rejectRequest(rid, reason.trim()); await loadAll(); }
    catch (e: any) { setError(e?.message || 'reject failed'); }
    finally { setBusyId(null); }
  };

  const handleSetRole = async (uid: string, role: 'admin' | 'user') => {
    if (!confirm(`确定将此用户角色改为 ${role}?`)) return;
    setError(null);
    try { await authApi.setRole(uid, role); await loadAll(); }
    catch (e: any) { setError(e?.message || 'role change failed'); }
  };

  return (
    <aside className={`config drawer ${userCenterOpen ? 'open' : ''}`} aria-label="用户中心">
      <div className="drawer-head">
        <h2>用户中心</h2>
        <button className="panel-close" onClick={closeUserCenter} aria-label="关闭">
          <X size={20} strokeWidth={2.25} />
        </button>
      </div>

      <ConfigUserPanel t={t} onOpenConfig={() => { closeUserCenter(); openConfig(); }} />

      {isAdmin ? (
        <>
          <div className="config-tabs" role="tablist">
            <button role="tab" className={tab === 'requests' ? 'active' : ''} onClick={() => setTab('requests')}>
              审批 ({requests.filter(r => r.status === 'pending').length})
            </button>
            <button role="tab" className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>
              用户 ({users.length})
            </button>
            <button role="tab" className={tab === 'audit' ? 'active' : ''} onClick={() => setTab('audit')}>
              Audit ({audit.length})
            </button>
          </div>

          {error && <div className="auth-overlay-error" style={{ margin: '10px 14px' }}>{error}</div>}

          {tab === 'requests' && (
            <div className="admin-tab-body">
              {requests.length === 0 ? <p className="muted">暂无申请记录</p> :
                requests.map(r => (
                  <div key={r.id} className="admin-row">
                    <div className="admin-row-main">
                      <strong>{r.user_username}</strong> <span className="muted">({r.user_email})</span>
                      <div className="muted small">{r.requested_at} · status: {r.status}</div>
                      {r.reason && <div className="admin-row-reason">{r.reason}</div>}
                    </div>
                    {r.status === 'pending' && (
                      <div className="admin-row-actions">
                        <button className="primary small" disabled={busyId === r.id} onClick={() => handleApprove(r.id)}>批准</button>
                        <button className="secondary small" disabled={busyId === r.id} onClick={() => handleReject(r.id)}>拒绝</button>
                      </div>
                    )}
                  </div>
                ))
              }
            </div>
          )}

          {tab === 'users' && (
            <div className="admin-tab-body">
              {users.map(u => (
                <div key={u.id} className="admin-row">
                  <div className="admin-row-main">
                    <strong>{u.username}</strong> <span className="muted">({u.email})</span>
                    <div className="muted small">
                      role: <code>{u.role}</code> · 创建 {u.created_at}
                      {u.last_login_at && <> · 最近登录 {u.last_login_at}</>}
                    </div>
                  </div>
                  <div className="admin-row-actions">
                    {u.role !== 'admin' && (
                      <button className="secondary small" onClick={() => handleSetRole(u.id, 'admin')}>提升 admin</button>
                    )}
                    {u.role === 'admin' && (
                      <button className="secondary small" onClick={() => handleSetRole(u.id, 'user')}>降为 user</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'audit' && (
            <div className="admin-tab-body">
              {audit.length === 0 ? <p className="muted">暂无 audit</p> :
                <table className="audit-table">
                  <thead><tr><th>id</th><th>action</th><th>user</th><th>ip</th><th>created</th></tr></thead>
                  <tbody>
                    {audit.map(a => (
                      <tr key={a.id}>
                        <td>{a.id}</td>
                        <td><code>{a.action}</code></td>
                        <td className="muted small">{a.user_id?.slice(0, 14) ?? '-'}</td>
                        <td className="muted small">{a.ip ?? '-'}</td>
                        <td className="muted small">{a.created_at}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              }
            </div>
          )}
        </>
      ) : (
        <div className="admin-tab-body">
          <p className="muted" style={{ padding: '20px', textAlign: 'center' }}>
            你是普通用户, 没有管理面板权限.<br />如需修改账号信息请联系管理员.
          </p>
        </div>
      )}
    </aside>
  );
}
