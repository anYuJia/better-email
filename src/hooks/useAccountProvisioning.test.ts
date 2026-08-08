import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import useAccountProvisioning from './useAccountProvisioning';
import type { Account, AccountCreateInput, FilterMode } from '../app/types';
import { emptyAccountCreateForm } from '../app/uiConfig';
import { invoke } from '../tauriBridge';

vi.mock('../tauriBridge', () => ({
  invoke: vi.fn(),
}));

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 1,
    email: 'demo@better-email.local',
    display_name: 'Demo',
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
    is_default: true,
    ...overrides,
  };
}

function renderRemovalHook(account: Account, accounts: Account[]) {
  const setters = {
    setAccount: vi.fn(),
    setAccounts: vi.fn(),
    setAccountScope: vi.fn(),
    setAccountForm: vi.fn(),
    setNewAccountForm: vi.fn(),
    setFolderId: vi.fn(),
    setFolders: vi.fn(),
    setMessages: vi.fn(),
    setSelectedId: vi.fn(),
    setAttachments: vi.fn(),
    setSettingsOpen: vi.fn(),
    setCredentialStatus: vi.fn(),
    setCredentialVerification: vi.fn(),
    setSyncRuns: vi.fn(),
    setStatus: vi.fn(),
  };
  const loadMeta = vi.fn().mockResolvedValue({ folderId: 9, folders: [{ id: 9 }] });
  const loadMessages = vi.fn().mockResolvedValue([]);
  const utils = renderHook(() => useAccountProvisioning({
    accounts,
    accountForm: account,
    newAccountForm: emptyAccountCreateForm,
    query: '',
    filter: 'all' as FilterMode,
    ...setters,
    loadMeta,
    loadMessages,
  }));
  return { utils, setters, loadMeta, loadMessages };
}

function renderCreationHook(
  newAccountForm: AccountCreateInput,
  loadMeta = vi.fn().mockResolvedValue({ folderId: 9, folders: [{ id: 9 }] }),
) {
  const setters = {
    setAccount: vi.fn(),
    setAccounts: vi.fn(),
    setAccountScope: vi.fn(),
    setAccountForm: vi.fn(),
    setNewAccountForm: vi.fn(),
    setFolderId: vi.fn(),
    setFolders: vi.fn(),
    setMessages: vi.fn(),
    setSelectedId: vi.fn(),
    setAttachments: vi.fn(),
    setSettingsOpen: vi.fn(),
    setCredentialStatus: vi.fn(),
    setCredentialVerification: vi.fn(),
    setSyncRuns: vi.fn(),
    setStatus: vi.fn(),
  };
  const loadMessages = vi.fn().mockResolvedValue([]);
  const utils = renderHook(() => useAccountProvisioning({
    accounts: [],
    accountForm: null,
    newAccountForm,
    query: '',
    filter: 'all' as FilterMode,
    ...setters,
    loadMeta,
    loadMessages,
  }));
  return { utils, setters, loadMessages };
}

