import React, {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Mail, X } from 'lucide-react';
import './styles.css';
import Sidebar from './components/Sidebar';
import MessageListPane, { type MessageContextAction, type BulkMessageAction } from './components/MessageListPane';
import ReaderPane from './components/ReaderPane';
import GlobalTooltip from './components/GlobalTooltip';
import ConfirmDialog from './components/ConfirmDialog';
import type { SettingsSectionId } from './components/settings/SettingsFrame';
import UndoSnackbarStack, { type PendingSendUndo } from './components/UndoSnackbarStack';
import useAppLayout from './hooks/useAppLayout';
import useAppShortcuts from './hooks/useAppShortcuts';
import useAccountConnectionController from './hooks/useAccountConnectionController';
import useBackgroundTaskCoordinator from './hooks/useBackgroundTaskCoordinator';
import useContactManagement from './hooks/useContactManagement';
import useMailboxData from './hooks/useMailboxData';
import useMessageCollectionActions from './hooks/useMessageCollectionActions';
import useOAuthFlow from './hooks/useOAuthFlow';
import useProviderWriteValidation from './hooks/useProviderWriteValidation';
import useUndoQueue from './hooks/useUndoQueue';
import useReaderActions from './hooks/useReaderActions';
import useAppMetaLoader from './hooks/useAppMetaLoader';
import useComposerController from './hooks/useComposerController';
import useCredentialManagement from './hooks/useCredentialManagement';
import useFolderManagement from './hooks/useFolderManagement';
import useIdentityManagement from './hooks/useIdentityManagement';
import useLabelManagement from './hooks/useLabelManagement';
import useMailboxSelectionController from './hooks/useMailboxSelectionController';
import useMailboxSearchController, { type MailboxSearchLoaders } from './hooks/useMailboxSearchController';
import useRuleManagement from './hooks/useRuleManagement';
import useSnoozeController from './hooks/useSnoozeController';
import useStorageManagement from './hooks/useStorageManagement';
import useTrashController from './hooks/useTrashController';
import {
  type NotificationPolicy,
} from './mailUtils';
import { invoke, listen } from './tauriBridge';

import type {
  FolderRole,
  FilterMode,
  ListMode,
  ListSort,
  AccountScope,
  Account,
  AccountCreateInput,
  Folder,
  Label,
  SavedSearch,
  SearchScope,
  Attachment,
  Message,
  MessageSummary,
  UndoMessageSnapshot,
  RemoteImageTrust,
  MailIdentity,
  MailStats,
  ConnectionReport,
  CredentialVerificationReport,
  ImapProbeReport,
  ImapMailboxState,
  SyncRun,
  SyncSchedulePlan,
  ParsedMessagePreview,
  Contact,
  ContactMergeSuggestion,
  MailRule,
  ThreadSummary,
  OutboxItem,
  CredentialStatus,
  OAuthSession,
  ProviderVerificationRecord,
  BackgroundTask,
} from './app/types';
import {
  emptyDraft,
  notificationPolicyStorageKey,
  providerVerificationStorageKey,
  sendUndoDelayStorageKey,
  loadNotificationPolicy,
  loadSendUndoDelaySeconds,
  loadProviderVerifications,
  isDraftEmpty,
  sampleRawMessage,
  messagePageSize,
  emptyAccountCreateForm,
} from './app/appConfig';
import type {
  SendUndoDelaySeconds,
} from './app/appConfig';
import { flowInfo, flowWarn } from './app/logger';
import { buildMailboxContextKey } from './app/mailboxContext';
import './ui-2026.css';

const ComposerWindow = lazy(() => import('./components/ComposerWindow'));
const SnoozePicker = lazy(() => import('./components/SnoozePicker'));
const SettingsFrame = lazy(() => import('./components/settings/SettingsFrame'));
const ExperienceSettings = lazy(() => import('./components/settings/ExperienceSettings'));
const AccountConnectionSettings = lazy(() => import('./components/settings/AccountConnectionSettings'));
const CredentialSecuritySettings = lazy(() => import('./components/settings/CredentialSecuritySettings'));
const DataSafetySettings = lazy(() => import('./components/settings/DataSafetySettings'));
const SyncOperationsSettings = lazy(() => import('./components/settings/SyncOperationsSettings'));
const ContactAutomationSettings = lazy(() => import('./components/settings/ContactAutomationSettings'));
import DeferredSurface from './components/DeferredSurface';
const RuleAutomationSettings = lazy(() => import('./components/settings/RuleAutomationSettings'));
const SecurityPreviewSettings = lazy(() => import('./components/settings/SecurityPreviewSettings'));
const ShortcutHelpModal = lazy(() => import('./components/ShortcutHelpModal'));

function appFlowLog(event: string, details: Record<string, unknown> = {}) {
  flowInfo('app-flow', event, details);
}

function appFlowWarn(event: string, details: Record<string, unknown> = {}) {
  flowWarn('app-flow', event, details);
}

import {
  buildMailboxListStateKey,
  loadMailboxListStates,
  loadMailboxMessageLimit,
  saveMailboxListState,
} from './app/mailboxListState';

