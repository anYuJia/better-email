import type { MessageSummary } from '../app/types';

export type SearchSuggestion = {
  id: 'all' | 'to' | 'from' | 'body';
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
};

const FIELD_PREFIX_PATTERN = /^(from|to|cc|bcc|subject|content|body|filename|label|account|mailbox|folder|after|before):/i;

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
  }));
}

function activeFieldFor(rawQuery: string): 'all' | 'to' | 'from' | 'body' {
  const match = rawQuery.trim().match(FIELD_PREFIX_PATTERN);
  if (!match) return 'all';
  const field = match[1].toLowerCase();
  if (field === 'from') return 'from';
  if (field === 'to') return 'to';
  if (field === 'body' || field === 'content') return 'body';
  return 'all';
}

export function buildMessageSearchSuggestions(
  entries: MessageSearchEntry[],
  rawQuery: string,
): SearchSuggestion[] {
  const trimmedQuery = rawQuery.trim();
  if (!trimmedQuery || /^(from|to|body):$/i.test(trimmedQuery)) return [];
  const activeField = activeFieldFor(trimmedQuery);
  const searchText = trimmedQuery.replace(FIELD_PREFIX_PATTERN, '').trim();
  const normalizedText = searchText.toLowerCase();

  const countMatches = (predicate: (entry: MessageSearchEntry) => boolean) =>
    entries.reduce((count, entry) => count + (predicate(entry) ? 1 : 0), 0);

  return [
    {
      id: 'all',
      label: '全部',
      count: countMatches(
        (entry) =>
          entry.to.includes(normalizedText)
          || entry.from.includes(normalizedText)
          || entry.body.includes(normalizedText)
          || entry.hasAttachments,
      ),
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
  ];
}
