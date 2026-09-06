import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { Account } from '../app/types';
import { invoke } from '../tauriBridge';
import { IPC } from '../ipc/commands';

type Options = {
  account: Account | null;
  accounts: Account[];
  setAccount: Dispatch<SetStateAction<Account | null>>;
  setAccountForm: Dispatch<SetStateAction<Account | null>>;
  setAccounts: Dispatch<SetStateAction<Account[]>>;
  setStatus: Dispatch<SetStateAction<string>>;
  mailboxRefreshRef: MutableRefObject<number>;
};

export default function useOnboardingAccount({ account, accounts, setAccount, setAccountForm, setAccounts, setStatus, mailboxRefreshRef }: Options) {
  const apply = useCallback((updated: Account) => {
    setAccount(updated);
    setAccountForm(updated);
    setAccounts((current) => current.map((item) => item.id === updated.id ? updated : item));
  }, [setAccount, setAccountForm, setAccounts]);
  const handleOnboardingAccountPatch = useCallback(async (accountId: number, patch: Partial<Account>) => {
    const updated = await invoke<Account>(IPC.UpdateAccountSettings, {
      accountId, input: { ...accounts.find((item) => item.id === accountId) ?? account, ...patch },
    });
    apply(updated);
  }, [account, accounts, apply]);
  const completeOnboarding = useCallback(async (accountId: number) => {
    mailboxRefreshRef.current += 1;
    apply(await invoke<Account>(IPC.SetAccountOnboardingCompleted, { accountId, completed: true }));
    setStatus('首次引导已完成，可随时在设置页调整');
  }, [apply, mailboxRefreshRef, setStatus]);
  return { handleOnboardingAccountPatch, completeOnboarding };
}
