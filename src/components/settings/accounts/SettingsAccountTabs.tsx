import { memo } from 'react';
import { AtSign } from 'lucide-react';

export type SettingsAccountTabOption = {
  id: number;
  label: string;
  email: string;
  isDefault?: boolean;
};

type SettingsAccountTabsProps = {
  accounts: SettingsAccountTabOption[];
  activeAccountId: number | null;
  switchDisabled?: boolean;
  onSelect: (accountId: number) => void;
};

function AccountTab({
  account,
  active,
  switchDisabled,
  onSelect,
}: {
  account: SettingsAccountTabOption;
  active: boolean;
  switchDisabled: boolean;
  onSelect: (accountId: number) => void;
}) {
  return (
    <button
      type="button"
      className={`settings-account-tab${active ? ' active' : ''}`}
      data-settings-account-tab={account.id}
      aria-current={active ? 'true' : undefined}
      aria-pressed={active}
      role="tab"
      aria-selected={active}
      disabled={switchDisabled && !active}
      title={switchDisabled && !active
        ? '请先保存或放弃当前账号的修改'
        : `${account.label} · ${account.email}`}
      onClick={() => {
        if (!active) onSelect(account.id);
      }}
    >
      <span className="settings-account-tab-icon" aria-hidden="true">
        <AtSign size={14} />
      </span>
      <span className="settings-account-tab-copy">
        <strong>{account.label}</strong>
        <small>{account.email}</small>
      </span>
      {account.isDefault && <em title="默认发件账号">默认</em>}
    </button>
  );
}

export default memo(function SettingsAccountTabs({
  accounts,
  activeAccountId,
  switchDisabled = false,
  onSelect,
}: SettingsAccountTabsProps) {
  return (
    <nav className="settings-account-tabs" aria-label="切换设置账号">
      <div className="settings-account-tabs-list" role="tablist" aria-label="邮箱账号">
        {accounts.map((account) => (
          <AccountTab
            key={account.id}
            account={account}
            active={account.id === activeAccountId}
            switchDisabled={switchDisabled}
            onSelect={onSelect}
          />
        ))}
      </div>
    </nav>
  );
});
