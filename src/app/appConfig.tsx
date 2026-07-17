import React from 'react';
import { Archive, Clock, Edit3, Inbox, Mail, Send, Trash2 } from 'lucide-react';
import { defaultNotificationPolicy, formatDate, type NotificationPolicy } from '../mailUtils';
import type {
  AccountCreateInput,
  AppLayout,
  BackgroundTaskKind,
  ComposeTemplate,
  ComposerAutosave,
  ContactCreateInput,
  DraftInput,
  FilterMode,
  Folder,
  FolderRole,
  ListSort,
  MailIdentityInput,
  MailRuleInput,
  Message,
  MessageSummary,
  OutboxItem,
  ProviderVerificationRecord,
  ProviderVerificationStatus,
  SavedSearch,
  SearchScope,
  SystemFolderRole,
} from './types';

export const emptyDraft: DraftInput = {
  draft_id: 0,
  account_id: 0,
  identity_id: 0,
  to: '',
  cc: '',
  bcc: '',
  subject: '',
  body: '',
  html_body: '',
  send_at: '',
  attachments: [],
  in_reply_to: '',
  references: '',
};

export function normalizeCommandSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[：:·,，。.\s]+/g, '')
    .trim();
}
export const emptyIdentityForm: MailIdentityInput = {
  id: 0,
  account_id: 0,
  name: '',
  email: '',
  reply_to: '',
  signature: '',
  is_default: false,
};
export const emptyRuleForm: MailRuleInput = {
  name: '',
  condition: 'from contains ',
  action: 'apply label ',
  enabled: true,
};

export type RuleConditionField = 'from' | 'subject' | 'body' | 'to';

export const ruleConditionFields: { id: RuleConditionField; label: string }[] = [
  { id: 'from', label: '发件人' },
  { id: 'subject', label: '主题' },
  { id: 'body', label: '正文' },
  { id: 'to', label: '收件人' },
];

export const ruleActionPresets = [
  { id: 'mark read', label: '标为已读' },
  { id: 'star', label: '加星标' },
  { id: 'move to archive', label: '归档' },
  { id: 'move to trash', label: '移到废纸篓' },
  { id: 'stop processing', label: '停止后续规则' },
];

export function parseRuleCondition(condition: string): { field: RuleConditionField; value: string } {
  const normalized = condition.trim();
  const match = normalized.match(/^(from|subject|body|to|sender|recipients)\s+contains\s+(.*)$/i);
  if (!match) return { field: 'from', value: '' };
  const fieldAlias = match[1].toLowerCase();
  const field: RuleConditionField =
    fieldAlias === 'sender' ? 'from' : fieldAlias === 'recipients' ? 'to' : (fieldAlias as RuleConditionField);
  return { field, value: match[2] ?? '' };
}

export function buildRuleCondition(field: RuleConditionField, value: string): string {
  return `${field} contains ${value}`;
}

