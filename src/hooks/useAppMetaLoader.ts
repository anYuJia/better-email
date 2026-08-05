import { useRef, type Dispatch, type SetStateAction } from 'react';
import {
  invoke,
  getCurrentWindow,
} from '../tauriBridge';
import type {
  Account,
  AccountScope,
  BackgroundTask,
  Contact,
  ContactMergeSuggestion,
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

export type LoadMetaOptions = {
  mode?: 'full' | 'mailbox';
};

export type LoadMetaResult = {
  folderId: number | null;
  folders: Folder[];
};

type UseAppMetaLoaderOptions = {
  folderId: number | null;
  accountScope: AccountScope;
  setAccounts: Dispatch<SetStateAction<Account[]>>;
  setAccount: Dispatch<SetStateAction<Account | null>>;
  setAccountForm: Dispatch<SetStateAction<Account | null>>;
  setFolders: Dispatch<SetStateAction<Folder[]>>;
  setLabels: Dispatch<SetStateAction<Label[]>>;
  setStats: Dispatch<SetStateAction<MailStats | null>>;
  setSyncRuns: Dispatch<SetStateAction<SyncRun[]>>;
  setIdentities: Dispatch<SetStateAction<MailIdentity[]>>;
  setOutbox: Dispatch<SetStateAction<OutboxItem[]>>;
  setBackgroundTasks: Dispatch<SetStateAction<BackgroundTask[]>>;
  setSyncSchedulePlan: Dispatch<SetStateAction<SyncSchedulePlan | null>>;
  setRemoteImageTrusts: Dispatch<SetStateAction<RemoteImageTrust[]>>;
  setImapMailboxes: Dispatch<SetStateAction<ImapMailboxState[]>>;
  setContacts: Dispatch<SetStateAction<Contact[]>>;
  setContactMergeSuggestions: Dispatch<SetStateAction<ContactMergeSuggestion[]>>;
  setRules: Dispatch<SetStateAction<MailRule[]>>;
  setOauthSessions: Dispatch<SetStateAction<OAuthSession[]>>;
  setFolderId: Dispatch<SetStateAction<number | null>>;
  setStatus: Dispatch<SetStateAction<string>>;
  setAppBadgeStatus: Dispatch<SetStateAction<string>>;
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
  setContactMergeSuggestions,
  setRules,
  setOauthSessions,
  setFolderId,
  setStatus,
  setAppBadgeStatus,
}: UseAppMetaLoaderOptions) {
  const benchmarkSyncRef = useRef(false);

  async function releaseDueSnoozedMessages() {
    const result = await invoke<{ released_count: number }>('release_due_snoozed_messages', { now: new Date().toISOString() });
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
    appFlowLog('loadMeta start', {
      requestedFolderId: nextFolderId,
      scope: nextScope,
      accountId: nextAccountId,
      mode,
    });
    try {
      const released = await releaseDueSnoozedMessages();
      if (released.released_count > 0) {
        setStatus(`已恢复 ${released.released_count} 封到期稍后邮件`);
      }
      if (mode === 'mailbox') {
        const [
          nextAccounts,
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
          invoke<Account[]>('list_accounts'),
          invoke<Account | null>('get_account', { accountId: nextAccountId }),
          invoke<Folder[]>('list_folders', { accountId: nextAccountId }),
          invoke<Label[]>('list_labels'),
          invoke<MailStats>('get_stats', { accountId: nextAccountId }),
          invoke<SyncRun[]>('list_sync_runs'),
          invoke<MailIdentity[]>('list_identities', { accountId: nextAccountId }),
          invoke<OutboxItem[]>('list_outbox'),
          invoke<BackgroundTask[]>('list_background_tasks'),
          invoke<SyncSchedulePlan>('get_sync_schedule_plan', { accountId: nextAccountId }),
          invoke<RemoteImageTrust[]>('list_remote_image_trusts', { accountId: nextAccountId }),
          invoke<ImapMailboxState[]>('list_imap_mailboxes'),
        ]);
        setAccounts(nextAccounts);
        setAccount(nextAccount);
        setAccountForm(nextAccount);
        setFolders(nextFolders);
        setLabels(nextLabels);
        setStats(nextStats);
        setSyncRuns(nextSyncRuns);
        setIdentities(nextIdentities);
        setOutbox(nextOutbox);
        setBackgroundTasks(nextBackgroundTasks);
        setSyncSchedulePlan(nextSyncSchedulePlan);
        setRemoteImageTrusts(nextRemoteImageTrusts);
        setImapMailboxes(nextImapMailboxes);
        void updateAppUnreadBadge(nextStats.unread_messages);
        const resolvedFolderId =
          nextFolders.length > 0 && nextFolderId && nextFolders.some((folder) => folder.id === nextFolderId)
            ? nextFolderId
            : nextFolders[0]?.id ?? null;
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
        nextAccount,
        nextFolders,
        nextLabels,
        nextStats,
        nextSyncRuns,
        nextContacts,
        nextContactMergeSuggestions,
        nextIdentities,
        nextRules,
        nextOutbox,
        nextBackgroundTasks,
        nextSyncSchedulePlan,
        nextRemoteImageTrusts,
        nextImapMailboxes,
        nextOauthSessions,
      ] = await Promise.all([
        invoke<Account[]>('list_accounts'),
        invoke<Account | null>('get_account', { accountId: nextAccountId }),
        invoke<Folder[]>('list_folders', { accountId: nextAccountId }),
        invoke<Label[]>('list_labels'),
        invoke<MailStats>('get_stats', { accountId: nextAccountId }),
        invoke<SyncRun[]>('list_sync_runs'),
        invoke<Contact[]>('list_contacts'),
        invoke<ContactMergeSuggestion[]>('list_contact_merge_suggestions'),
        invoke<MailIdentity[]>('list_identities', { accountId: nextAccountId }),
        invoke<MailRule[]>('list_rules'),
        invoke<OutboxItem[]>('list_outbox'),
        invoke<BackgroundTask[]>('list_background_tasks'),
        invoke<SyncSchedulePlan>('get_sync_schedule_plan', { accountId: nextAccountId }),
        invoke<RemoteImageTrust[]>('list_remote_image_trusts', { accountId: nextAccountId }),
        invoke<ImapMailboxState[]>('list_imap_mailboxes'),
        invoke<OAuthSession[]>('list_oauth_sessions'),
      ]);
      setAccounts(nextAccounts);
      setAccount(nextAccount);
      setAccountForm(nextAccount);
      setFolders(nextFolders);
      setLabels(nextLabels);
      setStats(nextStats);
      setSyncRuns(nextSyncRuns);
      setContacts(nextContacts);
      setContactMergeSuggestions(nextContactMergeSuggestions);
      setIdentities(nextIdentities);
      setRules(nextRules);
      setOutbox(nextOutbox);
      setBackgroundTasks(nextBackgroundTasks);
      setSyncSchedulePlan(nextSyncSchedulePlan);
      setRemoteImageTrusts(nextRemoteImageTrusts);
      setImapMailboxes(nextImapMailboxes);
      setOauthSessions(nextOauthSessions);
      void updateAppUnreadBadge(nextStats.unread_messages);
      const resolvedFolderId =
        nextFolders.length > 0 && nextFolderId && nextFolders.some((folder) => folder.id === nextFolderId)
          ? nextFolderId
          : nextFolders[0]?.id ?? null;
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

  async function updateAppUnreadBadge(unreadCount: number) {
    try {
      await getCurrentWindow().setBadgeCount(unreadCount > 0 ? unreadCount : undefined);
      setAppBadgeStatus(unreadCount > 0 ? `应用角标 ${unreadCount}` : '应用角标已清除');
    } catch {
      setAppBadgeStatus('当前平台不支持应用角标');
    }

    try {
      await invoke('set_tray_unread_count', { unreadCount });
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
      const nextStats = await invoke<MailStats>('get_stats', {
        accountId: accountIdForScope(scope),
      });
      await updateAppUnreadBadge(nextStats.unread_messages);
    } catch (error) {
      console.warn('Failed to refresh unread indicators:', error);
    }
  }

  async function maybeRunBenchmarkSync(runSyncDryRun: () => Promise<SyncRun>) {
    if (benchmarkSyncRef.current) return;
    const requested = await invoke<boolean>('benchmark_sync_requested');
    if (!requested) return;
    benchmarkSyncRef.current = true;
    try {
      const run = await runSyncDryRun();
      await invoke('mark_benchmark_sync_complete', {
        message: `${run.status};folders=${run.scanned_folders};imported=${run.imported_messages}`,
      });
    } catch (error) {
      await invoke('mark_benchmark_sync_complete', {
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
