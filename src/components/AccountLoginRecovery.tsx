import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { Account, AccountScope } from '../app/types';
import type { SettingsSectionId } from './settings/settingsNavigation';
import useAccountCredentialHealth from '../hooks/useAccountCredentialHealth';
import { openSettingsWindow } from '../tauriBridge';

type Props = {
  accounts: Account[];
  accountScope: AccountScope;
  nativeSettings: boolean;
  changeAccountScope: (scope: string) => void;
  selectSettingsAccount: (account: Account) => void;
  openSection: (section: SettingsSectionId) => void;
};

export default function AccountLoginRecovery({
  accounts, accountScope, nativeSettings, changeAccountScope, selectSettingsAccount, openSection,
}: Props) {
  const { statuses, error } = useAccountCredentialHealth(accounts);
  const [pending, setPending] = useState<Account | null>(null);
  const [openError, setOpenError] = useState(false);
  const available = accounts.filter((account) => accountScope === 'all' || account.id === accountScope);
  const affected = available.flatMap((account) => {
    const status = statuses.find((entry) => entry.account_email === account.email);
    return status && !status.exists ? [{ account, status }] : [];
  });
  useEffect(() => {
    if (!pending || accountScope !== pending.id) return;
    setPending(null);
    const target = accounts.find((account) => account.id === pending.id);
    if (!target) return;
    selectSettingsAccount(target);
    openSection('auth');
  }, [accountScope, accounts, openSection, pending, selectSettingsAccount]);
  const repair = (account: Account) => {
    setOpenError(false);
    if (nativeSettings) {
      void openSettingsWindow({ section: 'auth', accountScope: account.id }).catch(() => setOpenError(true));
    } else {
      changeAccountScope(String(account.id));
      setPending(account);
    }
  };
  if (!affected.length && !error) return null;
  return (
    <div className="account-login-recovery" role="status" aria-label="邮箱登录状态">
      <AlertTriangle size={16} aria-hidden="true" />
      <div>
        <strong>{affected.length ? `${affected.length} 个账号需要修复本机登录` : '暂时无法检查本机登录状态'}</strong>
        {affected.map(({ account, status }) => (
          <div className="account-login-recovery-row" key={account.id}>
            <span><b>{account.email}</b>{status.message}</span>
            <button type="button" onClick={() => repair(account)}>修复登录</button>
          </div>
        ))}
        {error && <p>登录状态检查失败，未删除账号或凭据。稍后将自动重新检查。</p>}
        {openError && <p>无法打开登录设置，请重试。</p>}
      </div>
    </div>
  );
}
