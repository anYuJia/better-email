import { describe, expect, it } from 'vitest';
import type { Folder, FolderRole, MessageSummary } from './types';
import { movableFoldersForBulk, movableFoldersForMessage } from './folderConfig';

const folders: Folder[] = [
  { id: 1, account_id: 1, name: '收件箱', role: 'inbox', unread_count: 0, is_virtual: false },
  { id: 2, account_id: 1, name: '归档', role: 'archive', unread_count: 0, is_virtual: false },
  { id: 3, account_id: 2, name: '其他账号收件箱', role: 'inbox', unread_count: 0, is_virtual: false },
  { id: -1, account_id: null, name: '统一收件箱', role: 'inbox', unread_count: 0, is_virtual: true },
];

function message(id: number, role: FolderRole, accountId = 1): MessageSummary {
  return {
    id,
    account_id: accountId,
    account_email: `${accountId}@example.com`,
    folder_id: 1,
    folder_role: role,
    sender_name: 'Sender',
    sender_email: 'sender@example.com',
    recipients: 'me@example.com',
    cc: '',
    bcc: '',
    subject: 'Subject',
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
  };
}

describe('movable folder state', () => {
  it('does not offer the folder a single message is already in', () => {
    expect(movableFoldersForMessage(folders, message(1, 'inbox')).map((folder) => folder.role)).toEqual(['archive']);
  });

  it('offers a role for a mixed selection only when at least one message would move', () => {
    expect(movableFoldersForBulk(folders, [message(1, 'inbox')]).map((folder) => folder.role)).toEqual(['archive']);
    expect(movableFoldersForBulk(folders, [message(1, 'inbox'), message(2, 'archive')]).map((folder) => folder.role)).toEqual(['inbox', 'archive']);
  });

  it('blocks cross-account bulk movement', () => {
    expect(movableFoldersForBulk(folders, [message(1, 'inbox'), message(2, 'inbox', 2)])).toEqual([]);
  });
});
