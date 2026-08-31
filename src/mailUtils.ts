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
  const showYear = date.getFullYear() !== new Date().getFullYear();
  return new Intl.DateTimeFormat('zh-CN', {
    ...(showYear ? { year: 'numeric' } : {}),
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export type MessageDateGroup = {
  id: 'today' | 'yesterday' | 'this-week' | 'earlier' | 'unknown';
  label: string;
};

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Returns a stable YYYY-MM-DD key using the user's local calendar date.
 * Mail timestamps are absolute instants, but date-range selection is a
 * calendar operation and must not compare UTC date fragments directly.
 */
export function localDateKey(value: string | Date): string | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function messageMatchesLocalDateRange(
  receivedAt: string,
  startDate: string,
  endDate: string,
): boolean {
  const key = localDateKey(receivedAt);
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return false;
  }
  return key >= startDate && key <= endDate;
}

export type LocalDateTimeRange = {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
};

type LocalDateTimeRangeResult =
  | { valid: true; startMs: number; endMs: number }
  | { valid: false; error: string };

function parseLocalDate(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) return null;
  return { year, month, day };
}

function parseLocalTime(value: string): { hour: number; minute: number; second: number } | null {
  const match = /^(\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3]);
  if (hour > 24 || minute > 59 || second > 59 || (hour === 24 && (minute !== 0 || second !== 0))) {
    return null;
  }
  return { hour, minute, second };
}

function localDateTimeMs(dateValue: string, timeValue: string): number | null {
  const date = parseLocalDate(dateValue);
  const time = parseLocalTime(timeValue);
  if (!date || !time) return null;
  const result = new Date(
    date.year,
    date.month - 1,
    date.day + (time.hour === 24 ? 1 : 0),
    time.hour === 24 ? 0 : time.hour,
    time.minute,
    time.second,
    0,
  );
  return Number.isNaN(result.getTime()) ? null : result.getTime();
}

export function resolveLocalDateTimeRange(range: LocalDateTimeRange): LocalDateTimeRangeResult {
  const startMs = localDateTimeMs(range.startDate, range.startTime);
  const endMs = localDateTimeMs(range.endDate, range.endTime);
  if (startMs === null || endMs === null) {
    return { valid: false, error: '请输入有效的日期和时间（时间格式为 HH:MM:SS）' };
  }
  if (startMs > endMs) {
    return { valid: false, error: '开始时间不能晚于结束时间' };
  }
  return { valid: true, startMs, endMs };
}

export function messageMatchesLocalDateTimeRange(
  receivedAt: string,
  range: LocalDateTimeRange,
): boolean {
  const resolved = resolveLocalDateTimeRange(range);
  const messageMs = new Date(receivedAt).getTime();
  return resolved.valid
    && !Number.isNaN(messageMs)
    && messageMs >= resolved.startMs
    && messageMs <= resolved.endMs;
}

export function messageDateGroup(value: string, now = new Date()): MessageDateGroup {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { id: 'unknown', label: '时间未知' };
  }

  const dayDiff = Math.floor(
    (startOfLocalDay(now).getTime() - startOfLocalDay(date).getTime()) / (24 * 60 * 60 * 1000),
  );

  if (dayDiff === 0) return { id: 'today', label: '今天' };
  if (dayDiff === 1) return { id: 'yesterday', label: '昨天' };
  if (dayDiff >= 2 && dayDiff <= 6) return { id: 'this-week', label: '本周早些时候' };
  return { id: 'earlier', label: '更早' };
}

export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function isMessageBodyCorrupted(body: string): boolean {
  const trimmed = body.trim();
  if (trimmed.startsWith('--') && (trimmed.includes('Content-Type:') || trimmed.includes('content-type:'))) {
    return true;
  }

  // A previous IMAP fetch used BODY.PEEK[] for single-part messages. That
  // stores the whole RFC822 message as the body, so recognize its strong MIME
  // header signature and let the reader request a clean body again.
  const startsWithHeader = /^(?:return-path|received|delivered-to|from|sender|date|subject|message-id|mime-version|content-type)\s*:/i.test(trimmed);
  const hasContentType = /(?:^|\s)content-type\s*:/i.test(trimmed);
  const hasTransferEncoding = /(?:^|\s)content-transfer-encoding\s*:/i.test(trimmed);
  const hasMimeHeader = /(?:^|\s)(?:mime-version|message-id|received|dkim-signature|authentication-results)\s*:/i.test(trimmed);
  return startsWithHeader && hasContentType && hasTransferEncoding && hasMimeHeader;
}

