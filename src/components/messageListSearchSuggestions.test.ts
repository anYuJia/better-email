import { describe, expect, it } from 'vitest';
import type { Message } from '../app/types';
import {
  buildMessageSearchEntries,
  buildMessageSearchSuggestions,
} from './messageListSearchSuggestions';

function message(overrides: Partial<Message>): Message {
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
    body: '',
    sanitized_html: '',
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
  it('counts matching fields case-insensitively from prebuilt entries', () => {
    const entries = buildMessageSearchEntries([
      message({
        recipients: 'Ada Lovelace <ada@example.com>',
        sender_name: 'Grace Hopper',
        body: 'Quarterly roadmap attached',
        has_attachments: true,
      }),
      message({
        sender_email: 'alerts@example.com',
        cc: 'team@example.com',
        snippet: 'Roadmap follow-up',
      }),
    ]);

    const suggestions = buildMessageSearchSuggestions(entries, ' ROADMAP ');

    expect(suggestions.map((suggestion) => [suggestion.id, suggestion.count])).toEqual([
      ['to', 0],
      ['from', 0],
      ['attachment', 1],
      ['body', 2],
    ]);
    expect(suggestions[3].query).toBe('body:ROADMAP');
  });

  it('keeps scoped search syntax out of shortcut suggestions', () => {
    const entries = buildMessageSearchEntries([
      message({ body: 'hello' }),
    ]);

    expect(buildMessageSearchSuggestions(entries, '')).toEqual([]);
    expect(buildMessageSearchSuggestions(entries, 'from:ada')).toEqual([]);
  });
});
