import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type {
  AccountScope,
  FilterMode,
  MessageSummary,
  SearchScope,
  SyncRun,
  ThreadSummary,
} from '../app/types';
import { flowInfo, flowWarn } from '../app/logger';
import { loadMailboxMessageLimit } from '../app/mailboxListState';
import type { LoadMetaResult } from './useAppMetaLoader';
import type { MailboxDataController } from './useMailboxData';
import { invoke } from '../tauriBridge';
import { IPC } from '../ipc/commands';

type MailboxSyncOptions = {
  folderId: number | null;
  accountScope: AccountScope;
  searchScope: SearchScope;
  query: string;
  filter: FilterMode;
  messageLimit: number;
  mailboxListStateKey: string;
  activeThread: ThreadSummary | null;
  mailboxRefreshRef: MutableRefObject<number>;
  loadMeta: (
    nextFolderId?: number | null,
    nextScope?: AccountScope,
    options?: { mode?: 'mailbox' | 'full' },
  ) => Promise<LoadMetaResult>;
  loadMessagesWithVisibleFallback: MailboxDataController['loadMessagesWithVisibleFallback'];
  openThread: (thread: ThreadSummary, announce?: boolean) => Promise<MessageSummary[]>;
  setSyncRuns?: Dispatch<SetStateAction<SyncRun[]>>;
  setStatus: Dispatch<SetStateAction<string>>;
};

export default function useMailboxSync({
  folderId,
  accountScope,
  searchScope,
  query,
  filter,
  messageLimit,
  mailboxListStateKey,
  activeThread,
  mailboxRefreshRef,
  loadMeta,
  loadMessagesWithVisibleFallback,
  openThread,
  setSyncRuns,
  setStatus,
}: MailboxSyncOptions) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const refreshNoticeTimeoutRef = useRef<number | null>(null);

  const refreshAll = useCallback(async () => {
    const startedAt = performance.now();
    const refreshId = mailboxRefreshRef.current;
    flowInfo('app-flow', 'refreshAll start', {
      folderId,
      scope: accountScope,
      searchScope,
      query: query.trim() || null,
      filter,
      refreshId,
    });
    const meta = await loadMeta(folderId, accountScope, { mode: 'mailbox' });
    // 刷新期间用户已导航到别的视图：旧刷新不得提交任何导航/列表状态。
    if (refreshId !== mailboxRefreshRef.current) {
      flowInfo('app-flow', 'refreshAll aborted by newer navigation', {
        refreshId,
        currentRefreshId: mailboxRefreshRef.current,
      });
      return;
    }
    const refreshLimit = Math.max(messageLimit, loadMailboxMessageLimit(mailboxListStateKey));
    await loadMessagesWithVisibleFallback(meta.folderId, query, filter, accountScope, refreshId, meta.folders, refreshLimit);
    if (activeThread) {
      await openThread(activeThread, false);
    }
    flowInfo('app-flow', 'refreshAll done', {
      resolvedFolderId: meta.folderId,
      durationMs: Math.round(performance.now() - startedAt),
    });
    setStatus('已刷新本地邮箱数据');
  }, [
    folderId,
    accountScope,
    searchScope,
    query,
    filter,
    loadMeta,
    messageLimit,
    mailboxListStateKey,
    loadMessagesWithVisibleFallback,
    activeThread,
    openThread,
    mailboxRefreshRef,
    setStatus,
  ]);

  const syncAndRefresh = useCallback(async () => {
    if (isRefreshing) return;
    const startedAt = performance.now();
    const syncAccountId = accountScope === 'all' ? null : accountScope;
    const refreshId = mailboxRefreshRef.current;
    flowInfo('app-flow', 'syncAndRefresh start', {
      accountId: syncAccountId,
      folderId,
      scope: accountScope,
      searchScope,
      query: query.trim() || null,
      filter,
      refreshId,
    });
    setIsRefreshing(true);
    if (refreshNoticeTimeoutRef.current !== null) {
      window.clearTimeout(refreshNoticeTimeoutRef.current);
    }
    setRefreshNotice(null);
    setStatus('正在同步服务器邮件...');
    try {
      const run = await invoke<SyncRun>(IPC.SyncImapHeaders, { accountId: syncAccountId });
      setSyncRuns?.((current) => [run, ...current].slice(0, 10));
      if (refreshId !== mailboxRefreshRef.current) {
        flowInfo('app-flow', 'syncAndRefresh aborted by newer navigation', {
          refreshId,
          currentRefreshId: mailboxRefreshRef.current,
        });
        return;
      }
      const meta = await loadMeta(folderId, accountScope, { mode: 'mailbox' });
      if (refreshId !== mailboxRefreshRef.current) {
        flowInfo('app-flow', 'syncAndRefresh aborted by newer navigation after meta', {
          refreshId,
          currentRefreshId: mailboxRefreshRef.current,
        });
        return;
      }
      const refreshLimit = Math.max(messageLimit, loadMailboxMessageLimit(mailboxListStateKey));
      await loadMessagesWithVisibleFallback(
        meta.folderId,
        query,
        filter,
        accountScope,
        refreshId,
        meta.folders,
        refreshLimit,
      );
      if (activeThread) {
        await openThread(activeThread, false);
      }
      flowInfo('app-flow', 'syncAndRefresh done', {
        accountId: syncAccountId,
        status: run.status,
        scannedFolders: run.scanned_folders,
        importedMessages: run.imported_messages,
        resolvedFolderId: meta.folderId,
        durationMs: Math.round(performance.now() - startedAt),
      });
      setStatus(run.message);

      const count = run.imported_messages;
      setRefreshNotice(count > 0 ? `成功获取 ${count} 封` : '已是最新');
      refreshNoticeTimeoutRef.current = window.setTimeout(() => {
        setRefreshNotice(null);
      }, 4000);
    } catch (error) {
      const message = String(error);
      flowWarn('app-flow', 'syncAndRefresh failed', {
        accountId: syncAccountId,
        error: message,
        durationMs: Math.round(performance.now() - startedAt),
      });
      setStatus(message);
      setRefreshNotice('获取失败');
      refreshNoticeTimeoutRef.current = window.setTimeout(() => {
        setRefreshNotice(null);
      }, 4000);
      throw error;
    } finally {
      setIsRefreshing(false);
    }
  }, [
    isRefreshing,
    accountScope,
    folderId,
    searchScope,
    query,
    filter,
    loadMeta,
    messageLimit,
    mailboxListStateKey,
    loadMessagesWithVisibleFallback,
    activeThread,
    openThread,
    mailboxRefreshRef,
    setSyncRuns,
    setStatus,
  ]);

  // 同步进度统一由后台任务的持久轮询提供（GetBackgroundTask + BackgroundTask.progress），
  // 不再保留无生产者的 sync-progress 事件监听，避免死契约与冲突进度来源。

  return {
    isRefreshing,
    refreshNotice,
    refreshAll,
    syncAndRefresh,
  };
}
