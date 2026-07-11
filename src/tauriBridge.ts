import { convertFileSrc } from '@tauri-apps/api/core';
import type { ListSort, Message } from './app/types';

type InvokeArgs = Record<string, unknown> | undefined;
type MockMessage = Omit<Message, 'folder_role'> & { folder_role: string };
type TauriCore = typeof import('@tauri-apps/api/core');
type TauriWindow = typeof import('@tauri-apps/api/window');
type TauriNotification = typeof import('@tauri-apps/plugin-notification');

const hasTauriRuntime = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const mockMode =
  import.meta.env.VITE_BETTER_EMAIL_UI_MOCK === '1'
  || import.meta.env.VITE_SWIFTMAIL_UI_MOCK === '1'
  || !hasTauriRuntime;
const now = new Date('2026-07-09T10:00:00+08:00').toISOString();
let coreModule: Promise<TauriCore> | null = null;
let windowModule: Promise<TauriWindow> | null = null;
let notificationModule: Promise<TauriNotification> | null = null;

function loadCore() {
  coreModule ??= import('@tauri-apps/api/core');
  return coreModule;
}

function loadWindow() {
  windowModule ??= import('@tauri-apps/api/window');
  return windowModule;
}

function loadNotification() {
  notificationModule ??= import('@tauri-apps/plugin-notification');
  return notificationModule;
}

let account = {
  id: 1,
  email: 'demo@better-email.local',
  display_name: 'Demo User',
  provider: 'gmail',
  imap_host: 'imap.gmail.com:993',
  smtp_host: 'smtp.gmail.com:587',
  auth_type: 'oauth2',
  sync_mode: 'manual',
  remote_images_allowed: false,
  signature: 'Sent from Better Email',
  is_default: true,
};

let mockAccounts = [
  account,
  {
    ...account,
    id: 2,
    email: 'design@better-email.local',
    display_name: 'Design Studio',
    provider: 'icloud',
    imap_host: 'imap.mail.me.com:993',
    smtp_host: 'smtp.mail.me.com:587',
    auth_type: 'password',
    sync_mode: '15min',
    signature: 'Sent from Better Email Studio',
    is_default: false,
  },
  {
    ...account,
    id: 3,
    email: 'archive@better-email.local',
    display_name: 'Archive Desk',
    provider: 'outlook',
    imap_host: 'outlook.office365.com:993',
    smtp_host: 'smtp.office365.com:587',
    auth_type: 'oauth2',
    sync_mode: 'manual',
    signature: 'Sent from Better Email Archive',
    is_default: false,
  },
];

function mockSyncSchedulePlan(accountId: unknown) {
  const numericAccountId = Number(accountId ?? 0);
  const scoped = numericAccountId > 0
    ? mockAccounts.filter((item) => item.id === numericAccountId)
    : mockAccounts;
  return {
    max_accounts_per_batch: 2,
    total_accounts: scoped.length,
    batch_accounts: scoped.slice(0, numericAccountId > 0 ? 1 : 2),
    delayed_accounts: numericAccountId > 0 ? [] : scoped.slice(2),
    strategy: numericAccountId > 0
      ? '单账号同步不分批。'
      : '统一邮箱按待同步优先级串行限流；每轮最多同步 2 个账号，其余账号留到下一轮。',
  };
}

type MockIdentity = {
  id: number;
  account_id: number;
  name: string;
  email: string;
  reply_to: string;
  signature: string;
  is_default: boolean;
};

let identities: MockIdentity[] = [
  {
    id: 1,
    account_id: 1,
    name: 'Demo User',
    email: 'demo@better-email.local',
    reply_to: '',
    signature: 'Sent from Better Email',
    is_default: true,
  },
  {
    id: 2,
    account_id: 1,
    name: 'Demo Support',
    email: 'support@better-email.local',
    reply_to: 'demo@better-email.local',
    signature: 'Better Email Support',
    is_default: false,
  },
];

type MockFolder = {
  id: number;
  account_id: number | null;
  name: string;
  role: string;
  unread_count: number;
  is_virtual: boolean;
};

const mockSystemFolders = [
  { name: '收件箱', role: 'inbox' },
  { name: '已发送', role: 'sent' },
  { name: '草稿箱', role: 'drafts' },
  { name: '归档', role: 'archive' },
  { name: '废纸篓', role: 'trash' },
  { name: '垃圾邮件', role: 'spam' },
  { name: '稍后处理', role: 'snoozed' },
] as const;

let folders: MockFolder[] = [
  { id: -1, account_id: null, name: '收件箱', role: 'inbox', unread_count: 1, is_virtual: true },
  { id: -2, account_id: null, name: '已发送', role: 'sent', unread_count: 0, is_virtual: true },
  { id: -3, account_id: null, name: '草稿箱', role: 'drafts', unread_count: 0, is_virtual: true },
  { id: -4, account_id: null, name: '归档', role: 'archive', unread_count: 0, is_virtual: true },
  { id: -5, account_id: null, name: '废纸篓', role: 'trash', unread_count: 0, is_virtual: true },
  { id: -6, account_id: null, name: '垃圾邮件', role: 'spam', unread_count: 0, is_virtual: true },
  { id: -9, account_id: null, name: '稍后处理', role: 'snoozed', unread_count: 0, is_virtual: true },
  ...mockAccounts.flatMap((mockAccount, accountIndex) =>
    mockSystemFolders.map((folder, folderIndex) => ({
      id: (accountIndex + 1) * 100 + folderIndex + 1,
      account_id: mockAccount.id,
      name: folder.name,
      role: folder.role,
      unread_count: folder.role === 'inbox' && mockAccount.id === account.id ? 1 : 0,
      is_virtual: false,
    })),
  ),
];

function discoveredImapMailboxesForAccount(accountId: number, accountEmail: string) {
  const baseId = accountId * 1000;
  return [
    { id: baseId + 1, remote_name: 'INBOX', local_role: 'inbox', attributes: 'Inbox' },
    { id: baseId + 2, remote_name: 'Sent', local_role: 'sent', attributes: 'Sent' },
    { id: baseId + 3, remote_name: 'Archive', local_role: 'archive', attributes: 'Archive' },
    { id: baseId + 4, remote_name: 'Projects/Alpha', local_role: 'custom', attributes: '' },
  ].map((mailbox) => ({
    ...mailbox,
    account_id: accountId,
    account_email: accountEmail,
    delimiter: '/',
    local_folder_id: null as number | null,
    local_folder_name: '',
    uid_validity: '',
    highest_uid: 0,
    lowest_uid: 0,
    history_complete: false,
    history_last_sync_at: '',
    last_seen_at: now,
    last_sync_at: '',
  }));
}

let mockImapMailboxes = mockAccounts.flatMap((mockAccount) =>
  discoveredImapMailboxesForAccount(mockAccount.id, mockAccount.email));
mockImapMailboxes.push({
  id: 1005,
  account_id: 1,
  account_email: account.email,
  remote_name: 'Trash',
  delimiter: '/',
  attributes: 'Trash',
  local_role: 'trash',
  local_folder_id: null,
  local_folder_name: '',
  uid_validity: '',
  highest_uid: 0,
  lowest_uid: 0,
  history_complete: false,
  history_last_sync_at: '',
  last_seen_at: now,
  last_sync_at: '',
});

let messages: MockMessage[] = [
  {
    id: 1,
    account_id: 1,
    account_email: account.email,
    folder_id: 101,
    folder_role: 'inbox',
    sender_name: 'Security Team',
    sender_email: 'security@example.com',
    recipients: account.email,
    cc: '',
    bcc: '',
    subject: '安全检查清单',
    snippet: 'Better Email 的 HTML 安全预览、附件和规则都可以验证。',
    body: '<p>Better Email 的 HTML 安全预览已就绪。</p><img src="cid:better-email-logo@example.com"><img src="https://cdn.example.com/open.png">',
    sanitized_html: '<p>Better Email 的 HTML 安全预览已就绪。</p><img src="cid:better-email-logo@example.com" alt="Better Email">',
    security_warnings: ['检测到远程图片，默认已阻止自动加载。'],
    received_at: now,
    is_read: false,
    is_starred: true,
    has_attachments: true,
    snoozed_until: '',
    labels: ['重要'],
    attachment_count: 2,
    remote_mailbox: 'INBOX',
    remote_uid: 42,
    message_id_header: '<mock-1-1@better-email.local>',
    in_reply_to_header: '',
    references_header: '',
  },
  {
    id: 2,
    account_id: 1,
    account_email: account.email,
    folder_id: 101,
    folder_role: 'inbox',
    sender_name: 'Ada',
    sender_email: 'ada@example.com',
    recipients: account.email,
    cc: '',
    bcc: '',
    subject: 'Quarterly update',
    snippet: '跨平台低内存客户端的下一步计划。',
    body: '跨平台低内存客户端的下一步计划。',
    sanitized_html: '',
    security_warnings: [],
    received_at: '2026-07-08T12:00:00+08:00',
    is_read: true,
    is_starred: false,
    has_attachments: false,
    snoozed_until: '',
    labels: [],
    attachment_count: 0,
    remote_mailbox: 'INBOX',
    remote_uid: 43,
  },
  {
    id: 51,
    account_id: 1,
    account_email: account.email,
    folder_id: 105,
    folder_role: 'trash',
    sender_name: 'Remote Trash',
    sender_email: 'trash@example.com',
    recipients: account.email,
    cc: '',
    bcc: '',
    subject: 'Remote trash cleanup sample',
    snippet: '用于验证清空废纸篓的远端批量删除。',
    body: '用于验证清空废纸篓的远端批量删除。',
    sanitized_html: '',
    security_warnings: [],
    received_at: '2026-07-07T11:00:00+08:00',
    is_read: true,
    is_starred: false,
    has_attachments: false,
    snoozed_until: '',
    labels: [],
    attachment_count: 0,
    remote_mailbox: 'Trash',
    remote_uid: 5001,
  },
  {
    id: 52,
    account_id: 2,
    account_email: mockAccounts[1].email,
    folder_id: folderIdForRole('sent', 2),
    folder_role: 'sent',
    sender_name: 'Second Account',
    sender_email: mockAccounts[1].email,
    recipients: 'external@example.com',
    cc: '',
    bcc: '',
    subject: 'Global account search sample',
    snippet: '用于验证全部账号跨文件夹搜索范围。',
    body: '这封邮件只存在于第二账号的已发送目录。',
    sanitized_html: '',
    security_warnings: [],
    received_at: '2026-07-06T10:30:00+08:00',
    is_read: true,
    is_starred: false,
    has_attachments: false,
    snoozed_until: '',
    labels: [],
    attachment_count: 0,
    remote_mailbox: 'Sent',
    remote_uid: 6001,
    message_id_header: '<mock-global-search@better-email.local>',
    in_reply_to_header: '',
    references_header: '',
  },
  {
    id: 53,
    account_id: 1,
    account_email: account.email,
    folder_id: folderIdForRole('archive', 1),
    folder_role: 'archive',
    sender_name: 'Archive Search',
    sender_email: 'archive@example.com',
    recipients: account.email,
    cc: '',
    bcc: '',
    subject: 'Current account archive search sample',
    snippet: '用于验证当前账号跨文件夹搜索范围。',
    body: '这封邮件只存在于当前账号的归档目录，不受废纸篓清理流程影响。',
    sanitized_html: '',
    security_warnings: [],
    received_at: '2026-07-05T09:30:00+08:00',
    is_read: true,
    is_starred: false,
    has_attachments: false,
    snoozed_until: '',
    labels: [],
    attachment_count: 0,
    remote_mailbox: 'Archive',
    remote_uid: 5002,
    message_id_header: '<mock-account-search@better-email.local>',
    in_reply_to_header: '',
    references_header: '',
  },
];

