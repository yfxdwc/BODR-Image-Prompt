// 2026-07-12 主人拍: 顶栏用户中心按钮. 点击打开 UserCenter drawer (含 user 信息 + Admin tabs).
// 不再是 popover, 也不跳 ConfigPanel.

import { useAuth } from '../auth/AuthContext';
import { useDrawer } from '../auth/DrawerContext';
import type { Translator } from '../utils/i18n';

interface Props {
  t: Translator;
}

export default function UserMenu({ t }: Props) {
  const { user } = useAuth();
  const { openUserCenter } = useDrawer();

  if (!user) return null;

  const initial = (user.display_name || user.username || '?').slice(0, 1).toUpperCase();
  const roleLabel = user.role === 'admin'
    ? (t('roleAdmin') || 'Admin')
    : (t('roleUser') || 'User');

  return (
    <button
      type="button"
      data-drawer-trigger="user-center" className="user-menu-trigger"
      onClick={() => openUserCenter(false)}
      aria-label={`${user.username} · 用户中心`}
      title="用户中心"
    >
      <span className="user-menu-avatar">{initial}</span>
      <span className="user-menu-name">{user.username}</span>
      <span className={`user-menu-role-badge role-${user.role}`}>{roleLabel}</span>
    </button>
  );
}