export function ruleActionParts(action: string): string[] {
  return action
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function setRuleActionPart(action: string, prefix: string, nextPart: string): string {
  const parts = ruleActionParts(action).filter((part) => !part.toLowerCase().startsWith(prefix.toLowerCase()));
  const trimmedPart = nextPart.trim();
  if (trimmedPart) parts.unshift(trimmedPart);
  return parts.join('; ');
}

export const emptyContactForm: ContactCreateInput = {
  name: '',
  email: '',
  aliases: [],
  vip: false,
};

export const notificationPolicyStorageKey = 'better-email.notificationPolicy';
export const providerVerificationStorageKey = 'better-email.providerVerifications';
export const savedSearchesStorageKey = 'better-email.savedSearches';
export const composeTemplatesStorageKey = 'better-email.composeTemplates';
export const composerAutosaveStorageKey = 'better-email.composerAutosave';
export const appLayoutStorageKey = 'better-email.appLayout.v2';
export const legacyAppLayoutStorageKey = 'swiftmail.appLayout.v2';
export const sendUndoDelayStorageKey = 'better-email.sendUndoDelaySeconds';
export const favoriteFolderKeysStorageKey = 'better-email.favoriteFolderKeys.v1';
export const listSortStorageKey = 'better-email.listSort.v1';
const legacyStorageKeyByCurrent: Record<string, string> = {
  [notificationPolicyStorageKey]: 'swiftmail.notificationPolicy',
  [providerVerificationStorageKey]: 'swiftmail.providerVerifications',
  [savedSearchesStorageKey]: 'swiftmail.savedSearches',
  [composeTemplatesStorageKey]: 'swiftmail.composeTemplates',
  [composerAutosaveStorageKey]: 'swiftmail.composerAutosave',
  [appLayoutStorageKey]: legacyAppLayoutStorageKey,
  [sendUndoDelayStorageKey]: 'swiftmail.sendUndoDelaySeconds',
  [favoriteFolderKeysStorageKey]: 'swiftmail.favoriteFolderKeys.v1',
  [listSortStorageKey]: 'swiftmail.listSort.v1',
};
export const defaultAppLayout: AppLayout = { sidebar: 244, list: 388 };
export const filterModes: FilterMode[] = ['all', 'unread', 'starred', 'attachments'];
export const listSortModes: ListSort[] = ['newest', 'oldest', 'sender', 'subject'];
export const listSortOptions: { id: ListSort; label: string }[] = [
  { id: 'newest', label: '最新优先' },
  { id: 'oldest', label: '最早优先' },
  { id: 'sender', label: '发件人 / 参与者' },
  { id: 'subject', label: '主题 A-Z' },
];
export type SendUndoDelaySeconds = 0 | 5 | 10 | 20 | 30;
export const sendUndoDelayOptions: { value: SendUndoDelaySeconds; label: string }[] = [
  { value: 0, label: '关闭，立即发送' },
  { value: 5, label: '5 秒' },
  { value: 10, label: '10 秒（推荐）' },
  { value: 20, label: '20 秒' },
  { value: 30, label: '30 秒' },
];

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function backgroundTaskTitle(kind: BackgroundTaskKind, source: 'manual' | 'timer' = 'manual'): string {
  if (kind === 'sync') return source === 'timer' ? '定时同步邮件头' : '同步邮件头';
  if (kind === 'outbox-smtp') return '真实发送发件箱';
  return '发件箱发送演练';
}

function readAppStorage(key: string): string | null {
  const current = window.localStorage.getItem(key);
  if (current != null) return current;
  const legacyKey = legacyStorageKeyByCurrent[key];
  if (!legacyKey) return null;
  const legacy = window.localStorage.getItem(legacyKey);
  if (legacy == null) return null;
  window.localStorage.setItem(key, legacy);
  window.localStorage.removeItem(legacyKey);
  return legacy;
}

export function removeAppStorage(key: string): void {
  window.localStorage.removeItem(key);
  const legacyKey = legacyStorageKeyByCurrent[key];
  if (legacyKey) window.localStorage.removeItem(legacyKey);
}

export function loadNotificationPolicy(): NotificationPolicy {
  try {
    const stored = readAppStorage(notificationPolicyStorageKey);
    return stored ? { ...defaultNotificationPolicy, ...JSON.parse(stored) } : { ...defaultNotificationPolicy };
  } catch {
    return { ...defaultNotificationPolicy };
  }
}

export function loadSendUndoDelaySeconds(): SendUndoDelaySeconds {
  try {
    const raw = readAppStorage(sendUndoDelayStorageKey);
    if (raw == null) return 10;
    const stored = Number(raw);
    return sendUndoDelayOptions.some((option) => option.value === stored)
      ? stored as SendUndoDelaySeconds
      : 10;
  } catch {
    return 10;
  }
}

export function isListSort(value: unknown): value is ListSort {
  return typeof value === 'string' && listSortModes.includes(value as ListSort);
}

export function loadListSort(): ListSort {
  try {
    const stored = readAppStorage(listSortStorageKey);
    return isListSort(stored) ? stored : 'newest';
  } catch {
    return 'newest';
  }
}

export function loadFavoriteFolderKeys(): string[] {
  try {
    const raw = readAppStorage(favoriteFolderKeysStorageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((item): item is string => typeof item === 'string' && item.length > 0))]
      : [];
  } catch {
    return [];
  }
}

export function normalizeContactAliases(value: string): string[] {
  return [...new Set(value
    .split(/[;,\n]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean))];
}

export type AccountNotificationMode = 'normal' | 'priority' | 'muted';

export function notificationListEntries(value: string): string[] {
  return [...new Set(value
    .split(/[\n,;，；]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean))];
}

function updateNotificationList(value: string, email: string, include: boolean): string {
  const normalizedEmail = email.trim().toLowerCase();
  const current = notificationListEntries(value).filter((item) => item !== normalizedEmail);
  return (include && normalizedEmail ? [...current, normalizedEmail] : current).join('\n');
}

