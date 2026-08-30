import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Account, Folder, ImapMailboxState } from '../../app/types';
import SyncOperationsSettings from './SyncOperationsSettings';

const account: Account = {
  id: 1,
  email: 'work@example.com',
  display_name: '工作邮箱',
  provider: 'Custom',
  imap_host: 'imap.example.com:993',
  smtp_host: 'smtp.example.com:587',
  incoming_protocol: 'imap',
  auth_type: 'password',
  sync_mode: 'manual',
  remote_images_allowed: false,
  signature: '',
  cross_account_risk_warning: true,
  block_external_mailboxes: false,
  intercept_https_links: true,
  auto_download_attachments: false,
  warn_external_senders: false,
  onboarding_completed: true,
  is_default: true,
};

function mailbox(overrides: Partial<ImapMailboxState>): ImapMailboxState {
  return {
    id: 1,
    account_id: account.id,
    account_email: account.email,
    remote_name: 'INBOX',
    delimiter: '/',
    attributes: '',
    local_role: 'inbox',
    local_folder_id: 1,
    local_folder_name: '收件箱',
    uid_validity: '1',
    highest_uid: 42,
    lowest_uid: 1,
    history_complete: true,
    history_last_sync_at: '',
    last_seen_at: '',
    last_sync_at: '',
    ...overrides,
  };
}

const folders: Folder[] = [
  {
    id: 41,
    account_id: account.id,
    name: '客户项目',
    role: 'custom:clients',
    unread_count: 0,
    is_virtual: false,
  },
];

const mailboxes: ImapMailboxState[] = [
  mailbox({ id: 1, remote_name: 'INBOX', local_role: 'inbox', local_folder_name: '收件箱' }),
  mailbox({ id: 2, remote_name: 'Sent Messages', local_role: 'sent', local_folder_id: 2, local_folder_name: '已发送' }),
  mailbox({
    id: 3,
    remote_name: 'Projects/&ZeVnLIqe-',
    local_role: 'custom',
    local_folder_id: null,
    local_folder_name: '',
    lowest_uid: 0,
    history_complete: false,
  }),
  mailbox({
    id: 4,
    remote_name: 'Clients',
    local_role: 'custom',
    local_folder_id: 41,
    local_folder_name: '客户项目',
    lowest_uid: 0,
    history_complete: false,
  }),
];

function renderSettings() {
  const onMapImapMailbox = vi.fn();
  const onCreateAndMapImapMailbox = vi.fn();
  const onEnqueueBackgroundTask = vi.fn();
  const result = render(
    <SyncOperationsSettings
      accountForm={account}
      imapMailboxes={mailboxes}
      folders={folders}
      onMapImapMailbox={onMapImapMailbox}
      onCreateAndMapImapMailbox={onCreateAndMapImapMailbox}
      onEnqueueBackgroundTask={onEnqueueBackgroundTask}
    />,
  );
  return {
    ...result,
    onMapImapMailbox,
    onCreateAndMapImapMailbox,
    onEnqueueBackgroundTask,
  };
}

describe('SyncOperationsSettings', () => {
  afterEach(() => {
    cleanup();
  });

  it('uses a flat grouped list with localized and decoded folder names', () => {
    const { container } = renderSettings();

    expect(screen.getByText('系统文件夹')).not.toBeNull();
    expect(screen.getByText('其他文件夹')).not.toBeNull();
    expect(screen.getByText('收件箱')).not.toBeNull();
    expect(screen.getByText('已发送')).not.toBeNull();
    expect(screen.getByText('Projects/日本語')).not.toBeNull();
    expect(screen.queryByText('Projects/&ZeVnLIqe-')).toBeNull();
    expect(container.querySelector('.settings-mailbox-list')).not.toBeNull();
    expect(container.querySelector('.mailbox-grid, .mailbox-map-card')).toBeNull();
  });

  it('keeps only actionable sync states and clearer mapping actions', () => {
    renderSettings();

    expect(screen.getByText('未同步')).not.toBeNull();
    expect(screen.getByText('等待同步')).not.toBeNull();
    expect(screen.getAllByText('已同步')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /创建并同步/ })).not.toBeNull();
    expect(screen.queryByText('自动映射')).toBeNull();
    expect(screen.queryByText('已加入同步')).toBeNull();
    expect(screen.queryByText('邮件已同步')).toBeNull();
    expect(screen.queryByText('新建同名')).toBeNull();
  });

  it('removes the no-op selector when there is no local custom folder to choose', () => {
    render(
      <SyncOperationsSettings
        accountForm={account}
        imapMailboxes={mailboxes}
        folders={[]}
        onMapImapMailbox={() => undefined}
        onCreateAndMapImapMailbox={() => undefined}
        onEnqueueBackgroundTask={() => undefined}
      />,
    );

    expect(screen.queryByRole('combobox', { name: '选择 Projects/日本語 的本地文件夹' })).toBeNull();
    expect(screen.getByRole('button', { name: /创建并同步/ })).not.toBeNull();
    expect(screen.getByText('需要同步的目录可直接创建对应的本地文件夹。')).not.toBeNull();
  });

  it('maps, creates, and refreshes through the existing callbacks', () => {
    const {
      onMapImapMailbox,
      onCreateAndMapImapMailbox,
      onEnqueueBackgroundTask,
    } = renderSettings();

    fireEvent.click(screen.getByRole('combobox', { name: '选择 Projects/日本語 的本地文件夹' }));
    fireEvent.click(screen.getByRole('option', { name: '客户项目' }));
    expect(onMapImapMailbox).toHaveBeenCalledWith(mailboxes[2], 41);

    fireEvent.click(screen.getByRole('button', { name: /创建并同步/ }));
    expect(onCreateAndMapImapMailbox).toHaveBeenCalledWith(mailboxes[2]);

    fireEvent.click(screen.getByRole('button', { name: /同步邮件/ }));
    expect(onEnqueueBackgroundTask).toHaveBeenCalledWith('sync', 'manual');
  });
});
