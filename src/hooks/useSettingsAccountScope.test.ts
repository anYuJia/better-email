import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import type { Account, AccountScope } from '../app/types';
import {
  SETTINGS_ACCOUNT_SCOPE_EVENT,
  SETTINGS_ACCOUNTS_UPDATED_EVENT,
} from '../app/settingsWindow';

const mocks = vi.hoisted(() => ({
  emitToMain: vi.fn(() => Promise.resolve()),
  listen: vi.fn(),
  syncSettingsWindowAccountScope: vi.fn(() => Promise.resolve()),
}));

vi.mock('../tauriBridge', () => mocks);

import useSettingsAccountScope from './useSettingsAccountScope';

function makeAccount(id: number): Account {
  return {
    id,
    email: `${id}@example.com`,
    display_name: `账号 ${id}`,
  } as Account;
}

describe('useSettingsAccountScope', () => {
  const accounts = [makeAccount(1), makeAccount(2)];
  let incomingScopeHandler: ((event: { payload?: { scope?: AccountScope } }) => void) | undefined;
  let incomingAccountsHandler: ((event: { payload?: { accounts?: Account[] } }) => void) | undefined;

  beforeEach(() => {
    incomingScopeHandler = undefined;
    incomingAccountsHandler = undefined;
    vi.clearAllMocks();
    mocks.listen.mockImplementation(async (
      _event: string,
      handler: (event: { payload?: { scope?: AccountScope; accounts?: Account[] } }) => void,
    ) => {
      if (_event === SETTINGS_ACCOUNT_SCOPE_EVENT) incomingScopeHandler = handler;
      else incomingAccountsHandler = handler;
      return () => {
        incomingScopeHandler = undefined;
        incomingAccountsHandler = undefined;
      };
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function renderScope(overrides: Partial<Parameters<typeof useSettingsAccountScope>[0]> = {}) {
    const changeAccountScope = vi.fn();
    const selectSettingsAccount = vi.fn();
    const onSettingsScopeChange = vi.fn();
    const showNarrowList = vi.fn();
    const setAccount = vi.fn();
    const setAccounts = vi.fn();
    const setAccountForm = vi.fn();
    const options = {
      accountScope: 'all' as AccountScope,
      accounts,
      requestedAccountScope: undefined,
      accountsLoaded: false,
      standaloneSettingsWindow: false,
      useNativeSettingsWindow: false,
      onSettingsScopeChange,
      setAccount,
      setAccounts,
      setAccountForm,
      changeAccountScope,
      selectSettingsAccount,
      showNarrowList,
      ...overrides,
    };
    return {
      ...renderHook(() => useSettingsAccountScope(options)),
      changeAccountScope,
      selectSettingsAccount,
      onSettingsScopeChange,
      showNarrowList,
      setAccount,
      setAccounts,
      setAccountForm,
    };
  }

  it('uses the same concrete account selection for settings and mailbox scope', () => {
    const scope = renderScope({ standaloneSettingsWindow: true });

    act(() => scope.result.current.handleSettingsAccountScopeChange('2'));

    expect(scope.changeAccountScope).toHaveBeenCalledWith('2');
    expect(scope.selectSettingsAccount).toHaveBeenCalledWith(accounts[1]);
    expect(scope.onSettingsScopeChange).toHaveBeenCalledWith(2);
    expect(mocks.emitToMain).toHaveBeenCalledWith(SETTINGS_ACCOUNT_SCOPE_EVENT, { scope: 2 });
  });

  it('does not reapply the initial standalone scope after a user selects an account', async () => {
    const selectSettingsAccount = vi.fn();
    const { result } = renderHook(() => {
      const [accountScope, setAccountScope] = useState<AccountScope>('all');
      const [requestedScope, setRequestedScope] = useState<AccountScope>('all');
      const changeAccountScope = (value: string) => {
        setAccountScope(value === 'all' ? 'all' : Number(value));
      };

      const scope = useSettingsAccountScope({
        accountScope,
        accounts,
        requestedAccountScope: requestedScope,
        accountsLoaded: true,
        standaloneSettingsWindow: true,
        useNativeSettingsWindow: false,
        onSettingsScopeChange: setRequestedScope,
        setAccount: vi.fn(),
        setAccounts: vi.fn(),
        setAccountForm: vi.fn(),
        changeAccountScope,
        selectSettingsAccount,
        showNarrowList: vi.fn(),
      });

      return { ...scope, accountScope, requestedScope };
    });

    act(() => result.current.handleSettingsAccountScopeChange('2'));

    await waitFor(() => expect(result.current.accountScope).toBe(2));
    expect(result.current.requestedScope).toBe(2);
    expect(selectSettingsAccount).toHaveBeenCalledWith(accounts[1]);
  });

  it('forwards mailbox scope changes to an open native settings window', () => {
    const scope = renderScope({ useNativeSettingsWindow: true });

    act(() => scope.result.current.handleMailboxAccountScopeChange('2'));

    expect(scope.showNarrowList).toHaveBeenCalledOnce();
    expect(scope.changeAccountScope).toHaveBeenCalledWith('2');
    expect(mocks.syncSettingsWindowAccountScope).toHaveBeenCalledWith(2);
  });

  it('accepts scope changes sent from a standalone settings window', async () => {
    const scope = renderScope();
    await waitFor(() => expect(incomingScopeHandler).toBeTypeOf('function'));

    act(() => incomingScopeHandler?.({ payload: { scope: 2 } }));

    expect(scope.changeAccountScope).toHaveBeenCalledWith('2');
  });

  it('publishes account list changes and applies them in the mailbox window', async () => {
    const standalone = renderScope({
      accountsLoaded: true,
      standaloneSettingsWindow: true,
    });
    await waitFor(() => expect(mocks.emitToMain).toHaveBeenCalledWith(
      SETTINGS_ACCOUNTS_UPDATED_EVENT,
      { accounts },
    ));

    const mailbox = renderScope();
    await waitFor(() => expect(incomingAccountsHandler).toBeTypeOf('function'));
    const updatedAccounts = [makeAccount(1)];
    act(() => incomingAccountsHandler?.({ payload: { accounts: updatedAccounts } }));

    expect(mailbox.setAccounts).toHaveBeenCalledWith(updatedAccounts);
    expect(standalone.setAccounts).not.toHaveBeenCalled();
  });
});
