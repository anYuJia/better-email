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
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /效率工具/ }).disabled).toBe(true);
    const disabledRows = Array.from(document.querySelectorAll<HTMLButtonElement>('.mobile-settings-row:disabled'));
    expect(disabledRows.length).toBeGreaterThan(0);
  });

  it('searches settings destinations and preserves the selected detail target', () => {
    const onOpenSection = vi.fn();
    render(
      <MobileSettingsRoot
        account={account}
        accounts={[account]}
        accountScope={account.id}
        onBack={vi.fn()}
        onOpenSection={onOpenSection}
      />,
    );

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索设置' }), { target: { value: '撤销发送' } });
    fireEvent.click(screen.getByRole('button', { name: /撤销发送/ }));

    expect(onOpenSection).toHaveBeenCalledWith('general', expect.objectContaining({
      label: '撤销发送',
      section: 'general',
      target: 'sending',
    }));
  });

  it('labels the account summary with the same all-account scope used by settings', () => {
    render(
      <MobileSettingsRoot
        account={account}
        accounts={[account]}
        accountScope="all"
        onBack={vi.fn()}
        onOpenSection={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '打开账号设置' }).textContent).toContain('所有邮箱账号');
    expect(screen.getByRole('button', { name: '打开账号设置' }).textContent).toContain('1 个邮箱账号');
  });
});
