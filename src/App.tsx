import React, {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Sidebar from './components/Sidebar';
import AppTitlebar from './components/AppTitlebar';
import MessageListPane, { type MessageContextAction, type BulkMessageAction } from './components/MessageListPane';
import ReaderPane from './components/ReaderPane';
import GlobalTooltip from './components/GlobalTooltip';
import AppErrorBoundary from './components/AppErrorBoundary';
import type { SettingsSectionId } from './components/settings/SettingsFrame';
import type { PendingSendUndo } from './components/UndoSnackbarStack';
import type { MessageToast } from './components/MessageToastStack';
import useAppLayout, { APP_LAYOUT_BOUNDS } from './hooks/useAppLayout';
import { logError } from './app/logger';
import useAppShortcuts from './hooks/useAppShortcuts';
import useAccountConnectionController from './hooks/useAccountConnectionController';
import useBackgroundTaskCoordinator from './hooks/useBackgroundTaskCoordinator';
import useContactManagement from './hooks/useContactManagement';
import useMailboxData from './hooks/useMailboxData';
import useMailboxBootstrap from './hooks/useMailboxBootstrap';
import useBulkMessageActions from './hooks/useBulkMessageActions';
import useOAuthFlow from './hooks/useOAuthFlow';
import useProviderWriteValidation from './hooks/useProviderWriteValidation';
import useUndoQueue from './hooks/useUndoQueue';
import useReaderActions from './hooks/useReaderActions';
import useAppGlobalEffects from './hooks/useAppGlobalEffects';
import useAppMetaLoader from './hooks/useAppMetaLoader';
import useUnreadFocusSync from './hooks/useUnreadFocusSync';
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
import useThemeMode from './hooks/useThemeMode';
import useAutoHideScrollbars from './hooks/useAutoHideScrollbars';
import {
  type NotificationPolicy,
} from './mailUtils';
import { invoke, listen } from './tauriBridge';
import type {
  AccountScope,
  Account,
  AccountCreateInput,
  Folder,
  Label,
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
  SyncSchedulePlan,
  ParsedMessagePreview,
  MailRule,
  ThreadSummary,
  OutboxItem,
  CredentialStatus,
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
  emptyAccountCreateForm,
} from './app/appConfig';
import type {
  SendUndoDelaySeconds,
} from './app/appConfig';
import { buildMailboxContextKey } from './app/mailboxContext';
import { buildTitlebarViewSummary } from './app/titlebarSummary';
import { openUnreadInbox } from './app/trayActions';
import './ui-2026.css';

const ComposerWindow = lazy(() => import('./components/ComposerWindow'));
const SnoozePicker = lazy(() => import('./components/SnoozePicker'));
import DeferredSurface from './components/DeferredSurface';
const SettingsOverlay = lazy(() => import('./components/settings/SettingsOverlay'));
const ShortcutHelpModal = lazy(() => import('./components/ShortcutHelpModal'));
const FirstRunOnboarding = lazy(() => import('./components/FirstRunOnboarding'));
const AccountLoginDialog = lazy(() => import('./components/AccountLoginDialog'));
const ComposerCloseConfirmDialog = lazy(() => import('./components/ComposerCloseConfirmDialog'));
const ConfirmationDialogs = lazy(() => import('./components/ConfirmationDialogs'));
const UndoSnackbarStack = lazy(() => import('./components/UndoSnackbarStack'));
const MessageToastStack = lazy(() => import('./components/MessageToastStack'));
const NARROW_SHELL_MEDIA_QUERY = '(max-width: 1040px)';

import {
  buildMailboxListStateKey,
  loadMailboxListStates,
  saveMailboxListState,
} from './app/mailboxListState';
import { accountScopeStorageKey } from './app/storageConfig';
import { IPC } from './ipc/commands';

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
  // 导航动作（focusMailboxRole/locateProviderWriteValidation）主动切换账号 scope
  // 时，由导航动作自己驱动加载；accountScope effect 读到这个标记就跳过 refreshMailbox，
  // 避免两个异步流程并发写 folderId/messages 造成「先导航后刷新覆盖」竞态。
  const navigationScopeClaimRef = useRef<number | 'all' | null>(null);
  const [activeThread, setActiveThread] = useState<ThreadSummary | null>(null);
  const [threadMessages, setThreadMessages] = useState<MessageSummary[]>([]);
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const [isShortcutsOpen, setShortcutsOpen] = useState(false);
  const [narrowView, setNarrowView] = useState<'sidebar' | 'list' | 'reader'>('list');
  const themeMode = useThemeMode();
  useAutoHideScrollbars();
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSectionId>('accounts');
  const [status, setStatus] = useState('本地原型已就绪');
  const [composerSendProgress, setComposerSendProgress] = useState<number | null>(null);
  const [composerSendProgressMessage, setComposerSendProgressMessage] = useState<string | null>(null);
  const [composerAttachmentProgress, setComposerAttachmentProgress] = useState<number | null>(null);
  const [initialAccountListLoaded, setInitialAccountListLoaded] = useState(false);
  const [isAccountLoginProvisioning, setAccountLoginProvisioning] = useState(false);
  const needsAccountLogin = initialAccountListLoaded && accounts.length === 0;
  const isAccountLoginActive = needsAccountLogin || isAccountLoginProvisioning;
  // 仅对「新完成登录且尚未完成首次引导」的账号展示引导。
  const pendingOnboardingAccount = useMemo(
    () => (account && !account.onboarding_completed ? account : null),
    [account],
  );
  // 登录遮罩或首次引导期间，应用整体进入门禁状态：
  // 快捷键、托盘命令、写邮件、切换账号、设置都不能穿透。
  const isModalGateActive = isAccountLoginActive || Boolean(pendingOnboardingAccount);
  const mailboxRefreshRef = useRef(0);
  const searchLoadersRef = useRef<MailboxSearchLoaders | null>(null);
  const {
    queryDraft,
    appliedQuery,
    setQuery,
    searchScope,
    filter,
    setFilter,
    listMode,
    setListMode,
    listSort,
    setListSort,
    savedSearches,
    savedSearchName,
    setSavedSearchName,
    messageLimit,
    setMessageLimit,
    hasMoreMessages,
    setHasMoreMessages,
    loadMoreStatus,
    loadAllMessages,
    searchInputRef,
    runSearch,
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
  const [isSelectingAllMessages, setIsSelectingAllMessages] = useState(false);
  const selectAllRequestRef = useRef(0);
  const [confirmPermanentlyDelete, setConfirmPermanentlyDelete] = useState<MessageSummary | null>(null);
  const [, setBackgroundSyncStatus] = useState('后台同步待机');
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
    adjustAppLayout,
    resetAppLayoutPane,
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
  const showMessageToast = useCallback((text: string, tone: MessageToast['tone'] = 'success') => {
    const id = ++messageToastIdRef.current;
    setMessageToasts((current) => [...current, { id, text, tone }]);
    window.setTimeout(() => {
      setMessageToasts((current) => current.filter((toast) => toast.id !== id));
    }, tone === 'error' ? 5000 : 3000);
  }, []);
  const lastVisualStatusRef = useRef(status);
  useEffect(() => {
    if (lastVisualStatusRef.current === status) return;
    lastVisualStatusRef.current = status;
    if (!/(?:^Error:|失败|错误|出错|无法|不能|被拒绝|超时|请先|尚未配置|不存在)/i.test(status)) return;
    showMessageToast(status.replace(/^Error:\s*/i, ''), 'error');
  }, [showMessageToast, status]);
  const {
    loadMeta,
    releaseDueSnoozedMessages,
    refreshUnreadIndicators,
    maybeRunBenchmarkSync,
  } = useAppMetaLoader({
    folderId,
    accountScope,
    mailboxRefreshRef,
    setAccounts,
    setAccount,
    setAccountForm,
    setFolders,
    setLabels,
    setStats,
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
    onAccountListLoaded: () => setInitialAccountListLoaded(true),
  });
  const mailboxContextKey = useMemo(
    () => buildMailboxContextKey({ accountScope, folderId, query: appliedQuery, filter, listMode }),
    [accountScope, folderId, appliedQuery, filter, listMode],
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
    markMessageReadAfterReading,
    updateDetailCache,
    attachmentsLoaded,
    bodyFetchFailedRef,
    bodyFetchInFlightRef,
    bodyFetchState,
    markBodyFetchStarted,
    markBodyFetchSucceeded,
    markBodyFetchFailed,
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
    query: appliedQuery,
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
      query: appliedQuery,
      filter,
      searchScope,
      listSort,
    }),
    [accountScope, folderId, appliedQuery, filter, searchScope, listSort],
  );
  useAppGlobalEffects({
    notificationPolicy,
    sendUndoDelaySeconds,
    providerVerifications,
    folderId,
    mailboxListStateKey,
    messageLimit,
  });
  const {
    enqueueBackgroundTask,
    enqueueManualSync,
    enqueueAccountInitialSync,
  } = useBackgroundTaskCoordinator({
    account,
    accountScope,
    mailboxRefreshRef,
    folderId,
    query: appliedQuery,
    filter,
    messages,
    outbox,
    notificationPolicy,
    setOutbox,
    setBackgroundTasks,
    setBackgroundSyncStatus,
    setSyncSchedulePlan,
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
    query: appliedQuery,
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
    setStatus,
    onAccountCreated: (created) => {
      // 凭据验证通过：登录遮罩立即关闭；首次同步转入绑定该账号的后台任务，
      // 与首次引导并行执行，失败可重试，且不会写入其他账号的界面。
      enqueueAccountInitialSync(created.id).catch((error) => {
        setStatus(`首次同步入队失败：${String(error)}，可在侧边栏手动同步`);
      });
    },
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
    navigationScopeClaimRef,
  });
  function prepareProviderWriteValidation() {
    const validationDraft = createValidationDraft();
    if (!validationDraft) return;
    setSettingsOpen(false);
    setRichComposer(true);
    openComposer(validationDraft);
    setStatus('验证草稿已生成；请检查收件人并按需添加小附件，只有手动点击发送才会真实发信');
  }

  useMailboxBootstrap({
    accountScope,
    folderId,
    appliedQuery,
    filter,
    listSort,
    mailboxListStateKey,
    mailboxRefreshRef,
    navigationScopeClaimRef,
    skipNextFolderEffectLoadRef,
    refreshMailbox,
    loadMessages,
    setAccountScope,
    setStatus,
  });

  useEffect(() => {
    window.localStorage.setItem(accountScopeStorageKey, String(accountScope));
  }, [accountScope]);

  // 焦点监听：只在挂载与账号 scope 切换时订阅，聚焦时刷新未读角标/托盘。
  // refreshUnreadIndicators 是稳定 useCallback，任何无关渲染都不会重新订阅或触发 GetStats。
  useUnreadFocusSync(refreshUnreadIndicators, accountScope);

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
  const titlebarViewSummary = buildTitlebarViewSummary(listMode, stats, threads.length);
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
  const selectedWarnExternalSender = Boolean(
    selectedAccount?.warn_external_senders && selectedSenderIsExternal && !selectedExternalBlocked,
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
    onBodyFetchStart: markBodyFetchStarted,
    onBodyFetchSuccess: markBodyFetchSucceeded,
    onBodyFetchError: markBodyFetchFailed,
  });

  useEffect(() => {
    if (!isSettingsOpen || activeSettingsSection !== 'backup') return;
    refreshStorageUsage(false).catch((error) => setStatus(String(error)));
    refreshAppSettings().catch((error) => setStatus(String(error)));
  }, [isSettingsOpen, activeSettingsSection]);


  const {
    isRefreshing,
    refreshNotice,
    refreshAll,
  } = useMailboxSync({
    folderId,
    accountScope,
    searchScope,
    query: appliedQuery,
    filter,
    messageLimit,
    mailboxListStateKey,
    activeThread,
    mailboxRefreshRef,
    loadMeta: (nextFolderId, nextScope, options) => loadMeta(nextFolderId, nextScope, options),
    loadMessagesWithVisibleFallback,
    openThread,
    setStatus,
  });

  const isBackgroundSyncRunning = backgroundTasks.some((task) => (
    task.kind === 'sync' && (task.status === 'queued' || task.status === 'running')
  ));

  const {
    draft,
    setDraft,
    quickReplyBody,
    setQuickReplyBody,
    isRichComposer,
    setRichComposer,
    composeTemplates,
    templateName,
    setTemplateName,
    composerAutosave,
    isComposerOpen,
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
    buildInlineImageAttachments,
    addInlineImages,
    handleComposerAttachmentDrop,
    handleComposerAttachmentPaste,
    handleComposerAttachmentDragOver,
    handleComposerAttachmentDragEnter,
    handleComposerAttachmentDragLeave,
    removeDraftAttachment,
    composeFromMessage,
    editDraftMessage,
    saveDraft,
    requestSend,
    confirmSendRisk,
    sendRiskConfirm,
    setSendRiskConfirm,
    crossAccountRisks,
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
    setSendProgress: setComposerSendProgress,
    setSendProgressMessage: setComposerSendProgressMessage,
    setAttachmentProgress: setComposerAttachmentProgress,
  });

  useEffect(() => {
    let active = true;
    const unlisteners: Array<() => void> = [];

    async function registerTrayListeners() {
      try {
        const unlistenCompose = await listen('tray://compose', () => {
          if (!active || isModalGateActive) return;
          setRichComposer(true);
          openComposer(emptyDraft);
          setStatus('已打开新邮件');
        });
        unlisteners.push(unlistenCompose);

        const unlistenSync = await listen('tray://sync', () => {
          if (!active || isModalGateActive) return;
          enqueueManualSync().catch((error) => setStatus(String(error)));
        });
        unlisteners.push(unlistenSync);

        const unlistenUnread = await listen('tray://open-unread', () => {
          if (!active || isModalGateActive) return;
          // 统一导航入口：清空搜索词、恢复 folder 范围、清空线程/选择状态，
          // 再切到收件箱未读视图，确保真正加载收件箱未读结果而非残留搜索。
          openUnreadInbox({
            folders,
            resetSearch,
            setFilter,
            setFolderId,
            setActiveThread,
            setThreadMessages,
            setSelectedId,
            setSelectedMessageIds,
          });
        });
        unlisteners.push(unlistenUnread);

        const unlistenSettings = await listen('tray://settings', () => {
          if (!active || isModalGateActive) return;
          setSettingsOpen(true);
        });
        unlisteners.push(unlistenSettings);
      } catch (error) {
        logError('Failed to register tray listeners:', error);
      }
    }

    void registerTrayListeners();

    return () => {
      active = false;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [openComposer, enqueueManualSync, folders, setFilter, setFolderId, setActiveThread, setThreadMessages, setSettingsOpen, setRichComposer, setStatus, isModalGateActive, resetSearch, setSelectedId, setSelectedMessageIds]);

  const toggleMessageSelection = useCallback((messageId: number, checked: boolean) => {
    setSelectedMessageIds((current) => {
      if (checked) return current.includes(messageId) ? current : [...current, messageId];
      return current.filter((id) => id !== messageId);
    });
  }, []);

  const toggleAllVisibleMessages = useCallback((checked: boolean) => {
    const requestId = selectAllRequestRef.current + 1;
    selectAllRequestRef.current = requestId;
    if (!checked) {
      setSelectedMessageIds([]);
      setIsSelectingAllMessages(false);
      return;
    }

    const refreshId = mailboxRefreshRef.current;
    setIsSelectingAllMessages(true);
    void loadAllMessages()
      .then((allMessages) => {
        if (requestId !== selectAllRequestRef.current || refreshId !== mailboxRefreshRef.current) return;
        setSelectedMessageIds([...new Set(allMessages.map((message) => message.id))]);
      })
      .catch((error) => {
        if (requestId === selectAllRequestRef.current) setStatus(String(error));
      })
      .finally(() => {
        if (requestId === selectAllRequestRef.current) setIsSelectingAllMessages(false);
      });
  }, [loadAllMessages, mailboxRefreshRef, setStatus]);

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
    messages,
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
    ruleBuilderNeedle,
    editingRuleId,
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
    appSettings,
    downloadDirBusy,
    downloadDirError,
    exportDiagnostics,
    exportLocalBackup,
    previewLocalBackup,
    importLocalBackup,
    refreshStorageUsage,
    clearAttachmentCache,
    refreshAppSettings,
    pickDownloadDir,
    resetDownloadDir,
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
    const imported = await invoke<Message | null>(IPC.ImportEmlFile, {
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
    await invoke(IPC.DeleteRemoteImageTrust, { trustId: trust.id });
    setRemoteImageTrusts((current) => current.filter((item) => item.id !== trust.id));
    if (selected?.account_id === trust.account_id) {
      await renderSelectedWithRemoteImagePolicy(selected.id);
    }
    setStatus(`已移除远程图片信任：${trust.value}`);
  }

  async function parseRawMessage() {
    const preview = await invoke<ParsedMessagePreview>(IPC.ParseRawMessage, {
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
    isAccountLoginRequired: isModalGateActive,
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
      setRichComposer(true);
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
    enqueueManualSync().catch((error) => setStatus(String(error)));
  }, [enqueueManualSync, setStatus]);

  // 首次引导的所有保存回调显式绑定引导账号 ID：
  // 即使后台状态切换，也不能把设置误写到另一个账号。
  const handleOnboardingAccountPatch = useCallback(async (accountId: number, patch: Partial<Account>) => {
    const updated = await invoke<Account>(IPC.UpdateAccountSettings, {
      accountId,
      input: { ...accounts.find((item) => item.id === accountId) ?? account, ...patch },
    });
    setAccount(updated);
    setAccountForm(updated);
    setAccounts((current) => current.map((item) => (item.id === updated.id ? updated : item)));
  }, [account, accounts, setAccount, setAccountForm, setAccounts]);

  const completeOnboarding = useCallback(async (accountId: number) => {
    const updated = await invoke<Account>(IPC.SetAccountOnboardingCompleted, {
      accountId,
      completed: true,
    });
    setAccount(updated);
    setAccountForm(updated);
    setAccounts((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setStatus('首次引导已完成，可随时在设置页调整');
  }, [setAccount, setAccountForm, setAccounts, setStatus]);

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
    return loadMoreMessages().catch((error) => {
      setStatus(String(error));
      return [];
    });
  }, [loadMoreMessages, setStatus]);

  const handleOpenHttpsLink = useCallback((href: string) => {
    invoke(IPC.OpenUrl, { url: href }).catch((error) => setStatus(String(error)));
  }, [setStatus]);

  const handleComposeNew = useCallback((fields: { to?: string; cc?: string; bcc?: string; subject?: string; body?: string } | undefined) => {
    setRichComposer(true);
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
  }, [account, accounts, openComposer, setStatus]);

  const handleRunActiveThreadAction = useCallback((action: BulkMessageAction) => {
    if (!activeThread) return;
    runThreadAction(activeThread, threadMessages, action).catch((error) => setStatus(String(error)));
  }, [activeThread, threadMessages, runThreadAction, setStatus]);

  const handleMoveActiveThreadToFolder = useCallback((folder: Folder) => {
    if (!activeThread) return;
    moveThreadToFolder(activeThread, threadMessages, folder).catch((error) => setStatus(String(error)));
  }, [activeThread, threadMessages, moveThreadToFolder, setStatus]);

  const handleToggleActiveThreadLabel = useCallback((label: Label) => {
    if (!activeThread) return;
    toggleThreadLabel(activeThread, threadMessages, label).catch((error) => setStatus(String(error)));
  }, [activeThread, threadMessages, toggleThreadLabel, setStatus]);

  const handleToggleActiveThreadMute = useCallback(() => {
    if (!activeThread) return;
    toggleThreadMuted(activeThread, threadMessages).catch((error) => setStatus(String(error)));
  }, [activeThread, threadMessages, toggleThreadMuted, setStatus]);

  const handleMoveArchive = useCallback(() => {
    moveSelected('archive').catch((error) => setStatus(String(error)));
  }, [moveSelected, setStatus]);

  const handleMoveTrash = useCallback(() => {
    moveSelected('trash').catch((error) => setStatus(String(error)));
  }, [moveSelected, setStatus]);

  const handleAllowRemoteImagesOnce = useCallback(() => {
    allowRemoteImagesForSelectedOnce().catch((error) => setStatus(String(error)));
  }, [allowRemoteImagesForSelectedOnce, setStatus]);

  const handlePermanentlyDelete = useCallback(() => {
    if (selected) requestPermanentlyDeleteMessage(selected);
  }, [selected, requestPermanentlyDeleteMessage]);

  const handleMoveToFolder = useCallback((folder: Folder) => {
    moveSelectedToFolder(folder).catch((error) => setStatus(String(error)));
  }, [moveSelectedToFolder, setStatus]);

  const focusNarrowNavigationControl = useCallback((selector: string) => {
    if (!window.matchMedia(NARROW_SHELL_MEDIA_QUERY).matches) return;
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(selector)?.focus();
    });
  }, []);

  const showNarrowSidebar = useCallback(() => {
    setNarrowView('sidebar');
    focusNarrowNavigationControl('[data-narrow-sidebar-close]');
  }, [focusNarrowNavigationControl]);

  const showNarrowList = useCallback(() => {
    setNarrowView('list');
    focusNarrowNavigationControl('[data-narrow-sidebar-open]');
  }, [focusNarrowNavigationControl]);

  const showMessageInNarrowReader = useCallback((messageId: number) => {
    setNarrowView('reader');
    selectMessageForReading(messageId);
    focusNarrowNavigationControl('[data-narrow-reader-back]');
  }, [focusNarrowNavigationControl, selectMessageForReading]);

  const showThreadInNarrowReader = useCallback((thread: ThreadSummary) => {
    setNarrowView('reader');
    focusNarrowNavigationControl('[data-narrow-reader-back]');
    return openThread(thread);
  }, [focusNarrowNavigationControl, openThread]);

  const handlePaneResizerKeyDown = useCallback((
    pane: keyof typeof APP_LAYOUT_BOUNDS,
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) => {
    if (event.key === 'Home') {
      event.preventDefault();
      resetAppLayoutPane(pane);
      return;
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const step = event.shiftKey ? 24 : 8;
    adjustAppLayout(pane, event.key === 'ArrowRight' ? step : -step);
  }, [adjustAppLayout, resetAppLayoutPane]);

  const confirmationDialogsOpen = Boolean(
    confirmDeleteFolder
    || confirmDeleteIdentity
    || confirmDeleteRule
    || contactToDeleteFromHook
    || confirmDeleteLabel
    || confirmEmptyTrashState
    || confirmPermanentlyDelete,
  );

  return (
    <main
      className={`app-shell narrow-view-${narrowView}`}
      style={{
        '--app-sidebar-width-preferred': `${appLayout.sidebar}px`,
        '--app-list-width-preferred': `${appLayout.list}px`,
      } as React.CSSProperties}
      onPointerMove={moveLayoutResize}
      onPointerUp={endLayoutResize}
      onPointerCancel={endLayoutResize}
      onMouseMove={moveLayoutMouseResize}
      onMouseUp={endLayoutMouseResize}
      onMouseLeave={endLayoutMouseResize}
    >
      <AppTitlebar
        searchInputRef={searchInputRef}
        query={queryDraft}
        appliedQuery={appliedQuery}
        searchScope={searchScope}
        filter={filter}
        messages={messages}
        onSearchSubmit={runSearch}
        onQueryChange={handleQueryChange}
        onSearchScopeChange={handleSearchScopeChange}
        onClearSearchAndFilter={handleClearSearchAndFilter}
        onApplySearchShortcut={handleApplySearchShortcut}
        currentViewLabel={currentViewLabel}
        viewSummary={titlebarViewSummary}
        isRefreshing={isRefreshing || isBackgroundSyncRunning}
        refreshNotice={refreshNotice}
        onRefresh={handleRefresh}
      />
      <Sidebar
        accountScope={accountScope}
        accounts={accounts}
        folders={folders}
        folderId={folderId}
        renamingFolderId={renamingFolderId}
        renamingFolderName={renamingFolderName}
        backgroundTasks={backgroundTasks}
        savedSearchName={savedSearchName}
        savedSearches={savedSearches}
        customFolderName={customFolderName}
        onAccountScopeChange={(value) => {
          showNarrowList();
          changeAccountScope(value);
        }}
        onSetDefaultAccount={(accountId) => {
          setDefaultAccount(accountId).catch((error) => setStatus(String(error)));
        }}
        onCompose={() => {
          if (isDraftEmpty(draft) && composerAutosave) {
            openComposer(undefined, { restoreAutosave: true });
          } else {
            setRichComposer(true);
            openComposer(emptyDraft);
            setStatus('已打开新邮件');
          }
        }}
        onSavedSearchNameChange={setSavedSearchName}
        onSaveCurrentSearch={() => saveCurrentSearch(queryDraft, filter, searchScope)}
        onRunSavedSearch={(savedSearch) => {
          runSavedSearch(savedSearch).catch((error) => setStatus(String(error)));
        }}
        onDeleteSavedSearch={deleteSavedSearch}
        onCustomFolderNameChange={setCustomFolderName}
        onCreateCustomFolder={() => {
          createCustomFolder().catch((error) => setStatus(String(error)));
        }}
        onSelectFolder={(nextFolderId) => {
          showNarrowList();
          selectFolder(nextFolderId);
        }}
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
        onCloseNavigation={showNarrowList}
      />

      <button
        className="pane-resizer sidebar-resizer"
        type="button"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整侧边栏宽度"
        aria-valuemin={APP_LAYOUT_BOUNDS.sidebar.min}
        aria-valuemax={APP_LAYOUT_BOUNDS.sidebar.max}
        aria-valuenow={appLayout.sidebar}
        aria-valuetext={`${appLayout.sidebar} 像素`}
        title="拖拽调整侧边栏宽度"
        onKeyDown={(event) => handlePaneResizerKeyDown('sidebar', event)}
        onDoubleClick={() => resetAppLayoutPane('sidebar')}
        onPointerDown={(event) => beginLayoutResize('sidebar', event)}
        onMouseDown={(event) => beginLayoutMouseResize('sidebar', event)}
      />

      <AppErrorBoundary>
        <MessageListPane
          appliedQuery={appliedQuery}
          onOpenNavigation={showNarrowSidebar}
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
          onClearSearchAndFilter={handleClearSearchAndFilter}
          onRefresh={handleRefresh}
          onShowMessages={handleShowMessages}
          onShowThreads={handleShowThreads}
          onFilterChange={setFilter}
          onSortChange={setListSort}
          onToggleAllVisible={toggleAllVisibleMessages}
          isSelectingAll={isSelectingAllMessages}
          onRunBulkAction={runBulkAction}
          onRequestSnooze={requestSnooze}
          onMoveBulkToFolder={handleMoveBulkToFolder}
          onToggleBulkLabel={handleToggleBulkLabel}
          onRunMessageAction={handleRunMessageAction}
          onMoveMessageToFolder={handleMoveMessageToFolder}
          onToggleMessageLabel={handleToggleMessageLabel}
          onComposeFromMessage={composeFromMessage}
          onOpenThread={showThreadInNarrowReader}
          onRunThreadAction={handleRunThreadAction}
          onMoveThreadToFolder={handleMoveThreadToFolder}
          onToggleThreadLabel={handleToggleThreadLabel}
          onToggleThreadMute={handleToggleThreadMute}
          onSelectMessage={showMessageInNarrowReader}
          onToggleMessageSelection={toggleMessageSelection}
          onLoadMore={handleLoadMore}
          loadMoreStatus={loadMoreStatus}
        />
      </AppErrorBoundary>

      <button
        className="pane-resizer list-resizer"
        type="button"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整邮件列表宽度"
        aria-valuemin={APP_LAYOUT_BOUNDS.list.min}
        aria-valuemax={APP_LAYOUT_BOUNDS.list.max}
        aria-valuenow={appLayout.list}
        aria-valuetext={`${appLayout.list} 像素`}
        title="拖拽调整邮件列表宽度"
        onKeyDown={(event) => handlePaneResizerKeyDown('list', event)}
        onDoubleClick={() => resetAppLayoutPane('list')}
        onPointerDown={(event) => beginLayoutResize('list', event)}
        onMouseDown={(event) => beginLayoutMouseResize('list', event)}
      />

      <AppErrorBoundary>
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
          selectedWarnExternalSender={selectedWarnExternalSender}
          selectedInterceptsHttps={selectedInterceptsHttps}
          onOpenHttpsLink={handleOpenHttpsLink}
          quickReplyBody={quickReplyBody}
          onSelectMessage={selectMessageForReading}
          onComposeNew={handleComposeNew}
          onComposeFromMessage={composeFromMessage}
          onRunThreadAction={handleRunActiveThreadAction}
          onMoveThreadToFolder={handleMoveActiveThreadToFolder}
          onToggleThreadLabel={handleToggleActiveThreadLabel}
          onToggleThreadMute={handleToggleActiveThreadMute}
          onToggleStar={toggleStar}
          onEditDraft={editDraftMessage}
          onRestoreFromTrash={restoreSelectedFromTrash}
          onMoveArchive={handleMoveArchive}
          onMoveTrash={handleMoveTrash}
          onToggleRead={toggleRead}
          onReadComplete={markMessageReadAfterReading}
          onUnsnooze={unsnoozeSelected}
          onSnooze={snoozeSelected}
          onExportMessage={exportSelectedMessage}
          onFetchBody={fetchSelectedBody}
          bodyFetchState={bodyFetchState}
          onMarkNotSpam={markSelectedNotSpam}
          onMarkAsSpam={markSelectedAsSpam}
          onAllowRemoteImagesOnce={handleAllowRemoteImagesOnce}
          onTrustRemoteImages={trustRemoteImagesForSelected}
          onBlockSender={blockSelectedSender}
          onPermanentlyDelete={handlePermanentlyDelete}
          onEmptyTrash={emptyCurrentTrash}
          onMoveToFolder={handleMoveToFolder}
          onToggleLabel={toggleLabel}
          onCreateLabel={handleCreateLabel}
          onUpdateLabel={handleUpdateLabel}
          onDeleteLabel={handleDeleteLabel}
          onOpenAttachment={openAttachment}
          onDownloadAttachment={downloadAttachment}
          onSaveAttachmentAs={saveAttachmentAs}
          onQuickReplyChange={setQuickReplyBody}
          onSendQuickReply={sendQuickReply}
          onBackToList={showNarrowList}
        />
      </AppErrorBoundary>

      {!isAccountLoginActive && isComposerOpen && (
        <Suspense fallback={<DeferredSurface label="正在打开写信窗口" />}>
          <AppErrorBoundary>
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
              onApplyTemplate={applyComposeTemplate}
              onDeleteTemplate={deleteComposeTemplate}
              onTemplateNameChange={setTemplateName}
              onSaveTemplate={saveDraftAsTemplate}
              onInsertSignature={insertSignatureIntoDraft}
              onPickAttachments={() => {
                setComposerAttachmentProgress(null);
                pickDraftAttachments().catch((error) => setStatus(String(error)));
              }}
              onRemoveAttachment={removeDraftAttachment}
              onAttachmentDrop={handleComposerAttachmentDrop}
              onAttachmentDragEnter={handleComposerAttachmentDragEnter}
              onAttachmentDragLeave={handleComposerAttachmentDragLeave}
              onAttachmentDragOver={handleComposerAttachmentDragOver}
              onAttachmentPaste={handleComposerAttachmentPaste}
              buildInlineImageAttachments={buildInlineImageAttachments}
              onInlineImagesAdded={addInlineImages}
              onSaveDraft={() => { saveDraft().catch((error) => setStatus(String(error))); }}
              onQueueDraft={() => { queueDraft().catch((error) => setStatus(String(error))); }}
              onSendDraft={() => { requestSend().catch((error) => setStatus(String(error))); }}
              onSendRiskConfirm={confirmSendRisk}
              onSendRiskCancel={() => setSendRiskConfirm(null)}
              sendRiskConfirm={sendRiskConfirm}
              sendProgress={composerSendProgress}
              sendProgressMessage={composerSendProgressMessage}
              attachmentProgress={composerAttachmentProgress}
              crossAccountRisks={crossAccountRisks}
            />
          </AppErrorBoundary>
        </Suspense>
      )}

      {!isAccountLoginActive && snoozeTarget && (
        <Suspense fallback={<DeferredSurface label="正在打开稍后处理" />}>
          <SnoozePicker
            targetCount={snoozeTarget.messages.length}
            targetLabel={snoozeTarget.label}
            onConfirm={confirmSnooze}
            onClose={() => setSnoozeTarget(null)}
          />
        </Suspense>
      )}

      {!isAccountLoginActive && isSettingsOpen && (
        <Suspense fallback={<DeferredSurface label="正在打开设置" />}>
          <AppErrorBoundary
            title="设置界面渲染失败"
            description="设置弹窗发生渲染错误，但账号与草稿数据并未丢失。你可以先关闭设置界面回到主界面；如果问题持续，尝试刷新应用。"
            primaryLabel="返回主视图"
            secondaryLabel="刷新应用"
            onPrimaryAction={() => {
              resetSaveAndVerifyReport();
              setSettingsOpen(false);
            }}
          >
            <SettingsOverlay
            accountForm={accountForm}
            accounts={accounts}
            newAccountForm={newAccountForm}
            themeMode={themeMode.mode}
            onThemeModeChange={themeMode.setMode}
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
            appSettings={appSettings}
            downloadDirBusy={downloadDirBusy}
            downloadDirError={downloadDirError}
            imapProbe={imapProbe}
            syncSchedulePlan={syncSchedulePlan}
            imapMailboxes={imapMailboxes}
            folders={folders}
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
              invoke<RemoteImageTrust[]>(IPC.ListRemoteImageTrusts, { accountId: next.id })
                .then(setRemoteImageTrusts)
                .catch((error) => setStatus(String(error)));
            }}
            onNewAccountFormChange={setNewAccountForm}
            onApplyProviderPreset={applyProviderPreset}
            onApplyNewAccountPreset={applyNewAccountPreset}
            onCreateNewAccount={async (secret, onProgress) => {
              try {
                await createNewAccount(secret, onProgress);
              } catch (error) {
                setStatus(String(error));
                throw error;
              }
            }}
            onRemoveAccount={(deleteSecret) => removeCurrentAccount(deleteSecret)}
            onUpdateProviderVerification={updateProviderVerification}
            onSaveProviderVerification={saveProviderVerification}
            onSaveAccountSettings={async (updatedAccount) => {
              const updated = await invoke<Account>(IPC.UpdateAccountSettings, {
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
            onSaveIdentity={() => saveIdentity()}
            onExportDiagnostics={() => { exportDiagnostics().catch((error) => setStatus(String(error))); }}
            onImportEml={() => { importEmlFile().catch((error) => setStatus(String(error))); }}
            onPreviewBackup={() => { previewLocalBackup().catch((error) => setStatus(String(error))); }}
            onImportBackup={() => { importLocalBackup().catch((error) => setStatus(String(error))); }}
            onExportBackup={() => { exportLocalBackup().catch((error) => setStatus(String(error))); }}
            onRefreshStorage={() => refreshStorageUsage()}
            onClearAttachmentCache={() => clearAttachmentCache()}
            onPickDownloadDir={() => pickDownloadDir()}
            onResetDownloadDir={() => resetDownloadDir()}
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
            onCreateContact={createManagedContact}
            onEditNameChange={setContactEditName}
            onEditAliasesChange={setContactEditAliases}
            onSaveContactOverride={async (contact) => {
              try {
                await saveContactOverride(contact);
              } catch (error) {
                setStatus(String(error));
                throw error;
              }
            }}
            onCancelEdit={() => setEditingContactId(null)}
            onComposeToContact={composeToContact}
            onStartEditContact={startEditContact}
            onToggleContactVip={(contact) => { toggleContactVip(contact).catch((error) => setStatus(String(error))); }}
            onDeleteContact={(contact) => { setContactToDeleteFromHook(contact); }}
            onExportContacts={() => { exportContactsVcard().catch((error) => setStatus(String(error))); }}
            onRefreshContacts={refreshManagedContacts}
            onStatus={setStatus}
            onRuleFormChange={setRuleForm}
            onRuleConditionFieldChange={updateRuleConditionField}
            onRuleConditionValueChange={updateRuleConditionValue}
            onRuleLabelActionChange={updateRuleLabelAction}
            onToggleRuleAction={toggleRuleAction}
            onSaveRule={saveRule}
            onToggleRule={(rule) => { toggleRule(rule).catch((error) => setStatus(String(error))); }}
            onEditRule={editRule}
            onRemoveRule={(rule) => { removeRule(rule); }}
            onRawMessageChange={setRawMessage}
            onParseRawMessage={parseRawMessage}
            />
          </AppErrorBoundary>
        </Suspense>
      )}
      {!isAccountLoginActive && isShortcutsOpen && (
        <Suspense fallback={<DeferredSurface label="正在打开快捷键帮助" />}>
          <ShortcutHelpModal
            open
            onClose={() => setShortcutsOpen(false)}
          />
        </Suspense>
      )}
      {!isAccountLoginActive && undoAction && (
        <Suspense fallback={null}>
          <UndoSnackbarStack
            undoAction={undoAction}
            onUndoAction={() => {
              restoreUndoAction().catch((error) => setStatus(String(error)));
            }}
            onDismissAction={clearUndoAction}
          />
        </Suspense>
      )}
      {!isAccountLoginActive && (messageToasts.length > 0 || pendingSendUndo) && (
        <Suspense fallback={null}>
          <MessageToastStack
            toasts={messageToasts}
            pendingSendUndo={pendingSendUndo}
            onUndoSend={() => {
              undoPendingSend().catch((error) => setStatus(String(error)));
            }}
            onDismissSend={() => setPendingSendUndo(null)}
          />
        </Suspense>
      )}
      {!isAccountLoginActive && <GlobalTooltip />}
      {!isAccountLoginActive && composerCloseConfirmOpen && (
        <Suspense fallback={<DeferredSurface label="正在打开关闭写信确认" />}>
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
        </Suspense>
      )}
      {!isAccountLoginActive && confirmationDialogsOpen && (
        <Suspense fallback={<DeferredSurface label="正在打开操作确认" />}>
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
        </Suspense>
      )}
      {isAccountLoginActive && (
        <Suspense fallback={<DeferredSurface label="正在准备账号登录" />}>
          <AccountLoginDialog
            form={newAccountForm}
            onFormChange={setNewAccountForm}
            onSubmit={async (secret, onProgress) => {
              setSettingsOpen(false);
              setAccountLoginProvisioning(true);
              try {
                return await createNewAccount(secret, onProgress);
              } finally {
                setAccountLoginProvisioning(false);
              }
            }}
          />
        </Suspense>
      )}
      {!isAccountLoginActive && pendingOnboardingAccount && (
        <Suspense fallback={<DeferredSurface label="正在准备首次设置" />}>
          <FirstRunOnboarding
            accountId={pendingOnboardingAccount.id}
            account={pendingOnboardingAccount}
            sendUndoDelaySeconds={sendUndoDelaySeconds}
            onAccountSettingsChange={(patch) => handleOnboardingAccountPatch(pendingOnboardingAccount.id, patch)}
            onSendUndoDelayChange={setSendUndoDelaySeconds}
            onComplete={() => completeOnboarding(pendingOnboardingAccount.id)}
            onSkipAll={() => completeOnboarding(pendingOnboardingAccount.id)}
            onStatus={setStatus}
          />
        </Suspense>
      )}
      <div className="status-line status-live-region" role="status" aria-live="polite">{status}</div>
    </main>
  );
}
