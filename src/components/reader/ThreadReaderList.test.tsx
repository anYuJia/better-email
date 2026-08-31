import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FolderRole, MessageSummary, ThreadSummary } from '../../app/types';
import ThreadReaderList from './ThreadReaderList';

afterEach(cleanup);

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
    subject: 'Thread subject',
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

const thread: ThreadSummary = {
  thread_key: 'thread',
  subject: 'Thread subject',
  message_count: 1,
  unread_count: 1,
  latest_at: '2026-08-31T10:00:00+08:00',
  participants: 'Sender',
  is_muted: false,
};

function renderThread(threadMessages: MessageSummary[]) {
  return render(
    <ThreadReaderList
      activeThread={{ ...thread, message_count: threadMessages.length }}
      threadMessages={threadMessages}
      activeThreadSelected={null}
      selectedId={threadMessages[0]?.id ?? null}
      folders={[]}
      labels={[]}
      onSelectMessage={vi.fn()}
      onRunThreadAction={vi.fn()}
      onRequestSnooze={vi.fn()}
      onComposeFromMessage={vi.fn()}
      onMoveThreadToFolder={vi.fn()}
      onToggleThreadLabel={vi.fn()}
      onToggleThreadMute={vi.fn()}
    />,
  );
}

describe('ThreadReaderList action consistency', () => {
  it('uses the same state-aware actions as the thread context menu', () => {
    renderThread([message(1, 'inbox')]);
    fireEvent.click(screen.getByTitle('更多会话操作'));

    expect(screen.getByRole('menuitem', { name: '标为已读' })).toBeDefined();
    expect(screen.queryByRole('menuitem', { name: '标为未读' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: '稍后处理' })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: '标为垃圾邮件' })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: '移到废纸篓' })).toBeDefined();
    expect(screen.queryByRole('menuitem', { name: '添加星标' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: '归档' })).toBeNull();
    expect(screen.queryByText(/批量/)).toBeNull();
  });

  it('uses restore and permanent delete for a thread message in trash', () => {
    renderThread([message(1, 'trash', { is_read: true })]);
    fireEvent.click(screen.getByTitle('更多会话操作'));

    expect(screen.getByRole('menuitem', { name: '恢复到收件箱' })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: '永久删除' })).toBeDefined();
    expect(screen.queryByRole('menuitem', { name: '移到废纸篓' })).toBeNull();
    expect((screen.getByRole('button', { name: '归档会话中的收件邮件' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
