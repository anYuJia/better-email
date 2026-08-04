export const now = new Date('2026-07-09T10:00:00+08:00').toISOString();

export const mockSystemFolders = [
  { name: '收件箱', role: 'inbox' },
  { name: '已发送', role: 'sent' },
  { name: '草稿箱', role: 'drafts' },
  { name: '归档', role: 'archive' },
  { name: '废纸篓', role: 'trash' },
  { name: '垃圾邮件', role: 'spam' },
  { name: '稍后处理', role: 'snoozed' },
] as const;

export function discoveredImapMailboxesForAccount(accountId: number, accountEmail: string) {
  const baseId = accountId * 1000;
  return [
    { id: baseId + 1, remote_name: 'INBOX', local_role: 'inbox', attributes: 'Inbox' },
    { id: baseId + 2, remote_name: 'Sent', local_role: 'sent', attributes: 'Sent' },
    { id: baseId + 3, remote_name: 'Archive', local_role: 'archive', attributes: 'Archive' },
    { id: baseId + 4, remote_name: 'Projects/Alpha', local_role: 'custom', attributes: '' },
  ].map((mailbox) => ({
    ...mailbox,
    account_id: accountId,
    account_email: accountEmail,
    delimiter: '/',
    local_folder_id: null as number | null,
    local_folder_name: '',
    uid_validity: '',
    highest_uid: 0,
    lowest_uid: 0,
    history_complete: mailbox.local_role !== 'custom' ? true : false,
    history_last_sync_at: '',
    last_seen_at: now,
    last_sync_at: '',
  }));
}
