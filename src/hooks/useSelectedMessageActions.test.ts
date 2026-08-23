import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useSelectedMessageActions from './useSelectedMessageActions';
import type { Folder, Label, MessageSummary, UndoMessageSnapshot } from '../app/types';
import { toggleMessagesLabel } from './messageActionUtils';
import { invoke } from '../tauriBridge';

vi.mock('./messageActionUtils', () => ({
  toggleMessagesLabel: vi.fn(),
}));

vi.mock('../tauriBridge', () => ({
  invoke: vi.fn(),
}));

function summary(id: number, labels: string[]): MessageSummary {
  return {
    id,
    account_id: 1,
    account_email: 'demo@better-email.local',
    folder_id: 101,
    folder_role: 'inbox',
    sender_name: 'Sender',
    sender_email: 'sender@example.com',
    recipients: 'demo@better-email.local',
    cc: '',
    bcc: '',
    subject: 'Subject',
    snippet: 'Snippet',
    received_at: '2026-07-09T10:00:00+08:00',
    is_read: false,
    is_starred: false,
    has_attachments: false,
    security_warnings: [],
    snoozed_until: '',
    labels,
    attachment_count: 0,
    remote_mailbox: 'INBOX',
    remote_uid: id,
  };
}

const folders: Folder[] = [{ id: 101, account_id: 1, name: '收件箱', role: 'inbox', unread_count: 2, is_virtual: false }];
const labels: Label[] = [{ id: 1, name: '工作', color: '#2f7ed8', message_count: 0 }];
const label = labels[0];

function snapshotMessages(messages: MessageSummary[]): UndoMessageSnapshot[] {
  return messages.map((message) => ({
    id: message.id,
    subject: message.subject,
    account_id: message.account_id,
    folder_role: message.folder_role,
    is_read: message.is_read,
    is_starred: message.is_starred,
    snoozed_until: message.snoozed_until,
    labels: [...message.labels],
  }));
}

function renderController(
  selected: MessageSummary,
  options: {
    messages?: MessageSummary[];
    refreshedMessages?: MessageSummary[];
    folderId?: number | null;
  } = {},
) {
  const messages = options.messages ?? [selected];
  const refreshedMessages = options.refreshedMessages ?? [];
  const mocks = {
    loadMeta: vi.fn().mockResolvedValue(undefined),
    loadMessages: vi.fn().mockResolvedValue(refreshedMessages),
    setSelectedId: vi.fn(),
    setStatus: vi.fn(),
    queueUndoAction: vi.fn(),
    clearSelectedDetailIf: vi.fn(),
    patchSelectedDetailMetadata: vi.fn(),
    visibleFolderIdForRole: vi.fn().mockReturnValue(null),
    refreshAll: vi.fn().mockResolvedValue(undefined),
  };

  const hook = renderHook(({ selected }) => useSelectedMessageActions({
    selected,
    messages,
    folders,
    labels,
    folderId: options.folderId === undefined ? 101 : options.folderId,
    loadMeta: mocks.loadMeta,
    loadMessages: mocks.loadMessages,
    refreshAll: mocks.refreshAll,
    setSelectedId: mocks.setSelectedId,
    setStatus: mocks.setStatus,
    snapshotMessages,
    queueUndoAction: mocks.queueUndoAction,
    clearSelectedDetailIf: mocks.clearSelectedDetailIf,
    patchSelectedDetailMetadata: mocks.patchSelectedDetailMetadata,
    visibleFolderIdForRole: mocks.visibleFolderIdForRole,
  }), { initialProps: { selected } });

  return { ...hook, mocks };
}

