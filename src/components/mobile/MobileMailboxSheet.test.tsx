import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { Account, Folder } from '../../app/types';
import MobileMailboxSheet from './MobileMailboxSheet';

afterEach(cleanup);

const account: Account = {
  id: 2,
  email: 'design@example.com',
  display_name: '设计邮箱',
  provider: 'mock',
  imap_host: '',
  smtp_host: '',
  incoming_protocol: 'imap',
  auth_type: 'password',
  sync_mode: 'manual',
  remote_images_allowed: false,
  signature: '',
  cross_account_risk_warning: true,
  block_external_mailboxes: false,
  intercept_https_links: false,
  auto_download_attachments: false,
  warn_external_senders: true,
  onboarding_completed: true,
  is_default: false,
};

const folder: Folder = {
  id: 10,
  account_id: account.id,
  name: '收件箱',
  role: 'inbox',
  unread_count: 2,
  is_virtual: false,
};

function renderSheet(overrides: Partial<ComponentProps<typeof MobileMailboxSheet>> = {}) {
  return render(
    <MobileMailboxSheet
      accountScope="all"
      accounts={[account]}
      folders={[folder]}
      folderId={folder.id}
      onClose={vi.fn()}
      onAccountScopeChange={vi.fn()}
      onSelectFolder={vi.fn()}
      onCompose={vi.fn()}
      onOpenSettings={vi.fn()}
      {...overrides}
    />,
  );
}

describe('MobileMailboxSheet', () => {
  it('changes account scope without changing the default sender account', () => {
    const onAccountScopeChange = vi.fn();
    const onClose = vi.fn();
    renderSheet({ onAccountScopeChange, onClose });

    fireEvent.click(screen.getByRole('button', { name: /设计邮箱\s*design@example.com/ }));

    expect(onAccountScopeChange).toHaveBeenCalledWith('2');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes the mailbox sheet before opening a new compose window', () => {
    const onClose = vi.fn();
    const onCompose = vi.fn();
    renderSheet({ onClose, onCompose });

    fireEvent.click(screen.getByRole('button', { name: '写邮件' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCompose).toHaveBeenCalledTimes(1);
    expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(onCompose.mock.invocationCallOrder[0]);
  });
});
