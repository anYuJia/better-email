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

function renderController(selected: MessageSummary) {
  const mocks = {
    loadMeta: vi.fn().mockResolvedValue(undefined),
    loadMessages: vi.fn().mockResolvedValue(undefined),
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
    folders,
    labels,
    folderId: 101,
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