messages = [
  ...messages,
  ...Array.from({ length: 48 }, (_, index) => {
    const id = index + 3;
    return {
      id,
      account_id: 1,
      account_email: account.email,
      folder_id: 101,
      folder_role: 'inbox',
      sender_name: `Digest ${index + 1}`,
      sender_email: `digest-${index + 1}@example.com`,
      recipients: account.email,
      cc: '',
      bcc: '',
      subject: `Low memory digest ${String(index + 1).padStart(2, '0')}`,
      snippet: '用于验证邮件列表首屏分页和加载更多，不一次性渲染全部邮件。',
      body: '分页加载样本，用于验证低内存邮件列表。',
      sanitized_html: '',
      security_warnings: [],
      received_at: `2026-07-${String(7 - Math.floor(index / 12)).padStart(2, '0')}T${String(18 - (index % 12)).padStart(2, '0')}:00:00+08:00`,
      is_read: true,
      is_starred: false,
      has_attachments: false,
      snoozed_until: '',
      labels: [],
      attachment_count: 0,
      remote_mailbox: 'INBOX',
      remote_uid: 100 + id,
    };
  }),
];

type MockDraftInput = {
  draft_id?: number;
  account_id?: number;
  identity_id?: number;
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  body?: string;
  html_body?: string;
  send_at?: string;
  attachments?: MockOutboundAttachmentInput[];
};

type MockThreadingInput = {
  in_reply_to?: string;
  references?: string;
};

const mutedThreadScopes = new Set<string>();

function mutedThreadScopeKey(accountId: number, threadKey: string) {
  return `${accountId}:${threadKey}`;
}

type MockOutboundAttachmentInput = {
  filename?: string;
  mime_type?: string;
  size_bytes?: number;
  local_path?: string;
};

let nextMessageId = Math.max(...messages.map((message) => message.id)) + 1;
let nextAttachmentId = 3;
let nextOutboxId = 1;
let nextRuleId = 4;
let nextIdentityId = 3;
let nextContactId = 4;
let nextAccountId = Math.max(...mockAccounts.map((item) => item.id)) + 1;

let labels = [
  { id: 1, name: '重要', color: '#c2410c', message_count: 1 },
  { id: 2, name: '工作', color: '#2563eb', message_count: 0 },
  { id: 3, name: '重要客户', color: '#16a34a', message_count: 0 },
];

type MockContact = {
  id: number;
  name: string;
  email: string;
  aliases: string[];
  vip: boolean;
  message_count: number;
  last_seen_at: string;
};

type MockContactMergeSuggestion = {
  target: MockContact;
  source: MockContact;
  reason: string;
  shared_keys: string[];
};

let contacts: MockContact[] = [
  { id: 1, name: 'Ada', email: 'ada@example.com', aliases: ['ada@personal.example.com'], vip: false, message_count: 7, last_seen_at: now },
  {
    id: 2,
    name: 'Security Team',
    email: 'security@example.com',
    aliases: [],
    vip: false,
    message_count: 4,
    last_seen_at: '2026-07-09T07:34:00+08:00',
  },
  {
    id: 3,
    name: 'Product Robot',
    email: 'updates@example.com',
    aliases: [],
    vip: false,
    message_count: 2,
    last_seen_at: '2026-07-09T07:34:00+08:00',
  },
];

function contactIdentityKeys(contact: MockContact) {
  const keys = [contact.email, ...contact.aliases].map((value) => value.trim().toLowerCase()).filter(Boolean);
  const domain = contact.email.split('@')[1] ?? '';
  const name = contact.name.trim().toLowerCase();
  if (domain && name && name !== contact.email.toLowerCase()) keys.push(`${name}@${domain}`);
  contact.name
    .split(/[^a-zA-Z0-9]+/)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length >= 4)
    .forEach((part) => keys.push(part));
  return [...new Set(keys)];
}

function contactMergeSuggestions(): MockContactMergeSuggestion[] {
  const sorted = [...contacts].sort((left, right) =>
    right.message_count - left.message_count ||
    right.last_seen_at.localeCompare(left.last_seen_at) ||
    left.name.localeCompare(right.name),
  );
  const suggestions: MockContactMergeSuggestion[] = [];
  for (let leftIndex = 0; leftIndex < sorted.length; leftIndex += 1) {
    const target = sorted[leftIndex];
    const leftKeys = contactIdentityKeys(target);
    for (const source of sorted.slice(leftIndex + 1)) {
      const rightKeys = contactIdentityKeys(source);
      const shared_keys = leftKeys.filter((key) => rightKeys.includes(key)).slice(0, 4);
      if (shared_keys.length === 0) continue;
      suggestions.push({
        target,
        source,
        reason: shared_keys.some((key) => key.includes('@')) ? '邮箱或别名重叠' : '名称相近，建议检查是否同一联系人',
        shared_keys,
      });
      if (suggestions.length >= 8) return suggestions;
    }
  }
  return suggestions;
}

let attachments = [
  {
    id: 1,
    message_id: 1,
    filename: 'security-checklist.pdf',
    mime_type: 'application/pdf',
    size_bytes: 184320,
    is_downloaded: false,
    local_path: '',
    content_id: '',
    is_inline: false,
  },
  {
    id: 2,
    message_id: 1,
    filename: 'better-email-inline-logo.svg',
    mime_type: 'image/svg+xml',
    size_bytes: 892,
    is_downloaded: true,
    local_path: '/tmp/better-email/better-email-inline-logo.svg',
    content_id: 'better-email-logo@example.com',
    is_inline: true,
  },
];
const attachmentDownloadAttempts = new Map<number, number>();
let mockReclaimableCacheBytes = 5_308_416;
let mockReclaimableFileCount = 4;
let mockCachedAttachmentCount = 2;
let mockPartialDownloadBytes = 65_536;
let mockPartialDownloadCount = 1;

function mockStorageUsage() {
  const databaseBytes = 2_654_208;
  const localAttachmentBytes = 24;
  return {
    database_bytes: databaseBytes,
    reclaimable_cache_bytes: mockReclaimableCacheBytes,
    reclaimable_file_count: mockReclaimableFileCount,
    cached_attachment_count: mockCachedAttachmentCount,
    local_attachment_bytes: localAttachmentBytes,
    local_attachment_file_count: 1,
    partial_download_bytes: mockPartialDownloadBytes,
    partial_download_count: mockPartialDownloadCount,
    total_managed_bytes: databaseBytes + mockReclaimableCacheBytes + localAttachmentBytes,
  };
}

let rules = [
  { id: 1, name: '客户邮件标记', condition: 'from contains customer', action: 'apply label 重要客户', enabled: true },
  { id: 2, name: '安全邮件标记', condition: 'subject contains 安全', action: 'apply label 重要', enabled: true },
  { id: 3, name: '工作邮件标记', condition: 'from contains ada', action: 'apply label 工作', enabled: false },
];

let outbox: Array<{
  id: number;
  message_id: number;
  recipients: string;
  subject: string;
  status: string;
  attempts: number;
  last_error: string;
  queued_at: string;
  next_attempt_at: string;
}> = [];

let remoteImageTrusts: Array<{
  id: number;
  account_id: number;
  account_email: string;
  scope: 'sender' | 'domain';
  value: string;
  created_at: string;
}> = [];

type MockBackgroundTask = {
  id: number;
  kind: string;
  title: string;
  source: string;
  status: string;
  message: string;
  created_at: string;
  started_at: string;
  finished_at: string;
};

type MockSyncRun = {
  id: number;
  started_at: string;
  finished_at: string;
  status: string;
  scanned_folders: number;
  imported_messages: number;
  message: string;
};

