export type QuotedMessage = {
  sender_name: string;
  sender_email: string;
  received_at: string;
  subject: string;
  body: string;
  snippet: string;
};

export type ThreadedMessageHeaders = {
  message_id_header?: string;
  in_reply_to_header?: string;
  references_header?: string;
};

export type MessageThreadingHeaders = {
  in_reply_to: string;
  references: string;
};

export function replyThreadingHeaders(
  message: ThreadedMessageHeaders,
): MessageThreadingHeaders | null {
  const messageId = message.message_id_header?.trim() ?? '';
  if (!/^<[^<>\s]+>$/.test(messageId)) return null;
  const references = [
    ...(message.references_header ?? '').split(/\s+/),
    ...(message.in_reply_to_header ?? '').split(/\s+/),
    messageId,
  ].filter((value, index, values) => /^<[^<>\s]+>$/.test(value) && values.indexOf(value) === index);
  return {
    in_reply_to: messageId,
    references: references.join(' '),
  };
}

export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function prefixedSubject(subject: string, prefix: 'Re' | 'Fwd'): string {
  const normalized = subject.trim() || '(无主题)';
  const matcher = prefix === 'Re' ? /^(re|回复)\s*:/i : /^(fwd|fw|转发)\s*:/i;
  return matcher.test(normalized) ? normalized : `${prefix}: ${normalized}`;
}

export function quoteMessage(message: QuotedMessage): string {
  const sender = `${message.sender_name} <${message.sender_email}>`;
  const date = formatDate(message.received_at);
  const rawBody = message.body.trim();
  const bodySource = /<(?:html|body|p|div|br|img|table|blockquote)\b/i.test(rawBody)
    ? message.snippet.trim()
    : rawBody;
  const source = bodySource || message.snippet.trim() || '(无正文)';
  const quoted = source
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  return `\n\n---- 原始邮件 ----\n发件人：${sender}\n时间：${date}\n主题：${message.subject || '(无主题)'}\n\n${quoted}`;
}

export function syncIntervalMs(syncMode: string): number | null {
  if (syncMode === '15min') return 15 * 60 * 1000;
  if (syncMode === 'push') return 5 * 60 * 1000;
  return null;
}

export type SyncRunSummary = {
  imported_messages: number;
  finished_at: string;
  message: string;
};

export type NewMailMessageSummary = {
  account_id?: number;
  account_email?: string;
  thread_key?: string;
  sender_email: string;
  sender_name: string;
  subject: string;
};

export type NotificationPolicy = {
  quietHoursEnabled: boolean;
  quietStart: string;
  quietEnd: string;
  vipOnly: boolean;
  vipSenders: string;
  mutedAccounts: string;
  priorityAccounts: string;
};

export type NewMailNotificationDecision = {
  body: string | null;
  reason: 'send' | 'no-new-mail' | 'quiet-hours' | 'vip-only-no-match' | 'account-muted' | 'thread-muted';
  vipMatches: number;
  priorityMatches: number;
  mutedMatches: number;
  threadMutedMatches: number;
};

export const defaultNotificationPolicy: NotificationPolicy = {
  quietHoursEnabled: false,
  quietStart: '22:00',
  quietEnd: '08:00',
  vipOnly: false,
  vipSenders: '',
  mutedAccounts: '',
  priorityAccounts: '',
};

export function syncStatusLabel(run: SyncRunSummary): string {
  return `${formatDate(run.finished_at)} · ${run.message}`;
}

export function newMailNotificationBody(run: SyncRunSummary): string | null {
  if (run.imported_messages <= 0) return null;
  return `已同步 ${run.imported_messages} 封新邮件`;
}

