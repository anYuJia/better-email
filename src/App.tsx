import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Edit3,
  Inbox,
  Keyboard,
  Mail,
  Maximize2,
  Minus,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  Settings,
  Wand2,
  X,
} from 'lucide-react';
import './styles.css';
import './ui-2026.css';
import Sidebar from './components/Sidebar';
import MessageListPane from './components/MessageListPane';
import ReaderPane from './components/ReaderPane';
import {
  defaultNotificationPolicy,
  formatBytes,
  formatDate,
  newMailNotificationDecision,
  newMailNotificationBody,
  type NotificationPolicy,
  prefixedSubject,
  quoteMessage,
  remoteImageTrustInput,
  senderDomain,
  syncIntervalMs,
  syncStatusLabel,
} from './mailUtils';
import { type AccountProviderPreset, providerCompatibilityMatrix, providerPresets } from './providerCatalog';
import { getCurrentWindow, invoke, isPermissionGranted, requestPermission, sendNotification } from './tauriBridge';

import type {
  SystemFolderRole,
  FolderRole,
  FilterMode,
  ListMode,
  AccountScope,
  ProviderVerificationStatus,
  BackgroundTaskKind,
  BackgroundTaskStatus,
  Account,
  AccountCreateInput,
  Folder,
  Label,
  SavedSearch,
  Attachment,
  OutboundAttachmentInput,
  DroppedFile,
  AttachmentDownload,
  Message,
  UndoMessageSnapshot,
  UndoAction,
  CommandPaletteItem,
  RemoteImageTrust,
  MailIdentity,
  MailIdentityInput,
  DraftInput,
  ComposeTemplate,
  ComposerAutosave,
  MailStats,
  LocalBackupSummary,
  EndpointCheck,
  ConnectionReport,
  ImapFolderProbe,
  ImapProbeReport,
  ImapMailboxState,
  SyncRun,
  SyncSchedulePlan,
  RemoteActionReport,
  ParsedMessagePreview,
  Contact,
  ContactMergeSuggestion,
  ContactCreateInput,
  MailRule,
  MailRuleInput,
  ThreadSummary,
  OutboxItem,
  CredentialStatus,
  OAuthStartReport,
  OAuthSession,
  OAuthCallbackReport,
  OAuthTokenExchangeReport,
  OAuthRefreshReport,
  ProviderVerificationRecord,
  BackgroundTask,
  AppLayout,
} from './app/types';
import {
  emptyDraft,
  normalizeCommandSearchText,
  emptyIdentityForm,
  emptyRuleForm,
  ruleConditionFields,
  ruleActionPresets,
  parseRuleCondition,
  buildRuleCondition,
  ruleActionParts,
  setRuleActionPart,
  emptyContactForm,
  notificationPolicyStorageKey,
  providerVerificationStorageKey,
  savedSearchesStorageKey,
  composeTemplatesStorageKey,
  composerAutosaveStorageKey,
  appLayoutStorageKey,
  defaultAppLayout,
  filterModes,
  clampNumber,
  backgroundTaskTitle,
  loadNotificationPolicy,
  normalizeContactAliases,
  toggleAccountNotificationList,
  loadProviderVerifications,
  isFilterMode,
  loadSavedSearches,
  loadComposeTemplates,
  isDraftEmpty,
  normalizeDraftInput,
  loadComposerAutosave,
  loadAppLayout,
  providerVerificationLabel,
  outboxStatusLabel,
  outboxTimingLabel,
  canCancelOutboxItem,
  isCustomFolder,
  movableFoldersForBulk,
  sampleRawMessage,
  folderIcon,
  folderIconForRole,
  primaryFolderRoles,
  shortcutGroups,
  filters,
  messagePageSize,
  searchShortcuts,
  emptyAccountCreateForm,
} from './app/appConfig';
import type {
  RuleConditionField,
} from './app/appConfig';
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
  const [syncRuns, setSyncRuns] = useState<SyncRun[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactMergeSuggestions, setContactMergeSuggestions] = useState<ContactMergeSuggestion[]>([]);
  const [editingContactId, setEditingContactId] = useState<number | null>(null);
  const [contactEditName, setContactEditName] = useState('');
  const [contactEditAliases, setContactEditAliases] = useState('');
  const [contactForm, setContactForm] = useState<ContactCreateInput>(emptyContactForm);
  const [contactFormAliases, setContactFormAliases] = useState('');
  const [mergeSourceContactId, setMergeSourceContactId] = useState<number | null>(null);
  const [identities, setIdentities] = useState<MailIdentity[]>([]);
  const [identityForm, setIdentityForm] = useState<MailIdentityInput>(emptyIdentityForm);
  const [rules, setRules] = useState<MailRule[]>([]);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [diagnosticExport, setDiagnosticExport] = useState<string | null>(null);
  const [localBackupSummary, setLocalBackupSummary] = useState<LocalBackupSummary | null>(null);
  const [providerVerifications, setProviderVerifications] = useState<Record<string, ProviderVerificationRecord>>(loadProviderVerifications);
  const [rawMessage, setRawMessage] = useState(sampleRawMessage);
  const [parsedPreview, setParsedPreview] = useState<ParsedMessagePreview | null>(null);
  const [credentialSecret, setCredentialSecret] = useState('');
  const [credentialStatus, setCredentialStatus] = useState<CredentialStatus | null>(null);
  const [oauthClientId, setOauthClientId] = useState('');
  const [oauthClientSecret, setOauthClientSecret] = useState('');
  const [oauthRedirectUri, setOauthRedirectUri] = useState('http://127.0.0.1:17645/oauth/callback');
  const [oauthReport, setOauthReport] = useState<OAuthStartReport | null>(null);
  const [oauthSessions, setOauthSessions] = useState<OAuthSession[]>([]);
  const [oauthCallbackState, setOauthCallbackState] = useState('');
  const [oauthCallbackCode, setOauthCallbackCode] = useState('');
  const [oauthCallbackReport, setOauthCallbackReport] = useState<OAuthCallbackReport | null>(null);
  const [oauthExchangeReport, setOauthExchangeReport] = useState<OAuthTokenExchangeReport | null>(null);
  const [oauthRefreshReport, setOauthRefreshReport] = useState<OAuthRefreshReport | null>(null);
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
  const [activeThread, setActiveThread] = useState<ThreadSummary | null>(null);
  const [threadMessages, setThreadMessages] = useState<Message[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>(loadSavedSearches);
  const [savedSearchName, setSavedSearchName] = useState('');
  const [contactQuery, setContactQuery] = useState('');
  const [composeTemplates, setComposeTemplates] = useState<ComposeTemplate[]>(loadComposeTemplates);
  const [templateName, setTemplateName] = useState('');
  const [composerAutosave, setComposerAutosave] = useState<ComposerAutosave | null>(loadComposerAutosave);
  const [isComposerOpen, setComposerOpen] = useState(false);
  const [isComposerMinimized, setComposerMinimized] = useState(false);
  const [isComposerDropActive, setComposerDropActive] = useState(false);
  const [composerPosition, setComposerPosition] = useState({ x: 0, y: 0 });
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const [isShortcutsOpen, setShortcutsOpen] = useState(false);
  const [isCommandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [activeSettingsSection, setActiveSettingsSection] = useState('accounts');
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
  const [appLayout, setAppLayout] = useState<AppLayout>(loadAppLayout);
  const [undoAction, setUndoAction] = useState<UndoAction | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const composerDragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const layoutResizeRef = useRef<{ pane: 'sidebar' | 'list'; startX: number; origin: AppLayout } | null>(null);
  const undoTimerRef = useRef<number | null>(null);
  const backgroundSyncRef = useRef(false);
  const backgroundTaskWorkerRef = useRef(false);
  const frontendReadyRef = useRef(false);
  const benchmarkSyncRef = useRef(false);
  const mailboxRefreshRef = useRef(0);

  function accountIdForScope(scope: AccountScope): number | null {
    return scope === 'all' ? null : scope;
  }

  function scrollSettingsSection(section: string) {
    setActiveSettingsSection(section);
    document
      .querySelector(`[data-settings-section="${section}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function resetAppLayout() {
    setAppLayout(defaultAppLayout);
    setStatus('已恢复默认三栏宽度');
  }

  function beginLayoutResizeFromClientX(pane: 'sidebar' | 'list', clientX: number) {
    layoutResizeRef.current = {
      pane,
      startX: clientX,
      origin: appLayout,
    };
    document.body.classList.add('pane-resizing');
  }

  function beginLayoutResize(pane: 'sidebar' | 'list', event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    beginLayoutResizeFromClientX(pane, event.clientX);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function beginLayoutMouseResize(pane: 'sidebar' | 'list', event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    beginLayoutResizeFromClientX(pane, event.clientX);
  }

  function moveLayoutResizeFromClientX(clientX: number) {
    const resize = layoutResizeRef.current;
    if (!resize) return;
    const delta = clientX - resize.startX;
    if (resize.pane === 'sidebar') {
      setAppLayout({
        ...resize.origin,
        sidebar: clampNumber(resize.origin.sidebar + delta, 228, 320),
      });
      return;
    }
    setAppLayout({
      ...resize.origin,
      list: clampNumber(resize.origin.list + delta, 340, 500),
    });
  }

  function moveLayoutResize(event: React.PointerEvent<HTMLElement>) {
    moveLayoutResizeFromClientX(event.clientX);
  }

  function moveLayoutMouseResize(event: React.MouseEvent<HTMLElement>) {
    moveLayoutResizeFromClientX(event.clientX);
  }

  function endLayoutResize(event: React.PointerEvent<HTMLElement>) {
    if (!layoutResizeRef.current) return;
    layoutResizeRef.current = null;
    document.body.classList.remove('pane-resizing');
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function endLayoutMouseResize() {
    if (!layoutResizeRef.current) return;
    layoutResizeRef.current = null;
    document.body.classList.remove('pane-resizing');
  }

  function openComposer(nextDraft?: DraftInput) {
    if (nextDraft) {
      setDraft(nextDraft);
    } else if (isDraftEmpty(draft) && composerAutosave) {
      setDraft(composerAutosave.draft);
      setRichComposer(composerAutosave.isRichComposer);
      setStatus(`已恢复自动保存草稿：${formatDate(composerAutosave.saved_at)}`);
    }
    setComposerMinimized(false);
    setComposerOpen(true);
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
    setComposerPosition({ x: 0, y: 0 });
  }

  function clearComposerAutosave() {
    window.localStorage.removeItem(composerAutosaveStorageKey);
    setComposerAutosave(null);
  }

  function composerTitle() {
    const subject = draft.subject.trim();
    return subject ? subject : '新邮件';
  }

  function beginComposerDrag(event: React.PointerEvent<HTMLElement>) {
    if (isComposerMinimized || event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button, input, textarea, select, label, a')) return;
    composerDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: composerPosition.x,
      originY: composerPosition.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveComposerDrag(event: React.PointerEvent<HTMLElement>) {
    const drag = composerDragRef.current;
    if (!drag) return;
    const maxX = Math.max(window.innerWidth * 0.42, 120);
    const maxY = Math.max(window.innerHeight * 0.36, 120);
    const nextX = Math.min(Math.max(drag.originX + event.clientX - drag.startX, -maxX), maxX);
    const nextY = Math.min(Math.max(drag.originY + event.clientY - drag.startY, -maxY), maxY);
    setComposerPosition({ x: nextX, y: nextY });
  }

  function endComposerDrag(event: React.PointerEvent<HTMLElement>) {
    if (!composerDragRef.current) return;
    composerDragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
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
      nextThreads,
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
      invoke<ThreadSummary[]>('list_threads'),
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
    setThreads(nextThreads);
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

  async function loadMessages(
    nextFolderId = folderId,
    nextQuery = query,
    nextFilter = filter,
    nextScope: AccountScope = accountScope,
    refreshId = mailboxRefreshRef.current,
    nextLimit = messagePageSize,
  ) {
    if (!nextFolderId) {
      setMessages([]);
      setHasMoreMessages(false);
      setSelectedId(null);
      setSelectedMessageIds([]);
      return [];
    }
    const nextAccountId = accountIdForScope(nextScope);
    const nextMessages = await invoke<Message[]>('list_messages', {
      accountId: nextAccountId,
      folderId: nextFolderId,
      query: nextQuery.trim() || null,
      filter: nextFilter,
      limit: nextLimit + 1,
    });
    if (refreshId !== mailboxRefreshRef.current) return nextMessages;
    const visibleMessages = nextMessages.slice(0, nextLimit);
    setMessageLimit(nextLimit);
    setHasMoreMessages(nextMessages.length > nextLimit);
    setMessages(visibleMessages);
    setSelectedMessageIds((current) =>
      current.filter((id) => visibleMessages.some((message) => message.id === id)),
    );
    setSelectedId((current) => {
      if (current && visibleMessages.some((message) => message.id === current)) return current;
      return visibleMessages[0]?.id ?? null;
    });
    if (!frontendReadyRef.current) {
      frontendReadyRef.current = true;
      void invoke('mark_frontend_ready', {
        message: `folder=${nextFolderId};messages=${visibleMessages.length};scope=${nextScope}`,
      });
      void maybeRunBenchmarkSync();
    }
    return visibleMessages;
  }

  async function loadMessagesWithVisibleFallback(
    nextFolderId = folderId,
    nextQuery = query,
    nextFilter = filter,
    nextScope: AccountScope = accountScope,
    refreshId = mailboxRefreshRef.current,
    visibleFolders = folders,
    nextLimit = messagePageSize,
  ) {
    const nextMessages = await loadMessages(nextFolderId, nextQuery, nextFilter, nextScope, refreshId, nextLimit);
    if (
      nextMessages.length > 0 ||
      !nextFolderId ||
      nextQuery.trim() ||
      nextFilter !== 'all' ||
      refreshId !== mailboxRefreshRef.current
    ) {
      return nextMessages;
    }

    const selectedFolder = visibleFolders.find((folder) => folder.id === nextFolderId);
    if (!selectedFolder || selectedFolder.unread_count <= 0) return nextMessages;
    const unreadMessages = await loadMessages(nextFolderId, '', 'unread', nextScope, refreshId, nextLimit);
    if (unreadMessages.length === 0 || refreshId !== mailboxRefreshRef.current) return nextMessages;
    setFilter('unread');
    setStatus('当前文件夹暂无全部邮件，已切到未读视图显示可见邮件。');
    return unreadMessages;
  }

  async function refreshMailbox(
    nextScope: AccountScope = accountScope,
    preferredFolderId: number | null = null,
    nextQuery = query,
    nextFilter = filter,
  ) {
    const refreshId = mailboxRefreshRef.current + 1;
    mailboxRefreshRef.current = refreshId;
    setMessageLimit(messagePageSize);
    setHasMoreMessages(false);
    setMessages([]);
    setSelectedId(null);
    setSelectedMessageIds([]);
    const meta = await loadMeta(preferredFolderId, nextScope);
    const nextFolderId = meta.folderId;
    if (refreshId !== mailboxRefreshRef.current) return nextFolderId;
    await loadMessagesWithVisibleFallback(nextFolderId, nextQuery, nextFilter, nextScope, refreshId, meta.folders, messagePageSize);
    return nextFolderId;
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
    isPermissionGranted()
      .then((granted) => setNotificationStatus(granted ? '系统提醒已启用' : '系统提醒待授权'))
      .catch(() => setNotificationStatus('系统提醒不可用'));
  }, []);

  useEffect(() => {
    window.localStorage.setItem(notificationPolicyStorageKey, JSON.stringify(notificationPolicy));
  }, [notificationPolicy]);

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
    window.localStorage.setItem(appLayoutStorageKey, JSON.stringify(appLayout));
  }, [appLayout]);

  useEffect(() => {
    refreshMailbox(accountScope, null).catch((error) => setStatus(String(error)));
  }, [accountScope]);

  useEffect(() => {
    if (!folderId) return;
    loadMessages(folderId, query, filter, accountScope, mailboxRefreshRef.current, messagePageSize).catch((error) => setStatus(String(error)));
  }, [folderId, filter]);

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
  const managedContacts = contacts;
  const filteredContacts = useMemo(() => {
    const term = contactQuery.trim().toLowerCase();
    const sortedContacts = [...managedContacts].sort((left, right) => {
      const byCount = right.message_count - left.message_count;
      if (byCount !== 0) return byCount;
      return right.last_seen_at.localeCompare(left.last_seen_at);
    });
    if (!term) return sortedContacts.slice(0, 6);
    return sortedContacts
      .filter((contact) =>
        [contact.name, contact.email, contact.aliases.join(' ')].join(' ').toLowerCase().includes(term),
      )
      .slice(0, 8);
  }, [contactQuery, managedContacts]);
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
  const activeProviderVerification = useMemo(
    () => (accountForm ? providerVerificationFor(accountForm.provider) : null),
    [accountForm?.provider, providerVerifications],
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
    setSelectedId(nextMessages[0]?.id ?? null);
    setSelectedMessageIds([]);
    if (announce) {
      setStatus(`已打开线程：${thread.subject} · ${nextMessages.length} 封`);
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

  function queueUndoAction(title: string, snapshots: UndoMessageSnapshot[], detail?: string) {
    if (snapshots.length === 0) return;
    if (undoTimerRef.current) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setUndoAction({
      id: `${Date.now()}-${snapshots.map((item) => item.id).join('-')}`,
      title,
      detail: detail ?? (snapshots.length === 1 ? snapshots[0].subject : `${snapshots.length} 封邮件`),
      snapshots,
    });
    undoTimerRef.current = window.setTimeout(() => {
      setUndoAction(null);
      undoTimerRef.current = null;
    }, 7000);
  }

  async function restoreUndoAction(action = undoAction) {
    if (!action) return;
    if (undoTimerRef.current) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
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
    setUndoAction(null);
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

  async function runBulkAction(action: 'read' | 'unread' | 'star' | 'unstar' | 'archive' | 'trash') {
    if (selectedMessages.length === 0) {
      setStatus('请先选择邮件');
      return;
    }
    const undoSnapshots = snapshotMessages(selectedMessages);
    for (const message of selectedMessages) {
      if (action === 'read' || action === 'unread') {
        await invoke('set_message_read', { messageId: message.id, isRead: action === 'read' });
      } else if (action === 'star' || action === 'unstar') {
        await invoke('set_message_starred', { messageId: message.id, isStarred: action === 'star' });
      } else {
        await invoke('move_message_to_role', { messageId: message.id, role: action });
      }
    }
    const count = selectedMessages.length;
    setSelectedMessageIds([]);
    await refreshAll();
    const actionLabel =
      action === 'read'
        ? '标为已读'
        : action === 'unread'
          ? '标为未读'
          : action === 'star'
            ? '添加星标'
            : action === 'unstar'
              ? '取消星标'
              : action === 'archive'
                ? '归档'
                : '删除';
    setStatus(`已批量${actionLabel} ${count} 封邮件`);
    queueUndoAction(`批量${actionLabel}`, undoSnapshots, `${count} 封邮件`);
  }

  async function moveSelectedMessagesToFolder(role: FolderRole, folderName: string = role) {
    if (selectedMessages.length === 0) {
      setStatus('请先选择邮件');
      return;
    }
    const undoSnapshots = snapshotMessages(selectedMessages);
    for (const message of selectedMessages) {
      await invoke('move_message_to_role', { messageId: message.id, role });
    }
    const count = selectedMessages.length;
    setSelectedMessageIds([]);
    await refreshAll();
    setStatus(`已批量移动到 ${folderName}：${count} 封邮件`);
    queueUndoAction(`批量移动到 ${folderName}`, undoSnapshots, `${count} 封邮件`);
  }

  async function applyBulkLabel(label: Label) {
    if (selectedMessages.length === 0) {
      setStatus('请先选择邮件');
      return;
    }
    const undoSnapshots = snapshotMessages(selectedMessages);
    for (const message of selectedMessages) {
      if (!message.labels.includes(label.name)) {
        await invoke('apply_label_to_message', { messageId: message.id, labelId: label.id });
      }
    }
    const count = selectedMessages.length;
    setSelectedMessageIds([]);
    await refreshAll();
    setStatus(`已批量添加标签 ${label.name}：${count} 封邮件`);
    queueUndoAction(`批量添加标签 ${label.name}`, undoSnapshots, `${count} 封邮件`);
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
    await invoke('set_message_starred', { messageId: message.id, isStarred: !message.is_starred });
    await refreshAll();
    setStatus(message.is_starred ? '已取消星标' : '已添加星标');
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
    const restored = await invoke<Message>('restore_message_to_inbox', { messageId: selected.id });
    const inboxFolderId = visibleFolderIdForRole('inbox', restored.account_id) ?? folderId;
    await loadMeta(inboxFolderId);
    await loadMessages(inboxFolderId);
    setSelectedId(restored.id);
    setStatus('已移回收件箱，并标记为不是垃圾邮件');
    queueUndoAction('不是垃圾邮件', undoSnapshots);
  }

  async function restoreSelectedFromTrash() {
    if (!selected) return;
    const undoSnapshots = snapshotMessages([selected]);
    const restored = await invoke<Message>('restore_message_to_inbox', { messageId: selected.id });
    const inboxFolderId = visibleFolderIdForRole('inbox', restored.account_id) ?? folderId;
    await loadMeta(inboxFolderId);
    await loadMessages(inboxFolderId);
    setSelectedId(restored.id);
    setStatus('已恢复到收件箱');
    queueUndoAction('恢复到收件箱', undoSnapshots);
  }

  async function permanentlyDeleteSelected() {
    if (!selected) return;
    const subject = selected.subject || '(无主题)';
    await invoke('delete_message_permanently', { messageId: selected.id });
    await refreshAll();
    setStatus(`已永久删除：${subject}`);
  }

  async function emptyCurrentTrash() {
    const deleted = await invoke<number>('empty_trash', { accountId: accountIdForScope(accountScope) });
    await refreshAll();
    setStatus(`已清空废纸篓：永久删除 ${deleted} 封邮件`);
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

  async function snoozeSelected() {
    if (!selected) return;
    const undoSnapshots = snapshotMessages([selected]);
    const snoozedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const updated = await invoke<Message>('snooze_message', {
      messageId: selected.id,
      snoozedUntil,
    });
    const snoozedFolderId = visibleFolderIdForRole('snoozed', selected.account_id) ?? folderId;
    await loadMeta(snoozedFolderId);
    await loadMessages(snoozedFolderId);
    setSelectedId(updated.id);
    setStatus(`已稍后处理到 ${formatDate(updated.snoozed_until)}`);
    queueUndoAction('稍后处理', undoSnapshots);
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

  function handleComposerAttachmentDrop(event: React.DragEvent<HTMLDivElement>) {
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

  function handleComposerAttachmentDragOver(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }

  function handleComposerAttachmentDragEnter(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setComposerDropActive(true);
  }

  function handleComposerAttachmentDragLeave(event: React.DragEvent<HTMLDivElement>) {
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
    const wasUpdatingDraft = draft.draft_id > 0;
    await invoke('save_draft', { input: draftInputForCurrentAccount(draft) });
    setDraft(emptyDraft);
    clearComposerAutosave();
    closeComposer();
    await refreshAll();
    setStatus(wasUpdatingDraft ? '草稿已更新' : '草稿已保存');
  }

  async function sendDraft() {
    if (!draft.to.trim()) {
      setStatus('请先填写收件人');
      return;
    }
    await invoke('send_message', { input: { ...draftInputForCurrentAccount(draft), draft_id: 0 } });
    setDraft(emptyDraft);
    clearComposerAutosave();
    closeComposer();
    await refreshAll();
    setStatus('邮件已进入已发送，本地发送流转验证通过');
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
    await invoke<OutboxItem>('queue_outbox_message', { input });
    setDraft(emptyDraft);
    clearComposerAutosave();
    closeComposer();
    await refreshAll();
    setStatus(sendAt ? `邮件已安排稍后发送：${formatDate(input.send_at)}` : '邮件已加入发件箱队列');
  }

  async function cancelOutboxItem(item: OutboxItem) {
    const updated = await invoke<OutboxItem>('cancel_outbox_item', { outboxId: item.id });
    setOutbox((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
    await loadMeta(folderId);
    setStatus('已撤回到草稿箱');
  }

  function composeFromMessage(message: Message, mode: 'reply' | 'replyAll' | 'forward') {
    const replyRecipients = mode === 'forward' ? '' : message.sender_email;
    const includeOriginalRecipients =
      mode === 'replyAll'
        ? message.recipients
            .split(/[;,]/)
            .map((recipient) => recipient.trim())
            .filter((recipient) => recipient && recipient !== account?.email)
            .join(', ')
        : '';
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
      attachments: [],
    });
    setStatus(mode === 'forward' ? '已创建转发草稿' : mode === 'replyAll' ? '已创建回复全部草稿' : '已创建回复草稿');
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
      attachments: draftAttachments.map((attachment) => ({
        filename: attachment.filename,
        mime_type: attachment.mime_type,
        size_bytes: attachment.size_bytes,
        local_path: attachment.local_path,
      })),
    });
    setStatus('已打开草稿继续编辑');
  }

  function startEditContact(contact: Contact) {
    setEditingContactId(contact.id);
    setContactEditName(contact.name);
    setContactEditAliases(contact.aliases.join(', '));
  }

  async function refreshContactMergeSuggestions() {
    const suggestions = await invoke<ContactMergeSuggestion[]>('list_contact_merge_suggestions');
    setContactMergeSuggestions(suggestions);
  }

  async function createManagedContact() {
    const email = contactForm.email.trim().toLowerCase();
    if (!email) {
      setStatus('请输入联系人邮箱');
      return;
    }
    const created = await invoke<Contact>('create_contact', {
      input: {
        ...contactForm,
        email,
        aliases: normalizeContactAliases(contactFormAliases).filter((alias) => alias !== email),
      },
    });
    setContacts((current) => [created, ...current.filter((item) => item.id !== created.id)]);
    setContactForm(emptyContactForm);
    setContactFormAliases('');
    await refreshContactMergeSuggestions();
    setStatus(`联系人已新增：${created.name || created.email}`);
  }

  async function saveContactOverride(contact: Contact) {
    const aliases = normalizeContactAliases(contactEditAliases).filter((alias) => alias !== contact.email.trim().toLowerCase());
    const updated = await invoke<Contact>('update_contact', {
      contactId: contact.id,
      input: {
        name: contactEditName.trim() || contact.name,
        aliases,
        vip: contact.vip,
      },
    });
    setContacts((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setEditingContactId(null);
    await refreshContactMergeSuggestions();
    setStatus(`联系人已更新：${updated.name}`);
  }

  async function toggleContactVip(contact: Contact) {
    const nextVip = !contact.vip;
    const aliases = contact.aliases ?? [];
    const updated = await invoke<Contact>('update_contact', {
      contactId: contact.id,
      input: {
        name: contact.name,
        aliases,
        vip: nextVip,
      },
    });
    setContacts((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    await refreshContactMergeSuggestions();
    setNotificationPolicy((current) => {
      const vipSenders = normalizeContactAliases(current.vipSenders);
      const contactEmails = [contact.email, ...aliases].map((item) => item.trim().toLowerCase()).filter(Boolean);
      const nextSenders = nextVip
        ? [...new Set([...vipSenders, ...contactEmails])]
        : vipSenders.filter((sender) => !contactEmails.includes(sender));
      return { ...current, vipSenders: nextSenders.join('\n') };
    });
    setStatus(nextVip ? `已设为 VIP：${updated.name || updated.email}` : `已取消 VIP：${updated.name || updated.email}`);
  }

  async function deleteManagedContact(contact: Contact) {
    await invoke('delete_contact', { contactId: contact.id });
    setContacts((current) => current.filter((item) => item.id !== contact.id));
    if (editingContactId === contact.id) {
      setEditingContactId(null);
    }
    if (mergeSourceContactId === contact.id) {
      setMergeSourceContactId(null);
    }
    await refreshContactMergeSuggestions();
    setStatus(`联系人已删除：${contact.name || contact.email}`);
  }

  async function mergeManagedContact(target: Contact) {
    if (!mergeSourceContactId || mergeSourceContactId === target.id) {
      setStatus('请选择要合并进来的联系人');
      return;
    }
    const source = contacts.find((contact) => contact.id === mergeSourceContactId);
    const merged = await invoke<Contact>('merge_contacts', {
      targetContactId: target.id,
      sourceContactId: mergeSourceContactId,
    });
    setContacts((current) => [merged, ...current.filter((item) => item.id !== target.id && item.id !== mergeSourceContactId)]);
    setMergeSourceContactId(null);
    await refreshContactMergeSuggestions();
    setStatus(`已合并联系人：${source?.name || source?.email || '来源联系人'} → ${merged.name || merged.email}`);
  }

  async function mergeSuggestedContact(suggestion: ContactMergeSuggestion) {
    const merged = await invoke<Contact>('merge_contacts', {
      targetContactId: suggestion.target.id,
      sourceContactId: suggestion.source.id,
    });
    setContacts((current) => [merged, ...current.filter((item) => item.id !== suggestion.target.id && item.id !== suggestion.source.id)]);
    setContactMergeSuggestions((current) =>
      current.filter(
        (item) =>
          item.target.id !== suggestion.target.id &&
          item.source.id !== suggestion.target.id &&
          item.target.id !== suggestion.source.id &&
          item.source.id !== suggestion.source.id,
      ),
    );
    if (mergeSourceContactId === suggestion.source.id || mergeSourceContactId === suggestion.target.id) {
      setMergeSourceContactId(null);
    }
    await refreshContactMergeSuggestions();
    setStatus(`已按建议合并：${suggestion.source.name || suggestion.source.email} → ${merged.name || merged.email}`);
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

  async function saveSettings() {
    if (!accountForm) return;
    const updated = await invoke<Account>('update_account_settings', { accountId: accountForm.id, input: accountForm });
    setAccount(updated);
    setAccountForm(updated);
    setAccounts((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setSettingsOpen(false);
    setStatus('账号和同步设置已保存');
  }

  async function createNewAccount() {
    if (!newAccountForm.email.trim()) {
      setStatus('请先填写新账号邮箱地址');
      return;
    }
    const created = await invoke<Account>('create_account', { input: newAccountForm });
    setAccounts((current) => [...current, created]);
    setAccountScope(created.id);
    setAccount(created);
    setAccountForm(created);
    setNewAccountForm(emptyAccountCreateForm);
    setFolderId(null);
    setMessages([]);
    setSelectedId(null);
    setAttachments([]);
    const { folderId: nextFolderId } = await loadMeta(null, created.id);
    await loadMessages(nextFolderId, query, filter, created.id);
    setStatus(`已创建账号：${created.email}`);
  }

  function applyProviderPreset(preset: AccountProviderPreset) {
    if (!accountForm) return;
    setAccountForm({
      ...accountForm,
      provider: preset.provider,
      imap_host: preset.imap_host,
      smtp_host: preset.smtp_host,
      auth_type: preset.auth_type,
    });
    setStatus(`${preset.label} 服务商预设已填入，可继续保存和测试连接`);
  }

  function applyNewAccountPreset(preset: AccountProviderPreset) {
    setNewAccountForm({
      ...newAccountForm,
      provider: preset.provider,
      imap_host: preset.imap_host,
      smtp_host: preset.smtp_host,
      auth_type: preset.auth_type,
    });
    setStatus(`${preset.label} 预设已填入新账号表单`);
  }

  function providerVerificationKey(providerName: string): string {
    const normalized = providerName.trim().toLowerCase();
    return providerCompatibilityMatrix.find((provider) => provider.provider === normalized)?.id ?? normalized ?? 'custom';
  }

  function providerVerificationFor(providerName: string): ProviderVerificationRecord {
    const key = providerVerificationKey(providerName);
    const catalogEntry = providerCompatibilityMatrix.find((provider) => provider.id === key || provider.provider === providerName);
    return (
      providerVerifications[key] ?? {
        provider_key: key,
        provider_label: catalogEntry?.label ?? (providerName.trim() || 'Custom'),
        status: 'untested',
        imap_ok: false,
        smtp_ok: false,
        oauth_ok: false,
        diagnostic_exported: false,
        checked_at: '',
        notes: '',
      }
    );
  }

  function updateProviderVerification(providerName: string, patch: Partial<ProviderVerificationRecord>) {
    const current = providerVerificationFor(providerName);
    setProviderVerifications((records) => ({
      ...records,
      [current.provider_key]: {
        ...current,
        ...patch,
        checked_at: patch.checked_at ?? current.checked_at,
      },
    }));
  }

  function saveProviderVerification() {
    if (!accountForm) return;
    updateProviderVerification(accountForm.provider, {
      checked_at: new Date().toISOString(),
      diagnostic_exported: Boolean(diagnosticExport),
    });
    setStatus('服务商兼容性验证记录已保存到本地');
  }

  async function testConnection() {
    const report = await invoke<ConnectionReport>('test_connection');
    setConnectionReport(report);
    setStatus(report.ready_for_credentials ? '服务器连接成功，可以进入凭据验证' : '连接测试完成，请查看服务器结果');
  }

  async function discoverImapFolders() {
    const report = await invoke<ImapProbeReport>('discover_imap_folders');
    setImapProbe(report);
    const mailboxes = await invoke<ImapMailboxState[]>('list_imap_mailboxes');
    setImapMailboxes(mailboxes);
    setStatus(report.message);
  }

  async function runSyncDryRun() {
    const run = await invoke<SyncRun>('run_sync_dry_run');
    setSyncRuns((current) => [run, ...current].slice(0, 10));
    await loadMeta(folderId);
    setStatus('同步演练已完成并记录');
    return run;
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

  async function refreshBackgroundTasks() {
    const tasks = await invoke<BackgroundTask[]>('list_background_tasks');
    setBackgroundTasks(tasks);
    return tasks;
  }

  async function enqueueBackgroundTask(kind: BackgroundTaskKind, source: 'manual' | 'timer' = 'manual') {
    const task = await invoke<BackgroundTask>('enqueue_background_task', { input: { kind, source } });
    const tasks = await refreshBackgroundTasks();
    const isReusedActiveTask = task.kind === 'sync' && task.status !== 'queued';
    setBackgroundSyncStatus(isReusedActiveTask ? '同步任务已在队列中' : `${task.title} 已入队`);
    if (!tasks.some((item) => item.status === 'queued')) return;
    void drainBackgroundTaskQueue();
  }

  async function drainBackgroundTaskQueue() {
    if (backgroundTaskWorkerRef.current) return;
    backgroundTaskWorkerRef.current = true;
    try {
      while (true) {
        const nextTask = await invoke<BackgroundTask | null>('next_background_task');
        if (!nextTask) break;

        const runningTask = await invoke<BackgroundTask>('mark_background_task_running', { taskId: nextTask.id });
        await refreshBackgroundTasks();
        setBackgroundSyncStatus(`${runningTask.title}执行中...`);
        try {
          const message = await executeBackgroundTask(runningTask);
          await invoke<BackgroundTask>('complete_background_task', {
            taskId: runningTask.id,
            message,
          });
          await refreshBackgroundTasks();
          setBackgroundSyncStatus(message);
        } catch (error) {
          const message = String(error);
          await invoke<BackgroundTask>('fail_background_task', {
            taskId: runningTask.id,
            message,
          });
          await refreshBackgroundTasks();
          setBackgroundSyncStatus(`${runningTask.title}失败：${message}`);
          if (runningTask.source === 'manual') setStatus(message);
        }
      }
    } finally {
      backgroundTaskWorkerRef.current = false;
    }
  }

  async function executeBackgroundTask(task: BackgroundTask): Promise<string> {
    if (task.kind === 'sync') return runBackgroundSync(task.source);
    if (task.kind === 'outbox-smtp') return flushOutboxSmtp();
    return flushOutboxDryRun();
  }

  async function runBackgroundSync(reason: 'manual' | 'timer'): Promise<string> {
    if (backgroundSyncRef.current) return '同步任务已在运行';
    backgroundSyncRef.current = true;
    const syncAccountId = accountIdForScope(accountScope);
    setBackgroundSyncStatus(reason === 'timer' ? '后台同步中...' : '手动同步中...');
    try {
      const plan = await invoke<SyncSchedulePlan>('get_sync_schedule_plan', { accountId: syncAccountId });
      setSyncSchedulePlan(plan);
      setBackgroundSyncStatus(
        plan.total_accounts > 1
          ? `同步中：本轮 ${plan.batch_accounts.length}/${plan.total_accounts} 个账号`
          : reason === 'timer'
            ? '后台同步中...'
            : '手动同步中...',
      );
      const run = await invoke<SyncRun>('sync_imap_headers', { accountId: syncAccountId });
      const released = await releaseDueSnoozedMessages();
      setSyncRuns((current) => [run, ...current].slice(0, 10));
      await loadMeta(folderId);
      const latestMessages = await loadMessages(folderId, query, filter);
      setBackgroundSyncStatus(
        released.length > 0 ? `${syncStatusLabel(run)}；已恢复 ${released.length} 封稍后邮件` : syncStatusLabel(run),
      );
      await notifyNewMail(run, latestMessages);
      if (reason === 'manual') {
        setStatus(released.length > 0 ? `${run.message} 已恢复 ${released.length} 封稍后邮件。` : run.message);
      }
      return released.length > 0 ? `${syncStatusLabel(run)}；已恢复 ${released.length} 封稍后邮件` : syncStatusLabel(run);
    } catch (error) {
      const message = String(error);
      setBackgroundSyncStatus(`后台同步暂停：${message}`);
      if (reason === 'manual') setStatus(message);
      throw error;
    } finally {
      backgroundSyncRef.current = false;
    }
  }

  async function notifyNewMail(run: SyncRun, latestMessages: Message[] = messages) {
    const decision = newMailNotificationDecision(run, notificationPolicy, latestMessages);
    const body = decision.body;
    setLastNewMailNotice(body);
    if (!body) {
      if (decision.reason === 'quiet-hours') setNotificationStatus('免打扰时段已静音');
      if (decision.reason === 'vip-only-no-match') setNotificationStatus('VIP 策略已过滤');
      if (decision.reason === 'account-muted') setNotificationStatus('账号静音已过滤');
      return;
    }

    try {
      let granted = await isPermissionGranted();
      if (!granted) {
        const permission = await requestPermission();
        granted = permission === 'granted';
      }
      if (!granted) {
        setNotificationStatus('系统提醒未授权');
        return;
      }
      sendNotification({ title: 'SwiftMail', body });
      setNotificationStatus(
        decision.vipMatches > 0
          ? 'VIP 系统提醒已发送'
          : decision.priorityMatches > 0
            ? '重点账号提醒已发送'
            : '系统提醒已发送',
      );
    } catch {
      setNotificationStatus('系统提醒不可用');
    }
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
    const result = await invoke<AttachmentDownload>('download_attachment', { attachmentId: attachment.id });
    setAttachments((current) =>
      current.map((item) => (item.id === result.attachment.id ? result.attachment : item)),
    );
    setStatus(result.message);
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

  async function flushOutboxDryRun(): Promise<string> {
    const items = await invoke<OutboxItem[]>('flush_outbox_dry_run');
    setOutbox(items);
    await loadMeta(folderId);
    const message = '发件箱队列已完成本地发送演练';
    setStatus(message);
    return message;
  }

  async function flushOutboxSmtp(): Promise<string> {
    const items = await invoke<OutboxItem[]>('flush_outbox_smtp');
    setOutbox(items);
    await loadMeta(folderId);
    const failed = items.filter((item) => item.status === 'retry').length;
    const pendingRetry = items.filter((item) => item.status === 'retry' && item.next_attempt_at).length;
    const message =
      failed > 0
        ? `SMTP 发送完成，${failed} 封需重试${pendingRetry > 0 ? '，已安排下次尝试' : ''}`
        : 'SMTP 发件箱发送完成';
    setStatus(message);
    return message;
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
      return;
    }
    if (!credentialSecret.trim()) {
      setStatus(account.auth_type === 'oauth2' ? '请输入 OAuth2 访问/刷新 Token' : '请输入应用专用密码或授权码');
      return;
    }
    const result = await invoke<CredentialStatus>('store_account_secret', {
      input: { account_email: account.email, secret: credentialSecret },
    });
    setCredentialStatus(result);
    setCredentialSecret('');
    setStatus(result.message);
  }

  async function startOAuth2Pkce() {
    if (!accountForm) return;
    if (accountForm.auth_type !== 'oauth2') {
      setStatus('当前账号不是 OAuth2 模式');
      return;
    }
    if (!oauthClientId.trim()) {
      setStatus('请先填写 OAuth2 Client ID');
      return;
    }
    const report = await invoke<OAuthStartReport>('start_oauth2_pkce', {
      input: {
        provider: accountForm.provider,
        client_id: oauthClientId,
        redirect_uri: oauthRedirectUri,
        login_hint: accountForm.email,
      },
    });
    setOauthReport(report);
    setOauthSessions(await invoke<OAuthSession[]>('list_oauth_sessions'));
    setStatus(report.message);
  }

  async function completeOAuth2Callback() {
    if (!oauthCallbackState.trim() || !oauthCallbackCode.trim()) {
      setStatus('请填写 OAuth2 回调里的 state 和 code');
      return;
    }
    const report = await invoke<OAuthCallbackReport>('complete_oauth2_callback', {
      input: {
        state: oauthCallbackState,
        code: oauthCallbackCode,
      },
    });
    setOauthCallbackReport(report);
    setOauthCallbackCode('');
    setOauthSessions(await invoke<OAuthSession[]>('list_oauth_sessions'));
    setStatus(report.message);
  }

  async function waitForOAuth2Callback() {
    setStatus('正在监听 OAuth2 本地回调，请在浏览器完成授权');
    const report = await invoke<OAuthCallbackReport>('wait_for_oauth2_callback', {
      input: {
        redirect_uri: oauthRedirectUri,
        timeout_seconds: 180,
      },
    });
    setOauthCallbackReport(report);
    setOauthCallbackState(report.status === 'code_received' ? '' : oauthCallbackState);
    setOauthCallbackCode('');
    setOauthSessions(await invoke<OAuthSession[]>('list_oauth_sessions'));
    setStatus(report.message);
  }

  async function exchangeOAuth2Token(sessionId: number) {
    if (!oauthClientId.trim()) {
      setStatus('请先填写 OAuth2 Client ID');
      return;
    }
    const report = await invoke<OAuthTokenExchangeReport>('exchange_oauth2_token', {
      input: {
        session_id: sessionId,
        client_id: oauthClientId,
        client_secret: oauthClientSecret,
      },
    });
    setOauthExchangeReport(report);
    setOauthClientSecret('');
    setOauthSessions(await invoke<OAuthSession[]>('list_oauth_sessions'));
    setStatus(report.message);
  }

  async function refreshOAuth2Token() {
    if (!oauthClientId.trim()) {
      setStatus('请先填写 OAuth2 Client ID');
      return;
    }
    const report = await invoke<OAuthRefreshReport>('refresh_oauth2_token', {
      input: {
        client_id: oauthClientId,
        client_secret: oauthClientSecret,
      },
    });
    setOauthRefreshReport(report);
    setOauthClientSecret('');
    setStatus(report.message);
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
    await loadMessagesWithVisibleFallback(folderId, query, filter, accountScope, mailboxRefreshRef.current, folders, messagePageSize);
    setStatus(query.trim() ? `已搜索：${query.trim()}` : '已清除搜索');
  }

  async function applySearchShortcut(shortcutQuery: string) {
    const nextQuery = shortcutQuery.endsWith(':')
      ? `${query.trim()} ${shortcutQuery}`.trim()
      : shortcutQuery;
    setQuery(nextQuery);
    setListMode('messages');
    setActiveThread(null);
    setThreadMessages([]);
    await loadMessagesWithVisibleFallback(folderId, nextQuery, filter, accountScope, mailboxRefreshRef.current, folders, messagePageSize);
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
    setListMode('messages');
    setActiveThread(null);
    setThreadMessages([]);
    await loadMessagesWithVisibleFallback(folderId, '', 'all', accountScope, mailboxRefreshRef.current, folders, messagePageSize);
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
    );
    setStatus(`已加载 ${nextMessages.length} 封邮件`);
  }

  async function runSavedSearch(savedSearch: SavedSearch) {
    setQuery(savedSearch.query);
    setFilter(savedSearch.filter);
    setListMode('messages');
    setActiveThread(null);
    setThreadMessages([]);
    await loadMessages(folderId, savedSearch.query, savedSearch.filter, accountScope, mailboxRefreshRef.current, messagePageSize);
    setStatus(`已运行保存搜索：${savedSearch.name}`);
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
        (item) => item.name !== trimmedName && !(item.query === trimmedQuery && item.filter === filter),
      );
      return [
        ...withoutDuplicate,
        {
          id: crypto.randomUUID(),
          name: trimmedName,
          query: trimmedQuery,
          filter,
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
    setFolderId(null);
    setMessages([]);
    setSelectedId(null);
    setSelectedMessageIds([]);
    setActiveThread(null);
    setThreadMessages([]);
    setAttachments([]);
    setStatus(nextScope === 'all' ? '正在切换到统一邮箱视图...' : '正在切换到单账号视图...');
  }

  async function runCommandPaletteItem(item: CommandPaletteItem) {
    if (item.disabled) return;
    setCommandPaletteOpen(false);
    setCommandQuery('');
    await item.run();
  }

  const commandPaletteItems = useMemo<CommandPaletteItem[]>(() => {
    const items: CommandPaletteItem[] = [
      {
        id: 'compose',
        title: '写邮件',
        section: '常用',
        hint: '新建一封邮件',
        run: () => openComposer(),
      },
      {
        id: 'refresh',
        title: '刷新邮箱',
        section: '常用',
        hint: '重新加载本地和同步状态',
        run: refreshAll,
      },
      {
        id: 'focus-search',
        title: '聚焦搜索',
        section: '导航',
        hint: '快速查找邮件',
        run: () => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        },
      },
      {
        id: 'messages-view',
        title: '显示邮件列表',
        section: '导航',
        hint: '切回单封邮件列表',
        run: () => {
          setListMode('messages');
          setActiveThread(null);
          setThreadMessages([]);
        },
      },
      {
        id: 'threads-view',
        title: '显示会话线程',
        section: '导航',
        hint: '按会话聚合查看',
        run: () => setListMode('threads'),
      },
      {
        id: 'settings',
        title: '打开设置',
        section: '窗口',
        hint: '账号、安全、同步和规则',
        run: () => setSettingsOpen(true),
      },
      {
        id: 'shortcuts',
        title: '查看快捷键',
        section: '窗口',
        hint: '查看键盘操作',
        run: () => setShortcutsOpen(true),
      },
      ...filters.map((item) => ({
        id: `filter-${item.id}`,
        title: `筛选：${item.label}`,
        section: '筛选',
        hint: item.id === 'all' ? '显示所有邮件' : `只显示${item.label}邮件`,
        run: () => setFilter(item.id),
      })),
      ...composeTemplates.map((template) => ({
        id: `compose-template-${template.id}`,
        title: `模板：${template.name}`,
        section: '写信',
        hint: template.subject || '插入模板正文',
        run: () => {
          if (!isComposerOpen) openComposer();
          applyComposeTemplate(template);
        },
      })),
      ...managedContacts.slice(0, 8).map((contact) => ({
        id: `contact-${contact.id}`,
        title: `写给：${contact.name || contact.email}`,
        section: '联系人',
        hint: `${contact.email} · ${contact.message_count} 封往来`,
        run: () => composeToContact(contact),
      })),
    ];

    if (selected) {
      items.push(
        {
          id: 'reply',
          title: '回复当前邮件',
          section: '当前邮件',
          hint: selected.subject || '(无主题)',
          disabled: selected.folder_role === 'drafts',
          run: () => composeFromMessage(selected, 'reply'),
        },
        {
          id: 'reply-all',
          title: '回复全部',
          section: '当前邮件',
          hint: selected.subject || '(无主题)',
          disabled: selected.folder_role === 'drafts',
          run: () => composeFromMessage(selected, 'replyAll'),
        },
        {
          id: 'forward',
          title: '转发当前邮件',
          section: '当前邮件',
          hint: selected.subject || '(无主题)',
          disabled: selected.folder_role === 'drafts',
          run: () => composeFromMessage(selected, 'forward'),
        },
        {
          id: 'toggle-read',
          title: selected.is_read ? '标为未读' : '标为已读',
          section: '当前邮件',
          hint: '切换阅读状态',
          run: () => toggleRead(selected),
        },
        {
          id: 'toggle-star',
          title: selected.is_starred ? '取消星标' : '添加星标',
          section: '当前邮件',
          hint: '切换星标',
          run: () => toggleStar(selected),
        },
        {
          id: 'archive',
          title: '归档当前邮件',
          section: '当前邮件',
          hint: '移到归档',
          disabled: selected.folder_role === 'trash',
          run: () => moveSelected('archive'),
        },
        {
          id: 'trash',
          title: '移到废纸篓',
          section: '当前邮件',
          hint: '删除但可恢复',
          disabled: selected.folder_role === 'trash',
          run: () => moveSelected('trash'),
        },
        {
          id: 'snooze',
          title: selected.folder_role === 'snoozed' ? '取消稍后处理' : '稍后处理',
          section: '当前邮件',
          hint: selected.folder_role === 'snoozed' ? '恢复到收件箱' : '24 小时后提醒',
          disabled: selected.folder_role === 'trash',
          run: () => (selected.folder_role === 'snoozed' ? unsnoozeSelected() : snoozeSelected()),
        },
      );

      labels.forEach((label) => {
        items.push({
          id: `label-${label.id}`,
          title: selected.labels.includes(label.name) ? `移除标签：${label.name}` : `添加标签：${label.name}`,
          section: '标签',
          hint: `${label.message_count} 封邮件`,
          run: () => toggleLabel(label),
        });
      });
    }

    folders.forEach((folder) => {
      items.push({
        id: `folder-${folder.id}`,
        title: `打开：${folder.name}`,
        section: '邮箱',
        hint: folder.unread_count > 0 ? `${folder.unread_count} 未读` : '切换文件夹',
        run: async () => {
          setFolderId(folder.id);
          setActiveThread(null);
          setThreadMessages([]);
          await loadMessages(folder.id, query, filter);
          setStatus(`已打开：${folder.name}`);
        },
      });
    });

    return items;
  }, [composeTemplates, filter, folderId, folders, isComposerOpen, labels, managedContacts, query, selected, selectedId]);

  const filteredCommandItems = useMemo(() => {
    const normalized = normalizeCommandSearchText(commandQuery);
    const items = normalized
      ? commandPaletteItems.filter((item) =>
          normalizeCommandSearchText(`${item.title} ${item.section} ${item.hint}`).includes(normalized),
        )
      : commandPaletteItems;
    return items.slice(0, 12);
  }, [commandPaletteItems, commandQuery]);

  useEffect(() => {
    function isEditableTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
    }

    function selectRelativeMessage(offset: number) {
      if (messages.length === 0) return;
      const currentIndex = selectedId ? messages.findIndex((message) => message.id === selectedId) : -1;
      const nextIndex = Math.min(Math.max(currentIndex + offset, 0), messages.length - 1);
      setSelectedId(messages[nextIndex].id);
    }

    function handleShortcut(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      const editable = isEditableTarget(event.target);

      if (key === 'escape' && (isComposerOpen || isSettingsOpen || isShortcutsOpen || isCommandPaletteOpen)) {
        event.preventDefault();
        closeComposer();
        setSettingsOpen(false);
        setShortcutsOpen(false);
        setCommandPaletteOpen(false);
        return;
      }
      if (editable) return;

      if ((event.metaKey || event.ctrlKey) && key === 'k') {
        event.preventDefault();
        setCommandPaletteOpen(true);
        setCommandQuery('');
        return;
      }

      if ((event.metaKey || event.ctrlKey) && key === '/') {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }

      if (key === '?' || (event.shiftKey && key === '/')) {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }

      if (key === '/') {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (key === 'c') {
        event.preventDefault();
        setDraft(emptyDraft);
        openComposer();
        setStatus('已打开新邮件');
        return;
      }
      if (key === 'j' || key === 'arrowdown') {
        event.preventDefault();
        selectRelativeMessage(1);
        return;
      }
      if (key === 'k' || key === 'arrowup') {
        event.preventDefault();
        selectRelativeMessage(-1);
        return;
      }
      if (!selected) return;
      if (key === 'r' && event.shiftKey) {
        event.preventDefault();
        composeFromMessage(selected, 'replyAll');
      } else if (key === 'r') {
        event.preventDefault();
        composeFromMessage(selected, 'reply');
      } else if (key === 'f') {
        event.preventDefault();
        composeFromMessage(selected, 'forward');
      } else if (key === 's') {
        event.preventDefault();
        toggleStar(selected).catch((error) => setStatus(String(error)));
      } else if (key === 'm') {
        event.preventDefault();
        toggleRead(selected).catch((error) => setStatus(String(error)));
      } else if (key === 'e') {
        event.preventDefault();
        moveSelected('archive').catch((error) => setStatus(String(error)));
      } else if (key === 'delete' || key === 'backspace') {
        event.preventDefault();
        moveSelected('trash').catch((error) => setStatus(String(error)));
      }
    }

    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [composerPosition.x, composerPosition.y, isCommandPaletteOpen, isComposerMinimized, isComposerOpen, isSettingsOpen, isShortcutsOpen, messages, selected, selectedId]);

  useEffect(() => {
    const intervalMs = syncIntervalMs(account?.sync_mode ?? 'manual');
    if (!intervalMs) {
      setBackgroundSyncStatus('后台同步已关闭');
      return;
    }
    setBackgroundSyncStatus(`后台同步已启用：${account?.sync_mode === 'push' ? '每 5 分钟' : '每 15 分钟'}`);
    const timer = window.setInterval(() => {
      enqueueBackgroundTask('sync', 'timer');
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [account?.sync_mode, accountScope, folderId, query, filter]);

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
        account={account}
        accounts={accounts}
        folders={folders}
        folderId={folderId}
        renamingFolderId={renamingFolderId}
        renamingFolderName={renamingFolderName}
        savedSearches={savedSearches}
        savedSearchName={savedSearchName}
        contacts={contacts}
        contactQuery={contactQuery}
        filteredContacts={filteredContacts}
        labels={labels}
        customFolderName={customFolderName}
        backgroundTasks={backgroundTasks}
        backgroundSyncStatus={backgroundSyncStatus}
        lastNewMailNotice={lastNewMailNotice}
        notificationStatus={notificationStatus}
        appBadgeStatus={appBadgeStatus}
        onAccountScopeChange={changeAccountScope}
        onCompose={() => openComposer()}
        onSelectFolder={setFolderId}
        onRenamingFolderNameChange={setRenamingFolderName}
        onRenameFolder={(folder) => { renameCustomFolder(folder).catch((error) => setStatus(String(error))); }}
        onCancelRename={() => setRenamingFolderId(null)}
        onStartRename={startRenameCustomFolder}
        onDeleteFolder={(folder) => { deleteCustomFolder(folder).catch((error) => setStatus(String(error))); }}
        onSavedSearchNameChange={setSavedSearchName}
        onSaveCurrentSearch={saveCurrentSearch}
        onRunSavedSearch={(savedSearch) => { runSavedSearch(savedSearch).catch((error) => setStatus(String(error))); }}
        onDeleteSavedSearch={deleteSavedSearch}
        onContactQueryChange={setContactQuery}
        onComposeToContact={composeToContact}
        onAddContactToDraft={addContactToDraft}
        onToggleContactVip={(contact) => { toggleContactVip(contact).catch((error) => setStatus(String(error))); }}
        onCustomFolderNameChange={setCustomFolderName}
        onCreateCustomFolder={() => { createCustomFolder().catch((error) => setStatus(String(error))); }}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
        onSync={() => enqueueBackgroundTask('sync', 'manual')}
        onResetLayout={resetAppLayout}
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
        filter={filter}
        listMode={listMode}
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
        onToggleAllVisible={toggleAllVisibleMessages}
        onRunBulkAction={runBulkAction}
        onMoveBulkToFolder={(folder) => { moveSelectedMessagesToFolder(folder.role as FolderRole, folder.name).catch((error) => setStatus(String(error))); }}
        onApplyBulkLabel={applyBulkLabel}
        onOpenThread={openThread}
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
        <div className={`composer-backdrop${isComposerMinimized ? ' composer-backdrop-minimized' : ''}`}>
          {isComposerMinimized ? (
            <section className="composer-minimized" aria-label="已最小化的新邮件">
              <button className="composer-mini-main" type="button" onClick={() => setComposerMinimized(false)}>
                <Mail size={17} />
                <span>
                  <strong>{composerTitle()}</strong>
                  <small>{draft.to.trim() || '未填写收件人'}</small>
                </span>
              </button>
              <div className="composer-mini-actions">
                <button type="button" onClick={() => setComposerMinimized(false)} aria-label="展开写信窗口">
                  <Maximize2 size={15} />
                  展开
                </button>
                <button type="button" onClick={closeComposer} aria-label="关闭写信窗口">
                  <X size={15} />
                  关闭
                </button>
              </div>
            </section>
          ) : (
          <section
            className="composer"
            style={{ transform: `translate(${composerPosition.x}px, ${composerPosition.y}px)` }}
            onPointerMove={moveComposerDrag}
            onPointerUp={endComposerDrag}
            onPointerCancel={endComposerDrag}
          >
            <header onPointerDown={beginComposerDrag}>
              <span className="composer-window-controls" aria-hidden="true">
                <i className="control-dot close-dot" />
                <i className="control-dot minimize-dot" />
                <i className="control-dot zoom-dot" />
              </span>
              <strong>{composerTitle()}</strong>
              <div className="composer-header-actions">
                <button type="button" onClick={() => setComposerMinimized(true)} aria-label="最小化写信窗口">
                  <Minus size={15} />
                  最小化
                </button>
                <button type="button" onClick={closeComposer} aria-label="关闭写信窗口">
                  <X size={15} />
                  关闭
                </button>
              </div>
            </header>
            <datalist id="contact-suggestions">
              {managedContacts.map((contact) => (
                <React.Fragment key={contact.id}>
                  <option value={contact.email}>
                    {contact.name}
                  </option>
                  {contact.aliases.map((alias) => (
                    <option key={`${contact.id}-${alias}`} value={alias}>
                      {contact.name}
                    </option>
                  ))}
                </React.Fragment>
              ))}
            </datalist>
            <input
              list="contact-suggestions"
              value={draft.to}
              onChange={(event) => setDraft({ ...draft, to: event.target.value })}
              placeholder="收件人"
            />
            {managedContacts.length > 0 && (
              <div className="recipient-suggestions">
                <span>常用联系人</span>
                {managedContacts.slice(0, 5).map((contact) => (
                  <button type="button" key={contact.id} onClick={() => addContactToDraft(contact)}>
                    {contact.vip ? '★ ' : ''}{contact.name || contact.email}
                    <small>{contact.email}{contact.aliases.length ? ` · ${contact.aliases.length} 个别名` : ''}</small>
                  </button>
                ))}
              </div>
            )}
            <input
              value={draft.subject}
              onChange={(event) => setDraft({ ...draft, subject: event.target.value })}
              placeholder="主题"
            />
            <textarea
              value={draft.body}
              onChange={(event) => setDraft({ ...draft, body: event.target.value, html_body: isRichComposer ? `<p>${event.target.value.replace(/\n/g, '<br>')}</p>` : draft.html_body })}
              placeholder="正文"
            />
            <details className="composer-advanced">
              <summary>
                <Wand2 size={15} />
                工具
                <span>
                  {draft.attachments.length > 0 ? `${draft.attachments.length} 附件` : '身份 · 模板 · 附件'}
                </span>
              </summary>
              <div className="composer-advanced-panel">
                <section className="composer-tool-card">
                  <strong>发送身份</strong>
                  <label className="composer-from">
                    发件账号
                    <select
                      value={draft.account_id || account?.id || 0}
                      onChange={(event) => setDraft({ ...draft, account_id: Number(event.target.value), identity_id: 0 })}
                    >
                      {accounts.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.display_name} &lt;{entry.email}&gt;
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="composer-from">
                    发件身份
                    <select
                      aria-label="发件身份"
                      value={identityForDraft()?.id || 0}
                      onChange={(event) => setDraft({ ...draft, identity_id: Number(event.target.value) })}
                    >
                      {identitiesForDraftAccount().map((identity) => (
                        <option key={identity.id} value={identity.id}>
                          {identity.name} &lt;{identity.email}&gt;{identity.is_default ? ' · 默认' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="composer-recipient-grid">
                    <input
                      list="contact-suggestions"
                      value={draft.cc}
                      onChange={(event) => setDraft({ ...draft, cc: event.target.value })}
                      placeholder="抄送"
                    />
                    <input
                      list="contact-suggestions"
                      value={draft.bcc}
                      onChange={(event) => setDraft({ ...draft, bcc: event.target.value })}
                      placeholder="密送"
                    />
                  </div>
                </section>

                <section className="composer-tool-card composer-template-card">
                  <strong>模板</strong>
                  <div className="composer-template-list">
                    {composeTemplates.length === 0 && <small>暂无模板，可从当前正文保存</small>}
                    {composeTemplates.slice(0, 6).map((template) => (
                      <span className="composer-template-row" key={template.id}>
                        <button type="button" onClick={() => applyComposeTemplate(template)}>
                          <Wand2 size={13} />
                          {template.name}
                        </button>
                        <button type="button" aria-label={`删除模板 ${template.name}`} onClick={() => deleteComposeTemplate(template)}>
                          删除
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="composer-template-save">
                    <input
                      value={templateName}
                      onChange={(event) => setTemplateName(event.target.value)}
                      placeholder="模板名称"
                    />
                    <button type="button" onClick={saveDraftAsTemplate}>保存当前</button>
                  </div>
                </section>

                <section className="composer-tool-card">
                  <strong>富文本与签名</strong>
                  <div className="composer-rich-toggle">
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={isRichComposer}
                        onChange={(event) => setRichComposer(event.target.checked)}
                      />
                      富文本 HTML
                    </label>
                    {isRichComposer && (
                      <div className="rich-toolbar">
                        <button type="button" onClick={() => setDraft({ ...draft, html_body: `${draft.html_body}<strong>加粗文字</strong>`, body: `${draft.body}加粗文字` })}>B</button>
                        <button type="button" onClick={() => setDraft({ ...draft, html_body: `${draft.html_body}<em>斜体文字</em>`, body: `${draft.body}斜体文字` })}>I</button>
                        <button type="button" onClick={() => setDraft({ ...draft, html_body: `${draft.html_body}<ul><li>列表项</li></ul>`, body: `${draft.body}\n- 列表项` })}>列表</button>
                      </div>
                    )}
                  </div>
                  {isRichComposer && (
                    <textarea
                      className="composer-html-source"
                      value={draft.html_body}
                      onChange={(event) => setDraft({ ...draft, html_body: event.target.value })}
                      placeholder="HTML 正文，将在保存和发送前清洗"
                    />
                  )}
                  <div className="composer-signature">
                    <span>{identityForDraft()?.signature.trim() ? `签名：${identityForDraft()?.signature.trim()}` : '当前发件身份未设置签名'}</span>
                    <button type="button" onClick={insertSignatureIntoDraft}>插入签名</button>
                  </div>
                </section>

                <section className="composer-tool-card">
                  <strong>稍后与附件</strong>
                  <label className="composer-schedule">
                    稍后发送
                    <input
                      type="datetime-local"
                      value={draft.send_at}
                      onChange={(event) => setDraft({ ...draft, send_at: event.target.value })}
                    />
                  </label>
                  <div
                    className={`composer-attachments${isComposerDropActive ? ' drop-active' : ''}`}
                    onDrop={handleComposerAttachmentDrop}
                    onDragEnter={handleComposerAttachmentDragEnter}
                    onDragLeave={handleComposerAttachmentDragLeave}
                    onDragOver={handleComposerAttachmentDragOver}
                  >
                    <div className="composer-attachment-controls">
                      <button type="button" className="composer-attachment-button" onClick={pickDraftAttachments}>
                        <Paperclip size={14} />
                        添加附件
                      </button>
                      <span>
                        {draft.attachments.length > 0
                          ? `已添加 ${draft.attachments.length} 个附件`
                          : '拖入文件，或点击添加附件'}
                      </span>
                    </div>
                    {draft.attachments.length > 0 && (
                      <div className="composer-attachment-list">
                        {draft.attachments.map((attachment, index) => (
                          <span className="composer-attachment-chip" key={`${attachment.filename}-${index}`}>
                            <Paperclip size={12} />
                            <strong>{attachment.filename}</strong>
                            <em>{formatBytes(attachment.size_bytes)}</em>
                            <button type="button" onClick={() => removeDraftAttachment(index)}>移除</button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </details>
            <footer>
              <span>
                {status}
                {composerAutosave && isComposerOpen && !isDraftEmpty(draft) ? ` · 自动保存 ${formatDate(composerAutosave.saved_at)}` : ''}
              </span>
              <div>
                <button className="secondary" onClick={saveDraft}>保存草稿</button>
                <button className="secondary" onClick={queueDraft}>{draft.send_at.trim() ? '稍后发送' : '发件箱'}</button>
                <button onClick={sendDraft}>发送</button>
              </div>
            </footer>
          </section>
          )}
        </div>
      )}

      {isSettingsOpen && accountForm && (
        <div className="composer-backdrop">
          <section className="settings-modal">
            <header className="settings-main-header">
              <div className="settings-title">
                <strong>账号设置</strong>
                <span>{accountForm.email} · {accountForm.provider}</span>
              </div>
              <button onClick={() => setSettingsOpen(false)}>关闭</button>
            </header>
            <div className="settings-body">
              <nav className="settings-nav" aria-label="设置分类">
                <strong>设置</strong>
                <span>常用项优先，专业项折叠</span>
                <span className="settings-nav-group">账号与连接</span>
                <button type="button" className={activeSettingsSection === 'accounts' ? 'active' : ''} onClick={() => scrollSettingsSection('accounts')}>账号</button>
                <button type="button" className={activeSettingsSection === 'providers' ? 'active' : ''} onClick={() => scrollSettingsSection('providers')}>服务商</button>
                <button type="button" className={activeSettingsSection === 'auth' ? 'active' : ''} onClick={() => scrollSettingsSection('auth')}>认证</button>
                <span className="settings-nav-group">体验与隐私</span>
                <button type="button" className={activeSettingsSection === 'notifications' ? 'active' : ''} onClick={() => scrollSettingsSection('notifications')}>通知</button>
                <button type="button" className={activeSettingsSection === 'privacy' ? 'active' : ''} onClick={() => scrollSettingsSection('privacy')}>隐私</button>
                <button type="button" className={activeSettingsSection === 'identities' ? 'active' : ''} onClick={() => scrollSettingsSection('identities')}>身份</button>
                <span className="settings-nav-group">数据与自动化</span>
                <button type="button" className={activeSettingsSection === 'backup' ? 'active' : ''} onClick={() => scrollSettingsSection('backup')}>备份</button>
                <button type="button" className={activeSettingsSection === 'sync' ? 'active' : ''} onClick={() => scrollSettingsSection('sync')}>同步</button>
                <button type="button" className={activeSettingsSection === 'rules' ? 'active' : ''} onClick={() => scrollSettingsSection('rules')}>规则</button>
                <button type="button" className={activeSettingsSection === 'security-preview' ? 'active' : ''} onClick={() => scrollSettingsSection('security-preview')}>安全预览</button>
              </nav>
              <div className="settings-content">
            <details className="settings-disclosure add-account-disclosure" data-settings-section="accounts">
              <summary>
                <span>
                  <strong>添加邮箱账号</strong>
                  <em>选择服务商预设并填写邮箱地址</em>
                </span>
                <b>添加</b>
              </summary>
              <section className="tool-panel">
              <header className="tool-header">
                <strong>新增账号</strong>
                <button onClick={createNewAccount}>创建账号</button>
              </header>
              <label>
                邮箱地址
                <input value={newAccountForm.email} onChange={(event) => setNewAccountForm({ ...newAccountForm, email: event.target.value })} placeholder="name@example.com" />
              </label>
              <label>
                显示名称
                <input value={newAccountForm.display_name} onChange={(event) => setNewAccountForm({ ...newAccountForm, display_name: event.target.value })} placeholder="留空则使用邮箱地址" />
              </label>
              <section className="provider-presets compact" aria-label="新账号服务商预设">
                {providerPresets.map((preset) => (
                  <button
                    className={newAccountForm.provider === preset.provider ? 'active' : ''}
                    key={preset.id}
                    onClick={() => applyNewAccountPreset(preset)}
                  >
                    <strong>{preset.label}</strong>
                    <span>{preset.hint}</span>
                  </button>
                ))}
              </section>
              <label>
                IMAP
                <input value={newAccountForm.imap_host} onChange={(event) => setNewAccountForm({ ...newAccountForm, imap_host: event.target.value })} />
              </label>
              <label>
                SMTP
                <input value={newAccountForm.smtp_host} onChange={(event) => setNewAccountForm({ ...newAccountForm, smtp_host: event.target.value })} />
              </label>
              </section>
            </details>
            <div className="settings-section-heading">
              <strong>当前账号</strong>
              <span>{accountForm.email}</span>
            </div>
            <label>
              显示名称
              <input value={accountForm.display_name} onChange={(event) => setAccountForm({ ...accountForm, display_name: event.target.value })} />
            </label>
            <label>
              服务商
              <input value={accountForm.provider} onChange={(event) => setAccountForm({ ...accountForm, provider: event.target.value })} />
            </label>
            <section className="provider-presets" aria-label="服务商预设">
              {providerPresets.map((preset) => (
                <button
                  className={accountForm.provider === preset.provider ? 'active' : ''}
                  key={preset.id}
                  onClick={() => applyProviderPreset(preset)}
                >
                  <strong>{preset.label}</strong>
                  <span>{preset.hint}</span>
                </button>
              ))}
            </section>
            <details className="settings-disclosure" data-settings-section="providers">
              <summary>
                <span>
                  <strong>服务商兼容性与真实验证</strong>
                  <em>预设、IMAP/SMTP/OAuth 状态和限制</em>
                </span>
                <b>{providerVerificationLabel(activeProviderVerification?.status ?? 'untested')}</b>
              </summary>
              <section className="provider-matrix" aria-label="服务商兼容性矩阵">
                <header>
                  <strong>兼容性矩阵</strong>
                  <span>预设已内置，真实账号验证待补</span>
                </header>
                {providerCompatibilityMatrix.map((provider) => (
                  <button
                    className={accountForm.provider === provider.provider ? 'active' : ''}
                    key={provider.id}
                    onClick={() => applyProviderPreset(provider)}
                  >
                    <strong>{provider.label}</strong>
                    <span>{provider.auth_type === 'oauth2' ? 'OAuth2' : '授权码'} · {provider.imap_host} · {provider.smtp_host}</span>
                    <small>{provider.setup}</small>
                    <em>{provider.tested_status === 'needs-account' ? '需真实账号验证' : '预设可用'} · {provider.limitations}</em>
                    {providerVerifications[provider.id] && (
                      <small>
                        本地验证：{providerVerificationLabel(providerVerifications[provider.id].status)}
                        {providerVerifications[provider.id].checked_at ? ` · ${formatDate(providerVerifications[provider.id].checked_at)}` : ''}
                      </small>
                    )}
                  </button>
                ))}
              </section>
              {activeProviderVerification && (
                <section className="tool-panel">
                  <header className="tool-header">
                    <strong>真实账号验证记录</strong>
                    <span>{providerVerificationLabel(activeProviderVerification.status)}</span>
                  </header>
                  <label>
                    验证状态
                    <select
                      value={activeProviderVerification.status}
                      onChange={(event) =>
                        updateProviderVerification(accountForm.provider, {
                          status: event.target.value as ProviderVerificationStatus,
                        })
                      }
                    >
                      <option value="untested">未验证</option>
                      <option value="passed">通过</option>
                      <option value="partial">部分通过</option>
                      <option value="failed">失败</option>
                    </select>
                  </label>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={activeProviderVerification.imap_ok}
                      onChange={(event) => updateProviderVerification(accountForm.provider, { imap_ok: event.target.checked })}
                    />
                    IMAP 登录 / 文件夹发现通过
                  </label>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={activeProviderVerification.smtp_ok}
                      onChange={(event) => updateProviderVerification(accountForm.provider, { smtp_ok: event.target.checked })}
                    />
                    SMTP 发送通过
                  </label>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={activeProviderVerification.oauth_ok}
                      onChange={(event) => updateProviderVerification(accountForm.provider, { oauth_ok: event.target.checked })}
                    />
                    OAuth2 / XOAUTH2 通过
                  </label>
                  <label>
                    备注
                    <textarea
                      value={activeProviderVerification.notes}
                      onChange={(event) => updateProviderVerification(accountForm.provider, { notes: event.target.value })}
                      placeholder="记录失败原因、租户限制、授权码策略或附件/HTML 样本问题"
                    />
                  </label>
                  <button onClick={saveProviderVerification}>保存验证记录</button>
                </section>
              )}
            </details>
            <label>
              IMAP
              <input value={accountForm.imap_host} onChange={(event) => setAccountForm({ ...accountForm, imap_host: event.target.value })} />
            </label>
            <label>
              SMTP
              <input value={accountForm.smtp_host} onChange={(event) => setAccountForm({ ...accountForm, smtp_host: event.target.value })} />
            </label>
            <label data-settings-section="auth">
              认证方式
              <select value={accountForm.auth_type} onChange={(event) => setAccountForm({ ...accountForm, auth_type: event.target.value })}>
                <option value="password">应用专用密码 / 授权码</option>
                <option value="oauth2">OAuth2 Token</option>
              </select>
            </label>
            <div className="oauth-guide">
              <strong>{accountForm.auth_type === 'oauth2' ? 'OAuth2 向导' : '授权码模式'}</strong>
              <p>
                {accountForm.auth_type === 'oauth2'
                  ? '已支持 Gmail/Outlook PKCE 授权页、回调授权码记录、token 交换入 Keychain、自动刷新和 XOAUTH2 登录。'
                  : '适用于 QQ、网易和自建邮箱的应用专用密码/授权码，密码只写入系统 Keychain。'}
              </p>
            </div>
            {accountForm.auth_type === 'oauth2' && (
              <details className="settings-disclosure" data-settings-section="auth">
                <summary>
                  <span>
                    <strong>OAuth2 高级流程</strong>
                    <em>PKCE、回调、Token 交换与刷新</em>
                  </span>
                  <b>{oauthSessions.length} 个会话</b>
                </summary>
              <section className="oauth-pkce-panel">
                <label>
                  OAuth2 Client ID
                  <input
                    value={oauthClientId}
                    onChange={(event) => setOauthClientId(event.target.value)}
                    placeholder="Gmail / Outlook 应用 Client ID"
                  />
                </label>
                <label>
                  Redirect URI
                  <input
                    value={oauthRedirectUri}
                    onChange={(event) => setOauthRedirectUri(event.target.value)}
                  />
                </label>
                <label>
                  Client Secret（可选）
                  <input
                    value={oauthClientSecret}
                    onChange={(event) => setOauthClientSecret(event.target.value)}
                    placeholder="桌面 PKCE 通常可留空"
                    type="password"
                  />
                </label>
                <button onClick={startOAuth2Pkce}>打开 OAuth2 授权页</button>
                <button onClick={refreshOAuth2Token}>刷新已保存 Token</button>
                {oauthReport && (
                  <div className="oauth-result">
                    <strong>{oauthReport.provider} · Session #{oauthReport.session_id}</strong>
                    <span>{oauthReport.code_verifier_hint}</span>
                    <small>Scopes: {oauthReport.scopes.join(', ')}</small>
                    <em>State: {oauthReport.state}</em>
                  </div>
                )}
                <div className="oauth-callback-form">
                  <input
                    value={oauthCallbackState}
                    onChange={(event) => setOauthCallbackState(event.target.value)}
                    placeholder="回调 state"
                  />
                  <input
                    value={oauthCallbackCode}
                    onChange={(event) => setOauthCallbackCode(event.target.value)}
                    placeholder="授权码 code"
                    type="password"
                  />
                <button onClick={completeOAuth2Callback}>记录回调授权码</button>
                <button onClick={waitForOAuth2Callback}>监听本地回调</button>
              </div>
                {oauthCallbackReport && (
                  <div className="oauth-result">
                    <strong>{oauthCallbackReport.provider} · {oauthCallbackReport.status}</strong>
                    <span>Session #{oauthCallbackReport.session_id}</span>
                    <small>{oauthCallbackReport.message}</small>
                  </div>
                )}
                {oauthExchangeReport && (
                  <div className="oauth-result">
                    <strong>{oauthExchangeReport.provider} · {oauthExchangeReport.status}</strong>
                    <span>Session #{oauthExchangeReport.session_id}</span>
                    <small>
                      {oauthExchangeReport.expires_at
                        ? `Access token 过期时间：${formatDate(oauthExchangeReport.expires_at)}`
                        : oauthExchangeReport.message}
                    </small>
                  </div>
                )}
                {oauthRefreshReport && (
                  <div className="oauth-result">
                    <strong>{oauthRefreshReport.provider} · {oauthRefreshReport.status}</strong>
                    <span>{oauthRefreshReport.message}</span>
                    <small>Access token 过期时间：{formatDate(oauthRefreshReport.expires_at)}</small>
                  </div>
                )}
                {oauthSessions.length > 0 && (
                  <div className="oauth-session-list">
                    {oauthSessions.slice(0, 3).map((session) => (
                      <div key={session.id}>
                        <strong>{session.provider} · {session.status}</strong>
                        <span>{formatDate(session.created_at)} · {session.redirect_uri}</span>
                        <small>{session.scopes.join(', ')}</small>
                        {(session.status === 'code_received' || session.status === 'token_exchange_failed') && (
                          <button onClick={() => exchangeOAuth2Token(session.id)}>交换并保存 Token</button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
              </details>
            )}
            <label>
              同步策略
              <select value={accountForm.sync_mode} onChange={(event) => setAccountForm({ ...accountForm, sync_mode: event.target.value })}>
                <option value="manual">手动</option>
                <option value="15min">每 15 分钟</option>
                <option value="push">推送优先</option>
              </select>
            </label>
            <section className="tool-panel" data-settings-section="notifications">
              <header className="tool-header">
                <strong>通知策略</strong>
                <span>
                  {notificationPolicy.vipOnly
                    ? '仅 VIP'
                    : notificationPolicy.priorityAccounts.trim()
                      ? '重点账号优先'
                      : notificationPolicy.quietHoursEnabled
                        ? '免打扰已配置'
                        : '全部新邮件'}
                </span>
              </header>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={notificationPolicy.quietHoursEnabled}
                  onChange={(event) => setNotificationPolicy({ ...notificationPolicy, quietHoursEnabled: event.target.checked })}
                />
                启用免打扰时段
              </label>
              <label>
                免打扰开始
                <input
                  type="time"
                  value={notificationPolicy.quietStart}
                  onChange={(event) => setNotificationPolicy({ ...notificationPolicy, quietStart: event.target.value })}
                />
              </label>
              <label>
                免打扰结束
                <input
                  type="time"
                  value={notificationPolicy.quietEnd}
                  onChange={(event) => setNotificationPolicy({ ...notificationPolicy, quietEnd: event.target.value })}
                />
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={notificationPolicy.vipOnly}
                  onChange={(event) => setNotificationPolicy({ ...notificationPolicy, vipOnly: event.target.checked })}
                />
                只提醒 VIP 发件人
              </label>
              <label>
                VIP 发件人
                <textarea
                  value={notificationPolicy.vipSenders}
                  onChange={(event) => setNotificationPolicy({ ...notificationPolicy, vipSenders: event.target.value })}
                  placeholder={'ada@example.com\n@customer.com'}
                />
              </label>
              <label>
                静音账号
                <textarea
                  value={notificationPolicy.mutedAccounts}
                  onChange={(event) => setNotificationPolicy({ ...notificationPolicy, mutedAccounts: event.target.value })}
                  placeholder={'archive@example.com\n2'}
                />
              </label>
              <label>
                重点账号
                <textarea
                  value={notificationPolicy.priorityAccounts}
                  onChange={(event) => setNotificationPolicy({ ...notificationPolicy, priorityAccounts: event.target.value })}
                  placeholder={'work@example.com\n@company.com'}
                />
              </label>
              <div className="notification-account-grid">
                {accounts.map((item) => {
                  const email = item.email.toLowerCase();
                  const muted = notificationPolicy.mutedAccounts.toLowerCase().includes(email);
                  const priority = notificationPolicy.priorityAccounts.toLowerCase().includes(email);
                  return (
                    <div key={item.id}>
                      <strong>{item.display_name || item.email}</strong>
                      <span>{item.email}</span>
                      <div>
                        <button
                          type="button"
                          className={muted ? 'active' : ''}
                          onClick={() => setNotificationPolicy(toggleAccountNotificationList(notificationPolicy, 'mutedAccounts', item.email))}
                        >
                          {muted ? '取消静音' : '静音'}
                        </button>
                        <button
                          type="button"
                          className={priority ? 'active' : ''}
                          onClick={() => setNotificationPolicy(toggleAccountNotificationList(notificationPolicy, 'priorityAccounts', item.email))}
                        >
                          {priority ? '取消重点' : '重点'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
            <label className="checkbox-row">
              <input type="checkbox" checked={accountForm.remote_images_allowed} onChange={(event) => setAccountForm({ ...accountForm, remote_images_allowed: event.target.checked })} />
              允许远程图片
            </label>
            <section className="tool-panel" data-settings-section="privacy">
              <header className="tool-header">
                <strong>远程图片信任列表</strong>
                <span>{remoteImageTrusts.filter((trust) => trust.account_id === accountForm.id).length} 条</span>
              </header>
              {remoteImageTrusts.filter((trust) => trust.account_id === accountForm.id).length === 0 ? (
                <p>默认阻止远程图片；在阅读面可按发件人或域名加入信任列表。</p>
              ) : (
                remoteImageTrusts
                  .filter((trust) => trust.account_id === accountForm.id)
                  .map((trust) => (
                    <div className="tool-row" key={trust.id}>
                      <span>{trust.scope === 'sender' ? '发件人' : '域名'}</span>
                      <em>{trust.value}</em>
                      <small>{formatDate(trust.created_at)}</small>
                      <button type="button" onClick={() => deleteRemoteImageTrust(trust)}>移除</button>
                    </div>
                  ))
              )}
            </section>
            <label>
              签名
              <textarea value={accountForm.signature} onChange={(event) => setAccountForm({ ...accountForm, signature: event.target.value })} />
            </label>
            <section className="tool-panel identity-panel" data-settings-section="identities">
              <header className="tool-header">
                <strong>发件身份 / 别名</strong>
                <span>{identities.filter((identity) => identity.account_id === accountForm.id).length} 个</span>
              </header>
              {identities
                .filter((identity) => identity.account_id === accountForm.id)
                .map((identity) => (
                  <div className="tool-row" key={identity.id}>
                    <span>{identity.is_default ? '默认' : '别名'}</span>
                    <em>{identity.name} &lt;{identity.email}&gt;</em>
                    <small>{identity.reply_to ? `回复到 ${identity.reply_to}` : '无 Reply-To'}</small>
                    <button type="button" onClick={() => editIdentity(identity)}>编辑</button>
                    {!identity.is_default && <button type="button" onClick={() => deleteIdentity(identity)}>删除</button>}
                  </div>
                ))}
              <div className="identity-form">
                <input
                  value={identityForm.name}
                  onChange={(event) => setIdentityForm({ ...identityForm, name: event.target.value })}
                  placeholder="显示名"
                />
                <input
                  value={identityForm.email}
                  onChange={(event) => setIdentityForm({ ...identityForm, email: event.target.value })}
                  placeholder="发件邮箱 / 别名"
                />
                <input
                  value={identityForm.reply_to}
                  onChange={(event) => setIdentityForm({ ...identityForm, reply_to: event.target.value })}
                  placeholder="Reply-To，可选"
                />
                <textarea
                  value={identityForm.signature}
                  onChange={(event) => setIdentityForm({ ...identityForm, signature: event.target.value })}
                  placeholder="该身份专用签名"
                />
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={identityForm.is_default}
                    onChange={(event) => setIdentityForm({ ...identityForm, is_default: event.target.checked })}
                  />
                  设为默认发件身份
                </label>
                <div>
                  <button type="button" className="secondary" onClick={() => setIdentityForm(emptyIdentityForm)}>清空</button>
                  <button type="button" onClick={() => saveIdentity().catch((error) => setStatus(String(error)))}>保存身份</button>
                </div>
              </div>
            </section>
            <div className="settings-action-bar">
              <span>凭据后续接入系统 Keychain，本地数据库只保存非敏感配置。</span>
              <div>
                <button className="secondary" onClick={testConnection}>连接测试</button>
                <button className="secondary" onClick={exportDiagnostics}>导出诊断</button>
                <button onClick={saveSettings}>保存设置</button>
              </div>
            </div>
            <details className="settings-disclosure" data-settings-section="backup">
              <summary>
                <span>
                  <strong>备份、诊断与连接报告</strong>
                  <em>导入导出、脱敏 JSON、连接测试详情</em>
                </span>
                <b>{localBackupSummary ? `${localBackupSummary.messages} 封` : '未备份'}</b>
              </summary>
              {diagnosticExport && (
                <section className="tool-panel">
                  <header className="tool-header">
                    <strong>脱敏诊断</strong>
                    <span>{Math.round(diagnosticExport.length / 1024)} KB JSON</span>
                  </header>
                  <textarea readOnly value={diagnosticExport.slice(0, 2500)} />
                </section>
              )}
              <section className="tool-panel">
                <header className="tool-header">
                  <strong>本地备份与恢复</strong>
                  <span>{localBackupSummary ? `${localBackupSummary.messages} 封邮件` : '不包含系统凭据'}</span>
                </header>
                <p>备份包含账号配置、文件夹、邮件、标签、附件元数据、规则、发件箱和同步记录；密码与 OAuth token 仍保留在系统 Keychain。</p>
                <div className="tool-actions">
                  <button className="secondary" onClick={importEmlFile}>导入 EML</button>
                  <button className="secondary" onClick={previewLocalBackup}>预览备份</button>
                  <button className="secondary" onClick={importLocalBackup}>恢复备份</button>
                  <button onClick={exportLocalBackup}>导出本地备份</button>
                </div>
                <small>单个 EML 上限 25 MB；正文会安全清洗，内嵌附件将保存到本地应用数据目录。</small>
                {localBackupSummary && (
                  <div className="tool-row ok">
                    <span>v{localBackupSummary.schema_version}</span>
                    <em>{localBackupSummary.path || 'mock://swiftmail-backup.json'}</em>
                    <small>{Math.max(1, Math.round(localBackupSummary.size_bytes / 1024))} KB</small>
                    <p>
                      账号 {localBackupSummary.accounts} · 邮件 {localBackupSummary.messages} · 标签 {localBackupSummary.labels} · 规则 {localBackupSummary.rules} · 凭据
                      {localBackupSummary.credentials_included ? '已包含' : '未包含'}
                    </p>
                  </div>
                )}
              </section>
              {connectionReport && (
                <section className="tool-panel">
                  <strong>连接测试</strong>
                  {connectionReport.endpoints.map((endpoint) => (
                    <div className={endpoint.reachable ? 'tool-row ok' : 'tool-row warn'} key={endpoint.name}>
                      <span>{endpoint.name}</span>
                      <em>{endpoint.address}</em>
                      <small>{endpoint.latency_ms === null ? '未连通' : `${endpoint.latency_ms}ms`}</small>
                      <p>{endpoint.message}</p>
                    </div>
                  ))}
                </section>
              )}
            </details>
            <details className="settings-disclosure" data-settings-section="sync">
              <summary>
                <span>
                  <strong>同步与发信高级工具</strong>
                  <em>IMAP 发现、同步演练、发件箱队列</em>
                </span>
                <b>{syncRuns.length ? `${syncRuns.length} 次` : '待运行'}</b>
              </summary>
            <section className="tool-panel">
              <header className="tool-header">
                <strong>IMAP 文件夹发现</strong>
                <button onClick={discoverImapFolders}>发现文件夹</button>
              </header>
              {!imapProbe ? (
                <p>保存系统凭据后，可真实登录 IMAP 并读取远端文件夹列表。</p>
              ) : (
                <>
                  <div className={imapProbe.status === 'ok' ? 'tool-row ok' : 'tool-row warn'}>
                    <span>{imapProbe.status}</span>
                    <em>{imapProbe.account_email}</em>
                    <small>{imapProbe.folder_count} 个</small>
                    <p>{imapProbe.message}</p>
                  </div>
                  {imapProbe.folders.slice(0, 12).map((folder) => (
                    <div className="tool-row" key={folder.name}>
                      <span>{folder.name}</span>
                      <em>{folder.delimiter || 'flat'}</em>
                      <small>{folder.attributes.join(', ')}</small>
                    </div>
                  ))}
                </>
              )}
            </section>
            <section className="tool-panel" data-settings-section="auth">
              <header className="tool-header">
                <strong>系统凭据库</strong>
                <span>{accountForm.email}</span>
              </header>
              <label>
                {accountForm.auth_type === 'oauth2' ? 'OAuth2 Token' : '应用专用密码 / 授权码'}
                <input
                  type="password"
                  value={credentialSecret}
                  autoComplete="new-password"
                  onChange={(event) => setCredentialSecret(event.target.value)}
                  placeholder="只写入系统 Keychain，不进入本地数据库"
                />
              </label>
              <div className="credential-actions">
                <button className="secondary" onClick={checkCredential}>检查</button>
                <button className="secondary" onClick={deleteCredential}>删除</button>
                <button onClick={storeCredential}>保存凭据</button>
              </div>
              {credentialStatus && (
                <div className={credentialStatus.exists ? 'tool-row ok' : 'tool-row warn'}>
                  <span>{credentialStatus.exists ? '已存在' : '未保存'}</span>
                  <em>{credentialStatus.account_email}</em>
                  <p>{credentialStatus.message}</p>
                </div>
              )}
            </section>
            <section className="tool-panel">
              <header className="tool-header">
                <strong>同步演练</strong>
                <div className="tool-actions">
                  <button className="secondary" onClick={runSyncDryRun}>演练</button>
                  <button onClick={() => enqueueBackgroundTask('sync', 'manual')}>同步邮件头</button>
                </div>
              </header>
              {syncSchedulePlan && (
                <div className="sync-schedule-card">
                  <div>
                    <span>同步调度与限流</span>
                    <strong>
                      本轮 {syncSchedulePlan.batch_accounts.length}/{syncSchedulePlan.total_accounts || 0} 个账号
                    </strong>
                  </div>
                  <div className="sync-schedule-metrics">
                    <span>每轮最多 {syncSchedulePlan.max_accounts_per_batch} 个账号</span>
                    <span>
                      下一批 {syncSchedulePlan.delayed_accounts.length
                        ? `${syncSchedulePlan.delayed_accounts.length} 个账号`
                        : '无等待'}
                    </span>
                  </div>
                  <p>{syncSchedulePlan.strategy}</p>
                  <div className="sync-account-strip">
                    {syncSchedulePlan.batch_accounts.map((syncAccount) => (
                      <span className="active" key={syncAccount.id}>
                        {syncAccount.display_name || syncAccount.email}
                      </span>
                    ))}
                    {syncSchedulePlan.delayed_accounts.slice(0, 3).map((syncAccount) => (
                      <span key={syncAccount.id}>
                        下轮 · {syncAccount.display_name || syncAccount.email}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {imapMailboxes.length > 0 && (
                <div className="mailbox-grid">
                  {imapMailboxes.slice(0, 8).map((mailbox) => (
                    <div key={mailbox.id}>
                      <strong>{mailbox.remote_name}</strong>
                      <span>{mailbox.local_role} · UID {mailbox.highest_uid || 0}</span>
                    </div>
                  ))}
                </div>
              )}
              {syncRuns.length === 0 ? (
                <p>还没有同步运行记录。</p>
              ) : (
                syncRuns.map((run) => (
                  <div className={run.imported_messages > 0 ? 'tool-row ok' : 'tool-row'} key={run.id}>
                    <span>{run.status}</span>
                    <em>扫描 {run.scanned_folders} 个文件夹 · 新增 {run.imported_messages} 封</em>
                    <small>{formatDate(run.started_at)}</small>
                    <p>{run.message}</p>
                  </div>
                ))
              )}
            </section>
            <section className="tool-panel">
              <header className="tool-header">
                <strong>发件箱队列</strong>
                <div className="tool-actions">
                  <button className="secondary" onClick={() => enqueueBackgroundTask('outbox-dry-run', 'manual')}>发送演练</button>
                  <button onClick={() => enqueueBackgroundTask('outbox-smtp', 'manual')}>真实发送</button>
                </div>
              </header>
              {outbox.length === 0 ? (
                <p>发件箱当前为空。</p>
              ) : (
                outbox.map((item) => (
                  <div className="tool-row" key={item.id}>
                    <span>{outboxStatusLabel(item.status)}</span>
                    <em>{item.recipients}</em>
                    <small>{item.attempts} 次</small>
                    <p>
                      {item.subject || '(无主题)'}
                      {outboxTimingLabel(item) ? ` · ${outboxTimingLabel(item)}` : ''}
                      {item.last_error ? ` · ${item.last_error}` : ''}
                    </p>
                    {canCancelOutboxItem(item.status) && (
                      <button className="inline-action" onClick={() => cancelOutboxItem(item)}>
                        撤回
                      </button>
                    )}
                  </div>
                ))
              )}
            </section>
            </details>
            <section className="tool-panel grid-tools" data-settings-section="rules">
              <div>
                <strong>联系人</strong>
                {contactMergeSuggestions.length > 0 && (
                  <section className="contact-suggestion-panel">
                    <header>
                      <span>
                        <strong>重复联系人建议</strong>
                        <em>{contactMergeSuggestions.length} 组待处理</em>
                      </span>
                    </header>
                    {contactMergeSuggestions.slice(0, 3).map((suggestion) => (
                      <div className="contact-suggestion" key={`${suggestion.target.id}-${suggestion.source.id}`}>
                        <span>
                          <strong>{suggestion.source.name || suggestion.source.email}</strong>
                          <em>合并到 {suggestion.target.name || suggestion.target.email}</em>
                          <small>{suggestion.reason} · {suggestion.shared_keys.join(', ')}</small>
                        </span>
                        <button type="button" onClick={() => mergeSuggestedContact(suggestion).catch((error) => setStatus(String(error)))}>
                          一键合并
                        </button>
                      </div>
                    ))}
                  </section>
                )}
                <div className="contact-create-form">
                  <input
                    value={contactForm.name}
                    onChange={(event) => setContactForm({ ...contactForm, name: event.target.value })}
                    placeholder="联系人名称"
                  />
                  <input
                    value={contactForm.email}
                    onChange={(event) => setContactForm({ ...contactForm, email: event.target.value })}
                    placeholder="邮箱地址"
                  />
                  <textarea
                    value={contactFormAliases}
                    onChange={(event) => setContactFormAliases(event.target.value)}
                    placeholder="别名邮箱，逗号或换行分隔"
                  />
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={contactForm.vip}
                      onChange={(event) => setContactForm({ ...contactForm, vip: event.target.checked })}
                    />
                    设为 VIP
                  </label>
                  <button type="button" onClick={() => createManagedContact().catch((error) => setStatus(String(error)))}>
                    新增联系人
                  </button>
                </div>
                {managedContacts.slice(0, 6).map((contact) => (
                  <div className="tool-row contact-tool-row" key={contact.id}>
                    {editingContactId === contact.id ? (
                      <div className="contact-edit-form">
                        <input
                          value={contactEditName}
                          onChange={(event) => setContactEditName(event.target.value)}
                          placeholder="联系人名称"
                        />
                        <textarea
                          value={contactEditAliases}
                          onChange={(event) => setContactEditAliases(event.target.value)}
                          placeholder="别名邮箱，逗号或换行分隔"
                        />
                        <div>
                          <button type="button" onClick={() => saveContactOverride(contact).catch((error) => setStatus(String(error)))}>保存</button>
                          <button type="button" className="secondary" onClick={() => setEditingContactId(null)}>取消</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <button type="button" onClick={() => composeToContact(contact)}>
                          <strong>{contact.vip ? '★ ' : ''}{contact.name || contact.email}</strong>
                          <em>{contact.email}{contact.aliases.length ? ` · 别名 ${contact.aliases.length}` : ''}</em>
                          <small>{contact.message_count} 封往来</small>
                        </button>
                        <div className="contact-tool-actions">
                          <button type="button" onClick={() => startEditContact(contact)}>编辑</button>
                          <button type="button" onClick={() => toggleContactVip(contact).catch((error) => setStatus(String(error)))}>{contact.vip ? '取消 VIP' : '设为 VIP'}</button>
                          <button type="button" onClick={() => mergeManagedContact(contact).catch((error) => setStatus(String(error)))}>合并</button>
                          <button type="button" className="danger" onClick={() => deleteManagedContact(contact).catch((error) => setStatus(String(error)))}>删除</button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
                <label className="contact-merge-picker">
                  合并来源
                  <select
                    value={mergeSourceContactId ?? ''}
                    onChange={(event) => setMergeSourceContactId(event.target.value ? Number(event.target.value) : null)}
                  >
                    <option value="">选择一个联系人</option>
                    {managedContacts.map((contact) => (
                      <option key={contact.id} value={contact.id}>
                        {contact.name || contact.email} · {contact.email}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div>
                <strong>规则</strong>
                <div className="rule-editor">
                  <input
                    value={ruleForm.name}
                    onChange={(event) => setRuleForm({ ...ruleForm, name: event.target.value })}
                    placeholder="规则名称"
                  />
                  <div className="rule-builder">
                    <label>
                      <span>如果</span>
                      <select
                        value={ruleBuilderField}
                        onChange={(event) => updateRuleConditionField(event.target.value as RuleConditionField)}
                      >
                        {ruleConditionFields.map((field) => (
                          <option key={field.id} value={field.id}>{field.label}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>包含</span>
                      <input
                        value={ruleBuilderNeedle}
                        onChange={(event) => updateRuleConditionValue(event.target.value)}
                        placeholder="关键词或邮箱"
                      />
                    </label>
                    <label>
                      <span>打标签</span>
                      <select
                        value={
                          ruleActionParts(ruleForm.action)
                            .find((part) => part.toLowerCase().startsWith('apply label '))
                            ?.slice('apply label '.length) ?? ''
                        }
                        onChange={(event) => updateRuleLabelAction(event.target.value)}
                      >
                        <option value="">不打标签</option>
                        {labels.map((label) => (
                          <option key={label.id} value={label.name}>{label.name}</option>
                        ))}
                      </select>
                    </label>
                    <div className="rule-action-chips">
                      {ruleActionPresets.map((item) => (
                        <button
                          type="button"
                          key={item.id}
                          className={ruleActionParts(ruleForm.action).some((part) => part.toLowerCase() === item.id) ? 'active' : ''}
                          onClick={() => toggleRuleAction(item.id)}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <details className="rule-advanced">
                    <summary>高级语法</summary>
                    <small>可手动组合多个动作，用分号分隔。</small>
                    <input
                      value={ruleForm.condition}
                      onChange={(event) => setRuleForm({ ...ruleForm, condition: event.target.value })}
                      placeholder="条件，如 from contains customer"
                      aria-label="规则条件语法"
                    />
                    <input
                      value={ruleForm.action}
                      onChange={(event) => setRuleForm({ ...ruleForm, action: event.target.value })}
                      placeholder="动作，如 apply label 重要客户; mark read; star; stop processing"
                      aria-label="规则动作语法"
                    />
                  </details>
                  <label>
                    <input
                      type="checkbox"
                      checked={ruleForm.enabled}
                      onChange={(event) => setRuleForm({ ...ruleForm, enabled: event.target.checked })}
                    />
                    启用
                  </label>
                  <button onClick={saveRule}>{editingRuleId ? '更新规则' : '新增规则'}</button>
                </div>
                {rules.map((rule) => (
                  <div className="rule-item" key={rule.id}>
                    <p>{rule.enabled ? '启用' : '停用'} · {rule.name}</p>
                    <small>{rule.condition} → {rule.action}</small>
                    <div>
                      <button onClick={() => toggleRule(rule)}>{rule.enabled ? '停用' : '启用'}</button>
                      <button onClick={() => editRule(rule)}>编辑</button>
                      <button onClick={() => removeRule(rule)}>删除</button>
                    </div>
                  </div>
                ))}
              </div>
              <div>
                <strong>线程</strong>
                {threads.slice(0, 6).map((thread) => (
                  <p key={thread.thread_key}>{thread.subject} · {thread.message_count} 封 · 未读 {thread.unread_count}</p>
                ))}
              </div>
            </section>
            <details className="settings-disclosure" data-settings-section="security-preview">
              <summary>
                <span>
                  <strong>原始邮件安全预览</strong>
                  <em>调试 HTML 清洗、附件和安全警告</em>
                </span>
                <b>{parsedPreview ? `${parsedPreview.attachment_count} 附件` : '调试'}</b>
              </summary>
              <section className="tool-panel raw-preview">
                <header className="tool-header">
                  <strong>原始邮件安全预览</strong>
                  <button onClick={parseRawMessage}>解析</button>
                </header>
                <textarea value={rawMessage} onChange={(event) => setRawMessage(event.target.value)} />
                {parsedPreview && (
                  <div className="preview-result">
                    <strong>{parsedPreview.subject}</strong>
                    <span>{parsedPreview.from} → {parsedPreview.to}</span>
                    <pre>{parsedPreview.body_preview}</pre>
                    {parsedPreview.sanitized_html && (
                      <>
                        <div
                          className="sanitized-html-preview"
                          dangerouslySetInnerHTML={{ __html: parsedPreview.sanitized_html }}
                        />
                        <details>
                          <summary>清洗后的 HTML 源码</summary>
                          <pre>{parsedPreview.sanitized_html}</pre>
                        </details>
                      </>
                    )}
                    {parsedPreview.attachment_count > 0 && (
                      <div className="preview-metadata">
                        <span>附件 {parsedPreview.attachment_count}</span>
                        {parsedPreview.attachment_names.map((name) => <em key={name}>{name}</em>)}
                      </div>
                    )}
                    {parsedPreview.warnings.map((warning) => <p key={warning}>{warning}</p>)}
                  </div>
                )}
              </section>
            </details>
              </div>
            </div>
          </section>
        </div>
      )}
      {isShortcutsOpen && (
        <div className="composer-backdrop shortcut-backdrop">
          <section className="shortcut-modal" role="dialog" aria-modal="true" aria-label="快捷键帮助">
            <header>
              <div>
                <strong>快捷键</strong>
                <span>高频邮件操作，不离开键盘。</span>
              </div>
              <button type="button" onClick={() => setShortcutsOpen(false)}>关闭</button>
            </header>
            <div className="shortcut-grid">
              {shortcutGroups.map((group) => (
                <section className="shortcut-group" key={group.title}>
                  <strong>{group.title}</strong>
                  {group.items.map((item) => (
                    <div className="shortcut-row" key={`${group.title}-${item.label}`}>
                      <span>{item.label}</span>
                      <div>
                        {item.keys.map((key) => <kbd key={key}>{key}</kbd>)}
                      </div>
                    </div>
                  ))}
                </section>
              ))}
            </div>
          </section>
        </div>
      )}
      {isCommandPaletteOpen && (
        <div className="composer-backdrop command-palette-backdrop">
          <section className="command-palette" role="dialog" aria-modal="true" aria-label="命令面板">
            <header>
              <Search size={18} />
              <input
                autoFocus
                value={commandQuery}
                onChange={(event) => setCommandQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    const first = filteredCommandItems.find((item) => !item.disabled);
                    if (first) void runCommandPaletteItem(first);
                  }
                }}
                placeholder="搜索命令、邮箱、标签或动作"
              />
              <button type="button" onClick={() => setCommandPaletteOpen(false)} aria-label="关闭命令面板">
                <X size={16} />
              </button>
            </header>
            <div className="command-list">
              {filteredCommandItems.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  disabled={item.disabled}
                  onClick={() => runCommandPaletteItem(item).catch((error) => setStatus(String(error)))}
                >
                  <span>{item.section}</span>
                  <strong>{item.title}</strong>
                  <em>{item.hint}</em>
                </button>
              ))}
              {filteredCommandItems.length === 0 && <p>没有匹配命令</p>}
            </div>
          </section>
        </div>
      )}
      {undoAction && (
        <section className="undo-snackbar" role="status" aria-live="polite">
          <div>
            <strong>{undoAction.title}</strong>
            <span>{undoAction.detail}</span>
          </div>
          <button type="button" onClick={() => restoreUndoAction().catch((error) => setStatus(String(error)))}>
            撤销
          </button>
          <button type="button" aria-label="关闭撤销提示" onClick={() => setUndoAction(null)}>
            <X size={15} />
          </button>
        </section>
      )}
      <div className="status-line">{status}</div>
    </main>
  );
}
