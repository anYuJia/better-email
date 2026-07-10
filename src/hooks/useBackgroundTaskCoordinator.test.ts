import { describe, expect, it } from 'vitest';
import type { OutboxItem } from '../app/types';
import {
  nextOutboxWakeItem,
  outboxFlushMessage,
} from './useBackgroundTaskCoordinator';

function outboxItem(
  id: number,
  status: string,
  nextAttemptAt: string,
): OutboxItem {
  return {
    id,
    message_id: id,
    recipients: 'receiver@example.com',
    subject: `Message ${id}`,
    status,
    attempts: 0,
    last_error: '',
    queued_at: '2026-07-10T10:00:00.000Z',
    next_attempt_at: nextAttemptAt,
  };
}

describe('background task coordinator helpers', () => {
  it('wakes for the earliest SMTP or remote archive retry', () => {
    const next = nextOutboxWakeItem([
      outboxItem(1, 'sent', ''),
      outboxItem(2, 'retry', '2026-07-10T10:10:00.000Z'),
      outboxItem(3, 'sent_remote_pending', '2026-07-10T10:05:00.000Z'),
      outboxItem(4, 'queued', '2026-07-10T10:01:00.000Z'),
    ]);

    expect(next?.id).toBe(3);
  });

  it('reports remote archive retry without implying another SMTP send', () => {
    expect(
      outboxFlushMessage([
        outboxItem(1, 'sent_remote_pending', '2026-07-10T10:05:00.000Z'),
      ]),
    ).toBe('SMTP 发送完成，1 封仅等待远端已发送留档重试');
  });
});
