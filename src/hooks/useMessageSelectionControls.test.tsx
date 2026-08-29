import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { MessageSummary } from '../app/types';
import { localDateKey } from '../mailUtils';
import useMessageSelectionControls from './useMessageSelectionControls';

function message(id: number, receivedAt: string): MessageSummary {
  return {
    id,
    account_id: 1,
    account_email: 'me@example.com',
    folder_id: 1,
    folder_role: 'inbox',
    sender_name: `Sender ${id}`,
    sender_email: `sender${id}@example.com`,
    recipients: 'me@example.com',
    cc: '',
    bcc: '',
    subject: `Message ${id}`,
    snippet: '',
    security_warnings: [],
    received_at: receivedAt,
    is_read: true,
    is_starred: false,
    has_attachments: false,
    snoozed_until: '',
    labels: [],
    attachment_count: 0,
    remote_mailbox: 'INBOX',
    remote_uid: id,
  };
}

function localDay(offset: number) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset, 12).toISOString();
}

describe('useMessageSelectionControls', () => {
  it('selects and cancels a complete date group, including unloaded messages', async () => {
    const visible = [message(1, localDay(0)), message(3, localDay(1))];
    const hiddenToday = message(2, localDay(0));
    const allMessages = [...visible, hiddenToday];
    const setStatus = vi.fn();
    const refreshRef = { current: 1 };
    const loadAllMessages = vi.fn(async () => allMessages);
    const { result } = renderHook(() => {
      const [selected, setSelected] = useState<number[]>([3]);
      return {
        selected,
        ...useMessageSelectionControls(visible, setSelected, setStatus, loadAllMessages, refreshRef),
      };
    });

    await act(async () => { await result.current.toggleGroup('today', [1], true); });
    expect(result.current.selected).toEqual([3, 1, 2]);
    await act(async () => { await result.current.toggleGroup('today', [1], false); });
    expect(result.current.selected).toEqual([3]);
    expect(loadAllMessages).toHaveBeenCalledTimes(2);
  });

  it('replaces selection with an inclusive local date range', async () => {
    const visible = [message(1, localDay(0)), message(2, localDay(1)), message(3, localDay(2))];
    const setStatus = vi.fn();
    const refreshRef = { current: 1 };
    const start = localDateKey(visible[2].received_at)!;
    const end = localDateKey(visible[1].received_at)!;
    const { result } = renderHook(() => {
      const [selected, setSelected] = useState<number[]>([99]);
      return {
        selected,
        ...useMessageSelectionControls(visible, setSelected, setStatus, undefined, refreshRef),
      };
    });

    await act(async () => {
      await result.current.selectDateRange({
        startDate: start,
        startTime: '00:00:00',
        endDate: end,
        endTime: '24:00:00',
      });
    });
    expect(result.current.selected).toEqual([2, 3]);
  });

  it('ignores a group result after mailbox refresh generation changes', async () => {
    const visible = [message(1, localDay(0))];
    const refreshRef = { current: 7 };
    let resolveAll!: (messages: MessageSummary[]) => void;
    const loadAllMessages = vi.fn(() => new Promise<MessageSummary[]>((resolve) => { resolveAll = resolve; }));
    const { result } = renderHook(() => {
      const [selected, setSelected] = useState<number[]>([]);
      return {
        selected,
        ...useMessageSelectionControls(visible, setSelected, vi.fn(), loadAllMessages, refreshRef),
      };
    });

    let pending: Promise<void> | undefined;
    act(() => { pending = result.current.toggleGroup('today', [1], true); });
    refreshRef.current = 8;
    await act(async () => {
      resolveAll([message(1, localDay(0)), message(2, localDay(0))]);
      await pending;
    });
    expect(result.current.selected).toEqual([]);
  });

  it('does not fall back to visible rows when a complete group is empty', async () => {
    const visible = [message(1, localDay(0))];
    const setStatus = vi.fn();
    const { result } = renderHook(() => {
      const [selected, setSelected] = useState<number[]>([]);
      return {
        selected,
        ...useMessageSelectionControls(
          visible,
          setSelected,
          setStatus,
          vi.fn(async () => visible),
        ),
      };
    });

    await act(async () => { await result.current.toggleGroup('yesterday', [1], true); });
    expect(result.current.selected).toEqual([]);
  });
});
