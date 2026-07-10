import { describe, expect, it } from 'vitest';
import type { OutboxItem } from './types';
import {
  canCancelOutboxItem,
  isListSort,
  outboxStatusLabel,
  outboxTimingLabel,
} from './appConfig';

function archivePendingItem(): OutboxItem {
  return {
    id: 1,
    message_id: 9,
    recipients: 'friend@example.com',
    subject: 'Remote archive',
    status: 'sent_remote_pending',
    attempts: 1,
    last_error: 'SMTP 已发送；远端已发送留档失败',
    queued_at: '2026-07-10T10:00:00+08:00',
    next_attempt_at: '2026-07-10T10:05:00+08:00',
  };
}

describe('outbox remote archive state', () => {
  it('labels remote archive retries separately from SMTP failures', () => {
    expect(outboxStatusLabel('sent_remote_pending')).toBe('已发送 · 留档待重试');
    expect(outboxTimingLabel(archivePendingItem())).toContain('远端留档重试');
  });

  it('does not allow cancelling after SMTP delivery succeeded', () => {
    expect(canCancelOutboxItem('sent_remote_pending')).toBe(false);
    expect(canCancelOutboxItem('queued')).toBe(true);
  });
});

describe('message list sorting', () => {
  it('accepts only the supported persisted sort modes', () => {
    expect(isListSort('newest')).toBe(true);
    expect(isListSort('oldest')).toBe(true);
    expect(isListSort('sender')).toBe(true);
    expect(isListSort('subject')).toBe(true);
    expect(isListSort('received_at desc')).toBe(false);
    expect(isListSort('')).toBe(false);
    expect(isListSort(null)).toBe(false);
  });
});
