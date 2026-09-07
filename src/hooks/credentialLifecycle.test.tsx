import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { Account, CredentialStatus, CredentialVerificationReport } from '../app/types';
import { emptyAccountCreateForm } from '../app/uiConfig';
import { invoke, listen, openSettingsWindow } from '../tauriBridge';
import { CREDENTIALS_CHANGED_EVENT } from '../app/credentialEvents';
import useCredentialManagement from './useCredentialManagement';
import useAccountCredentialHealth from './useAccountCredentialHealth';
import useAccountSaveVerify from './useAccountSaveVerify';
import useOAuthFlow from './useOAuthFlow';
import AccountLoginRecovery from '../components/AccountLoginRecovery';

vi.mock('../tauriBridge', () => ({ invoke: vi.fn(), listen: vi.fn(), emitToMain: vi.fn(), openSettingsWindow: vi.fn() }));

function account(id: number, oauth = false): Account {
  return { ...emptyAccountCreateForm, id, email: `account${id}@example.com`, provider: oauth ? 'gmail' : 'custom',
    auth_type: oauth ? 'oauth2' : 'password', onboarding_completed: true, is_default: id === 1 };
}
function health(target: Account, exists = true): CredentialStatus {
  return { account_email: target.email, exists, status: exists ? 'exists' : 'not_found', message: exists ? '本机可读取' : '本机未保存登录凭据' };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function management(target: Account | null = account(1)) {
  const options = { credentialStatus: null, setCredentialStatus: vi.fn(), setCredentialVerification: vi.fn(), setStatus: vi.fn(),
    verifyAccountCredentials: vi.fn().mockResolvedValue({ authenticated: true } as CredentialVerificationReport) };
  const hook = renderHook(({ selected }) => useCredentialManagement({ ...options, account: selected }), { initialProps: { selected: target } });
  return { ...hook, options };
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(listen).mockResolvedValue(vi.fn());
  vi.mocked(openSettingsWindow).mockResolvedValue();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('credential save lifecycle', () => {
  it('does not save for an unselected account or blank input', async () => {
    const hook = management(null);
    await act(() => hook.result.current.storeAndVerifyCredential());
    hook.rerender({ selected: account(1) });
    await act(() => hook.result.current.storeAndVerifyCredential());
    expect(invoke).not.toHaveBeenCalled();
  });
  it('preserves input on a rejected save and never verifies it', async () => {
    const hook = management();
    act(() => hook.result.current.setCredentialSecret('entered-code'));
    vi.mocked(invoke).mockResolvedValue({ ...health(account(1), false), status: 'invalid_input' });
    await act(() => hook.result.current.storeAndVerifyCredential());
    expect(hook.result.current.credentialSecret).toBe('entered-code');
    expect(hook.options.verifyAccountCredentials).not.toHaveBeenCalled();
  });
  it('preserves input after an IPC write failure', async () => {
    const hook = management();
    act(() => hook.result.current.setCredentialSecret('entered-code'));
    vi.mocked(invoke).mockRejectedValue(new Error('disk failure'));
    await act(async () => { await expect(hook.result.current.storeCredential()).rejects.toThrow('disk failure'); });
    expect(hook.result.current.credentialSecret).toBe('entered-code');
    expect(hook.result.current.credentialBusy).toBe(false);
  });
  it('coalesces same-tick submissions and verifies only after bound persistence succeeds', async () => {
    const hook = management();
    const wait = deferred<CredentialStatus>();
    vi.mocked(invoke).mockReturnValue(wait.promise);
    act(() => hook.result.current.setCredentialSecret('entered-code'));
    let first!: ReturnType<typeof hook.result.current.storeAndVerifyCredential>;
    act(() => {
      first = hook.result.current.storeAndVerifyCredential();
      expect(hook.result.current.storeAndVerifyCredential()).toBe(first);
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('store_account_secret', {
      accountId: 1, authType: 'password', input: { account_email: account(1).email, secret: 'entered-code' },
    });
    expect(hook.options.verifyAccountCredentials).not.toHaveBeenCalled();
    await act(async () => { wait.resolve(health(account(1))); await first; });
    expect(hook.options.verifyAccountCredentials).toHaveBeenCalledTimes(1);
    expect(hook.result.current.credentialSecret).toBe('');
  });
  it('does not clear input edited during an outstanding save', async () => {
    const hook = management();
    const wait = deferred<CredentialStatus>();
    vi.mocked(invoke).mockReturnValue(wait.promise);
    act(() => hook.result.current.setCredentialSecret('old'));
    let promise!: ReturnType<typeof hook.result.current.storeCredential>;
    act(() => { promise = hook.result.current.storeCredential(); });
    act(() => hook.result.current.setCredentialSecret('new'));
    await act(async () => { wait.resolve(health(account(1))); await promise; });
    expect(hook.result.current.credentialSecret).toBe('new');
  });
  it('does not show account A save success or launch verification in account B', async () => {
    const hook = management();
    const wait = deferred<CredentialStatus>();
    vi.mocked(invoke).mockReturnValue(wait.promise);
    act(() => hook.result.current.setCredentialSecret('A'));
    let promise!: ReturnType<typeof hook.result.current.storeCredential>;
    act(() => { promise = hook.result.current.storeAndVerifyCredential(); });
    hook.rerender({ selected: account(2) });
    act(() => hook.result.current.setCredentialSecret('B'));
    hook.options.setStatus.mockClear();
    await act(async () => { wait.resolve(health(account(1))); await promise; });
    expect(hook.result.current.credentialSecret).toBe('B');
    expect(hook.options.setCredentialStatus).not.toHaveBeenCalled();
    expect(hook.options.verifyAccountCredentials).not.toHaveBeenCalled();
    expect(hook.options.setStatus).not.toHaveBeenCalled();
  });
  it('consumes stale failures so outer UI error handlers cannot overwrite another account', async () => {
    const hook = management();
    const wait = deferred<CredentialStatus>();
    vi.mocked(invoke).mockReturnValue(wait.promise);
    act(() => hook.result.current.setCredentialSecret('A'));
    let promise!: ReturnType<typeof hook.result.current.storeCredential>;
    act(() => { promise = hook.result.current.storeCredential(); });
    hook.rerender({ selected: account(2) });
    await act(async () => { wait.reject(new Error('old failure')); expect(await promise).toBeNull(); });
    expect(hook.options.setStatus).not.toHaveBeenCalled();
  });
});

describe('read-only credential health', () => {
  it('ignores stale status and reruns after credentials change during a query', async () => {
    const first = deferred<CredentialStatus[]>();
    vi.mocked(invoke).mockReturnValueOnce(first.promise).mockResolvedValue([health(account(1))]);
    const hook = renderHook(() => useAccountCredentialHealth([account(1)]));
    act(() => window.dispatchEvent(new Event(CREDENTIALS_CHANGED_EVENT)));
    await act(async () => { first.resolve([health(account(1), false)]); });
    await waitFor(() => expect(hook.result.current.statuses).toEqual([health(account(1))]));
    expect(invoke).toHaveBeenCalledTimes(2);
  });
  it('reports a query failure separately from a missing credential', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('DB busy'));
    const hook = renderHook(() => useAccountCredentialHealth([account(1)]));
    await waitFor(() => expect(hook.result.current.error).toBe(true));
    expect(hook.result.current.statuses).toEqual([]);
  });
  it('does not let a removed account response replace a new account snapshot', async () => {
    const old = deferred<CredentialStatus[]>();
    vi.mocked(invoke).mockReturnValueOnce(old.promise).mockResolvedValue([health(account(2))]);
    const hook = renderHook(({ selected }) => useAccountCredentialHealth([selected]), { initialProps: { selected: account(1) } });
    hook.rerender({ selected: account(2) });
    await waitFor(() => expect(hook.result.current.statuses).toEqual([health(account(2))]));
    await act(async () => { old.resolve([health(account(1), false)]); });
    expect(hook.result.current.statuses).toEqual([health(account(2))]);
  });
  it('opens native repair at the affected account rather than the default', async () => {
    vi.mocked(invoke).mockResolvedValue([health(account(1)), health(account(2), false)]);
    const changeAccountScope = vi.fn();
    render(<AccountLoginRecovery accounts={[account(1), account(2)]} accountScope="all" nativeSettings
      changeAccountScope={changeAccountScope} selectSettingsAccount={vi.fn()} openSection={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '修复登录' }));
    expect(openSettingsWindow).toHaveBeenCalledWith({ section: 'auth', accountScope: 2 });
    expect(changeAccountScope).not.toHaveBeenCalled();
  });
  it('waits for embedded account selection before opening repair', async () => {
    vi.mocked(invoke).mockResolvedValue([health(account(2), false)]);
    const props = { accounts: [account(1), account(2)], nativeSettings: false,
      changeAccountScope: vi.fn(), selectSettingsAccount: vi.fn(), openSection: vi.fn() };
    const view = render(<AccountLoginRecovery {...props} accountScope="all" />);
    fireEvent.click(await screen.findByRole('button', { name: '修复登录' }));
    expect(props.changeAccountScope).toHaveBeenCalledWith('2');
    expect(props.openSection).not.toHaveBeenCalled();
    view.rerender(<AccountLoginRecovery {...props} accountScope={2} />);
    await waitFor(() => expect(props.openSection).toHaveBeenCalledWith('auth'));
    expect(props.selectSettingsAccount).toHaveBeenCalledWith(props.accounts[1]);
  });
});

describe('OAuth account binding', () => {
  it('binds refresh and start to the selected nondefault account', async () => {
    const target = account(2, true);
    vi.mocked(invoke).mockImplementation(async (command) => command === 'list_oauth_sessions' ? [] : { message: 'done' });
    const hook = renderHook(() => useOAuthFlow({ accountForm: target, setStatus: vi.fn() }));
    act(() => hook.result.current.setOauthClientId('client'));
    await act(() => hook.result.current.startOAuth2Pkce());
    expect(invoke).toHaveBeenCalledWith('start_oauth2_pkce', expect.objectContaining({ accountId: 2 }));
    expect(invoke).toHaveBeenCalledWith('list_oauth_sessions', { accountId: 2 });
    await act(() => hook.result.current.refreshOAuth2Token());
    expect(invoke).toHaveBeenCalledWith('refresh_oauth2_token', expect.objectContaining({ accountId: 2 }));
  });
  it('ignores late token results and preserves new-account input', async () => {
    const old = deferred<{ message: string }>();
    vi.mocked(invoke).mockReturnValue(old.promise);
    const setStatus = vi.fn();
    const hook = renderHook(({ selected }) => useOAuthFlow({ accountForm: selected, setStatus }), { initialProps: { selected: account(1, true) } });
    act(() => { hook.result.current.setOauthClientId('client'); hook.result.current.setOauthClientSecret('A'); });
    let promise!: Promise<void>;
    act(() => { promise = hook.result.current.refreshOAuth2Token(); });
    hook.rerender({ selected: account(2, true) });
    act(() => hook.result.current.setOauthClientSecret('B'));
    await act(async () => { old.resolve({ message: 'A complete' }); await promise; });
    expect(hook.result.current.oauthRefreshReport).toBeNull();
    expect(hook.result.current.oauthClientSecret).toBe('B');
    expect(setStatus).not.toHaveBeenCalled();
  });
});

describe('account settings save ownership', () => {
  function setup() {
    const options = { persistedAccountForm: account(1), authTypeChanged: false, updateProviderVerification: vi.fn(),
      setAccount: vi.fn(), setAccounts: vi.fn(), setAccountForm: vi.fn(), setConnectionReport: vi.fn(),
      setCredentialStatus: vi.fn(), setCredentialVerification: vi.fn(), setStatus: vi.fn() };
    const target = account(1);
    const hook = renderHook(({ selected }) => useAccountSaveVerify({ ...options, accountForm: selected }), { initialProps: { selected: target } });
    return { ...hook, options, target };
  }
  it('does not restore an old form or erase new unsaved edits', async () => {
    const hook = setup();
    const updated = { ...hook.target, display_name: 'saved' };
    vi.mocked(invoke).mockResolvedValue(updated);
    await act(() => hook.result.current.saveSettings());
    const update = hook.options.setAccountForm.mock.calls[hook.options.setAccountForm.mock.calls.length - 1][0];
    const edited = { ...hook.target, display_name: 'newer local edit' };
    expect(update(edited)).toBe(edited);
    const other = account(2);
    expect(update(other)).toBe(other);
    expect(update(hook.target)).toEqual(updated);
  });
  it('rejects a duplicate save in the same event loop', async () => {
    const hook = setup();
    const old = deferred<Account>();
    vi.mocked(invoke).mockReturnValue(old.promise);
    let promise!: Promise<Account | null>;
    act(() => { promise = hook.result.current.saveSettings(); void hook.result.current.saveSettings(); });
    expect(invoke).toHaveBeenCalledTimes(1);
    await act(async () => { old.resolve(hook.target); await promise; });
  });
  it('prevents a failed old save from publishing errors after switching accounts', async () => {
    const hook = setup();
    const old = deferred<Account>();
    vi.mocked(invoke).mockReturnValue(old.promise);
    let promise!: Promise<Account | null>;
    act(() => { promise = hook.result.current.saveSettings(); });
    hook.rerender({ selected: account(2) });
    await act(async () => { old.reject(new Error('late failure')); expect(await promise).toBeNull(); });
    expect(hook.options.setStatus).not.toHaveBeenCalled();
  });
});
