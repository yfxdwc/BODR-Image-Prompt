// 2026-07-12 主人拍: 全局抽屉状态 (设置弹窗 + 用户中心弹窗 + admin 状态).
// 顶栏的设置齿轮和用户头像按钮都从这里拿 setter, 不必层层 prop drilling.

import { createContext, useContext, useState, useMemo, useCallback, type ReactNode } from 'react';

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
