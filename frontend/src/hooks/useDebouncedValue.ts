import { useEffect, useState } from 'react';

/**
 * @param value 当前值
 * @param delay debounce 延迟 (ms)
 * @param resetKey 任意变化的标识 - 变化时立即把 debounced 同步到 value (跳过延迟).
 *   用于「清空」场景: q='' 时不想等 250ms 才把 debounced 变 ''.
 */
export function useDebouncedValue<T>(value: T, delay = 250, resetKey?: unknown) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  // 2026-07-12 主人拍: resetKey 变化时立即同步 (绕过 debounce).
  useEffect(() => {
    setDebounced(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);
  return debounced;
}
