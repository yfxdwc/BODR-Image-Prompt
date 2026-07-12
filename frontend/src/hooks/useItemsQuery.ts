import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { ItemList, ItemSortMode } from '../types';
import { DEFAULT_ITEM_SORT } from '../utils/searchSort';

type QueryScope = {
  q: string;
  clusterId?: string;
  tag?: string;
  viewLimit: number;
  sort: ItemSortMode;
};

export function useItemsQuery(q: string, clusterId?: string, tag?: string, viewLimit = 100, reloadKey = 0, sort: ItemSortMode = DEFAULT_ITEM_SORT, authStatus: 'loading' | 'anonymous' | 'authenticated' = 'authenticated') {
  const [data, setData] = useState<ItemList>({ items: [], total: 0, limit: viewLimit, offset: 0 });
  const [dataScope, setDataScope] = useState<QueryScope>({ q: '', clusterId: undefined, tag: undefined, viewLimit, sort });
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    // 2026-07-12 主人拍: 未登录时绝不发起 /api/items 请求, 否则会拿到 401 错误存到 error state,
    // 登录成功后内容区显示的还是这条 stale 错误, 必须刷新页面才能清除.
    // 等 authStatus === 'authenticated' 才发, 此时 cookie 一定有.
    if (authStatus !== 'authenticated') {
      // 清空数据但保持空 list (避免显示前一次的 stale 数据)
      setData({ items: [], total: 0, limit: viewLimit, offset: 0 });
      setLoading(false);
      setInitialLoading(false);
      setRefreshing(false);
      return;
    }
    let cancelled = false;
    const hasVisibleData = data.items.length > 0 || data.total > 0;
    setLoading(true);
    setInitialLoading(!hasVisibleData);
    setRefreshing(hasVisibleData);
    setError(undefined);

    api.items({ q, cluster: clusterId, tag, limit: viewLimit, sort })
      .then(nextData => {
        if (!cancelled) {
          setData(nextData);
          setDataScope({ q, clusterId, tag, viewLimit, sort });
        }
      })
      .catch(e => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setInitialLoading(false);
          setRefreshing(false);
        }
      });

    return () => { cancelled = true; };
  }, [q, clusterId, tag, viewLimit, reloadKey, sort, authStatus]);

  return { data, loading, initialLoading, refreshing, error, dataScope };
}
