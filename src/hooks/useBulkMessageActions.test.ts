import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FolderRole, MessageSummary, ThreadSummary, UndoMessageSnapshot } from '../app/types';
import { IPC } from '../ipc/commands';
import { invoke } from '../tauriBridge';
import useBulkMessageActions from './useBulkMessageActions';

vi.mock('../tauriBridge', () => ({ invoke: vi.fn() }));

function message(id: number, folderRole: FolderRole, overrides: Partial<MessageSummary> = {}): MessageSummary {
  return {
    id,
    account_id: 1,
    account_email: 'demo@example.com',
    folder_id: 1,
    folder_role: folderRole,
    sender_name: 'Sender',
    sender_email: 'sender@example.com',
    recipients: 'demo@example.com',
    cc: '',
    bcc: '',
    subject: `Subject ${id}`,
    snippet: 'Snippet',
    security_warnings: [],
    received_at: '2026-08-31T10:00:00+08:00',
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

function snapshotMessages(items: MessageSummary[]): UndoMessageSnapshot[] {
  return items.map((item) => ({
    id: item.id,
    subject: item.subject,
    account_id: item.account_id,
    folder_role: item.folder_role,
    is_read: item.is_read,
    is_starred: item.is_starred,
    snoozed_until: item.snoozed_until,
    labels: [...item.labels],
  }));
}

function renderActions(selectedMessages: MessageSummary[]) {
  const mocks = {
    refreshAll: vi.fn().mockResolvedValue(undefined),
    setActiveThread: vi.fn(),
    setSelectedMessageIds: vi.fn(),
    setStatus: vi.fn(),
    onRequestPermanentDelete: vi.fn(),
    queueUndoAction: vi.fn(),
    onReadStateChange: vi.fn(),
  };
  const hook = renderHook(() => useBulkMessageActions({
    folders: [],
    selectedMessages,
    snapshotMessages,
    ...mocks,
  }));
  return { ...hook, mocks };
}

describe('useBulkMessageActions collection state', () => {
  const mockInvoke = vi.mocked(invoke);

  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({} as never);
  });

  it('changes only unread messages when the aggregate action is mark as read', async () => {
    const unread = message(1, 'inbox');
    const alreadyRead = message(2, 'inbox', { is_read: true });
    const { result, mocks } = renderActions([unread, alreadyRead]);

    await act(async () => result.current.runBulkAction('read'));

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith(IPC.SetMessageRead, { messageId: unread.id, isRead: true });
    expect(mocks.onReadStateChange).toHaveBeenCalledWith([unread.id], true);
    expect(mocks.queueUndoAction).toHaveBeenCalledWith(
      '批量标为已读',
      [expect.objectContaining({ id: unread.id })],
      '1 封邮件',
    );
  });

  it('does not archive trash messages in a mixed selection', async () => {
    const inbox = message(1, 'inbox');
    const trash = message(2, 'trash');
    const { result } = renderActions([inbox, trash]);

    await act(async () => result.current.runBulkAction('archive'));

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith(IPC.MoveMessageToRole, { messageId: inbox.id, role: 'archive' });
  });

  it('restores only trash messages and keeps the action undoable', async () => {
    const inbox = message(1, 'inbox');
    const trash = message(2, 'trash');
    const { result, mocks } = renderActions([inbox, trash]);

    await act(async () => result.current.runBulkAction('restore'));

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith(IPC.RestoreMessageToInbox, { messageId: trash.id });
    expect(mocks.queueUndoAction).toHaveBeenCalledWith(
      '批量恢复到收件箱',
      [expect.objectContaining({ id: trash.id })],
      '1 封邮件',
    );
  });

  it('requests confirmation without deleting immediately', async () => {
    const trash = message(2, 'trash');
    const { result, mocks } = renderActions([trash]);

    await act(async () => result.current.runBulkAction('permanent-delete'));

    expect(mocks.onRequestPermanentDelete).toHaveBeenCalledWith([trash]);
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mocks.setSelectedMessageIds).not.toHaveBeenCalled();
  });

  it('protects drafts when deleting a whole thread', async () => {
    const draft = message(1, 'drafts');
    const inbox = message(2, 'inbox');
    const thread: ThreadSummary = {
      thread_key: 'thread',
      subject: 'Thread',
      message_count: 2,
      unread_count: 2,
      latest_at: inbox.received_at,
      participants: 'Sender',
      is_muted: false,
    };
    const { result } = renderActions([]);

    await act(async () => result.current.runThreadAction(thread, [draft, inbox], 'trash'));

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith(IPC.MoveMessageToRole, { messageId: inbox.id, role: 'trash' });
  });
});
