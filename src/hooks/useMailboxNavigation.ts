import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { messagePageSize } from '../app/appConfig';
import type {
  Account,
  AccountScope,
  Attachment,
  FilterMode,
  Folder,
  FolderRole,
  ListMode,
  MessageSummary,
  ThreadSummary,
} from '../app/types';
import type { SettingsSectionId } from '../components/settings/SettingsFrame';
import { flowInfo, flowWarn } from '../app/logger';
import { invoke } from '../tauriBridge';
import type { MailboxDataController } from './useMailboxData';
import { IPC } from '../ipc/commands';

type UseMailboxNavigationOptions = {
  account: Account | null;
  accounts: Account[];
  accountForm: Account | null;
  accountScope: AccountScope;
  folderId: number | null;
  folders: Folder[];
  activeValidationId: string;
  providerWriteValidationStatus: { sentMessageId: number | null; receivedMessageId: number | null } | null;
  mailboxRefreshRef: MutableRefObject<number>;
  skipNextFolderEffectLoadRef: MutableRefObject<boolean>;
  /** 导航动作认领的账号 scope；accountScope effect 读到匹配值时跳过 refreshMailbox。 */
  navigationScopeClaimRef: MutableRefObject<AccountScope | null>;
  resetSearch: () => void;
  loadMeta: (
    nextFolderId?: number | null,
    nextScope?: AccountScope,
    options?: {
      mode?: 'mailbox' | 'full';
      mailboxRequest?: { id: number; scope: AccountScope };
    },
  ) => Promise<{ folderId: number | null; folders: Folder[] }>;
  loadMessages: MailboxDataController['loadMessages'];
  loadMessagesWithVisibleFallback: MailboxDataController['loadMessagesWithVisibleFallback'];
  setActiveSettingsSection: Dispatch<SetStateAction<SettingsSectionId>>;
  setActiveThread: Dispatch<SetStateAction<ThreadSummary | null>>;
  setAccountScope: Dispatch<SetStateAction<AccountScope>>;
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  setFilter: Dispatch<SetStateAction<FilterMode>>;
  setFolderId: Dispatch<SetStateAction<number | null>>;
  setListMode: Dispatch<SetStateAction<ListMode>>;
  setMessages: Dispatch<SetStateAction<MessageSummary[]>>;
  setQuery: Dispatch<SetStateAction<string>>;
  setSelectedId: Dispatch<SetStateAction<number | null>>;
  setSelectedMessageIds: Dispatch<SetStateAction<number[]>>;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  setStatus: Dispatch<SetStateAction<string>>;
  setThreadMessages: Dispatch<SetStateAction<MessageSummary[]>>;
};

function appFlowLog(event: string, details: Record<string, unknown> = {}) {
  flowInfo('app-flow', event, details);
}

function appFlowWarn(event: string, details: Record<string, unknown> = {}) {
  flowWarn('app-flow', event, details);
}

