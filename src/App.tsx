import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  Clock,
  Edit3,
  Inbox,
  Keyboard,
  Mail,
  Maximize2,
  Minus,
  MoreHorizontal,
  Paperclip,
  RefreshCw,
  Reply,
  Search,
  Send,
  Settings,
  SlidersHorizontal,
  Star,
  Tag,
  Wand2,
  Trash2,
  X,
} from 'lucide-react';
import './styles.css';
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

type SystemFolderRole = 'inbox' | 'sent' | 'drafts' | 'archive' | 'trash' | 'spam' | 'snoozed' | 'custom';
type FolderRole = SystemFolderRole | `custom:${string}`;
type FilterMode = 'all' | 'unread' | 'starred' | 'attachments';
type ListMode = 'messages' | 'threads';
type AccountScope = number | 'all';
type ProviderVerificationStatus = 'untested' | 'passed' | 'partial' | 'failed';
type BackgroundTaskKind = 'sync' | 'outbox-dry-run' | 'outbox-smtp';
type BackgroundTaskStatus = 'queued' | 'running' | 'done' | 'failed';

type Account = {
  id: number;
  email: string;
  display_name: string;
  provider: string;
  imap_host: string;
  smtp_host: string;
  auth_type: string;
  sync_mode: string;
  remote_images_allowed: boolean;
  signature: string;
};

type AccountCreateInput = Omit<Account, 'id'>;

type Folder = {
  id: number;
  account_id: number | null;
  name: string;
  role: FolderRole;
  unread_count: number;
  is_virtual: boolean;
};

type Label = {
  id: number;
  name: string;
  color: string;
  message_count: number;
};

type SavedSearch = {
  id: string;
  name: string;
  query: string;
  filter: FilterMode;
};

type Attachment = {
  id: number;
  message_id: number;
  filename: string;
  mime_type: string;
  size_bytes: number;
  is_downloaded: boolean;
  local_path: string;
};

type OutboundAttachmentInput = {
  filename: string;
  mime_type: string;
  size_bytes: number;
  local_path: string;
};

type DroppedFile = File & { path?: string };

type AttachmentDownload = {
  attachment: Attachment;
  local_path: string;
  message: string;
};

type Message = {
  id: number;
  account_id: number;
  account_email: string;
  folder_id: number;
  folder_role: FolderRole;
  sender_name: string;
  sender_email: string;
  recipients: string;
  cc: string;
  bcc: string;
  subject: string;
  snippet: string;
  body: string;
  sanitized_html: string;
  security_warnings: string[];
  received_at: string;
  is_read: boolean;
  is_starred: boolean;
  has_attachments: boolean;
  snoozed_until: string;
  labels: string[];
  attachment_count: number;
  remote_mailbox: string;
  remote_uid: number;
};

type UndoMessageSnapshot = {
  id: number;
  subject: string;
  folder_role: FolderRole;
  is_read: boolean;
  is_starred: boolean;
  snoozed_until: string;
  labels: string[];
};

type UndoAction = {
  id: string;
  title: string;
  detail: string;
  snapshots: UndoMessageSnapshot[];
};

type CommandPaletteItem = {
  id: string;
  title: string;
  section: string;
  hint: string;
  disabled?: boolean;
  run: () => void | Promise<void>;
};

type RemoteImageTrust = {
  id: number;
  account_id: number;
  account_email: string;
  scope: 'sender' | 'domain';
  value: string;
  created_at: string;
};

type MailIdentity = {
  id: number;
  account_id: number;
  name: string;
  email: string;
  reply_to: string;
  signature: string;
  is_default: boolean;
};

type MailIdentityInput = {
  id: number;
  account_id: number;
  name: string;
  email: string;
  reply_to: string;
  signature: string;
  is_default: boolean;
};

type DraftInput = {
  draft_id: number;
  account_id: number;
  identity_id: number;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  html_body: string;
  send_at: string;
  attachments: OutboundAttachmentInput[];
};

type ComposeTemplate = {
  id: string;
  name: string;
  subject: string;
  body: string;
  html_body: string;
};

type ComposerAutosave = {
  draft: DraftInput;
  isRichComposer: boolean;
  saved_at: string;
};

type MailStats = {
  total_messages: number;
  unread_messages: number;
  starred_messages: number;
  draft_messages: number;
  attachment_messages: number;
};

type LocalBackupSummary = {
  path: string;
  exported_at: string;
  app_version: string;
  schema_version: number;
  accounts: number;
  messages: number;
  labels: number;
  rules: number;
  outbox_items: number;
  size_bytes: number;
  credentials_included: boolean;
};

type EndpointCheck = {
  name: string;
  address: string;
  reachable: boolean;
  latency_ms: number | null;
  message: string;
};

type ConnectionReport = {
  account_email: string;
  checked_at: string;
  endpoints: EndpointCheck[];
  ready_for_credentials: boolean;
};

type ImapFolderProbe = {
  name: string;
  delimiter: string;
  attributes: string[];
};

type ImapProbeReport = {
  account_email: string;
  checked_at: string;
  folder_count: number;
  folders: ImapFolderProbe[];
  status: string;
  message: string;
};

type ImapMailboxState = {
  id: number;
  account_id: number;
  account_email: string;
  remote_name: string;
  delimiter: string;
  attributes: string;
  local_role: string;
  uid_validity: string;
  highest_uid: number;
  last_seen_at: string;
  last_sync_at: string;
};

type SyncRun = {
  id: number;
  started_at: string;
  finished_at: string;
  status: string;
  scanned_folders: number;
  imported_messages: number;
  message: string;
};

type RemoteActionReport = {
  local_applied: boolean;
  remote_attempted: boolean;
  remote_applied: boolean;
  message: string;
};

type ParsedMessagePreview = {
  subject: string;
  from: string;
  to: string;
  body_preview: string;
  sanitized_html: string;
  attachment_count: number;
  attachment_names: string[];
  warning_count: number;
  warnings: string[];
};

type Contact = {
  id: number;
  name: string;
  email: string;
  aliases: string[];
  vip: boolean;
  message_count: number;
  last_seen_at: string;
};

type MailRule = {
  id: number;
  name: string;
  condition: string;
  action: string;
  enabled: boolean;
};

type MailRuleInput = {
  name: string;
  condition: string;
  action: string;
  enabled: boolean;
};

type ThreadSummary = {
  thread_key: string;
  subject: string;
  message_count: number;
  unread_count: number;
  latest_at: string;
  participants: string;
};

type OutboxItem = {
  id: number;
  message_id: number;
  recipients: string;
  subject: string;
  status: string;
  attempts: number;
  last_error: string;
  queued_at: string;
  next_attempt_at: string;
};

type CredentialStatus = {
  account_email: string;
  exists: boolean;
  message: string;
};

type OAuthStartReport = {
  session_id: number;
  provider: string;
  authorization_url: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  code_verifier_hint: string;
  scopes: string[];
  message: string;
};

