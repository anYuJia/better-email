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
  const hook = renderHook(({ context }) => usePermanentDeleteController({
    selected,
    messages,
    threadMessages,
    folderId: 101,
    mailboxContextKey: context,
    ...mocks,
  }), { initialProps: { context: "account-1:trash" } });
  return { ...hook, mocks };
}

describe('usePermanentDeleteController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue({ message: '操作完成', local_applied: true, remote_applied: true, remote_attempted: true } as never);
  });

  it('keeps unacknowledged deletions selected and exposes the failure instead of reporting success', async () => {
    const current = message(1);
    mockInvoke.mockResolvedValue({ local_applied: false, remote_applied: false, remote_attempted: false, message: '请修复账号登录' });
    const view = renderController(current, [current]);
    await act(async () => { await expect(view.result.current.permanentlyDeleteMessageConfirmed([current])).rejects.toThrow('1 封尚未删除'); });
    expect(view.mocks.clearSelectedDetailIf).not.toHaveBeenCalled();
    expect(view.mocks.setSelectedMessageIds).not.toHaveBeenCalled();
    expect(view.result.current.confirmPermanentlyDelete).toEqual([current]);
  });

  it('refreshes partial success and retries only failed messages after a later IPC rejection', async () => {
    const first = message(1), second = message(2);
    const view = renderController(first, [first, second], [second]);
    mockInvoke.mockResolvedValueOnce({ local_applied: true, remote_applied: true, message: '已删除' }).mockRejectedValueOnce(new Error('连接中断'));
    await act(async () => { await expect(view.result.current.permanentlyDeleteMessageConfirmed([first, second])).rejects.toThrow('已删除 1 封；1 封尚未删除'); });
    expect(view.mocks.loadMessages).toHaveBeenCalledOnce();
    expect(view.mocks.clearSelectedDetailIf).toHaveBeenCalledWith(first.id);
    expect(view.mocks.clearSelectedDetailIf).not.toHaveBeenCalledWith(second.id);
    expect(view.result.current.confirmPermanentlyDelete).toEqual([second]);
    mockInvoke.mockResolvedValue({ local_applied: true, remote_applied: true, message: '已删除' });
    await act(async () => { await view.result.current.permanentlyDeleteMessageConfirmed(view.result.current.confirmPermanentlyDelete!); });
    expect(mockInvoke.mock.calls.filter(([, args]) => (args as { messageId: number }).messageId === first.id)).toHaveLength(1);
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
    expect(mocks.setSelectedId.mock.lastCall?.[0](current.id)).toBe(next.id);
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
    expect(mocks.setSelectedId.mock.lastCall?.[0](first.id)).toBe(next.id);
    expect(mocks.setActiveThread).toHaveBeenCalledWith(null);
    expect(mocks.setThreadMessages).toHaveBeenCalledWith([]);
    expect(mocks.setStatus).toHaveBeenCalledWith('已永久删除 2 封邮件');
  });
  it('commits deletion and selection cleanup when metadata refresh fails, and retries refresh without deleting again', async () => {
    const first = message(1), next = message(2);
    const view = renderController(first, [first, next], [next], [first]);
    view.mocks.loadMeta.mockRejectedValueOnce(new Error('metadata unavailable'));
    await act(async () => {
      await view.result.current.permanentlyDeleteMessageConfirmed([first]);
    });
    expect(view.result.current.confirmPermanentlyDelete).toBeNull();
    expect(view.mocks.setSelectedMessageIds.mock.lastCall?.[0]([1, 2])).toEqual([2]);
    expect(view.mocks.setSelectedId.mock.lastCall?.[0](1)).toBe(2);
    expect(view.mocks.setSelectedId.mock.lastCall?.[0](9)).toBe(9); // a later user selection wins
    expect(view.mocks.setThreadMessages).toHaveBeenCalledWith([]);
    expect(view.mocks.loadMessages).toHaveBeenCalledOnce();
    expect(view.result.current.deleteRefreshError).toContain('metadata unavailable');
    expect(view.mocks.setStatus.mock.lastCall?.[0]).toContain('操作完成；列表刷新失败');
    await act(async () => { await view.result.current.retryDeleteRefresh(); });
    expect(mockInvoke).toHaveBeenCalledOnce();
    expect(view.mocks.loadMessages).toHaveBeenCalledTimes(2);
    expect(view.result.current.deleteRefreshError).toBeNull();
  });

  it('retains only genuinely failed deletion targets when list refresh also rejects', async () => {
    const first = message(1), failed = message(2);
    const view = renderController(first, [first, failed]);
    mockInvoke.mockResolvedValueOnce({ local_applied: true, message: '已删除' })
      .mockResolvedValueOnce({ local_applied: false, message: '服务器未确认' });
    view.mocks.loadMessages.mockRejectedValueOnce(new Error('list unavailable'));
    await act(async () => {
      await expect(view.result.current.permanentlyDeleteMessageConfirmed([first, failed]))
        .rejects.toThrow('已删除 1 封；1 封尚未删除');
    });
    expect(view.result.current.confirmPermanentlyDelete).toEqual([failed]);
    expect(view.mocks.setSelectedMessageIds.mock.lastCall?.[0]([1, 2])).toEqual([2]);
    expect(view.result.current.deleteRefreshError).toContain('list unavailable');
    expect(view.mocks.setStatus.mock.lastCall?.[0]).toContain('1 封尚未删除');
  });

  it('does not expose or retry a late refresh failure in a different account context', async () => {
    const current = message(1);
    const view = renderController(current, [current]);
    let rejectRefresh!: (error: Error) => void;
    view.mocks.loadMeta.mockReturnValueOnce(new Promise((_, reject) => { rejectRefresh = reject; }));
    let deleting!: Promise<void>;
    await act(async () => { deleting = view.result.current.permanentlyDeleteMessageConfirmed([current]); });
    view.rerender({ context: 'account-2:trash' });
    await act(async () => { rejectRefresh(new Error('late old-account refresh')); await deleting; });
    expect(view.result.current.deleteRefreshError).toBeNull();
    await act(async () => { await view.result.current.retryDeleteRefresh(); });
    expect(view.mocks.loadMeta).toHaveBeenCalledOnce();
    expect(mockInvoke).toHaveBeenCalledOnce();
    expect(view.mocks.setStatus.mock.lastCall?.[0]).toBe('操作完成');
  });

});
