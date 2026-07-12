// 2026-07-11 BIP auth/RBAC: admin-only 浮层面板. 显示注册审批队列 + 用户列表 + audit 简要.
// 用一个齿轮按钮触发, 跟 ConfigPanel 同位置模式.

import { useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { authApi } from './api';

interface PendingRequest {
  id: string;
  user_id: string;
  user_email: string;
  user_username: string;
  requested_at: string;
  reason: string | null;
  status: string;
}

export function AdminPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState<'requests' | 'users' | 'audit'>('requests');
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !isAdmin) return;
    setError(null);
    void loadAll();
  }, [open, isAdmin]);

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

  if (!open || !isAdmin) return null;

  return (
    <div className={`config drawer ${open ? "open" : ""}`} role="dialog" aria-labelledby="admin-panel-title">
      <div className="config-head">
        <h2 id="admin-panel-title">Admin</h2>
        <button className="panel-close" onClick={onClose} aria-label="close">×</button>
      </div>
      <div className="config-tabs" role="tablist">
        <button role="tab" className={tab==='requests' ? 'active' : ''} onClick={() => setTab('requests')}>
          审批 ({requests.filter(r => r.status==='pending').length})
        </button>
        <button role="tab" className={tab==='users' ? 'active' : ''} onClick={() => setTab('users')}>
          用户 ({users.length})
        </button>
        <button role="tab" className={tab==='audit' ? 'active' : ''} onClick={() => setTab('audit')}>
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
                    <button className="primary small" disabled={busyId===r.id} onClick={() => handleApprove(r.id)}>
                      批准
                    </button>
                    <button className="secondary small" disabled={busyId===r.id} onClick={() => handleReject(r.id)}>
                      拒绝
                    </button>
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
    </div>
  );
}