export default function useMailboxNavigation({
  account,
  accounts,
  accountForm,
  accountScope,
  folderId,
  folders,
  activeValidationId,
  providerWriteValidationStatus,
  mailboxRefreshRef,
  skipNextFolderEffectLoadRef,
  navigationScopeClaimRef,
  resetSearch,
  loadMeta,
  loadMessages,
  loadMessagesWithVisibleFallback,
  setActiveSettingsSection,
  setActiveThread,
  setAccountScope,
  setAttachments,
  setFilter,
  setFolderId,
  setListMode,
  setMessages,
  setQuery,
  setSelectedId,
  setSelectedMessageIds,
  setSettingsOpen,
  setStatus,
  setThreadMessages,
}: UseMailboxNavigationOptions) {
  const accountIdForScope = useCallback((scope: AccountScope): number | null => {
    return scope === 'all' ? null : scope;
  }, []);

  const scrollSettingsSection = useCallback((section: SettingsSectionId) => {
    setActiveSettingsSection(section);
    window.requestAnimationFrame(() => {
      document.querySelector(`[data-settings-page="${section}"]`)?.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    });
  }, [setActiveSettingsSection]);

  const openSettingsHome = useCallback(() => {
    setActiveSettingsSection('accounts');
    setSettingsOpen(true);
    loadMeta(folderId, accountScope, { mode: 'full' }).catch((error) => setStatus(String(error)));
  }, [folderId, accountScope, loadMeta, setActiveSettingsSection, setSettingsOpen, setStatus]);

  const locateProviderWriteValidation = useCallback(async (role: 'sent' | 'inbox') => {
    if (!accountForm || !activeValidationId) return;
    const targetAccountId = accountForm.id;
    const scopeChanging = accountScope !== targetAccountId;
    if (scopeChanging) {
      // 认领该 scope：accountScope effect 跳过 refreshMailbox，由本导航驱动加载。
      navigationScopeClaimRef.current = targetAccountId;
    }
    setAccountScope(targetAccountId);
    setQuery(activeValidationId);
    setFilter('all');
    setListMode('messages');
    setActiveThread(null);
    setThreadMessages([]);
    setSettingsOpen(false);
    // 自行递增 mailbox 世代：使在途旧刷新失效；用户进一步导航则放弃提交。
    mailboxRefreshRef.current += 1;
    const startedRefreshId = mailboxRefreshRef.current;
    try {
      const meta = await loadMeta(null, targetAccountId, {
        mode: 'mailbox',
        mailboxRequest: { id: startedRefreshId, scope: targetAccountId },
      });
      if (mailboxRefreshRef.current !== startedRefreshId) {
        appFlowLog('locate provider validation aborted by newer navigation', {
          refreshId: startedRefreshId,
          currentRefreshId: mailboxRefreshRef.current,
        });
        return;
      }
      const targetFolder =
        meta.folders.find((folder) => folder.account_id === targetAccountId && folder.role === role) ??
        meta.folders.find((folder) => folder.role === role);
      if (!targetFolder) {
        setStatus(`当前账号没有可用的${role === 'sent' ? '已发送' : '收件箱'}目录`);
        return;
      }
      skipNextFolderEffectLoadRef.current = true;
      setFolderId(targetFolder.id);
      const nextMessages = await loadMessages(
        targetFolder.id,
        activeValidationId,
        'all',
        targetAccountId,
        startedRefreshId,
        messagePageSize,
        undefined,
        false,
      );
      const preferredMessageId = role === 'sent'
        ? providerWriteValidationStatus?.sentMessageId
        : providerWriteValidationStatus?.receivedMessageId;
      if (preferredMessageId && nextMessages.some((message) => message.id === preferredMessageId)) {
        setSelectedId(preferredMessageId);
      }
      setStatus(
        nextMessages.length
          ? `已定位验证 ${activeValidationId} 的${role === 'sent' ? '已发送' : '收件'}邮件`
          : `已打开${role === 'sent' ? '已发送' : '收件箱'}，暂未找到验证 ${activeValidationId}`,
      );
    } finally {
      if (scopeChanging) {
        navigationScopeClaimRef.current = null;
      }
    }
  }, [
    accountForm,
    activeValidationId,
    loadMessages,
    loadMeta,
    providerWriteValidationStatus,
    navigationScopeClaimRef,
    setAccountScope,
    setActiveThread,
    setFilter,
    setFolderId,
    setListMode,
    setQuery,
    setSelectedId,
    setSettingsOpen,
    setStatus,
    setThreadMessages,
    skipNextFolderEffectLoadRef,
    mailboxRefreshRef,
  ]);

  const focusMailboxRole = useCallback(async (role: FolderRole, targetAccountId: number | null, statusMessage: string) => {
    const startedAt = performance.now();
    const nextScope = accountScope === 'all' ? 'all' : targetAccountId ?? accountScope;
    const scopeChanging = nextScope !== accountScope && nextScope !== 'all';
    appFlowLog('focus mailbox role start', {
      role,
      accountId: targetAccountId,
      scope: nextScope,
    });
    if (scopeChanging) {
      // 认领该 scope：accountScope effect 将跳过 refreshMailbox，由本导航
      // 动作自己驱动加载，避免双重驱动互相覆盖 folderId/messages。
      navigationScopeClaimRef.current = nextScope;
    }
    if (targetAccountId && accountScope !== 'all') {
      setAccountScope(targetAccountId);
    }
    resetSearch();
    // 自行递增 mailbox 世代：使任何在途旧刷新失效。用户在此期间的进一步
    // 导航（selectFolder/changeAccountScope）会再次递增，本流程随即放弃提交。
    mailboxRefreshRef.current += 1;
    const startedRefreshId = mailboxRefreshRef.current;
    try {
      const meta = await loadMeta(null, nextScope, {
        mode: 'mailbox',
        mailboxRequest: { id: startedRefreshId, scope: nextScope },
      });
      if (mailboxRefreshRef.current !== startedRefreshId) {
        appFlowLog('focus mailbox role aborted by newer navigation', {
          role,
          accountId: targetAccountId,
          startedRefreshId,
          currentRefreshId: mailboxRefreshRef.current,
        });
        return;
      }
      const shouldMatchTargetAccount = nextScope !== 'all' && Boolean(targetAccountId);
      const targetFolder =
        meta.folders.find((folder) => (
          folder.role === role
          && (!shouldMatchTargetAccount || folder.account_id === targetAccountId)
        )) ??
        meta.folders.find((folder) => folder.role === role);
      if (!targetFolder) {
        appFlowWarn('focus mailbox role missing folder', {
          role,
          accountId: targetAccountId,
          folderCount: meta.folders.length,
        });
        await loadMessagesWithVisibleFallback(meta.folderId, '', 'all', nextScope, startedRefreshId, meta.folders, messagePageSize, 'folder', false);
        setStatus(statusMessage);
        return;
      }
      skipNextFolderEffectLoadRef.current = true;
      setFolderId(targetFolder.id);
      await loadMessagesWithVisibleFallback(
        targetFolder.id,
        '',
        'all',
        nextScope,
        startedRefreshId,
        meta.folders,
        messagePageSize,
        'folder',
        false,
      );
      appFlowLog('focus mailbox role done', {
        role,
        accountId: targetAccountId,
        folderId: targetFolder.id,
        durationMs: Math.round(performance.now() - startedAt),
      });
      setStatus(statusMessage);
    } finally {
      if (scopeChanging) {
        navigationScopeClaimRef.current = null;
      }
    }
  }, [
    accountScope,
    loadMessagesWithVisibleFallback,
    loadMeta,
    mailboxRefreshRef,
    navigationScopeClaimRef,
    resetSearch,
    setAccountScope,
    setFolderId,
    setStatus,
    skipNextFolderEffectLoadRef,
  ]);

  const currentFolderAccountId = useCallback((): number | null => {
    if (accountScope !== 'all') return accountScope;
    return account?.id ?? accounts[0]?.id ?? null;
  }, [accountScope, account, accounts]);

  const visibleFolderIdForRole = useCallback((role: FolderRole, accountId?: number | null): number | null => {
    return (
      folders.find((folder) => folder.role === role && (folder.is_virtual || !accountId || folder.account_id === accountId))?.id ??
      null
    );
  }, [folders]);

  const openThread = useCallback(async (thread: ThreadSummary, announce = true) => {
    const nextMessages = await invoke<MessageSummary[]>(IPC.ListThreadMessages, {
      accountId: accountIdForScope(accountScope),
      threadKey: thread.thread_key,
      limit: 80,
    });
    setActiveThread(thread);
    setThreadMessages(nextMessages);
    setSelectedId(nextMessages[nextMessages.length - 1]?.id ?? null);
    setSelectedMessageIds([]);
    if (announce) {
      setStatus(`已打开会话：${thread.subject} · ${nextMessages.length} 封`);
    }
    return nextMessages;
  }, [accountScope, accountIdForScope, setActiveThread, setSelectedId, setSelectedMessageIds, setStatus, setThreadMessages]);

  const changeAccountScope = useCallback((value: string) => {
    mailboxRefreshRef.current += 1;
    const nextScope = value === 'all' ? 'all' : Number(value);
    setAccountScope(nextScope);
    resetSearch();
    setFolderId(null);
    setMessages([]);
    setSelectedId(null);
    setSelectedMessageIds([]);
    setActiveThread(null);
    setThreadMessages([]);
    setAttachments([]);
    setStatus(nextScope === 'all' ? '正在切换到统一邮箱视图...' : '正在切换到单账号视图...');
  }, [
    mailboxRefreshRef,
    resetSearch,
    setAccountScope,
    setActiveThread,
    setAttachments,
    setFolderId,
    setMessages,
    setSelectedId,
    setSelectedMessageIds,
    setStatus,
    setThreadMessages,
  ]);

  const selectFolder = useCallback((nextFolderId: number) => {
    mailboxRefreshRef.current += 1;
    skipNextFolderEffectLoadRef.current = false;
    resetSearch();
    setFolderId(nextFolderId);
  }, [mailboxRefreshRef, resetSearch, setFolderId, skipNextFolderEffectLoadRef]);

  return {
    accountIdForScope,
    scrollSettingsSection,
    openSettingsHome,
    locateProviderWriteValidation,
    focusMailboxRole,
    currentFolderAccountId,
    visibleFolderIdForRole,
    openThread,
    changeAccountScope,
    selectFolder,
  };
}
