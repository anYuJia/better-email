import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Account } from '../../app/types';
import MobileSettingsRoot from './MobileSettingsRoot';

afterEach(cleanup);

const account: Account = {
  id: 7,
  email: 'mobile@example.com',
  display_name: '移动邮箱',
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
  is_default: true,
};

describe('MobileSettingsRoot', () => {
  it('uses the account summary as the push entry for account settings', () => {
    const onOpenSection = vi.fn();

    render(
      <MobileSettingsRoot
        account={account}
        accounts={[account]}
        onBack={vi.fn()}
        onOpenSection={onOpenSection}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '打开账号设置' }));

    expect(onOpenSection).toHaveBeenCalledWith('accounts');
  });

  it('keeps account-scoped destinations disabled until an account exists', () => {
    render(
      <MobileSettingsRoot
        account={null}
        accounts={[]}
        onBack={vi.fn()}
        onOpenSection={vi.fn()}
      />,
    );

    expect(screen.getByRole<HTMLButtonElement>('button', { name: '打开账号设置' }).disabled).toBe(false);
    const disabledRows = Array.from(document.querySelectorAll<HTMLButtonElement>('.mobile-settings-row:disabled'));
    expect(disabledRows.length).toBeGreaterThan(0);
  });
});
