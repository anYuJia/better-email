import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import type { Account } from '../app/types';
import useGlobalAccountPreferences from './useGlobalAccountPreferences';

vi.mock('../tauriBridge', () => ({ invoke: vi.fn() }));

import { invoke } from '../tauriBridge';

const mockInvoke = vi.mocked(invoke);

function account(id: number, overrides: Partial<Account> = {}): Account {
  return {
    id,
    email: `account-${id}@example.com`,
    display_name: `账号 ${id}`,
    provider: 'custom',
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
    is_default: id === 1,
    ...overrides,
  };
}

function useHarness() {
  const [accounts, setAccounts] = useState([
    account(1),
    account(2, { cross_account_risk_warning: false }),
  ]);
  const [activeAccount, setActiveAccount] = useState<Account | null>(accounts[0]);
  const [accountForm, setAccountForm] = useState<Account | null>({
    ...accounts[0],
    display_name: '尚未保存的名称',
  });
  const [status, setStatus] = useState('');
  const preferences = useGlobalAccountPreferences({
    accounts,
    setAccount: setActiveAccount,
    setAccountForm,
    setAccounts,
    setStatus,
  });
  return { accounts, activeAccount, accountForm, status, ...preferences };
}

describe('useGlobalAccountPreferences', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(((_command: string, args?: { input?: Account }) => (
      Promise.resolve(args?.input)
    )) as never);
  });

  it('applies a global preference to every account without losing an unsaved account draft', async () => {
    const { result } = renderHook(() => useHarness());
    expect(result.current.globalCrossAccountRiskWarning).toBe(false);

    act(() => result.current.onGlobalCrossAccountRiskWarningChange(true));

    await waitFor(() => expect(result.current.globalAccountPreferenceBusy).toBe(false));
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(result.current.accounts.every((item) => item.cross_account_risk_warning)).toBe(true);
    expect(result.current.activeAccount?.cross_account_risk_warning).toBe(true);
    expect(result.current.accountForm?.cross_account_risk_warning).toBe(true);
    expect(result.current.accountForm?.display_name).toBe('尚未保存的名称');
    expect(result.current.status).toBe('已开启跨邮箱发送提醒');
  });

  it('controls attachment auto-download as one application-wide policy', async () => {
    const { result } = renderHook(() => useHarness());
    expect(result.current.globalAutoDownloadAttachments).toBe(false);

    act(() => result.current.onGlobalAutoDownloadAttachmentsChange(true));

    await waitFor(() => expect(result.current.globalAutoDownloadAttachments).toBe(true));
    expect(result.current.accounts.every((item) => item.auto_download_attachments)).toBe(true);
    expect(result.current.status).toBe('已为所有账号开启附件自动下载');
  });
});
