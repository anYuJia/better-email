import type { Message } from '../app/types';

export type SearchSuggestion = {
  id: 'to' | 'from' | 'attachment' | 'body';
  label: string;
  hint: string;
  count: number;
  query: string;
};

export type MessageSearchEntry = {
  to: string;
  from: string;
  body: string;
  hasAttachments: boolean;
};

function normalizeSearchText(...values: string[]) {
  return values.join('\n').toLowerCase();
}

export function buildMessageSearchEntries(messages: Message[]): MessageSearchEntry[] {
  return messages.map((message) => ({
    to: normalizeSearchText(message.recipients, message.cc, message.bcc),
    from: normalizeSearchText(message.sender_name, message.sender_email),
    body: normalizeSearchText(message.body, message.snippet),
    hasAttachments: message.has_attachments,
  }));
}

export function buildMessageSearchSuggestions(
  entries: MessageSearchEntry[],
  rawQuery: string,
): SearchSuggestion[] {
  const trimmedQuery = rawQuery.trim();
  const normalizedQuery = trimmedQuery.toLowerCase();
  if (!normalizedQuery || normalizedQuery.includes(':')) return [];

  const countMatches = (predicate: (entry: MessageSearchEntry) => boolean) =>
    entries.reduce((count, entry) => count + (predicate(entry) ? 1 : 0), 0);

  return [
    {
      id: 'to',
      label: '收件人',
      hint: '收件人、抄送、密送',
      count: countMatches((entry) => entry.to.includes(normalizedQuery)),
      query: `to:${trimmedQuery}`,
    },
    {
      id: 'from',
      label: '发件人',
      hint: '姓名或邮箱',
      count: countMatches((entry) => entry.from.includes(normalizedQuery)),
      query: `from:${trimmedQuery}`,
    },
    {
      id: 'attachment',
      label: '附件',
      hint: '附件名',
      count: countMatches((entry) => entry.hasAttachments),
      query: `filename:${trimmedQuery}`,
    },
    {
      id: 'body',
      label: '内容',
      hint: '正文',
      count: countMatches((entry) => entry.body.includes(normalizedQuery)),
      query: `body:${trimmedQuery}`,
    },
  ];
}