type MockOAuthSession = {
  id: number;
  account_id: number;
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

let backgroundTasks: MockBackgroundTask[] = [];
let syncRuns: MockSyncRun[] = [];
let oauthSessions: MockOAuthSession[] = [];
let nextFolderId = 1001;
let nextSyncRunId = 1;
let nextOAuthSessionId = 1;

function folderIdForRole(role: string, accountId: number = account.id) {
  return (
    folders.find((folder) => !folder.is_virtual && folder.account_id === accountId && folder.role === role)?.id ??
    folders.find((folder) => folder.is_virtual && folder.role === role)?.id ??
    101
  );
}

function normalizeCustomFolderName(name: unknown, currentFolderId?: number) {
  const normalized = String(name ?? '').trim();
  if (!normalized) throw new Error('请输入自定义文件夹名称。');
  if (normalized.length > 48) throw new Error('文件夹名称不能超过 48 个字符。');
  if (
    folders.some(
      (folder) =>
        folder.id !== currentFolderId &&
        folder.account_id === account.id &&
        folder.name.toLowerCase() === normalized.toLowerCase(),
    )
  ) {
    throw new Error('同名文件夹已存在。');
  }
  return normalized;
}

function accountMessageFromDraft(
  input: MockDraftInput,
  role: string,
  messageId?: number,
  threading?: MockThreadingInput,
): MockMessage {
  const id = messageId ?? nextMessageId++;
  const subject = input.subject?.trim() || '(无主题)';
  const body = input.body?.trim() || '';
  const htmlBody = input.html_body?.trim() || '';
  const draftAttachments = (input.attachments ?? []).filter((attachment) => attachment.filename?.trim());
  const senderAccount = mockAccounts.find((item) => item.id === Number(input.account_id)) ?? account;
  const identity =
    identities.find((item) => item.id === input.identity_id && item.account_id === senderAccount.id) ??
    identities.find((item) => item.account_id === senderAccount.id && item.is_default) ??
    identities[0];
  const message = {
    id,
    account_id: senderAccount.id,
    account_email: senderAccount.email,
    folder_id: folderIdForRole(role, senderAccount.id),
    folder_role: role,
    sender_name: identity?.name ?? senderAccount.display_name,
    sender_email: identity?.email ?? senderAccount.email,
    recipients: input.to?.trim() || '',
    cc: input.cc?.trim() || '',
    bcc: input.bcc?.trim() || '',
    subject,
    snippet: body.slice(0, 96),
    body,
    sanitized_html: htmlBody,
    security_warnings: [],
    received_at: now,
    is_read: true,
    is_starred: false,
    has_attachments: draftAttachments.length > 0,
    snoozed_until: '',
    labels: [],
    attachment_count: draftAttachments.length,
    remote_mailbox: role.toUpperCase(),
    remote_uid: 0,
    message_id_header: `<mock-${senderAccount.id}-${id}@better-email.local>`,
    in_reply_to_header: threading?.in_reply_to?.trim() || '',
    references_header: threading?.references?.trim() || '',
  };
  attachments = [
    ...draftAttachments.map((attachment) => ({
      id: nextAttachmentId++,
      message_id: id,
      filename: attachment.filename?.trim() || 'attachment',
      mime_type: attachment.mime_type?.trim() || 'application/octet-stream',
      size_bytes: Number(attachment.size_bytes ?? 0),
      is_downloaded: Boolean(attachment.local_path?.trim()),
      local_path: attachment.local_path?.trim() || '',
      content_id: '',
      is_inline: false,
    })),
    ...attachments,
  ];
  return message;
}

function refreshLabelCounts() {
  labels = labels.map((label) => ({
    ...label,
    message_count: messages.filter((message) => message.labels.includes(label.name)).length,
  }));
}

function normalizeListSort(value: unknown): ListSort {
  return value === 'oldest' || value === 'sender' || value === 'subject'
    ? value
    : 'newest';
}

function compareMessagesBySort(left: MockMessage, right: MockMessage, sort: ListSort) {
  if (sort === 'oldest') {
    return left.received_at.localeCompare(right.received_at) || left.id - right.id;
  }
  if (sort === 'sender') {
    return left.sender_name.localeCompare(right.sender_name)
      || left.sender_email.localeCompare(right.sender_email)
      || right.received_at.localeCompare(left.received_at)
      || right.id - left.id;
  }
  if (sort === 'subject') {
    return left.subject.localeCompare(right.subject)
      || right.received_at.localeCompare(left.received_at)
      || right.id - left.id;
  }
  return right.received_at.localeCompare(left.received_at) || right.id - left.id;
}

function listMessages(args: InvokeArgs) {
  const query = String(args?.query ?? '').trim().toLowerCase();
  const filter = String(args?.filter ?? 'all');
  const sort = normalizeListSort(args?.sort);
  const limit = Math.max(1, Number(args?.limit ?? 80));
  const accountId = Number(args?.accountId ?? 0);
  const folderId = Number(args?.folderId ?? 0);
  const folder = folders.find((entry) => entry.id === folderId);
  return messages.filter((message) => {
    if (accountId > 0 && message.account_id !== accountId) return false;
    if (folder) {
      if (folder.is_virtual) {
        if (message.folder_role !== folder.role) return false;
      } else if (message.folder_id !== folder.id) {
        return false;
      }
    }
    if (filter === 'unread' && message.is_read) return false;
    if (filter === 'starred' && !message.is_starred) return false;
    if (filter === 'attachments' && !message.has_attachments) return false;
    if (!query) return true;
    const terms = query.split(/\s+/).filter(Boolean);
    for (const term of terms) {
      if (term.startsWith('from:')) {
        const value = term.replace(/^from:/, '');
        if (!message.sender_name.toLowerCase().includes(value) && !message.sender_email.toLowerCase().includes(value)) return false;
      } else if (term.startsWith('to:')) {
        if (!message.recipients.toLowerCase().includes(term.replace(/^to:/, ''))) return false;
      } else if (term.startsWith('cc:')) {
        if (!message.cc.toLowerCase().includes(term.replace(/^cc:/, ''))) return false;
      } else if (term.startsWith('bcc:')) {
        if (!message.bcc.toLowerCase().includes(term.replace(/^bcc:/, ''))) return false;
      } else if (term.startsWith('subject:')) {
        if (!message.subject.toLowerCase().includes(term.replace(/^subject:/, ''))) return false;
      } else if (term.startsWith('body:') || term.startsWith('content:')) {
        const value = term.replace(/^(body|content):/, '');
        if (!message.body.toLowerCase().includes(value) && !message.snippet.toLowerCase().includes(value)) return false;
      } else if (term.startsWith('label:')) {
        const value = term.replace(/^label:/, '');
        if (!message.labels.some((label) => label.toLowerCase().includes(value))) return false;
      } else if (term.startsWith('account:')) {
        const value = term.replace(/^account:/, '');
        if (!message.account_email.toLowerCase().includes(value)) return false;
      } else if (term.startsWith('mailbox:') || term.startsWith('folder:')) {
        const value = term.replace(/^(mailbox|folder):/, '');
        if (!message.remote_mailbox.toLowerCase().includes(value) && !message.folder_role.toLowerCase().includes(value)) return false;
      } else if (term.startsWith('filename:') || term.startsWith('attachment:')) {
        const value = term.replace(/^(filename|attachment):/, '');
        const matched = attachments.some(
          (attachment) =>
            attachment.message_id === message.id &&
            attachment.filename.toLowerCase().includes(value),
        );
        if (!matched) return false;
      } else if (term.startsWith('after:')) {
        if (message.received_at < `${term.replace(/^after:/, '')}T00:00:00`) return false;
      } else if (term.startsWith('before:')) {
        if (message.received_at > `${term.replace(/^before:/, '')}T23:59:59`) return false;
      } else if (term === 'has:attachment' || term === 'has:attachments') {
        if (!message.has_attachments) return false;
      } else if (term === 'is:unread') {
        if (message.is_read) return false;
      } else if (term === 'is:read') {
        if (!message.is_read) return false;
      } else if (term === 'is:starred') {
        if (!message.is_starred) return false;
      } else if (
        ![message.subject, message.sender_name, message.sender_email, message.recipients, message.snippet, message.body]
          .join(' ')
          .toLowerCase()
          .includes(term)
      ) {
        return false;
      }
    }
    return true;
  }).sort((left, right) => compareMessagesBySort(left, right, sort)).slice(0, limit);
}

function normalizedThreadSubject(subject: string) {
  let normalized = subject.trim() || '(无主题)';
  while (/^(re|fwd|fw|回复|转发)\s*[:：]\s*/i.test(normalized)) {
    normalized = normalized.replace(/^(re|fwd|fw|回复|转发)\s*[:：]\s*/i, '').trim() || '(无主题)';
  }
  return normalized;
}

function firstMessageId(value: string | undefined) {
  return (value ?? '')
    .split(/\s+/)
    .map((token) => token.replace(/^[,;]+|[,;]+$/g, ''))
    .find((token) => /^<[^<>\s]+>$/.test(token))
    ?.toLowerCase();
}

function messageThreadKey(message: MockMessage) {
  const messageId =
    firstMessageId(message.references_header)
    ?? firstMessageId(message.in_reply_to_header)
    ?? firstMessageId(message.message_id_header);
  return messageId
    ? `msgid:${messageId}`
    : `subject:${normalizedThreadSubject(message.subject).toLowerCase()}`;
}

function listThreadMessages(args: InvokeArgs) {
  const threadKey = String(args?.threadKey ?? args?.thread_key ?? '').trim();
  const accountId = Number(args?.accountId ?? 0);
  return messages
    .filter((message) => messageThreadKey(message) === threadKey)
    .filter((message) => accountId <= 0 || message.account_id === accountId)
    .sort((left, right) => left.received_at.localeCompare(right.received_at));
}

function listThreads(args?: InvokeArgs) {
  const sort = normalizeListSort(args?.sort);
  const scopedMessages = listMessages({
    ...(args ?? {}),
    limit: Math.max(messages.length, 1),
  });
  const grouped = new Map<string, typeof messages>();
  for (const message of scopedMessages) {
    const key = messageThreadKey(message);
    grouped.set(key, [...(grouped.get(key) ?? []), message]);
  }
  return [...grouped.entries()]
    .map(([thread_key, items]) => {
      const orderedItems = [...items].sort((left, right) => left.received_at.localeCompare(right.received_at));
      const latestMessage = orderedItems[orderedItems.length - 1];
      return {
        thread_key,
        subject: latestMessage?.subject ?? '(无主题)',
        message_count: items.length,
        unread_count: items.filter((message) => !message.is_read).length,
        latest_at: latestMessage?.received_at ?? now,
        participants: [...new Set(items.map((message) => message.sender_name))].join(', '),
        is_muted: items.some((message) => (
          mutedThreadScopes.has(mutedThreadScopeKey(message.account_id, thread_key))
        )),
      };
    })
    .sort((left, right) => {
      if (sort === 'oldest') {
        return left.latest_at.localeCompare(right.latest_at) || left.thread_key.localeCompare(right.thread_key);
      }
      if (sort === 'sender') {
        return left.participants.localeCompare(right.participants)
          || right.latest_at.localeCompare(left.latest_at)
          || left.thread_key.localeCompare(right.thread_key);
      }
      if (sort === 'subject') {
        return left.subject.localeCompare(right.subject)
          || right.latest_at.localeCompare(left.latest_at)
          || left.thread_key.localeCompare(right.thread_key);
      }
      return right.latest_at.localeCompare(left.latest_at) || left.thread_key.localeCompare(right.thread_key);
    });
}

function stats(args?: InvokeArgs) {
  const accountId = Number(args?.accountId ?? 0);
  const scopedMessages = accountId > 0
    ? messages.filter((message) => message.account_id === accountId)
    : messages;
  return {
    total_messages: scopedMessages.length,
    unread_messages: scopedMessages.filter((message) => !message.is_read).length,
    starred_messages: scopedMessages.filter((message) => message.is_starred).length,
    draft_messages: scopedMessages.filter((message) => message.folder_role === 'drafts').length,
    attachment_messages: scopedMessages.filter((message) => message.has_attachments).length,
  };
}

function renderMessageWithPolicy(messageId: number) {
  const message = messages.find((item) => item.id === messageId);
  if (!message) throw new Error('message not found');
  const sender = message.sender_email.toLowerCase();
  const domain = sender.split('@')[1] ?? '';
  const trusted = remoteImageTrusts.some(
    (trust) =>
      trust.account_id === message.account_id &&
      ((trust.scope === 'sender' && trust.value === sender) || (trust.scope === 'domain' && trust.value === domain)),
  );
  if (!trusted) return message;
  const updated = {
    ...message,
    sanitized_html: '<p>Better Email 的 HTML 安全预览已就绪。</p><img src="https://cdn.example.com/open.png">',
    security_warnings: message.security_warnings.filter((warning) => !warning.includes('远程图片')),
  };
  messages = messages.map((item) => (item.id === messageId ? updated : item));
  return updated;
}

function releaseDueSnoozedMessages(nowInput: string) {
  const nowMs = Date.parse(nowInput);
  if (Number.isNaN(nowMs)) return [];
  const released: MockMessage[] = [];
  messages = messages.map((message) => {
    if (message.folder_role !== 'snoozed' || !message.snoozed_until) return message;
    const dueMs = Date.parse(message.snoozed_until);
    if (Number.isNaN(dueMs) || dueMs > nowMs) return message;
    const updated = {
      ...message,
      folder_role: 'inbox',
      folder_id: folderIdForRole('inbox'),
      snoozed_until: '',
    };
    released.push(updated);
    return updated;
  });
  return released;
}

async function mockInvoke<T>(command: string, args?: InvokeArgs): Promise<T> {
  if (typeof window !== 'undefined') {
    const mockWindow = window as Window & {
      __betterEmailMockInvocations?: Array<{ command: string; args?: InvokeArgs }>;
    };
    mockWindow.__betterEmailMockInvocations ??= [];
    mockWindow.__betterEmailMockInvocations.push({
      command,
      args: args ? JSON.parse(JSON.stringify(args)) as InvokeArgs : undefined,
    });
  }
  switch (command) {
    case 'list_accounts':
      return mockAccounts as T;
    case 'get_account':
      return (Number(args?.accountId ?? 0) > 0
        ? mockAccounts.find((item) => item.id === Number(args?.accountId)) ?? account
        : account) as T;
    case 'create_account': {
      const input = (args?.input ?? {}) as Partial<typeof account>;
      const email = String(input.email ?? '').trim().toLowerCase();
      if (!email.includes('@')) throw new Error('请输入有效邮箱地址。');
      if (mockAccounts.some((item) => item.email.toLowerCase() === email)) {
        throw new Error('该邮箱账号已存在。');
      }
      const created = {
        id: nextAccountId++,
        email,
        display_name: String(input.display_name ?? '').trim() || email,
        provider: String(input.provider ?? '').trim() || 'Custom',
        imap_host: String(input.imap_host ?? '').trim(),
        smtp_host: String(input.smtp_host ?? '').trim(),
        auth_type: String(input.auth_type ?? '').trim() || 'password',
        sync_mode: String(input.sync_mode ?? '').trim() || 'manual',
        remote_images_allowed: Boolean(input.remote_images_allowed),
        signature: String(input.signature ?? ''),
        is_default: false,
      };
      mockAccounts = [...mockAccounts, created];
      folders = [
        ...folders,
        ...mockSystemFolders.map((folder) => ({
          id: nextFolderId++,
          account_id: created.id,
          name: folder.name,
          role: folder.role,
          unread_count: 0,
          is_virtual: false,
        })),
      ];
      identities = [
        ...identities,
        {
          id: nextIdentityId++,
          account_id: created.id,
          name: created.display_name,
          email: created.email,
          reply_to: '',
          signature: created.signature,
          is_default: true,
        },
      ];
      return created as T;
    }
    case 'set_default_account': {
      const accountId = Number(args?.accountId ?? 0);
      const existing = mockAccounts.find((item) => item.id === accountId);
      if (!existing) throw new Error('邮箱账号不存在或已被移除。');
      mockAccounts = mockAccounts
        .map((item) => ({ ...item, is_default: item.id === accountId }))
        .sort((left, right) => Number(right.is_default) - Number(left.is_default) || left.id - right.id);
      account = mockAccounts.find((item) => item.is_default) ?? mockAccounts[0];
      return account as T;
    }
    case 'delete_account': {
      const accountId = Number(args?.accountId ?? 0);
      const removedAccount = mockAccounts.find((item) => item.id === accountId);
      if (!removedAccount) throw new Error('邮箱账号不存在或已被移除。');
      if (mockAccounts.length <= 1) {
        throw new Error('至少需要保留一个邮箱账号，无法移除当前唯一账号。');
      }
      const removedMessageIds = new Set(
        messages.filter((message) => message.account_id === accountId).map((message) => message.id),
      );
      mockAccounts = mockAccounts.filter((item) => item.id !== accountId);
      folders = folders.filter((folder) => folder.account_id !== accountId);
      mockImapMailboxes = mockImapMailboxes.filter((mailbox) => mailbox.account_id !== accountId);
      messages = messages.filter((message) => message.account_id !== accountId);
      attachments = attachments.filter((attachment) => !removedMessageIds.has(attachment.message_id));
      identities = identities.filter((identity) => identity.account_id !== accountId);
      outbox = outbox.filter((item) => !removedMessageIds.has(item.message_id));
      remoteImageTrusts = remoteImageTrusts.filter((trust) => trust.account_id !== accountId);
      oauthSessions = oauthSessions.filter((session) => session.account_id !== accountId);
      if (removedAccount.is_default) {
        mockAccounts = mockAccounts.map((item, index) => ({ ...item, is_default: index === 0 }));
      }
      account = mockAccounts.find((item) => item.is_default) ?? mockAccounts[0];
      return account as T;
    }
    case 'update_account_settings': {
      const accountId = Number(args?.accountId ?? 0);
      const existing = mockAccounts.find((item) => item.id === accountId);
      if (!existing) throw new Error('account not found');
      const input = (args?.input ?? {}) as Partial<typeof account>;
      const updated = {
        ...existing,
        ...input,
        id: accountId,
      };
      mockAccounts = mockAccounts.map((item) => (item.id === accountId ? updated : item));
      if (account.id === accountId) account = updated;
      return updated as T;
    }
    case 'list_folders':
      return folders.filter((folder) => {
        const accountId = Number(args?.accountId ?? 0);
        if (accountId <= 0) return folder.is_virtual || String(folder.role).startsWith('custom:');
        return !folder.is_virtual && folder.account_id === accountId;
      }).map((folder) => ({
        ...folder,
        unread_count: messages.filter((message) => {
          if (message.is_read) return false;
          return folder.is_virtual
            ? message.folder_role === folder.role
            : message.folder_id === folder.id;
        }).length,
      })) as T;
    case 'create_custom_folder': {
      const name = normalizeCustomFolderName(args?.name);
      const folder = {
        id: nextFolderId++,
        account_id: Number(args?.accountId ?? account.id),
        name,
        role: `custom:${Date.now()}`,
        unread_count: 0,
        is_virtual: false,
      };
      folders = [...folders, folder];
      return folder as T;
    }
    case 'rename_custom_folder': {
      const folderId = Number(args?.folderId);
      const folder = folders.find((entry) => entry.id === folderId);
      if (!folder || !String(folder.role).startsWith('custom:')) throw new Error('只能重命名自定义文件夹。');
      const name = normalizeCustomFolderName(args?.name, folderId);
      const updated = { ...folder, name };
      folders = folders.map((entry) => (entry.id === folderId ? updated : entry));
      return updated as T;
    }
    case 'delete_custom_folder': {
      const folderId = Number(args?.folderId);
      const folder = folders.find((entry) => entry.id === folderId);
      if (!folder || !String(folder.role).startsWith('custom:')) throw new Error('只能删除自定义文件夹。');
      messages = messages.map((message) =>
        message.folder_id === folderId
          ? { ...message, folder_role: 'inbox', folder_id: folderIdForRole('inbox', message.account_id), snoozed_until: '' }
          : message,
      );
      folders = folders.filter((entry) => entry.id !== folderId);
      mockImapMailboxes = mockImapMailboxes.map((mailbox) =>
        mailbox.local_folder_id === folderId
          ? { ...mailbox, local_folder_id: null, local_folder_name: '' }
          : mailbox);
      return undefined as T;
    }
    case 'list_labels':
      refreshLabelCounts();
      return labels as T;
    case 'get_stats':
      return stats(args) as T;
    case 'list_sync_runs':
      return syncRuns as T;
    case 'get_sync_schedule_plan':
      return mockSyncSchedulePlan(args?.accountId) as T;
    case 'list_contacts':
      return contacts as T;
    case 'list_contact_merge_suggestions':
      return contactMergeSuggestions() as T;
    case 'create_contact': {
      const input = args?.input as { name?: string; email?: string; aliases?: string[]; vip?: boolean };
      const email = String(input.email ?? '').trim().toLowerCase();
      if (!email) throw new Error('联系人邮箱不能为空');
      if (contacts.some((contact) => contact.email.toLowerCase() === email)) {
        throw new Error('联系人邮箱已存在');
      }
      const aliases = [...new Set((input.aliases ?? [])
        .map((alias) => String(alias).trim().toLowerCase())
        .filter((alias) => alias && alias !== email))];
      const created = {
        id: nextContactId++,
        name: input.name?.trim() || email,
        email,
        aliases,
        vip: Boolean(input.vip),
        message_count: 0,
        last_seen_at: now,
      };
      contacts = [created, ...contacts];
      return created as T;
    }
    case 'update_contact': {
      const contactId = Number(args?.contactId);
      const input = args?.input as { name?: string; aliases?: string[]; vip?: boolean };
      const existing = contacts.find((contact) => contact.id === contactId);
      if (!existing) throw new Error('contact not found');
      const aliases = [...new Set((input.aliases ?? [])
        .map((alias) => String(alias).trim().toLowerCase())
        .filter((alias) => alias && alias !== existing.email.toLowerCase()))];
      const updated = {
        ...existing,
        name: input.name?.trim() || existing.name,
        aliases,
        vip: Boolean(input.vip),
      };
      contacts = contacts.map((contact) => (contact.id === contactId ? updated : contact));
      return updated as T;
    }
    case 'delete_contact': {
      const contactId = Number(args?.contactId);
      contacts = contacts.filter((contact) => contact.id !== contactId);
      return undefined as T;
    }
    case 'merge_contacts': {
      const targetContactId = Number(args?.targetContactId);
      const sourceContactId = Number(args?.sourceContactId);
      if (targetContactId === sourceContactId) throw new Error('请选择两个不同联系人进行合并');
      const target = contacts.find((contact) => contact.id === targetContactId);
      const source = contacts.find((contact) => contact.id === sourceContactId);
      if (!target || !source) throw new Error('contact not found');
      const aliases = [...new Set([...target.aliases, source.email, ...source.aliases]
        .map((alias) => alias.trim().toLowerCase())
        .filter((alias) => alias && alias !== target.email.toLowerCase()))];
      const merged = {
        ...target,
        name: target.name.trim() && target.name !== target.email ? target.name : source.name,
        aliases,
        vip: target.vip || source.vip,
        message_count: target.message_count + source.message_count,
        last_seen_at: source.last_seen_at > target.last_seen_at ? source.last_seen_at : target.last_seen_at,
      };
      contacts = [merged, ...contacts.filter((contact) => contact.id !== targetContactId && contact.id !== sourceContactId)];
      return merged as T;
    }
    case 'import_contacts_vcard': {
      const importedEmail = 'vcard.person@example.com';
      const existingImported = contacts.find((contact) => contact.email === importedEmail);
      const importedContact = existingImported ?? {
        id: nextContactId++,
        name: 'vCard Person',
        email: importedEmail,
        aliases: ['vcard.alias@example.com'],
        vip: true,
        message_count: 0,
        last_seen_at: now,
      };
      const ada = contacts.find((contact) => contact.email === 'ada@example.com');
      contacts = [
        importedContact,
        ...contacts
          .filter((contact) => contact.id !== importedContact.id)
          .map((contact) => (
            contact.id === ada?.id
              ? {
                  ...contact,
                  aliases: [...new Set([...contact.aliases, 'ada.vcard@example.com'])],
                  vip: true,
                }
              : contact
          )),
      ];
      return {
        path: '/tmp/imported-contacts.vcf',
        total_cards: 2,
        created: existingImported ? 0 : 1,
        updated: 1,
        skipped: 0,
        size_bytes: 428,
      } as T;
    }
    case 'export_contacts_vcard':
      return {
        path: '/tmp/better-email-contacts.vcf',
        contacts: contacts.length,
        size_bytes: contacts.length * 180,
      } as T;
    case 'list_rules':
      return rules as T;
    case 'list_threads':
      return listThreads(args) as T;
    case 'set_threads_muted': {
      const messageIds = Array.isArray(args?.messageIds ?? args?.message_ids)
        ? (args?.messageIds ?? args?.message_ids) as number[]
        : [];
      const muted = Boolean(args?.muted);
      const scopes = new Set(
        messages
          .filter((message) => messageIds.includes(message.id))
          .map((message) => mutedThreadScopeKey(message.account_id, messageThreadKey(message))),
      );
      for (const scope of scopes) {
        if (muted) mutedThreadScopes.add(scope);
        else mutedThreadScopes.delete(scope);
      }
      return scopes.size as T;
    }
    case 'list_muted_thread_keys': {
      const accountId = Number(args?.accountId ?? args?.account_id ?? 0);
      return [...new Set(
        messages
          .filter((message) => (
            message.account_id === accountId
            && mutedThreadScopes.has(mutedThreadScopeKey(accountId, messageThreadKey(message)))
          ))
          .map(messageThreadKey),
      )] as T;
    }
    case 'list_outbox':
      return outbox as T;
    case 'list_imap_mailboxes':
      return mockImapMailboxes as T;
    case 'map_imap_mailbox': {
      const mailboxId = Number(args?.mailboxId);
      const mailbox = mockImapMailboxes.find((item) => item.id === mailboxId);
      if (!mailbox) throw new Error('remote mailbox not found');
      if (mailbox.local_role !== 'custom') throw new Error('系统目录由服务商角色自动映射，不需要手动绑定。');
      const folderId = Number(args?.folderId ?? 0);
      const folder = folderId > 0
        ? folders.find((item) =>
          item.id === folderId
          && item.account_id === mailbox.account_id
          && String(item.role).startsWith('custom:'))
        : undefined;
      if (folderId > 0 && !folder) throw new Error('请选择同一账号的本地自定义文件夹。');
      const updated = {
        ...mailbox,
        local_folder_id: folder?.id ?? null,
        local_folder_name: folder?.name ?? '',
      };
      mockImapMailboxes = mockImapMailboxes.map((item) => (item.id === mailboxId ? updated : item));
      return updated as T;
    }
    case 'list_oauth_sessions':
      return oauthSessions as T;
    case 'start_oauth2_pkce': {
      const input = (args?.input ?? {}) as Record<string, unknown>;
      const id = nextOAuthSessionId++;
      const provider = String(input.provider ?? 'outlook');
      const redirectUri = String(input.redirect_uri ?? 'http://127.0.0.1:17645/oauth/callback');
      const state = `mock-state-${id}`;
      const scopes = provider.toLowerCase() === 'gmail'
        ? ['openid', 'email', 'https://mail.google.com/']
        : ['openid', 'offline_access', 'https://outlook.office.com/IMAP.AccessAsUser.All'];
      const authorizationUrl = `https://login.example.test/oauth2/authorize?state=${state}`;
      const message = `UI smoke mock 已启动 ${provider} OAuth2 PKCE 授权。`;
      oauthSessions = [{
        id,
        account_id: Number(input.account_id ?? account.id),
        provider,
        authorization_url: authorizationUrl,
        redirect_uri: redirectUri,
        state,
        code_challenge: `mock-challenge-${id}`,
        scopes,
        status: 'authorization_pending',
        created_at: now,
        completed_at: '',
        message,
      }, ...oauthSessions];
      return {
        session_id: id,
        provider,
        authorization_url: authorizationUrl,
        redirect_uri: redirectUri,
        state,
        code_challenge: `mock-challenge-${id}`,
        code_verifier_hint: `mock-verifier-${id}`,
        scopes,
        message,
      } as T;
    }
    case 'complete_oauth2_callback': {
      const input = (args?.input ?? {}) as Record<string, unknown>;
      const state = String(input.state ?? '');
      const session = oauthSessions.find((item) => item.state === state);
      if (!session) throw new Error('OAuth2 session not found');
      oauthSessions = oauthSessions.map((item) => item.id === session.id
        ? {
            ...item,
            status: 'code_received',
            completed_at: now,
            message: 'UI smoke mock 已记录 OAuth2 回调授权码。',
          }
        : item);
      return {
        session_id: session.id,
        provider: session.provider,
        status: 'code_received',
        message: 'UI smoke mock 已记录 OAuth2 回调授权码。',
      } as T;
    }
    case 'wait_for_oauth2_callback': {
      const session = oauthSessions[0];
      if (!session) throw new Error('OAuth2 session not found');
      oauthSessions = oauthSessions.map((item) => item.id === session.id
        ? {
            ...item,
            status: 'code_received',
            completed_at: now,
            message: 'UI smoke mock 本地回调监听完成。',
          }
        : item);
      return {
        session_id: session.id,
        provider: session.provider,
        status: 'code_received',
        message: 'UI smoke mock 本地回调监听完成。',
      } as T;
    }
    case 'exchange_oauth2_token': {
      const input = (args?.input ?? {}) as Record<string, unknown>;
      const sessionId = Number(input.session_id);
      const session = oauthSessions.find((item) => item.id === sessionId);
      if (!session) throw new Error('OAuth2 session not found');
      oauthSessions = oauthSessions.map((item) => item.id === sessionId
        ? {
            ...item,
            status: 'token_stored',
            completed_at: now,
            message: 'UI smoke mock Token 已写入安全存储。',
          }
        : item);
      return {
        session_id: session.id,
        provider: session.provider,
        status: 'token_stored',
        expires_at: new Date(Date.parse(now) + 3_600_000).toISOString(),
        message: 'UI smoke mock Token 已写入安全存储。',
      } as T;
    }
    case 'refresh_oauth2_token': {
      const provider = oauthSessions[0]?.provider ?? account.provider;
      return {
        provider,
        status: 'refreshed',
        expires_at: new Date(Date.parse(now) + 7_200_000).toISOString(),
        message: 'UI smoke mock OAuth2 Token 已刷新。',
      } as T;
    }
    case 'list_background_tasks':
      return backgroundTasks as T;
    case 'list_remote_image_trusts':
      return remoteImageTrusts as T;
    case 'list_messages':
      return listMessages(args) as T;
    case 'list_provider_write_validation_messages': {
      const accountId = Number(args?.accountId ?? 0);
      const validationId = String(args?.validationId ?? '').trim().toLowerCase();
      return messages
        .filter((message) => accountId <= 0 || message.account_id === accountId)
        .filter((message) => validationId && message.subject.toLowerCase().includes(validationId))
        .sort((left, right) =>
          right.received_at.localeCompare(left.received_at) || right.id - left.id)
        .slice(0, 20) as T;
    }
    case 'list_thread_messages':
      return listThreadMessages(args) as T;
    case 'mark_frontend_ready':
      return undefined as T;
    case 'mark_benchmark_sync_complete':
      return undefined as T;
    case 'benchmark_sync_requested':
      return false as T;
    case 'list_attachments':
      return attachments.filter((attachment) => attachment.message_id === args?.messageId) as T;
    case 'set_message_read':
      {
      const target = messages.find((message) => message.id === args?.messageId);
      messages = messages.map((message) =>
        message.id === args?.messageId ? { ...message, is_read: Boolean(args?.isRead) } : message,
      );
      const remoteApplied = Boolean(target?.remote_mailbox && target.remote_uid > 0);
      return {
        local_applied: true,
        remote_attempted: remoteApplied,
        remote_applied: remoteApplied,
        message: remoteApplied
          ? `本地已标为${args?.isRead ? '已读' : '未读'}，远端 \\Seen 状态已同步。`
          : '本地已更新；该邮件没有远端 UID，跳过远端已读回写。',
      } as T;
      }
    case 'mark_folder_read': {
      const folderId = Number(args?.folderId);
      const role = String(args?.role ?? '');
      const isVirtual = Boolean(args?.isVirtual);
      let updatedCount = 0;
      messages = messages.map((message) => {
        const matchesFolder = isVirtual
          ? message.folder_role === role
          : message.folder_id === folderId;
        if (!matchesFolder || message.is_read) return message;
        updatedCount += 1;
        return { ...message, is_read: true };
      });
      return {
        updated_count: updatedCount,
        remote_attempted_count: 0,
        remote_applied_count: 0,
        remote_skipped_count: updatedCount,
        remote_failed_count: 0,
        message: updatedCount > 0
          ? `已将 ${updatedCount} 封邮件标为已读；${updatedCount} 封没有可用远端状态，已保留本地结果。`
          : '该文件夹没有未读邮件。',
      } as T;
    }
    case 'set_message_starred': {
      const target = messages.find((message) => message.id === args?.messageId);
      const isStarred = Boolean(args?.isStarred);
      messages = messages.map((message) =>
        message.id === args?.messageId ? { ...message, is_starred: isStarred } : message,
      );
      const remoteApplied = Boolean(target?.remote_mailbox && target.remote_uid > 0);
      return {
        local_applied: true,
        remote_attempted: remoteApplied,
        remote_applied: remoteApplied,
        message: remoteApplied
          ? `本地已${isStarred ? '添加' : '取消'}星标，远端 \\Flagged 状态已同步。`
          : `本地星标已更新；该邮件没有远端 UID，跳过远端星标回写。`,
      } as T;
    }
    case 'move_message_to_role': {
      const messageId = Number(args?.messageId);
      const targetRole = String(args?.role ?? '');
      let targetRemoteMailbox = '';
      let remoteAttempted = false;
      let remoteApplied = false;
      let remoteMessage = '本地已移动；该邮件没有可用远端状态，远端移动已跳过。';
      messages = messages.map((message) => {
        if (message.id !== messageId) return message;
        const targetFolderId = folderIdForRole(targetRole || message.folder_role, message.account_id);
        targetRemoteMailbox = mockImapMailboxes.find((mailbox) =>
          mailbox.account_id === message.account_id
          && (mailbox.local_role === targetRole || mailbox.local_folder_id === targetFolderId))
          ?.remote_name ?? '';
        const hasRemoteSource = Boolean(message.remote_mailbox && message.remote_uid > 0);
        let nextRemoteMailbox = message.remote_mailbox;
        let nextRemoteUid = message.remote_uid;
        if (hasRemoteSource && targetRemoteMailbox) {
          remoteAttempted = true;
          remoteApplied = true;
          nextRemoteMailbox = targetRemoteMailbox;
          nextRemoteUid += 1000;
          remoteMessage = `本地已移动；远端邮件已移动到 ${targetRemoteMailbox}，UID 已重绑定。`;
        } else if (hasRemoteSource && targetRole === 'trash') {
          remoteAttempted = true;
          remoteApplied = true;
          nextRemoteMailbox = '';
          nextRemoteUid = 0;
          remoteMessage = '本地已移到废纸篓；远端没有废纸篓映射，邮件已直接删除并 expunge。';
        } else if (hasRemoteSource) {
          remoteMessage = `本地已移动；未发现角色 ${targetRole} 对应的远端文件夹，远端移动已跳过。`;
        }
        return {
          ...message,
          folder_role: targetRole || message.folder_role,
          folder_id: targetFolderId,
          remote_mailbox: nextRemoteMailbox,
          remote_uid: nextRemoteUid,
          snoozed_until: '',
        };
      });
      return {
        local_applied: true,
        remote_attempted: remoteAttempted,
        remote_applied: remoteApplied,
        message: remoteMessage,
      } as T;
    }
    case 'restore_message_to_inbox': {
      const messageId = Number(args?.messageId);
      let restored: MockMessage | null = null;
      let remoteAttempted = false;
      let remoteApplied = false;
      messages = messages.map((message) => {
        if (message.id !== messageId) return message;
        const inboxRemoteMailbox = mockImapMailboxes.find((mailbox) =>
          mailbox.account_id === message.account_id && mailbox.local_role === 'inbox')
          ?.remote_name ?? '';
        const hasRemoteSource = Boolean(message.remote_mailbox && message.remote_uid > 0);
        remoteAttempted = hasRemoteSource && Boolean(inboxRemoteMailbox);
        remoteApplied = remoteAttempted;
        restored = {
          ...message,
          folder_role: 'inbox',
          folder_id: folderIdForRole('inbox', message.account_id),
          remote_mailbox: remoteApplied ? inboxRemoteMailbox : message.remote_mailbox,
          remote_uid: remoteApplied ? message.remote_uid + 1000 : message.remote_uid,
          snoozed_until: '',
        };
        return restored;
      });
      if (!restored) throw new Error('message not found');
      return {
        restored,
        remote: {
          local_applied: true,
          remote_attempted: remoteAttempted,
          remote_applied: remoteApplied,
          message: remoteApplied
            ? '本地已恢复到收件箱；远端邮件已移动到 INBOX，UID 已重绑定。'
            : '本地已恢复到收件箱；该邮件没有可用远端状态，远端移动已跳过。',
        },
      } as T;
    }
    case 'delete_message_permanently': {
      const messageId = Number(args?.messageId);
      const message = messages.find((item) => item.id === messageId);
      const remoteApplied = Boolean(message?.remote_mailbox && message.remote_uid > 0);
      messages = messages.filter((message) => message.id !== messageId);
      attachments = attachments.filter((attachment) => attachment.message_id !== messageId);
      outbox = outbox.filter((item) => item.message_id !== messageId);
      return {
        local_applied: true,
        remote_attempted: remoteApplied,
        remote_applied: remoteApplied,
        message: remoteApplied
          ? '本地已永久删除；远端邮件已标记删除并 expunge。'
          : '本地已永久删除；该邮件没有可用远端状态，跳过远端删除。',
      } as T;
    }
    case 'empty_trash': {
      const accountId = Number(args?.accountId ?? 0);
      const trashMessages = messages.filter((message) =>
        message.folder_role === 'trash' && (!accountId || message.account_id === accountId));
      const trashIds = new Set(trashMessages.map((message) => message.id));
      const remoteAppliedCount = trashMessages.filter((message) =>
        Boolean(message.remote_mailbox && message.remote_uid > 0)).length;
      const remoteSkippedCount = trashMessages.length - remoteAppliedCount;
      messages = messages.filter((message) => !trashIds.has(message.id));
      attachments = attachments.filter((attachment) => !trashIds.has(attachment.message_id));
      outbox = outbox.filter((item) => !trashIds.has(item.message_id));
      return {
        local_deleted_count: trashIds.size,
        remote_attempted_count: remoteAppliedCount,
        remote_applied_count: remoteAppliedCount,
        remote_skipped_count: remoteSkippedCount,
        remote_failed_count: 0,
        message: `已清空废纸篓：本地永久删除 ${trashIds.size} 封；远端成功 ${remoteAppliedCount} 封，跳过 ${remoteSkippedCount} 封。`,
      } as T;
    }
    case 'snooze_message': {
      const messageId = Number(args?.messageId);
      const snoozedUntil = String(args?.snoozedUntil ?? args?.snoozed_until ?? '').trim();
      let updated: MockMessage | null = null;
      messages = messages.map((message) => {
        if (message.id !== messageId) return message;
        updated = {
          ...message,
          folder_role: 'snoozed',
          folder_id: folderIdForRole('snoozed', message.account_id),
          snoozed_until: snoozedUntil,
          is_read: true,
        };
        return updated;
      });
      if (!updated) throw new Error('message not found');
      return updated as T;
    }
    case 'unsnooze_message': {
      const messageId = Number(args?.messageId);
      let updated: MockMessage | null = null;
      messages = messages.map((message) => {
        if (message.id !== messageId) return message;
        updated = {
          ...message,
          folder_role: 'inbox',
          folder_id: folderIdForRole('inbox', message.account_id),
          snoozed_until: '',
        };
        return updated;
      });
      if (!updated) throw new Error('message not found');
      return updated as T;
    }
    case 'release_due_snoozed_messages':
      return releaseDueSnoozedMessages(String(args?.now ?? '')) as T;
    case 'apply_label_to_message': {
      const label = labels.find((item) => item.id === args?.labelId);
      if (label) {
        messages = messages.map((message) =>
          message.id === args?.messageId && !message.labels.includes(label.name)
            ? { ...message, labels: [...message.labels, label.name] }
            : message,
        );
      }
      return undefined as T;
    }
    case 'remove_label_from_message': {
      const label = labels.find((item) => item.id === args?.labelId);
      if (label) {
        messages = messages.map((message) =>
          message.id === args?.messageId
            ? { ...message, labels: message.labels.filter((name) => name !== label.name) }
            : message,
        );
      }
      return undefined as T;
    }
    case 'list_identities':
      return identities as T;
    case 'upsert_identity': {
      const input = args?.input as Partial<MockIdentity>;
      const accountId = Number(input.account_id || account.id);
      const email = String(input.email ?? '').trim().toLowerCase();
      if (!email.includes('@')) throw new Error('请输入有效发件身份邮箱。');
      const saved: MockIdentity = {
        id: Number(input.id || 0) || nextIdentityId++,
        account_id: accountId,
        name: String(input.name ?? '').trim() || email,
        email,
        reply_to: String(input.reply_to ?? '').trim(),
        signature: String(input.signature ?? ''),
        is_default: Boolean(input.is_default),
      };
      if (saved.is_default) {
        identities = identities.map((identity) =>
          identity.account_id === saved.account_id ? { ...identity, is_default: false } : identity,
        );
      }
      identities = identities.filter((identity) => identity.id !== saved.id && !(identity.account_id === saved.account_id && identity.email === saved.email));
      identities = [...identities, saved].sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.id - b.id);
      return saved as T;
    }
    case 'delete_identity':
      identities = identities.filter((identity) => identity.id !== Number(args?.identityId));
      return undefined as T;
    case 'save_draft': {
      const input = args?.input as MockDraftInput;
      const threading = args?.threading as MockThreadingInput | undefined;
      const draftId = Number(input?.draft_id ?? 0);
      if (draftId > 0 && messages.some((message) => message.id === draftId && message.folder_role === 'drafts')) {
        attachments = attachments.filter((attachment) => attachment.message_id !== draftId);
        const message = accountMessageFromDraft(input, 'drafts', draftId, threading);
        messages = messages.map((entry) => (entry.id === draftId ? message : entry));
        return {
          draft_id: draftId,
          remote_attempted: true,
          remote_synced: true,
          remote_mailbox: 'Drafts',
          remote_uid: message.remote_uid,
          message: '草稿已更新并同步到远端草稿箱。',
        } as T;
      }
      const message = accountMessageFromDraft(input, 'drafts', undefined, threading);
      messages = [message, ...messages];
      return {
        draft_id: message.id,
        remote_attempted: true,
        remote_synced: true,
        remote_mailbox: 'Drafts',
        remote_uid: message.remote_uid,
        message: '草稿已保存并同步到远端草稿箱。',
      } as T;
    }
    case 'send_message': {
      const message = accountMessageFromDraft(
        args?.input as MockDraftInput,
        'sent',
        undefined,
        args?.threading as MockThreadingInput | undefined,
      );
      messages = [message, ...messages];
      return message.id as T;
    }
    case 'queue_outbox_message': {
      const input = args?.input as MockDraftInput;
      const sendAt = String(input?.send_at ?? '').trim();
      const message = accountMessageFromDraft(
        input,
        'outbox',
        undefined,
        args?.threading as MockThreadingInput | undefined,
      );
      messages = [message, ...messages];
      const item = {
        id: nextOutboxId++,
        message_id: message.id,
        recipients: message.recipients,
        subject: message.subject,
        status: sendAt ? 'scheduled' : 'queued',
        attempts: 0,
        last_error: '',
        queued_at: now,
        next_attempt_at: sendAt,
      };
      outbox = [item, ...outbox];
      return item as T;
    }
    case 'cancel_outbox_item': {
      const id = Number(args?.outboxId);
      const item = outbox.find((entry) => entry.id === id);
      if (!item) throw new Error('outbox item not found');
      messages = messages.map((message) =>
        message.id === item.message_id
          ? { ...message, folder_role: 'drafts', folder_id: folderIdForRole('drafts', message.account_id) }
          : message,
      );
      const updated = { ...item, status: 'cancelled', last_error: '已撤回到草稿箱', next_attempt_at: '' };
      outbox = outbox.map((entry) => (entry.id === id ? updated : entry));
      return updated as T;
    }
    case 'flush_outbox_dry_run':
      outbox = outbox.map((item) =>
        ['queued', 'retry', 'failed', 'scheduled'].includes(item.status) &&
        (!item.next_attempt_at || Date.parse(item.next_attempt_at) <= Date.now())
          ? { ...item, status: 'sent_dry_run', attempts: item.attempts + 1, last_error: '', next_attempt_at: '' }
          : item,
      );
      return outbox as T;
    case 'flush_outbox_smtp': {
      const sentMessageIds = new Set(
        outbox
          .filter(
            (item) =>
              ['queued', 'retry', 'failed', 'scheduled'].includes(item.status)
              && (!item.next_attempt_at || Date.parse(item.next_attempt_at) <= Date.now()),
          )
          .map((item) => item.message_id),
      );
      const archivedMessageIds = new Set(
        outbox
          .filter(
            (item) =>
              item.status === 'sent_remote_pending'
              && (!item.next_attempt_at || Date.parse(item.next_attempt_at) <= Date.now()),
          )
          .map((item) => item.message_id),
      );
      outbox = outbox.map((item) =>
        sentMessageIds.has(item.message_id)
          ? { ...item, status: 'sent', attempts: item.attempts + 1, last_error: '', next_attempt_at: '' }
          : archivedMessageIds.has(item.message_id)
            ? { ...item, status: 'sent', last_error: '', next_attempt_at: '' }
          : item,
      );
      messages = messages.map((message) =>
        sentMessageIds.has(message.id) || archivedMessageIds.has(message.id)
          ? { ...message, folder_role: 'sent', folder_id: folderIdForRole('sent', message.account_id) }
          : message,
      );
      return outbox as T;
    }
    case 'test_connection': {
      const targetAccount = mockAccounts.find((item) => item.id === Number(args?.accountId)) ?? account;
      return {
        account_email: targetAccount.email,
        checked_at: now,
        ready_for_credentials: true,
        endpoints: [
          { name: 'IMAP', address: targetAccount.imap_host, reachable: true, latency_ms: 12, message: 'mock ok' },
          { name: 'SMTP', address: targetAccount.smtp_host, reachable: true, latency_ms: 14, message: 'mock ok' },
        ],
      } as T;
    }
    case 'verify_account_credentials': {
      const targetAccount = mockAccounts.find((item) => item.id === Number(args?.accountId)) ?? account;
      return {
        account_email: targetAccount.email,
        checked_at: now,
        authenticated: true,
        status: 'ok',
        message: 'IMAP 与 SMTP 登录验证通过，未发送任何邮件。',
        checks: [
          { name: 'IMAP', address: targetAccount.imap_host, authenticated: true, message: 'IMAP 登录认证成功。' },
          { name: 'SMTP', address: targetAccount.smtp_host, authenticated: true, message: 'SMTP 登录认证成功。' },
        ],
      } as T;
    }
    case 'discover_imap_folders': {
      const targetAccount = mockAccounts.find((item) => item.id === Number(args?.accountId)) ?? account;
      const previous = new Map(
        mockImapMailboxes
          .filter((mailbox) => mailbox.account_id === targetAccount.id)
          .map((mailbox) => [mailbox.remote_name, mailbox]),
      );
      const discovered = discoveredImapMailboxesForAccount(targetAccount.id, targetAccount.email)
        .map((mailbox) => ({
          ...mailbox,
          local_folder_id: previous.get(mailbox.remote_name)?.local_folder_id ?? null,
          local_folder_name: previous.get(mailbox.remote_name)?.local_folder_name ?? '',
        }));
      mockImapMailboxes = [
        ...mockImapMailboxes.filter((mailbox) => mailbox.account_id !== targetAccount.id),
        ...discovered,
      ];
      return {
        account_email: targetAccount.email,
        checked_at: now,
        folder_count: 4,
        folders: [
          { name: 'INBOX', delimiter: '/', attributes: ['Inbox'] },
          { name: 'Sent', delimiter: '/', attributes: ['Sent'] },
          { name: 'Archive', delimiter: '/', attributes: ['Archive'] },
          { name: 'Projects/Alpha', delimiter: '/', attributes: [] },
        ],
        status: 'ok',
        message: `UI smoke mock 已发现 ${targetAccount.email} 的 4 个 IMAP 文件夹。`,
      } as T;
    }
    case 'export_diagnostics':
      return JSON.stringify({ app_version: '0.1.0', accounts: [{ email_masked: 'd***@better-email.local' }] }, null, 2) as T;
    case 'export_local_backup':
    case 'preview_local_backup':
    case 'import_local_backup':
      return {
        path: '/tmp/better-email-backup.json',
        exported_at: now,
        app_version: '0.1.0',
        schema_version: 1,
        accounts: 1,
        messages: messages.length,
        labels: labels.length,
        rules: rules.length,
        outbox_items: outbox.length,
        size_bytes: 8192,
        credentials_included: false,
      } as T;
    case 'get_storage_usage':
      return mockStorageUsage() as T;
    case 'clear_attachment_cache': {
      const releasedBytes = mockReclaimableCacheBytes;
      const removedFileCount = mockReclaimableFileCount;
      const resetAttachmentCount = mockCachedAttachmentCount;
      mockReclaimableCacheBytes = 0;
      mockReclaimableFileCount = 0;
      mockCachedAttachmentCount = 0;
      mockPartialDownloadBytes = 0;
      mockPartialDownloadCount = 0;
      return {
        removed_file_count: removedFileCount,
        reset_attachment_count: resetAttachmentCount,
        released_bytes: releasedBytes,
        storage: mockStorageUsage(),
      } as T;
    }
    case 'run_sync_dry_run':
    case 'sync_imap_headers':
    case 'sync_imap_history': {
      const accountId = Number(args?.accountId ?? 0);
      const plan = mockSyncSchedulePlan(accountId);
      const scopedAccountCount = plan.batch_accounts.length;
      const targetAccount = mockAccounts.find((item) => item.id === accountId) ?? account;
      if (
        command === 'sync_imap_headers'
        && targetAccount.id === 2
        && !messages.some((message) => message.subject === 'Design remote sync sample')
      ) {
        messages = [
          {
            id: nextMessageId++,
            account_id: targetAccount.id,
            account_email: targetAccount.email,
            folder_id: folderIdForRole('inbox', targetAccount.id),
            folder_role: 'inbox',
            sender_name: 'Design Sync',
            sender_email: 'design-sync@example.com',
            recipients: targetAccount.email,
            cc: '',
            bcc: '',
            subject: 'Design remote sync sample',
            snippet: '用于验证已映射自定义目录的真实远端移动。',
            body: '用于验证已映射自定义目录的真实远端移动。',
            sanitized_html: '',
            security_warnings: [],
            received_at: '2026-07-09T10:00:00+08:00',
            is_read: false,
            is_starred: false,
            has_attachments: false,
            snoozed_until: '',
            labels: [],
            attachment_count: 0,
            remote_mailbox: 'INBOX',
            remote_uid: 6001,
          },
          ...messages,
        ];
      }
      if (command === 'sync_imap_history') {
        mockImapMailboxes = mockImapMailboxes.map((mailbox) => (
          mailbox.account_id === targetAccount.id
            ? {
                ...mailbox,
                lowest_uid: mailbox.lowest_uid > 0 ? Math.max(1, mailbox.lowest_uid - 25) : 5750,
                highest_uid: mailbox.highest_uid || 6001,
                history_complete: mailbox.lowest_uid > 0,
                history_last_sync_at: now,
                last_sync_at: now,
              }
            : mailbox
        ));
      }
      const foldersPerAccount = command === 'sync_imap_headers'
        ? 4
        : command === 'sync_imap_history' ? 3 : 1;
      const scannedFolderCount = scopedAccountCount * foldersPerAccount;
      const run = {
        id: nextSyncRunId++,
        started_at: now,
        finished_at: now,
        status: command === 'sync_imap_history'
          ? 'imap_history_account'
          : plan.delayed_accounts.length > 0 ? 'imap_headers_limited' : 'ok',
        scanned_folders: scannedFolderCount,
        imported_messages: 1,
        message: command === 'sync_imap_history'
          ? `UI smoke mock 历史回填完成（${targetAccount.email}）：扫描 ${scannedFolderCount} 个文件夹，补充 1 封。`
          : args?.accountId
          ? `UI smoke mock 同步完成（${targetAccount.email}）：扫描 ${scannedFolderCount} 个已映射文件夹，新增或补充 1 封。`
          : `UI smoke mock 统一限流同步完成：本轮 ${scopedAccountCount} / ${plan.total_accounts} 个账号，扫描 ${scannedFolderCount} 个已映射文件夹，新增 1 封；${plan.delayed_accounts.length} 个账号留到下一轮。`,
      };
      syncRuns = [run, ...syncRuns].slice(0, 10);
      return run as T;
    }
    case 'download_attachment': {
      const id = Number(args?.attachmentId);
      const attachment = attachments.find((item) => item.id === id);
      if (!attachment) throw new Error('attachment not found');
      const attempt = (attachmentDownloadAttempts.get(id) ?? 0) + 1;
      attachmentDownloadAttempts.set(id, attempt);
      if (id === 1 && attempt === 1) {
        throw new Error('附件 IMAP 请求在 3 次尝试后仍失败：模拟网络中断；已保留 64 KB 下载进度，点击重试将继续。');
      }
      const updated = { ...attachment, is_downloaded: true, local_path: `/tmp/better-email/${attachment.filename}` };
      attachments = attachments.map((item) => (item.id === id ? updated : item));
      return {
        attachment: updated,
        local_path: updated.local_path,
        message: attempt > 1
          ? `附件已从 64 KB 继续下载：${updated.filename}`
          : `附件已下载：${updated.filename}`,
      } as T;
    }
    case 'open_attachment': {
      const attachment = attachments.find((item) => item.id === args?.attachmentId);
      return `已打开附件：${attachment?.filename ?? 'unknown'}` as T;
    }
    case 'save_attachment_as': {
      const attachment = attachments.find((item) => item.id === args?.attachmentId);
      return `已另存附件：${attachment?.filename ?? 'unknown'}` as T;
    }
    case 'export_message_as_eml': {
      const message = messages.find((item) => item.id === args?.messageId);
      return `邮件已导出为 /tmp/${message?.subject || 'better-email-message'}.eml` as T;
    }
    case 'import_eml_file': {
      const accountId = Number(args?.accountId ?? account.id);
      const targetAccount = mockAccounts.find((item) => item.id === accountId) ?? account;
      const message: MockMessage = {
        id: nextMessageId++,
        account_id: targetAccount.id,
        account_email: targetAccount.email,
        folder_id: folderIdForRole('inbox', targetAccount.id),
        folder_role: 'inbox',
        sender_name: 'Archive Import',
        sender_email: 'archive-import@example.com',
        recipients: targetAccount.email,
        cc: '',
        bcc: '',
        subject: 'Imported EML Sample',
        snippet: '本地 EML 已安全解析，附件可以直接打开。',
        body: '<p>本地 EML 已安全解析，附件可以直接打开。</p>',
        sanitized_html: '<p>本地 EML 已安全解析，附件可以直接打开。</p>',
        security_warnings: [],
        received_at: new Date().toISOString(),
        is_read: true,
        is_starred: false,
        has_attachments: true,
        snoozed_until: '',
        labels: [],
        attachment_count: 1,
        remote_mailbox: '',
        remote_uid: 0,
      };
      attachments = [
        {
          id: nextAttachmentId++,
          message_id: message.id,
          filename: 'imported-note.txt',
          mime_type: 'text/plain',
          size_bytes: 24,
          is_downloaded: true,
          local_path: '/tmp/better-email/imported-note.txt',
          content_id: '',
          is_inline: false,
        },
        ...attachments,
      ];
      messages = [message, ...messages];
      return message as T;
    }
    case 'pick_outbound_attachments':
      return [
        {
          filename: 'smoke-brief.txt',
          mime_type: 'text/plain',
          size_bytes: 16,
          local_path: '/tmp/better-email/smoke-brief.txt',
        },
      ] as T;
    case 'parse_raw_message':
      return {
        subject: '安全预览样例',
        from: 'sender@example.com',
        to: 'demo@better-email.local',
        body_preview: '这是一封用于验证 MIME/HTML 安全预览的原始邮件。',
        sanitized_html: '<img><p>这是一封用于验证 MIME/HTML 安全预览的原始邮件。</p>',
        attachment_count: 0,
        attachment_names: [],
        warning_count: 2,
        warnings: ['检测到远程图片，应默认阻止自动加载。', 'HTML 正文包含 script 标签，渲染前必须清洗。'],
      } as T;
    case 'trust_remote_images': {
      const input = args?.input as { account_id: number; scope: 'sender' | 'domain'; value: string };
      const trust = {
        id: remoteImageTrusts.length + 1,
        account_id: input.account_id,
        account_email: account.email,
        scope: input.scope,
        value: input.value,
        created_at: now,
      };
      remoteImageTrusts = [...remoteImageTrusts.filter((item) => item.scope !== trust.scope || item.value !== trust.value), trust];
      return trust as T;
    }
    case 'delete_remote_image_trust':
      remoteImageTrusts = remoteImageTrusts.filter((trust) => trust.id !== args?.trustId);
      return undefined as T;
    case 'render_message_with_remote_image_policy':
      return renderMessageWithPolicy(Number(args?.messageId)) as T;
    case 'enqueue_background_task': {
      const input = args?.input as { kind?: string; source?: string } | undefined;
      const kind = String(input?.kind ?? 'sync');
      const source = String(input?.source ?? 'manual');
      const active = backgroundTasks.find(
        (task) => task.kind === kind && ['queued', 'running'].includes(task.status),
      );
      if (active) return active as T;
      const task = {
        id: Math.max(0, ...backgroundTasks.map((item) => item.id)) + 1,
        kind,
        title:
          kind === 'outbox-smtp'
            ? '真实发送发件箱'
            : kind === 'outbox-dry-run'
              ? '发件箱发送演练'
              : source === 'timer'
                ? '定时同步邮件头'
                : '同步邮件头',
        source,
        status: 'queued',
        message: '等待执行',
        created_at: now,
        started_at: '',
        finished_at: '',
      };
      backgroundTasks = [task, ...backgroundTasks];
      return task as T;
    }
    case 'next_background_task':
      return (backgroundTasks
        .filter((task) => task.status === 'queued')
        .sort((left, right) => left.created_at.localeCompare(right.created_at))[0] ?? null) as T;
    case 'mark_background_task_running': {
      const taskId = Number(args?.taskId);
      const task = backgroundTasks.find((item) => item.id === taskId);
      if (!task) throw new Error('background task not found');
      const updated = { ...task, status: 'running', message: '执行中', started_at: now };
      backgroundTasks = backgroundTasks.map((item) => (item.id === taskId ? updated : item));
      return updated as T;
    }
    case 'complete_background_task': {
      const taskId = Number(args?.taskId);
      const task = backgroundTasks.find((item) => item.id === taskId);
      if (!task) throw new Error('background task not found');
      const updated = {
        ...task,
        status: 'done',
        message: String(args?.message ?? '完成'),
        finished_at: now,
      };
      backgroundTasks = backgroundTasks.map((item) => (item.id === taskId ? updated : item));
      return updated as T;
    }
    case 'fail_background_task': {
      const taskId = Number(args?.taskId);
      const task = backgroundTasks.find((item) => item.id === taskId);
      if (!task) throw new Error('background task not found');
      const updated = {
        ...task,
        status: 'failed',
        message: String(args?.message ?? '失败'),
        finished_at: now,
      };
      backgroundTasks = backgroundTasks.map((item) => (item.id === taskId ? updated : item));
      return updated as T;
    }
    case 'upsert_rule': {
      const input = args?.input as { name?: string; condition?: string; action?: string; enabled?: boolean };
      const ruleId = args?.ruleId == null ? null : Number(args.ruleId);
      const rule = {
        id: ruleId ?? nextRuleId++,
        name: input.name?.trim() || '未命名规则',
        condition: input.condition?.trim() || 'subject contains Better Email',
        action: input.action?.trim() || 'apply label 重要',
        enabled: Boolean(input.enabled),
      };
      rules = ruleId == null ? [...rules, rule] : rules.map((item) => (item.id === rule.id ? rule : item));
      return rule as T;
    }
    case 'set_rule_enabled': {
      const ruleId = Number(args?.ruleId);
      const updated = rules.find((rule) => rule.id === ruleId);
      if (!updated) throw new Error('rule not found');
      const rule = { ...updated, enabled: Boolean(args?.enabled) };
      rules = rules.map((item) => (item.id === ruleId ? rule : item));
      return rule as T;
    }
    case 'delete_rule':
      rules = rules.filter((rule) => rule.id !== args?.ruleId);
      return undefined as T;
    default:
      return (Array.isArray(args) ? [] : undefined) as T;
  }
}