describe('useSelectedMessageActions 标签切换回归', () => {
  const mockToggleMessagesLabel = vi.mocked(toggleMessagesLabel);
  const mockInvoke = vi.mocked(invoke);

  beforeEach(() => {
    vi.clearAllMocks();
    mockToggleMessagesLabel.mockResolvedValue(undefined);
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({ message: 'ok' } as never);
  });

  it('adds, removes, and adds label and keeps status text consistent', async () => {
    const { result, rerender, mocks } = renderController(summary(1, []));
    let current = summary(1, []);

    mockToggleMessagesLabel.mockResolvedValue(undefined);
    await act(async () => {
      await result.current.toggleLabel(label);
    });
    expect(mockToggleMessagesLabel).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 1, labels: [] })],
      label,
      false,
    );
    expect(mocks.patchSelectedDetailMetadata).toHaveBeenCalledWith(1, { labels: ['工作'] });
    expect(mocks.setStatus).toHaveBeenCalledWith('已添加标签：工作');
    expect(mocks.queueUndoAction).toHaveBeenCalledWith('添加标签 工作', expect.any(Array));

    current = summary(1, ['工作']);
    rerender({ selected: current });
    mocks.setStatus.mockClear();
    mocks.queueUndoAction.mockClear();
    mocks.patchSelectedDetailMetadata.mockClear();

    await act(async () => {
      await result.current.toggleLabel(label);
    });
    expect(mockToggleMessagesLabel).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 1, labels: ['工作'] })],
      label,
      true,
    );
    expect(mocks.patchSelectedDetailMetadata).toHaveBeenCalledWith(1, { labels: [] });
    expect(mocks.setStatus).toHaveBeenCalledWith('已移除标签：工作');
    expect(mocks.queueUndoAction).toHaveBeenCalledWith('移除标签 工作', expect.any(Array));

    current = summary(1, []);
    rerender({ selected: current });
    mocks.setStatus.mockClear();
    mocks.queueUndoAction.mockClear();
    mocks.patchSelectedDetailMetadata.mockClear();

    await act(async () => {
      await result.current.toggleLabel(label);
    });
    expect(mockToggleMessagesLabel).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 1, labels: [] })],
      label,
      false,
    );
    expect(mocks.patchSelectedDetailMetadata).toHaveBeenCalledWith(1, { labels: ['工作'] });
    expect(mocks.setStatus).toHaveBeenCalledWith('已添加标签：工作');
    expect(mocks.queueUndoAction).toHaveBeenCalledWith('添加标签 工作', expect.any(Array));
    expect(mockToggleMessagesLabel).toHaveBeenCalledTimes(3);
  });

  it('for label action on selected message, toggleMessagesLabel receives inverse label state', async () => {
    const { result, rerender } = renderController(summary(1, []));
    let current = summary(1, []);

    await act(async () => {
      await result.current.toggleLabel(label);
    });
    expect(mockToggleMessagesLabel).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 1 })],
      label,
      false,
    );

    current = summary(1, ['工作']);
    rerender({ selected: current });
    await act(async () => {
      await result.current.toggleLabel(label);
    });
    expect(mockToggleMessagesLabel).toHaveBeenLastCalledWith(
      [expect.objectContaining({ id: 1 })],
      label,
      true,
    );
  });
});

