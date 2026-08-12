import { useEffect } from 'react';
import type { AccountScope } from '../app/types';
import { getCurrentWindow } from '../tauriBridge';

type UnreadRefreshFn = (scope?: AccountScope) => Promise<void>;

/**
 * 在初次挂载与账号 scope 切换时订阅窗口焦点事件，只在窗口真正获得焦点时
 * 刷新未读角标/托盘（失焦不触发任何 IPC）。
 *
 * `refreshUnreadIndicators` 必须是稳定引用（useAppMetaLoader 返回的 useCallback），
 * 否则每次渲染都会走一遍“取消订阅 → 重新订阅 onFocusChanged → 立即执行一次
 * get_stats”，造成 IPC 风暴。依赖数组只包含 [refreshUnreadIndicators, accountScope]，
 * 因此只在真正需要时重新订阅；accountScope 变化时闭包捕获最新 scope，
 * 不会读到旧账号统计。初次挂载与 scope 切换后的主动刷新仍然保留。
 */
export default function useUnreadFocusSync(
  refreshUnreadIndicators: UnreadRefreshFn,
  accountScope: AccountScope,
) {
  useEffect(() => {
    const syncIndicators = () => {
      void refreshUnreadIndicators(accountScope);
    };
    syncIndicators();
    const unlistenPromise = Promise.resolve(
      getCurrentWindow().onFocusChanged?.((focused) => {
        if (focused) syncIndicators();
      }),
    ).catch(() => () => undefined);
    return () => {
      void unlistenPromise.then((unlisten) => unlisten?.());
    };
  }, [refreshUnreadIndicators, accountScope]);
}
