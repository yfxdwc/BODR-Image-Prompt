// 2026-07-12 主人拍: 右下角显示前端 build 时间戳. 用户能立刻识别是否跑的是最新代码.
// vite.config.js 注入 __BUILD_TIME__ (epoch ms). 转成 YYYY-MM-DD HH:MM.

declare const __BUILD_TIME__: number;

function formatBuildTime(epochMs: number): string {
  const d = new Date(epochMs);
  const y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const D = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${M}-${D} ${h}:${m}`;
}

export default function VersionBadge() {
  const buildTime: number = __BUILD_TIME__;
  return (
    <span
      title={`前端构建于 ${formatBuildTime(buildTime)} (${buildTime})`}
      style={{
        position: 'fixed',
        right: 8,
        bottom: 6,
        zIndex: 5,
        padding: '3px 8px',
        borderRadius: 999,
        background: 'rgba(33,25,34,.55)',
        color: 'rgba(255,255,255,.85)',
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: '.02em',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      build {formatBuildTime(buildTime)}
    </span>
  );
}
