import { useCallback, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
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

/**
 * 未读角标/托盘刷新的独立请求标记。
 *
 * 与 mailboxRefreshRef 分开维护：未读刷新是轻量的 get_stats 路径，账号切换时
 * 旧账号的慢响应不能覆盖新账号的 Dock 角标和托盘未读数。`id` 来自独立的
 * unreadRefreshSeqRef 递增计数，`scope` 记录发起时的账号 scope。
 */
export type UnreadRefreshRequest = {
  kind: 'unread';
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
  // 未读刷新的独立请求序号与当前活跃请求：账号切换竞态只认这个 token，
  // 不复用 mailboxRefreshRef（那是邮件视图刷新，语义不同）。
  const unreadRefreshSeqRef = useRef(0);
  const activeUnreadRefreshRef = useRef<UnreadRefreshRequest | null>(null);

  const isMailboxRefreshCurrent = useCallback(
    (mailboxRequest?: MailboxRefreshRequest): boolean => {
      if (!mailboxRequest) return true;
      return (
        mailboxRequest.scope === activeMailboxScopeRef.current
        && (!mailboxRefreshRef || mailboxRequest.id === mailboxRefreshRef.current)
      );
    },
    [mailboxRefreshRef],
  );

  // 未读刷新新鲜度：请求仍是最新一次发起，且 scope 仍匹配当前渲染的账号范围。
  // 账号从 A 切到 B 后，A 的慢响应在 scope 校验处被丢弃。
  const isUnreadRefreshCurrent = useCallback(
    (request?: MailboxRefreshRequest | UnreadRefreshRequest): boolean => {
      if (!request) return true;
      if ('kind' in request) {
        const active = activeUnreadRefreshRef.current;
        return Boolean(
          active && active.id === request.id && request.scope === activeMailboxScopeRef.current,
        );
      }
      return isMailboxRefreshCurrent(request);
    },
    [isMailboxRefreshCurrent],
  );

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
    // 未携带 mailboxRequest 的调用（邮件操作、部分刷新路径）也要给角标/托盘
    // 写入一个 scope 快照 token：慢 loadMeta 在账号切换后不得把旧账号的未读数
    // 覆盖到新账号。带 mailboxRequest 的路径沿用原有 freshness 校验。
    // 关键：只有当前 scope 的请求才登记为活跃 token，旧账号的 loadMeta 恢复时
    // 绝不能顶掉 B 账号正在途的焦点刷新请求。
    const unreadRequest: MailboxRefreshRequest | UnreadRefreshRequest =
      mailboxRequest ?? { kind: 'unread', id: ++unreadRefreshSeqRef.current, scope: nextScope };
    if ('kind' in unreadRequest && unreadRequest.scope === activeMailboxScopeRef.current) {
      activeUnreadRefreshRef.current = unreadRequest;
    }
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
        void updateAppUnreadBadge(nextStats.unread_messages, unreadRequest);
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
      void updateAppUnreadBadge(nextStats.unread_messages, unreadRequest);
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

  const updateAppUnreadBadge = useCallback(
    async function updateAppUnreadBadge(
      unreadCount: number,
      request?: MailboxRefreshRequest | UnreadRefreshRequest,
    ) {
      if (!isUnreadRefreshCurrent(request)) return;
      try {
        await getCurrentWindow().setBadgeCount(unreadCount > 0 ? unreadCount : undefined);
        if (!isUnreadRefreshCurrent(request)) return;
        setAppBadgeStatus(unreadCount > 0 ? `应用角标 ${unreadCount}` : '应用角标已清除');
      } catch {
        if (isUnreadRefreshCurrent(request)) {
          setAppBadgeStatus('当前平台不支持应用角标');
        }
      }

      try {
        if (!isUnreadRefreshCurrent(request)) return;
        await invoke(IPC.SetTrayUnreadCount, { unreadCount });
      } catch (error) {
        console.warn('Failed to update tray unread count:', error);
      }
    },
    [isUnreadRefreshCurrent, setAppBadgeStatus],
  );

  /**
   * 独立于 loadMeta 的角标/托盘未读同步：即使邮件加载失败，
   * 也能用一次轻量 get_stats 把 Dock 角标和托盘未读数刷新到真实状态。
   *
   * 每次发起都记录独立的 request id 与 scope。get_stats 返回后、setBadgeCount
   * 返回后、写托盘前，updateAppUnreadBadge 都会校验该请求仍是最新且 scope 仍
   * 匹配，因此账号从 A 切到 B 后，A 的慢响应不会覆盖 B 的角标/托盘。
   */
  const refreshUnreadIndicators = useCallback(
    async function refreshUnreadIndicators(scope: AccountScope = 'all') {
      const request: UnreadRefreshRequest = {
        kind: 'unread',
        id: ++unreadRefreshSeqRef.current,
        scope,
      };
      // 只有当前账号 scope 的请求才配作为“活跃未读请求”；非当前 scope 的
      // 旧调用若覆盖 token，会让真正在途的 B 请求被 id 校验误丢弃。
      if (scope === activeMailboxScopeRef.current) {
        activeUnreadRefreshRef.current = request;
      }
      try {
        const nextStats = await invoke<MailStats>(IPC.GetStats, {
          accountId: accountIdForScope(scope),
        });
        await updateAppUnreadBadge(nextStats.unread_messages, request);
      } catch (error) {
        console.warn('Failed to refresh unread indicators:', error);
      }
    },
    [updateAppUnreadBadge],
  );

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
