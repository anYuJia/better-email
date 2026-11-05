import { useCallback, useEffect, useId, useState } from 'react';
import { AlertTriangle, ChevronDown } from 'lucide-react';
import type { Account, AccountScope } from '../app/types';
import type { SettingsSectionId } from './settings/settingsNavigation';
import useAccountCredentialHealth from '../hooks/useAccountCredentialHealth';
import { openSettingsWindow } from '../tauriBridge';

type AccountLoginRepairOptions = {
  accounts: Account[];
  accountScope: AccountScope;
  nativeSettings: boolean;
  changeAccountScope: (scope: string) => void;
  selectSettingsAccount: (account: Account) => void;
  openSection: (section: SettingsSectionId) => void;
};

export function useAccountLoginRepair({
  accounts, accountScope, nativeSettings, changeAccountScope, selectSettingsAccount, openSection,
}: AccountLoginRepairOptions) {
  const [pending, setPending] = useState<Account | null>(null);
  const [repairError, setRepairError] = useState<string | null>(null);
  useEffect(() => {
    if (!pending || accountScope !== pending.id) return;
    setPending(null);
    const target = accounts.find((account) => account.id === pending.id);
    if (!target) return;
    selectSettingsAccount(target);
    openSection('auth');
  }, [accountScope, accounts, openSection, pending, selectSettingsAccount]);
  const repairCredentials = useCallback((accountId: number) => {
    const account = accounts.find((candidate) => candidate.id === accountId);
    if (!account) return;
    setRepairError(null);
    if (nativeSettings) {
      void openSettingsWindow({ section: 'auth', accountScope: account.id }).catch(() => {
        setRepairError('无法打开登录设置，请重试。');
      });
    } else {
      changeAccountScope(String(account.id));
      setPending(account);
    }
  }, [accounts, changeAccountScope, nativeSettings]);
  return { repairCredentials, repairError };
}

type Props = AccountLoginRepairOptions & {
  onRepairCredentials?: (accountId: number) => void;
  repairError?: string | null;
};

export default function AccountLoginRecovery(props: Props) {
  const { accounts, accountScope, onRepairCredentials } = props;
  const { statuses, error } = useAccountCredentialHealth(accounts);
  const localRepair = useAccountLoginRepair(props);
  const repair = onRepairCredentials ?? localRepair.repairCredentials;
  const repairError = onRepairCredentials ? props.repairError : localRepair.repairError;
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const available = accounts.filter((account) => accountScope === 'all' || account.id === accountScope);
  const affected = available.flatMap((account) => {
    const status = statuses.find((entry) => entry.account_email === account.email);
    return status && !status.exists ? [{ account, status }] : [];
  });
  useEffect(() => { if (repairError) setExpanded(true); }, [repairError]);
  if (!affected.length && !error && !repairError) return null;
  const summary = affected.length === 1 ? '此邮箱需要重新登录'
    : affected.length > 1 ? `${affected.length} 个邮箱需要重新登录` : '登录状态暂不可用';
  return (
    <section className="account-login-recovery" aria-label="邮箱登录状态">
      <div className="account-login-recovery-heading">
        <AlertTriangle size={16} strokeWidth={1.75} aria-hidden="true" />
        <button type="button" className="account-login-recovery-summary"
          aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded(!expanded)}>
          <span role="status">{summary}</span>
          <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
        {affected.length === 1 && <button type="button" className="account-login-recovery-action"
          onClick={() => repair(affected[0].account.id)}>修复登录</button>}
      </div>
      <div id={detailsId} className="account-login-recovery-details" hidden={!expanded}>
        {affected.map(({ account, status }) => (
          <div className="account-login-recovery-row" key={account.id}>
            <span><b>{account.email}</b>{status.message}</span>
            {affected.length > 1 && <button type="button" className="account-login-recovery-action"
              aria-label={`修复 ${account.email} 的登录`} onClick={() => repair(account.id)}>修复登录</button>}
          </div>
        ))}
        {error && <p>登录状态检查失败，未删除账号或凭据。稍后将自动重新检查。</p>}
        {repairError && <p role="alert">{repairError}</p>}
      </div>
    </section>
  );
}