export function invoke<T>(command: string, args?: InvokeArgs): Promise<T> {
  return mockMode ? mockInvoke<T>(command, args) : loadCore().then(({ invoke: tauriInvoke }) => tauriInvoke<T>(command, args));
}

export function localFileAssetUrl(localPath: string): string {
  const normalizedPath = localPath.trim();
  if (!normalizedPath) return '';
  if (mockMode) {
    if (normalizedPath.endsWith('/better-email-inline-logo.svg')) {
      return '/inline-image-preview.svg';
    }
    return encodeURI(`file://${normalizedPath}`);
  }
  return convertFileSrc(normalizedPath);
}

export function getCurrentWindow() {
  if (mockMode) {
    return {
      setBadgeCount: async () => undefined,
      setBadgeLabel: async () => undefined,
    };
  }
  return {
    setBadgeCount: async (count?: number) => {
      const { getCurrentWindow: getTauriCurrentWindow } = await loadWindow();
      return getTauriCurrentWindow().setBadgeCount(count);
    },
    setBadgeLabel: async (label?: string) => {
      const { getCurrentWindow: getTauriCurrentWindow } = await loadWindow();
      return getTauriCurrentWindow().setBadgeLabel(label);
    },
  };
}

export function isPermissionGranted(): Promise<boolean> {
  return mockMode ? Promise.resolve(true) : loadNotification().then(({ isPermissionGranted }) => isPermissionGranted());
}

export function requestPermission(): Promise<string> {
  return mockMode ? Promise.resolve('granted') : loadNotification().then(({ requestPermission: tauriRequestPermission }) => tauriRequestPermission());
}

export function sendNotification(notification: { title: string; body?: string }) {
  if (mockMode) return;
  void loadNotification().then(({ sendNotification: tauriSendNotification }) => tauriSendNotification(notification));
}
