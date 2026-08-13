import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useSingleMessageActions from './useSingleMessageActions';
import type { MessageSummary, Folder, Label, UndoMessageSnapshot } from '../app/types';

vi.mock('../tauriBridge', () => ({
  invoke: vi.fn(),
}));

vi.mock('./messageActionUtils', () => ({
  toggleMessagesLabel: vi.fn(),
}));

import { toggleMessagesLabel } from './messageActionUtils';

const mockToggleMessagesLabel = vi.mocked(toggleMessagesLabel);

function makeMessage(id: number, overrides: Partial<MessageSummary> = {}): MessageSummary {
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
    subject: `Subject ${id}`,
    snippet: 'Snippet',
    security_warnings: [],
    received_at: '2026-07-09T10:00:00+08:00',
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

const label: Label = { id: 1, name: '工作', color: '#2f7ed8', message_count: 0 };
const folders: Folder[] = [{ id: 101, account_id: 1, name: '收件箱', role: 'inbox', unread_count: 2, is_virtual: false }];

function renderController(message: MessageSummary) {
  const snapshotMessages = vi.fn((items: MessageSummary[]): UndoMessageSnapshot[] => items.map((item) => ({
    id: item.id,
    subject: item.subject,
    account_id: item.account_id,
    folder_role: item.folder_role,
    is_read: item.is_read,
    is_starred: item.is_starred,
    snoozed_until: item.snoozed_until,
    labels: [...item.labels],
  })));

  const mocks = {
    setSelectedId: vi.fn(),
    setStatus: vi.fn(),
    queueUndoAction: vi.fn(),
    patchSelectedDetailMetadata: vi.fn(),
    refreshAll: vi.fn().mockResolvedValue(undefined),
    onReadStateChange: vi.fn(),
    clearSelectedDetailIf: vi.fn(),
    onRequestSnooze: vi.fn(),
    onRequestPermanentDelete: vi.fn(),
  };

  const hook = renderHook(() => useSingleMessageActions({
    folders,
    selected: message,
    refreshAll: mocks.refreshAll,
    setSelectedId: mocks.setSelectedId,
    setStatus: mocks.setStatus,
    snapshotMessages,
    queueUndoAction: mocks.queueUndoAction,
    onReadStateChange: mocks.onReadStateChange,
    clearSelectedDetailIf: mocks.clearSelectedDetailIf,
    patchSelectedDetailMetadata: mocks.patchSelectedDetailMetadata,
    onRequestSnooze: mocks.onRequestSnooze,
    onRequestPermanentDelete: mocks.onRequestPermanentDelete,
  }));

  return { ...hook, mocks, snapshotMessages };
}

describe('useSingleMessageActions 标签切换回归', () => {
  beforeEach(() => {
    mockToggleMessagesLabel.mockReset();
  });

  it('adds, removes, and adds label with matched status text', async () => {
    const initial = makeMessage(1);
    const { result, mocks } = renderController(initial);

    mockToggleMessagesLabel.mockResolvedValue(undefined);

    await act(async () => {
      await result.current.toggleMessageLabel(initial, label);
    });
    expect(mockToggleMessagesLabel).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 1, labels: [] })],
      label,
      false,
    );
    expect(mocks.patchSelectedDetailMetadata).toHaveBeenLastCalledWith(1, { labels: ['工作'] });
    expect(mocks.setStatus).toHaveBeenCalledWith('已添加标签 工作');

    const withLabel = makeMessage(1, { labels: ['工作'] });
    await act(async () => {
      await result.current.toggleMessageLabel(withLabel, label);
    });
    expect(mockToggleMessagesLabel).toHaveBeenLastCalledWith(
      [expect.objectContaining({ id: 1, labels: ['工作'] })],
      label,
      true,
    );
    expect(mocks.patchSelectedDetailMetadata).toHaveBeenCalledWith(1, { labels: [] });
    expect(mocks.setStatus).toHaveBeenCalledWith('已移除标签 工作');

    await act(async () => {
      await result.current.toggleMessageLabel(initial, label);
    });
    expect(mocks.setStatus).toHaveBeenCalledWith('已添加标签 工作');
    expect(mockToggleMessagesLabel).toHaveBeenNthCalledWith(3,
      [expect.objectContaining({ id: 1, labels: [] })],
      label,
      false,
    );
  });
});
