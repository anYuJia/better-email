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
  it.each(['reply', 'replyAll'] as const)('uses the resolver for an implicit %s and lets an explicit empty body override it', async (mode) => {
    const openComposer = vi.fn();
    const resolveReplyPrefill = vi.fn(() => '已有快速回复');
    const { result } = renderHook(() => useComposeFromMessage({
      account: null, openComposer, resolveReplyPrefill, setStatus: vi.fn(),
    }));
    await act(async () => { await result.current.composeFromMessage(message, mode); });
    expect(openComposer.mock.calls[0][0].body).toMatch(/^已有快速回复\n\n/);
    expect(resolveReplyPrefill).toHaveBeenCalledWith(message);
    resolveReplyPrefill.mockClear();
    await act(async () => { await result.current.composeFromMessage(message, mode, ''); });
    expect(openComposer.mock.calls[1][0].body).not.toContain('已有快速回复');
    expect(resolveReplyPrefill).not.toHaveBeenCalled();
    await act(async () => { await result.current.composeFromMessage(message, mode, '显式内容'); });
    expect(openComposer.mock.calls[2][0].body).toMatch(/^显式内容\n\n/);
    expect(resolveReplyPrefill).not.toHaveBeenCalled();
  });

  it('never resolves or includes reply text in a forward', async () => {
    const openComposer = vi.fn();
    const resolveReplyPrefill = vi.fn(() => '不应转发的快速回复');
    const { result } = renderHook(() => useComposeFromMessage({
      account: null, openComposer, resolveReplyPrefill, setStatus: vi.fn(),
    }));
    await act(async () => { await result.current.composeFromMessage(message, 'forward'); });
    await act(async () => { await result.current.composeFromMessage(message, 'forward', '也不应带入'); });
    expect(resolveReplyPrefill).not.toHaveBeenCalled();
    for (const [draft] of openComposer.mock.calls) {
      expect(draft.body).not.toContain('不应');
      expect(draft.body).toContain('> Original body');
    }
  });

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
    expect(openComposer.mock.calls[0]?.[1]).toEqual({ replaceExisting: true });
    expect(setStatus).toHaveBeenLastCalledWith('已在写信窗口继续回复');
  });
});
