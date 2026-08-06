import React, {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import './styles.css';
import Sidebar from './components/Sidebar';
import WindowChrome from './components/WindowChrome';
import MessageListPane, { type MessageContextAction, type BulkMessageAction } from './components/MessageListPane';
import ReaderPane from './components/ReaderPane';
import GlobalTooltip from './components/GlobalTooltip';
import ComposerCloseConfirmDialog from './components/ComposerCloseConfirmDialog';
import ConfirmationDialogs from './components/ConfirmationDialogs';
import ConfirmDialog from './components/ConfirmDialog';
import type { SettingsSectionId } from './components/settings/SettingsFrame';
import UndoSnackbarStack, { type PendingSendUndo } from './components/UndoSnackbarStack';
import MessageToastStack, { type MessageToast } from './components/MessageToastStack';
import useAppLayout from './hooks/useAppLayout';
import useAppShortcuts from './hooks/useAppShortcuts';
import useAccountConnectionController from './hooks/useAccountConnectionController';
import useBackgroundTaskCoordinator from './hooks/useBackgroundTaskCoordinator';
import useContactManagement from './hooks/useContactManagement';
import useMailboxData from './hooks/useMailboxData';
import useBulkMessageActions from './hooks/useBulkMessageActions';
import useOAuthFlow from './hooks/useOAuthFlow';
import useProviderWriteValidation from './hooks/useProviderWriteValidation';
import useUndoQueue from './hooks/useUndoQueue';
import useReaderActions from './hooks/useReaderActions';
import useAppGlobalEffects from './hooks/useAppGlobalEffects';
import useAppMetaLoader from './hooks/useAppMetaLoader';
import useComposerController from './hooks/useComposerController';
import useCredentialManagement from './hooks/useCredentialManagement';
import useFolderManagement from './hooks/useFolderManagement';
import useIdentityManagement from './hooks/useIdentityManagement';
import useLabelManagement from './hooks/useLabelManagement';
import useMailboxSelectionController from './hooks/useMailboxSelectionController';
import useMailboxNavigation from './hooks/useMailboxNavigation';
import useMailboxSearchController, { type MailboxSearchLoaders } from './hooks/useMailboxSearchController';
import useMailboxSync from './hooks/useMailboxSync';
import useRuleManagement from './hooks/useRuleManagement';
import useSnoozeController from './hooks/useSnoozeController';
import useMessageUndoActions from './hooks/useMessageUndoActions';
import useSelectedMessageActions from './hooks/useSelectedMessageActions';
import useSingleMessageActions from './hooks/useSingleMessageActions';
import useStorageManagement from './hooks/useStorageManagement';
import useTrashController from './hooks/useTrashController';
import {
  type NotificationPolicy,
} from './mailUtils';
import { getCurrentWindow, invoke, listen } from './tauriBridge';

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
  loadNotificationPolicy,
  loadSendUndoDelaySeconds,
  loadProviderVerifications,
  loadAccountScope,
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
import DeferredSurface from './components/DeferredSurface';
import SettingsOverlay from './components/settings/SettingsOverlay';
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
import { accountScopeStorageKey } from './app/storageConfig';

export default function App() {
  const [account, setAccount] = useState<Account | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountScope, setAccountScope] = useState<AccountScope>(loadAccountScope);
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
    filteredContacts,
    contactQuery,
    setContactQuery,
    startEditContact,
    createManagedContact,
    saveContactOverride,
    toggleContactVip,
    deleteManagedContact,
    mergeManagedContact,
    exportContactsVcard,
    refreshManagedContacts,
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
  const [messageToasts, setMessageToasts] = useState<MessageToast[]>([]);
  const messageToastIdRef = useRef(0);
  const showMessageToast = useCallback((text: string) => {
    const id = ++messageToastIdRef.current;
    setMessageToasts((current) => [...current, { id, text }]);
    window.setTimeout(() => {
      setMessageToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3000);
  }, []);
  const {
    loadMeta,
    releaseDueSnoozedMessages,
    refreshUnreadIndicators,
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
    readerSelectedDetail,
    readerDisplayedId,
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
    attachmentsLoaded,
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
  useAppGlobalEffects({
    notificationPolicy,
    sendUndoDelaySeconds,
    providerVerifications,
    folderId,
    mailboxListStateKey,
    messageLimit,
  });
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
    showToast: showMessageToast,
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
    setFolders,
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
  const {
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
  } = useMailboxNavigation({
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
  });
  function prepareProviderWriteValidation() {
    const validationDraft = createValidationDraft();
    if (!validationDraft) return;
    setSettingsOpen(false);
    setRichComposer(false);
    openComposer(validationDraft);
    setStatus('验证草稿已生成；请检查收件人并按需添加小附件，只有手动点击发送才会真实发信');
  }

  useEffect(() => {
    skipNextFolderEffectLoadRef.current = true;
    refreshMailbox(accountScope, null)
      .catch((error) => {
        if (typeof accountScope === 'number') {
          // 上次记住的账号可能已被删除，回退到统一邮箱视图
          setAccountScope('all');
          return;
        }
        setStatus(String(error));
      })
      .finally(() => {
        skipNextFolderEffectLoadRef.current = false;
      });
  }, [accountScope]);

  useEffect(() => {
    window.localStorage.setItem(accountScopeStorageKey, String(accountScope));
  }, [accountScope]);

  useEffect(() => {
    const scopeRef: { current: AccountScope } = { current: accountScope };
    const syncIndicators = () => {
      void refreshUnreadIndicators(scopeRef.current);
    };
    syncIndicators();
    const unlistenPromise = Promise.resolve(
      getCurrentWindow().onFocusChanged?.(syncIndicators),
    ).catch(() => () => undefined);
    return () => {
      void unlistenPromise.then((unlisten) => unlisten?.());
    };
  }, [refreshUnreadIndicators]);

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
  const selectedAccount = useMemo(
    () => accounts.find((item) => item.id === readerSelectedDetail?.account_id) ?? null,
    [accounts, readerSelectedDetail?.account_id],
  );
  const selectedSenderIsExternal = useMemo(() => {
    const accountDomain = (selectedAccount?.email.split('@')[1] ?? '').trim().toLowerCase();
    const senderDomainValue = selectedSenderDomain.trim().toLowerCase();
    return Boolean(accountDomain && senderDomainValue && senderDomainValue !== accountDomain);
  }, [selectedAccount?.email, selectedSenderDomain]);
  const selectedExternalBlocked = Boolean(
    selectedAccount?.block_external_mailboxes && selectedSenderIsExternal,
  );
  const selectedInterceptsHttps = selectedAccount?.intercept_https_links !== false;

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


  const {
    isRefreshing,
    refreshNotice,
    refreshAll,
    syncAndRefresh,
  } = useMailboxSync({
    folderId,
    accountScope,
    searchScope,
    query,
    filter,
    messageLimit,
    mailboxListStateKey,
    activeThread,
    mailboxRefreshRef,
    loadMeta: (nextFolderId, nextScope, options) => loadMeta(nextFolderId, nextScope, options),
    loadMessagesWithVisibleFallback,
    openThread,
    setSyncRuns,
    setStatus,
  });

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
    requestSend,
    confirmSendRisk,
    sendRiskConfirm,
    setSendRiskConfirm,
    crossAccountRisks,
    composerContextAccountId,
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
    showToast: showMessageToast,
    loadMeta: (nextFolderId?: number | null) => loadMeta(nextFolderId, accountScope, { mode: 'mailbox' }),
    refreshAll,
    focusMailboxRole,
  });

  useEffect(() => {
    let active = true;
    const unlisteners: Array<() => void> = [];

    async function registerTrayListeners() {
      try {
        const unlistenCompose = await listen('tray://compose', () => {
          if (!active) return;
          setRichComposer(false);
          openComposer(emptyDraft);
          setStatus('已打开新邮件');
        });
        unlisteners.push(unlistenCompose);

        const unlistenSync = await listen('tray://sync', () => {
          if (!active) return;
          syncAndRefresh().catch((error) => setStatus(String(error)));
        });
        unlisteners.push(unlistenSync);

        const unlistenUnread = await listen('tray://open-unread', () => {
          if (!active) return;
          const inboxFolder = folders.find((f) => f.role === 'inbox');
          if (inboxFolder) {
            setFolderId(inboxFolder.id);
          }
          setActiveThread(null);
          setThreadMessages([]);
          setListMode('messages');
          setFilter('unread');
        });
        unlisteners.push(unlistenUnread);

        const unlistenSettings = await listen('tray://settings', () => {
          if (!active) return;
          setSettingsOpen(true);
        });
        unlisteners.push(unlistenSettings);
      } catch (error) {
        console.error('Failed to register tray listeners:', error);
      }
    }

    void registerTrayListeners();

    return () => {
      active = false;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [openComposer, syncAndRefresh, folders, setFilter, setListMode, setFolderId, setActiveThread, setThreadMessages, setSettingsOpen, setRichComposer, setStatus]);

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
  } = useBulkMessageActions({
    folders,
    selectedMessages,
    refreshAll,
    setActiveThread,
    setSelectedMessageIds,
    setStatus,
    snapshotMessages,
    queueUndoAction,
    onReadStateChange: rememberManualReadState,
  });
  const {
    restoreUndoAction,
    moveMessagesToFolderByIds,
  } = useMessageUndoActions({
    folders,
    selectedId,
    messages,
    labels,
    folderId,
    refreshAll,
    loadMeta: (nextFolderId) => loadMeta(nextFolderId, accountScope, { mode: 'mailbox' }),
    loadMessages: (nextFolderId) => loadMessages(nextFolderId),
    setSelectedMessageIds,
    setSelectedId,
    setStatus,
    snapshotMessages,
    queueUndoAction,
    consumeUndoAction,
    visibleFolderIdForRole,
  });
  const {
    runMessageAction,
    moveMessageToFolder,
    toggleMessageLabel,
    toggleRead,
    toggleStar,
  } = useSingleMessageActions({
    folders,
    selected,
    refreshAll,
    setSelectedId,
    setStatus,
    snapshotMessages,
    queueUndoAction,
    onReadStateChange: rememberManualReadState,
    clearSelectedDetailIf,
    patchSelectedDetailMetadata,
    onRequestSnooze: requestSnooze,
    onRequestPermanentDelete: requestPermanentlyDeleteMessage,
  });
  const {
    moveSelected,
    moveSelectedToFolder,
    markSelectedAsSpam,
    markSelectedNotSpam,
    restoreSelectedFromTrash,
    permanentlyDeleteMessageConfirmed,
    unsnoozeSelected,
    toggleLabel,
  } = useSelectedMessageActions({
    selected,
    folders,
    labels,
    folderId,
    refreshAll,
    loadMeta: (nextFolderId) => loadMeta(nextFolderId, accountScope, { mode: 'mailbox' }),
    loadMessages: (nextFolderId) => loadMessages(nextFolderId),
    setSelectedId,
    setStatus,
    snapshotMessages,
    queueUndoAction,
    clearSelectedDetailIf,
    patchSelectedDetailMetadata,
    visibleFolderIdForRole,
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

  const [shellWidth, setShellWidth] = useState<number>(() => window.innerWidth);
  useEffect(() => {
    const handleResize = () => setShellWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isCompactShell = shellWidth <= 1180;
  const shellColumns = isCompactShell
    ? '200px 320px minmax(0, 1fr)'
    : `${appLayout.sidebar}px 5px ${appLayout.list}px 5px minmax(0, 1fr)`;
  const sidebarWidth = isCompactShell ? 200 : appLayout.sidebar;

  return (
    <main
      className="app-shell"
      style={{
        gridTemplateColumns: shellColumns,
        '--app-sidebar-width': `${sidebarWidth}px`,
      } as React.CSSProperties}
      onPointerMove={moveLayoutResize}
      onPointerUp={endLayoutResize}
      onPointerCancel={endLayoutResize}
      onMouseMove={moveLayoutMouseResize}
      onMouseUp={endLayoutMouseResize}
      onMouseLeave={endLayoutMouseResize}
    >
      <WindowChrome />
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
        onSaveCurrentSearch={() => saveCurrentSearch(query, filter, searchScope)}
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
        selectedId={readerDisplayedId}
        activeSelectedId={selectedId}
        attachmentsLoaded={attachmentsLoaded}
        readTriggerKey={readerSelectionRevision}
        accountScope={accountScope}
        folders={folders}
        labels={labels}
        attachments={attachments}
        selectedSenderTrusted={selectedSenderTrusted}
        selectedSenderDomain={selectedSenderDomain}
        selectedHasRemoteImageWarning={selectedHasRemoteImageWarning}
        selectedSenderIsExternal={selectedSenderIsExternal}
        selectedExternalBlocked={selectedExternalBlocked}
        selectedInterceptsHttps={selectedInterceptsHttps}
        onOpenHttpsLink={(href) => {
          invoke('open_url', { url: href }).catch((error) => setStatus(String(error)));
        }}
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
          onSendDraft={() => { requestSend().catch((error) => setStatus(String(error))); }}
          onSendRiskConfirm={confirmSendRisk}
          onSendRiskCancel={() => setSendRiskConfirm(null)}
          sendRiskConfirm={sendRiskConfirm}
          crossAccountRisks={crossAccountRisks}
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
        <SettingsOverlay
          accountForm={accountForm}
          accounts={accounts}
          newAccountForm={newAccountForm}
          activeSettingsSection={activeSettingsSection}
          accountSettingsDirty={accountSettingsDirty}
          accountSettingsSaving={accountSettingsSaving}
          saveAndVerifyRunning={saveAndVerifyRunning}
          saveAndVerifyReport={saveAndVerifyReport}
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
          connectionReport={connectionReport}
          credentialVerification={credentialVerification}
          providerValidationReport={providerValidationReport}
          providerValidationRunning={providerValidationRunning}
          credentialSecret={credentialSecret}
          credentialStatus={credentialStatus}
          notificationPolicy={notificationPolicy}
          sendUndoDelaySeconds={sendUndoDelaySeconds}
          remoteImageTrusts={remoteImageTrusts}
          identities={identities}
          identityForm={identityForm}
          diagnosticExport={diagnosticExport}
          localBackupSummary={localBackupSummary}
          storageUsage={storageUsage}
          storageBusy={storageBusy}
          imapProbe={imapProbe}
          syncSchedulePlan={syncSchedulePlan}
          imapMailboxes={imapMailboxes}
          folders={folders}
          syncRuns={syncRuns}
          outbox={outbox}
          labels={labels}
          rules={rules}
          ruleForm={ruleForm}
          ruleBuilderField={ruleBuilderField}
          ruleBuilderNeedle={ruleBuilderNeedle}
          editingRuleId={editingRuleId}
          rawMessage={rawMessage}
          parsedPreview={parsedPreview}
          contactForm={contactForm}
          contactFormAliases={contactFormAliases}
          contacts={managedContacts}
          editingContactId={editingContactId}
          contactEditName={contactEditName}
          contactEditAliases={contactEditAliases}
          mergeSourceContactId={mergeSourceContactId}
          contactTransferBusy={contactTransferBusy}
          providerWriteValidationStatus={providerWriteValidationStatus}
          providerWriteValidationLoading={providerWriteValidationLoading}
          providerWritebackValidationProgress={providerWritebackValidationProgress}
          setStatus={setStatus}
          onNavigate={scrollSettingsSection}
          onClose={() => {
            resetSaveAndVerifyReport();
            setSettingsOpen(false);
          }}
          onTestConnection={() => {
            if (!accountForm) {
              setStatus('请先添加邮箱账号');
              return;
            }
            testConnection().catch((error) => setStatus(String(error)));
          }}
          onSave={() => {
            if (!accountForm) {
              setStatus('请先添加邮箱账号');
              return;
            }
            saveSettings()
              .then((saved) => {
                if (saved && selected && selected.account_id === saved.id) {
                  renderSelectedWithRemoteImagePolicy(selected.id).catch(() => undefined);
                }
              })
              .catch((error) => setStatus(String(error)));
          }}
          onSaveAndVerify={accountForm ? () => {
            saveAndVerify().catch((error) => setStatus(String(error)));
          } : undefined}
          onAccountFormChange={setAccountForm}
          onSelectAccount={(next) => {
            setAccountForm(next);
            invoke<RemoteImageTrust[]>('list_remote_image_trusts', { accountId: next.id })
              .then(setRemoteImageTrusts)
              .catch((error) => setStatus(String(error)));
          }}
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
          onRemoveAccount={(deleteSecret) => removeCurrentAccount(deleteSecret)}
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
          onNotificationPolicyChange={setNotificationPolicy}
          onSendUndoDelayChange={setSendUndoDelaySeconds}
          onDeleteRemoteImageTrust={deleteRemoteImageTrust}
          onIdentityFormChange={setIdentityForm}
          onEditIdentity={editIdentity}
          onDeleteIdentity={deleteIdentity}
          onSaveIdentity={() => { saveIdentity().catch((error) => setStatus(String(error))); }}
          onExportDiagnostics={() => { exportDiagnostics().catch((error) => setStatus(String(error))); }}
          onImportEml={() => { importEmlFile().catch((error) => setStatus(String(error))); }}
          onPreviewBackup={() => { previewLocalBackup().catch((error) => setStatus(String(error))); }}
          onImportBackup={() => { importLocalBackup().catch((error) => setStatus(String(error))); }}
          onExportBackup={() => { exportLocalBackup().catch((error) => setStatus(String(error))); }}
          onRefreshStorage={() => refreshStorageUsage()}
          onClearAttachmentCache={() => clearAttachmentCache()}
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
          onContactFormChange={setContactForm}
          onContactFormAliasesChange={setContactFormAliases}
          filteredContacts={filteredContacts}
          contactQuery={contactQuery}
          onContactQueryChange={setContactQuery}
          onCreateContact={() => { createManagedContact().catch((error) => setStatus(String(error))); }}
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
          onExportContacts={() => { exportContactsVcard().catch((error) => setStatus(String(error))); }}
          onRefreshContacts={refreshManagedContacts}
          onStatus={setStatus}
          onRuleFormChange={setRuleForm}
          onRuleConditionFieldChange={updateRuleConditionField}
          onRuleConditionValueChange={updateRuleConditionValue}
          onRuleLabelActionChange={updateRuleLabelAction}
          onToggleRuleAction={toggleRuleAction}
          onSaveRule={() => { saveRule().catch((error) => setStatus(String(error))); }}
          onToggleRule={(rule) => { toggleRule(rule).catch((error) => setStatus(String(error))); }}
          onEditRule={editRule}
          onRemoveRule={(rule) => { removeRule(rule); }}
          onRawMessageChange={setRawMessage}
          onParseRawMessage={parseRawMessage}
        />
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
        undoAction={undoAction}
        onUndoAction={() => {
          restoreUndoAction().catch((error) => setStatus(String(error)));
        }}
        onDismissAction={clearUndoAction}
      />
      <MessageToastStack
        toasts={messageToasts}
        pendingSendUndo={pendingSendUndo}
        onUndoSend={() => {
          undoPendingSend().catch((error) => setStatus(String(error)));
        }}
        onDismissSend={() => setPendingSendUndo(null)}
      />
      <GlobalTooltip />
      {composerCloseConfirmOpen && (
        <ComposerCloseConfirmDialog
          setOpen={setComposerCloseConfirmOpen}
          onClose={() => setComposerCloseConfirmOpen(false)}
          onDiscard={() => {
            setDraft(emptyDraft);
            clearComposerAutosave();
            forceCloseComposer();
          }}
          onSaveDraft={saveDraft}
        />
      )}
      <ConfirmationDialogs
        confirmDeleteFolder={confirmDeleteFolder}
        confirmDeleteIdentity={confirmDeleteIdentity}
        confirmDeleteRule={confirmDeleteRule}
        confirmDeleteContact={contactToDeleteFromHook}
        confirmDeleteLabel={confirmDeleteLabel}
        confirmEmptyTrashState={confirmEmptyTrashState}
        confirmPermanentlyDelete={confirmPermanentlyDelete}
        setConfirmDeleteFolder={setConfirmDeleteFolder}
        setConfirmDeleteIdentity={setConfirmDeleteIdentity}
        setConfirmDeleteRule={setConfirmDeleteRule}
        setConfirmDeleteContact={setContactToDeleteFromHook}
        setConfirmDeleteLabel={setConfirmDeleteLabel}
        setConfirmEmptyTrashState={setConfirmEmptyTrashState}
        setConfirmPermanentlyDelete={setConfirmPermanentlyDelete}
        onDeleteFolderConfirmed={deleteCustomFolderConfirmed}
        onDeleteIdentityConfirmed={deleteIdentityConfirmed}
        onDeleteRuleConfirmed={removeRuleConfirmed}
        onDeleteContactConfirmed={deleteManagedContact}
        onDeleteLabelConfirmed={handleDeleteLabelConfirmed}
        onEmptyTrashConfirmed={emptyCurrentTrashConfirmed}
        onPermanentlyDeleteConfirmed={permanentlyDeleteMessageConfirmed}
      />
      <div className="status-line status-live-region" role="status" aria-live="polite">{status}</div>
    </main>
  );
}
