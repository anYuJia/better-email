import { useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import {
  invoke,
  getCurrentWindow,
} from '../tauriBridge';
import type {
  Account,
  AccountScope,
  BackgroundTask,
  Contact,
  Folder,
  ImapMailboxState,
  Label,
  MailIdentity,
  MailRule,
  MailStats,
  OAuthSession,
  OutboxItem,
  RemoteImageTrust,
  SyncRun,
  SyncSchedulePlan,
} from '../app/types';
import { flowInfo, flowWarn } from '../app/logger';
import { IPC } from '../ipc/commands';

/**
 * A mailbox view generation captured before an asynchronous refresh starts.
 *
 * `id` comes from the app-wide mailboxRefreshRef.  Keeping the scope beside it
 * matters because a new account view may be rendered before an older request
 * resolves; the old request must then be allowed to finish without committing
 * its result into the new view.
 */
export type MailboxRefreshRequest = {
  id: number;
  scope: AccountScope;
};

export type LoadMetaOptions = {
  mode?: 'full' | 'mailbox';
  /** Only commit mailbox state while this request still matches the active view. */
  mailboxRequest?: MailboxRefreshRequest;
};

export type LoadMetaResult = {
  folderId: number | null;
  folders: Folder[];
};

type UseAppMetaLoaderOptions = {
  folderId: number | null;
  accountScope: AccountScope;
  mailboxRefreshRef?: MutableRefObject<number>;
  setAccounts: Dispatch<SetStateAction<Account[]>>;
  setAccount: Dispatch<SetStateAction<Account | null>>;
  setAccountForm: Dispatch<SetStateAction<Account | null>>;
  setFolders: Dispatch<SetStateAction<Folder[]>>;
  setLabels: Dispatch<SetStateAction<Label[]>>;
  setStats: Dispatch<SetStateAction<MailStats | null>>;
  setSyncRuns?: Dispatch<SetStateAction<SyncRun[]>>;
  setIdentities: Dispatch<SetStateAction<MailIdentity[]>>;
  setOutbox: Dispatch<SetStateAction<OutboxItem[]>>;
  setBackgroundTasks: Dispatch<SetStateAction<BackgroundTask[]>>;
  setSyncSchedulePlan: Dispatch<SetStateAction<SyncSchedulePlan | null>>;
  setRemoteImageTrusts: Dispatch<SetStateAction<RemoteImageTrust[]>>;
  setImapMailboxes: Dispatch<SetStateAction<ImapMailboxState[]>>;
  setContacts: Dispatch<SetStateAction<Contact[]>>;
  setRules: Dispatch<SetStateAction<MailRule[]>>;
  setOauthSessions: Dispatch<SetStateAction<OAuthSession[]>>;
  setFolderId: Dispatch<SetStateAction<number | null>>;
  setStatus: Dispatch<SetStateAction<string>>;
  setAppBadgeStatus: Dispatch<SetStateAction<string>>;
  onAccountListLoaded?: () => void;
};

function appFlowLog(event: string, details: Record<string, unknown> = {}) {
  flowInfo('app-flow', event, details);
}

function appFlowWarn(event: string, details: Record<string, unknown> = {}) {
  flowWarn('app-flow', event, details);
}

function accountIdForScope(scope: AccountScope): number | null {
  return scope === 'all' ? null : scope;
}

export default function useAppMetaLoader({
  folderId,
  accountScope,
  mailboxRefreshRef,
  setAccounts,
  setAccount,
  setAccountForm,
  setFolders,
  setLabels,
  setStats,
  setSyncRuns,
  setIdentities,
  setOutbox,
  setBackgroundTasks,
  setSyncSchedulePlan,
  setRemoteImageTrusts,
  setImapMailboxes,
  setContacts,
  setRules,
  setOauthSessions,
  setFolderId,
  setStatus,
  setAppBadgeStatus,
  onAccountListLoaded,
}: UseAppMetaLoaderOptions) {
  const benchmarkSyncRef = useRef(false);
  // State setters below intentionally run only after all metadata queries
  // settle.  This ref lets those delayed commits compare themselves with the
  // newest rendered mailbox scope rather than the closure that started them.
  const activeMailboxScopeRef = useRef<AccountScope>(accountScope);
  activeMailboxScopeRef.current = accountScope;

  function isMailboxRefreshCurrent(mailboxRequest?: MailboxRefreshRequest): boolean {
    if (!mailboxRequest) return true;
    return (
      mailboxRequest.scope === activeMailboxScopeRef.current
      && (!mailboxRefreshRef || mailboxRequest.id === mailboxRefreshRef.current)
    );
  }

  async function releaseDueSnoozedMessages() {
    const result = await invoke<{ released_count: number }>(IPC.ReleaseDueSnoozedMessages, { now: new Date().toISOString() });
    return result;
  }

  async function loadMeta(
    nextFolderId: number | null = folderId,
    nextScope: AccountScope = accountScope,
    options: LoadMetaOptions = {},
  ): Promise<LoadMetaResult> {
    const startedAt = performance.now();
    const nextAccountId = accountIdForScope(nextScope);
    const mode = options.mode ?? 'full';
    const mailboxRequest = options.mailboxRequest;
    const shouldCommitMailboxResult = () => (
      !mailboxRequest
      || (
        mailboxRequest.scope === nextScope
        && isMailboxRefreshCurrent(mailboxRequest)
      )
    );
    appFlowLog('loadMeta start', {
      requestedFolderId: nextFolderId,
      scope: nextScope,
      accountId: nextAccountId,
      mode,
      mailboxRefreshId: mailboxRequest?.id ?? null,
    });
    try {
      const nextAccountsPromise = invoke<Account[]>(IPC.ListAccounts).then((nextAccounts) => {
        setAccounts(nextAccounts);
        onAccountListLoaded?.();
        return nextAccounts;
      });
      const releasedPromise = releaseDueSnoozedMessages();
      if (mode === 'mailbox') {
        const [
          nextAccounts,
          released,
          nextAccount,
          nextFolders,
          nextLabels,
          nextStats,
          nextSyncRuns,
          nextIdentities,
          nextOutbox,
          nextBackgroundTasks,
          nextSyncSchedulePlan,
          nextRemoteImageTrusts,
          nextImapMailboxes,
        ] = await Promise.all([
          nextAccountsPromise,
          releasedPromise,
          invoke<Account | null>(IPC.GetAccount, { accountId: nextAccountId }),
          invoke<Folder[]>(IPC.ListFolders, { accountId: nextAccountId }),
          invoke<Label[]>(IPC.ListLabels),
          invoke<MailStats>(IPC.GetStats, { accountId: nextAccountId }),
          invoke<SyncRun[]>(IPC.ListSyncRuns),
          invoke<MailIdentity[]>(IPC.ListIdentities, { accountId: nextAccountId }),
          invoke<OutboxItem[]>(IPC.ListOutbox),
          invoke<BackgroundTask[]>(IPC.ListBackgroundTasks),
          invoke<SyncSchedulePlan>(IPC.GetSyncSchedulePlan, { accountId: nextAccountId }),
          invoke<RemoteImageTrust[]>(IPC.ListRemoteImageTrusts, { accountId: nextAccountId }),
          invoke<ImapMailboxState[]>(IPC.ListImapMailboxes),
        ]);
        const resolvedFolderId =
          nextFolders.length > 0 && nextFolderId && nextFolders.some((folder) => folder.id === nextFolderId)
            ? nextFolderId
            : nextFolders[0]?.id ?? null;
        if (!shouldCommitMailboxResult()) {
          appFlowLog('loadMeta ignored stale mailbox result', {
            requestedFolderId: nextFolderId,
            requestedScope: nextScope,
            currentScope: activeMailboxScopeRef.current,
            mailboxRefreshId: mailboxRequest?.id ?? null,
            currentMailboxRefreshId: mailboxRefreshRef?.current ?? null,
            mode,
          });
          return { folderId: resolvedFolderId, folders: nextFolders };
        }
        if (released.released_count > 0) {
          setStatus(`已恢复 ${released.released_count} 封到期稍后邮件`);
        }
        setAccount(nextAccount);
        setAccountForm(nextAccount);
        setFolders(nextFolders);
        setLabels(nextLabels);
        setStats(nextStats);
        setSyncRuns?.(nextSyncRuns);
        setIdentities(nextIdentities);
        setOutbox(nextOutbox);
        setBackgroundTasks(nextBackgroundTasks);
        setSyncSchedulePlan(nextSyncSchedulePlan);
        setRemoteImageTrusts(nextRemoteImageTrusts);
        setImapMailboxes(nextImapMailboxes);
        void updateAppUnreadBadge(nextStats.unread_messages, mailboxRequest);
        setFolderId(resolvedFolderId);
        appFlowLog('loadMeta done', {
          accountCount: nextAccounts.length,
          activeAccountId: nextAccount?.id ?? null,
          folderCount: nextFolders.length,
          requestedFolderId: nextFolderId,
          resolvedFolderId,
          mode,
          durationMs: Math.round(performance.now() - startedAt),
        });
        return { folderId: resolvedFolderId, folders: nextFolders };
      }
      const [
        nextAccounts,
        released,
        nextAccount,
        nextFolders,
        nextLabels,
        nextStats,
        nextSyncRuns,
        nextContacts,
        nextIdentities,
        nextRules,
        nextOutbox,
        nextBackgroundTasks,
        nextSyncSchedulePlan,
        nextRemoteImageTrusts,
        nextImapMailboxes,
        nextOauthSessions,
      ] = await Promise.all([
        nextAccountsPromise,
        releasedPromise,
        invoke<Account | null>(IPC.GetAccount, { accountId: nextAccountId }),
        invoke<Folder[]>(IPC.ListFolders, { accountId: nextAccountId }),
        invoke<Label[]>(IPC.ListLabels),
        invoke<MailStats>(IPC.GetStats, { accountId: nextAccountId }),
        invoke<SyncRun[]>(IPC.ListSyncRuns),
        invoke<Contact[]>(IPC.ListContacts),
        invoke<MailIdentity[]>(IPC.ListIdentities, { accountId: nextAccountId }),
        invoke<MailRule[]>(IPC.ListRules),
        invoke<OutboxItem[]>(IPC.ListOutbox),
        invoke<BackgroundTask[]>(IPC.ListBackgroundTasks),
        invoke<SyncSchedulePlan>(IPC.GetSyncSchedulePlan, { accountId: nextAccountId }),
        invoke<RemoteImageTrust[]>(IPC.ListRemoteImageTrusts, { accountId: nextAccountId }),
        invoke<ImapMailboxState[]>(IPC.ListImapMailboxes),
        invoke<OAuthSession[]>(IPC.ListOauthSessions),
      ]);
      const resolvedFolderId =
        nextFolders.length > 0 && nextFolderId && nextFolders.some((folder) => folder.id === nextFolderId)
          ? nextFolderId
          : nextFolders[0]?.id ?? null;
      if (!shouldCommitMailboxResult()) {
        appFlowLog('loadMeta ignored stale mailbox result', {
          requestedFolderId: nextFolderId,
          requestedScope: nextScope,
          currentScope: activeMailboxScopeRef.current,
          mailboxRefreshId: mailboxRequest?.id ?? null,
          currentMailboxRefreshId: mailboxRefreshRef?.current ?? null,
          mode,
        });
        return { folderId: resolvedFolderId, folders: nextFolders };
      }
      if (released.released_count > 0) {
        setStatus(`已恢复 ${released.released_count} 封到期稍后邮件`);
      }
      setAccount(nextAccount);
      setAccountForm(nextAccount);
      setFolders(nextFolders);
      setLabels(nextLabels);
      setStats(nextStats);
      setSyncRuns?.(nextSyncRuns);
      setContacts(nextContacts);
      setIdentities(nextIdentities);
      setRules(nextRules);
      setOutbox(nextOutbox);
      setBackgroundTasks(nextBackgroundTasks);
      setSyncSchedulePlan(nextSyncSchedulePlan);
      setRemoteImageTrusts(nextRemoteImageTrusts);
      setImapMailboxes(nextImapMailboxes);
      setOauthSessions(nextOauthSessions);
      void updateAppUnreadBadge(nextStats.unread_messages, mailboxRequest);
      setFolderId(resolvedFolderId);
      appFlowLog('loadMeta done', {
        accountCount: nextAccounts.length,
        activeAccountId: nextAccount?.id ?? null,
        folderCount: nextFolders.length,
        requestedFolderId: nextFolderId,
        resolvedFolderId,
        mode,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return { folderId: resolvedFolderId, folders: nextFolders };
    } catch (error) {
      appFlowWarn('loadMeta failed', {
        requestedFolderId: nextFolderId,
        scope: nextScope,
        accountId: nextAccountId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async function updateAppUnreadBadge(
    unreadCount: number,
    mailboxRequest?: MailboxRefreshRequest,
  ) {
    if (!isMailboxRefreshCurrent(mailboxRequest)) return;
    try {
      await getCurrentWindow().setBadgeCount(unreadCount > 0 ? unreadCount : undefined);
      if (!isMailboxRefreshCurrent(mailboxRequest)) return;
      setAppBadgeStatus(unreadCount > 0 ? `应用角标 ${unreadCount}` : '应用角标已清除');
    } catch {
      if (isMailboxRefreshCurrent(mailboxRequest)) {
        setAppBadgeStatus('当前平台不支持应用角标');
      }
    }

    try {
      if (!isMailboxRefreshCurrent(mailboxRequest)) return;
      await invoke(IPC.SetTrayUnreadCount, { unreadCount });
    } catch (error) {
      console.warn('Failed to update tray unread count:', error);
    }
  }

  /**
   * 独立于 loadMeta 的角标/托盘未读同步：即使邮件加载失败，
   * 也能用一次轻量 get_stats 把 Dock 角标和托盘未读数刷新到真实状态。
   */
  async function refreshUnreadIndicators(scope: AccountScope = 'all') {
    try {
      const nextStats = await invoke<MailStats>(IPC.GetStats, {
        accountId: accountIdForScope(scope),
      });
      await updateAppUnreadBadge(nextStats.unread_messages);
    } catch (error) {
      console.warn('Failed to refresh unread indicators:', error);
    }
  }

  async function maybeRunBenchmarkSync(runSyncDryRun: () => Promise<SyncRun>) {
    if (benchmarkSyncRef.current) return;
    const requested = await invoke<boolean>(IPC.BenchmarkSyncRequested);
    if (!requested) return;
    benchmarkSyncRef.current = true;
    try {
      const run = await runSyncDryRun();
      await invoke(IPC.MarkBenchmarkSyncComplete, {
        message: `${run.status};folders=${run.scanned_folders};imported=${run.imported_messages}`,
      });
    } catch (error) {
      await invoke(IPC.MarkBenchmarkSyncComplete, {
        message: `failed:${String(error)}`,
      });
    }
  }

  return {
    loadMeta,
    releaseDueSnoozedMessages,
    updateAppUnreadBadge,
    refreshUnreadIndicators,
    maybeRunBenchmarkSync,
  };
}