type OAuthSession = {
  id: number;
  provider: string;
  authorization_url: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  scopes: string[];
  status: string;
  created_at: string;
  completed_at: string;
  message: string;
};

type OAuthCallbackReport = {
  session_id: number;
  provider: string;
  status: string;
  message: string;
};

type OAuthTokenExchangeReport = {
  session_id: number;
  provider: string;
  status: string;
  expires_at: string;
  message: string;
};

type OAuthRefreshReport = {
  provider: string;
  status: string;
  expires_at: string;
  message: string;
};

type ProviderVerificationRecord = {
  provider_key: string;
  provider_label: string;
  status: ProviderVerificationStatus;
  imap_ok: boolean;
  smtp_ok: boolean;
  oauth_ok: boolean;
  diagnostic_exported: boolean;
  checked_at: string;
  notes: string;
};

type BackgroundTask = {
  id: number;
  kind: BackgroundTaskKind;
  title: string;
  source: 'manual' | 'timer';
  status: BackgroundTaskStatus;
  message: string;
  created_at: string;
  started_at: string;
  finished_at: string;
};

type AppLayout = {
  sidebar: number;
  list: number;
};

const emptyDraft: DraftInput = { draft_id: 0, account_id: 0, identity_id: 0, to: '', cc: '', bcc: '', subject: '', body: '', html_body: '', send_at: '', attachments: [] };

function normalizeCommandSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[：:·,，。.\s]+/g, '')
    .trim();
}
const emptyIdentityForm: MailIdentityInput = {
  id: 0,
  account_id: 0,
  name: '',
  email: '',
  reply_to: '',
  signature: '',
  is_default: false,
};
const emptyRuleForm: MailRuleInput = {
  name: '',
  condition: 'from contains ',
  action: 'apply label ',
  enabled: true,
};

const notificationPolicyStorageKey = 'swiftmail.notificationPolicy';
const providerVerificationStorageKey = 'swiftmail.providerVerifications';
const savedSearchesStorageKey = 'swiftmail.savedSearches';
const composeTemplatesStorageKey = 'swiftmail.composeTemplates';
const composerAutosaveStorageKey = 'swiftmail.composerAutosave';
const appLayoutStorageKey = 'swiftmail.appLayout';
const defaultAppLayout: AppLayout = { sidebar: 268, list: 420 };
const filterModes: FilterMode[] = ['all', 'unread', 'starred', 'attachments'];

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function backgroundTaskTitle(kind: BackgroundTaskKind, source: 'manual' | 'timer' = 'manual'): string {
  if (kind === 'sync') return source === 'timer' ? '定时同步邮件头' : '同步邮件头';
  if (kind === 'outbox-smtp') return '真实发送发件箱';
  return '发件箱发送演练';
}

function loadNotificationPolicy(): NotificationPolicy {
  try {
    const stored = window.localStorage.getItem(notificationPolicyStorageKey);
    return stored ? { ...defaultNotificationPolicy, ...JSON.parse(stored) } : defaultNotificationPolicy;
  } catch {
    return defaultNotificationPolicy;
  }
}

function normalizeContactAliases(value: string): string[] {
  return [...new Set(value
    .split(/[;,\n]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean))];
}

function loadProviderVerifications(): Record<string, ProviderVerificationRecord> {
  try {
    const stored = window.localStorage.getItem(providerVerificationStorageKey);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function isFilterMode(value: unknown): value is FilterMode {
  return typeof value === 'string' && filterModes.includes(value as FilterMode);
}

function loadSavedSearches(): SavedSearch[] {
  try {
    const stored = window.localStorage.getItem(savedSearchesStorageKey);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.name === 'string' && typeof item.query === 'string')
      .map((item) => ({
        id: typeof item.id === 'string' ? item.id : crypto.randomUUID(),
        name: item.name,
        query: item.query,
        filter: isFilterMode(item.filter) ? item.filter : 'all',
      }))
      .filter((item) => item.name.trim() && item.query.trim());
  } catch {
    return [];
  }
}

function loadComposeTemplates(): ComposeTemplate[] {
  try {
    const stored = window.localStorage.getItem(composeTemplatesStorageKey);
    const parsed = stored ? JSON.parse(stored) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.name === 'string')
      .map((item) => ({
        id: typeof item.id === 'string' ? item.id : crypto.randomUUID(),
        name: item.name,
        subject: typeof item.subject === 'string' ? item.subject : '',
        body: typeof item.body === 'string' ? item.body : '',
        html_body: typeof item.html_body === 'string' ? item.html_body : '',
      }))
      .filter((item) => item.name.trim() && (item.subject.trim() || item.body.trim() || item.html_body.trim()));
  } catch {
    return [];
  }
}

function isDraftEmpty(input: DraftInput): boolean {
  return (
    !input.to.trim()
    && !input.cc.trim()
    && !input.bcc.trim()
    && !input.subject.trim()
    && !input.body.trim()
    && !input.html_body.trim()
    && input.attachments.length === 0
  );
}

function normalizeDraftInput(value: unknown): DraftInput | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<DraftInput>;
  const attachments = Array.isArray(item.attachments)
    ? item.attachments.filter(
      (attachment) =>
        attachment &&
        typeof attachment.filename === 'string' &&
        typeof attachment.mime_type === 'string' &&
        typeof attachment.size_bytes === 'number' &&
        typeof attachment.local_path === 'string',
    )
    : [];
  return {
    draft_id: Number(item.draft_id) || 0,
    account_id: Number(item.account_id) || 0,
    identity_id: Number(item.identity_id) || 0,
    to: typeof item.to === 'string' ? item.to : '',
    cc: typeof item.cc === 'string' ? item.cc : '',
    bcc: typeof item.bcc === 'string' ? item.bcc : '',
    subject: typeof item.subject === 'string' ? item.subject : '',
    body: typeof item.body === 'string' ? item.body : '',
    html_body: typeof item.html_body === 'string' ? item.html_body : '',
    send_at: typeof item.send_at === 'string' ? item.send_at : '',
    attachments,
  };
}

