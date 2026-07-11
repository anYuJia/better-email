import React, {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Edit3,
  Inbox,
  Keyboard,
  RefreshCw,
  Settings,
} from 'lucide-react';
import './styles.css';
import Sidebar from './components/Sidebar';
import MessageListPane, { type MessageContextAction } from './components/MessageListPane';
import ReaderPane from './components/ReaderPane';
import type { SettingsSectionId } from './components/settings/SettingsFrame';
import UndoSnackbarStack, { type PendingSendUndo } from './components/UndoSnackbarStack';
import useAppLayout from './hooks/useAppLayout';
import useAppShortcuts from './hooks/useAppShortcuts';
import useAccountConnectionController from './hooks/useAccountConnectionController';
import useBackgroundTaskCoordinator from './hooks/useBackgroundTaskCoordinator';
import useCommandPaletteItems from './hooks/useCommandPaletteItems';
import useContactManagement from './hooks/useContactManagement';
import useMailboxData from './hooks/useMailboxData';
import useMessageCollectionActions from './hooks/useMessageCollectionActions';
import useOAuthFlow from './hooks/useOAuthFlow';
import useProviderWriteValidation from './hooks/useProviderWriteValidation';
import useUndoQueue from './hooks/useUndoQueue';
import {
  defaultNotificationPolicy,
  formatBytes,
  formatDate,
  type NotificationPolicy,
  prefixedSubject,
  quoteMessage,
  replyThreadingHeaders,
  remoteImageTrustInput,
  senderDomain,
} from './mailUtils';
import { getCurrentWindow, invoke } from './tauriBridge';

import type {
  SystemFolderRole,
  FolderRole,
  FilterMode,
  ListMode,
  ListSort,
  AccountScope,
  Account,
  AccountCreateInput,
  Folder,
  FolderReadReport,
  Label,
  SavedSearch,
  SearchScope,
  Attachment,
  OutboundAttachmentInput,
  DroppedFile,
  AttachmentDownload,
  Message,
  UndoMessageSnapshot,
  CommandPaletteItem,
  RemoteImageTrust,
  MailIdentity,
  MailIdentityInput,
  DraftInput,
  DraftSaveReport,
  ComposeTemplate,
  ComposerAutosave,
  MailStats,
  LocalBackupSummary,
  StorageUsage,
  CacheClearResult,
  EndpointCheck,
  ConnectionReport,
  CredentialVerificationReport,
  ImapFolderProbe,
  ImapProbeReport,
  ImapMailboxState,
  SyncRun,
  SyncSchedulePlan,
  RemoteActionReport,
  RestoreMessageReport,
  TrashActionReport,
  ParsedMessagePreview,
  Contact,
  ContactMergeSuggestion,
  MailRule,
  MailRuleInput,
  ThreadSummary,
  OutboxItem,
  CredentialStatus,
  OAuthSession,
  ProviderVerificationRecord,
  BackgroundTask,
} from './app/types';
import {
  emptyDraft,
  emptyIdentityForm,
  emptyRuleForm,
  parseRuleCondition,
  buildRuleCondition,
  ruleActionParts,
  setRuleActionPart,
  notificationPolicyStorageKey,
  providerVerificationStorageKey,
  savedSearchesStorageKey,
  composeTemplatesStorageKey,
  composerAutosaveStorageKey,
  sendUndoDelayStorageKey,
  listSortStorageKey,
  filterModes,
  backgroundTaskTitle,
  loadNotificationPolicy,
  loadSendUndoDelaySeconds,
  loadListSort,
  removeAppStorage,
  loadProviderVerifications,
  isFilterMode,
  loadSavedSearches,
  loadComposeTemplates,
  isDraftEmpty,
  normalizeDraftInput,
  loadComposerAutosave,
  outboxStatusLabel,
  outboxTimingLabel,
  canCancelOutboxItem,
  isCustomFolder,
  movableFoldersForBulk,
  sampleRawMessage,
  folderIcon,
  folderIconForRole,
  primaryFolderRoles,
  filters,
  messagePageSize,
  searchShortcuts,
  emptyAccountCreateForm,
} from './app/appConfig';
import type {
  RuleConditionField,
  SendUndoDelaySeconds,
} from './app/appConfig';
import { copyTextToClipboard } from './app/clipboard';
import {
  buildForwardAttachmentPlan,
  forwardAttachmentStatus,
} from './app/forwarding';
import { canSnoozeRole } from './app/snooze';
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
const RuleAutomationSettings = lazy(() => import('./components/settings/RuleAutomationSettings'));
const SecurityPreviewSettings = lazy(() => import('./components/settings/SecurityPreviewSettings'));
const CommandPalette = lazy(() => import('./components/CommandPalette'));
const ShortcutHelpModal = lazy(() => import('./components/ShortcutHelpModal'));

function DeferredSurface({ label }: { label: string }) {
  return (
    <div className="deferred-overlay" role="status" aria-live="polite">
      <div className="deferred-surface">
        <span className="deferred-spinner" aria-hidden="true" />
        <strong>{label}</strong>
      </div>
    </div>
  );
}

