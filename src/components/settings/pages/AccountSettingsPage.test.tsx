import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Account, AccountCreateInput } from '../../../app/types';
import AccountSettingsPage from './AccountSettingsPage';

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 1,
    email: 'work@example.com',
    display_name: '工作邮箱',
    provider: 'qq',
    imap_host: 'imap.qq.com:993',
    smtp_host: 'smtp.qq.com:587',
    incoming_protocol: 'imap',
    auth_type: 'password',
    sync_mode: '1min',
    remote_images_allowed: false,
    signature: '',
    cross_account_risk_warning: true,
    block_external_mailboxes: false,
    intercept_https_links: true,
    auto_download_attachments: false,
    warn_external_senders: false,
    onboarding_completed: true,
    is_default: true,
    ...overrides,
  };
}

const emptyNewAccount: AccountCreateInput = {
  email: '',
  display_name: '',
  provider: 'custom',
  imap_host: '',
  smtp_host: '',
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
};

const accounts = [
  makeAccount(),
  makeAccount({
    id: 2,
    email: 'personal@example.com',
    display_name: '个人邮箱',
    provider: 'icloud',
    is_default: false,
  }),
];

function renderPage({
  accountForm = accounts[0],
  accountSwitchDisabled = false,
  onAccountFormChange = vi.fn(),
  onSelectAccount = vi.fn(),
}: {
  accountForm?: Account | null;
  accountSwitchDisabled?: boolean;
  onAccountFormChange?: (account: Account) => void;
  onSelectAccount?: (account: Account) => void;
} = {}) {
  const result = render(
    <AccountSettingsPage
      accounts={accounts}
      accountForm={accountForm}
      accountCount={accounts.length}
      accountSwitchDisabled={accountSwitchDisabled}
      newAccountForm={emptyNewAccount}
      onAccountFormChange={onAccountFormChange}
      onSelectAccount={onSelectAccount}
      onNewAccountFormChange={() => undefined}
      onApplyNewAccountPreset={() => undefined}
      onCreateNewAccount={async () => undefined}
      onRemoveAccount={async () => undefined}
      onSaveAccountSettings={async () => undefined}
      onNavigate={() => undefined}
    />,
  );
  return { ...result, onAccountFormChange, onSelectAccount };
}

describe('AccountSettingsPage account-first layout', () => {
  afterEach(cleanup);

  it('makes the selected account the explicit owner of the visible settings', () => {
    const { container } = renderPage();
    const accountStack = container.querySelector('.settings-account-stack');
    const accountOverview = container.querySelector('[data-settings-section="account-overview"]');

    expect(accountStack).not.toBeNull();
    expect(container.querySelector('.settings-account-workspace')).toBeNull();
    expect(container.querySelector('[data-current-account-id="1"]')).not.toBeNull();
    expect(accountOverview).not.toBeNull();
    expect(within(accountOverview as HTMLElement).getByText('工作邮箱')).not.toBeNull();
    expect(
      within(accountOverview as HTMLElement).getByText(
        'work@example.com · QQ 邮箱 · 默认发件账号',
      ),
    ).not.toBeNull();
    expect(
      within(accountOverview as HTMLElement).getByRole('textbox', { name: /显示名/ }),
    ).not.toBeNull();
    expect(within(accountOverview as HTMLElement).queryByText('跨邮箱发送风险提示')).toBeNull();
    expect(within(accountOverview as HTMLElement).queryByText('自动下载新邮件附件')).toBeNull();
  });

  it('selects another account from the mobile account list', () => {
    const onSelectAccount = vi.fn();
    renderPage({ onSelectAccount });

    const accountList = screen.getByRole('list', { name: '邮箱账号' });
    fireEvent.click(within(accountList).getByRole('button', { name: /个人邮箱/ }));
    expect(onSelectAccount).toHaveBeenCalledWith(accounts[1]);
  });

  it('moves account removal into the selected account detail and disables it while dirty', () => {
    const { container } = renderPage({ accountSwitchDisabled: true });

    expect(container.querySelector('.settings-account-row-actions')).toBeNull();
    expect((screen.getByRole('button', { name: /移除账号/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
