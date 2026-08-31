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
import MobileInboxHeader from './components/mobile/MobileInboxHeader';
import MobileBottomNav from './components/mobile/MobileBottomNav';
import MobileMailboxSheet from './components/mobile/MobileMailboxSheet';
import MobileSettingsRoot from './components/mobile/MobileSettingsRoot';
import GlobalTooltip from './components/GlobalTooltip';
import ContactSyncLoadingDialog from './components/ContactSyncLoadingDialog';
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
import useRecentContactSync from './hooks/useRecentContactSync';
import useMailboxData from './hooks/useMailboxData';
import useMailboxBootstrap from './hooks/useMailboxBootstrap';
import useBulkMessageActions from './hooks/useBulkMessageActions';
import useOAuthFlow from './hooks/useOAuthFlow';
import useUndoQueue from './hooks/useUndoQueue';
import useReaderActions from './hooks/useReaderActions';
import useAppGlobalEffects from './hooks/useAppGlobalEffects';
import useAppMetaLoader from './hooks/useAppMetaLoader';
import useUnreadFocusSync from './hooks/useUnreadFocusSync';
import useComposerController, { type OpenComposerOptions } from './hooks/useComposerController';
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
import useMessageSelectionControls from './hooks/useMessageSelectionControls';
import useSelectedMessageActions from './hooks/useSelectedMessageActions';
import useSingleMessageActions from './hooks/useSingleMessageActions';
import useStorageManagement from './hooks/useStorageManagement';
import useTrashController from './hooks/useTrashController';
import useThemeMode from './hooks/useThemeMode';
import useAutoHideScrollbars from './hooks/useAutoHideScrollbars';
import useFirstMessageRowPaint from './hooks/useFirstMessageRowPaint';
import useAccountScopedSettings from './hooks/useAccountScopedSettings';
import useSettingsAccountScope from './hooks/useSettingsAccountScope';
import {
  type NotificationPolicy,
} from './mailUtils';
import {
  COMPOSER_CLOSED_EVENT,
  COMPOSER_CONTACTS_SETTINGS_EVENT,
  SETTINGS_CLOSED_EVENT,
  closeCurrentWindow,
  emitToMain,
  invoke,
  listen,
  mockMode,
  openComposerWindow,
  openSettingsWindow,
  prewarmComposerWindow,
  prewarmSettingsWindow,
} from './tauriBridge';
import type {
  AccountScope,
  Account,
  AccountCreateInput,
  Folder,
  Label,
  Attachment,
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
  MailRule,
  ThreadSummary,
  OutboxItem,
  CredentialStatus,
  ProviderVerificationRecord,
  BackgroundTask,
  DraftInput,
} from './app/types';
import {
  emptyDraft,
  loadNotificationPolicy,
  loadSendUndoDelaySeconds,
  loadProviderVerifications,
  loadAccountScope,
  isDraftEmpty,
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
import useSettingsAccountSelection from './hooks/useSettingsAccountSelection';
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

type AppProps = {
  standaloneSettingsWindow?: boolean;
  requestedSettingsSection?: SettingsSectionId;
  requestedSettingsAccountScope?: AccountScope;
  onSettingsScopeChange?: (scope: AccountScope) => void;
  nativeSettingsCloseRequestVersion?: number;
  onStandaloneSettingsReady?: () => void;
};

export default function App({
  standaloneSettingsWindow = false,
  requestedSettingsSection = 'general',
  requestedSettingsAccountScope,
  onSettingsScopeChange,
  nativeSettingsCloseRequestVersion = 0,
  onStandaloneSettingsReady,
}: AppProps) {
  return (
    <MailboxApp
      standaloneSettingsWindow={standaloneSettingsWindow}
      requestedSettingsSection={requestedSettingsSection}
      requestedSettingsAccountScope={requestedSettingsAccountScope}
      onSettingsScopeChange={onSettingsScopeChange}
      nativeSettingsCloseRequestVersion={nativeSettingsCloseRequestVersion}
      onStandaloneSettingsReady={onStandaloneSettingsReady}
    />
  );
}

function MailboxApp({
  standaloneSettingsWindow,
  requestedSettingsSection,
  requestedSettingsAccountScope,
  onSettingsScopeChange,
  nativeSettingsCloseRequestVersion,
  onStandaloneSettingsReady,
}: AppProps & { standaloneSettingsWindow: boolean; requestedSettingsSection: SettingsSectionId }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountScope, setAccountScope] = useState<AccountScope>(
    () => requestedSettingsAccountScope ?? loadAccountScope(),
  );
  const scopedAccountId = accountScope === 'all' ? null : accountScope;
  const [accountForm, setAccountForm] = useState<Account | null>(null);
  const [newAccountForm, setNewAccountForm] = useState<AccountCreateInput>(emptyAccountCreateForm);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [stats, setStats] = useState<MailStats | null>(null);
  const [, setConnectionReport] = useState<ConnectionReport | null>(null);
  const [, setCredentialVerification] = useState<CredentialVerificationReport | null>(null);
  const [identities, setIdentities] = useState<MailIdentity[]>([]);
  const [rules, setRules] = useState<MailRule[]>([]);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [credentialStatus, setCredentialStatus] = useState<CredentialStatus | null>(null);
  const [providerVerifications, setProviderVerifications] = useState<Record<string, ProviderVerificationRecord>>(loadProviderVerifications);
  const [, setImapProbe] = useState<ImapProbeReport | null>(null);
  const [imapMailboxes, setImapMailboxes] = useState<ImapMailboxState[]>([]);
  const [folderId, setFolderId] = useState<number | null>(null);
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [messageResultCount, setMessageResultCount] = useState<number | null>(null);
  useFirstMessageRowPaint(messages.length);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [selectedMessageIds, setSelectedMessageIds] = useState<number[]>([]);
  const skipNextFolderEffectLoadRef = useRef(false);
  // 导航负责的账号加载不可被 refreshMailbox 覆盖。
  const navigationScopeClaimRef = useRef<number | 'all' | null>(null);
  const [activeThread, setActiveThread] = useState<ThreadSummary | null>(null);
  const [threadMessages, setThreadMessages] = useState<MessageSummary[]>([]);
  const [isSettingsOpen, setSettingsOpen] = useState(standaloneSettingsWindow);
  const [isShortcutsOpen, setShortcutsOpen] = useState(false);
  const [narrowView, setNarrowView] = useState<'sidebar' | 'list' | 'reader'>('list');
  const [nativePlatform, setNativePlatform] = useState<'android' | 'ios' | 'desktop' | 'web'>(
    () => (mockMode ? 'web' : 'desktop'),
  );
  const [isViewportMobile, setIsViewportMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches,
  );
  const [mobileScreen, setMobileScreen] = useState<'mail' | 'reader' | 'mailbox' | 'settings'>('mail');
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const themeMode = useThemeMode();
  useAutoHideScrollbars();
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSectionId>(requestedSettingsSection);
  const [status, setStatus] = useState('本地原型已就绪');
  const [messageToasts, setMessageToasts] = useState<MessageToast[]>([]);
  const messageToastIdRef = useRef(0);
  const showMessageToast = useCallback((text: string, tone: MessageToast['tone'] = 'success') => {
    const id = ++messageToastIdRef.current;
    setMessageToasts((current) => [...current, { id, text, tone }]);
    window.setTimeout(() => {
      setMessageToasts((current) => current.filter((toast) => toast.id !== id));
    }, tone === 'error' ? 5000 : 3000);
  }, []);
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
  const isMobileApp = nativePlatform === 'android'
    || nativePlatform === 'ios'
    || (nativePlatform === 'web' && isViewportMobile);
  const useNativeComposerWindow = !mockMode && nativePlatform === 'desktop';
  const useNativeSettingsWindow = !mockMode
    && nativePlatform === 'desktop'
    && !standaloneSettingsWindow;

  useEffect(() => {
    if (
      standaloneSettingsWindow
      || !useNativeComposerWindow
      || !initialAccountListLoaded
      || accounts.length === 0
    ) return undefined;
    // The composer is a separate native WebView. Start its full boot while
    // the mailbox is settling so the first explicit compose action can reuse
    // an already-ready window instead of paying the startup cost.
    void prewarmComposerWindow().catch(() => undefined);
    void prewarmSettingsWindow().catch(() => undefined);
    return undefined;
  }, [accounts.length, initialAccountListLoaded, standaloneSettingsWindow, useNativeComposerWindow]);

  useEffect(() => {
    let active = true;
    invoke<string>(IPC.GetPlatform)
      .then((platform) => {
        if (!active) return;
        if (platform === 'android' || platform === 'ios') {
          setNativePlatform(platform);
        } else if (platform === 'macos' || platform === 'windows' || platform === 'linux') {
          setNativePlatform('desktop');
        }
      })
      .catch(() => {
        // Browser preview and component tests do not expose the native command.
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const media = window.matchMedia('(max-width: 720px)');
    const update = () => setIsViewportMobile(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    if (!isMobileApp) return undefined;
    const current = window.history.state?.betterEmailScreen;
    if (!current) {
      window.history.replaceState(
        { ...(window.history.state ?? {}), betterEmailScreen: 'mail' },
        '',
      );
    }

    const handlePopState = (event: PopStateEvent) => {
      const next = event.state?.betterEmailScreen;
      const nextScreen = next === 'reader' || next === 'mailbox' || next === 'settings'
        ? next
        : 'mail';
      setMobileScreen(nextScreen);
      setMobileSearchOpen(Boolean(event.state?.betterEmailSearch));
      if (nextScreen === 'settings' && typeof event.state?.betterEmailSettingsSection === 'string') {
        setActiveSettingsSection(event.state.betterEmailSettingsSection as SettingsSectionId);
        setSettingsOpen(true);
      } else {
        setSettingsOpen(false);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isMobileApp]);

  const navigateMobileScreen = useCallback((nextScreen: 'mail' | 'reader' | 'mailbox' | 'settings') => {
    setMobileScreen(nextScreen);
    setMobileSearchOpen(false);
    if (!isMobileApp) return;
    const currentState = window.history.state ?? {};
    const {
      betterEmailSettingsSection: _settingsSection,
      betterEmailSettingsDirection: _settingsDirection,
      betterEmailSearch: _search,
      ...baseState
    } = currentState;
    if (currentState.betterEmailScreen === nextScreen) {
      if (currentState.betterEmailSearch) {
        window.history.replaceState({ ...baseState, betterEmailScreen: nextScreen }, '');
      }
      return;
    }
    window.history.pushState({ ...baseState, betterEmailScreen: nextScreen }, '');
  }, [isMobileApp]);

  const backMobileScreen = useCallback(() => {
    setMobileSearchOpen(false);
    if (isMobileApp && window.history.state?.betterEmailSearch) {
      window.history.back();
      return;
    }
    if (isMobileApp && window.history.state?.betterEmailScreen !== 'mail') {
      window.history.back();
      return;
    }
    setMobileScreen('mail');
  }, [isMobileApp]);

  const openMobileSearch = useCallback(() => {
    setMobileSearchOpen(true);
    if (!isMobileApp || window.history.state?.betterEmailSearch) return;
    window.history.pushState(
      { ...(window.history.state ?? {}), betterEmailSearch: true },
      '',
    );
  }, [isMobileApp]);

  const closeMobileSearch = useCallback(() => {
    if (isMobileApp && window.history.state?.betterEmailSearch) {
      window.history.back();
      return;
    }
    setMobileSearchOpen(false);
  }, [isMobileApp]);

  useEffect(() => {
    if (isMobileApp && isSettingsOpen && mobileScreen !== 'settings') {
      setMobileScreen('settings');
    }
  }, [isMobileApp, isSettingsOpen, mobileScreen]);

  const mailboxRefreshRef = useRef(0);
  const searchLoadersRef = useRef<MailboxSearchLoaders | null>(null);
  const {
    queryDraft,
    appliedQuery,
    searchScope,
    filter,
    setFilter,
    listMode,
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
    handleClearSearchForFilter,
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
    setSelectedMessageIds,
    setStatus,
  });
  const [isSelectingAllMessages, setIsSelectingAllMessages] = useState(false);
  const [confirmPermanentlyDelete, setConfirmPermanentlyDelete] = useState<MessageSummary | null>(null);
  const [, setBackgroundSyncStatus] = useState('后台同步待机');
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTask[]>([]);
  const [, setSyncSchedulePlan] = useState<SyncSchedulePlan | null>(null);
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
  } = useContactManagement({ setStatus, setNotificationPolicy, accountId: scopedAccountId });
  const {
    scanBusy: contactScanBusy,
    scanRecentContacts,
  } = useRecentContactSync({
    accountsLength: accounts.length,
    accountId: scopedAccountId,
    initialAccountListLoaded,
    gateActive: isAccountLoginActive || standaloneSettingsWindow,
    onboardingActive: Boolean(pendingOnboardingAccount),
    refreshContacts: refreshManagedContacts,
    setStatus,
    showToast: showMessageToast,
  });
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
    () => buildMailboxContextKey({ accountScope, folderId, query: appliedQuery, filter }),
    [accountScope, folderId, appliedQuery, filter],
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
    loadThreads,
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
    messages,
    setMessages,
    setMessageCount: setMessageResultCount,
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
    automaticProcessingEnabled: !standaloneSettingsWindow,
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
    isDirty: accountSettingsDirty,
    authTypeChanged,
    authTypeChangeNotice,
    accountSettingsSaving,
    saveAndVerifyRunning,
    resetSaveAndVerifyReport,
    saveSettings,
    saveAndVerify,
    createNewAccount,
    removeCurrentAccount,
    setDefaultAccount,
    applyProviderPreset,
    applyNewAccountPreset,
    testConnection,
    connectionTestRunning,
    connectionTestFeedback,
    verifyAccountCredentials,
    mapImapMailbox,
    createAndMapImapMailbox,
    runSyncDryRun,
    syncImapHistoryPage,
  } = useAccountConnectionController({
    accounts,
    accountForm,
    newAccountForm,
    providerVerifications,
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
    loadThreads,
    loadMeta,
    syncImapHistoryPage,
  };
  const {
    scrollSettingsSection,
    openSettingsHome,
    focusMailboxRole,
    scopeRevision,
    currentFolderAccountId,
    visibleFolderIdForRole,
    openThread,
    changeAccountScope,
    selectFolder,
  } = useMailboxNavigation({
    account,
    accounts,
    accountScope,
    folderId,
    folders,
    mailboxRefreshRef,
    skipNextFolderEffectLoadRef,
    resetSearch,
    loadMeta,
    loadMessagesWithVisibleFallback,
    setActiveSettingsSection,
    setActiveThread,
    setAccountScope,
    setAttachments,
    setFolderId,
    setMessages,
    setSelectedId,
    setSelectedMessageIds,
    setSettingsOpen,
    setStatus,
    setThreadMessages,
    navigationScopeClaimRef,
  });

  const openDesktopSettingsWindow = useCallback((section: SettingsSectionId = 'general') => {
    setStatus('正在打开设置窗口…');
    void openSettingsWindow({ section, accountScope })
      .then(() => setStatus('设置窗口已就绪'))
      .catch((error) => setStatus(`无法打开独立设置窗口：${String(error)}`));
  }, [accountScope]);

  const openMobileSettings = useCallback(() => {
    if (isMobileApp) {
      navigateMobileScreen('settings');
      return;
    }
    if (useNativeSettingsWindow) {
      openDesktopSettingsWindow('general');
      return;
    }
    openSettingsHome();
  }, [isMobileApp, navigateMobileScreen, openDesktopSettingsWindow, openSettingsHome, useNativeSettingsWindow]);

  const openMobileSettingsSection = useCallback((section: SettingsSectionId) => {
    if (useNativeSettingsWindow) {
      openDesktopSettingsWindow(section);
      return;
    }
    if (isMobileApp && window.history.state?.betterEmailSettingsSection !== section) {
      const currentState = window.history.state ?? {};
      const enteringFromSettingsPage = typeof currentState.betterEmailSettingsSection === 'string';
      if (enteringFromSettingsPage) {
        window.history.replaceState(
          { ...currentState, betterEmailSettingsDirection: 'backward' },
          '',
        );
      }
      const { betterEmailSearch: _search, ...baseState } = window.history.state ?? {};
      window.history.pushState(
        {
          ...baseState,
          betterEmailScreen: 'settings',
          betterEmailSettingsSection: section,
          betterEmailSettingsDirection: enteringFromSettingsPage ? 'forward' : 'none',
        },
        '',
      );
    }
    setActiveSettingsSection(section);
    setSettingsOpen(true);
    loadMeta(folderId, accountScope, { mode: 'full' }).catch((error) => setStatus(String(error)));
  }, [accountScope, folderId, isMobileApp, loadMeta, openDesktopSettingsWindow, setStatus, useNativeSettingsWindow]);

  const closeSettingsSurface = useCallback(() => {
    resetSaveAndVerifyReport();
    if (isMobileApp && window.history.state?.betterEmailSettingsSection) {
      window.history.back();
      return;
    }
    setSettingsOpen(false);
    if (isMobileApp) setMobileScreen('settings');
  }, [isMobileApp, resetSaveAndVerifyReport]);

  const standaloneSettingsBootstrappedRef = useRef(false);
  useEffect(() => {
    if (!standaloneSettingsWindow) return;
    setActiveSettingsSection(requestedSettingsSection);
  }, [requestedSettingsSection, standaloneSettingsWindow]);

  useEffect(() => {
    if (!standaloneSettingsWindow) return;
    if (standaloneSettingsBootstrappedRef.current) return;
    standaloneSettingsBootstrappedRef.current = true;
    loadMeta(folderId, accountScope, { mode: 'full' })
      .catch((error) => setStatus(String(error)));
  }, [
    accountScope,
    folderId,
    loadMeta,
    standaloneSettingsWindow,
  ]);

  const standaloneSettingsCloseStartedRef = useRef(false);
  useEffect(() => {
    if (!standaloneSettingsWindow || isSettingsOpen || standaloneSettingsCloseStartedRef.current) return;
    standaloneSettingsCloseStartedRef.current = true;
    void emitToMain(SETTINGS_CLOSED_EVENT)
      .catch(() => undefined)
      .then(() => closeCurrentWindow())
      .catch((error) => {
        standaloneSettingsCloseStartedRef.current = false;
        setStatus(`无法关闭设置窗口：${String(error)}`);
      });
  }, [isSettingsOpen, standaloneSettingsWindow]);

  useMailboxBootstrap({
    enabled: !standaloneSettingsWindow,
    accountScope,
    scopeRevision,
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
  useUnreadFocusSync(refreshUnreadIndicators, accountScope, !standaloneSettingsWindow);

  const unreadTotal = stats?.unread_messages ?? 0;
  const messageListSummary = stats
    ? `${stats.total_messages} 封 · ${unreadTotal} 未读`
    : `${messages.length} 封`;
  const visibleListSummary = messageResultCount !== null
    ? `${messageResultCount} 封`
    : hasMoreMessages
      ? `${messages.length}+ 封`
      : `${messages.length} 封`;
  const titlebarViewSummary = buildTitlebarViewSummary(
    listMode,
    stats,
    threads.length,
    messageResultCount,
  ) ?? (listMode === 'messages' ? visibleListSummary : undefined);
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

  const openExternalComposer = useCallback((nextDraft?: DraftInput, options: OpenComposerOptions = {}) => {
    setStatus('正在打开写信窗口…');
    void openComposerWindow({
      draft: nextDraft,
      ...options,
    })
      .then(() => setStatus('写信窗口已就绪'))
      .catch((error) => {
        setStatus(`无法打开独立写信窗口：${String(error)}`);
      });
  }, []);

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
    composerFocusRequest,
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
    addContactsToDraft,
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
    refreshContacts: refreshManagedContacts,
    focusMailboxRole,
    openExternalComposer: useNativeComposerWindow ? openExternalComposer : undefined,
    setSendProgress: setComposerSendProgress,
    setSendProgressMessage: setComposerSendProgressMessage,
    setAttachmentProgress: setComposerAttachmentProgress,
  });

  useEffect(() => {
    if (standaloneSettingsWindow) return undefined;
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

        const unlistenComposerClosed = await listen(COMPOSER_CLOSED_EVENT, () => {
          if (!active) return;
          refreshAll().catch((error) => setStatus(String(error)));
        });
        unlisteners.push(unlistenComposerClosed);

        const unlistenComposerContactsSettings = await listen(COMPOSER_CONTACTS_SETTINGS_EVENT, () => {
          if (!active || isModalGateActive) return;
          openMobileSettingsSection('contacts');
        });
        unlisteners.push(unlistenComposerContactsSettings);

        const unlistenSettingsClosed = await listen(SETTINGS_CLOSED_EVENT, () => {
          if (!active) return;
          void (async () => {
            const latestAccounts = await invoke<Account[]>(IPC.ListAccounts);
            const nextScope = accountScope === 'all' || latestAccounts.some((item) => item.id === accountScope)
              ? accountScope
              : latestAccounts.find((item) => item.is_default)?.id ?? latestAccounts[0]?.id ?? 'all';
            if (nextScope !== accountScope) setAccountScope(nextScope);
            mailboxRefreshRef.current += 1;
            const refreshId = mailboxRefreshRef.current;
            const meta = await loadMeta(null, nextScope, { mode: 'full' });
            await loadMessages(
              meta.folderId,
              appliedQuery,
              filter,
              nextScope,
              refreshId,
            );
            if (active) setStatus('设置已更新');
          })().catch((error) => {
            if (active) setStatus(`设置已保存，但主界面刷新失败：${String(error)}`);
          });
        });
        unlisteners.push(unlistenSettingsClosed);

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
          openMobileSettings();
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
  }, [accountScope, appliedQuery, enqueueManualSync, filter, folders, isModalGateActive, loadMessages, loadMeta, openComposer, openMobileSettings, openMobileSettingsSection, refreshAll, resetSearch, setActiveThread, setFilter, setFolderId, setRichComposer, setSelectedId, setSelectedMessageIds, setStatus, setThreadMessages, standaloneSettingsWindow]);

  const {
    toggleGroup,
    groupSyncBusy,
    selectDateRange,
    selectedMessages,
    clearSelection,
    isAllMessagesSelected,
    toggleMessageSelection,
    toggleAllMessages,
  } = useMessageSelectionControls(
    messages,
    setSelectedMessageIds,
    setStatus,
    loadAllMessages,
    mailboxRefreshRef,
    selectedMessageIds,
    mailboxListStateKey,
    setIsSelectingAllMessages,
  );

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
  } = useRuleManagement({ rules, setRules, setStatus, accountId: scopedAccountId });
  const {
    credentialSecret,
    setCredentialSecret,
    storeAndVerifyCredential,
    deleteCredential,
  } = useCredentialManagement({
    account: accountForm,
    credentialStatus,
    setCredentialStatus,
    setCredentialVerification,
    setStatus,
    verifyAccountCredentials,
  });
  const selectSettingsAccount = useSettingsAccountSelection({
    setAccountForm,
    setIdentityForm,
    setCredentialSecret,
    setCredentialStatus,
    setCredentialVerification,
    setRemoteImageTrusts,
    setIdentities,
    setFolders,
    setStatus,
  });
  const accountScopedPreferences = useAccountScopedSettings({
    accountScope,
    accounts,
    setAccount,
    setAccounts,
    setAccountForm,
    setStatus,
  });
  const {
    localBackupSummary,
    storageUsage,
    storageBusy,
    appSettings,
    downloadDirBusy,
    downloadDirError,
    exportLocalBackup,
    importLocalBackup,
    refreshStorageUsage,
    clearAttachmentCache,
    refreshAppSettings,
    pickDownloadDir,
    resetDownloadDir,
  } = useStorageManagement({
    selected,
    setAttachments,
    loadMeta: (nextFolderId) => loadMeta(nextFolderId, accountScope, { mode: 'mailbox' }),
    loadMessages: (nextFolderId) => loadMessages(nextFolderId),
    setStatus,
  });

  async function deleteRemoteImageTrust(trust: RemoteImageTrust) {
    await invoke(IPC.DeleteRemoteImageTrust, { trustId: trust.id });
    setRemoteImageTrusts((current) => current.filter((item) => item.id !== trust.id));
    if (selected?.account_id === trust.account_id) {
      await renderSelectedWithRemoteImagePolicy(selected.id);
    }
    setStatus(`已移除远程图片信任：${trust.value}`);
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
    isComposerModal: isMobileApp,
    isSettingsOpen,
    isShortcutsOpen,
    isAccountLoginRequired: isModalGateActive,
    closeOverlays: () => {
      closeComposer();
      setSettingsOpen(false);
      setShortcutsOpen(false);
    },
    clearSelection,
    setStatus,
    restoreUndoAction,
    toggleAllVisibleMessages: toggleAllMessages,
    openShortcuts: () => setShortcutsOpen(true),
    composeNew: () => {
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

  // 首次引导保存绑定账号 ID，避免后台刷新覆盖最新状态。
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
    // 让旧元数据请求失效，避免向导重新出现。
    mailboxRefreshRef.current += 1;
    const updated = await invoke<Account>(IPC.SetAccountOnboardingCompleted, {
      accountId,
      completed: true,
    });
    setAccount(updated);
    setAccountForm(updated);
    setAccounts((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setStatus('首次引导已完成，可随时在设置页调整');
  }, [mailboxRefreshRef, setAccount, setAccountForm, setAccounts, setStatus]);

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
    const hasPrefill = Boolean(fields && Object.values(fields).some((value) => value?.trim()));
    openComposer({
      ...emptyDraft,
      account_id: account?.id ?? accounts[0]?.id ?? 0,
      to: fields?.to || '',
      cc: fields?.cc || '',
      bcc: fields?.bcc || '',
      subject: fields?.subject || '',
      body: fields?.body || '',
    }, { replaceExisting: hasPrefill });
    setStatus('已打开新邮件');
  }, [account, accounts, openComposer, setStatus]);

  const openComposerContactsSettings = useCallback(() => {
    const openContactsSettings = () => openMobileSettingsSection('contacts');
    if (isDraftEmpty(draft)) {
      forceCloseComposer();
      openContactsSettings();
      return;
    }
    saveDraft()
      .then(openContactsSettings)
      .catch((error) => setStatus(String(error)));
  }, [draft, forceCloseComposer, openMobileSettingsSection, saveDraft, setStatus]);

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
    if (isMobileApp) {
      navigateMobileScreen('mailbox');
      return;
    }
    setNarrowView('sidebar');
    focusNarrowNavigationControl('[data-narrow-sidebar-close]');
  }, [focusNarrowNavigationControl, isMobileApp, navigateMobileScreen]);

  const showNarrowList = useCallback(() => {
    if (isMobileApp) {
      backMobileScreen();
      return;
    }
    setNarrowView('list');
    focusNarrowNavigationControl('[data-narrow-sidebar-open]');
  }, [backMobileScreen, focusNarrowNavigationControl, isMobileApp]);

  const {
    handleSettingsAccountScopeChange,
    handleMailboxAccountScopeChange,
  } = useSettingsAccountScope({
    accountScope,
    accounts,
    requestedAccountScope: requestedSettingsAccountScope,
    accountsLoaded: initialAccountListLoaded,
    standaloneSettingsWindow,
    useNativeSettingsWindow,
    onSettingsScopeChange,
    setAccount,
    setAccounts,
    setAccountForm,
    changeAccountScope,
    selectSettingsAccount,
    showNarrowList,
  });

  const showMessageInNarrowReader = useCallback((messageId: number) => {
    if (isMobileApp) navigateMobileScreen('reader');
    setNarrowView('reader');
    selectMessageForReading(messageId);
    focusNarrowNavigationControl('[data-narrow-reader-back]');
  }, [focusNarrowNavigationControl, isMobileApp, navigateMobileScreen, selectMessageForReading]);

  const showThreadInNarrowReader = useCallback((thread: ThreadSummary) => {
    if (isMobileApp) navigateMobileScreen('reader');
    setNarrowView('reader');
    focusNarrowNavigationControl('[data-narrow-reader-back]');
    return openThread(thread);
  }, [focusNarrowNavigationControl, isMobileApp, navigateMobileScreen, openThread]);

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

  const messageListContent = (
    <AppErrorBoundary>
      <MessageListPane
        mobile={isMobileApp}
        showAccountSource={accountScope === 'all'}
        appliedQuery={appliedQuery}
        onOpenNavigation={isMobileApp ? undefined : showNarrowSidebar}
        filter={filter}
        listMode={listMode}
        listSort={listSort}
        selectedMessageIds={selectedMessageIds}
        selectedMessages={selectedMessages}
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
        onToggleAllVisible={toggleAllMessages}
        isSelectingAll={isSelectingAllMessages}
        isAllMessagesSelected={isAllMessagesSelected}
        onRunBulkAction={runBulkAction}
        onRequestSnooze={requestSnooze}
        onMoveBulkToFolder={handleMoveBulkToFolder}
        onToggleBulkLabel={handleToggleBulkLabel}
        onRunMessageAction={handleRunMessageAction}
        onMoveMessageToFolder={handleMoveMessageToFolder}
        onToggleMessageLabel={handleToggleMessageLabel}
        onComposeFromMessage={composeFromMessage}
        onOpenThread={showThreadInNarrowReader}
        onLoadThreadMessages={(thread) => openThread(thread, false)}
        onRunThreadAction={handleRunThreadAction}
        onMoveThreadToFolder={handleMoveThreadToFolder}
        onToggleThreadLabel={handleToggleThreadLabel}
        onToggleThreadMute={handleToggleThreadMute}
        onSelectMessage={showMessageInNarrowReader}
        onToggleMessageSelection={toggleMessageSelection}
        onToggleMessageGroup={toggleGroup}
        isSelectingMessageGroup={groupSyncBusy}
        onSelectMessageDateRange={selectDateRange}
        onLoadMore={handleLoadMore}
        loadMoreStatus={loadMoreStatus}
      />
    </AppErrorBoundary>
  );

  const readerContent = (
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
  );

  return (
    <main
      className={`app-shell narrow-view-${narrowView}${isMobileApp ? ' is-mobile-app' : ''}${standaloneSettingsWindow ? ' standalone-settings-window' : ''}`}
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
      {standaloneSettingsWindow ? null : isMobileApp ? (
        <div className={`mobile-app-surface mobile-screen-${mobileScreen}`}>
          {mobileScreen === 'mail' && (
            <>
              <MobileInboxHeader
                currentViewLabel={currentViewLabel}
                visibleListSummary={visibleListSummary}
                query={queryDraft}
                filter={filter}
                listMode={listMode}
                isRefreshing={isRefreshing || isBackgroundSyncRunning}
                refreshNotice={refreshNotice}
                onOpenMailbox={showNarrowSidebar}
                onOpenSearch={openMobileSearch}
                onCloseSearch={closeMobileSearch}
                onRefresh={handleRefresh}
                onSearchSubmit={runSearch}
                onQueryChange={handleQueryChange}
                onClearSearchAndFilter={handleClearSearchAndFilter}
                onFilterChange={setFilter}
                onShowMessages={handleShowMessages}
                onShowThreads={handleShowThreads}
                searchOpen={mobileSearchOpen}
              />
              {messageListContent}
              <MobileBottomNav
                filter={filter}
                onOpenMail={() => {
                  handleClearSearchForFilter('all', false);
                  handleShowMessages();
                  navigateMobileScreen('mail');
                }}
                onOpenStarred={() => {
                  handleClearSearchForFilter('starred', false);
                  handleShowMessages();
                  navigateMobileScreen('mail');
                }}
                onCompose={() => handleComposeNew(undefined)}
                onOpenSettings={openMobileSettings}
              />
            </>
          )}
          {mobileScreen === 'reader' && (
            <div className="mobile-reader-surface">
              {readerContent}
            </div>
          )}
          {mobileScreen === 'mailbox' && (
            <MobileMailboxSheet
              accountScope={accountScope}
              accounts={accounts}
              folders={folders}
              folderId={folderId}
              onClose={backMobileScreen}
              onAccountScopeChange={changeAccountScope}
              onSelectFolder={selectFolder}
              onCompose={() => handleComposeNew(undefined)}
              onOpenSettings={openMobileSettings}
            />
          )}
          {mobileScreen === 'settings' && (
            <MobileSettingsRoot
              account={account}
              accounts={accounts}
              onBack={backMobileScreen}
              onOpenSection={openMobileSettingsSection}
            />
          )}
        </div>
      ) : (
        <>
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
        onAccountScopeChange={handleMailboxAccountScopeChange}
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
        onOpenSettings={openMobileSettings}
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

      {messageListContent}

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

      {readerContent}
        </>
      )}

      {!isAccountLoginActive && !useNativeComposerWindow && isComposerOpen && (
        <Suspense fallback={<DeferredSurface label="正在打开写信窗口" />}>
          <AppErrorBoundary>
            <ComposerWindow
              minimized={isComposerMinimized}
              focusRequest={composerFocusRequest}
              draft={draft}
              accounts={accounts}
              identities={identities}
              fallbackAccountId={account?.id ?? accounts[0]?.id ?? 0}
              contacts={managedContacts}
              onAddContacts={addContactsToDraft}
              onOpenContactsSettings={openComposerContactsSettings}
              onScanRecentContacts={scanRecentContacts}
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
              onSaveDraft={saveDraft}
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
            description="设置窗口发生渲染错误，但账号与草稿数据并未丢失。你可以先关闭设置窗口；如果问题持续，尝试刷新应用。"
            primaryLabel="返回主视图"
            secondaryLabel="刷新应用"
            onPrimaryAction={() => {
              closeSettingsSurface();
            }}
          >
            <SettingsOverlay
            standalone={standaloneSettingsWindow}
            nativeCloseRequestVersion={nativeSettingsCloseRequestVersion}
            onReady={onStandaloneSettingsReady}
            accountForm={accountForm}
            accounts={accounts}
            accountScope={accountScope}
            accountValues={accountScopedPreferences.values}
            unifiedAccountSettingsDirty={accountScopedPreferences.isDirty}
            unifiedAccountSettingsSaving={accountScopedPreferences.saving}
            newAccountForm={newAccountForm}
            themeMode={themeMode.mode}
            onThemeModeChange={themeMode.setMode}
            activeSettingsSection={activeSettingsSection}
            accountSettingsDirty={accountSettingsDirty}
            accountSettingsSaving={accountSettingsSaving}
            saveAndVerifyRunning={saveAndVerifyRunning}
            connectionTestRunning={connectionTestRunning}
            connectionTestFeedback={connectionTestFeedback}
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
            credentialSecret={credentialSecret}
            credentialStatus={credentialStatus}
            notificationPolicy={notificationPolicy}
            sendUndoDelaySeconds={sendUndoDelaySeconds}
            remoteImageTrusts={remoteImageTrusts}
            identities={identities}
            identityForm={identityForm}
            localBackupSummary={localBackupSummary}
            storageUsage={storageUsage}
            storageBusy={storageBusy}
            appSettings={appSettings}
            downloadDirBusy={downloadDirBusy}
            downloadDirError={downloadDirError}
            imapMailboxes={imapMailboxes}
            folders={folders}
            labels={labels}
            rules={rules}
            ruleForm={ruleForm}
            ruleBuilderField={ruleBuilderField}
            ruleBuilderNeedle={ruleBuilderNeedle}
            editingRuleId={editingRuleId}
            contactForm={contactForm}
            contactFormAliases={contactFormAliases}
            contacts={managedContacts}
            editingContactId={editingContactId}
            contactEditName={contactEditName}
            contactEditAliases={contactEditAliases}
            contactTransferBusy={contactTransferBusy}
            setStatus={setStatus}
            onNavigate={isMobileApp ? openMobileSettingsSection : scrollSettingsSection}
            onClose={closeSettingsSurface}
            onTestConnection={() => {
              testConnection().catch(() => undefined);
            }}
            onSave={() => {
              if (accountScope === 'all') {
                accountScopedPreferences.save().catch((error) => setStatus(String(error)));
                return;
              }
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
            onDiscardUnifiedSettings={accountScopedPreferences.discardChanges}
            onSaveAndVerify={accountForm ? () => {
              saveAndVerify().catch((error) => setStatus(String(error)));
            } : undefined}
            onAccountFormChange={setAccountForm}
            onAccountValueChange={accountScopedPreferences.updateSetting}
            onAccountScopeChange={handleSettingsAccountScopeChange}
            onSetDefaultAccount={(accountId) => { setDefaultAccount(accountId).catch((error) => setStatus(String(error))); }}
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
            onSaveAccountSettings={async (updatedAccount) => {
              const updated = await invoke<Account>(IPC.UpdateAccountSettings, {
                accountId: updatedAccount.id,
                input: updatedAccount,
              });
              setAccount((current) => (
                current === null || current.id === updated.id ? updated : current
              ));
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
            onVerifyCredential={() => { verifyAccountCredentials().catch((error) => setStatus(String(error))); }}
            onDeleteCredential={() => { deleteCredential().catch((error) => setStatus(String(error))); }}
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
            onImportBackup={() => { importLocalBackup().catch((error) => setStatus(String(error))); }}
            onExportBackup={() => { exportLocalBackup().catch((error) => setStatus(String(error))); }}
            onClearAttachmentCache={() => clearAttachmentCache()}
            onPickDownloadDir={() => pickDownloadDir()}
            onResetDownloadDir={() => resetDownloadDir()}
            onMapImapMailbox={(mailbox, targetFolderId) => {
              mapImapMailbox(mailbox, targetFolderId).catch((error) => setStatus(String(error)));
            }}
            onCreateAndMapImapMailbox={(mailbox) => {
              createAndMapImapMailbox(mailbox).catch((error) => setStatus(String(error)));
            }}
            onEnqueueBackgroundTask={(kind, source) => { enqueueBackgroundTask(kind, source).catch((error) => setStatus(String(error))); }}
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
      <ContactSyncLoadingDialog open={contactScanBusy} />
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