export default function App() {
  const [account, setAccount] = useState<Account | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountScope, setAccountScope] = useState<AccountScope>('all');
  const [accountForm, setAccountForm] = useState<Account | null>(null);
  const [newAccountForm, setNewAccountForm] = useState<AccountCreateInput>(emptyAccountCreateForm);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [customFolderName, setCustomFolderName] = useState('');
  const [renamingFolderId, setRenamingFolderId] = useState<number | null>(null);
  const [renamingFolderName, setRenamingFolderName] = useState('');
  const [labels, setLabels] = useState<Label[]>([]);
  const [stats, setStats] = useState<MailStats | null>(null);
  const [connectionReport, setConnectionReport] = useState<ConnectionReport | null>(null);
  const [credentialVerification, setCredentialVerification] = useState<CredentialVerificationReport | null>(null);
  const [syncRuns, setSyncRuns] = useState<SyncRun[]>([]);
  const [identities, setIdentities] = useState<MailIdentity[]>([]);
  const [identityForm, setIdentityForm] = useState<MailIdentityInput>(emptyIdentityForm);
  const [rules, setRules] = useState<MailRule[]>([]);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [diagnosticExport, setDiagnosticExport] = useState<string | null>(null);
  const [localBackupSummary, setLocalBackupSummary] = useState<LocalBackupSummary | null>(null);
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null);
  const [storageBusy, setStorageBusy] = useState(false);
  const [providerVerifications, setProviderVerifications] = useState<Record<string, ProviderVerificationRecord>>(loadProviderVerifications);
  const [rawMessage, setRawMessage] = useState(sampleRawMessage);
  const [parsedPreview, setParsedPreview] = useState<ParsedMessagePreview | null>(null);
  const [credentialSecret, setCredentialSecret] = useState('');
  const [credentialStatus, setCredentialStatus] = useState<CredentialStatus | null>(null);
  const [imapProbe, setImapProbe] = useState<ImapProbeReport | null>(null);
  const [imapMailboxes, setImapMailboxes] = useState<ImapMailboxState[]>([]);
  const [folderId, setFolderId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageLimit, setMessageLimit] = useState(messagePageSize);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedMessageIds, setSelectedMessageIds] = useState<number[]>([]);
  const [listMode, setListMode] = useState<ListMode>('messages');
  const [listSort, setListSort] = useState<ListSort>(loadListSort);
  const [activeThread, setActiveThread] = useState<ThreadSummary | null>(null);
  const [threadMessages, setThreadMessages] = useState<Message[]>([]);
  const [query, setQuery] = useState('');
  const [searchScope, setSearchScope] = useState<SearchScope>('account');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>(loadSavedSearches);
  const [savedSearchName, setSavedSearchName] = useState('');
  const [composeTemplates, setComposeTemplates] = useState<ComposeTemplate[]>(loadComposeTemplates);
  const [templateName, setTemplateName] = useState('');
  const [composerAutosave, setComposerAutosave] = useState<ComposerAutosave | null>(loadComposerAutosave);
  const [isComposerOpen, setComposerOpen] = useState(false);
  const [isComposerMinimized, setComposerMinimized] = useState(false);
  const [isComposerDropActive, setComposerDropActive] = useState(false);
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const [isShortcutsOpen, setShortcutsOpen] = useState(false);
  const [isCommandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSectionId>('accounts');
  const [snoozeTarget, setSnoozeTarget] = useState<{
    messages: Message[];
    label: string;
  } | null>(null);
  const [draft, setDraft] = useState<DraftInput>(emptyDraft);
  const [quickReplyBody, setQuickReplyBody] = useState('');
  const [isRichComposer, setRichComposer] = useState(false);
  const [ruleForm, setRuleForm] = useState<MailRuleInput>(emptyRuleForm);
  const [ruleBuilderField, setRuleBuilderField] = useState<RuleConditionField>('from');
  const [ruleBuilderNeedle, setRuleBuilderNeedle] = useState('');
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null);
  const [status, setStatus] = useState('本地原型已就绪');
  const [backgroundSyncStatus, setBackgroundSyncStatus] = useState('后台同步待机');
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTask[]>([]);
  const [syncSchedulePlan, setSyncSchedulePlan] = useState<SyncSchedulePlan | null>(null);
  const [remoteImageTrusts, setRemoteImageTrusts] = useState<RemoteImageTrust[]>([]);
  const [lastNewMailNotice, setLastNewMailNotice] = useState<string | null>(null);
  const [notificationStatus, setNotificationStatus] = useState('系统提醒未检查');
  const [appBadgeStatus, setAppBadgeStatus] = useState('应用角标未同步');
  const [notificationPolicy, setNotificationPolicy] = useState<NotificationPolicy>(loadNotificationPolicy);
  const [sendUndoDelaySeconds, setSendUndoDelaySeconds] = useState<SendUndoDelaySeconds>(loadSendUndoDelaySeconds);
  const {
    contacts,
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
    contactQuery,
    setContactQuery,
    contactTransferBusy,
    filteredContacts,
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
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const benchmarkSyncRef = useRef(false);
  const {
    mailboxRefreshRef,
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
    listSort,
    folders,
    setMessages,
    setThreads,
    setMessageLimit,
    setHasMoreMessages,
    setSelectedId,
    setSelectedMessageIds,
    setFilter,
    setStatus,
    loadMeta,
    maybeRunBenchmarkSync,
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
    loadMeta,
    loadMessages,
    releaseDueSnoozedMessages,
  });
  const {
    activeProviderVerification,
    providerValidationReport,
    providerValidationRunning,
    updateProviderVerification,
    saveSettings,
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
  }

  function openComposer(nextDraft?: DraftInput, options: { restoreAutosave?: boolean } = {}) {
    if (nextDraft) {
      setDraft(nextDraft);
    } else if (options.restoreAutosave && isDraftEmpty(draft) && composerAutosave) {
      setDraft(composerAutosave.draft);
      setRichComposer(composerAutosave.isRichComposer);
      setStatus(`已恢复自动保存草稿：${formatDate(composerAutosave.saved_at)}`);
    }
    setComposerMinimized(false);
    setComposerOpen(true);
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
    const meta = await loadMeta(null, targetAccountId);
    const targetFolder =
      meta.folders.find((folder) => folder.account_id === targetAccountId && folder.role === role) ??
      meta.folders.find((folder) => folder.role === role);
    if (!targetFolder) {
      setStatus(`当前账号没有可用的${role === 'sent' ? '已发送' : '收件箱'}目录`);
      return;
    }
    setFolderId(targetFolder.id);
    const nextMessages = await loadMessages(
      targetFolder.id,
      activeValidationId,
      'all',
      targetAccountId,
      mailboxRefreshRef.current,
      messagePageSize,
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

  function composeToContact(contact: Contact) {
    openComposer({
      ...emptyDraft,
      account_id: account?.id ?? 0,
      to: contact.email,
    });
    setStatus(`正在给 ${contact.name || contact.email} 写邮件`);
  }

  function closeComposer() {
    setComposerOpen(false);
    setComposerMinimized(false);
  }

  function clearComposerAutosave() {
    removeAppStorage(composerAutosaveStorageKey);
    setComposerAutosave(null);
  }

  function draftInputForCurrentAccount(input: DraftInput): DraftInput {
    const resolvedAccountId = input.account_id || account?.id || accounts[0]?.id || 0;
    const resolvedIdentity = identityForDraft({ ...input, account_id: resolvedAccountId });
    return {
      ...input,
      account_id: resolvedAccountId,
      identity_id: input.identity_id || resolvedIdentity?.id || 0,
    };
  }

  function threadingForDraft(input: DraftInput) {
    const inReplyTo = input.in_reply_to?.trim() ?? '';
    const references = input.references?.trim() ?? '';
    return inReplyTo || references
      ? { in_reply_to: inReplyTo, references }
      : null;
  }

  function accountForDraft(input: DraftInput = draft): Account | null {
    const accountId = input.account_id || account?.id || accounts[0]?.id || 0;
    return accounts.find((entry) => entry.id === accountId) ?? account ?? accounts[0] ?? null;
  }

  function identitiesForDraftAccount(input: DraftInput = draft): MailIdentity[] {
    const accountId = input.account_id || account?.id || accounts[0]?.id || 0;
    return identities.filter((identity) => identity.account_id === accountId);
  }

  function identityForDraft(input: DraftInput = draft): MailIdentity | null {
    const draftIdentities = identitiesForDraftAccount(input);
    return (
      draftIdentities.find((identity) => identity.id === input.identity_id) ??
      draftIdentities.find((identity) => identity.is_default) ??
      draftIdentities[0] ??
      null
    );
  }

  function insertSignatureIntoDraft() {
    const signature = identityForDraft()?.signature.trim() || accountForDraft()?.signature.trim() || '';
    if (!signature) {
      setStatus('当前发件身份未设置签名');
      return;
    }
    if (draft.body.includes(signature)) {
      setStatus('签名已在正文中');
      return;
    }
    setDraft((current) => ({
      ...current,
      body: current.body.trimEnd() ? `${current.body.trimEnd()}\n\n${signature}` : signature,
      html_body: current.html_body.trim()
        ? `${current.html_body}<br><br>${signature.replace(/\n/g, '<br>')}`
        : current.html_body,
    }));
    setStatus('已插入当前发件身份签名');
  }

  function applyComposeTemplate(template: ComposeTemplate) {
    setDraft((current) => ({
      ...current,
      subject: template.subject,
      body: template.body,
      html_body: template.html_body,
    }));
    if (template.html_body.trim()) {
      setRichComposer(true);
    }
    setStatus(`已插入模板：${template.name}`);
  }

  function saveDraftAsTemplate() {
    const hasContent = draft.subject.trim() || draft.body.trim() || draft.html_body.trim();
    if (!hasContent) {
      setStatus('请先填写主题或正文后再保存模板');
      return;
    }
    const name = templateName.trim() || draft.subject.trim() || '未命名模板';
    const nextTemplate: ComposeTemplate = {
      id: crypto.randomUUID(),
      name,
      subject: draft.subject,
      body: draft.body,
      html_body: draft.html_body,
    };
    setComposeTemplates((current) => [nextTemplate, ...current.filter((item) => item.name !== name)].slice(0, 12));
    setTemplateName('');
    setStatus(`模板已保存：${name}`);
  }

  function deleteComposeTemplate(template: ComposeTemplate) {
    setComposeTemplates((current) => current.filter((item) => item.id !== template.id));
    setStatus(`模板已删除：${template.name}`);
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

  async function releaseDueSnoozedMessages() {
    return invoke<Message[]>('release_due_snoozed_messages', { now: new Date().toISOString() });
  }

  async function loadMeta(nextFolderId: number | null = folderId, nextScope: AccountScope = accountScope) {
    const released = await releaseDueSnoozedMessages();
    if (released.length > 0) {
      setStatus(`已恢复 ${released.length} 封到期稍后邮件`);
    }
    const nextAccountId = accountIdForScope(nextScope);
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
      invoke<Account>('get_account', { accountId: nextAccountId }),
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
    return { folderId: resolvedFolderId, folders: nextFolders };
  }

  async function updateAppUnreadBadge(unreadCount: number) {
    try {
      await getCurrentWindow().setBadgeCount(unreadCount > 0 ? unreadCount : undefined);
      setAppBadgeStatus(unreadCount > 0 ? `应用角标 ${unreadCount}` : '应用角标已清除');
    } catch {
      setAppBadgeStatus('当前平台不支持应用角标');
    }
  }

  async function maybeRunBenchmarkSync() {
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

  useEffect(() => {
    window.localStorage.setItem(notificationPolicyStorageKey, JSON.stringify(notificationPolicy));
  }, [notificationPolicy]);

  useEffect(() => {
    window.localStorage.setItem(sendUndoDelayStorageKey, String(sendUndoDelaySeconds));
  }, [sendUndoDelaySeconds]);

  useEffect(() => {
    window.localStorage.setItem(listSortStorageKey, listSort);
  }, [listSort]);

  useEffect(() => {
    window.localStorage.setItem(providerVerificationStorageKey, JSON.stringify(providerVerifications));
  }, [providerVerifications]);

  useEffect(() => {
    window.localStorage.setItem(savedSearchesStorageKey, JSON.stringify(savedSearches));
  }, [savedSearches]);

  useEffect(() => {
    window.localStorage.setItem(composeTemplatesStorageKey, JSON.stringify(composeTemplates));
  }, [composeTemplates]);

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
    if (!isComposerOpen || isDraftEmpty(draft)) return;
    const autosave: ComposerAutosave = {
      draft,
      isRichComposer,
      saved_at: new Date().toISOString(),
    };
    window.localStorage.setItem(composerAutosaveStorageKey, JSON.stringify(autosave));
    setComposerAutosave(autosave);
  }, [draft, isRichComposer, isComposerOpen]);

  useEffect(() => {
    if (!isComposerOpen) return undefined;
    let active = true;
    let unlisten: (() => void) | undefined;

    getCurrentWindow().onDragDropEvent(async (event) => {
      if (!active) return;
      if (event.type === 'enter' || event.type === 'over') {
        setComposerDropActive(true);
        return;
      }
      if (event.type === 'leave') {
        setComposerDropActive(false);
        return;
      }
      setComposerDropActive(false);
      const paths = event.paths.filter((path) => path.trim());
      if (paths.length === 0) {
        setStatus('拖拽内容中没有文件');
        return;
      }
      try {
        const newAttachments = await invoke<OutboundAttachmentInput[]>('outbound_attachments_from_paths', { paths });
        addDraftAttachments(newAttachments, '已拖入附件');
      } catch (error) {
        setStatus(`附件拖入失败：${String(error)}`);
      }
    })
      .then((nextUnlisten) => {
        unlisten = nextUnlisten;
      })
      .catch((error) => {
        setStatus(`附件拖拽不可用：${String(error)}`);
      });

    return () => {
      active = false;
      setComposerDropActive(false);
      unlisten?.();
    };
  }, [isComposerOpen]);

  useEffect(() => {
    refreshMailbox(accountScope, null).catch((error) => setStatus(String(error)));
  }, [accountScope]);

  useEffect(() => {
    if (!folderId) return;
    loadMessages(folderId, query, filter, accountScope, mailboxRefreshRef.current, messagePageSize).catch((error) => setStatus(String(error)));
  }, [folderId, filter, listSort]);

  useEffect(() => {
    setQuickReplyBody('');
  }, [selectedId]);

  const selected = useMemo(
    () => messages.find((message) => message.id === selectedId) ?? null,
    [messages, selectedId],
  );
  const selectedMessageSet = useMemo(() => new Set(selectedMessageIds), [selectedMessageIds]);
  const selectedMessages = useMemo(
    () => messages.filter((message) => selectedMessageSet.has(message.id)),
    [messages, selectedMessageSet],
  );
  const allVisibleSelected = messages.length > 0 && selectedMessageIds.length === messages.length;
  const activeFilterLabel = filters.find((item) => item.id === filter)?.label ?? '全部';
  const unreadTotal = stats?.unread_messages ?? 0;
  const messageListSummary = stats
    ? `${stats.total_messages} 封 · ${unreadTotal} 未读`
    : `${messages.length} 封`;
  const visibleListSummary = hasMoreMessages ? `${messages.length}+ 封` : `${messages.length} 封`;
  const currentViewLabel = folders.find((folder) => folder.id === folderId)?.name ?? '邮件';
  const activeThreadSelected = activeThread
    ? threadMessages.find((message) => message.id === selectedId) ?? threadMessages[0] ?? selected
    : selected;
  const selectedSenderDomain = useMemo(
    () => (selected ? senderDomain(selected.sender_email) : ''),
    [selected?.sender_email],
  );
  const selectedHasRemoteImageWarning = Boolean(
    selected?.security_warnings.some((warning) => warning.includes('远程图片')),
  );
  const selectedHasImagePreview = Boolean(selected?.sanitized_html.includes('<img'));
  const selectedSenderTrusted = useMemo(
    () =>
      Boolean(
        selected &&
          remoteImageTrusts.some(
            (trust) =>
              trust.account_id === selected.account_id &&
              ((trust.scope === 'sender' && trust.value === selected.sender_email.trim().toLowerCase()) ||
                (trust.scope === 'domain' && trust.value === selectedSenderDomain)),
          ),
      ),
    [remoteImageTrusts, selected?.account_id, selected?.sender_email, selectedSenderDomain],
  );
  useEffect(() => {
    if (!selected) {
      setAttachments([]);
      return;
    }
    invoke<Attachment[]>('list_attachments', { messageId: selected.id })
      .then(setAttachments)
      .catch((error) => setStatus(String(error)));
  }, [selectedId]);

  useEffect(() => {
    if (!isSettingsOpen || activeSettingsSection !== 'backup') return;
    refreshStorageUsage(false).catch((error) => setStatus(String(error)));
  }, [isSettingsOpen, activeSettingsSection]);

  async function refreshAll() {
    const meta = await loadMeta(folderId);
    await loadMessagesWithVisibleFallback(meta.folderId, query, filter, accountScope, mailboxRefreshRef.current, meta.folders, messagePageSize);
    if (activeThread) {
      await openThread(activeThread, false);
    }
    setStatus('已刷新本地邮箱数据');
  }

  async function openThread(thread: ThreadSummary, announce = true) {
    const nextMessages = await invoke<Message[]>('list_thread_messages', {
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
  }

  function toggleMessageSelection(messageId: number, checked: boolean) {
    setSelectedMessageIds((current) => {
      if (checked) return current.includes(messageId) ? current : [...current, messageId];
      return current.filter((id) => id !== messageId);
    });
  }

  function toggleAllVisibleMessages(checked: boolean) {
    setSelectedMessageIds(checked ? messages.map((message) => message.id) : []);
  }

  function snapshotMessages(items: Message[]): UndoMessageSnapshot[] {
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
    runBulkAction,
    runThreadAction,
    moveSelectedMessagesToFolder,
    moveThreadToFolder,
    toggleBulkLabel,
    toggleThreadLabel,
    toggleThreadMuted,
  } = useMessageCollectionActions({
    folders,
    selectedMessages,
    refreshAll,
    setActiveThread,
    setSelectedMessageIds,
    setStatus,
    snapshotMessages,
    queueUndoAction,
  });

  async function restoreUndoAction() {
    const action = consumeUndoAction();
    if (!action) return;
    for (const snapshot of action.snapshots) {
      if (snapshot.folder_role === 'snoozed' && snapshot.snoozed_until) {
        await invoke('snooze_message', { messageId: snapshot.id, snoozedUntil: snapshot.snoozed_until });
      } else {
        await invoke('move_message_to_role', { messageId: snapshot.id, role: snapshot.folder_role });
      }
      await invoke('set_message_read', { messageId: snapshot.id, isRead: snapshot.is_read });
      await invoke('set_message_starred', { messageId: snapshot.id, isStarred: snapshot.is_starred });
      for (const label of labels) {
        const shouldHaveLabel = snapshot.labels.includes(label.name);
        await invoke(shouldHaveLabel ? 'apply_label_to_message' : 'remove_label_from_message', {
          messageId: snapshot.id,
          labelId: label.id,
        });
      }
    }
    setSelectedMessageIds([]);
    const firstSnapshot = action.snapshots[0];
    const restoredFolderId = firstSnapshot
      ? visibleFolderIdForRole(firstSnapshot.folder_role, firstSnapshot.account_id) ?? folderId
      : folderId;
    await loadMeta(restoredFolderId);
    await loadMessages(restoredFolderId);
    setSelectedId(firstSnapshot?.id ?? null);
    setStatus(`已撤销：${action.title}`);
  }

  async function moveMessagesToFolderByIds(folder: Folder, messageIds: number[]) {
    const uniqueMessageIds = [...new Set(messageIds)];
    const messageById = new Map(messages.map((message) => [message.id, message]));
    const draggedMessages = uniqueMessageIds
      .map((messageId) => messageById.get(messageId))
      .filter((message): message is Message => Boolean(message));

    if (draggedMessages.length === 0) {
      setStatus('没有找到可移动的邮件');
      return;
    }

    const canMoveToFolder = movableFoldersForBulk(folders, draggedMessages)
      .some((candidate) => candidate.id === folder.id);
    if (!canMoveToFolder) {
      const accountCount = new Set(draggedMessages.map((message) => message.account_id)).size;
      setStatus(accountCount > 1 ? '不同账号的邮件不能拖到同一文件夹' : '此文件夹不能接收拖拽邮件');
      return;
    }

    const messagesToMove = draggedMessages.filter((message) => message.folder_role !== folder.role);
    if (messagesToMove.length === 0) {
      setStatus(`邮件已在 ${folder.name}`);
      return;
    }

    const undoSnapshots = snapshotMessages(messagesToMove);
    for (const message of messagesToMove) {
      await invoke('move_message_to_role', { messageId: message.id, role: folder.role });
    }

    const movedMessageIds = new Set(messagesToMove.map((message) => message.id));
    setSelectedMessageIds([]);
    if (selectedId !== null && movedMessageIds.has(selectedId)) setSelectedId(null);
    await refreshAll();
    setStatus(`已拖动到 ${folder.name}：${messagesToMove.length} 封邮件`);
    queueUndoAction(`移动到 ${folder.name}`, undoSnapshots, `${messagesToMove.length} 封邮件`);
  }

  function requestSnooze(items: Message[]) {
    const targetMessages = [...new Map(
      items
        .filter((message) => canSnoozeRole(message.folder_role))
        .map((message) => [message.id, message]),
    ).values()];
    if (targetMessages.length === 0) {
      setStatus('所选邮件无法稍后处理');
      return;
    }
    setCommandPaletteOpen(false);
    setSnoozeTarget({
      messages: targetMessages,
      label: targetMessages.length === 1
        ? targetMessages[0].subject || '(无主题)'
        : `${targetMessages.length} 封邮件`,
    });
  }

  async function confirmSnooze(snoozedUntil: string) {
    const target = snoozeTarget;
    const timestamp = Date.parse(snoozedUntil);
    if (!target || Number.isNaN(timestamp) || timestamp <= Date.now()) {
      setStatus('请选择一个晚于当前时间的稍后处理时间');
      return;
    }

    const undoSnapshots = snapshotMessages(target.messages);
    for (const message of target.messages) {
      await invoke<Message>('snooze_message', { messageId: message.id, snoozedUntil });
    }

    const targetIds = new Set(target.messages.map((message) => message.id));
    setSnoozeTarget(null);
    setSelectedMessageIds((current) => current.filter((messageId) => !targetIds.has(messageId)));
    if (selectedId !== null && targetIds.has(selectedId)) setSelectedId(null);
    if (threadMessages.some((message) => targetIds.has(message.id))) {
      setActiveThread(null);
      setThreadMessages([]);
    }
    await refreshAll();

    const count = target.messages.length;
    setStatus(
      count === 1
        ? `已稍后处理到 ${formatDate(snoozedUntil)}`
        : `已将 ${count} 封邮件稍后处理到 ${formatDate(snoozedUntil)}`,
    );
    queueUndoAction('稍后处理', undoSnapshots, count > 1 ? `${count} 封邮件` : undefined);
  }

  async function runMessageAction(message: Message, action: MessageContextAction) {
    if (action === 'copy-sender' || action === 'copy-subject') {
      const copySender = action === 'copy-sender';
      const value = copySender ? message.sender_email : message.subject;
      await copyTextToClipboard(value);
      setStatus(copySender ? `已复制发件人邮箱：${value}` : `已复制邮件主题：${value}`);
      return;
    }

    if (action === 'read' || action === 'unread') {
      const shouldRead = action === 'read';
      if (message.is_read !== shouldRead) await toggleRead(message);
      return;
    }
    if (action === 'star' || action === 'unstar') {
      const shouldStar = action === 'star';
      if (message.is_starred !== shouldStar) await toggleStar(message);
      return;
    }

    if (action === 'snooze') {
      requestSnooze([message]);
      return;
    }

    const undoSnapshots = snapshotMessages([message]);
    if (action === 'permanent-delete') {
      const report = await invoke<RemoteActionReport>('delete_message_permanently', { messageId: message.id });
      setSelectedId(null);
      await refreshAll();
      setStatus(report.message);
      return;
    }

    if (action === 'restore' || action === 'not-spam') {
      const result = await invoke<RestoreMessageReport>('restore_message_to_inbox', { messageId: message.id });
      setSelectedId(null);
      await refreshAll();
      const actionLabel = action === 'restore' ? '恢复到收件箱' : '标记为不是垃圾邮件';
      setStatus(action === 'restore' ? result.remote.message : `已${actionLabel}：${message.subject || '(无主题)'}`);
      queueUndoAction(actionLabel, undoSnapshots, result.remote.message);
      return;
    }

    if (action === 'unsnooze') {
      await invoke<Message>('unsnooze_message', { messageId: message.id });
      setSelectedId(null);
      await refreshAll();
      setStatus(`已取消稍后处理：${message.subject || '(无主题)'}`);
      queueUndoAction('取消稍后处理', undoSnapshots);
      return;
    }

    const targetRole = action === 'spam' ? 'spam' : action;
    await invoke('move_message_to_role', { messageId: message.id, role: targetRole });
    setSelectedId(null);
    await refreshAll();
    const actionLabel =
      action === 'archive'
        ? '归档'
        : action === 'spam'
          ? '标为垃圾邮件'
          : '移到废纸篓';
    setStatus(`已${actionLabel}：${message.subject || '(无主题)'}`);
    queueUndoAction(actionLabel, undoSnapshots);
  }

  async function moveMessageToFolder(message: Message, folder: Folder) {
    const undoSnapshots = snapshotMessages([message]);
    await invoke('move_message_to_role', { messageId: message.id, role: folder.role });
    setSelectedId(null);
    await refreshAll();
    setStatus(`已移动到 ${folder.name}：${message.subject || '(无主题)'}`);
    queueUndoAction(`移动到 ${folder.name}`, undoSnapshots);
  }

  async function toggleMessageLabel(message: Message, label: Label) {
    const undoSnapshots = snapshotMessages([message]);
    const hasLabel = message.labels.includes(label.name);
    await invoke(hasLabel ? 'remove_label_from_message' : 'apply_label_to_message', {
      messageId: message.id,
      labelId: label.id,
    });
    await refreshAll();
    setStatus(`${hasLabel ? '已移除' : '已添加'}标签 ${label.name}`);
    queueUndoAction(`${hasLabel ? '移除' : '添加'}标签 ${label.name}`, undoSnapshots);
  }

  async function toggleRead(message: Message) {
    const undoSnapshots = snapshotMessages([message]);
    const report = await invoke<RemoteActionReport>('set_message_read', { messageId: message.id, isRead: !message.is_read });
    await refreshAll();
    setStatus(report.message);
    queueUndoAction(message.is_read ? '标为未读' : '标为已读', undoSnapshots);
  }

  async function toggleStar(message: Message) {
    const undoSnapshots = snapshotMessages([message]);
    const report = await invoke<RemoteActionReport>('set_message_starred', {
      messageId: message.id,
      isStarred: !message.is_starred,
    });
    await refreshAll();
    setStatus(report.message);
    queueUndoAction(message.is_starred ? '取消星标' : '添加星标', undoSnapshots);
  }

  async function moveSelected(role: FolderRole) {
    if (!selected) return;
    const undoSnapshots = snapshotMessages([selected]);
    const report = await invoke<RemoteActionReport>('move_message_to_role', { messageId: selected.id, role });
    const targetFolderId = visibleFolderIdForRole(role, selected.account_id) ?? folderId;
    await loadMeta(targetFolderId);
    await loadMessages(targetFolderId);
    setSelectedId(selected.id);
    setStatus(report.message);
    queueUndoAction(role === 'trash' ? '删除' : role === 'archive' ? '归档' : `移动到 ${role}`, undoSnapshots);
  }

  async function moveSelectedToFolder(folder: Folder) {
    if (!selected) return;
    const undoSnapshots = snapshotMessages([selected]);
    const report = await invoke<RemoteActionReport>('move_message_to_role', { messageId: selected.id, role: folder.role });
    await loadMeta(folder.id);
    await loadMessages(folder.id);
    setSelectedId(selected.id);
    setStatus(`已移动到 ${folder.name}`);
    queueUndoAction(`移动到 ${folder.name}`, undoSnapshots, report.message);
  }

  async function markSelectedAsSpam() {
    if (!selected) return;
    const undoSnapshots = snapshotMessages([selected]);
    await invoke('move_message_to_role', { messageId: selected.id, role: 'spam' });
    const spamFolderId = visibleFolderIdForRole('spam', selected.account_id) ?? folderId;
    await loadMeta(spamFolderId);
    await loadMessages(spamFolderId);
    setSelectedId(selected.id);
    setStatus('已标为垃圾邮件');
    queueUndoAction('标为垃圾邮件', undoSnapshots);
  }

  async function markSelectedNotSpam() {
    if (!selected) return;
    const undoSnapshots = snapshotMessages([selected]);
    const result = await invoke<RestoreMessageReport>('restore_message_to_inbox', { messageId: selected.id });
    const inboxFolderId = visibleFolderIdForRole('inbox', result.restored.account_id) ?? folderId;
    await loadMeta(inboxFolderId);
    await loadMessages(inboxFolderId);
    setSelectedId(result.restored.id);
    setStatus('已移回收件箱，并标记为不是垃圾邮件');
    queueUndoAction('不是垃圾邮件', undoSnapshots, result.remote.message);
  }

  async function restoreSelectedFromTrash() {
    if (!selected) return;
    const undoSnapshots = snapshotMessages([selected]);
    const result = await invoke<RestoreMessageReport>('restore_message_to_inbox', { messageId: selected.id });
    const inboxFolderId = visibleFolderIdForRole('inbox', result.restored.account_id) ?? folderId;
    await loadMeta(inboxFolderId);
    await loadMessages(inboxFolderId);
    setSelectedId(result.restored.id);
    setStatus(result.remote.message);
    queueUndoAction('恢复到收件箱', undoSnapshots, result.remote.message);
  }

  async function permanentlyDeleteSelected() {
    if (!selected) return;
    const report = await invoke<RemoteActionReport>('delete_message_permanently', { messageId: selected.id });
    await refreshAll();
    setStatus(report.message);
  }

  async function emptyCurrentTrash() {
    const report = await invoke<TrashActionReport>('empty_trash', { accountId: accountIdForScope(accountScope) });
    await refreshAll();
    setStatus(report.message);
  }

  async function createCustomFolder() {
    const name = customFolderName.trim();
    if (!name) {
      setStatus('请输入自定义文件夹名称');
      return;
    }
    const accountId = currentFolderAccountId();
    if (!accountId) {
      setStatus('请先创建或选择邮箱账号');
      return;
    }
    const folder = await invoke<Folder>('create_custom_folder', { accountId, name });
    setCustomFolderName('');
    const { folderId: nextFolderId } = await loadMeta(folderId);
    await loadMessages(nextFolderId);
    setStatus(`已创建文件夹：${folder.name}`);
  }

  function startRenameCustomFolder(folder: Folder) {
    setRenamingFolderId(folder.id);
    setRenamingFolderName(folder.name);
  }

  async function renameCustomFolder(folder: Folder) {
    const name = renamingFolderName.trim();
    if (!name) {
      setStatus('请输入新的文件夹名称');
      return;
    }
    const renamed = await invoke<Folder>('rename_custom_folder', { folderId: folder.id, name });
    setRenamingFolderId(null);
    setRenamingFolderName('');
    const { folderId: nextFolderId } = await loadMeta(folderId);
    await loadMessages(nextFolderId);
    setStatus(`已重命名文件夹：${renamed.name}`);
  }

  async function deleteCustomFolder(folder: Folder) {
    await invoke('delete_custom_folder', { folderId: folder.id });
    const inboxFolderId = visibleFolderIdForRole('inbox', folder.account_id);
    const { folderId: nextFolderId } = await loadMeta(folderId === folder.id ? inboxFolderId : folderId);
    await loadMessages(nextFolderId);
    setStatus(`已删除文件夹：${folder.name}，其中邮件已移回收件箱`);
  }

  async function markFolderRead(folder: Folder) {
    const report = await invoke<FolderReadReport>('mark_folder_read', {
      folderId: folder.id,
      role: folder.role,
      isVirtual: folder.is_virtual,
    });
    await refreshAll();
    setStatus(report.message);
  }

  async function snoozeSelected() {
    if (!selected) return;
    requestSnooze([selected]);
  }

  async function unsnoozeSelected() {
    if (!selected) return;
    const undoSnapshots = snapshotMessages([selected]);
    const updated = await invoke<Message>('unsnooze_message', { messageId: selected.id });
    const inboxFolderId = visibleFolderIdForRole('inbox', updated.account_id) ?? folderId;
    await loadMeta(inboxFolderId);
    await loadMessages(inboxFolderId);
    setSelectedId(updated.id);
    setStatus('已取消稍后处理');
    queueUndoAction('取消稍后处理', undoSnapshots);
  }

  async function toggleLabel(label: Label) {
    if (!selected) return;
    const undoSnapshots = snapshotMessages([selected]);
    const hasLabel = selected.labels.includes(label.name);
    await invoke(hasLabel ? 'remove_label_from_message' : 'apply_label_to_message', {
      messageId: selected.id,
      labelId: label.id,
    });
    await refreshAll();
    setStatus(hasLabel ? `已移除标签：${label.name}` : `已添加标签：${label.name}`);
    queueUndoAction(hasLabel ? `移除标签 ${label.name}` : `添加标签 ${label.name}`, undoSnapshots);
  }

  async function pickDraftAttachments() {
    const newAttachments = await invoke<OutboundAttachmentInput[]>('pick_outbound_attachments');
    if (newAttachments.length === 0) {
      setStatus('已取消选择附件');
      return;
    }
    addDraftAttachments(newAttachments, '已添加附件');
  }

  function addDraftAttachments(newAttachments: OutboundAttachmentInput[], statusPrefix = '已添加附件') {
    const validAttachments = newAttachments.filter((attachment) => attachment.filename.trim());
    if (validAttachments.length === 0) {
      setStatus('没有可添加的附件');
      return;
    }
    setDraft((current) => ({
      ...current,
      attachments: [...current.attachments, ...validAttachments],
    }));
    setStatus(`${statusPrefix} ${validAttachments.length} 个`);
  }

  function attachmentsFromDroppedFiles(files: FileList): OutboundAttachmentInput[] {
    return Array.from(files).map((file) => {
      const droppedFile = file as DroppedFile;
      return {
        filename: file.name || 'attachment',
        mime_type: file.type || 'application/octet-stream',
        size_bytes: Math.min(file.size, Number.MAX_SAFE_INTEGER),
        local_path: droppedFile.path || file.name || 'dropped-attachment',
      };
    });
  }

  function handleComposerAttachmentDrop(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    setComposerDropActive(false);
    const files = event.dataTransfer.files;
    if (!files || files.length === 0) {
      setStatus('拖拽内容中没有文件');
      return;
    }
    addDraftAttachments(attachmentsFromDroppedFiles(files), '已拖入附件');
  }

  function handleComposerAttachmentPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = event.clipboardData.files;
    if (!files || files.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    addDraftAttachments(attachmentsFromDroppedFiles(files), '已粘贴附件');
  }

  function handleComposerAttachmentDragOver(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }

  function handleComposerAttachmentDragEnter(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    setComposerDropActive(true);
  }

  function handleComposerAttachmentDragLeave(event: React.DragEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setComposerDropActive(false);
    }
  }

  function removeDraftAttachment(index: number) {
    setDraft((current) => ({
      ...current,
      attachments: current.attachments.filter((_, currentIndex) => currentIndex !== index),
    }));
    setStatus('已移除附件');
  }

  async function saveIdentity() {
    if (!accountForm) return;
    const saved = await invoke<MailIdentity>('upsert_identity', {
      input: { ...identityForm, account_id: accountForm.id },
    });
    setIdentities((current) => {
      const scoped = current.filter((identity) => identity.account_id !== saved.account_id || identity.id !== saved.id);
      const updated = saved.is_default
        ? scoped.map((identity) =>
            identity.account_id === saved.account_id ? { ...identity, is_default: false } : identity,
          )
        : scoped;
      return [...updated, saved].sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.id - b.id);
    });
    setIdentityForm(emptyIdentityForm);
    setStatus(`发件身份已保存：${saved.name} <${saved.email}>`);
  }

  function editIdentity(identity: MailIdentity) {
    setIdentityForm({
      id: identity.id,
      account_id: identity.account_id,
      name: identity.name,
      email: identity.email,
      reply_to: identity.reply_to,
      signature: identity.signature,
      is_default: identity.is_default,
    });
    setStatus(`正在编辑发件身份：${identity.email}`);
  }

  async function deleteIdentity(identity: MailIdentity) {
    await invoke('delete_identity', { identityId: identity.id });
    setIdentities((current) => current.filter((item) => item.id !== identity.id));
    setStatus(`发件身份已删除：${identity.email}`);
  }

  async function saveDraft() {
    if (isDraftEmpty(draft)) {
      setStatus('草稿为空，未保存');
      return;
    }
    const report = await invoke<DraftSaveReport>('save_draft', {
      input: draftInputForCurrentAccount(draft),
      threading: threadingForDraft(draft),
    });
    setDraft(emptyDraft);
    clearComposerAutosave();
    closeComposer();
    await refreshAll();
    setStatus(report.message);
  }

  async function sendDraft() {
    if (!draft.to.trim()) {
      setStatus('请先填写收件人');
      return;
    }
    const subject = draft.subject.trim() || '(无主题)';
    if (sendUndoDelaySeconds === 0) {
      await invoke('send_message', {
        input: { ...draftInputForCurrentAccount(draft), draft_id: 0 },
        threading: threadingForDraft(draft),
      });
      setDraft(emptyDraft);
      clearComposerAutosave();
      closeComposer();
      await refreshAll();
      setStatus('邮件已进入已发送，本地发送流转验证通过');
      return;
    }

    const expiresAt = new Date(Date.now() + sendUndoDelaySeconds * 1000).toISOString();
    const item = await invoke<OutboxItem>('queue_outbox_message', {
      input: {
        ...draftInputForCurrentAccount(draft),
        draft_id: 0,
        send_at: expiresAt,
      },
      threading: threadingForDraft(draft),
    });
    setOutbox((current) => [item, ...current.filter((entry) => entry.id !== item.id)]);
    setPendingSendUndo({
      outboxId: item.id,
      subject,
      expiresAt,
      delaySeconds: sendUndoDelaySeconds,
    });
    setDraft(emptyDraft);
    clearComposerAutosave();
    closeComposer();
    await refreshAll();
    setStatus(`邮件将在 ${sendUndoDelaySeconds} 秒后发送，可立即撤回`);
  }

  async function sendQuickReply(message: Message) {
    const body = quickReplyBody.trim();
    if (!body) {
      setStatus('请先填写快速回复正文');
      return;
    }
    await invoke('send_message', {
      input: {
        draft_id: 0,
        account_id: message.account_id,
        identity_id: 0,
        to: message.sender_email,
        cc: '',
        bcc: '',
        subject: prefixedSubject(message.subject, 'Re'),
        body: `${body}${quoteMessage(message)}`,
        html_body: '',
        send_at: '',
        attachments: [],
      },
      threading: replyThreadingHeaders(message),
    });
    setQuickReplyBody('');
    await refreshAll();
    setStatus(`已快速回复：${message.sender_name || message.sender_email}`);
  }

  async function queueDraft() {
    if (!draft.to.trim()) {
      setStatus('请先填写收件人');
      return;
    }
    const sendAt = draft.send_at.trim();
    const input = {
      ...draftInputForCurrentAccount(draft),
      draft_id: 0,
      send_at: sendAt ? new Date(sendAt).toISOString() : '',
    };
    await invoke<OutboxItem>('queue_outbox_message', {
      input,
      threading: threadingForDraft(draft),
    });
    setDraft(emptyDraft);
    clearComposerAutosave();
    closeComposer();
    await refreshAll();
    setStatus(sendAt ? `邮件已安排稍后发送：${formatDate(input.send_at)}` : '邮件已加入发件箱队列');
  }

  async function cancelOutboxItem(item: OutboxItem) {
    const updated = await invoke<OutboxItem>('cancel_outbox_item', { outboxId: item.id });
    setOutbox((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
    setPendingSendUndo((current) => (current?.outboxId === item.id ? null : current));
    await loadMeta(folderId);
    setStatus('已撤回到草稿箱');
  }

  async function undoPendingSend() {
    const pending = pendingSendUndo;
    if (!pending) return;
    setPendingSendUndo(null);
    const updated = await invoke<OutboxItem>('cancel_outbox_item', { outboxId: pending.outboxId });
    setOutbox((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
    await refreshAll();
    setStatus(`已撤回发送：${pending.subject}`);
  }

  async function composeFromMessage(message: Message, mode: 'reply' | 'replyAll' | 'forward') {
    const threading = mode === 'forward' ? null : replyThreadingHeaders(message);
    const replyRecipients = mode === 'forward' ? '' : message.sender_email;
    const includeOriginalRecipients =
      mode === 'replyAll'
        ? message.recipients
            .split(/[;,]/)
            .map((recipient) => recipient.trim())
            .filter((recipient) => recipient && recipient !== account?.email)
            .join(', ')
        : '';
    let forwardPlan = buildForwardAttachmentPlan([]);
    if (mode === 'forward' && message.has_attachments) {
      try {
        const sourceAttachments = await invoke<Attachment[]>('list_attachments', {
          messageId: message.id,
        });
        forwardPlan = buildForwardAttachmentPlan(
          sourceAttachments,
          message.attachment_count,
        );
      } catch {
        forwardPlan = {
          attachments: [],
          unavailableCount: message.attachment_count,
          totalCount: message.attachment_count,
        };
      }
    }
    openComposer({
      draft_id: 0,
      account_id: message.account_id,
      identity_id: 0,
      to: replyRecipients,
      cc: includeOriginalRecipients,
      bcc: '',
      subject: prefixedSubject(message.subject, mode === 'forward' ? 'Fwd' : 'Re'),
      body: quoteMessage(message),
      html_body: '',
      send_at: '',
      attachments: mode === 'forward' ? forwardPlan.attachments : [],
      in_reply_to: threading?.in_reply_to ?? '',
      references: threading?.references ?? '',
    });
    setStatus(
      mode === 'forward'
        ? forwardAttachmentStatus(forwardPlan)
        : mode === 'replyAll'
          ? '已创建回复全部草稿'
          : '已创建回复草稿',
    );
  }

  async function editDraftMessage(message: Message) {
    const draftAttachments = await invoke<Attachment[]>('list_attachments', { messageId: message.id });
    openComposer({
      draft_id: message.id,
      account_id: message.account_id,
      identity_id: 0,
      to: message.recipients,
      cc: message.cc,
      bcc: message.bcc,
      subject: message.subject,
      body: message.body,
      html_body: message.sanitized_html,
      send_at: '',
      in_reply_to: message.in_reply_to_header ?? '',
      references: message.references_header ?? '',
      attachments: draftAttachments.map((attachment) => ({
        filename: attachment.filename,
        mime_type: attachment.mime_type,
        size_bytes: attachment.size_bytes,
        local_path: attachment.local_path,
      })),
    });
    setStatus('已打开草稿继续编辑');
  }

  function openContactEditor(contact: Contact) {
    startEditContact(contact);
    setActiveSettingsSection('contacts');
    setSettingsOpen(true);
  }

  function addContactToDraft(contact: Contact, field: 'to' | 'cc' | 'bcc' = 'to') {
    const existing = draft[field]
      .split(/[;,]/)
      .map((recipient) => recipient.trim())
      .filter(Boolean);
    const contactAddresses = [contact.email, ...(contact.aliases ?? [])].map((item) => item.trim().toLowerCase()).filter(Boolean);
    if (existing.some((recipient) => contactAddresses.includes(recipient.toLowerCase()))) {
      setStatus(`联系人已在${field === 'to' ? '收件人' : field === 'cc' ? '抄送' : '密送'}中：${contact.email}`);
      return;
    }
    const nextRecipients = [...existing, contact.email].join(', ');
    setDraft({ ...draft, [field]: nextRecipients });
    setStatus(`已添加联系人：${contact.name || contact.email}`);
  }

  async function exportDiagnostics() {
    const payload = await invoke<string>('export_diagnostics');
    setDiagnosticExport(payload);
    try {
      await navigator.clipboard.writeText(payload);
      setStatus('脱敏诊断 JSON 已生成并复制到剪贴板');
    } catch {
      setStatus('脱敏诊断 JSON 已生成，当前环境无法自动复制');
    }
  }

  async function exportLocalBackup() {
    const summary = await invoke<LocalBackupSummary>('export_local_backup');
    setLocalBackupSummary(summary);
    setStatus(`本地备份已导出：${summary.messages} 封邮件，${summary.accounts} 个账号`);
  }

  async function previewLocalBackup() {
    const summary = await invoke<LocalBackupSummary | null>('preview_local_backup');
    if (!summary) {
      setStatus('已取消选择备份文件');
      return;
    }
    setLocalBackupSummary(summary);
    setStatus(`已读取备份预览：${summary.messages} 封邮件，${summary.accounts} 个账号`);
  }

  async function importLocalBackup() {
    const summary = await invoke<LocalBackupSummary | null>('import_local_backup');
    if (!summary) {
      setStatus('已取消恢复本地备份');
      return;
    }
    setLocalBackupSummary(summary);
    const { folderId: nextFolderId } = await loadMeta(null);
    await loadMessages(nextFolderId);
    setStatus(`本地备份已恢复：${summary.messages} 封邮件，${summary.accounts} 个账号`);
  }

  async function refreshStorageUsage(announce = true) {
    setStorageBusy(true);
    try {
      const usage = await invoke<StorageUsage>('get_storage_usage');
      setStorageUsage(usage);
      if (announce) {
          setStatus(`本地存储已刷新：共 ${formatBytes(usage.total_managed_bytes)}`);
      }
    } catch (error) {
      setStatus(`读取本地存储失败：${String(error).replace(/^Error:\s*/i, '')}`);
      throw error;
    } finally {
      setStorageBusy(false);
    }
  }

  async function clearAttachmentCache() {
    setStorageBusy(true);
    try {
      const result = await invoke<CacheClearResult>('clear_attachment_cache');
      setStorageUsage(result.storage);
      if (selected) {
        const refreshedAttachments = await invoke<Attachment[]>('list_attachments', {
          messageId: selected.id,
        });
        setAttachments(refreshedAttachments);
      }
      setStatus(
        result.released_bytes > 0
          ? `已释放 ${formatBytes(result.released_bytes)}，${result.reset_attachment_count} 个远端附件可按需重新下载`
          : '当前没有可清理的远端附件缓存',
      );
    } catch (error) {
      setStatus(`清理附件缓存失败：${String(error).replace(/^Error:\s*/i, '')}`);
      throw error;
    } finally {
      setStorageBusy(false);
    }
  }

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
    const meta = await loadMeta(null);
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
    setFolderId(inboxFolderId);
    setSelectedId(imported.id);
    setStatus(`已导入 EML：${imported.subject || '(无主题)'}`);
  }

  async function fetchSelectedBody() {
    if (!selected) return;
    const updated = await invoke<Message>('fetch_message_body', { messageId: selected.id });
    setMessages((current) => current.map((message) => (message.id === updated.id ? updated : message)));
    const refreshedAttachments = await invoke<Attachment[]>('list_attachments', { messageId: updated.id });
    setAttachments(refreshedAttachments);
    setStatus('远端正文已拉取并缓存到本地');
  }

  async function renderSelectedWithRemoteImagePolicy(messageId = selected?.id) {
    if (!messageId) return;
    const updated = await invoke<Message>('render_message_with_remote_image_policy', { messageId });
    setMessages((current) => current.map((message) => (message.id === updated.id ? updated : message)));
  }

  async function trustRemoteImagesForSelected(scope: 'sender' | 'domain') {
    if (!selected) return;
    const input = remoteImageTrustInput(selected.account_id, selected.sender_email, scope);
    if (!input.value) {
      setStatus('当前发件人地址不完整，无法加入远程图片信任列表');
      return;
    }
    const trust = await invoke<RemoteImageTrust>('trust_remote_images', { input });
    setRemoteImageTrusts((current) => {
      const withoutDuplicate = current.filter((item) => item.id !== trust.id);
      return [...withoutDuplicate, trust].sort((a, b) => `${a.scope}:${a.value}`.localeCompare(`${b.scope}:${b.value}`));
    });
    await renderSelectedWithRemoteImagePolicy(selected.id);
    setStatus(scope === 'sender' ? `已信任发件人远程图片：${trust.value}` : `已信任域名远程图片：${trust.value}`);
  }

  async function blockSelectedSender() {
    if (!selected?.sender_email.trim()) {
      setStatus('当前发件人地址不完整，无法阻止');
      return;
    }
    const sender = selected.sender_email.trim().toLowerCase();
    const saved = await invoke<MailRule>('upsert_rule', {
      ruleId: null,
      input: {
        name: `阻止 ${sender}`,
        condition: `from contains ${sender}`,
        action: 'move to spam; stop',
        enabled: true,
      },
    });
    setRules((current) => [...current.filter((rule) => rule.id !== saved.id), saved]);
    await invoke('move_message_to_role', { messageId: selected.id, role: 'spam' });
    const spamFolderId = visibleFolderIdForRole('spam', selected.account_id) ?? folderId;
    await loadMeta(spamFolderId);
    await loadMessages(spamFolderId);
    setSelectedId(selected.id);
    setStatus(`已阻止发件人：${sender}，后续邮件将移入垃圾邮件`);
  }

  async function deleteRemoteImageTrust(trust: RemoteImageTrust) {
    await invoke('delete_remote_image_trust', { trustId: trust.id });
    setRemoteImageTrusts((current) => current.filter((item) => item.id !== trust.id));
    if (selected?.account_id === trust.account_id) {
      await renderSelectedWithRemoteImagePolicy(selected.id);
    }
    setStatus(`已移除远程图片信任：${trust.value}`);
  }

  async function downloadAttachment(attachment: Attachment) {
    try {
      const result = await invoke<AttachmentDownload>('download_attachment', { attachmentId: attachment.id });
      setAttachments((current) =>
        current.map((item) => (item.id === result.attachment.id ? result.attachment : item)),
      );
      setStatus(result.message);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`附件下载失败：${message.replace(/^Error:\s*/i, '')}`);
      throw error;
    }
  }

  async function openAttachment(attachment: Attachment) {
    if (!attachment.is_downloaded) {
      setStatus('请先下载附件');
      return;
    }
    const message = await invoke<string>('open_attachment', { attachmentId: attachment.id });
    setStatus(message);
  }

  async function saveAttachmentAs(attachment: Attachment) {
    if (!attachment.is_downloaded) {
      setStatus('请先下载附件');
      return;
    }
    const message = await invoke<string>('save_attachment_as', { attachmentId: attachment.id });
    setStatus(message);
  }

  async function exportSelectedMessage() {
    if (!selected) return;
    const message = await invoke<string>('export_message_as_eml', { messageId: selected.id });
    setStatus(message);
  }

  async function parseRawMessage() {
    const preview = await invoke<ParsedMessagePreview>('parse_raw_message', {
      input: { raw: rawMessage },
    });
    setParsedPreview(preview);
    setStatus(preview.warning_count > 0 ? `发现 ${preview.warning_count} 个安全提示` : '原始邮件预览解析完成');
  }

  async function storeCredential() {
    if (!account?.email) {
      setStatus('账号尚未加载，无法保存凭据');
      return null;
    }
    if (!credentialSecret.trim()) {
      setStatus(account.auth_type === 'oauth2' ? '请输入 OAuth2 访问/刷新 Token' : '请输入应用专用密码或授权码');
      return null;
    }
    const result = await invoke<CredentialStatus>('store_account_secret', {
      input: { account_email: account.email, secret: credentialSecret },
    });
    setCredentialStatus(result);
    setCredentialVerification(null);
    setCredentialSecret('');
    setStatus(result.message);
    return result;
  }

  async function storeAndVerifyCredential() {
    const result = await storeCredential();
    if (!result?.exists) return;
    await verifyAccountCredentials();
  }

  async function checkCredential() {
    if (!account?.email) return;
    const result = await invoke<CredentialStatus>('check_account_secret', {
      accountEmail: account.email,
    });
    setCredentialStatus(result);
    setStatus(result.message);
  }

  async function deleteCredential() {
    if (!account?.email) return;
    const result = await invoke<CredentialStatus>('delete_account_secret', {
      accountEmail: account.email,
    });
    setCredentialStatus(result);
    setCredentialVerification(null);
    setCredentialSecret('');
    setStatus(result.message);
  }

  async function saveRule() {
    if (!ruleForm.name.trim() || !ruleForm.condition.trim() || !ruleForm.action.trim()) {
      setStatus('请填写规则名称、条件和动作');
      return;
    }
    const saved = await invoke<MailRule>('upsert_rule', {
      ruleId: editingRuleId,
      input: ruleForm,
    });
    setRules((current) => {
      const exists = current.some((rule) => rule.id === saved.id);
      return exists ? current.map((rule) => (rule.id === saved.id ? saved : rule)) : [...current, saved];
    });
    setRuleForm(emptyRuleForm);
    setEditingRuleId(null);
    setStatus(`规则已保存：${saved.name}`);
  }

  async function toggleRule(rule: MailRule) {
    const updated = await invoke<MailRule>('set_rule_enabled', {
      ruleId: rule.id,
      enabled: !rule.enabled,
    });
    setRules((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setStatus(updated.enabled ? `规则已启用：${updated.name}` : `规则已停用：${updated.name}`);
  }

  function editRule(rule: MailRule) {
    const parsed = parseRuleCondition(rule.condition);
    setEditingRuleId(rule.id);
    setRuleBuilderField(parsed.field);
    setRuleBuilderNeedle(parsed.value);
    setRuleForm({
      name: rule.name,
      condition: rule.condition,
      action: rule.action,
      enabled: rule.enabled,
    });
    setStatus(`正在编辑规则：${rule.name}`);
  }

  async function removeRule(rule: MailRule) {
    await invoke('delete_rule', { ruleId: rule.id });
    setRules((current) => current.filter((item) => item.id !== rule.id));
    if (editingRuleId === rule.id) {
      setEditingRuleId(null);
      setRuleForm(emptyRuleForm);
      setRuleBuilderField('from');
      setRuleBuilderNeedle('');
    }
    setStatus(`规则已删除：${rule.name}`);
  }

  function updateRuleConditionField(field: RuleConditionField) {
    setRuleBuilderField(field);
    setRuleForm((current) => ({ ...current, condition: buildRuleCondition(field, ruleBuilderNeedle) }));
  }

  function updateRuleConditionValue(value: string) {
    setRuleBuilderNeedle(value);
    setRuleForm((current) => ({ ...current, condition: buildRuleCondition(ruleBuilderField, value) }));
  }

  function toggleRuleAction(action: string) {
    const normalizedAction = action.toLowerCase();
    setRuleForm((current) => {
      const parts = ruleActionParts(current.action);
      const exists = parts.some((part) => part.toLowerCase() === normalizedAction);
      return {
        ...current,
        action: (exists
          ? parts.filter((part) => part.toLowerCase() !== normalizedAction)
          : [...parts, action]
        ).join('; '),
      };
    });
  }

  function updateRuleLabelAction(labelName: string) {
    setRuleForm((current) => {
      return {
        ...current,
        action: setRuleActionPart(current.action, 'apply label ', labelName ? `apply label ${labelName}` : ''),
      };
    });
  }

  async function runSearch(event: React.FormEvent) {
    event.preventDefault();
    await loadMessagesWithVisibleFallback(
      folderId,
      query,
      filter,
      accountScope,
      mailboxRefreshRef.current,
      folders,
      messagePageSize,
      searchScope,
    );
    setStatus(query.trim() ? `已搜索：${query.trim()}` : '已刷新搜索范围');
  }

  async function changeSearchScope(nextScope: SearchScope) {
    setSearchScope(nextScope);
    setListMode('messages');
    setActiveThread(null);
    setThreadMessages([]);
    await loadMessagesWithVisibleFallback(
      folderId,
      query,
      filter,
      accountScope,
      mailboxRefreshRef.current,
      folders,
      messagePageSize,
      nextScope,
    );
    const label = nextScope === 'folder' ? '当前文件夹' : nextScope === 'account' ? '当前账号' : '全部账号';
    setStatus(`搜索范围已切换为：${label}`);
  }

  async function applySearchShortcut(shortcutQuery: string) {
    const nextQuery = shortcutQuery.endsWith(':')
      ? `${query.trim()} ${shortcutQuery}`.trim()
      : shortcutQuery;
    setQuery(nextQuery);
    setListMode('messages');
    setActiveThread(null);
    setThreadMessages([]);
    await loadMessagesWithVisibleFallback(
      folderId,
      nextQuery,
      filter,
      accountScope,
      mailboxRefreshRef.current,
      folders,
      messagePageSize,
      searchScope,
    );
    searchInputRef.current?.focus();
    if (shortcutQuery.endsWith(':')) {
      searchInputRef.current?.setSelectionRange(nextQuery.length, nextQuery.length);
      setStatus(`已插入搜索条件：${shortcutQuery}`);
    } else {
      setStatus(`已搜索：${nextQuery}`);
    }
  }

  async function clearSearchAndFilter() {
    setQuery('');
    setFilter('all');
    setSearchScope('account');
    setListMode('messages');
    setActiveThread(null);
    setThreadMessages([]);
    await loadMessagesWithVisibleFallback(
      folderId,
      '',
      'all',
      accountScope,
      mailboxRefreshRef.current,
      folders,
      messagePageSize,
      'account',
    );
    setStatus('已清空搜索和筛选');
  }

  async function loadMoreMessages() {
    const nextLimit = messageLimit + messagePageSize;
    const nextMessages = await loadMessagesWithVisibleFallback(
      folderId,
      query,
      filter,
      accountScope,
      mailboxRefreshRef.current,
      folders,
      nextLimit,
      searchScope,
    );
    setStatus(`已加载 ${nextMessages.length} 封邮件`);
  }

  async function runSavedSearch(savedSearch: SavedSearch) {
    setQuery(savedSearch.query);
    setFilter(savedSearch.filter);
    setSearchScope(savedSearch.scope);
    setListMode('messages');
    setActiveThread(null);
    setThreadMessages([]);
    await loadMessages(
      folderId,
      savedSearch.query,
      savedSearch.filter,
      accountScope,
      mailboxRefreshRef.current,
      messagePageSize,
      savedSearch.scope,
    );
    setStatus(`已运行保存搜索：${savedSearch.name}`);
  }

  async function runLabelSearch(label: Label) {
    const nextQuery = `label:${label.name}`;
    setQuery(nextQuery);
    setFilter('all');
    setSearchScope('folder');
    setListMode('messages');
    setActiveThread(null);
    setThreadMessages([]);
    await loadMessages(
      folderId,
      nextQuery,
      'all',
      accountScope,
      mailboxRefreshRef.current,
      messagePageSize,
      'folder',
    );
    setStatus(`正在查看标签：${label.name}`);
  }

  function saveCurrentSearch() {
    const trimmedQuery = query.trim();
    const trimmedName = savedSearchName.trim() || trimmedQuery;
    if (!trimmedQuery) {
      setStatus('请输入搜索条件后再保存');
      return;
    }
    setSavedSearches((current) => {
      const withoutDuplicate = current.filter(
        (item) => item.name !== trimmedName
          && !(item.query === trimmedQuery && item.filter === filter && item.scope === searchScope),
      );
      return [
        ...withoutDuplicate,
        {
          id: crypto.randomUUID(),
          name: trimmedName,
          query: trimmedQuery,
          filter,
          scope: searchScope,
        },
      ];
    });
    setSavedSearchName('');
    setStatus(`已保存搜索：${trimmedName}`);
  }

  function deleteSavedSearch(savedSearch: SavedSearch) {
    setSavedSearches((current) => current.filter((item) => item.id !== savedSearch.id));
    setStatus(`已删除保存搜索：${savedSearch.name}`);
  }

  function changeAccountScope(value: string) {
    const nextScope = value === 'all' ? 'all' : Number(value);
    setAccountScope(nextScope);
    setSearchScope('account');
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
    setSearchScope('folder');
    setFolderId(nextFolderId);
  }

  async function runCommandPaletteItem(item: CommandPaletteItem) {
    if (item.disabled) return;
    setCommandPaletteOpen(false);
    setCommandQuery('');
    await item.run();
  }

  const filteredCommandItems = useCommandPaletteItems({
    commandQuery,
    composeTemplates,
    managedContacts,
    selected,
    labels,
    folders,
    filter,
    query,
    isComposerOpen,
    searchInputRef,
    openComposer: () => openComposer(),
    refreshAll,
    setListMode,
    clearActiveThread: () => {
      setActiveThread(null);
      setThreadMessages([]);
    },
    openSettings: openSettingsHome,
    openShortcuts: () => setShortcutsOpen(true),
    setFilter,
    applyComposeTemplate,
    composeToContact,
    composeFromMessage,
    toggleRead,
    toggleStar,
    moveSelected,
    unsnoozeSelected,
    snoozeSelected,
    toggleLabel,
    openFolder: async (folder, nextQuery, nextFilter) => {
      setFolderId(folder.id);
      setActiveThread(null);
      setThreadMessages([]);
      await loadMessages(folder.id, nextQuery, nextFilter);
      setStatus(`已打开：${folder.name}`);
    },
  });

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
    isCommandPaletteOpen,
    closeOverlays: () => {
      closeComposer();
      setSettingsOpen(false);
      setShortcutsOpen(false);
      setCommandPaletteOpen(false);
    },
    clearSelection: () => setSelectedMessageIds([]),
    setStatus,
    restoreUndoAction,
    toggleAllVisibleMessages,
    openCommandPalette: () => {
      setCommandPaletteOpen(true);
      setCommandQuery('');
    },
    openShortcuts: () => setShortcutsOpen(true),
    composeNew: () => {
      setDraft(emptyDraft);
      setRichComposer(false);
      openComposer(emptyDraft);
      setStatus('已打开新邮件');
    },
    setSelectedId,
    runBulkAction,
    composeFromMessage,
    toggleStar,
    toggleRead,
    moveSelected,
  });

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
        onAccountScopeChange={changeAccountScope}
        onSetDefaultAccount={(accountId) => {
          setDefaultAccount(accountId).catch((error) => setStatus(String(error)));
        }}
        onCompose={() => {
          setDraft(emptyDraft);
          setRichComposer(false);
          openComposer(emptyDraft);
          setStatus('已打开新邮件');
        }}
        onSelectFolder={selectFolder}
        onDropMessagesToFolder={(folder, messageIds) => {
          moveMessagesToFolderByIds(folder, messageIds).catch((error) => setStatus(String(error)));
        }}
        onFolderFavoriteChange={(folder, isFavorite) => {
          setStatus(isFavorite ? `已固定到常用邮箱：${folder.name}` : `已从常用邮箱移除：${folder.name}`);
        }}
        onRenamingFolderNameChange={setRenamingFolderName}
        onRenameFolder={(folder) => { renameCustomFolder(folder).catch((error) => setStatus(String(error))); }}
        onCancelRename={() => setRenamingFolderId(null)}
        onStartRename={startRenameCustomFolder}
        onDeleteFolder={(folder) => { deleteCustomFolder(folder).catch((error) => setStatus(String(error))); }}
        onMarkFolderRead={(folder) => { markFolderRead(folder).catch((error) => setStatus(String(error))); }}
        onEmptyTrash={() => { emptyCurrentTrash().catch((error) => setStatus(String(error))); }}
        onOpenSettings={openSettingsHome}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
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
        accountScope={accountScope}
        hasMoreMessages={hasMoreMessages}
        currentViewLabel={currentViewLabel}
        visibleListSummary={visibleListSummary}
        messageListSummary={messageListSummary}
        onSearchSubmit={runSearch}
        onQueryChange={setQuery}
        onSearchScopeChange={(nextScope) => {
          changeSearchScope(nextScope).catch((error) => setStatus(String(error)));
        }}
        onClearSearchAndFilter={() => { clearSearchAndFilter().catch((error) => setStatus(String(error))); }}
        onApplySearchShortcut={(nextQuery) => { applySearchShortcut(nextQuery).catch((error) => setStatus(String(error))); }}
        onRefresh={refreshAll}
        onShowMessages={() => {
          setListMode('messages');
          setActiveThread(null);
          setThreadMessages([]);
        }}
        onShowThreads={() => setListMode('threads')}
        onFilterChange={setFilter}
        onSortChange={setListSort}
        onToggleAllVisible={toggleAllVisibleMessages}
        onRunBulkAction={runBulkAction}
        onRequestSnooze={requestSnooze}
        onMoveBulkToFolder={(folder) => { moveSelectedMessagesToFolder(folder).catch((error) => setStatus(String(error))); }}
        onToggleBulkLabel={(label) => { toggleBulkLabel(label).catch((error) => setStatus(String(error))); }}
        onRunMessageAction={(message, action) => { runMessageAction(message, action).catch((error) => setStatus(String(error))); }}
        onMoveMessageToFolder={(message, folder) => { moveMessageToFolder(message, folder).catch((error) => setStatus(String(error))); }}
        onToggleMessageLabel={(message, label) => { toggleMessageLabel(message, label).catch((error) => setStatus(String(error))); }}
        onComposeFromMessage={composeFromMessage}
        onOpenThread={openThread}
        onRunThreadAction={(thread, items, action) => {
          runThreadAction(thread, items, action).catch((error) => setStatus(String(error)));
        }}
        onMoveThreadToFolder={(thread, items, folder) => {
          moveThreadToFolder(thread, items, folder).catch((error) => setStatus(String(error)));
        }}
        onToggleThreadLabel={(thread, items, label) => {
          toggleThreadLabel(thread, items, label).catch((error) => setStatus(String(error)));
        }}
        onToggleThreadMute={(thread, items) => {
          toggleThreadMuted(thread, items).catch((error) => setStatus(String(error)));
        }}
        onSelectMessage={setSelectedId}
        onToggleMessageSelection={toggleMessageSelection}
        onLoadMore={() => { loadMoreMessages().catch((error) => setStatus(String(error))); }}
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
        selected={selected}
        selectedId={selectedId}
        accountScope={accountScope}
        folders={folders}
        labels={labels}
        attachments={attachments}
        selectedSenderTrusted={selectedSenderTrusted}
        selectedSenderDomain={selectedSenderDomain}
        selectedHasRemoteImageWarning={selectedHasRemoteImageWarning}
        quickReplyBody={quickReplyBody}
        onSelectMessage={setSelectedId}
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
        onUnsnooze={unsnoozeSelected}
        onSnooze={snoozeSelected}
        onExportMessage={exportSelectedMessage}
        onFetchBody={fetchSelectedBody}
        onMarkNotSpam={markSelectedNotSpam}
        onMarkAsSpam={markSelectedAsSpam}
        onTrustRemoteImages={trustRemoteImagesForSelected}
        onBlockSender={blockSelectedSender}
        onPermanentlyDelete={permanentlyDeleteSelected}
        onEmptyTrash={emptyCurrentTrash}
        onMoveToFolder={(folder) => { moveSelectedToFolder(folder).catch((error) => setStatus(String(error))); }}
        onToggleLabel={toggleLabel}
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

      {isSettingsOpen && accountForm && (
        <Suspense fallback={<DeferredSurface label="正在打开设置" />}>
          <SettingsFrame
          title="设置"
          subtitle={`${accountForm.email} · ${accountForm.provider}`}
          activeSection={activeSettingsSection}
          onNavigate={scrollSettingsSection}
          onTestConnection={() => { testConnection().catch((error) => setStatus(String(error))); }}
          onSave={() => { saveSettings().catch((error) => setStatus(String(error))); }}
          onClose={() => setSettingsOpen(false)}
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
              onRemoveAccount={removeCurrentAccount}
              onUpdateProviderVerification={updateProviderVerification}
              onSaveProviderVerification={saveProviderVerification}
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
            {activeSettingsSection === 'auth' && (
              <CredentialSecuritySettings
                account={accountForm}
                credentialSecret={credentialSecret}
                credentialStatus={credentialStatus}
                connectionReport={connectionReport?.account_email === accountForm.email ? connectionReport : null}
                credentialVerification={
                  credentialVerification?.account_email === accountForm.email ? credentialVerification : null
                }
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
              || activeSettingsSection === 'identities') && (
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
            {activeSettingsSection === 'sync' && (
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
              onDeleteContact={(contact) => { deleteManagedContact(contact).catch((error) => setStatus(String(error))); }}
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
              labels={labels}
              rules={rules}
              threads={threads}
              onRuleFormChange={setRuleForm}
              onRuleConditionFieldChange={updateRuleConditionField}
              onRuleConditionValueChange={updateRuleConditionValue}
              onRuleLabelActionChange={updateRuleLabelAction}
              onToggleRuleAction={toggleRuleAction}
              onSaveRule={() => { saveRule().catch((error) => setStatus(String(error))); }}
              onToggleRule={(rule) => { toggleRule(rule).catch((error) => setStatus(String(error))); }}
              onEditRule={editRule}
              onRemoveRule={(rule) => { removeRule(rule).catch((error) => setStatus(String(error))); }}
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
      {isCommandPaletteOpen && (
        <Suspense fallback={<DeferredSurface label="正在打开命令面板" />}>
          <CommandPalette
            open
            query={commandQuery}
            items={filteredCommandItems}
            onQueryChange={setCommandQuery}
            onRun={(item) => {
              runCommandPaletteItem(item).catch((error) => setStatus(String(error)));
            }}
            onClose={() => setCommandPaletteOpen(false)}
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
      <div className="status-live-region" role="status" aria-live="polite">{status}</div>
    </main>
  );
}
