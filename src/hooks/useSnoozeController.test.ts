import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useSnoozeController from './useSnoozeController';
import type { Message, MessageSummary } from '../app/types';

vi.mock('../tauriBridge', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '../tauriBridge';

const mockInvoke = vi.mocked(invoke);

function message(id: number, overrides: Partial<Message> = {}): Message {
  return {
    id,
    account_id: 1,
    account_email: 'me@example.com',
    folder_id: 10,
    folder_role: 'inbox',
    sender_name: 'Sender',
    sender_email: 'sender@example.com',
    recipients: 'me@example.com',
    cc: '',
    bcc: '',
    subject: `Subject ${id}`,
    snippet: 'Snippet',
    body: `Body ${id}`,
    sanitized_html: `<p>Body ${id}</p>`,
    security_warnings: [],
    received_at: '2026-08-01T09:00:00+08:00',
    is_read: false,
    is_starred: false,
    has_attachments: false,
    snoozed_until: '',
    labels: [],
    attachment_count: 0,
    remote_mailbox: 'INBOX',
    remote_uid: id,
    ...overrides,
  };
}

function renderSnooze({ messages }: { messages: MessageSummary[] }) {
  const selectedId = messages[0]?.id ?? null;
  const snapshotMessages = vi.fn((items: MessageSummary[]) =>
    items.map((item) => ({
      id: item.id,
      subject: item.subject,
      account_id: item.account_id,
      folder_role: item.folder_role,
      is_read: item.is_read,
      is_starred: item.is_starred,
      snoozed_until: item.snoozed_until,
      labels: [...item.labels],
    })),
  );
  const mocks = {
    setSelectedId: vi.fn(),
    setSelectedMessageIds: vi.fn(),
    setActiveThread: vi.fn(),
    setThreadMessages: vi.fn(),
    setStatus: vi.fn(),
    clearSelectedDetailIf: vi.fn(),
    invalidateSelectedDetail: vi.fn(),
    refreshAll: vi.fn().mockResolvedValue(undefined),
    queueUndoAction: vi.fn(),
  };

  const hook = renderHook(() => useSnoozeController({
    selected: messages[0] ?? null,
    selectedId,
    threadMessages: [],
    snapshotMessages,
    setSelectedId: mocks.setSelectedId,
    setSelectedMessageIds: mocks.setSelectedMessageIds,
    setActiveThread: mocks.setActiveThread,
    setThreadMessages: mocks.setThreadMessages,
    setStatus: mocks.setStatus,
    clearSelectedDetailIf: mocks.clearSelectedDetailIf,
    invalidateSelectedDetail: mocks.invalidateSelectedDetail,
    refreshAll: mocks.refreshAll,
    queueUndoAction: mocks.queueUndoAction,
  }));

  return { ...hook, snapshotMessages, mocks };
}

describe('useSnoozeController 批量稍后处理', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('用单次批量命令稍后处理多封邮件，并登记全部撤销', async () => {
    const { result, snapshotMessages, mocks } = renderSnooze({
      messages: [message(11), message(12)],
    });
    act(() => {
      result.current.requestSnooze([message(11), message(12)]);
    });
    expect(result.current.snoozeTarget?.messages.length).toBe(2);

    mockInvoke.mockResolvedValueOnce([
      { ...message(11), folder_role: 'snoozed' },
      { ...message(12), folder_role: 'snoozed' },
    ]);
    const until = '2030-01-01T09:00';
    await act(async () => {
      await result.current.confirmSnooze(until);
    });

    // 只有一次 IPC 调用，不是每封邮件一次。
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('snooze_messages', {
      messageIds: [11, 12],
      snoozedUntil: until,
    });
    expect(mocks.setStatus).toHaveBeenCalledWith(expect.stringContaining('已将 2 封邮件稍后处理到'));
    expect(snapshotMessages).toHaveBeenCalledTimes(1);
    expect(mocks.queueUndoAction).toHaveBeenCalledWith(
      '稍后处理',
      expect.arrayContaining([
        expect.objectContaining({ id: 11 }),
        expect.objectContaining({ id: 12 }),
      ]),
      '2 封邮件',
    );
    expect(result.current.snoozeTarget).toBeNull();
    expect(mocks.setSelectedMessageIds).toHaveBeenCalledWith(expect.any(Function));
    expect(mocks.refreshAll).toHaveBeenCalledTimes(1);
  });

  it('单封邮件使用单封状态文案', async () => {
    const { result, mocks } = renderSnooze({ messages: [message(7)] });
    act(() => {
      result.current.requestSnooze([message(7)]);
    });
    mockInvoke.mockResolvedValueOnce([{ ...message(7), folder_role: 'snoozed' }]);

    await act(async () => {
      await result.current.confirmSnooze('2030-01-01T09:00');
    });

    expect(mockInvoke).toHaveBeenCalledWith('snooze_messages', {
      messageIds: [7],
      snoozedUntil: '2030-01-01T09:00',
    });
    expect(mocks.setStatus).toHaveBeenCalledWith(expect.stringContaining('已稍后处理到'));
    expect(mocks.queueUndoAction).toHaveBeenCalledWith(
      '稍后处理',
      expect.anything(),
      undefined,
    );
  });

  it('批量失败时不显示“全部已稍后处理”、不登记撤销、不清除选择', async () => {
    const { result, mocks } = renderSnooze({
      messages: [message(11), message(12)],
    });
    act(() => {
      result.current.requestSnooze([message(11), message(12)]);
    });

    mockInvoke.mockRejectedValueOnce(new Error('message not found'));
    await act(async () => {
      await result.current.confirmSnooze('2030-01-01T09:00');
    });

    expect(mockInvoke).toHaveBeenCalledWith('snooze_messages', {
      messageIds: [11, 12],
      snoozedUntil: '2030-01-01T09:00',
    });
    expect(mocks.setStatus).toHaveBeenCalledWith(
      expect.stringContaining('稍后处理失败，未做任何更改'),
    );
    expect(mocks.setStatus).not.toHaveBeenCalledWith(expect.stringContaining('已稍后处理'));
    // 撤销只登记实际成功的邮件：批量失败时没有任何成功邮件，因此不登记撤销。
    expect(mocks.queueUndoAction).not.toHaveBeenCalled();
    expect(mocks.refreshAll).not.toHaveBeenCalled();
    // 选择与稍后处理选择器都保留，用户可以重试。
    expect(result.current.snoozeTarget).not.toBeNull();
    expect(mocks.setSelectedMessageIds).not.toHaveBeenCalled();
    expect(mocks.setSelectedId).not.toHaveBeenCalled();
  });

  it('后端成功但 refreshAll 失败时，撤销已登记且不把成功说成未做任何更改', async () => {
    const { result, mocks } = renderSnooze({
      messages: [message(11), message(12)],
    });
    act(() => {
      result.current.requestSnooze([message(11), message(12)]);
    });
    expect(result.current.snoozeTarget?.messages.length).toBe(2);

    mockInvoke.mockResolvedValueOnce([
      { ...message(11), folder_role: 'snoozed' },
      { ...message(12), folder_role: 'snoozed' },
    ]);
    mocks.refreshAll.mockRejectedValueOnce(new Error('列表刷新失败'));

    await act(async () => {
      // confirmSnooze 不得产生未处理的 Promise rejection。
      await expect(result.current.confirmSnooze('2030-01-01T09:00')).resolves.toBeUndefined();
    });

    // 后端批量命令成功。
    expect(mockInvoke).toHaveBeenCalledWith('snooze_messages', {
      messageIds: [11, 12],
      snoozedUntil: '2030-01-01T09:00',
    });
    // 撤销入口始终登记（refreshAll 失败不能吞掉）。
    expect(mocks.queueUndoAction).toHaveBeenCalledWith(
      '稍后处理',
      expect.arrayContaining([
        expect.objectContaining({ id: 11 }),
        expect.objectContaining({ id: 12 }),
      ]),
      '2 封邮件',
    );
    // 选择状态合理：选择器关闭、选择被清除。
    expect(result.current.snoozeTarget).toBeNull();
    expect(mocks.setSelectedMessageIds).toHaveBeenCalledWith(expect.any(Function));
    // 成功事实与刷新失败都有正确提示，且绝不出现“未做任何更改”。
    expect(mocks.setStatus).toHaveBeenCalledWith(
      expect.stringContaining('已稍后处理，但本地列表刷新失败'),
    );
    expect(mocks.setStatus).not.toHaveBeenCalledWith(expect.stringContaining('未做任何更改'));
  });
});
