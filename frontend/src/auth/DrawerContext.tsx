// 2026-07-12 主人拍: 全局抽屉状态 (设置弹窗 + 用户中心弹窗 + admin 状态).
// 顶栏的设置齿轮和用户头像按钮都从这里拿 setter, 不必层层 prop drilling.

import { createContext, useContext, useState, useMemo, useCallback, useEffect, type ReactNode } from 'react';

interface DrawerValue {
  configOpen: boolean;
  userCenterOpen: boolean;
  adminTabActive: boolean;
  openConfig: () => void;
  closeConfig: () => void;
  openUserCenter: (openAdmin?: boolean) => void;
  closeUserCenter: () => void;
}

const DrawerCtx = createContext<DrawerValue | null>(null);

export function DrawerProvider({ children }: { children: ReactNode }) {
  const [configOpen, setConfigOpen] = useState(false);
  const [userCenterOpen, setUserCenterOpen] = useState(false);
  const [adminTabActive, setAdminTabActive] = useState(false);

  // 2026-07-15 主人拍: 点弹窗外部自动收起. 通过 data-drawer 属性标记, 命中点不在内部即关.
  useEffect(() => {
    if (!configOpen && !userCenterOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      // 点在 .drawer 内部 -> 保留
      if (t.closest('[data-drawer]')) return;
      // 点在触发按钮 (data-drawer-trigger) -> 让按钮自己的 onClick 处理
      if (t.closest('[data-drawer-trigger]')) return;
      if (configOpen) setConfigOpen(false);
      if (userCenterOpen) {
        setUserCenterOpen(false);
        setAdminTabActive(false);
      }
    };
    // 用 mousedown + 略延后判断 click 防止按钮自己触发后再关掉
    const id = window.setTimeout(() => {
      document.addEventListener('mousedown', onDown);
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('mousedown', onDown);
    };
  }, [configOpen, userCenterOpen]);

  const openConfig = useCallback(() => {
    setConfigOpen(true);
    setUserCenterOpen(false);
    setAdminTabActive(false);
  }, []);
  const closeConfig = useCallback(() => setConfigOpen(false), []);

  const openUserCenter = useCallback((openAdmin: boolean = false) => {
    setUserCenterOpen(true);
    setConfigOpen(false);
    setAdminTabActive(openAdmin);
  }, []);
  const closeUserCenter = useCallback(() => {
    setUserCenterOpen(false);
    setAdminTabActive(false);
  }, []);

  const value = useMemo<DrawerValue>(() => ({
    configOpen,
    userCenterOpen,
    adminTabActive,
    openConfig,
    closeConfig,
    openUserCenter,
    closeUserCenter,
  }), [configOpen, userCenterOpen, adminTabActive, openConfig, closeConfig, openUserCenter, closeUserCenter]);

  return <DrawerCtx.Provider value={value}>{children}</DrawerCtx.Provider>;
}

export function useDrawer(): DrawerValue {
  const v = useContext(DrawerCtx);
  if (!v) throw new Error('useDrawer must be used within DrawerProvider');
  return v;
}
