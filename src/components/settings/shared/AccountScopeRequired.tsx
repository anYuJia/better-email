import { ChevronRight, UserRound } from 'lucide-react';
import type { Account, AccountScope } from '../../../app/types';
import SettingsNotice from './SettingsNotice';
import SettingsSection from './SettingsSection';

type AccountScopeRequiredProps = {
  title?: string;
  description?: string;
  accountScope?: AccountScope;
  accounts?: Account[];
  onSelectAccount?: (account: Account) => void;
  onSelectScope?: (scope: AccountScope) => void;
};

/** Shared empty state for settings that cannot be edited in unified scope. */
export default function AccountScopeRequired({
  title = '请选择具体邮箱账号',
  description = '服务器、登录凭据、发件身份和文件夹映射只属于一个邮箱账号。请从下方选择账号或使用顶部的邮箱范围选择器继续。',
  accountScope = 'all',
  accounts,
  onSelectAccount,
  onSelectScope,
}: AccountScopeRequiredProps) {
  return (
    <SettingsSection dataSection="account-scope-required">
      <SettingsNotice
        tone="info"
        icon={UserRound}
        title={title}
      >
        <p data-account-scope-required={String(accountScope)}>{description}</p>
      </SettingsNotice>

      {accounts && accounts.length > 0 && (
        <div className="account-scope-picker-list" role="group" aria-label="选择邮箱账号">
          {accounts.map((acc) => (
            <button
              key={acc.id}
              type="button"
              className="account-scope-picker-card"
              onClick={() => {
                if (onSelectAccount) onSelectAccount(acc);
                if (onSelectScope) onSelectScope(acc.id);
              }}
            >
              <span className="account-scope-picker-avatar" aria-hidden="true">
                {(acc.display_name || acc.email || 'M').slice(0, 1).toUpperCase()}
              </span>
              <div className="account-scope-picker-info">
                <strong>{acc.display_name || acc.email}</strong>
                <span>{acc.email}</span>
              </div>
              <span className="account-scope-picker-action">
                配置此账号
                <ChevronRight size={14} aria-hidden="true" />
              </span>
            </button>
          ))}
        </div>
      )}
    </SettingsSection>
  );
}
