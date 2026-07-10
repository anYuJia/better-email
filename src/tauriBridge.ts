type InvokeArgs = Record<string, unknown> | undefined;
type TauriCore = typeof import('@tauri-apps/api/core');
type TauriWindow = typeof import('@tauri-apps/api/window');
type TauriNotification = typeof import('@tauri-apps/plugin-notification');

const hasTauriRuntime = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const mockMode = import.meta.env.VITE_SWIFTMAIL_UI_MOCK === '1' || !hasTauriRuntime;
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

const account = {
  id: 1,
  email: 'demo@swiftmail.local',
  display_name: 'Demo User',
  provider: 'gmail',
  imap_host: 'imap.gmail.com:993',
  smtp_host: 'smtp.gmail.com:587',
  auth_type: 'oauth2',
  sync_mode: 'manual',
  remote_images_allowed: false,
  signature: 'Sent from SwiftMail',
};

const mockAccounts = [
  account,
  {
    ...account,
    id: 2,
    email: 'design@swiftmail.local',
    display_name: 'Design Studio',
    provider: 'icloud',
    imap_host: 'imap.mail.me.com:993',
    smtp_host: 'smtp.mail.me.com:587',
    auth_type: 'password',
    sync_mode: '15min',
    signature: 'Sent from SwiftMail Studio',
  },
  {
    ...account,
    id: 3,
    email: 'archive@swiftmail.local',
    display_name: 'Archive Desk',
    provider: 'outlook',
    imap_host: 'outlook.office365.com:993',
    smtp_host: 'smtp.office365.com:587',
    auth_type: 'oauth2',
    sync_mode: 'manual',
    signature: 'Sent from SwiftMail Archive',
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
    email: 'demo@swiftmail.local',
    reply_to: '',
    signature: 'Sent from SwiftMail',
    is_default: true,
  },
  {
    id: 2,
    account_id: 1,
    name: 'Demo Support',
    email: 'support@swiftmail.local',
    reply_to: 'demo@swiftmail.local',
    signature: 'SwiftMail Support',
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

let messages = [
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
    snippet: 'SwiftMail 的 HTML 安全预览、附件和规则都可以验证。',
    body: '<p>SwiftMail 的 HTML 安全预览已就绪。</p><img src="https://cdn.example.com/open.png">',
    sanitized_html: '<p>SwiftMail 的 HTML 安全预览已就绪。</p><img>',
    security_warnings: ['检测到远程图片，默认已阻止自动加载。'],
    received_at: now,
    is_read: false,
    is_starred: true,
    has_attachments: true,
    snoozed_until: '',
    labels: ['重要'],
    attachment_count: 1,
    remote_mailbox: 'INBOX',
    remote_uid: 42,
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
      body: '分页加载样本，帮助验证低内存邮件列表体验。',
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

type MockMessage = (typeof messages)[number];
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

type MockOutboundAttachmentInput = {
  filename?: string;
  mime_type?: string;
  size_bytes?: number;
  local_path?: string;
};

let nextMessageId = Math.max(...messages.map((message) => message.id)) + 1;
let nextAttachmentId = 2;
let nextOutboxId = 1;
let nextRuleId = 4;
let nextIdentityId = 3;
let nextContactId = 4;

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
  },
];

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

let backgroundTasks: unknown[] = [];
let nextFolderId = 1001;

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

function accountMessageFromDraft(input: MockDraftInput, role: string, messageId?: number): MockMessage {
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

function listMessages(args: InvokeArgs) {
  const query = String(args?.query ?? '').trim().toLowerCase();
  const filter = String(args?.filter ?? 'all');
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
  }).slice(0, limit);
}

function normalizedThreadKey(subject: string) {
  return subject.replace(/^(re|fwd):\s*/i, '').trim() || '(无主题)';
}

function listThreadMessages(args: InvokeArgs) {
  const threadKey = String(args?.threadKey ?? args?.thread_key ?? '').trim();
  const accountId = Number(args?.accountId ?? 0);
  return messages
    .filter((message) => normalizedThreadKey(message.subject) === threadKey)
    .filter((message) => accountId <= 0 || message.account_id === accountId)
    .sort((left, right) => left.received_at.localeCompare(right.received_at));
}

