import { useCallback, useEffect, type Dispatch, type SetStateAction } from 'react';
import type { Account, AccountScope } from '../app/types';
import {
  SETTINGS_ACCOUNT_SCOPE_EVENT,
  SETTINGS_ACCOUNTS_UPDATED_EVENT,
} from '../app/settingsWindow';
import {
  emitToMain,
  listen,
  syncSettingsWindowAccountScope,
} from '../tauriBridge';

type UseSettingsAccountScopeOptions = {
  accountScope: AccountScope;
  accounts: Account[];
  requestedAccountScope?: AccountScope;
  accountsLoaded: boolean;
  standaloneSettingsWindow: boolean;
  useNativeSettingsWindow: boolean;
  onSettingsScopeChange?: (scope: AccountScope) => void;
  setAccount: Dispatch<SetStateAction<Account | null>>;
  setAccounts: Dispatch<SetStateAction<Account[]>>;
  setAccountForm: Dispatch<SetStateAction<Account | null>>;
  changeAccountScope: (value: string) => void;
  selectSettingsAccount: (account: Account) => void;
  showNarrowList: () => void;
};

function parseAccountScope(value: string): AccountScope | null {
  if (value === 'all') return 'all';
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export default function useSettingsAccountScope({
  accountScope,
  accounts,
  requestedAccountScope,
  accountsLoaded,
  standaloneSettingsWindow,
  useNativeSettingsWindow,
  onSettingsScopeChange,
  setAccount,
  setAccounts,
  setAccountForm,
  changeAccountScope,
  selectSettingsAccount,
  showNarrowList,
}: UseSettingsAccountScopeOptions) {
  const selectConcreteAccount = useCallback((nextAccount: Account) => {
    // Scope owns the mailbox/settings context. Keep account data loading in the
    // selection hook, but commit the scope here so every picker path updates
    // the same state immediately, including the native settings window.
    if (accountScope !== nextAccount.id) {
      changeAccountScope(String(nextAccount.id));
    }
    selectSettingsAccount(nextAccount);
  }, [accountScope, changeAccountScope, selectSettingsAccount]);

  const handleSettingsAccountScopeChange = useCallback((value: string) => {
    const nextScope = parseAccountScope(value);
    if (nextScope === null) return;
    onSettingsScopeChange?.(nextScope);
    if (nextScope === 'all') {
      changeAccountScope('all');
    } else {
      const nextAccount = accounts.find((account) => account.id === nextScope);
      if (nextAccount) selectConcreteAccount(nextAccount);
      else changeAccountScope(value);
    }
    if (standaloneSettingsWindow) {
      void emitToMain(SETTINGS_ACCOUNT_SCOPE_EVENT, { scope: nextScope }).catch(() => undefined);
    }
  }, [accounts, changeAccountScope, onSettingsScopeChange, selectConcreteAccount, standaloneSettingsWindow]);

  const handleMailboxAccountScopeChange = useCallback((value: string) => {
    const nextScope = parseAccountScope(value);
    if (nextScope === null) return;
    showNarrowList();
    changeAccountScope(value);
    if (useNativeSettingsWindow) {
      void syncSettingsWindowAccountScope(nextScope).catch(() => undefined);
    }
  }, [changeAccountScope, showNarrowList, useNativeSettingsWindow]);

  useEffect(() => {
    if (
      !standaloneSettingsWindow
      || requestedAccountScope === undefined
      || requestedAccountScope === accountScope
    ) return;
    if (requestedAccountScope === 'all') {
      changeAccountScope('all');
      return;
    }
    const requestedAccount = accounts.find((account) => account.id === requestedAccountScope);
    if (requestedAccount) selectConcreteAccount(requestedAccount);
    else changeAccountScope(String(requestedAccountScope));
  }, [
    accountScope,
    accounts,
    changeAccountScope,
    requestedAccountScope,
    selectConcreteAccount,
    standaloneSettingsWindow,
  ]);

  useEffect(() => {
    if (!standaloneSettingsWindow || !accountsLoaded) return;
    void emitToMain(SETTINGS_ACCOUNTS_UPDATED_EVENT, { accounts }).catch(() => undefined);
  }, [accounts, accountsLoaded, standaloneSettingsWindow]);

  useEffect(() => {
    if (standaloneSettingsWindow) return undefined;
    let active = true;
    let unlisten: (() => void) | undefined;
    const applyIncomingScope = (event: { payload?: { scope?: AccountScope } }) => {
      if (!active) return;
      const nextScope = event.payload?.scope;
      if (nextScope === 'all') {
        changeAccountScope('all');
      } else if (
        typeof nextScope === 'number'
        && Number.isInteger(nextScope)
        && accounts.some((account) => account.id === nextScope)
      ) {
        changeAccountScope(String(nextScope));
      }
    };
    const applyIncomingAccounts = (event: { payload?: { accounts?: Account[] } }) => {
      if (!active || !Array.isArray(event.payload?.accounts)) return;
      const nextAccounts = event.payload.accounts;
      setAccounts(nextAccounts);
      setAccount((current) => {
        if (!current) return current;
        return nextAccounts.find((account) => account.id === current.id)
          ?? nextAccounts.find((account) => account.is_default)
          ?? nextAccounts[0]
          ?? null;
      });
      setAccountForm((current) => {
        if (!current) return current;
        return nextAccounts.find((account) => account.id === current.id)
          ?? nextAccounts.find((account) => account.is_default)
          ?? nextAccounts[0]
          ?? null;
      });
      if (
        typeof accountScope === 'number'
        && !nextAccounts.some((account) => account.id === accountScope)
      ) {
        const nextScope = nextAccounts.find((account) => account.is_default)?.id
          ?? nextAccounts[0]?.id
          ?? 'all';
        changeAccountScope(String(nextScope));
      }
    };
    void Promise.all([
      listen<{ scope?: AccountScope }>(SETTINGS_ACCOUNT_SCOPE_EVENT, applyIncomingScope),
      listen<{ accounts?: Account[] }>(SETTINGS_ACCOUNTS_UPDATED_EVENT, applyIncomingAccounts),
    ]).then(([scopeCleanup, accountsCleanup]) => {
      const cleanup = () => {
        scopeCleanup();
        accountsCleanup();
      };
      if (!active) cleanup();
      else unlisten = cleanup;
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [accountScope, accounts, changeAccountScope, setAccount, setAccountForm, setAccounts, standaloneSettingsWindow]);

  return {
    handleSettingsAccountScopeChange,
    handleMailboxAccountScopeChange,
  };
}
