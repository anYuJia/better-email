import { describe, expect, it } from 'vitest';
import {
  applyMessageMetadataPatch,
  resolveReaderSelectedDetail,
  senderInitial,
  type MessageMetadataPatch,
} from './messageDetailUtils';
import type { Message } from './types';

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 1,
    account_id: 1,
    account_email: 'demo@example.com',
    folder_id: 10,
    folder_role: 'inbox',
    sender_name: 'Alice',
    sender_email: 'alice@example.com',
    recipients: 'demo@example.com',
    cc: '',
    bcc: '',
    subject: 'Hello',
    snippet: 'Hi',
    body: 'Body content',
    sanitized_html: '<p>Body content</p>',
    security_warnings: [],
    received_at: '2026-07-10T10:00:00+08:00',
    is_read: false,
    is_starred: false,
    has_attachments: false,
    snoozed_until: '',
    labels: [],
    attachment_count: 0,
    remote_mailbox: 'INBOX',
    remote_uid: 1,
    ...overrides,
  };
}

describe('resolveReaderSelectedDetail', () => {
  it('returns null when selectedDetail is missing', () => {
    expect(resolveReaderSelectedDetail(null, 1)).toBeNull();
  });

  it('returns null when readerSelectedId is null', () => {
    expect(resolveReaderSelectedDetail(makeMessage({ id: 1 }), null)).toBeNull();
  });

  it('returns null when selectedDetail id does not match readerSelectedId (stale)', () => {
    const previous = makeMessage({ id: 1, subject: 'Old mail' });
    expect(resolveReaderSelectedDetail(previous, 2)).toBeNull();
  });

  it('returns detail only when id matches current readerSelectedId', () => {
    const current = makeMessage({ id: 2, subject: 'Current mail' });
    expect(resolveReaderSelectedDetail(current, 2)).toBe(current);
  });

  it('prevents rapid switch from showing previous mail', () => {
    // Simulate: user selected A, then quickly switched to B before detail loads
    const detailA = makeMessage({ id: 101, subject: 'Mail A body' });
    const readerSelectedIdB = 202;
    expect(resolveReaderSelectedDetail(detailA, readerSelectedIdB)).toBeNull();
  });
});

describe('applyMessageMetadataPatch', () => {
  it('updates is_read without touching body/sanitized_html', () => {
    const original = makeMessage({ id: 5, is_read: false, body: 'SECRET', sanitized_html: '<b>SECRET</b>' });
    const patched = applyMessageMetadataPatch(original, { is_read: true });
    expect(patched.is_read).toBe(true);
    expect(patched.body).toBe('SECRET');
    expect(patched.sanitized_html).toBe('<b>SECRET</b>');
    expect(patched.id).toBe(5);
  });

  it('updates is_starred metadata', () => {
    const original = makeMessage({ is_starred: false });
    const patched = applyMessageMetadataPatch(original, { is_starred: true });
    expect(patched.is_starred).toBe(true);
  });

  it('updates labels after toggleMessageLabel', () => {
    const original = makeMessage({ labels: ['work'] });
    const patched = applyMessageMetadataPatch(original, { labels: ['work', 'urgent'] });
    expect(patched.labels).toEqual(['work', 'urgent']);
  });

  it('updates folder_role after move without injecting body into summary shape', () => {
    const summary = {
      id: 9,
      is_read: true,
      is_starred: false,
      folder_role: 'inbox' as const,
      labels: [] as string[],
    };
    const patch: MessageMetadataPatch = { folder_role: 'archive' };
    const patched = applyMessageMetadataPatch(summary, patch);
    expect(patched.folder_role).toBe('archive');
    expect(patched).not.toHaveProperty('body');
    expect(patched).not.toHaveProperty('sanitized_html');
  });

  it('never overwrites id from patch', () => {
    const original = makeMessage({ id: 42 });
    const patched = applyMessageMetadataPatch(original, { is_read: true } as MessageMetadataPatch);
    expect(patched.id).toBe(42);
  });
});

describe('senderInitial', () => {
  it('returns uppercase first letter for English name', () => {
    expect(senderInitial('Google')).toBe('G');
  });

  it('returns uppercase first letter for English email when name is empty', () => {
    expect(senderInitial(null, 'pyu@example.com')).toBe('P');
  });

  it('returns first character for CJK name', () => {
    expect(senderInitial('张三')).toBe('张');
  });

  it('returns "?" when both name and email are empty', () => {
    expect(senderInitial('', '')).toBe('?');
    expect(senderInitial(null, null)).toBe('?');
    expect(senderInitial(undefined, undefined)).toBe('?');
  });

  it('uses name over email when both available', () => {
    expect(senderInitial('Alice', 'bob@example.com')).toBe('A');
  });

  it('handles unusual whitespace gracefully', () => {
    expect(senderInitial('   GitHub   ')).toBe('G');
    expect(senderInitial(' ', ' ')).toBe('?');
  });

  it('is emoji-safe with Array.from()', () => {
    // "🌟"[0] => '\uD83C' (lone surrogate, not the emoji)
    // Array.from('🌟')[0] => '🌟' (correct)
    const result = senderInitial('🌟Star');
    expect(result).toBe('🌟');
    // English fallback after emoji still works
    expect(senderInitial('Hello')).toBe('H');
  });
});
