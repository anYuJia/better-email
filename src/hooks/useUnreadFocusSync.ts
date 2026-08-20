import { useEffect } from 'react';
import type { AccountScope } from '../app/types';
import { getCurrentWindow } from '../tauriBridge';

type UnreadRefreshFn = (scope?: AccountScope) => Promise<void>;

/**
 * 在初次挂载与账号 scope 切换时订阅窗口焦点事件，只在窗口之后真正获得焦点时
 * 刷新未读角标/托盘（失焦不触发任何 IPC）。首启与 scope 切换的第一次统计由
 * loadMeta 负责，避免这里再主动发起一组 get_stats / tray IPC。
 *
 * `refreshUnreadIndicators` 必须是稳定引用（useAppMetaLoader 返回的 useCallback），
 * 否则每次渲染都会走一遍“取消订阅 → 重新订阅 onFocusChanged”，放大真正聚焦时
 * 的请求与监听成本。依赖数组只包含 [refreshUnreadIndicators, accountScope]，
 * 因此只在真正需要时重新订阅；accountScope 变化时闭包捕获最新 scope，
 * 不会读到旧账号统计。
 */
export default function useUnreadFocusSync(
  refreshUnreadIndicators: UnreadRefreshFn,
  accountScope: AccountScope,
) {
  useEffect(() => {
    const syncIndicators = () => {
      void refreshUnreadIndicators(accountScope);
    };
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
