import { useMemo } from 'react';
import type { Account, AccountScope } from '../app/types';

type MailboxIdentityLabelsOptions = {
  accounts: readonly Pick<Account, 'id' | 'display_name' | 'email'>[];
  accountScope: AccountScope;
};

export default function useMailboxIdentityLabels({ accounts, accountScope }: MailboxIdentityLabelsOptions) {
  const accountSourceLabels = useMemo(() => {
    const names = new Map<string, number>();
    for (const entry of accounts) {
      const name = entry.display_name.trim().toLocaleLowerCase();
      if (name) names.set(name, (names.get(name) ?? 0) + 1);
    }
    return new Map(accounts.map((entry) => {
      const name = entry.display_name.trim();
      return [entry.id, name && names.get(name.toLocaleLowerCase()) === 1 ? name : entry.email];
    }));
  }, [accounts]);

  // Navigation owns the label immediately, even while metadata for the
  // previously selected account is still displayed elsewhere during loading.
  const targetAccount = accounts.find((entry) => entry.id === accountScope);
  const mobileAccountScopeLabel = accountScope === 'all' ? '统一邮箱'
    : targetAccount?.display_name || targetAccount?.email || '邮箱';

  return { accountSourceLabels, mobileAccountScopeLabel };
}