function decodeNumericEntity(code: number): string {
  if (Number.isInteger(code) && code > 0 && code <= 0x10ffff) {
    return String.fromCodePoint(code);
  }
  return '';
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => decodeNumericEntity(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_, code: string) => decodeNumericEntity(parseInt(code, 16)));
}

export function plainTextPreview(value: string): string {
  let preview = value;
  for (let index = 0; index < 2; index += 1) {
    preview = decodeHtmlEntities(preview)
      .replace(/<!doctype[^>]*>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, ' ')
      .replace(/<[^>]+>/g, ' ');
  }
  return preview
    .replace(/\s+/g, ' ')
    .trim();
}

const remoteHeaderOnlySnippet = '远端邮件头已同步';

function isMarkupPreviewNoise(value: string): boolean {
  const normalized = value
    .replace(/[<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  return normalized === '!doctype html'
    || normalized.startsWith('!doctype html ')
    || normalized.startsWith('html ')
    || normalized.startsWith('body ')
    || normalized.startsWith('head ')
    || normalized.startsWith('div style=')
    || normalized.startsWith('span style=')
    || normalized.startsWith('table ')
    || normalized.startsWith('/div')
    || normalized.startsWith('/html');
}

export type PreviewableMailboxMessage = {
  id?: number;
  body?: string;
  sanitized_html?: string;
  snippet: string;
};

// 预览缓存：键为 message id，值为「预览文本 + 输入来源指纹」。
// 指纹覆盖所有影响预览的输入（body/sanitized_html/snippet），内容变化时
// 旧缓存自动失效，避免 header-only 阶段缓存空预览后正文到达仍返回旧值。
const mailboxPreviewCache = new Map<number, { preview: string; sourceKey: string }>();

function previewSourceKey(message: PreviewableMailboxMessage): string {
  const separator = String.fromCharCode(0);
  const source = `${message.body ?? ''}${separator}${message.sanitized_html ?? ''}${separator}${message.snippet}`;
  let hash = 5381;
  for (let i = 0; i < source.length; i += 1) {
    hash = ((hash << 5) + hash + source.charCodeAt(i)) >>> 0;
  }
  return `${source.length}:${hash}`;
}

export function mailboxListPreview(message: PreviewableMailboxMessage): string {
  const messageId = message.id;
  const hasStableKey = messageId !== undefined;
  const sourceKey = previewSourceKey(message);
  const cached = hasStableKey ? mailboxPreviewCache.get(messageId) : undefined;
  if (cached && cached.sourceKey === sourceKey) {
    return cached.preview;
  }

  const calculatePreview = () => {
    const bodyPreview = plainTextPreview(message.body || message.sanitized_html || '');
    if (bodyPreview && !isMarkupPreviewNoise(bodyPreview)) return bodyPreview;
    if (!message.snippet.includes(remoteHeaderOnlySnippet)) {
      const snippetPreview = plainTextPreview(message.snippet);
      return isMarkupPreviewNoise(snippetPreview) ? '' : snippetPreview;
    }
    return '';
  };

  const preview = calculatePreview();

  // 不缓存 header-only 空结果：正文到达后会重新计算，避免旧空预览长期残留。
  if (messageId !== undefined) {
    if (preview) {
      if (!mailboxPreviewCache.has(messageId) && mailboxPreviewCache.size >= 1000) {
        const firstKey = mailboxPreviewCache.keys().next().value;
        if (firstKey !== undefined) {
          mailboxPreviewCache.delete(firstKey);
        }
      }
      mailboxPreviewCache.set(messageId, { preview, sourceKey });
    } else if (cached) {
      // 内容变化后重算为空（如正文仍缺）：移除不再匹配的旧缓存。
      mailboxPreviewCache.delete(messageId);
    }
  }

  return preview;
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
  const normalized = syncMode.trim() === 'push' ? '5min' : syncMode.trim();
  const match = normalized.match(/^(\d+)min$/);
  if (!match) return null;
  const minutes = Number(match[1]);
  if (![1, 5, 15, 30, 60].includes(minutes)) return null;
  return minutes * 60 * 1000;
}

export type SyncRunSummary = {
  imported_messages: number;
  /** 真正新增的邮件数（不含历史补同步）；旧数据可能缺省。 */
  new_messages?: number;
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
  const count = run.new_messages ?? run.imported_messages;
  if (count <= 0) return null;
  return `已同步 ${count} 封新邮件`;
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

  const mailCount = run.new_messages ?? run.imported_messages;
  const candidates = messages.slice(0, Math.max(0, mailCount));
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
  const activeBody = `已同步 ${activeMessages.length} 封新邮件`;

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
      : `${activeBody}，含 VIP ${vipMessages.length} 封`;
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

  if (activeMessages.length === 1) {
    const first = activeMessages[0];
    const subject = first.subject.trim() || '(无主题)';
    const sender = first.sender_name.trim() || first.sender_email;
    return {
      body: `${sender} · ${subject}`,
      reason: 'send',
      vipMatches: 0,
      priorityMatches: 0,
      mutedMatches,
      threadMutedMatches,
    };
  }

  return {
    body: activeBody,
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

export function bodyLooksLikeHtml(body: string): boolean {
  return /<!doctype\b|<(?:html|body|div|p|table|a|img|span)\b/i.test(body);
}

export function htmlHasRenderableContent(html: string): boolean {
  if (/<img\b[^>]*\bsrc\s*=/i.test(html)) return true;
  return Boolean(plainTextPreview(html));
}

export function htmlHasRemoteVisualContent(html: string): boolean {
  // 覆盖 http(s):// 与协议相对 //host/path 远程图片来源。
  const remoteSource = String.raw`(?:https?:)?//`;
  return new RegExp(String.raw`<(?:img|source)\b[^>]*\bsrc\s*=\s*['"]?${remoteSource}`, 'i').test(html)
    || new RegExp(String.raw`\bbackground\s*=\s*['"]?${remoteSource}`, 'i').test(html)
    || new RegExp(String.raw`\bbackground(?:-image)?\s*:[^;>]*url\(\s*['"]?${remoteSource}`, 'i').test(html);
}

export type MailtoParsed = {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
};

function sanitizeMailtoField(value: string): string {
  return value.replace(/[\x00-\x1F\x7F]/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeMailtoValue(value: string): string {
  const normalized = value.replace(/\+/g, ' ');
  try {
    return sanitizeMailtoField(decodeURIComponent(normalized));
  } catch {
    return sanitizeMailtoField(normalized);
  }
}

export function parseMailtoUrl(url: string): MailtoParsed {
  const result: MailtoParsed = { to: '', cc: '', bcc: '', subject: '', body: '' };

  const cleanUrl = url.replace(/[\x00-\x1F\x7F]/g, '');
  if (!cleanUrl.toLowerCase().startsWith('mailto:')) {
    return result;
  }

  const rawParts = cleanUrl.substring(7);
  const [toPart, queryPart] = rawParts.split('?');

  if (toPart) {
    result.to = decodeMailtoValue(toPart);
  }

  if (queryPart) {
    const params = queryPart.split('&');
    for (const param of params) {
      const separatorIndex = param.indexOf('=');
      const key = separatorIndex >= 0 ? param.slice(0, separatorIndex) : param;
      const value = separatorIndex >= 0 ? param.slice(separatorIndex + 1) : '';
      if (!key) continue;

      const cleanKey = key.trim().toLowerCase();
      const decodedValue = decodeMailtoValue(value || '');

      if (cleanKey === 'to') {
        result.to = result.to ? `${result.to},${decodedValue}` : decodedValue;
      } else if (cleanKey === 'cc') {
        result.cc = result.cc ? `${result.cc},${decodedValue}` : decodedValue;
      } else if (cleanKey === 'bcc') {
        result.bcc = result.bcc ? `${result.bcc},${decodedValue}` : decodedValue;
      } else if (cleanKey === 'subject') {
        result.subject = decodedValue;
      } else if (cleanKey === 'body') {
        result.body = decodedValue;
      }
    }
  }

  return result;
}

export function compareDomains(domainA: string, domainB: string): boolean {
  const normalize = (domain: string) => {
    let clean = domain.trim().toLowerCase();
    if (clean.startsWith('www.')) {
      clean = clean.substring(4);
    }
    return clean;
  };
  return normalize(domainA) === normalize(domainB);
}