function listThreads(args?: InvokeArgs) {
  const accountId = Number(args?.accountId ?? 0);
  const scopedMessages = accountId > 0
    ? messages.filter((message) => message.account_id === accountId)
    : messages;
  const grouped = new Map<string, typeof messages>();
  for (const message of scopedMessages) {
    const key = normalizedThreadKey(message.subject);
    grouped.set(key, [...(grouped.get(key) ?? []), message]);
  }
  return [...grouped.entries()]
    .map(([thread_key, items]) => ({
      thread_key,
      subject: thread_key,
      message_count: items.length,
      unread_count: items.filter((message) => !message.is_read).length,
      latest_at: items
        .map((message) => message.received_at)
        .sort()
        .slice(-1)[0] ?? now,
      participants: [...new Set(items.map((message) => message.sender_name))].join(', '),
    }))
    .sort((left, right) => right.latest_at.localeCompare(left.latest_at));
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
    sanitized_html: '<p>SwiftMail 的 HTML 安全预览已就绪。</p><img src="https://cdn.example.com/open.png">',
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
  switch (command) {
    case 'list_accounts':
      return mockAccounts as T;
    case 'get_account':
      return (Number(args?.accountId ?? 0) > 0
        ? mockAccounts.find((item) => item.id === Number(args?.accountId)) ?? account
        : account) as T;
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
      return undefined as T;
    }
    case 'list_labels':
      refreshLabelCounts();
      return labels as T;
    case 'get_stats':
      return stats(args) as T;
    case 'list_sync_runs':
      return [] as T;
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
    case 'list_rules':
      return rules as T;
    case 'list_threads':
      return listThreads(args) as T;
    case 'list_outbox':
      return outbox as T;
    case 'list_imap_mailboxes':
    case 'list_oauth_sessions':
      return [] as T;
    case 'list_background_tasks':
      return backgroundTasks as T;
    case 'list_remote_image_trusts':
      return remoteImageTrusts as T;
    case 'list_messages':
      return listMessages(args) as T;
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
      messages = messages.map((message) =>
        message.id === args?.messageId ? { ...message, is_read: Boolean(args?.isRead) } : message,
      );
      return {
        local_applied: true,
        remote_attempted: false,
        remote_applied: false,
        message: '本地已更新；UI smoke mock 跳过远端回写。',
      } as T;
    case 'set_message_starred':
      messages = messages.map((message) =>
        message.id === args?.messageId ? { ...message, is_starred: Boolean(args?.isStarred) } : message,
      );
      return undefined as T;
    case 'move_message_to_role':
      messages = messages.map((message) =>
        message.id === args?.messageId
          ? {
              ...message,
              folder_role: String(args?.role ?? message.folder_role),
              folder_id: folderIdForRole(String(args?.role ?? message.folder_role), message.account_id),
              snoozed_until: '',
            }
          : message,
      );
      return {
        local_applied: true,
        remote_attempted: false,
        remote_applied: false,
        message: '本地已移动；UI smoke mock 跳过远端移动。',
      } as T;
    case 'restore_message_to_inbox': {
      const messageId = Number(args?.messageId);
      let restored: MockMessage | null = null;
      messages = messages.map((message) => {
        if (message.id !== messageId) return message;
        restored = {
          ...message,
          folder_role: 'inbox',
          folder_id: folderIdForRole('inbox', message.account_id),
          snoozed_until: '',
        };
        return restored;
      });
      if (!restored) throw new Error('message not found');
      return restored as T;
    }
    case 'delete_message_permanently': {
      const messageId = Number(args?.messageId);
      messages = messages.filter((message) => message.id !== messageId);
      attachments = attachments.filter((attachment) => attachment.message_id !== messageId);
      outbox = outbox.filter((item) => item.message_id !== messageId);
      return undefined as T;
    }
    case 'empty_trash': {
      const trashIds = new Set(messages.filter((message) => message.folder_role === 'trash').map((message) => message.id));
      messages = messages.filter((message) => !trashIds.has(message.id));
      attachments = attachments.filter((attachment) => !trashIds.has(attachment.message_id));
      outbox = outbox.filter((item) => !trashIds.has(item.message_id));
      return trashIds.size as T;
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
      const draftId = Number(input?.draft_id ?? 0);
      if (draftId > 0 && messages.some((message) => message.id === draftId && message.folder_role === 'drafts')) {
        attachments = attachments.filter((attachment) => attachment.message_id !== draftId);
        const message = accountMessageFromDraft(input, 'drafts', draftId);
        messages = messages.map((entry) => (entry.id === draftId ? message : entry));
        return draftId as T;
      }
      const message = accountMessageFromDraft(input, 'drafts');
      messages = [message, ...messages];
      return message.id as T;
    }
    case 'send_message': {
      const message = accountMessageFromDraft(args?.input as MockDraftInput, 'sent');
      messages = [message, ...messages];
      return message.id as T;
    }
    case 'queue_outbox_message': {
      const input = args?.input as MockDraftInput;
      const sendAt = String(input?.send_at ?? '').trim();
      const message = accountMessageFromDraft(input, 'outbox');
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
    case 'flush_outbox_smtp':
      outbox = outbox.map((item) =>
        ['queued', 'retry', 'failed', 'scheduled'].includes(item.status) && (!item.next_attempt_at || Date.parse(item.next_attempt_at) <= Date.now())
          ? { ...item, status: 'sent', attempts: item.attempts + 1, last_error: '', next_attempt_at: '' }
          : item,
      );
      return outbox as T;
    case 'test_connection':
      return {
        account_email: account.email,
        checked_at: now,
        ready_for_credentials: true,
        endpoints: [
          { name: 'IMAP', address: account.imap_host, reachable: true, latency_ms: 12, message: 'mock ok' },
          { name: 'SMTP', address: account.smtp_host, reachable: true, latency_ms: 14, message: 'mock ok' },
        ],
      } as T;
    case 'export_diagnostics':
      return JSON.stringify({ app_version: '0.1.0', accounts: [{ email_masked: 'd***@swiftmail.local' }] }, null, 2) as T;
    case 'export_local_backup':
    case 'preview_local_backup':
    case 'import_local_backup':
      return {
        path: '/tmp/swiftmail-backup.json',
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
    case 'run_sync_dry_run':
    case 'sync_imap_headers': {
      const accountId = Number(args?.accountId ?? 0);
      const plan = mockSyncSchedulePlan(accountId);
      const scopedAccountCount = plan.batch_accounts.length;
      return {
        id: 1,
        started_at: now,
        finished_at: now,
        status: plan.delayed_accounts.length > 0 ? 'imap_headers_limited' : 'ok',
        scanned_folders: scopedAccountCount,
        imported_messages: 1,
        message: args?.accountId
          ? 'UI smoke mock 同步完成：新增 1 封。'
          : `UI smoke mock 统一限流同步完成：本轮 ${scopedAccountCount} / ${plan.total_accounts} 个账号，新增 1 封；${plan.delayed_accounts.length} 个账号留到下一轮。`,
      } as T;
    }
    case 'download_attachment': {
      const id = Number(args?.attachmentId);
      const attachment = attachments.find((item) => item.id === id);
      if (!attachment) throw new Error('attachment not found');
      const updated = { ...attachment, is_downloaded: true, local_path: `/tmp/swiftmail/${attachment.filename}` };
      attachments = attachments.map((item) => (item.id === id ? updated : item));
      return {
        attachment: updated,
        local_path: updated.local_path,
        message: `附件已下载：${updated.filename}`,
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
      return `邮件已导出为 /tmp/${message?.subject || 'swiftmail-message'}.eml` as T;
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
          local_path: '/tmp/swiftmail/imported-note.txt',
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
          local_path: '/tmp/swiftmail/smoke-brief.txt',
        },
      ] as T;
    case 'parse_raw_message':
      return {
        subject: '安全预览样例',
        from: 'sender@example.com',
        to: 'demo@swiftmail.local',
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
      const task = {
        id: backgroundTasks.length + 1,
        kind: String(args?.kind ?? 'sync'),
        title: String(args?.title ?? '同步邮件头'),
        source: 'manual',
        status: 'queued',
        message: '',
        created_at: now,
        started_at: '',
        finished_at: '',
      };
      backgroundTasks = [task];
      return task as T;
    }
    case 'next_background_task':
      return null as T;
    case 'upsert_rule': {
      const input = args?.input as { name?: string; condition?: string; action?: string; enabled?: boolean };
      const ruleId = args?.ruleId == null ? null : Number(args.ruleId);
      const rule = {
        id: ruleId ?? nextRuleId++,
        name: input.name?.trim() || '未命名规则',
        condition: input.condition?.trim() || 'subject contains SwiftMail',
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
