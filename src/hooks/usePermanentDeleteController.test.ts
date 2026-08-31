import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageSummary } from '../app/types';
import { invoke } from '../tauriBridge';
import usePermanentDeleteController from './usePermanentDeleteController';

vi.mock('../tauriBridge', () => ({ invoke: vi.fn() }));

const mockInvoke = vi.mocked(invoke);

function message(id: number, folderRole: MessageSummary['folder_role'] = 'trash'): MessageSummary {
  return {
    id,
    account_id: 1,
    account_email: 'demo@better-email.local',
    folder_id: 101,
    folder_role: folderRole,
    sender_name: 'Sender',
    sender_email: 'sender@example.com',
    recipients: 'demo@better-email.local',
    cc: '',
    bcc: '',
    subject: `Subject ${id}`,
    snippet: 'Snippet',
    received_at: '2026-08-31T10:00:00+08:00',
    is_read: false,
    is_starred: false,
    has_attachments: false,
    security_warnings: [],
    snoozed_until: '',
    labels: [],
    attachment_count: 0,
    remote_mailbox: 'Trash',
    remote_uid: id,
  };
}

function renderController(
  selected: MessageSummary | null,
  messages: MessageSummary[],
  refreshedMessages: MessageSummary[] = [],
  threadMessages: MessageSummary[] = [],
) {
  const mocks = {
    loadMeta: vi.fn().mockResolvedValue(undefined),
    loadMessages: vi.fn().mockResolvedValue(refreshedMessages),
    setSelectedId: vi.fn(),
    setSelectedMessageIds: vi.fn(),
    setActiveThread: vi.fn(),
    setThreadMessages: vi.fn(),
    setStatus: vi.fn(),
    clearSelectedDetailIf: vi.fn(),
  };
  const hook = renderHook(() => usePermanentDeleteController({
    selected,
    messages,
    threadMessages,
    folderId: 101,
    ...mocks,
  }));
  return { ...hook, mocks };
}

describe('usePermanentDeleteController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue({ message: '操作完成' } as never);
  });

  it('只允许废纸篓邮件进入永久删除确认', () => {
    const inboxMessage = message(1, 'inbox');
    const { result, mocks } = renderController(inboxMessage, [inboxMessage]);

    act(() => result.current.requestPermanentlyDeleteMessages(inboxMessage));

    expect(result.current.confirmPermanentlyDelete).toBeNull();
    expect(mocks.setStatus).toHaveBeenCalledWith('只有废纸篓中的邮件可以永久删除');
  });

  it('单封永久删除刷新源列表并选择相邻邮件', async () => {
    const current = message(1);
    const next = message(2);
    const { result, mocks } = renderController(current, [current, next], [next]);

    await act(async () => {
      await result.current.permanentlyDeleteMessageConfirmed([current]);
    });

    expect(mockInvoke).toHaveBeenCalledWith('delete_message_permanently', { messageId: current.id });
    expect(mocks.loadMeta).toHaveBeenCalledTimes(1);
    expect(mocks.loadMessages).toHaveBeenCalledWith(101);
    expect(mocks.setSelectedId).toHaveBeenLastCalledWith(next.id);
    expect(mocks.setStatus).toHaveBeenCalledWith('操作完成');
  });

  it('批量永久删除只刷新一次并清理选择和线程', async () => {
    const first = message(1);
    const second = message(2);
    const next = message(3);
    const { result, mocks } = renderController(
      first,
      [first, second, next],
      [next],
      [second],
    );

    await act(async () => {
      await result.current.permanentlyDeleteMessageConfirmed([first, second]);
    });

    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(mocks.loadMeta).toHaveBeenCalledTimes(1);
    expect(mocks.loadMessages).toHaveBeenCalledTimes(1);
    expect(mocks.clearSelectedDetailIf).toHaveBeenCalledWith(first.id);
    expect(mocks.clearSelectedDetailIf).toHaveBeenCalledWith(second.id);
    expect(mocks.setSelectedMessageIds).toHaveBeenCalledWith(expect.any(Function));
    expect(mocks.setSelectedId).toHaveBeenLastCalledWith(next.id);
    expect(mocks.setActiveThread).toHaveBeenCalledWith(null);
    expect(mocks.setThreadMessages).toHaveBeenCalledWith([]);
    expect(mocks.setStatus).toHaveBeenCalledWith('已永久删除 2 封邮件');
  });
});