export function getAccountNotificationMode(policy: NotificationPolicy, email: string): AccountNotificationMode {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return 'normal';
  if (notificationListEntries(policy.mutedAccounts).includes(normalizedEmail)) return 'muted';
  if (notificationListEntries(policy.priorityAccounts).includes(normalizedEmail)) return 'priority';
  return 'normal';
}

export function setAccountNotificationMode(
  policy: NotificationPolicy,
  email: string,
  mode: AccountNotificationMode,
): NotificationPolicy {
  return {
    ...policy,
    mutedAccounts: updateNotificationList(policy.mutedAccounts, email, mode === 'muted'),
    priorityAccounts: updateNotificationList(policy.priorityAccounts, email, mode === 'priority'),
  };
}

export function toggleAccountNotificationList(
  policy: NotificationPolicy,
  key: 'mutedAccounts' | 'priorityAccounts',
  email: string,
): NotificationPolicy {
  const normalizedEmail = email.trim().toLowerCase();
  const current = notificationListEntries(policy[key]);
  const next = current.includes(normalizedEmail)
    ? current.filter((item) => item !== normalizedEmail)
    : [...current, normalizedEmail];
  const nextPolicy = { ...policy, [key]: next.join('\n') };
  if (current.includes(normalizedEmail)) return nextPolicy;
  return {
    ...nextPolicy,
    [key === 'mutedAccounts' ? 'priorityAccounts' : 'mutedAccounts']: updateNotificationList(
      policy[key === 'mutedAccounts' ? 'priorityAccounts' : 'mutedAccounts'],
      normalizedEmail,
      false,
    ),
  };
}

export function loadProviderVerifications(): Record<string, ProviderVerificationRecord> {
  try {
    const stored = readAppStorage(providerVerificationStorageKey);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

export function isFilterMode(value: unknown): value is FilterMode {
  return typeof value === 'string' && filterModes.includes(value as FilterMode);
}

export function isSearchScope(value: unknown): value is SearchScope {
  return value === 'folder' || value === 'account' || value === 'all';
}

export function loadSavedSearches(): SavedSearch[] {
  try {
    const stored = readAppStorage(savedSearchesStorageKey);
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
        scope: isSearchScope(item.scope) ? item.scope : 'folder',
      }))
      .filter((item) => item.name.trim() && item.query.trim());
  } catch {
    return [];
  }
}

