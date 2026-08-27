import type { MessageSummary } from '../app/types';

export type SearchSuggestion = {
  id: 'all' | 'to' | 'from' | 'body' | 'attachment' | 'unread' | 'starred';
  label: string;
  count: number;
  query: string;
  active: boolean;
};

export type MessageSearchEntry = {
  to: string;
  from: string;
  body: string;
  hasAttachments: boolean;
  isRead: boolean;
  isStarred: boolean;
};

const FIELD_PREFIX_PATTERN = /^(from|to|cc|bcc|subject|content|body|filename|label|account|mailbox|folder|after|before):/i;
const QUICK_FILTER_PATTERN = /^(has:attachments?|is:(?:unread|read|starred))(?:\s+|$)/i;

function normalizeSearchText(...values: string[]) {
  return values.join('\n').toLowerCase();
}

export function buildMessageSearchEntries(messages: MessageSummary[]): MessageSearchEntry[] {
  return messages.map((message) => ({
    to: normalizeSearchText(message.recipients, message.cc, message.bcc),
    from: normalizeSearchText(message.sender_name, message.sender_email),
    // MessageSummary 不含 body/html；搜索建议只基于轻量字段（subject + snippet）
    body: normalizeSearchText(message.subject, message.snippet),
    hasAttachments: message.has_attachments,
    isRead: message.is_read,
    isStarred: message.is_starred,
  }));
}

function activeFieldFor(rawQuery: string): SearchSuggestion['id'] {
  const trimmed = rawQuery.trim();
  if (/^has:attachments?(?:\s|$)/i.test(trimmed)) return 'attachment';
  if (/^is:unread(?:\s|$)/i.test(trimmed)) return 'unread';
  if (/^is:starred(?:\s|$)/i.test(trimmed)) return 'starred';
  const match = trimmed.match(FIELD_PREFIX_PATTERN);
  if (!match) return 'all';
  const field = match[1].toLowerCase();
  if (field === 'from') return 'from';
  if (field === 'to') return 'to';
  if (field === 'body' || field === 'content') return 'body';
  return 'all';
}

function searchTextFor(rawQuery: string) {
  return rawQuery
    .trim()
    .replace(QUICK_FILTER_PATTERN, '')
    .replace(FIELD_PREFIX_PATTERN, '')
    .trim();
}

function matchesText(entry: MessageSearchEntry, normalizedText: string) {
  if (!normalizedText) return true;
  return entry.to.includes(normalizedText)
    || entry.from.includes(normalizedText)
    || entry.body.includes(normalizedText);
}

function composeQuery(operator: string, searchText: string) {
  return searchText ? `${operator} ${searchText}` : operator;
}

export function buildMessageSearchSuggestions(
  entries: MessageSearchEntry[],
  rawQuery: string,
): SearchSuggestion[] {
  const trimmedQuery = rawQuery.trim();
  if (!trimmedQuery || /^(from|to|body):$/i.test(trimmedQuery)) return [];
  const activeField = activeFieldFor(trimmedQuery);
  const searchText = searchTextFor(trimmedQuery);
  const normalizedText = searchText.toLowerCase();

  const countMatches = (predicate: (entry: MessageSearchEntry) => boolean) =>
    entries.reduce((count, entry) => count + (predicate(entry) ? 1 : 0), 0);

  return [
    {
      id: 'all',
      label: '全部',
      count: countMatches((entry) => matchesText(entry, normalizedText)),
      query: searchText,
      active: activeField === 'all',
    },
    {
      id: 'from',
      label: '发件人',
      count: countMatches((entry) => entry.from.includes(normalizedText)),
      query: `from:${searchText}`,
      active: activeField === 'from',
    },
    {
      id: 'to',
      label: '收件人',
      count: countMatches((entry) => entry.to.includes(normalizedText)),
      query: `to:${searchText}`,
      active: activeField === 'to',
    },
    {
      id: 'body',
      label: '内容',
      count: countMatches((entry) => entry.body.includes(normalizedText)),
      query: `body:${searchText}`,
      active: activeField === 'body',
    },
    {
      id: 'attachment',
      label: '有附件',
      count: countMatches((entry) => entry.hasAttachments && matchesText(entry, normalizedText)),
      query: composeQuery('has:attachment', searchText),
      active: activeField === 'attachment',
    },
    {
      id: 'unread',
      label: '未读',
      count: countMatches((entry) => !entry.isRead && matchesText(entry, normalizedText)),
      query: composeQuery('is:unread', searchText),
      active: activeField === 'unread',
    },
    {
      id: 'starred',
      label: '星标',
      count: countMatches((entry) => entry.isStarred && matchesText(entry, normalizedText)),
      query: composeQuery('is:starred', searchText),
      active: activeField === 'starred',
    },
  ];
}