describe('useAccountProvisioning removeCurrentAccount', () => {
  const demo = makeAccount({ id: 1, email: 'demo@better-email.local', is_default: true });
  const design = makeAccount({
    id: 2,
    email: 'design@better-email.local',
    display_name: 'Design',
    is_default: false,
  });

  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('deletes the account and its credentials through one atomic remove_account call', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(design);
    const { utils, setters, loadMeta, loadMessages } = renderRemovalHook(demo, [demo, design]);

    await act(() => utils.result.current.removeCurrentAccount(true));

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('remove_account', {
      accountId: 1,
      deleteCredentials: true,
    });
    expect(setters.setAccounts).toHaveBeenCalledWith(expect.any(Function));
    expect(setters.setAccount).toHaveBeenCalledWith(design);
    expect(setters.setAccountForm).toHaveBeenCalledWith(design);
    expect(setters.setAccountScope).toHaveBeenCalledWith(design.id);
    expect(setters.setCredentialStatus).toHaveBeenCalledWith(expect.objectContaining({
      status: 'deleted',
      exists: false,
    }));
    expect(loadMeta).toHaveBeenCalledWith(null, design.id);
    expect(loadMessages).toHaveBeenCalledWith(9, '', 'all', design.id, undefined, undefined, 'account');
    expect(setters.setSettingsOpen).toHaveBeenCalledWith(false);
    expect(setters.setStatus).toHaveBeenCalledWith('已移除 demo@better-email.local，当前切换到 design@better-email.local');
  });

  it('keeps local credentials when deleteSecret is false', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(design);
    const { utils, setters } = renderRemovalHook(demo, [demo, design]);

    await act(() => utils.result.current.removeCurrentAccount(false));

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('remove_account', {
      accountId: 1,
      deleteCredentials: false,
    });
    expect(setters.setCredentialStatus).toHaveBeenCalledWith(expect.objectContaining({
      status: 'exists',
      exists: true,
    }));
    expect(setters.setStatus).toHaveBeenCalledWith('已移除 demo@better-email.local，当前切换到 design@better-email.local');
  });

  it('removes an account even when it had no stored credentials', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(design);
    const { utils, setters } = renderRemovalHook(demo, [demo, design]);

    await act(() => utils.result.current.removeCurrentAccount(true));

    expect(setters.setAccounts).toHaveBeenCalled();
    expect(setters.setAccount).toHaveBeenCalledWith(design);
    expect(setters.setStatus).toHaveBeenCalledWith('已移除 demo@better-email.local，当前切换到 design@better-email.local');
  });

  it('does not mutate any state when the atomic removal fails and formats the error message', async () => {
    vi.mocked(invoke).mockRejectedValueOnce('Error: 本地数据库写入拒绝，删除凭据失败。');
    const { utils, setters, loadMeta, loadMessages } = renderRemovalHook(demo, [demo, design]);

    await expect(act(() => utils.result.current.removeCurrentAccount(true))).rejects.toBeTruthy();

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(setters.setAccounts).not.toHaveBeenCalled();
    expect(setters.setAccount).not.toHaveBeenCalled();
    expect(setters.setAccountForm).not.toHaveBeenCalled();
    expect(setters.setAccountScope).not.toHaveBeenCalled();
    expect(setters.setCredentialStatus).not.toHaveBeenCalled();
    expect(loadMeta).not.toHaveBeenCalled();
    expect(loadMessages).not.toHaveBeenCalled();
    expect(setters.setStatus).toHaveBeenCalledWith('账号移除失败：本地数据库写入拒绝，删除凭据失败。');
  });

  it('switches to the next account and reloads its metadata after removal', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(design);
    const { utils, setters, loadMeta, loadMessages } = renderRemovalHook(demo, [demo, design]);

    await act(() => utils.result.current.removeCurrentAccount(true));

    expect(loadMeta).toHaveBeenCalledWith(null, design.id);
    expect(loadMessages).toHaveBeenCalled();
    expect(setters.setFolderId).toHaveBeenCalledWith(null);
    expect(setters.setMessages).toHaveBeenCalledWith([]);
    expect(setters.setSelectedId).toHaveBeenCalledWith(null);
    expect(setters.setAttachments).toHaveBeenCalledWith([]);
    expect(setters.setSettingsOpen).toHaveBeenCalledWith(false);
  });

  it('keeps the settings open and reports an empty state when the last account is removed', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(null);
    const { utils, setters, loadMeta, loadMessages } = renderRemovalHook(demo, [demo]);

    await act(() => utils.result.current.removeCurrentAccount(true));

    expect(invoke).toHaveBeenCalledWith('remove_account', {
      accountId: 1,
      deleteCredentials: true,
    });
    expect(setters.setAccount).toHaveBeenCalledWith(null);
    expect(setters.setAccountForm).toHaveBeenCalledWith(null);
    expect(setters.setAccountScope).toHaveBeenCalledWith('all');
    expect(loadMeta).toHaveBeenCalledWith(null, 'all');
    expect(loadMessages).not.toHaveBeenCalled();
    expect(setters.setSettingsOpen).toHaveBeenCalledWith(true);
    expect(setters.setStatus).toHaveBeenCalledWith('已移除 demo@better-email.local，当前没有邮箱账号');
  });

  it('does nothing when no account is currently selected', async () => {
    const { utils, setters } = renderRemovalHook(null as unknown as Account, [demo]);

    await act(() => utils.result.current.removeCurrentAccount(true));

    expect(invoke).not.toHaveBeenCalled();
    expect(setters.setStatus).not.toHaveBeenCalled();
  });
});

describe('useAccountProvisioning createNewAccount', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('keeps a successfully verified account when the initial mailbox load fails', async () => {
    vi.useFakeTimers();
    const created = makeAccount({ id: 7, email: 'ada@qq.com' });
    const newAccountForm: AccountCreateInput = {
      ...emptyAccountCreateForm,
      email: created.email,
      display_name: 'Ada',
      provider: 'qq',
      imap_host: 'imap.qq.com:993',
      smtp_host: 'smtp.qq.com:587',
      incoming_protocol: 'imap',
      auth_type: 'password',
    };
    vi.mocked(invoke).mockImplementation(((command: string) => {
      switch (command) {
        case 'create_account':
          return Promise.resolve(created);
        case 'store_account_secret':
          return Promise.resolve({ exists: true, status: 'stored', message: 'saved' });
        case 'verify_account_credentials_with_secret':
          return Promise.resolve({ authenticated: true, status: 'ok', message: 'verified' });
        case 'sync_imap_headers':
          return Promise.resolve({ status: 'ok', scanned_folders: 1, imported_messages: 0 });
        default:
          return Promise.reject(new Error(`unexpected invoke: ${String(command)}`));
      }
    }) as never);
    const { utils, setters, loadMessages } = renderCreationHook(
      newAccountForm,
      vi.fn().mockRejectedValue(new Error('metadata unavailable')),
    );

    let result: Account | void = undefined;
    await act(async () => {
      const pending = utils.result.current.createNewAccount('mail-code');
      await vi.runAllTimersAsync();
      result = await pending;
    });

    expect(result).toEqual(created);
    expect(setters.setAccount).toHaveBeenCalledWith(created);
    expect(setters.setAccounts).toHaveBeenCalledWith(expect.any(Function));
    expect(loadMessages).not.toHaveBeenCalled();
    expect(setters.setStatus).toHaveBeenCalledWith(
      '邮箱账号已创建并完成登录验证，但初始数据加载失败：metadata unavailable',
    );
  });
});
