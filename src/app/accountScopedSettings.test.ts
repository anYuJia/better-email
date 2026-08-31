import { describe, expect, it, vi } from 'vitest';
import type { Account } from './types';
import {
  accountSettingValue,
  accountWithChangedSettings,
  applyAccountScopedSettings,
  MIXED_ACCOUNT_SETTING_VALUE,
} from './accountScopedSettings';

function account(id: number, overrides: Partial<Account> = {}): Account {
  return {
    id,
    email: `${id}@example.com`,
    display_name: `账号 ${id}`,
    provider: 'custom',
    imap_host: 'imap.example.com',
    smtp_host: 'smtp.example.com',
    incoming_protocol: 'imap',
    auth_type: 'password',
    sync_mode: '10min',
    remote_images_allowed: false,
    signature: '',
    cross_account_risk_warning: true,
    block_external_mailboxes: false,
    intercept_https_links: true,
    auto_download_attachments: false,
    warn_external_senders: false,
    onboarding_completed: true,
    is_default: id === 1,
    ...overrides,
  };
}

describe('account scoped settings', () => {
  it('does not write untouched fields back to any account', async () => {
    const accounts = [account(1, { sync_mode: '10min' }), account(2, { sync_mode: '5min' })];
    const updateAccount = vi.fn(async (_account: Account, input: Account) => input);
    const result = await applyAccountScopedSettings({
      accounts,
      patch: { sync_mode: '15min' },
      changedFields: [],
      updateAccount,
    });

    expect(updateAccount).not.toHaveBeenCalled();
    expect(result.updated).toEqual([]);
    expect(accounts.map((item) => item.sync_mode)).toEqual(['10min', '5min']);
  });

  it('applies only the edited field to every account using each account as its baseline', async () => {
    const accounts = [
      account(1, { sync_mode: '10min', display_name: 'A' }),
      account(2, { sync_mode: '5min', display_name: 'B' }),
    ];
    const updateAccount = vi.fn(async (_account: Account, input: Account) => input);

    await applyAccountScopedSettings({
      accounts,
      patch: { sync_mode: '15min' },
      changedFields: ['sync_mode'],
      updateAccount,
    });

    expect(updateAccount).toHaveBeenCalledTimes(2);
    expect(updateAccount.mock.calls.map(([, input]) => [input.sync_mode, input.display_name])).toEqual([
      ['15min', 'A'],
      ['15min', 'B'],
    ]);
  });

  it('keeps a later single-account edit and later unified edit independent', async () => {
    const accounts = [account(1, { sync_mode: '15min' }), account(2, { sync_mode: '15min' })];
    const single = accountWithChangedSettings(accounts[1], { sync_mode: '5min' }, ['sync_mode']);
    const nextAccounts = [accounts[0], single];
    const updateAccount = vi.fn(async (_account: Account, input: Account) => input);

    await applyAccountScopedSettings({
      accounts: nextAccounts,
      patch: { remote_images_allowed: true },
      changedFields: ['remote_images_allowed'],
      updateAccount,
    });
    expect(updateAccount.mock.calls.map(([, input]) => [input.sync_mode, input.remote_images_allowed])).toEqual([
      ['15min', true],
      ['5min', true],
    ]);

    updateAccount.mockClear();
    await applyAccountScopedSettings({
      accounts: nextAccounts,
      patch: { sync_mode: '20min' },
      changedFields: ['sync_mode'],
      updateAccount,
    });
    expect(updateAccount.mock.calls.map(([, input]) => input.sync_mode)).toEqual(['20min', '20min']);
  });

  it('exposes a mixed value and isolates unsupported account updates', async () => {
    const accounts = [account(1, { sync_mode: '10min' }), account(2, { sync_mode: '5min' })];
    expect(accountSettingValue(accounts, 'sync_mode')).toBe(MIXED_ACCOUNT_SETTING_VALUE);
    const updateAccount = vi.fn(async (_account: Account, input: Account) => input);

    const result = await applyAccountScopedSettings({
      accounts,
      patch: { sync_mode: '15min' },
      changedFields: ['sync_mode'],
      isSettingSupported: (candidate) => candidate.id !== 2,
      updateAccount,
    });

    expect(updateAccount).toHaveBeenCalledTimes(1);
    expect(result.updated.map((item) => item.id)).toEqual([1]);
    expect(result.failed).toEqual([]);
    expect(result.skipped.map((item) => item.account.id)).toEqual([2]);
  });
});