export function loadComposeTemplates(): ComposeTemplate[] {
  try {
    const stored = readAppStorage(composeTemplatesStorageKey);
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

export function isDraftEmpty(input: DraftInput): boolean {
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

export function normalizeDraftInput(value: unknown): DraftInput | null {
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
    in_reply_to: typeof item.in_reply_to === 'string' ? item.in_reply_to : '',
    references: typeof item.references === 'string' ? item.references : '',
  };
}

export function loadComposerAutosave(): ComposerAutosave | null {
  try {
    const stored = readAppStorage(composerAutosaveStorageKey);
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

export function loadAppLayout(): AppLayout {
  try {
    const stored = readAppStorage(appLayoutStorageKey);
    if (!stored) return defaultAppLayout;
    const parsed = JSON.parse(stored);
    return {
      sidebar: clampNumber(Number(parsed.sidebar) || defaultAppLayout.sidebar, 228, 320),
      list: clampNumber(Number(parsed.list) || defaultAppLayout.list, 340, 500),
    };
  } catch {
    return defaultAppLayout;
  }
}

export function providerVerificationLabel(status: ProviderVerificationStatus): string {
  if (status === 'passed') return '通过';
  if (status === 'partial') return '部分通过';
  if (status === 'failed') return '失败';
  return '未验证';
}

export function outboxStatusLabel(status: string): string {
  if (status === 'scheduled') return '定时发送';
  if (status === 'queued') return '排队中';
  if (status === 'retry') return '等待重试';
  if (status === 'failed') return '需要处理';
  if (status === 'sent_remote_pending') return '已发送 · 留档待重试';
  if (status === 'sent') return '已发送';
  if (status === 'sent_dry_run') return '演练完成';
  if (status === 'cancelled') return '已撤回';
  return status;
}

export function outboxTimingLabel(item: OutboxItem): string {
  if (item.status === 'scheduled' && item.next_attempt_at) return `定时发送 ${formatDate(item.next_attempt_at)}`;
  if (item.status === 'retry' && item.next_attempt_at) return `下次重试 ${formatDate(item.next_attempt_at)}`;
  if (item.status === 'failed') return '已暂停自动发送';
  if (item.status === 'sent_remote_pending' && item.next_attempt_at) {
    return `远端留档重试 ${formatDate(item.next_attempt_at)}`;
  }
  if (item.queued_at) return `入队 ${formatDate(item.queued_at)}`;
  return '';
}

export function canCancelOutboxItem(status: string): boolean {
  return ['queued', 'scheduled', 'retry', 'failed'].includes(status);
}

export function isCustomFolder(folder: Folder): boolean {
  return folder.role.startsWith('custom:');
}

export function folderPreferenceKey(folder: Folder): string {
  return `${folder.account_id ?? 'virtual'}:${folder.role}`;
}

export function isMovableMessageFolder(folder: Folder): boolean {
  return !folder.is_virtual && folder.role !== 'snoozed';
}

export function movableFoldersForMessage(folders: Folder[], message?: MessageSummary | null): Folder[] {
  return folders.filter((folder) => {
    if (!isMovableMessageFolder(folder)) return false;
    if (message && folder.account_id !== message.account_id) return false;
    return true;
  });
}

export function movableFoldersForBulk(folders: Folder[], selectedMessages: MessageSummary[]): Folder[] {
  if (selectedMessages.length === 0) return [];
  const accountIds = new Set(selectedMessages.map((message) => message.account_id));
  if (accountIds.size !== 1) return [];
  return folders.filter((folder) => {
    if (!isMovableMessageFolder(folder)) return false;
    return folder.account_id === selectedMessages[0].account_id;
  });
}

export const sampleRawMessage = `Subject: 安全预览样例
From: sender@example.com
To: demo@better-email.local

<img src="http://tracking.example.com/open.png">
<script>alert('xss')</script>
这是一封用于验证 MIME/HTML 安全预览的原始邮件。`;

export const folderIcon: Record<SystemFolderRole, React.ReactNode> = {
  inbox: <Inbox size={17} />,
  sent: <Send size={17} />,
  drafts: <Edit3 size={17} />,
  outbox: <Send size={17} />,
  archive: <Archive size={17} />,
  trash: <Trash2 size={17} />,
  spam: <Mail size={17} />,
  snoozed: <Clock size={17} />,
  custom: <Mail size={17} />,
};

export function folderIconForRole(role: FolderRole): React.ReactNode {
  return folderIcon[role as SystemFolderRole] ?? folderIcon.custom;
}

export const primaryFolderRoles = new Set<FolderRole>(['inbox', 'sent', 'drafts', 'archive']);

export const shortcutGroups = [
  {
    title: '导航',
    items: [
      { keys: ['⌘/Ctrl', 'K'], label: '聚焦搜索' },
      { keys: ['/'], label: '快速搜索' },
      { keys: ['⌘/Ctrl', 'A'], label: '选择当前列表全部邮件' },
      { keys: ['J', '↓'], label: '下一封' },
      { keys: ['K', '↑'], label: '上一封' },
      { keys: ['Esc'], label: '关闭弹窗 / 取消选择' },
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
      { keys: ['⌘/Ctrl', 'Z'], label: '撤销上一步邮件操作' },
      { keys: ['S'], label: '星标' },
      { keys: ['M'], label: '已读/未读' },
      { keys: ['E'], label: '归档' },
      { keys: ['Delete'], label: '移到废纸篓' },
    ],
  },
];

export const filters: { id: FilterMode; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'unread', label: '未读' },
  { id: 'starred', label: '星标' },
  { id: 'attachments', label: '附件' },
];

export const messagePageSize = 40;

export const searchShortcuts = [
  { label: '未读', query: 'is:unread' },
  { label: '附件名', query: 'filename:' },
  { label: '发件人', query: 'from:' },
  { label: '邮箱', query: 'account:' },
];

export const searchScopeOptions: { id: SearchScope; label: string; shortLabel: string }[] = [
  { id: 'folder', label: '当前文件夹', shortLabel: '文件夹' },
  { id: 'account', label: '当前账号', shortLabel: '账号' },
  { id: 'all', label: '全部账号', shortLabel: '全部' },
];

export const emptyAccountCreateForm: AccountCreateInput = {
  email: '',
  display_name: '',
  provider: 'Custom',
  imap_host: '',
  smtp_host: '',
  incoming_protocol: 'imap',
  auth_type: 'password',
  sync_mode: '5min',
  remote_images_allowed: false,
  signature: '',
};
