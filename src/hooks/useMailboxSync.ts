import {
  useCallback,
  useEffect,
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
import { invoke, listen } from '../tauriBridge';
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
    flowInfo('app-flow', 'refreshAll start', {
      folderId,
      scope: accountScope,
      searchScope,
      query: query.trim() || null,
      filter,
    });
    const meta = await loadMeta(folderId, accountScope, { mode: 'mailbox' });
    const refreshLimit = Math.max(messageLimit, loadMailboxMessageLimit(mailboxListStateKey));
    await loadMessagesWithVisibleFallback(meta.folderId, query, filter, accountScope, mailboxRefreshRef.current, meta.folders, refreshLimit);
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
    flowInfo('app-flow', 'syncAndRefresh start', {
      accountId: syncAccountId,
      folderId,
      scope: accountScope,
      searchScope,
      query: query.trim() || null,
      filter,
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
      const meta = await loadMeta(folderId, accountScope, { mode: 'mailbox' });
      const refreshLimit = Math.max(messageLimit, loadMailboxMessageLimit(mailboxListStateKey));
      await loadMessagesWithVisibleFallback(
        meta.folderId,
        query,
        filter,
        accountScope,
        mailboxRefreshRef.current,
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

  useEffect(() => {
    let unlistenProgress: (() => void) | undefined;

    let latestPayload: {
      account_email: string;
      folder_name: string;
      current_folder_index: number;
      total_folders: number;
      scanned_folders: number;
      imported_messages: number;
      status_text: string;
    } | null = null;
    let flushTimer: ReturnType<typeof window.setTimeout> | null = null;
    const flush = () => {
      flushTimer = null;
      if (!latestPayload) return;
      const payload = latestPayload;
      latestPayload = null;
      setStatus(payload.status_text);
      if (payload.folder_name) {
        setRefreshNotice(`${payload.folder_name} (${payload.current_folder_index}/${payload.total_folders})`);
      } else {
        setRefreshNotice('正在连接...');
      }
    };

    listen<{
      account_email: string;
      folder_name: string;
      current_folder_index: number;
      total_folders: number;
      scanned_folders: number;
      imported_messages: number;
      status_text: string;
    }>('sync-progress', (event) => {
      latestPayload = event.payload;
      if (flushTimer === null) {
        flushTimer = window.setTimeout(flush, 250);
      }
    })
      .then((nextUnlisten) => {
        unlistenProgress = nextUnlisten;
      })
      .catch((error) => {
        console.error('Failed to listen to sync-progress event:', error);
      });

    return () => {
      unlistenProgress?.();
      if (flushTimer !== null) {
        window.clearTimeout(flushTimer);
      }
    };
  }, [setStatus]);

  return {
    isRefreshing,
    refreshNotice,
    refreshAll,
    syncAndRefresh,
  };
}