describe('useSelectedMessageActions 移动后列表与选择语义', () => {
  const mockInvoke = vi.mocked(invoke);

  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({ message: '操作完成' } as never);
  });

  it('归档后刷新源文件夹，并选择原位置的下一封可见邮件', async () => {
    const first = summary(1, []);
    const current = summary(2, []);
    const next = summary(3, []);
    const { result, mocks } = renderController(current, {
      messages: [first, current, next],
      refreshedMessages: [first, next],
    });

    await act(async () => {
      await result.current.moveSelected('archive');
    });

    expect(mockInvoke).toHaveBeenCalledWith('move_message_to_role', {
      messageId: current.id,
      role: 'archive',
    });
    expect(mocks.patchSelectedDetailMetadata).toHaveBeenCalledWith(current.id, {
      folder_role: 'archive',
    });
    expect(mocks.loadMeta).toHaveBeenCalledWith(101);
    expect(mocks.loadMessages).toHaveBeenCalledWith(101);
    expect(mocks.visibleFolderIdForRole).not.toHaveBeenCalled();
    expect(mocks.clearSelectedDetailIf).toHaveBeenCalledWith(current.id);
    expect(mocks.setSelectedId).toHaveBeenLastCalledWith(next.id);
    expect(mocks.queueUndoAction).toHaveBeenCalledWith('归档', [
      expect.objectContaining({ id: current.id, folder_role: 'inbox' }),
    ]);
  });

  it('删除列表末项后回退到前一封，而不是跳转到废纸篓', async () => {
    const first = summary(1, []);
    const current = summary(2, []);
    const { result, mocks } = renderController(current, {
      messages: [first, current],
      refreshedMessages: [first],
    });

    await act(async () => {
      await result.current.moveSelected('trash');
    });

    expect(mocks.loadMeta).toHaveBeenCalledWith(101);
    expect(mocks.loadMessages).toHaveBeenCalledWith(101);
    expect(mocks.setSelectedId).toHaveBeenLastCalledWith(first.id);
    expect(mocks.queueUndoAction).toHaveBeenCalledWith('删除', expect.any(Array));
  });

  it('移动到指定文件夹后保留目标 metadata，但仍刷新源列表', async () => {
    const current = summary(1, []);
    const next = summary(2, []);
    const target: Folder = {
      id: 202,
      account_id: 1,
      name: '项目',
      role: 'custom',
      unread_count: 0,
      is_virtual: false,
    };
    const { result, mocks } = renderController(current, {
      messages: [current, next],
      refreshedMessages: [next],
    });

    await act(async () => {
      await result.current.moveSelectedToFolder(target);
    });

    expect(mocks.patchSelectedDetailMetadata).toHaveBeenCalledWith(current.id, {
      folder_id: target.id,
      folder_role: target.role,
    });
    expect(mocks.loadMeta).toHaveBeenCalledWith(101);
    expect(mocks.loadMessages).toHaveBeenCalledWith(101);
    expect(mocks.setSelectedId).toHaveBeenLastCalledWith(next.id);
    expect(mocks.setStatus).toHaveBeenCalledWith('已移动到 项目');
  });

  it('统一搜索刷新后若邮件仍可见，则保留选择与已更新的详情缓存', async () => {
    const current = summary(1, []);
    const stillVisible = { ...current, folder_role: 'archive' as const };
    const { result, mocks } = renderController(current, {
      messages: [current],
      refreshedMessages: [stillVisible],
      folderId: null,
    });

    await act(async () => {
      await result.current.moveSelected('archive');
    });

    expect(mocks.loadMeta).toHaveBeenCalledWith(null);
    expect(mocks.loadMessages).toHaveBeenCalledWith(null);
    expect(mocks.clearSelectedDetailIf).not.toHaveBeenCalled();
    expect(mocks.setSelectedId).toHaveBeenLastCalledWith(current.id);
  });

  it('线程内邮件不在顶层有序列表时，使用刷新后的第一封作为明确回退', async () => {
    const threadMessage = summary(9, []);
    const firstVisible = summary(1, []);
    const secondVisible = summary(2, []);
    const { result, mocks } = renderController(threadMessage, {
      messages: [],
      refreshedMessages: [firstVisible, secondVisible],
    });

    await act(async () => {
      await result.current.markSelectedAsSpam();
    });

    expect(mocks.loadMessages).toHaveBeenCalledWith(101);
    expect(mocks.clearSelectedDetailIf).toHaveBeenCalledWith(threadMessage.id);
    expect(mocks.setSelectedId).toHaveBeenLastCalledWith(firstVisible.id);
    expect(mocks.queueUndoAction).toHaveBeenCalledWith('标为垃圾邮件', expect.any(Array));
  });

  it.each([
    ['垃圾邮件', 'markSelectedNotSpam', '不是垃圾邮件', 'spam'],
    ['废纸篓', 'restoreSelectedFromTrash', '恢复到收件箱', 'trash'],
  ] as const)('从%s恢复后留在源列表并选中相邻项', async (_source, action, undoTitle, sourceRole) => {
    const current = { ...summary(1, []), folder_role: sourceRole };
    const next = { ...summary(2, []), folder_role: current.folder_role };
    mockInvoke.mockResolvedValueOnce({
      restored: {
        ...current,
        folder_id: 101,
        folder_role: 'inbox',
        is_read: true,
        is_starred: true,
        labels: ['工作'],
        snoozed_until: '',
      },
      remote: { message: '已恢复' },
    } as never);
    const { result, mocks } = renderController(current, {
      messages: [current, next],
      refreshedMessages: [next],
    });

    await act(async () => {
      await result.current[action]();
    });

    expect(mocks.loadMeta).toHaveBeenCalledWith(101);
    expect(mocks.loadMessages).toHaveBeenCalledWith(101);
    expect(mocks.visibleFolderIdForRole).not.toHaveBeenCalled();
    expect(mocks.setSelectedId).toHaveBeenLastCalledWith(next.id);
    expect(mocks.queueUndoAction).toHaveBeenCalledWith(
      undoTitle,
      [expect.objectContaining({ id: current.id, folder_role: sourceRole })],
      '已恢复',
    );
  });

  it('取消稍后处理后留在稍后处理列表并选择相邻项', async () => {
    const current = { ...summary(1, []), folder_role: 'snoozed' as const, snoozed_until: '2026-07-10T09:00:00+08:00' };
    const next = { ...summary(2, []), folder_role: 'snoozed' as const };
    mockInvoke.mockResolvedValueOnce({
      ...current,
      folder_id: 101,
      folder_role: 'inbox',
      snoozed_until: '',
    } as never);
    const { result, mocks } = renderController(current, {
      messages: [current, next],
      refreshedMessages: [next],
    });

    await act(async () => {
      await result.current.unsnoozeSelected();
    });

    expect(mocks.loadMeta).toHaveBeenCalledWith(101);
    expect(mocks.loadMessages).toHaveBeenCalledWith(101);
    expect(mocks.setSelectedId).toHaveBeenLastCalledWith(next.id);
    expect(mocks.queueUndoAction).toHaveBeenCalledWith(
      '取消稍后处理',
      [expect.objectContaining({ id: current.id, folder_role: 'snoozed' })],
    );
  });

  it('永久删除也选择相邻项并刷新源列表', async () => {
    const current = summary(1, []);
    const next = summary(2, []);
    const { result, mocks } = renderController(current, {
      messages: [current, next],
      refreshedMessages: [next],
    });

    await act(async () => {
      await result.current.permanentlyDeleteMessageConfirmed(current);
    });

    expect(mocks.refreshAll).not.toHaveBeenCalled();
    expect(mocks.loadMessages).toHaveBeenCalledWith(101);
    expect(mocks.setSelectedId).toHaveBeenLastCalledWith(next.id);
    expect(mocks.setStatus).toHaveBeenCalledWith('操作完成');
  });
});
