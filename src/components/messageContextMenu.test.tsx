import { describe, expect, it, vi } from 'vitest';
import type { Folder, Label, MessageSummary } from '../app/types';
import { buildBulkMessageContextItems, buildSingleMessageContextItems } from './messageContextMenu';

const folders: Folder[] = [
  { id: 101, account_id: 1, name: '收件箱', role: 'inbox', unread_count: 0, is_virtual: false },
  { id: -6, account_id: null, name: '垃圾邮件', role: 'spam', unread_count: 0, is_virtual: true },
  { id: -5, account_id: null, name: '废纸篓', role: 'trash', unread_count: 0, is_virtual: true },
];
const labels: Label[] = [];

function messageWithRole(folderRole: MessageSummary['folder_role']): MessageSummary {
  return {
    id: 1,
    account_id: 1,
    account_email: 'demo@better-email.local',
    folder_id: folderRole === 'spam' ? -6 : folderRole === 'trash' ? -5 : 101,
    folder_role: folderRole,
    sender_name: 'Sender',
    sender_email: 'sender@example.com',
    recipients: 'demo@better-email.local',
    cc: '',
    bcc: '',
    subject: 'Subject',
    snippet: 'Snippet',
    security_warnings: [],
    received_at: '2026-08-29T10:00:00+08:00',
    is_read: false,
    is_starred: false,
    has_attachments: false,
    snoozed_until: '',
    labels: [],
    attachment_count: 0,
    remote_mailbox: 'INBOX',
    remote_uid: 42,
  };
}

function buildItems(message: MessageSummary) {
  return buildSingleMessageContextItems({
    message,
    folders,
    labels,
    onSelectMessage: vi.fn(),
    onComposeFromMessage: vi.fn(),
    onRunMessageAction: vi.fn(),
    onMoveMessageToFolder: vi.fn(),
    onToggleMessageLabel: vi.fn(),
  });
}

describe('message context menu spam state', () => {
  it('shows mark-as-spam for an inbox message', () => {
    const items = buildItems(messageWithRole('inbox'));

    expect(items.some((item) => item.id === 'spam' && item.label === '标为垃圾邮件')).toBe(true);
    expect(items.some((item) => item.id === 'not-spam')).toBe(false);
  });

  it('shows not-spam for a spam message', () => {
    const items = buildItems(messageWithRole('spam'));

    expect(items.some((item) => item.id === 'not-spam' && item.label === '不是垃圾邮件')).toBe(true);
    expect(items.some((item) => item.id === 'spam')).toBe(false);
  });

  it('does not expose either spam action for a trash message', () => {
    const items = buildItems(messageWithRole('trash'));

    expect(items.some((item) => item.id === 'spam' || item.id === 'not-spam')).toBe(false);
  });
});

describe('bulk message context state', () => {
  function buildBulkItems(messages: MessageSummary[], scope: 'bulk' | 'thread' = 'bulk') {
    return buildBulkMessageContextItems({
      selectedMessages: messages,
      scope,
      folders,
      labels,
      onRunBulkAction: vi.fn(),
      onRequestSnooze: vi.fn(),
      onMoveBulkToFolder: vi.fn(),
      onToggleBulkLabel: vi.fn(),
    });
  }

  it('uses the same concise state-aware labels for a normal selection', () => {
    const unread = messageWithRole('inbox');
    const read = { ...messageWithRole('inbox'), id: 2, is_read: true, is_starred: true };
    const items = buildBulkItems([unread, read]);

    expect(items.find((item) => item.id === 'bulk-read-state')?.label).toBe('标为已读');
    expect(items.find((item) => item.id === 'bulk-read-state')?.detail).toBe('1/2 封可处理');
    expect(items.some((item) => item.label === '标为未读')).toBe(false);
    expect(items.find((item) => item.id === 'bulk-star-state')?.label).toBe('添加星标');
    expect(items.some((item) => item.label.startsWith('批量'))).toBe(false);
  });

  it('shows scope detail only for partial actions instead of repeating the full selection count', () => {
    const items = buildBulkItems([
      messageWithRole('inbox'),
      { ...messageWithRole('inbox'), id: 2 },
    ]);
    const readItem = items.find((item) => item.id === 'bulk-read-state');

    expect(readItem?.detail).toBeUndefined();
    expect(readItem?.tooltip).toBe('标为已读 · 2 封邮件');
  });

  it('replaces move-to-trash actions with restore and permanent delete in trash', () => {
    const items = buildBulkItems([
      messageWithRole('trash'),
      { ...messageWithRole('trash'), id: 2 },
    ]);

    expect(items.some((item) => item.id === 'bulk-restore')).toBe(true);
    expect(items.some((item) => item.id === 'bulk-permanent-delete' && item.danger)).toBe(true);
    expect(items.some((item) => item.id === 'bulk-archive' || item.id === 'bulk-trash')).toBe(false);
  });

  it('uses thread ids and thread eligibility without bulk wording', () => {
    const items = buildBulkItems([messageWithRole('inbox')], 'thread');

    expect(items.some((item) => item.id === 'thread-archive' && item.label === '归档')).toBe(true);
    expect(items.some((item) => item.label.includes('批量'))).toBe(false);
  });
});
