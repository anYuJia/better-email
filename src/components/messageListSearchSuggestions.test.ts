import { describe, expect, it } from 'vitest';
import type { MessageSummary } from '../app/types';
import {
  buildMessageSearchEntries,
  buildMessageSearchSuggestions,
} from './messageListSearchSuggestions';

function message(overrides: Partial<MessageSummary>): MessageSummary {
  return {
    id: 1,
    account_id: 1,
    account_email: 'me@example.com',
    folder_id: 1,
    folder_role: 'inbox',
    sender_name: '',
    sender_email: '',
    recipients: '',
    cc: '',
    bcc: '',
    subject: '',
    snippet: '',
    security_warnings: [],
    received_at: '',
    is_read: false,
    is_starred: false,
    has_attachments: false,
    snoozed_until: '',
    labels: [],
    attachment_count: 0,
    remote_mailbox: '',
    remote_uid: 0,
    ...overrides,
  };
}

describe('message list search suggestions', () => {
  it('offers all/sender/recipient/body options with matching counts', () => {
    const entries = buildMessageSearchEntries([
      message({
        recipients: 'Ada Lovelace <ada@example.com>',
        sender_name: 'Grace Hopper',
        subject: 'Quarterly roadmap attached',
        has_attachments: true,
      }),
      message({
        sender_email: 'alerts@example.com',
        cc: 'team@example.com',
        snippet: 'Roadmap follow-up',
      }),
    ]);

    const suggestions = buildMessageSearchSuggestions(entries, ' ROADMAP ');

    expect(suggestions.map((suggestion) => [suggestion.id, suggestion.label, suggestion.count])).toEqual([
      ['all', '全部', 2],
      ['from', '发件人', 0],
      ['to', '收件人', 0],
      ['body', '内容', 2],
    ]);
    expect(suggestions[0].query).toBe('ROADMAP');
    expect(suggestions[0].active).toBe(true);
    expect(suggestions[3].query).toBe('body:ROADMAP');
  });

  it('marks the active field and rewrites the prefix when switching', () => {
    const entries = buildMessageSearchEntries([
      message({ sender_email: 'ada@example.com', snippet: 'hello' }),
    ]);

    const fromSuggestions = buildMessageSearchSuggestions(entries, 'from:ada');
    expect(fromSuggestions.map((suggestion) => suggestion.id)).toEqual([
      'all', 'from', 'to', 'body',
    ]);
    expect(fromSuggestions.find((item) => item.id === 'from')?.active).toBe(true);
    expect(fromSuggestions.find((item) => item.id === 'all')?.query).toBe('ada');
    expect(fromSuggestions.find((item) => item.id === 'to')?.query).toBe('to:ada');

    const toSuggestions = buildMessageSearchSuggestions(entries, 'to:ada');
    expect(toSuggestions.find((item) => item.id === 'to')?.active).toBe(true);
    expect(toSuggestions.find((item) => item.id === 'from')?.query).toBe('from:ada');
  });

  it('returns no options for empty or bare-prefix queries', () => {
    const entries = buildMessageSearchEntries([
      message({ snippet: 'hello' }),
    ]);

    expect(buildMessageSearchSuggestions(entries, '')).toEqual([]);
    expect(buildMessageSearchSuggestions(entries, 'from:')).toEqual([]);
    expect(buildMessageSearchSuggestions(entries, '  ')).toEqual([]);
  });

  it('does not depend on message body/html fields for summary-only lists', () => {
    const entries = buildMessageSearchEntries([
      message({ subject: 'Invoice', snippet: 'Please review the invoice' }),
    ]);
    expect(entries[0].body).toContain('invoice');
    expect(entries[0].body).not.toContain('undefined');
  });
});