export default function App() {
  const [account, setAccount] = useState<Account | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountScope, setAccountScope] = useState<AccountScope>('all');
  const [accountForm, setAccountForm] = useState<Account | null>(null);
  const [newAccountForm, setNewAccountForm] = useState<AccountCreateInput>(emptyAccountCreateForm);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [stats, setStats] = useState<MailStats | null>(null);
  const [connectionReport, setConnectionReport] = useState<ConnectionReport | null>(null);
  const [credentialVerification, setCredentialVerification] = useState<CredentialVerificationReport | null>(null);
  const [syncRuns, setSyncRuns] = useState<SyncRun[]>([]);
  const [identities, setIdentities] = useState<MailIdentity[]>([]);
  const [rules, setRules] = useState<MailRule[]>([]);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [diagnosticExport, setDiagnosticExport] = useState<string | null>(null);
  const [credentialStatus, setCredentialStatus] = useState<CredentialStatus | null>(null);
  const [providerVerifications, setProviderVerifications] = useState<Record<string, ProviderVerificationRecord>>(loadProviderVerifications);
  const [rawMessage, setRawMessage] = useState(sampleRawMessage);
  const [parsedPreview, setParsedPreview] = useState<ParsedMessagePreview | null>(null);
  const [imapProbe, setImapProbe] = useState<ImapProbeReport | null>(null);
  const [imapMailboxes, setImapMailboxes] = useState<ImapMailboxState[]>([]);
  const [folderId, setFolderId] = useState<number | null>(null);
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [selectedMessageIds, setSelectedMessageIds] = useState<number[]>([]);
  const skipNextFolderEffectLoadRef = useRef(false);
  const [activeThread, setActiveThread] = useState<ThreadSummary | null>(null);
  const [threadMessages, setThreadMessages] = useState<MessageSummary[]>([]);
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const [isShortcutsOpen, setShortcutsOpen] = useState(false);
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSectionId>('accounts');
  const [status, setStatus] = useState('本地原型已就绪');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const refreshNoticeTimeoutRef = useRef<number | null>(null);
  const mailboxRefreshRef = useRef(0);
  const searchLoadersRef = useRef<MailboxSearchLoaders | null>(null);
  const {
    query,
    setQuery,
    searchScope,
    setSearchScope,
    filter,
    setFilter,
    listMode,
    setListMode,
    listSort,
    setListSort,
    savedSearches,
    setSavedSearches,
    savedSearchName,
    setSavedSearchName,
    messageLimit,
    setMessageLimit,
    hasMoreMessages,
    setHasMoreMessages,
    loadMoreStatus,
    searchInputRef,
    runSearch,
    changeSearchScope,
    applySearchShortcut,
    clearSearchAndFilter,
    loadMoreMessages,
    runSavedSearch,
    saveCurrentSearch,
    deleteSavedSearch,
    resetSearch,
    handleQueryChange,
    handleSearchScopeChange,
    handleClearSearchAndFilter,
    handleApplySearchShortcut,
    handleShowMessages,
    handleShowThreads,
  } = useMailboxSearchController({
    account,
    accountScope,
    folderId,
    folders,
    imapMailboxes,
    messages,
    mailboxRefreshRef,
    loadersRef: searchLoadersRef,
    setActiveThread,
    setThreadMessages,
    setStatus,
  });
  const [confirmPermanentlyDelete, setConfirmPermanentlyDelete] = useState<MessageSummary | null>(null);
  const [backgroundSyncStatus, setBackgroundSyncStatus] = useState('后台同步待机');
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTask[]>([]);
  const [syncSchedulePlan, setSyncSchedulePlan] = useState<SyncSchedulePlan | null>(null);
  const [remoteImageTrusts, setRemoteImageTrusts] = useState<RemoteImageTrust[]>([]);
  const [, setLastNewMailNotice] = useState<string | null>(null);
  const [, setNotificationStatus] = useState('系统提醒未检查');
  const [, setAppBadgeStatus] = useState('应用角标未同步');
  const [notificationPolicy, setNotificationPolicy] = useState<NotificationPolicy>(loadNotificationPolicy);
  const [sendUndoDelaySeconds, setSendUndoDelaySeconds] = useState<SendUndoDelaySeconds>(loadSendUndoDelaySeconds);
  const {
    setContacts,
    contactMergeSuggestions,
    setContactMergeSuggestions,
    editingContactId,
    setEditingContactId,
    contactEditName,
    setContactEditName,
    contactEditAliases,
    setContactEditAliases,
    contactForm,
    setContactForm,
    contactFormAliases,
    setContactFormAliases,
    mergeSourceContactId,
    setMergeSourceContactId,
    contactTransferBusy,
    managedContacts,
    startEditContact,
    createManagedContact,
    saveContactOverride,
    toggleContactVip,
    deleteManagedContact,
    mergeManagedContact,
    mergeSuggestedContact,
    importContactsVcard,
    exportContactsVcard,
    confirmDeleteContact: contactToDeleteFromHook,
    setConfirmDeleteContact: setContactToDeleteFromHook,
  } = useContactManagement({ setStatus, setNotificationPolicy });
  const {
    oauthClientId,
    setOauthClientId,
    oauthClientSecret,
    setOauthClientSecret,
    oauthRedirectUri,
    setOauthRedirectUri,
    oauthReport,
    oauthSessions,
    setOauthSessions,
    oauthCallbackState,
    setOauthCallbackState,
    oauthCallbackCode,
    setOauthCallbackCode,
    oauthCallbackReport,
    oauthExchangeReport,
    oauthRefreshReport,
    startOAuth2Pkce,
    completeOAuth2Callback,
    waitForOAuth2Callback,
    exchangeOAuth2Token,
    refreshOAuth2Token,
  } = useOAuthFlow({ accountForm, setStatus });
  const {
    appLayout,
    beginLayoutResize,
    beginLayoutMouseResize,
    moveLayoutResize,
    moveLayoutMouseResize,
    endLayoutResize,
    endLayoutMouseResize,
    resetAppLayout,
  } = useAppLayout();
  const {
    undoAction,
    clearUndoAction,
    consumeUndoAction,
    queueUndoAction,
  } = useUndoQueue();
  const [pendingSendUndo, setPendingSendUndo] = useState<PendingSendUndo | null>(null);
  const {
    loadMeta,
    releaseDueSnoozedMessages,
    maybeRunBenchmarkSync,
  } = useAppMetaLoader({
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
  });
  const mailboxContextKey = useMemo(
    () => buildMailboxContextKey({ accountScope, folderId, query, filter, listMode }),
    [accountScope, folderId, query, filter, listMode],
  );
  const {
    selectedId,
    setSelectedId,
    readerSelectedId,
    readerSelectedDetail,
    readerSelectionRevision,
    selected,
    selectedDetail,
    setSelectedDetail,
    selectedSenderDomain,
    selectedSenderTrusted,
    selectMessageForReading,
    patchSelectedDetailMetadata,
    invalidateSelectedDetail,
    clearSelectedDetailIf,
    rememberManualReadState,
    clearManualUnreadSuppression,
    markMessageReadAfterReading,
    updateDetailCache,
    bodyFetchFailedRef,
    bodyFetchInFlightRef,
  } = useMailboxSelectionController({
    messages,
    threadMessages,
    threads,
    activeThread,
    folders,
    stats,
    mailboxContextKey,
    remoteImageTrusts,
    setMessages,
    setThreadMessages,
    setThreads,
    setActiveThread,
    setStats,
    setFolders,
    setAttachments,
    setStatus,
  });
  const {
    loadMessages,
    loadMessagesWithVisibleFallback,
    refreshMailbox,
  } = useMailboxData({
    accountScope,
    currentAccountId: account?.id ?? null,
    folderId,
    searchScope,
    query,
    filter,
    listMode,
    listSort,
    folders,
    imapMailboxes,
    setMessages,
    setThreads,
    setMessageLimit,
    setHasMoreMessages,
    setSelectedId,
    setSelectedMessageIds,
    setFilter,
    setStatus,
    mailboxRefreshRef,
    loadMeta,
    maybeRunBenchmarkSync: () => maybeRunBenchmarkSync(runSyncDryRun),
  });
  const mailboxListStateKey = useMemo(
    () => buildMailboxListStateKey({
      accountScope,
      folderId,
      query,
      filter,
      searchScope,
      listSort,
    }),
    [accountScope, folderId, query, filter, searchScope, listSort],
  );
  const { enqueueBackgroundTask } = useBackgroundTaskCoordinator({
    account,
    accountScope,
    folderId,
    query,
    filter,
    messages,
    outbox,
    notificationPolicy,
    setOutbox,
    setBackgroundTasks,
    setBackgroundSyncStatus,
    setSyncSchedulePlan,
    setSyncRuns,
    setLastNewMailNotice,
    setNotificationStatus,
    setPendingSendUndo,
    setStatus,
    loadMeta,
    loadMessages,
    releaseDueSnoozedMessages,
  });
  const {
    activeProviderVerification,
    providerValidationReport,
    providerValidationRunning,
    isDirty: accountSettingsDirty,
    authTypeChanged,
    authTypeChangeNotice,
    accountSettingsSaving,
    saveAndVerifyReport,
    saveAndVerifyRunning,
    resetSaveAndVerifyReport,
    updateProviderVerification,
    saveSettings,
    saveAndVerify,
    createNewAccount,
    removeCurrentAccount,
    setDefaultAccount,
    applyProviderPreset,
    applyNewAccountPreset,
    saveProviderVerification,
    testConnection,
    verifyAccountCredentials,
    discoverImapFolders,
    runReadOnlyProviderValidation,
    mapImapMailbox,
    createAndMapImapMailbox,
    runSyncDryRun,
    syncImapHistoryPage,
  } = useAccountConnectionController({
    accounts,
    accountForm,
    newAccountForm,
    providerVerifications,
    diagnosticExport,
    folderId,
    query,
    filter,
    setAccount,
    setAccounts,
    setAccountScope,
    setAccountForm,
    setNewAccountForm,
    setFolderId,
    setMessages,
    setSelectedId,
    setAttachments,
    setSettingsOpen,
    setProviderVerifications,
    setConnectionReport,
    setCredentialVerification,
    setCredentialStatus,
    setImapProbe,
    setImapMailboxes,
    setSyncRuns,
    setStatus,
    loadMeta,
    loadMessages,
  });
  searchLoadersRef.current = {
    loadMessagesWithVisibleFallback,
    loadMessages,
    loadMeta,
    syncImapHistoryPage,
  };
  const {
    activeValidationId,
    validationStatus: providerWriteValidationStatus,
    validationLoading: providerWriteValidationLoading,
    writebackProgress: providerWritebackValidationProgress,
    runWritebackStep: runProviderWritebackValidationStep,
    resetWritebackProgress: resetProviderWritebackValidation,
    createValidationDraft,
    refreshValidation: refreshProviderWriteValidation,
  } = useProviderWriteValidation({
    account: accountForm,
    outbox,
    setStatus,
  });

  useEffect(() => {
    const handleFocus = (event: FocusEvent) => {
      const target = event.target as HTMLElement;
      if (!target) return;
      const isInput = target.tagName === 'INPUT';
      const isTextarea = target.tagName === 'TEXTAREA';
      if (isInput || isTextarea) {
        const input = target as HTMLInputElement | HTMLTextAreaElement;
        // Exclude email drafting body or main editor where spellcheck is desired
        const isEmailBody = input.classList.contains('composer-body') ||
                            input.classList.contains('body-editor') ||
                            input.closest('.composer-body-container') ||
                            input.closest('.rich-text-editor') ||
                            input.getAttribute('name') === 'body';
        if (!isEmailBody) {
          input.setAttribute('autocorrect', 'off');
          input.setAttribute('autocapitalize', 'none');
          input.setAttribute('spellcheck', 'false');
          input.spellcheck = false;
        }
      }
    };
    document.addEventListener('focusin', handleFocus);
    return () => document.removeEventListener('focusin', handleFocus);
  }, []);

  function accountIdForScope(scope: AccountScope): number | null {
    return scope === 'all' ? null : scope;
  }

  function scrollSettingsSection(section: SettingsSectionId) {
    setActiveSettingsSection(section);
    window.requestAnimationFrame(() => {
      document.querySelector(`[data-settings-page="${section}"]`)?.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    });
  }

  function openSettingsHome() {
    setActiveSettingsSection('accounts');
    setSettingsOpen(true);
    loadMeta(folderId, accountScope, { mode: 'full' }).catch((error) => setStatus(String(error)));
  }

  function prepareProviderWriteValidation() {
    const validationDraft = createValidationDraft();
    if (!validationDraft) return;
    setSettingsOpen(false);
    setRichComposer(false);
    openComposer(validationDraft);
    setStatus('验证草稿已生成；请检查收件人并按需添加小附件，只有手动点击发送才会真实发信');
  }

  async function locateProviderWriteValidation(role: 'sent' | 'inbox') {
    if (!accountForm || !activeValidationId) return;
    const targetAccountId = accountForm.id;
    setAccountScope(targetAccountId);
    setQuery(activeValidationId);
    setFilter('all');
    setListMode('messages');
    setActiveThread(null);
    setThreadMessages([]);
    setSettingsOpen(false);
    const meta = await loadMeta(null, targetAccountId, { mode: 'mailbox' });
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
      mailboxRefreshRef.current,
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
  }

  async function focusMailboxRole(role: FolderRole, targetAccountId: number | null, statusMessage: string) {
    const startedAt = performance.now();
    const nextScope = accountScope === 'all' ? 'all' : targetAccountId ?? accountScope;
    appFlowLog('focus mailbox role start', {
      role,
      accountId: targetAccountId,
      scope: nextScope,
    });
    if (targetAccountId && accountScope !== 'all') {
      setAccountScope(targetAccountId);
    }
    resetSearch();
    const meta = await loadMeta(null, nextScope, { mode: 'mailbox' });
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
      await loadMessagesWithVisibleFallback(meta.folderId, '', 'all', nextScope, mailboxRefreshRef.current, meta.folders, messagePageSize, 'folder', false);
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
      mailboxRefreshRef.current,
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
  }

  function currentFolderAccountId(): number | null {
    if (accountScope !== 'all') return accountScope;
    return account?.id ?? accounts[0]?.id ?? null;
  }

  function visibleFolderIdForRole(role: FolderRole, accountId?: number | null): number | null {
    return (
      folders.find((folder) => folder.role === role && (folder.is_virtual || !accountId || folder.account_id === accountId))?.id ??
      null
    );
  }


  useEffect(() => {
    window.localStorage.setItem(notificationPolicyStorageKey, JSON.stringify(notificationPolicy));
  }, [notificationPolicy]);

  useEffect(() => {
    window.localStorage.setItem(sendUndoDelayStorageKey, String(sendUndoDelaySeconds));
  }, [sendUndoDelaySeconds]);

  useEffect(() => {
    function handleGlobalFocus(event: FocusEvent) {
      if (event.target instanceof HTMLElement) {
        (window as Window & { __focusedElement?: EventTarget | null }).__focusedElement = event.target;
      }
    }
    function handleGlobalBlur() {
      // Don't clear immediately to allow E2E tests to read it
    }
    document.addEventListener('focus', handleGlobalFocus, true);
    document.addEventListener('blur', handleGlobalBlur, true);
    return () => {
      document.removeEventListener('focus', handleGlobalFocus, true);
      document.removeEventListener('blur', handleGlobalBlur, true);
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(providerVerificationStorageKey, JSON.stringify(providerVerifications));
  }, [providerVerifications]);

  useEffect(() => {
    if (!folderId) return;
    saveMailboxListState(mailboxListStateKey, { limit: messageLimit });
  }, [folderId, mailboxListStateKey, messageLimit]);

  useEffect(() => {
    const dropdownSelector = [
      'details.compact-menu',
      'details.sidebar-disclosure',
      'details.composer-advanced',
      'details.rule-advanced',
    ].join(',');

    function closestDropdown(target: EventTarget | null) {
      return target instanceof Element
        ? target.closest<HTMLDetailsElement>(dropdownSelector)
        : null;
    }

    function closeOpenDropdowns(except: HTMLDetailsElement | null = null) {
      document.querySelectorAll<HTMLDetailsElement>(`${dropdownSelector}[open]`).forEach((details) => {
        if (details !== except) details.open = false;
      });
    }

    function handleGlobalPointerDown(event: PointerEvent) {
      closeOpenDropdowns(closestDropdown(event.target));
    }

    function handleGlobalKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeOpenDropdowns();
    }

    document.addEventListener('pointerdown', handleGlobalPointerDown, true);
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handleGlobalPointerDown, true);
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, []);

  useEffect(() => {
    skipNextFolderEffectLoadRef.current = true;
    refreshMailbox(accountScope, null)
      .catch((error) => setStatus(String(error)))
      .finally(() => {
        skipNextFolderEffectLoadRef.current = false;
      });
  }, [accountScope]);

  useEffect(() => {
    let unlistenProgress: (() => void) | undefined;

    listen<{
      account_email: string;
      folder_name: string;
      current_folder_index: number;
      total_folders: number;
      scanned_folders: number;
      imported_messages: number;
      status_text: string;
    }>('sync-progress', (event) => {
      const payload = event.payload;
      setStatus(payload.status_text);
      if (payload.folder_name) {
        setRefreshNotice(`${payload.folder_name} (${payload.current_folder_index}/${payload.total_folders})`);
      } else {
        setRefreshNotice('正在连接...');
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
    };
  }, []);

  useEffect(() => {
    if (!folderId) return;
    if (skipNextFolderEffectLoadRef.current) {
      skipNextFolderEffectLoadRef.current = false;
      return;
    }
    const restoredLimit = loadMailboxMessageLimit(mailboxListStateKey);
    loadMessages(folderId, query, filter, accountScope, mailboxRefreshRef.current, restoredLimit).catch((error) => setStatus(String(error)));
  }, [folderId, filter, listSort]);

  const selectedMessageSet = useMemo(() => new Set(selectedMessageIds), [selectedMessageIds]);
  const selectedMessages = useMemo(
    () => messages.filter((message) => selectedMessageSet.has(message.id)),
    [messages, selectedMessageSet],
  );
  const unreadTotal = stats?.unread_messages ?? 0;
  const messageListSummary = stats
    ? `${stats.total_messages} 封 · ${unreadTotal} 未读`
    : `${messages.length} 封`;
  const visibleListSummary = hasMoreMessages ? `${messages.length}+ 封` : `${messages.length} 封`;
  const currentViewLabel = folders.find((folder) => folder.id === folderId)?.name ?? '邮件';
  const mailboxListScrollTop = useMemo(
    () => Math.max(0, loadMailboxListStates()[mailboxListStateKey]?.scrollTop ?? 0),
    [mailboxListStateKey],
  );
  const handleMailboxListScrollTopChange = useCallback((scrollTop: number) => {
    saveMailboxListState(mailboxListStateKey, { scrollTop });
  }, [mailboxListStateKey]);
  const activeThreadSelected = readerSelectedDetail;
  const selectedHasRemoteImageWarning = Boolean(
    readerSelectedDetail?.security_warnings.some((warning) => warning.includes('远程图片')),
  ) && !selectedSenderTrusted;

  const {
    fetchSelectedBody,
    renderSelectedWithRemoteImagePolicy,
    allowRemoteImagesForSelectedOnce,
    trustRemoteImagesForSelected,
    blockSelectedSender,
    downloadAttachment,
    openAttachment,
    saveAttachmentAs,
    exportSelectedMessage,
  } = useReaderActions({
    selected,
    selectedDetail,
    setSelectedDetail,
    onUpdateCache: updateDetailCache,
    activeThread,
    folderId,
    setMessages,
    setThreadMessages,
    setAttachments,
    setRemoteImageTrusts,
    setRules,
    setSelectedId,
    setStatus,
    visibleFolderIdForRole,
    loadMeta: (fid) => loadMeta(fid, accountScope, { mode: 'mailbox' }),
    loadMessages: (fid) => loadMessages(fid),
    bodyFetchFailedRef,
    bodyFetchInFlightRef,
  });

  useEffect(() => {
    if (!isSettingsOpen || activeSettingsSection !== 'backup') return;
    refreshStorageUsage(false).catch((error) => setStatus(String(error)));
  }, [isSettingsOpen, activeSettingsSection]);

  const openThread = useCallback(async (thread: ThreadSummary, announce = true) => {
    const nextMessages = await invoke<MessageSummary[]>('list_thread_messages', {
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
  }, [accountScope, setSelectedId]);

  const refreshAll = useCallback(async () => {
    const startedAt = performance.now();
    appFlowLog('refreshAll start', {
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
    appFlowLog('refreshAll done', {
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
  ]);

  const syncAndRefresh = useCallback(async () => {
    if (isRefreshing) return;
    const startedAt = performance.now();
    const syncAccountId = accountScope === 'all' ? null : accountScope;
    appFlowLog('syncAndRefresh start', {
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
      const run = await invoke<SyncRun>('sync_imap_headers', { accountId: syncAccountId });
      setSyncRuns((current) => [run, ...current].slice(0, 10));
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
      appFlowLog('syncAndRefresh done', {
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
      appFlowWarn('syncAndRefresh failed', {
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
  ]);

  const {
    draft,
    setDraft,
    quickReplyBody,
    setQuickReplyBody,
    isRichComposer,
    setRichComposer,
    composeTemplates,
    setComposeTemplates,
    templateName,
    setTemplateName,
    composerAutosave,
    setComposerAutosave,
    isComposerOpen,
    setComposerOpen,
    isComposerMinimized,
    setComposerMinimized,
    isComposerDropActive,
    setComposerDropActive,
    composerCloseConfirmOpen,
    setComposerCloseConfirmOpen,
    openComposer,
    closeComposer,
    forceCloseComposer,
    clearComposerAutosave,
    insertSignatureIntoDraft,
    applyComposeTemplate,
    saveDraftAsTemplate,
    deleteComposeTemplate,
    pickDraftAttachments,
    handleComposerAttachmentDrop,
    handleComposerAttachmentPaste,
    handleComposerAttachmentDragOver,
    handleComposerAttachmentDragEnter,
    handleComposerAttachmentDragLeave,
    removeDraftAttachment,
    addContactToDraft,
    composeFromMessage,
    editDraftMessage,
    saveDraft,
    sendDraft,
    sendQuickReply,
    queueDraft,
    cancelOutboxItem,
    undoPendingSend,
    composeToContact,
  } = useComposerController({
    account,
    accounts,
    identities,
    selectedId,
    pendingSendUndo,
    sendUndoDelaySeconds,
    setOutbox,
    setPendingSendUndo,
    setSelectedId,
    setStatus,
    loadMeta: (nextFolderId?: number | null) => loadMeta(nextFolderId, accountScope, { mode: 'mailbox' }),
    refreshAll,
    focusMailboxRole,
  });

  const toggleMessageSelection = useCallback((messageId: number, checked: boolean) => {
    setSelectedMessageIds((current) => {
      if (checked) return current.includes(messageId) ? current : [...current, messageId];
      return current.filter((id) => id !== messageId);
    });
  }, []);

  const toggleAllVisibleMessages = useCallback((checked: boolean) => {
    setSelectedMessageIds(checked ? messages.map((message) => message.id) : []);
  }, [messages]);

  function snapshotMessages(items: MessageSummary[]): UndoMessageSnapshot[] {
    return items.map((message) => ({
      id: message.id,
      subject: message.subject || '(无主题)',
      account_id: message.account_id,
      folder_role: message.folder_role,
      is_read: message.is_read,
      is_starred: message.is_starred,
      snoozed_until: message.snoozed_until,
      labels: [...message.labels],
    }));
  }

  const {
    snoozeTarget,
    setSnoozeTarget,
    requestSnooze,
    confirmSnooze,
    snoozeSelected,
  } = useSnoozeController({
    selected,
    selectedId,
    threadMessages,
    snapshotMessages,
    setSelectedId,
    setSelectedMessageIds,
    setActiveThread,
    setThreadMessages,
    setStatus,
    clearSelectedDetailIf,
    invalidateSelectedDetail,
    refreshAll,
    queueUndoAction,
  });

  function requestPermanentlyDeleteMessage(message: MessageSummary) {
    setConfirmPermanentlyDelete(message);
  }

  const {
    runBulkAction,
    runThreadAction,
    moveSelectedMessagesToFolder,
    moveThreadToFolder,
    toggleBulkLabel,
    toggleThreadLabel,
    toggleThreadMuted,
    restoreUndoAction,
    moveMessagesToFolderByIds,
    runMessageAction,
    moveMessageToFolder,
    toggleMessageLabel,
    toggleRead,
    toggleStar,
    moveSelected,
    moveSelectedToFolder,
    markSelectedAsSpam,
    markSelectedNotSpam,
    restoreSelectedFromTrash,
    permanentlyDeleteMessageConfirmed,
    unsnoozeSelected,
    toggleLabel,
  } = useMessageCollectionActions({
    folders,
    selectedMessages,
    selected,
    selectedId,
    messages,
    labels,
    folderId,
    refreshAll,
    loadMeta: (nextFolderId) => loadMeta(nextFolderId, accountScope, { mode: 'mailbox' }),
    loadMessages: (nextFolderId) => loadMessages(nextFolderId),
    setActiveThread,
    setSelectedMessageIds,
    setSelectedId,
    setStatus,
    snapshotMessages,
    queueUndoAction,
    consumeUndoAction,
    onReadStateChange: rememberManualReadState,
    clearSelectedDetailIf,
    patchSelectedDetailMetadata,
    visibleFolderIdForRole,
    onRequestSnooze: requestSnooze,
    onRequestPermanentDelete: requestPermanentlyDeleteMessage,
  });

  const {
    confirmDeleteLabel,
    setConfirmDeleteLabel,
    handleCreateLabel,
    handleUpdateLabel,
    handleDeleteLabelConfirmed,
    handleDeleteLabel,
  } = useLabelManagement({ labels, setLabels, setStatus });
  const {
    customFolderName,
    setCustomFolderName,
    renamingFolderId,
    setRenamingFolderId,
    renamingFolderName,
    setRenamingFolderName,
    confirmDeleteFolder,
    setConfirmDeleteFolder,
    createCustomFolder,
    startRenameCustomFolder,
    renameCustomFolder,
    deleteCustomFolderConfirmed,
    deleteCustomFolder,
    markFolderRead,
  } = useFolderManagement({
    folderId,
    currentFolderAccountId,
    visibleFolderIdForRole,
    loadMeta: (nextFolderId) => loadMeta(nextFolderId, accountScope, { mode: 'mailbox' }),
    loadMessages: (nextFolderId) => loadMessages(nextFolderId),
    refreshAll,
    setStatus,
  });
  const {
    confirmEmptyTrashState,
    setConfirmEmptyTrashState,
    emptyCurrentTrash,
    emptyCurrentTrashConfirmed,
  } = useTrashController({
    accounts,
    accountScope,
    setStatus,
    refreshAll,
  });
  const {
    identityForm,
    setIdentityForm,
    confirmDeleteIdentity,
    setConfirmDeleteIdentity,
    saveIdentity,
    editIdentity,
    deleteIdentityConfirmed,
    deleteIdentity,
  } = useIdentityManagement({
    accountForm,
    identities,
    setIdentities,
    setStatus,
  });
  const {
    ruleForm,
    setRuleForm,
    ruleBuilderField,
    setRuleBuilderField,
    ruleBuilderNeedle,
    setRuleBuilderNeedle,
    editingRuleId,
    setEditingRuleId,
    confirmDeleteRule,
    setConfirmDeleteRule,
    saveRule,
    toggleRule,
    editRule,
    removeRuleConfirmed,
    removeRule,
    updateRuleConditionField,
    updateRuleConditionValue,
    toggleRuleAction,
    updateRuleLabelAction,
  } = useRuleManagement({ rules, setRules, setStatus });
  const {
    credentialSecret,
    setCredentialSecret,
    storeCredential,
    storeAndVerifyCredential,
    checkCredential,
    deleteCredential,
  } = useCredentialManagement({
    account,
    credentialStatus,
    setCredentialStatus,
    setCredentialVerification,
    setStatus,
    verifyAccountCredentials,
  });
  const {
    localBackupSummary,
    storageUsage,
    storageBusy,
    exportDiagnostics,
    exportLocalBackup,
    previewLocalBackup,
    importLocalBackup,
    refreshStorageUsage,
    clearAttachmentCache,
  } = useStorageManagement({
    selected,
    diagnosticExport,
    setDiagnosticExport,
    setAttachments,
    loadMeta: (nextFolderId) => loadMeta(nextFolderId, accountScope, { mode: 'mailbox' }),
    loadMessages: (nextFolderId) => loadMessages(nextFolderId),
    setStatus,
  });

  async function importEmlFile() {
    const imported = await invoke<Message | null>('import_eml_file', {
      accountId: currentFolderAccountId(),
    });
    if (!imported) {
      setStatus('已取消导入 EML');
      return;
    }
    setQuery('');
    setFilter('all');
    setListMode('messages');
    setActiveThread(null);
    setThreadMessages([]);
    const meta = await loadMeta(null, accountScope, { mode: 'mailbox' });
    const inboxFolderId =
      meta.folders.find(
        (folder) =>
          folder.role === 'inbox' &&
          (folder.is_virtual || folder.account_id === imported.account_id),
      )?.id ?? meta.folderId;
    const nextMessages = await loadMessages(inboxFolderId, '', 'all');
    if (!nextMessages.some((message) => message.id === imported.id)) {
      setMessages((current) => [imported, ...current.filter((message) => message.id !== imported.id)]);
    }
    skipNextFolderEffectLoadRef.current = true;
    setFolderId(inboxFolderId);
    setSelectedId(imported.id);
    setStatus(`已导入 EML：${imported.subject || '(无主题)'}`);
  }

  async function deleteRemoteImageTrust(trust: RemoteImageTrust) {
    await invoke('delete_remote_image_trust', { trustId: trust.id });
    setRemoteImageTrusts((current) => current.filter((item) => item.id !== trust.id));
    if (selected?.account_id === trust.account_id) {
      await renderSelectedWithRemoteImagePolicy(selected.id);
    }
    setStatus(`已移除远程图片信任：${trust.value}`);
  }

  async function parseRawMessage() {
    const preview = await invoke<ParsedMessagePreview>('parse_raw_message', {
      input: { raw: rawMessage },
    });
    setParsedPreview(preview);
    setStatus(preview.warning_count > 0 ? `发现 ${preview.warning_count} 个安全提示` : '原始邮件预览解析完成');
  }

  function changeAccountScope(value: string) {
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
  }

  function selectFolder(nextFolderId: number) {
    mailboxRefreshRef.current += 1;
    skipNextFolderEffectLoadRef.current = false;
    resetSearch();
    setFolderId(nextFolderId);
  }

  useAppShortcuts({
    searchInputRef,
    messages,
    selected,
    selectedId,
    selectedMessages,
    selectedMessageIds,
    listMode,
    undoAction,
    isComposerOpen,
    isComposerMinimized,
    isSettingsOpen,
    isShortcutsOpen,
    closeOverlays: () => {
      closeComposer();
      setSettingsOpen(false);
      setShortcutsOpen(false);
    },
    clearSelection: () => setSelectedMessageIds([]),
    setStatus,
    restoreUndoAction,
    toggleAllVisibleMessages,
    openShortcuts: () => setShortcutsOpen(true),
    composeNew: () => {
      setDraft(emptyDraft);
      setRichComposer(false);
      openComposer(emptyDraft);
      setStatus('已打开新邮件');
    },
    setSelectedId: selectMessageForReading,
    runBulkAction,
    composeFromMessage,
    toggleStar,
    toggleRead,
    moveSelected,
  });

  const handleRefresh = useCallback(() => {
    syncAndRefresh().catch((error) => setStatus(String(error)));
  }, [syncAndRefresh, setStatus]);

  const handleMoveBulkToFolder = useCallback((folder: Folder) => {
    moveSelectedMessagesToFolder(folder).catch((error) => setStatus(String(error)));
  }, [moveSelectedMessagesToFolder, setStatus]);

  const handleToggleBulkLabel = useCallback((label: Label) => {
    toggleBulkLabel(label).catch((error) => setStatus(String(error)));
  }, [toggleBulkLabel, setStatus]);

  const handleRunMessageAction = useCallback((message: MessageSummary, action: MessageContextAction) => {
    runMessageAction(message, action).catch((error) => setStatus(String(error)));
  }, [runMessageAction, setStatus]);

  const handleMoveMessageToFolder = useCallback((message: MessageSummary, folder: Folder) => {
    moveMessageToFolder(message, folder).catch((error) => setStatus(String(error)));
  }, [moveMessageToFolder, setStatus]);

  const handleToggleMessageLabel = useCallback((message: MessageSummary, label: Label) => {
    toggleMessageLabel(message, label).catch((error) => setStatus(String(error)));
  }, [toggleMessageLabel, setStatus]);

  const handleRunThreadAction = useCallback((thread: ThreadSummary, items: MessageSummary[], action: BulkMessageAction) => {
    runThreadAction(thread, items, action).catch((error) => setStatus(String(error)));
  }, [runThreadAction, setStatus]);

  const handleMoveThreadToFolder = useCallback((thread: ThreadSummary, items: MessageSummary[], folder: Folder) => {
    moveThreadToFolder(thread, items, folder).catch((error) => setStatus(String(error)));
  }, [moveThreadToFolder, setStatus]);

  const handleToggleThreadLabel = useCallback((thread: ThreadSummary, items: MessageSummary[], label: Label) => {
    toggleThreadLabel(thread, items, label).catch((error) => setStatus(String(error)));
  }, [toggleThreadLabel, setStatus]);

  const handleToggleThreadMute = useCallback((thread: ThreadSummary, items: MessageSummary[]) => {
    toggleThreadMuted(thread, items).catch((error) => setStatus(String(error)));
  }, [toggleThreadMuted, setStatus]);

  const handleLoadMore = useCallback(() => {
    loadMoreMessages().catch((error) => setStatus(String(error)));
  }, [loadMoreMessages, setStatus]);

  return (
    <main
      className="app-shell"
      style={{ gridTemplateColumns: `${appLayout.sidebar}px 5px ${appLayout.list}px 5px minmax(360px, 1fr)` }}
      onPointerMove={moveLayoutResize}
      onPointerUp={endLayoutResize}
      onPointerCancel={endLayoutResize}
      onMouseMove={moveLayoutMouseResize}
      onMouseUp={endLayoutMouseResize}
      onMouseLeave={endLayoutMouseResize}
    >
      <Sidebar
        accountScope={accountScope}
        accounts={accounts}
        folders={folders}
        folderId={folderId}
        renamingFolderId={renamingFolderId}
        renamingFolderName={renamingFolderName}
        backgroundSyncStatus={backgroundSyncStatus}
        backgroundTasks={backgroundTasks}
        savedSearchName={savedSearchName}
        savedSearches={savedSearches}
        customFolderName={customFolderName}
        onAccountScopeChange={changeAccountScope}
        onSetDefaultAccount={(accountId) => {
          setDefaultAccount(accountId).catch((error) => setStatus(String(error)));
        }}
        onCompose={() => {
          if (isDraftEmpty(draft) && composerAutosave) {
            openComposer(undefined, { restoreAutosave: true });
          } else {
            setRichComposer(false);
            openComposer(emptyDraft);
            setStatus('已打开新邮件');
          }
        }}
        onSyncNow={() => {
          syncAndRefresh().catch((error) => setStatus(String(error)));
        }}
        onResetAppLayout={() => {
          resetAppLayout();
          setStatus('已重置布局');
        }}
        onSavedSearchNameChange={setSavedSearchName}
        onSaveCurrentSearch={saveCurrentSearch}
        onRunSavedSearch={(savedSearch) => {
          runSavedSearch(savedSearch).catch((error) => setStatus(String(error)));
        }}
        onDeleteSavedSearch={deleteSavedSearch}
        onCustomFolderNameChange={setCustomFolderName}
        onCreateCustomFolder={() => {
          createCustomFolder().catch((error) => setStatus(String(error)));
        }}
        onSelectFolder={selectFolder}
        onDropMessagesToFolder={(folder, messageIds) => {
          moveMessagesToFolderByIds(folder, messageIds).catch((error) => setStatus(String(error)));
        }}
        onFolderFavoriteChange={(folder, isFavorite) => {
          setStatus(isFavorite ? `已固定到常用邮箱：${folder.name}` : `已从常用邮箱移除：${folder.name}`);
        }}
        onRenamingFolderNameChange={setRenamingFolderName}
        onRenameFolder={(folder) => {
          try {
            renameCustomFolder(folder).catch((error) => setStatus(String(error)));
          } catch (error) {
            setStatus(String(error));
          }
        }}
        onCancelRename={() => setRenamingFolderId(null)}
        onStartRename={startRenameCustomFolder}
        onDeleteFolder={(folder) => { deleteCustomFolder(folder); }}
        onMarkFolderRead={(folder) => { markFolderRead(folder).catch((error) => setStatus(String(error))); }}
        onEmptyTrash={() => { emptyCurrentTrash(); }}
        onOpenSettings={openSettingsHome}
        onOpenShortcuts={() => setShortcutsOpen(true)}
      />

      <button
        className="pane-resizer sidebar-resizer"
        type="button"
        aria-label="调整侧边栏宽度"
        title="拖拽调整侧边栏宽度"
        onPointerDown={(event) => beginLayoutResize('sidebar', event)}
        onMouseDown={(event) => beginLayoutMouseResize('sidebar', event)}
      />

      <MessageListPane
        searchInputRef={searchInputRef}
        query={query}
        searchScope={searchScope}
        isRefreshing={isRefreshing}
        refreshNotice={refreshNotice}
        filter={filter}
        listMode={listMode}
        listSort={listSort}
        selectedMessageIds={selectedMessageIds}
        folders={folders}
        labels={labels}
        threads={threads}
        activeThread={activeThread}
        messages={messages}
        selectedId={selectedId}
        hasMoreMessages={hasMoreMessages}
        currentViewLabel={currentViewLabel}
        visibleListSummary={visibleListSummary}
        messageListSummary={messageListSummary}
        listStateKey={mailboxListStateKey}
        initialScrollTop={mailboxListScrollTop}
        onScrollTopChange={handleMailboxListScrollTopChange}
        onSearchSubmit={runSearch}
        onQueryChange={handleQueryChange}
        onSearchScopeChange={handleSearchScopeChange}
        onClearSearchAndFilter={handleClearSearchAndFilter}
        onApplySearchShortcut={handleApplySearchShortcut}
        onRefresh={handleRefresh}
        onShowMessages={handleShowMessages}
        onShowThreads={handleShowThreads}
        onFilterChange={setFilter}
        onSortChange={setListSort}
        onToggleAllVisible={toggleAllVisibleMessages}
        onRunBulkAction={runBulkAction}
        onRequestSnooze={requestSnooze}
        onMoveBulkToFolder={handleMoveBulkToFolder}
        onToggleBulkLabel={handleToggleBulkLabel}
        onRunMessageAction={handleRunMessageAction}
        onMoveMessageToFolder={handleMoveMessageToFolder}
        onToggleMessageLabel={handleToggleMessageLabel}
        onComposeFromMessage={composeFromMessage}
        onOpenThread={openThread}
        onRunThreadAction={handleRunThreadAction}
        onMoveThreadToFolder={handleMoveThreadToFolder}
        onToggleThreadLabel={handleToggleThreadLabel}
        onToggleThreadMute={handleToggleThreadMute}
        onSelectMessage={selectMessageForReading}
        onToggleMessageSelection={toggleMessageSelection}
        onLoadMore={handleLoadMore}
        loadMoreStatus={loadMoreStatus}
      />

      <button
        className="pane-resizer list-resizer"
        type="button"
        aria-label="调整邮件列表宽度"
        title="拖拽调整邮件列表宽度"
        onPointerDown={(event) => beginLayoutResize('list', event)}
        onMouseDown={(event) => beginLayoutMouseResize('list', event)}
      />

      <ReaderPane
        activeThread={activeThread}
        threadMessages={threadMessages}
        activeThreadSelected={activeThreadSelected}
        selected={readerSelectedDetail}
        selectedId={readerSelectedId}
        readTriggerKey={readerSelectionRevision}
        accountScope={accountScope}
        folders={folders}
        labels={labels}
        attachments={attachments}
        selectedSenderTrusted={selectedSenderTrusted}
        selectedSenderDomain={selectedSenderDomain}
        selectedHasRemoteImageWarning={selectedHasRemoteImageWarning}
        quickReplyBody={quickReplyBody}
        onSelectMessage={selectMessageForReading}
        onComposeNew={(fields) => {
          setRichComposer(false);
          openComposer({
            ...emptyDraft,
            account_id: account?.id ?? accounts[0]?.id ?? 0,
            to: fields?.to || '',
            cc: fields?.cc || '',
            bcc: fields?.bcc || '',
            subject: fields?.subject || '',
            body: fields?.body || '',
          });
          setStatus('已打开新邮件');
        }}
        onComposeFromMessage={composeFromMessage}
        onRunThreadAction={(action) => {
          if (!activeThread) return;
          runThreadAction(activeThread, threadMessages, action).catch((error) => setStatus(String(error)));
        }}
        onMoveThreadToFolder={(folder) => {
          if (!activeThread) return;
          moveThreadToFolder(activeThread, threadMessages, folder).catch((error) => setStatus(String(error)));
        }}
        onToggleThreadLabel={(label) => {
          if (!activeThread) return;
          toggleThreadLabel(activeThread, threadMessages, label).catch((error) => setStatus(String(error)));
        }}
        onToggleThreadMute={() => {
          if (!activeThread) return;
          toggleThreadMuted(activeThread, threadMessages).catch((error) => setStatus(String(error)));
        }}
        onToggleStar={toggleStar}
        onEditDraft={editDraftMessage}
        onRestoreFromTrash={restoreSelectedFromTrash}
        onMoveArchive={() => { moveSelected('archive').catch((error) => setStatus(String(error))); }}
        onMoveTrash={() => { moveSelected('trash').catch((error) => setStatus(String(error))); }}
        onToggleRead={toggleRead}
        onReadComplete={markMessageReadAfterReading}
        onUnsnooze={unsnoozeSelected}
        onSnooze={snoozeSelected}
        onExportMessage={exportSelectedMessage}
        onFetchBody={fetchSelectedBody}
        onMarkNotSpam={markSelectedNotSpam}
        onMarkAsSpam={markSelectedAsSpam}
        onAllowRemoteImagesOnce={() => { allowRemoteImagesForSelectedOnce().catch((error) => setStatus(String(error))); }}
        onTrustRemoteImages={trustRemoteImagesForSelected}
        onBlockSender={blockSelectedSender}
        onPermanentlyDelete={() => { if (selected) requestPermanentlyDeleteMessage(selected); }}
        onEmptyTrash={emptyCurrentTrash}
        onMoveToFolder={(folder) => { moveSelectedToFolder(folder).catch((error) => setStatus(String(error))); }}
        onToggleLabel={toggleLabel}
        onCreateLabel={handleCreateLabel}
        onUpdateLabel={handleUpdateLabel}
        onDeleteLabel={handleDeleteLabel}
        onOpenAttachment={openAttachment}
        onDownloadAttachment={downloadAttachment}
        onSaveAttachmentAs={saveAttachmentAs}
        onQuickReplyChange={setQuickReplyBody}
        onSendQuickReply={sendQuickReply}
      />

      {isComposerOpen && (
        <Suspense fallback={<DeferredSurface label="正在打开写信窗口" />}>
          <ComposerWindow
          minimized={isComposerMinimized}
          draft={draft}
          accounts={accounts}
          identities={identities}
          fallbackAccountId={account?.id ?? accounts[0]?.id ?? 0}
          contacts={managedContacts}
          templates={composeTemplates}
          templateName={templateName}
          richComposer={isRichComposer}
          dropActive={isComposerDropActive}
          status={status}
          autosave={composerAutosave}
          onMinimize={() => setComposerMinimized(true)}
          onRestore={() => setComposerMinimized(false)}
          onClose={closeComposer}
          onDraftChange={setDraft}
          onAddContact={addContactToDraft}
          onApplyTemplate={applyComposeTemplate}
          onDeleteTemplate={deleteComposeTemplate}
          onTemplateNameChange={setTemplateName}
          onSaveTemplate={saveDraftAsTemplate}
          onRichComposerChange={setRichComposer}
          onInsertSignature={insertSignatureIntoDraft}
          onPickAttachments={() => { pickDraftAttachments().catch((error) => setStatus(String(error))); }}
          onRemoveAttachment={removeDraftAttachment}
          onAttachmentDrop={handleComposerAttachmentDrop}
          onAttachmentDragEnter={handleComposerAttachmentDragEnter}
          onAttachmentDragLeave={handleComposerAttachmentDragLeave}
          onAttachmentDragOver={handleComposerAttachmentDragOver}
          onAttachmentPaste={handleComposerAttachmentPaste}
          onSaveDraft={() => { saveDraft().catch((error) => setStatus(String(error))); }}
          onQueueDraft={() => { queueDraft().catch((error) => setStatus(String(error))); }}
          onSendDraft={() => { sendDraft().catch((error) => setStatus(String(error))); }}
          />
        </Suspense>
      )}

      {snoozeTarget && (
        <Suspense fallback={<DeferredSurface label="正在打开稍后处理" />}>
          <SnoozePicker
            targetCount={snoozeTarget.messages.length}
            targetLabel={snoozeTarget.label}
            onConfirm={confirmSnooze}
            onClose={() => setSnoozeTarget(null)}
          />
        </Suspense>
      )}

      {isSettingsOpen && (accountForm || activeSettingsSection === 'accounts') && (
        <Suspense fallback={<DeferredSurface label="正在打开设置" />}>
          <SettingsFrame
          title="设置"
          subtitle={accountForm ? `${accountForm.email} · ${accountForm.provider}` : '未添加账号'}
          activeSection={activeSettingsSection}
          onNavigate={scrollSettingsSection}
          onTestConnection={() => {
            if (!accountForm) {
              setStatus('请先添加邮箱账号');
              return;
            }
            testConnection().catch((error) => setStatus(String(error)));
          }}
          isDirty={accountSettingsDirty}
          isBusy={accountSettingsSaving || saveAndVerifyRunning}
          connectionSummary={saveAndVerifyReport.summary}
          onSave={() => {
            if (!accountForm) {
              setStatus('请先添加邮箱账号');
              return;
            }
            saveSettings().catch((error) => setStatus(String(error)));
          }}
          onSaveAndVerify={accountForm ? () => {
            saveAndVerify().catch((error) => setStatus(String(error)));
          } : undefined}
          onClose={() => {
            resetSaveAndVerifyReport();
            setSettingsOpen(false);
          }}
        >
            {(activeSettingsSection === 'accounts'
              || activeSettingsSection === 'providers'
              || activeSettingsSection === 'auth') && (
            <>
            <AccountConnectionSettings
              section={activeSettingsSection}
              accounts={accounts}
              accountForm={accountForm}
              accountCount={accounts.length}
              newAccountForm={newAccountForm}
              providerVerifications={providerVerifications}
              activeProviderVerification={activeProviderVerification}
              oauthClientId={oauthClientId}
              oauthClientSecret={oauthClientSecret}
              oauthRedirectUri={oauthRedirectUri}
              oauthCallbackState={oauthCallbackState}
              oauthCallbackCode={oauthCallbackCode}
              oauthReport={oauthReport}
              oauthCallbackReport={oauthCallbackReport}
              oauthExchangeReport={oauthExchangeReport}
              oauthRefreshReport={oauthRefreshReport}
              oauthSessions={oauthSessions}
              authTypeChanged={authTypeChanged}
              authTypeChangeNotice={authTypeChangeNotice}
              saveAndVerifyReport={saveAndVerifyReport}
              onAccountFormChange={setAccountForm}
              onNewAccountFormChange={setNewAccountForm}
              onApplyProviderPreset={applyProviderPreset}
              onApplyNewAccountPreset={applyNewAccountPreset}
              onCreateNewAccount={async (secret) => {
                try {
                  await createNewAccount(secret);
                } catch (error) {
                  setStatus(String(error));
                  throw error;
                }
              }}
              onRemoveAccount={(deleteSecret: boolean) => removeCurrentAccount(deleteSecret)}
              onUpdateProviderVerification={updateProviderVerification}
              onSaveProviderVerification={saveProviderVerification}
              onSaveAccountSettings={async (updatedAccount) => {
                const updated = await invoke<Account>('update_account_settings', {
                  accountId: updatedAccount.id,
                  input: updatedAccount,
                });
                setAccount(updated);
                setAccountForm(updated);
                setAccounts((current) => current.map((item) => (item.id === updated.id ? updated : item)));
                setStatus('账号配置已保存');
              }}
              onOauthClientIdChange={setOauthClientId}
              onOauthClientSecretChange={setOauthClientSecret}
              onOauthRedirectUriChange={setOauthRedirectUri}
              onOauthCallbackStateChange={setOauthCallbackState}
              onOauthCallbackCodeChange={setOauthCallbackCode}
              onStartOAuth2Pkce={() => { startOAuth2Pkce().catch((error) => setStatus(String(error))); }}
              onRefreshOAuth2Token={() => { refreshOAuth2Token().catch((error) => setStatus(String(error))); }}
              onCompleteOAuth2Callback={() => { completeOAuth2Callback().catch((error) => setStatus(String(error))); }}
              onWaitForOAuth2Callback={() => { waitForOAuth2Callback().catch((error) => setStatus(String(error))); }}
              onExchangeOAuth2Token={(sessionId) => { exchangeOAuth2Token(sessionId).catch((error) => setStatus(String(error))); }}
            />
            {activeSettingsSection === 'auth' && accountForm && (
              <CredentialSecuritySettings
                account={accountForm}
                credentialSecret={credentialSecret}
                credentialStatus={credentialStatus}
                connectionReport={connectionReport?.account_email === accountForm.email ? connectionReport : null}
                credentialVerification={
                  !authTypeChanged && credentialVerification?.account_email === accountForm.email
                    ? credentialVerification
                    : null
                }
                authTypeChangeNotice={authTypeChangeNotice}
                providerValidationReport={
                  providerValidationReport?.account_email === accountForm.email ? providerValidationReport : null
                }
                providerValidationRunning={
                  providerValidationRunning && providerValidationReport?.account_email === accountForm.email
                }
                onCredentialSecretChange={setCredentialSecret}
                onCheckCredential={() => { checkCredential().catch((error) => setStatus(String(error))); }}
                onVerifyCredential={() => { verifyAccountCredentials().catch((error) => setStatus(String(error))); }}
                onRunProviderValidation={() => {
                  runReadOnlyProviderValidation().catch((error) => setStatus(String(error)));
                }}
                onDeleteCredential={() => { deleteCredential().catch((error) => setStatus(String(error))); }}
                onStoreCredential={() => { storeCredential().catch((error) => setStatus(String(error))); }}
                onStoreAndVerifyCredential={() => {
                  storeAndVerifyCredential().catch((error) => setStatus(String(error)));
                }}
              />
            )}
            </>
            )}
            {(activeSettingsSection === 'sending'
              || activeSettingsSection === 'notifications'
              || activeSettingsSection === 'privacy'
              || activeSettingsSection === 'identities') && accountForm && (
            <ExperienceSettings
              section={activeSettingsSection}
              accountForm={accountForm}
              accounts={accounts}
              notificationPolicy={notificationPolicy}
              sendUndoDelaySeconds={sendUndoDelaySeconds}
              remoteImageTrusts={remoteImageTrusts}
              identities={identities}
              identityForm={identityForm}
              onAccountFormChange={setAccountForm}
              onNotificationPolicyChange={setNotificationPolicy}
              onSendUndoDelayChange={setSendUndoDelaySeconds}
              onDeleteRemoteImageTrust={deleteRemoteImageTrust}
              onIdentityFormChange={setIdentityForm}
              onEditIdentity={editIdentity}
              onDeleteIdentity={deleteIdentity}
              onSaveIdentity={() => { saveIdentity().catch((error) => setStatus(String(error))); }}
            />
            )}
            {activeSettingsSection === 'backup' && (
            <DataSafetySettings
              diagnosticExport={diagnosticExport}
              localBackupSummary={localBackupSummary}
              connectionReport={connectionReport}
              storageUsage={storageUsage}
              storageBusy={storageBusy}
              onExportDiagnostics={() => { exportDiagnostics().catch((error) => setStatus(String(error))); }}
              onImportEml={() => { importEmlFile().catch((error) => setStatus(String(error))); }}
              onPreviewBackup={() => { previewLocalBackup().catch((error) => setStatus(String(error))); }}
              onImportBackup={() => { importLocalBackup().catch((error) => setStatus(String(error))); }}
              onExportBackup={() => { exportLocalBackup().catch((error) => setStatus(String(error))); }}
              onRefreshStorage={() => refreshStorageUsage()}
              onClearAttachmentCache={() => clearAttachmentCache()}
            />
            )}
            {activeSettingsSection === 'sync' && accountForm && (
            <SyncOperationsSettings
              accountForm={accountForm}
              imapProbe={imapProbe}
              syncSchedulePlan={syncSchedulePlan}
              imapMailboxes={imapMailboxes}
              folders={folders}
              syncRuns={syncRuns}
              outbox={outbox}
              writeValidationStatus={providerWriteValidationStatus}
              writeValidationLoading={providerWriteValidationLoading}
              writebackValidationProgress={providerWritebackValidationProgress}
              onDiscoverImapFolders={() => { discoverImapFolders().catch((error) => setStatus(String(error))); }}
              onPrepareWriteValidation={prepareProviderWriteValidation}
              onRefreshWriteValidation={() => {
                refreshProviderWriteValidation().catch((error) => setStatus(String(error)));
              }}
              onLocateWriteValidation={(role) => {
                locateProviderWriteValidation(role).catch((error) => setStatus(String(error)));
              }}
              onRunWritebackValidationStep={(step) => {
                runProviderWritebackValidationStep(step).catch((error) => setStatus(String(error)));
              }}
              onResetWritebackValidation={resetProviderWritebackValidation}
              onRunSyncDryRun={() => { runSyncDryRun().catch((error) => setStatus(String(error))); }}
              onSyncHistory={() => { syncImapHistoryPage().catch((error) => setStatus(String(error))); }}
              onMapImapMailbox={(mailbox, targetFolderId) => {
                mapImapMailbox(mailbox, targetFolderId).catch((error) => setStatus(String(error)));
              }}
              onCreateAndMapImapMailbox={(mailbox) => {
                createAndMapImapMailbox(mailbox).catch((error) => setStatus(String(error)));
              }}
              onEnqueueBackgroundTask={(kind, source) => { enqueueBackgroundTask(kind, source).catch((error) => setStatus(String(error))); }}
              onCancelOutboxItem={(item) => { cancelOutboxItem(item).catch((error) => setStatus(String(error))); }}
            />
            )}
            {activeSettingsSection === 'contacts' && (
            <ContactAutomationSettings
              mergeSuggestions={contactMergeSuggestions}
              contactForm={contactForm}
              contactFormAliases={contactFormAliases}
              contacts={managedContacts}
              editingContactId={editingContactId}
              editName={contactEditName}
              editAliases={contactEditAliases}
              mergeSourceContactId={mergeSourceContactId}
              transferBusy={contactTransferBusy}
              onContactFormChange={setContactForm}
              onContactFormAliasesChange={setContactFormAliases}
              onCreateContact={() => { createManagedContact().catch((error) => setStatus(String(error))); }}
              onMergeSuggested={(suggestion) => { mergeSuggestedContact(suggestion).catch((error) => setStatus(String(error))); }}
              onEditNameChange={setContactEditName}
              onEditAliasesChange={setContactEditAliases}
              onSaveContactOverride={(contact) => { saveContactOverride(contact).catch((error) => setStatus(String(error))); }}
              onCancelEdit={() => setEditingContactId(null)}
              onComposeToContact={composeToContact}
              onStartEditContact={startEditContact}
              onToggleContactVip={(contact) => { toggleContactVip(contact).catch((error) => setStatus(String(error))); }}
              onMergeContact={(contact) => { mergeManagedContact(contact).catch((error) => setStatus(String(error))); }}
              onDeleteContact={(contact) => { setContactToDeleteFromHook(contact); }}
              onMergeSourceChange={setMergeSourceContactId}
              onImportContacts={() => { importContactsVcard().catch((error) => setStatus(String(error))); }}
              onExportContacts={() => { exportContactsVcard().catch((error) => setStatus(String(error))); }}
            />
            )}
            {activeSettingsSection === 'rules' && (
            <RuleAutomationSettings
              ruleForm={ruleForm}
              ruleBuilderField={ruleBuilderField}
              ruleBuilderNeedle={ruleBuilderNeedle}
              editingRuleId={editingRuleId}
              rules={rules}
              labels={labels}
              onRuleFormChange={setRuleForm}
              onRuleConditionFieldChange={updateRuleConditionField}
              onRuleConditionValueChange={updateRuleConditionValue}
              onRuleLabelActionChange={updateRuleLabelAction}
              onToggleRuleAction={toggleRuleAction}
              onSaveRule={() => { saveRule().catch((error) => setStatus(String(error))); }}
              onToggleRule={(rule) => { toggleRule(rule).catch((error) => setStatus(String(error))); }}
              onEditRule={editRule}
              onRemoveRule={(rule) => { removeRule(rule); }}
            />
            )}
            {activeSettingsSection === 'security-preview' && (
            <SecurityPreviewSettings
              rawMessage={rawMessage}
              parsedPreview={parsedPreview}
              onRawMessageChange={setRawMessage}
              onParseRawMessage={parseRawMessage}
            />
            )}
          </SettingsFrame>
        </Suspense>
      )}
      {isShortcutsOpen && (
        <Suspense fallback={<DeferredSurface label="正在打开快捷键帮助" />}>
          <ShortcutHelpModal
            open
            onClose={() => setShortcutsOpen(false)}
          />
        </Suspense>
      )}
      <UndoSnackbarStack
        pendingSendUndo={pendingSendUndo}
        undoAction={undoAction}
        onUndoSend={() => {
          undoPendingSend().catch((error) => setStatus(String(error)));
        }}
        onDismissSend={() => setPendingSendUndo(null)}
        onUndoAction={() => {
          restoreUndoAction().catch((error) => setStatus(String(error)));
        }}
        onDismissAction={clearUndoAction}
      />
      <GlobalTooltip />
      {composerCloseConfirmOpen && (
        <div
          className="settings-cache-confirm-backdrop"
          style={{ zIndex: 10000 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setComposerCloseConfirmOpen(false);
            }
          }}
        >
          <section
            className="settings-cache-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="composer-close-confirm-title"
          >
            <header>
              <span className="settings-cache-confirm-mark" aria-hidden="true" style={{ background: '#e0f2fe', color: '#0284c7' }}>
                <Mail size={17} />
              </span>
              <span>
                <strong id="composer-close-confirm-title">关闭写信窗口</strong>
                <small>当前草稿有未保存的修改</small>
              </span>
              <button
                className="icon-only-action"
                type="button"
                title="关闭"
                aria-label="关闭确认"
                onClick={() => setComposerCloseConfirmOpen(false)}
              >
                <X size={16} />
              </button>
            </header>
            <div className="settings-cache-confirm-summary" style={{ background: '#f0f9ff', borderLeft: '3px solid #0ea5e9' }}>
              <span style={{ fontSize: '14px', color: '#0369a1', fontWeight: 'bold' }}>
                是否保留对当前邮件草稿的修改？
              </span>
            </div>
            <p>
              您可以选择将草稿保存至本地，以便下次在“草稿箱”中继续编辑，或者舍弃当前修改。
            </p>
            <footer>
              <button
                className="secondary"
                type="button"
                style={{ marginRight: 'auto' }}
                onClick={() => setComposerCloseConfirmOpen(false)}
              >
                继续编辑
              </button>
              <button
                className="secondary"
                type="button"
                style={{ borderColor: '#fca5a5', color: '#dc2626' }}
                onClick={() => {
                  setDraft(emptyDraft);
                  clearComposerAutosave();
                  forceCloseComposer();
                }}
              >
                舍弃草稿
              </button>
              <button
                className="primary"
                type="button"
                style={{ background: 'var(--ui-accent, #0a7aff)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', fontWeight: 'bold' }}
                onClick={async () => {
                  await saveDraft();
                  setComposerCloseConfirmOpen(false);
                }}
              >
                保存草稿
              </button>
            </footer>
          </section>
        </div>
      )}
      <ConfirmDialog
        open={!!confirmDeleteFolder}
        title="删除文件夹"
        summaryText={confirmDeleteFolder ? `确认删除自定义文件夹 "${confirmDeleteFolder.name}" 吗？` : ''}
        description="该操作不可逆。删除后文件夹内的邮件将被移回到收件箱中，以便保留邮件。"
        onConfirm={async () => {
          if (confirmDeleteFolder) {
            await deleteCustomFolderConfirmed(confirmDeleteFolder);
          }
          setConfirmDeleteFolder(null);
        }}
        onCancel={() => setConfirmDeleteFolder(null)}
      />
      <ConfirmDialog
        open={!!confirmDeleteIdentity}
        title="删除发件身份"
        summaryText={confirmDeleteIdentity ? `确认删除身份 "${confirmDeleteIdentity.name} <${confirmDeleteIdentity.email}>" 吗？` : ''}
        description="该操作不可逆。删除身份后您将不能再使用此身份写信，但不会删除该邮箱账号下的任何邮件。"
        onConfirm={async () => {
          if (confirmDeleteIdentity) {
            await deleteIdentityConfirmed(confirmDeleteIdentity);
          }
          setConfirmDeleteIdentity(null);
        }}
        onCancel={() => setConfirmDeleteIdentity(null)}
      />
      <ConfirmDialog
        open={!!confirmDeleteRule}
        title="删除规则"
        summaryText={confirmDeleteRule ? `确认删除邮件规则 "${confirmDeleteRule.name}" 吗？` : ''}
        description="该操作不可逆。删除后将不会再自动对新邮件执行此规则对应的分类动作。"
        onConfirm={async () => {
          if (confirmDeleteRule) {
            await removeRuleConfirmed(confirmDeleteRule);
          }
          setConfirmDeleteRule(null);
        }}
        onCancel={() => setConfirmDeleteRule(null)}
      />
      <ConfirmDialog
        open={!!contactToDeleteFromHook}
        title="删除联系人"
        summaryText={contactToDeleteFromHook ? `确认删除联系人 "${contactToDeleteFromHook.name || contactToDeleteFromHook.email}" 吗？` : ''}
        description="该操作不可逆。删除此联系人不会删除与该发件人的往来邮件，但会删除该联系人的备注、别名等数据。"
        onConfirm={async () => {
          if (contactToDeleteFromHook) {
            await deleteManagedContact(contactToDeleteFromHook);
          }
          setContactToDeleteFromHook(null);
        }}
        onCancel={() => setContactToDeleteFromHook(null)}
      />
      <ConfirmDialog
        open={!!confirmDeleteLabel}
        title="删除标签"
        summaryText={confirmDeleteLabel ? `确认删除标签 "${confirmDeleteLabel.name}" 吗？` : ''}
        description="该操作不可逆。删除该标签后，所有已归类到此标签的邮件将不再显示该标签标记，但邮件正文及其他分类属性仍会完整保留。"
        onConfirm={async () => {
          if (confirmDeleteLabel) {
            await handleDeleteLabelConfirmed(confirmDeleteLabel.id);
          }
          setConfirmDeleteLabel(null);
        }}
        onCancel={() => setConfirmDeleteLabel(null)}
      />
      <ConfirmDialog
        open={!!confirmEmptyTrashState}
        title="清空废纸篓"
        summaryText={confirmEmptyTrashState ? `确认要清空账号 "${confirmEmptyTrashState.accountName}" 的废纸篓吗？` : '确认要清空当前账号的废纸篓吗？'}
        description="此操作不可逆。废纸篓中所有已删除的邮件都将被永久从本地和服务器上删除，无法恢复。"
        onConfirm={async () => {
          if (confirmEmptyTrashState) {
            await emptyCurrentTrashConfirmed(confirmEmptyTrashState.accountId);
          }
          setConfirmEmptyTrashState(null);
        }}
        onCancel={() => setConfirmEmptyTrashState(null)}
      />
      <ConfirmDialog
        open={!!confirmPermanentlyDelete}
        title="永久删除邮件"
        summaryText={confirmPermanentlyDelete ? `确认要永久删除邮件 "${confirmPermanentlyDelete.subject || '(无主题)'}" 吗？` : '确认要永久删除选中的这封邮件吗？'}
        description="此操作不可逆。这封邮件将被直接从服务器及本地存储中彻底抹去，无法从废纸篓找回。"
        onConfirm={async () => {
          if (confirmPermanentlyDelete) {
            await permanentlyDeleteMessageConfirmed(confirmPermanentlyDelete);
          }
          setConfirmPermanentlyDelete(null);
        }}
        onCancel={() => setConfirmPermanentlyDelete(null)}
      />
      <div className="status-line status-live-region" role="status" aria-live="polite">{status}</div>
    </main>
  );
}