function loadComposerAutosave(): ComposerAutosave | null {
  try {
    const stored = window.localStorage.getItem(composerAutosaveStorageKey);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    const draft = normalizeDraftInput(parsed?.draft);
    if (!draft || isDraftEmpty(draft)) return null;
    return {
      draft,
      isRichComposer: Boolean(parsed?.isRichComposer),
      saved_at: typeof parsed?.saved_at === 'string' ? parsed.saved_at : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function loadAppLayout(): AppLayout {
  try {
    const stored = window.localStorage.getItem(appLayoutStorageKey);
    if (!stored) return defaultAppLayout;
    const parsed = JSON.parse(stored);
    return {
      sidebar: clampNumber(Number(parsed.sidebar) || defaultAppLayout.sidebar, 220, 360),
      list: clampNumber(Number(parsed.list) || defaultAppLayout.list, 320, 560),
    };
  } catch {
    return defaultAppLayout;
  }
}

function providerVerificationLabel(status: ProviderVerificationStatus): string {
  if (status === 'passed') return '通过';
  if (status === 'partial') return '部分通过';
  if (status === 'failed') return '失败';
  return '未验证';
}

function outboxStatusLabel(status: string): string {
  if (status === 'scheduled') return '定时发送';
  if (status === 'queued') return '排队中';
  if (status === 'retry') return '等待重试';
  if (status === 'failed') return '发送失败';
  if (status === 'sent') return '已发送';
  if (status === 'sent_dry_run') return '演练完成';
  if (status === 'cancelled') return '已撤回';
  return status;
}

function outboxTimingLabel(item: OutboxItem): string {
  if (item.status === 'scheduled' && item.next_attempt_at) return `定时发送 ${formatDate(item.next_attempt_at)}`;
  if (item.status === 'retry' && item.next_attempt_at) return `下次重试 ${formatDate(item.next_attempt_at)}`;
  if (item.status === 'failed' && item.next_attempt_at) return `下次尝试 ${formatDate(item.next_attempt_at)}`;
  if (item.queued_at) return `入队 ${formatDate(item.queued_at)}`;
  return '';
}

function canCancelOutboxItem(status: string): boolean {
  return ['queued', 'scheduled', 'retry', 'failed'].includes(status);
}

function isCustomFolder(folder: Folder): boolean {
  return folder.role.startsWith('custom:');
}

function movableFoldersForMessage(folders: Folder[], message?: Message | null): Folder[] {
  const blockedRoles = new Set<string>(['snoozed']);
  return folders.filter((folder) => {
    if (folder.is_virtual || blockedRoles.has(folder.role)) return false;
    if (message && folder.account_id !== message.account_id) return false;
    return true;
  });
}

function movableFoldersForBulk(folders: Folder[], selectedMessages: Message[]): Folder[] {
  if (selectedMessages.length === 0) return [];
  const accountIds = new Set(selectedMessages.map((message) => message.account_id));
  const blockedRoles = new Set<string>(['snoozed']);
  if (accountIds.size !== 1) return [];
  return folders.filter((folder) => {
    if (folder.is_virtual || blockedRoles.has(folder.role)) return false;
    return folder.account_id === selectedMessages[0].account_id;
  });
}

const sampleRawMessage = `Subject: 安全预览样例
From: sender@example.com
To: demo@swiftmail.local

<img src="http://tracking.example.com/open.png">
<script>alert('xss')</script>
这是一封用于验证 MIME/HTML 安全预览的原始邮件。`;

const folderIcon: Record<SystemFolderRole, React.ReactNode> = {
  inbox: <Inbox size={17} />,
  sent: <Send size={17} />,
  drafts: <Edit3 size={17} />,
  archive: <Archive size={17} />,
  trash: <Trash2 size={17} />,
  spam: <Mail size={17} />,
  snoozed: <Clock size={17} />,
  custom: <Mail size={17} />,
};

function folderIconForRole(role: FolderRole): React.ReactNode {
  return folderIcon[role as SystemFolderRole] ?? folderIcon.custom;
}

const primaryFolderRoles = new Set<FolderRole>(['inbox']);

const shortcutGroups = [
  {
    title: '导航',
    items: [
      { keys: ['⌘/Ctrl', 'K'], label: '聚焦搜索' },
      { keys: ['/'], label: '快速搜索' },
      { keys: ['J', '↓'], label: '下一封' },
      { keys: ['K', '↑'], label: '上一封' },
      { keys: ['Esc'], label: '关闭弹窗' },
    ],
  },
  {
    title: '写信',
    items: [
      { keys: ['C'], label: '写邮件' },
      { keys: ['R'], label: '回复' },
      { keys: ['⇧', 'R'], label: '回复全部' },
      { keys: ['F'], label: '转发' },
    ],
  },
  {
    title: '处理邮件',
    items: [
      { keys: ['S'], label: '星标' },
      { keys: ['M'], label: '已读/未读' },
      { keys: ['E'], label: '归档' },
      { keys: ['Delete'], label: '移到废纸篓' },
    ],
  },
];

const filters: { id: FilterMode; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'unread', label: '未读' },
  { id: 'starred', label: '星标' },
  { id: 'attachments', label: '附件' },
];

const emptyAccountCreateForm: AccountCreateInput = {
  email: '',
  display_name: '',
  provider: 'Custom',
  imap_host: '',
  smtp_host: '',
  auth_type: 'password',
  sync_mode: 'manual',
  remote_images_allowed: false,
  signature: '',
};

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
  const [editingContactId, setEditingContactId] = useState<number | null>(null);
  const [contactEditName, setContactEditName] = useState('');
  const [contactEditAliases, setContactEditAliases] = useState('');
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
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null);
  const [status, setStatus] = useState('本地原型已就绪');
  const [backgroundSyncStatus, setBackgroundSyncStatus] = useState('后台同步待机');
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTask[]>([]);
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
        sidebar: clampNumber(resize.origin.sidebar + delta, 220, 360),
      });
      return;
    }
    setAppLayout({
      ...resize.origin,
      list: clampNumber(resize.origin.list + delta, 320, 560),
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
      nextIdentities,
      nextRules,
      nextThreads,
      nextOutbox,
      nextBackgroundTasks,
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
      invoke<MailIdentity[]>('list_identities', { accountId: nextAccountId }),
      invoke<MailRule[]>('list_rules'),
      invoke<ThreadSummary[]>('list_threads'),
      invoke<OutboxItem[]>('list_outbox'),
      invoke<BackgroundTask[]>('list_background_tasks'),
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
    setIdentities(nextIdentities);
    setRules(nextRules);
    setThreads(nextThreads);
    setOutbox(nextOutbox);
    setBackgroundTasks(nextBackgroundTasks);
    setRemoteImageTrusts(nextRemoteImageTrusts);
    setImapMailboxes(nextImapMailboxes);
    setOauthSessions(nextOauthSessions);
    void updateAppUnreadBadge(nextStats.unread_messages);
    const resolvedFolderId =
      nextFolders.length > 0 && nextFolderId && nextFolders.some((folder) => folder.id === nextFolderId)
        ? nextFolderId
        : nextFolders[0]?.id ?? null;
    setFolderId(resolvedFolderId);
    return resolvedFolderId;
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
  ) {
    if (!nextFolderId) return [];
    const nextAccountId = accountIdForScope(nextScope);
    const nextMessages = await invoke<Message[]>('list_messages', {
      accountId: nextAccountId,
      folderId: nextFolderId,
      query: nextQuery.trim() || null,
      filter: nextFilter,
      limit: 80,
    });
    setMessages(nextMessages);
    setSelectedMessageIds((current) =>
      current.filter((id) => nextMessages.some((message) => message.id === id)),
    );
    setSelectedId((current) => {
      if (current && nextMessages.some((message) => message.id === current)) return current;
      return nextMessages[0]?.id ?? null;
    });
    if (!frontendReadyRef.current) {
      frontendReadyRef.current = true;
      void invoke('mark_frontend_ready', {
        message: `folder=${nextFolderId};messages=${nextMessages.length};scope=${nextScope}`,
      });
      void maybeRunBenchmarkSync();
    }
    return nextMessages;
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
    loadMeta(null).catch((error) => setStatus(String(error)));
  }, [accountScope]);

  useEffect(() => {
    loadMessages().catch((error) => setStatus(String(error)));
  }, [accountScope, folderId, filter]);

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
  const currentViewLabel = listMode === 'threads' ? '线程' : '邮件';
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
    await loadMeta(folderId);
    await loadMessages();
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
    await refreshAll();
    setSelectedId(action.snapshots[0]?.id ?? null);
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
    await refreshAll();
    setStatus(report.message);
    queueUndoAction(role === 'trash' ? '删除' : role === 'archive' ? '归档' : `移动到 ${role}`, undoSnapshots);
  }

  async function moveSelectedToFolder(folder: Folder) {
    if (!selected) return;
    const undoSnapshots = snapshotMessages([selected]);
    const report = await invoke<RemoteActionReport>('move_message_to_role', { messageId: selected.id, role: folder.role });
    await refreshAll();
    setStatus(`已移动到 ${folder.name}`);
    queueUndoAction(`移动到 ${folder.name}`, undoSnapshots, report.message);
  }

  async function markSelectedAsSpam() {
    if (!selected) return;
    const undoSnapshots = snapshotMessages([selected]);
    await invoke('move_message_to_role', { messageId: selected.id, role: 'spam' });
    const spamFolderId = folders.find((folder) => folder.account_id === selected.account_id && folder.role === 'spam')?.id ?? folderId;
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
    const inboxFolderId = folders.find((folder) => folder.account_id === restored.account_id && folder.role === 'inbox')?.id ?? folderId;
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
    const inboxFolderId = folders.find((folder) => folder.account_id === restored.account_id && folder.role === 'inbox')?.id ?? folderId;
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
    const nextFolderId = await loadMeta(folder.id);
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
    const nextFolderId = await loadMeta(folderId);
    await loadMessages(nextFolderId);
    setStatus(`已重命名文件夹：${renamed.name}`);
  }

  async function deleteCustomFolder(folder: Folder) {
    await invoke('delete_custom_folder', { folderId: folder.id });
    const inboxFolderId = folders.find((entry) => entry.account_id === folder.account_id && entry.role === 'inbox')?.id ?? null;
    const nextFolderId = await loadMeta(folderId === folder.id ? inboxFolderId : folderId);
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
    const snoozedFolderId = folders.find((folder) => folder.role === 'snoozed')?.id ?? folderId;
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
    const inboxFolderId = folders.find((folder) => folder.role === 'inbox')?.id ?? folderId;
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
    const nextFolderId = await loadMeta(null, created.id);
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
    const nextFolderId = await loadMeta(null);
    await loadMessages(nextFolderId);
    setStatus(`本地备份已恢复：${summary.messages} 封邮件，${summary.accounts} 个账号`);
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
    setBackgroundSyncStatus(reason === 'timer' ? '后台同步中...' : '手动同步中...');
    try {
      const run = await invoke<SyncRun>('sync_imap_headers', { accountId: accountIdForScope(accountScope) });
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
      setNotificationStatus(decision.vipMatches > 0 ? 'VIP 系统提醒已发送' : '系统提醒已发送');
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
    const spamFolderId = folders.find((folder) => folder.account_id === selected.account_id && folder.role === 'spam')?.id ?? folderId;
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
    setEditingRuleId(rule.id);
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
    }
    setStatus(`规则已删除：${rule.name}`);
  }

  async function runSearch(event: React.FormEvent) {
    event.preventDefault();
    await loadMessages(folderId, query, filter);
    setStatus(query.trim() ? `已搜索：${query.trim()}` : '已清除搜索');
  }

  async function runSavedSearch(savedSearch: SavedSearch) {
    setQuery(savedSearch.query);
    setFilter(savedSearch.filter);
    setListMode('messages');
    setActiveThread(null);
    setThreadMessages([]);
    await loadMessages(folderId, savedSearch.query, savedSearch.filter);
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
    setStatus(nextScope === 'all' ? '已切换到统一邮箱视图' : '已切换到单账号视图');
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
      style={{ gridTemplateColumns: `${appLayout.sidebar}px 6px ${appLayout.list}px 6px minmax(520px, 1fr)` }}
      onPointerMove={moveLayoutResize}
      onPointerUp={endLayoutResize}
      onPointerCancel={endLayoutResize}
      onMouseMove={moveLayoutMouseResize}
      onMouseUp={endLayoutMouseResize}
      onMouseLeave={endLayoutMouseResize}
    >
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">S</div>
          <div>
            <strong>SwiftMail</strong>
            <span>{accountScope === 'all' ? `统一邮箱 · ${accounts.length || 1} 个账号` : account?.email ?? '低内存邮箱客户端'}</span>
          </div>
        </div>
        <label className="account-switcher">
          <span>邮箱范围</span>
          <select value={accountScope} onChange={(event) => changeAccountScope(event.target.value)}>
            <option value="all">统一邮箱</option>
            {accounts.map((item) => (
              <option key={item.id} value={item.id}>{item.email}</option>
            ))}
          </select>
        </label>
        <button className="compose-button" onClick={() => openComposer()}>
          <Edit3 size={17} /> 写邮件
        </button>
        <nav className="folder-list">
          {folders.filter((folder) => primaryFolderRoles.has(folder.role)).map((folder) => (
            <div
              key={folder.id}
              className={folder.id === folderId ? 'folder active' : 'folder'}
            >
              {renamingFolderId === folder.id ? (
                <form
                  className="folder-rename"
                  onSubmit={(event) => {
                    event.preventDefault();
                    renameCustomFolder(folder).catch((error) => setStatus(String(error)));
                  }}
                >
                  <input
                    value={renamingFolderName}
                    onChange={(event) => setRenamingFolderName(event.target.value)}
                    autoFocus
                  />
                  <button type="submit">保存</button>
                  <button type="button" onClick={() => setRenamingFolderId(null)}>取消</button>
                </form>
              ) : (
                <>
                  <button type="button" className="folder-main" onClick={() => setFolderId(folder.id)}>
                    <span className="folder-name">
                      {folderIconForRole(folder.role)}
                      {folder.name}
                    </span>
                    {folder.unread_count > 0 && <span className="badge">{folder.unread_count}</span>}
                  </button>
                  {isCustomFolder(folder) && (
                    <span className="folder-actions">
                      <button type="button" title="重命名" onClick={() => startRenameCustomFolder(folder)}>改</button>
                      <button type="button" title="删除" onClick={() => deleteCustomFolder(folder).catch((error) => setStatus(String(error)))}>删</button>
                    </span>
                  )}
                </>
              )}
            </div>
          ))}
        </nav>

        <div className="sidebar-secondary sidebar-quick-menus">
          <details className="sidebar-disclosure more-mailboxes">
            <summary>
              <span>邮箱</span>
              <em>{folders.filter((folder) => !primaryFolderRoles.has(folder.role)).length}</em>
            </summary>
            <nav className="folder-list folded-folder-list">
              {folders.filter((folder) => !primaryFolderRoles.has(folder.role)).map((folder) => (
                <div
                  key={folder.id}
                  className={folder.id === folderId ? 'folder active' : 'folder'}
                >
                  {renamingFolderId === folder.id ? (
                    <form
                      className="folder-rename"
                      onSubmit={(event) => {
                        event.preventDefault();
                        renameCustomFolder(folder).catch((error) => setStatus(String(error)));
                      }}
                    >
                      <input
                        value={renamingFolderName}
                        onChange={(event) => setRenamingFolderName(event.target.value)}
                        autoFocus
                      />
                      <button type="submit">保存</button>
                      <button type="button" onClick={() => setRenamingFolderId(null)}>取消</button>
                    </form>
                  ) : (
                    <>
                      <button type="button" className="folder-main" onClick={() => setFolderId(folder.id)}>
                        <span className="folder-name">
                          {folderIconForRole(folder.role)}
                          {folder.name}
                        </span>
                        {folder.unread_count > 0 && <span className="badge">{folder.unread_count}</span>}
                      </button>
                      {isCustomFolder(folder) && (
                        <span className="folder-actions">
                          <button type="button" title="重命名" onClick={() => startRenameCustomFolder(folder)}>改</button>
                          <button type="button" title="删除" onClick={() => deleteCustomFolder(folder).catch((error) => setStatus(String(error)))}>删</button>
                        </span>
                      )}
                    </>
                  )}
                </div>
              ))}
            </nav>
          </details>

          <details className="sidebar-disclosure sidebar-tools">
            <summary>
              <span>工具</span>
              <em>{savedSearches.length + contacts.length + labels.length}</em>
            </summary>
            <div className="sidebar-tool-stack">
              <section className="sidebar-tool-section saved-searches">
                <div className="sidebar-tool-heading">
                  <strong>保存搜索</strong>
                  <span>{savedSearches.length ? `${savedSearches.length} 个` : '保存常用条件'}</span>
                </div>
                <form
                  className="saved-search-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    saveCurrentSearch();
                  }}
                >
                  <input
                    value={savedSearchName}
                    onChange={(event) => setSavedSearchName(event.target.value)}
                    placeholder="搜索名称"
                  />
                  <button type="submit">保存</button>
                </form>
                <div className="saved-search-list">
                  {savedSearches.map((savedSearch) => (
                    <div className="saved-search-row" key={savedSearch.id}>
                      <button type="button" onClick={() => runSavedSearch(savedSearch).catch((error) => setStatus(String(error)))}>
                        <strong>{savedSearch.name}</strong>
                        <span>{savedSearch.query}</span>
                      </button>
                      <button type="button" title="删除保存搜索" onClick={() => deleteSavedSearch(savedSearch)}>删</button>
                    </div>
                  ))}
                  {savedSearches.length === 0 && <small>保存常用搜索条件</small>}
                </div>
              </section>

              <section className="sidebar-tool-section contact-center">
                <div className="sidebar-tool-heading">
                  <strong>联系人</strong>
                  <span>{contacts.length ? `${contacts.length} 位` : '自动收集'}</span>
                </div>
                <input
                  value={contactQuery}
                  onChange={(event) => setContactQuery(event.target.value)}
                  placeholder="搜索联系人"
                />
                <div className="contact-list">
                  {filteredContacts.map((contact) => (
                    <div className="contact-row" key={contact.id}>
                      <button type="button" onClick={() => composeToContact(contact)}>
                        <strong>{contact.vip ? '★ ' : ''}{contact.name || contact.email}</strong>
                        <span>{contact.email}{contact.aliases.length ? ` · ${contact.aliases.length} 个别名` : ''}</span>
                      </button>
                      <button type="button" title="加入当前草稿" onClick={() => addContactToDraft(contact)}>
                        加入
                      </button>
                      <button type="button" title={contact.vip ? '取消 VIP' : '设为 VIP'} onClick={() => toggleContactVip(contact).catch((error) => setStatus(String(error)))}>
                        {contact.vip ? 'VIP' : '星标'}
                      </button>
                    </div>
                  ))}
                  {filteredContacts.length === 0 && <small>没有匹配联系人</small>}
                </div>
              </section>

              <section className="sidebar-tool-section label-section">
                <div className="sidebar-tool-heading">
                  <strong>标签</strong>
                  <span>{labels.length} 个</span>
                </div>
                <div className="label-list">
                  {labels.map((label) => (
                    <div className="label-row" key={label.id}>
                      <span style={{ background: label.color }} />
                      <strong>{label.name}</strong>
                      <em>{label.message_count}</em>
                    </div>
                  ))}
                </div>
              </section>

              <section className="sidebar-tool-section folder-manager">
                <div className="sidebar-tool-heading">
                  <strong>文件夹</strong>
                  <span>{folders.filter(isCustomFolder).length ? `${folders.filter(isCustomFolder).length} 个自定义` : '新建文件夹'}</span>
                </div>
                <form
                  className="custom-folder-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    createCustomFolder().catch((error) => setStatus(String(error)));
                  }}
                >
                  <input
                    value={customFolderName}
                    onChange={(event) => setCustomFolderName(event.target.value)}
                    placeholder="新建文件夹"
                  />
                  <button type="submit">添加</button>
                </form>
              </section>
            </div>
          </details>
        </div>

        <div className="sidebar-footer">
          <div className="sidebar-footer-actions">
            <button className="settings-button" title="设置" onClick={() => setSettingsOpen(true)}>
              <Settings size={17} /> <span>设置</span>
            </button>
            <button className="settings-button shortcut-help-button" title="快捷键" onClick={() => setShortcutsOpen(true)}>
              <Keyboard size={17} /> <span>快捷键</span>
            </button>
            <button className="settings-button command-palette-button" title="命令" onClick={() => setCommandPaletteOpen(true)}>
              <Search size={17} /> <span>命令</span>
            </button>
          </div>
          <details className="sidebar-disclosure background-sync-card">
            <summary>
              <span>同步与布局</span>
              <em>{backgroundTasks.some((task) => task.status === 'running') ? '同步中' : '就绪'}</em>
            </summary>
            <span>{backgroundSyncStatus}</span>
            {lastNewMailNotice && <em>{lastNewMailNotice}</em>}
            <small>{notificationStatus}</small>
            <small>{appBadgeStatus}</small>
            {backgroundTasks.length > 0 && (
              <div className="task-stack">
                {backgroundTasks.slice(0, 3).map((task) => (
                  <small key={task.id}>
                    {task.title} · {task.status === 'queued' ? '排队' : task.status === 'running' ? '执行中' : task.status === 'done' ? '完成' : '失败'}
                  </small>
                ))}
              </div>
            )}
            <div className="sidebar-utility-actions">
              <button type="button" onClick={() => enqueueBackgroundTask('sync', 'manual')}>立即同步</button>
              <button className="layout-reset-button" type="button" onClick={resetAppLayout}>重置布局</button>
            </div>
          </details>
        </div>
      </aside>

      <button
        className="pane-resizer sidebar-resizer"
        type="button"
        aria-label="调整侧边栏宽度"
        title="拖拽调整侧边栏宽度"
        onPointerDown={(event) => beginLayoutResize('sidebar', event)}
        onMouseDown={(event) => beginLayoutMouseResize('sidebar', event)}
      />

      <section className="message-list-panel">
        <header className="toolbar">
          <form onSubmit={runSearch} className="search-box">
            <Search size={17} />
            <input
              ref={searchInputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索主题、发件人、正文；支持 from: to: subject: label: after: before: has:attachment is:unread"
            />
          </form>
          <button className="icon-button" title="刷新" onClick={refreshAll}>
            <RefreshCw size={17} />
          </button>
        </header>
        <div className="list-control-strip">
          <div className="list-summary">
            <strong>{currentViewLabel}</strong>
            <span>{messageListSummary}</span>
            <em>{activeFilterLabel}</em>
          </div>
          <div className="list-control-actions">
            <button
              type="button"
              className={listMode === 'messages' ? 'active' : ''}
              onClick={() => {
                setListMode('messages');
                setActiveThread(null);
                setThreadMessages([]);
              }}
            >
              邮件
            </button>
            <button
              type="button"
              className={listMode === 'threads' ? 'active' : ''}
              onClick={() => setListMode('threads')}
            >
              线程
            </button>
            <details className="compact-menu filter-menu">
              <summary>
                <SlidersHorizontal size={15} />
                筛选
              </summary>
              <div>
                {filters.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={filter === item.id ? 'active' : ''}
                    onClick={() => setFilter(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </details>
          </div>
        </div>
        {listMode === 'messages' && selectedMessageIds.length > 0 && (
        <div className={selectedMessageIds.length > 0 ? 'bulk-toolbar active' : 'bulk-toolbar'}>
          <label className="bulk-selection">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={(event) => toggleAllVisibleMessages(event.target.checked)}
            />
            <span>{selectedMessageIds.length > 0 ? `已选 ${selectedMessageIds.length}` : '选择'}</span>
          </label>
          <button type="button" className="bulk-primary-action" onClick={() => runBulkAction('archive')}>归档</button>
          <details className="compact-menu bulk-more-menu">
            <summary>
              <MoreHorizontal size={15} />
              操作
            </summary>
            <div>
              <button type="button" onClick={() => runBulkAction('star')}>星标</button>
              <button type="button" onClick={() => runBulkAction('trash')}>删除</button>
              <button type="button" onClick={() => runBulkAction('read')}>标为已读</button>
              <button type="button" onClick={() => runBulkAction('unread')}>标为未读</button>
              <span className="menu-section-title">移动到</span>
              {movableFoldersForBulk(folders, selectedMessages).map((folder) => (
                <button
                  type="button"
                  key={folder.id}
                  disabled={selectedMessages.length === 0}
                  onClick={() => moveSelectedMessagesToFolder(folder.role as FolderRole, folder.name).catch((error) => setStatus(String(error)))}
                >
                  {folder.name}
                </button>
              ))}
              <span className="menu-section-title">打标签</span>
              {labels.map((label) => (
                <button type="button" key={label.id} onClick={() => applyBulkLabel(label)}>
                  <span className="label-dot" style={{ background: label.color }} />
                  {label.name}
                </button>
              ))}
            </div>
          </details>
        </div>
        )}
        {listMode === 'threads' ? (
        <div className="thread-list">
          {threads.map((thread) => (
            <button
              key={thread.thread_key}
              className={activeThread?.thread_key === thread.thread_key ? 'thread-card selected' : 'thread-card'}
              onClick={() => openThread(thread)}
            >
              <div>
                <strong>{thread.subject || '(无主题)'}</strong>
                <time>{formatDate(thread.latest_at)}</time>
              </div>
              <p>{thread.participants}</p>
              <span>{thread.message_count} 封 · 未读 {thread.unread_count}</span>
            </button>
          ))}
          {threads.length === 0 && <div className="empty-state">没有会话线程</div>}
        </div>
        ) : (
        <div className="message-list">
          {messages.map((message) => (
            <button
              key={message.id}
              className={message.id === selectedId ? 'message-card selected' : 'message-card'}
              onClick={() => setSelectedId(message.id)}
            >
              <span className="message-select" onClick={(event) => event.stopPropagation()}>
                <input
                  aria-label={`选择 ${message.subject || '无主题'}`}
                  checked={selectedMessageSet.has(message.id)}
                  type="checkbox"
                  onChange={(event) => toggleMessageSelection(message.id, event.target.checked)}
                />
              </span>
              <div className="message-topline">
                <span className={message.is_read ? 'sender' : 'sender unread'}>{message.sender_name}</span>
                <time>{formatDate(message.received_at)}</time>
              </div>
              <div className={message.is_read ? 'subject' : 'subject unread'}>
                {message.is_starred ? '★ ' : ''}{message.subject || '(无主题)'}
              </div>
              <p>{message.snippet}</p>
              <div className="message-chips">
                {accountScope === 'all' && <span>{message.account_email}</span>}
                {message.labels.map((label) => <span key={label}>{label}</span>)}
                {message.attachment_count > 0 && <span><Paperclip size={12} /> {message.attachment_count}</span>}
              </div>
            </button>
          ))}
          {messages.length === 0 && <div className="empty-state">没有匹配邮件</div>}
        </div>
        )}
      </section>

      <button
        className="pane-resizer list-resizer"
        type="button"
        aria-label="调整邮件列表宽度"
        title="拖拽调整邮件列表宽度"
        onPointerDown={(event) => beginLayoutResize('list', event)}
        onMouseDown={(event) => beginLayoutMouseResize('list', event)}
      />

      <section className="reader-panel">
        {activeThread && threadMessages.length > 0 ? (
          <article className="reader thread-reader">
            <header className="reader-header">
              <div>
                <h1>{activeThread.subject || '(无主题)'}</h1>
                <p>{activeThread.participants} · {threadMessages.length} 封邮件 · 未读 {activeThread.unread_count}</p>
              </div>
              <div className="reader-actions">
                <button className="primary-action" onClick={() => activeThreadSelected && composeFromMessage(activeThreadSelected, 'reply')}>
                  <Reply size={16} />
                  回复
                </button>
                <details className="reader-more-menu compact-menu">
                  <summary>
                    <MoreHorizontal size={16} />
                    更多
                  </summary>
                  <div>
                    <button onClick={() => activeThreadSelected && composeFromMessage(activeThreadSelected, 'forward')}>转发</button>
                  </div>
                </details>
              </div>
            </header>
            <div className="thread-stack">
              {threadMessages.map((message) => (
                <section
                  className={message.id === selectedId ? 'thread-message active' : 'thread-message'}
                  key={message.id}
                  onClick={() => setSelectedId(message.id)}
                >
                  <header>
                    <strong>{message.sender_name} &lt;{message.sender_email}&gt;</strong>
                    <time>{formatDate(message.received_at)}</time>
                  </header>
                  <p>{message.snippet || message.body}</p>
                  <div className="message-chips">
                    <span>{message.folder_role}</span>
                    {message.labels.map((label) => <span key={label}>{label}</span>)}
                    {message.attachment_count > 0 && <span><Paperclip size={12} /> {message.attachment_count}</span>}
                  </div>
                </section>
              ))}
            </div>
          </article>
        ) : selected ? (
          <article className="reader">
            <header className="reader-header">
              <div>
                <h1>{selected.subject || '(无主题)'}</h1>
                <p>
                  {selected.sender_name} &lt;{selected.sender_email}&gt; 发给 {selected.recipients}
                </p>
              </div>
              <div className="reader-actions">
                <button className="icon-only-action" title="标星" aria-label={selected.is_starred ? '取消星标' : '添加星标'} onClick={() => toggleStar(selected)}>
                  <Star size={17} fill={selected.is_starred ? 'currentColor' : 'none'} />
                </button>
                {selected.folder_role === 'drafts' ? (
                  <button onClick={() => editDraftMessage(selected)}>继续编辑</button>
                ) : (
                  <button className="primary-action" onClick={() => composeFromMessage(selected, 'reply')}>
                    <Reply size={16} />
                    回复
                  </button>
                )}
                <details className="reader-more-menu compact-menu">
                  <summary>
                    <MoreHorizontal size={16} />
                    更多
                  </summary>
                  <div>
                    <span className="menu-section-title">回复</span>
                    {selected.folder_role !== 'drafts' && <button onClick={() => composeFromMessage(selected, 'replyAll')}>回复全部</button>}
                    {selected.folder_role !== 'drafts' && <button onClick={() => composeFromMessage(selected, 'forward')}>转发</button>}
                    <span className="menu-section-title">整理</span>
                    {!selected.is_read && <button onClick={() => toggleRead(selected)}>标为已读</button>}
                    {selected.is_read && <button onClick={() => toggleRead(selected)}>标为未读</button>}
                    {selected.folder_role === 'trash' ? (
                      <button onClick={restoreSelectedFromTrash}>恢复</button>
                    ) : selected.folder_role !== 'drafts' && (
                      <button aria-label="归档" onClick={() => moveSelected('archive')}><Archive size={16} /> 归档</button>
                    )}
                    {selected.folder_role === 'snoozed' ? (
                      <button onClick={unsnoozeSelected}><Clock size={16} /> 取消稍后</button>
                    ) : selected.folder_role !== 'trash' && (
                      <button onClick={snoozeSelected}><Clock size={16} /> 稍后处理</button>
                    )}
                    <button onClick={exportSelectedMessage}>导出 EML</button>
                    {selected.remote_uid > 0 && !selected.body.trim() && (
                      <button onClick={fetchSelectedBody}>拉取正文</button>
                    )}
                    {selected.folder_role === 'spam' ? (
                      <button onClick={markSelectedNotSpam}>不是垃圾邮件</button>
                    ) : (
                      <button onClick={markSelectedAsSpam}>标为垃圾邮件</button>
                    )}
                    {selected.folder_role !== 'drafts' && selected.sender_email.trim() && (
                      <>
                        <span className="menu-section-title">安全</span>
                        {!selectedSenderTrusted && (
                          <button onClick={() => trustRemoteImagesForSelected('sender')}>信任该发件人</button>
                        )}
                        {selectedSenderDomain && !selectedSenderTrusted && (
                          <button onClick={() => trustRemoteImagesForSelected('domain')}>信任 {selectedSenderDomain}</button>
                        )}
                        <button onClick={blockSelectedSender}>阻止该发件人</button>
                      </>
                    )}
                    {selected.folder_role === 'trash' ? (
                      <>
                        <button onClick={permanentlyDeleteSelected}><Trash2 size={16} /> 永久删除</button>
                        <button onClick={emptyCurrentTrash}>清空废纸篓</button>
                      </>
                    ) : (
                      <button onClick={() => moveSelected('trash')}><Trash2 size={16} /> 删除</button>
                    )}
                    <span className="menu-section-title">移动到</span>
                    {movableFoldersForMessage(folders, selected).map((folder) => (
                      <button
                        type="button"
                        key={folder.id}
                        onClick={() => moveSelectedToFolder(folder).catch((error) => setStatus(String(error)))}
                      >
                        {folder.name}
                      </button>
                    ))}
                  </div>
                </details>
              </div>
            </header>
            <div className="reader-meta">
              <span>{formatDate(selected.received_at)}</span>
              {accountScope === 'all' && <span>{selected.account_email}</span>}
              {selected.snoozed_until && <span>稍后到 {formatDate(selected.snoozed_until)}</span>}
              {selected.has_attachments && <span>含附件</span>}
            </div>
            <div className="label-tools">
              {selected.labels.length === 0 && <span className="label-empty">无标签</span>}
              {selected.labels.map((labelName) => {
                const label = labels.find((item) => item.name === labelName);
                return (
                  <span className="active-label-chip" key={labelName}>
                    <span className="label-dot" style={{ background: label?.color ?? '#8b95a1' }} />
                    {labelName}
                  </span>
                );
              })}
              <details className="compact-menu label-menu">
                <summary><Tag size={15} /> 标签</summary>
                <div>
                  {labels.map((label) => (
                    <button
                      type="button"
                      key={label.id}
                      className={selected.labels.includes(label.name) ? 'active' : ''}
                      onClick={() => toggleLabel(label)}
                    >
                      <span className="label-dot" style={{ background: label.color }} />
                      {label.name}
                    </button>
                  ))}
                </div>
              </details>
            </div>
            {attachments.length > 0 && (
              <div className="attachments">
                {attachments.map((attachment) => (
                  <div key={attachment.id}>
                    <Paperclip size={15} />
                    <strong>{attachment.filename}</strong>
                    <span>{attachment.mime_type}</span>
                    <em>{formatBytes(attachment.size_bytes)}</em>
                    <button
                      type="button"
                      title={attachment.local_path || attachment.filename}
                      onClick={() =>
                        attachment.is_downloaded ? openAttachment(attachment) : downloadAttachment(attachment)
                      }
                    >
                      {attachment.is_downloaded ? '打开' : '下载'}
                    </button>
                    {attachment.is_downloaded && (
                      <button
                        type="button"
                        title={`另存为 ${attachment.filename}`}
                        onClick={() => saveAttachmentAs(attachment)}
                      >
                        另存为
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {selected.security_warnings.length > 0 && (
              <div className="reader-warning-panel">
                <div className="reader-warning-heading">
                  <strong>安全提示</strong>
                  {selectedHasRemoteImageWarning && (
                    <span>{selectedSenderTrusted ? '当前发件人已信任' : '远程图片默认阻止'}</span>
                  )}
                </div>
                {selected.security_warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
                {selectedHasRemoteImageWarning && (
                  <details className="compact-menu reader-warning-actions">
                    <summary>
                      <SlidersHorizontal size={15} />
                      处理
                    </summary>
                    <div>
                      <button type="button" onClick={() => trustRemoteImagesForSelected('sender')}>
                        信任该发件人
                      </button>
                      {selectedSenderDomain && (
                        <button type="button" onClick={() => trustRemoteImagesForSelected('domain')}>
                          信任 {selectedSenderDomain}
                        </button>
                      )}
                      <button type="button" onClick={blockSelectedSender}>
                        阻止该发件人
                      </button>
                    </div>
                  </details>
                )}
              </div>
            )}
            {selected.sanitized_html ? (
              <div
                className="reader-html"
                dangerouslySetInnerHTML={{ __html: selected.sanitized_html }}
              />
            ) : (
              <div className="body-text">{selected.body}</div>
            )}
            {selected.folder_role !== 'drafts' && selected.folder_role !== 'trash' && (
              <section className="quick-reply" aria-label="快速回复">
                <header>
                  <div>
                    <strong>快速回复</strong>
                    <span>发给 {selected.sender_name || selected.sender_email}</span>
                  </div>
                  <Reply size={16} />
                </header>
                <textarea
                  value={quickReplyBody}
                  onChange={(event) => setQuickReplyBody(event.target.value)}
                  placeholder="直接回复这封邮件，不打开完整写信窗口"
                />
                <footer>
                  <span>{quickReplyBody.trim() ? `${quickReplyBody.trim().length} 字` : 'Enter 换行，保留上下文引用'}</span>
                  <div>
                    <button type="button" onClick={() => setQuickReplyBody('')} disabled={!quickReplyBody.trim()}>
                      清空
                    </button>
                    <button type="button" onClick={() => sendQuickReply(selected)} disabled={!quickReplyBody.trim()}>
                      发送回复
                    </button>
                  </div>
                </footer>
              </section>
            )}
          </article>
        ) : (
          <div className="empty-reader">选择一封邮件开始阅读</div>
        )}
      </section>

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
            <header>
              <strong>账号设置</strong>
              <button onClick={() => setSettingsOpen(false)}>关闭</button>
            </header>
            <div className="settings-body">
              <nav className="settings-nav" aria-label="设置分类">
                <strong>设置</strong>
                <span>账号、协议、安全与自动化</span>
                <button type="button" className={activeSettingsSection === 'accounts' ? 'active' : ''} onClick={() => scrollSettingsSection('accounts')}>账号</button>
                <button type="button" className={activeSettingsSection === 'providers' ? 'active' : ''} onClick={() => scrollSettingsSection('providers')}>服务商</button>
                <button type="button" className={activeSettingsSection === 'auth' ? 'active' : ''} onClick={() => scrollSettingsSection('auth')}>认证</button>
                <button type="button" className={activeSettingsSection === 'notifications' ? 'active' : ''} onClick={() => scrollSettingsSection('notifications')}>通知</button>
                <button type="button" className={activeSettingsSection === 'privacy' ? 'active' : ''} onClick={() => scrollSettingsSection('privacy')}>隐私</button>
                <button type="button" className={activeSettingsSection === 'identities' ? 'active' : ''} onClick={() => scrollSettingsSection('identities')}>身份</button>
                <button type="button" className={activeSettingsSection === 'backup' ? 'active' : ''} onClick={() => scrollSettingsSection('backup')}>备份</button>
                <button type="button" className={activeSettingsSection === 'sync' ? 'active' : ''} onClick={() => scrollSettingsSection('sync')}>同步</button>
                <button type="button" className={activeSettingsSection === 'rules' ? 'active' : ''} onClick={() => scrollSettingsSection('rules')}>规则</button>
                <button type="button" className={activeSettingsSection === 'security-preview' ? 'active' : ''} onClick={() => scrollSettingsSection('security-preview')}>安全预览</button>
              </nav>
              <div className="settings-content">
            <section className="tool-panel" data-settings-section="accounts">
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
            <section className="provider-matrix" aria-label="服务商兼容性矩阵" data-settings-section="providers">
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
              <section className="tool-panel" data-settings-section="providers">
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
                <span>{notificationPolicy.vipOnly ? '仅 VIP' : notificationPolicy.quietHoursEnabled ? '免打扰已配置' : '全部新邮件'}</span>
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
            <footer>
              <span>凭据后续接入系统 Keychain，本地数据库只保存非敏感配置。</span>
              <div>
                <button className="secondary" onClick={testConnection}>连接测试</button>
                <button className="secondary" onClick={exportDiagnostics}>导出诊断</button>
                <button onClick={saveSettings}>保存设置</button>
              </div>
            </footer>
            {diagnosticExport && (
              <section className="tool-panel">
                <header className="tool-header">
                  <strong>脱敏诊断</strong>
                  <span>{Math.round(diagnosticExport.length / 1024)} KB JSON</span>
                </header>
                <textarea readOnly value={diagnosticExport.slice(0, 2500)} />
              </section>
            )}
            <section className="tool-panel" data-settings-section="backup">
              <header className="tool-header">
                <strong>本地备份与恢复</strong>
                <span>{localBackupSummary ? `${localBackupSummary.messages} 封邮件` : '不包含系统凭据'}</span>
              </header>
              <p>备份包含账号配置、文件夹、邮件、标签、附件元数据、规则、发件箱和同步记录；密码与 OAuth token 仍保留在系统 Keychain。</p>
              <div className="tool-actions">
                <button className="secondary" onClick={previewLocalBackup}>预览备份</button>
                <button className="secondary" onClick={importLocalBackup}>恢复备份</button>
                <button onClick={exportLocalBackup}>导出本地备份</button>
              </div>
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
            <section className="tool-panel" data-settings-section="sync">
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
            <section className="tool-panel" data-settings-section="sync">
              <header className="tool-header">
                <strong>同步演练</strong>
                <div className="tool-actions">
                  <button className="secondary" onClick={runSyncDryRun}>演练</button>
                  <button onClick={() => enqueueBackgroundTask('sync', 'manual')}>同步邮件头</button>
                </div>
              </header>
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
            <section className="tool-panel" data-settings-section="sync">
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
            <section className="tool-panel grid-tools" data-settings-section="rules">
              <div>
                <strong>联系人</strong>
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
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
              <div>
                <strong>规则</strong>
                <div className="rule-editor">
                  <input
                    value={ruleForm.name}
                    onChange={(event) => setRuleForm({ ...ruleForm, name: event.target.value })}
                    placeholder="规则名称"
                  />
                  <input
                    value={ruleForm.condition}
                    onChange={(event) => setRuleForm({ ...ruleForm, condition: event.target.value })}
                    placeholder="条件，如 from contains customer"
                  />
                  <input
                    value={ruleForm.action}
                    onChange={(event) => setRuleForm({ ...ruleForm, action: event.target.value })}
                    placeholder="动作，如 apply label 重要客户; mark read; star; stop processing"
                  />
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
            <section className="tool-panel raw-preview" data-settings-section="security-preview">
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
