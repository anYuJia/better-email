import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Message } from '../app/types';
import useComposeFromMessage from './useComposeFromMessage';

const message: Message = {
  id: 7,
  account_id: 1,
  account_email: 'me@example.com',
  folder_id: 10,
  folder_role: 'inbox',
  sender_name: 'Ada',
  sender_email: 'ada@example.com',
  recipients: 'me@example.com',
  cc: '',
  bcc: '',
  subject: 'Roadmap',
  snippet: 'Original',
  body: 'Original body',
  sanitized_html: '',
  security_warnings: [],
  received_at: '2026-08-23T12:00:00.000Z',
  is_read: true,
  is_starred: false,
  has_attachments: false,
  snoozed_until: '',
  labels: [],
  attachment_count: 0,
  remote_mailbox: 'INBOX',
  remote_uid: 42,
  message_id_header: '<roadmap@example.com>',
};

describe('useComposeFromMessage quick-reply handoff', () => {
  it('places the existing quick reply before the quoted message and explains that the source remains', async () => {
    const openComposer = vi.fn();
    const setStatus = vi.fn();
    const { result } = renderHook(() => useComposeFromMessage({
      account: null,
      openComposer,
      setStatus,
    }));

    await act(async () => {
      await result.current.composeFromMessage(message, 'reply', '转到写信窗口\n');
    });

    const draft = openComposer.mock.calls[0]?.[0];
    expect(draft.body).toMatch(/^转到写信窗口\n\n/);
    expect(draft.body).toContain('> Original body');
    expect(setStatus).toHaveBeenLastCalledWith('已将快速回复带入写信窗口，原快速回复仍保留');
  });
});