export function newMailNotificationDecision(
  run: SyncRunSummary,
  policy: NotificationPolicy = defaultNotificationPolicy,
  messages: NewMailMessageSummary[] = [],
  now = new Date(),
  mutedThreadScopes: Iterable<string> = [],
): NewMailNotificationDecision {
  const defaultBody = newMailNotificationBody(run);
  if (!defaultBody) {
    return {
      body: null,
      reason: 'no-new-mail',
      vipMatches: 0,
      priorityMatches: 0,
      mutedMatches: 0,
      threadMutedMatches: 0,
    };
  }

  const candidates = messages.slice(0, Math.max(0, run.imported_messages));
  const mutedScopeSet = new Set(mutedThreadScopes);
  const accountActiveMessages = candidates.filter((message) => !isAccountListed(message, policy.mutedAccounts));
  const mutedMatches = candidates.length - accountActiveMessages.length;
  if (accountActiveMessages.length === 0 && candidates.length > 0) {
    return {
      body: null,
      reason: 'account-muted',
      vipMatches: 0,
      priorityMatches: 0,
      mutedMatches,
      threadMutedMatches: 0,
    };
  }
  const activeMessages = accountActiveMessages.filter((message) => (
    !mutedScopeSet.has(notificationThreadScopeKey(message))
  ));
  const threadMutedMatches = accountActiveMessages.length - activeMessages.length;
  if (activeMessages.length === 0 && accountActiveMessages.length > 0) {
    return {
      body: null,
      reason: 'thread-muted',
      vipMatches: 0,
      priorityMatches: 0,
      mutedMatches,
      threadMutedMatches,
    };
  }
  const priorityMessages = activeMessages.filter((message) => isAccountListed(message, policy.priorityAccounts));
  const vipMessages = activeMessages.filter((message) => isVipSender(message, policy.vipSenders));
  const quietActive = policy.quietHoursEnabled && isQuietHoursActive(policy, now);

  if (policy.vipOnly && vipMessages.length === 0) {
    return {
      body: null,
      reason: 'vip-only-no-match',
      vipMatches: 0,
      priorityMatches: priorityMessages.length,
      mutedMatches,
      threadMutedMatches,
    };
  }
  if (quietActive && vipMessages.length === 0 && priorityMessages.length === 0) {
    return {
      body: null,
      reason: 'quiet-hours',
      vipMatches: 0,
      priorityMatches: 0,
      mutedMatches,
      threadMutedMatches,
    };
  }
  if (vipMessages.length > 0) {
    const first = vipMessages[0];
    const subject = first.subject.trim() || '(无主题)';
    const sender = first.sender_name.trim() || first.sender_email;
    const prefix = policy.vipOnly || quietActive
      ? `VIP 新邮件 ${vipMessages.length} 封`
      : `已同步 ${run.imported_messages} 封新邮件，含 VIP ${vipMessages.length} 封`;
    return {
      body: `${prefix}：${sender} · ${subject}`,
      reason: 'send',
      vipMatches: vipMessages.length,
      priorityMatches: priorityMessages.length,
      mutedMatches,
      threadMutedMatches,
    };
  }
  if (priorityMessages.length > 0) {
    const first = priorityMessages[0];
    const subject = first.subject.trim() || '(无主题)';
    const account = first.account_email?.trim() || '重点账号';
    return {
      body: `重点账号新邮件 ${priorityMessages.length} 封：${account} · ${subject}`,
      reason: 'send',
      vipMatches: 0,
      priorityMatches: priorityMessages.length,
      mutedMatches,
      threadMutedMatches,
    };
  }

  return {
    body: defaultBody,
    reason: 'send',
    vipMatches: 0,
    priorityMatches: 0,
    mutedMatches,
    threadMutedMatches,
  };
}

export function notificationThreadScopeKey(message: NewMailMessageSummary): string {
  const accountId = message.account_id ? String(message.account_id) : '';
  const threadKey = message.thread_key?.trim() ?? '';
  return accountId && threadKey ? `${accountId}:${threadKey}` : '';
}

export function senderDomain(senderEmail: string): string {
  const [, domain = ''] = senderEmail.trim().toLowerCase().split('@');
  return domain.trim();
}

export function remoteImageTrustInput(
  accountId: number,
  senderEmail: string,
  scope: 'sender' | 'domain',
): { account_id: number; scope: 'sender' | 'domain'; value: string } {
  const normalizedSender = senderEmail.trim().toLowerCase();
  return {
    account_id: accountId,
    scope,
    value: scope === 'domain' ? senderDomain(normalizedSender) : normalizedSender,
  };
}

export function isQuietHoursActive(policy: NotificationPolicy, now = new Date()): boolean {
  const start = timeToMinutes(policy.quietStart);
  const end = timeToMinutes(policy.quietEnd);
  if (start === null || end === null || start === end) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  return start < end ? current >= start && current < end : current >= start || current < end;
}

function isVipSender(message: NewMailMessageSummary, vipSenders: string): boolean {
  const sender = message.sender_email.trim().toLowerCase();
  if (!sender) return false;
  return vipSenders
    .split(/[\n,;，；]/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => (entry.startsWith('@') ? sender.endsWith(entry) : sender === entry));
}

function isAccountListed(message: NewMailMessageSummary, accountList: string): boolean {
  const accountEmail = message.account_email?.trim().toLowerCase() ?? '';
  const accountId = message.account_id ? String(message.account_id) : '';
  if (!accountEmail && !accountId) return false;
  return accountList
    .split(/[\n,;，；]/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => entry === accountEmail || entry === accountId || (entry.startsWith('@') && accountEmail.endsWith(entry)));
}

function timeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}
