import { memo } from 'react';
import { AtSign, Plus } from 'lucide-react';
import type { Account } from '../../../app/types';
import { providerPresetForEmail } from '../../../providerCatalog';
import { SettingsButton } from '../shared';

type AccountListProps = {
  accounts: Account[];
  activeAccountId: number | null;
  accountCount: number;
  switchDisabled?: boolean;
  onAdd: () => void;
  onSelect: (account: Account) => void;
};

type AccountRowProps = {
  account: Account;
  active: boolean;
  switchDisabled: boolean;
  onSelect: (account: Account) => void;
};

const AccountRow = memo(function AccountRow({
  account,
  active,
  switchDisabled,
  onSelect,
}: AccountRowProps) {
  const providerLabel = providerPresetForEmail(account.email)?.label ?? account.provider;

  return (
    <div
      className={['settings-account-row', active ? 'active' : ''].filter(Boolean).join(' ')}
      role="listitem"
      aria-current={active ? 'true' : undefined}
    >
      <button
        type="button"
        className="settings-account-row-main"
        aria-pressed={active}
        disabled={switchDisabled && !active}
        title={switchDisabled && !active ? '请先保存或放弃当前账号的修改' : undefined}
        onClick={() => onSelect(account)}
      >
        <span className="settings-account-row-icon" aria-hidden="true">
          <AtSign size={16} />
        </span>
        <span className="settings-account-row-copy">
          <strong>{account.display_name || account.email}</strong>
          <span>{account.email}</span>
        </span>
      </button>
      <span className="settings-account-row-meta">
        <span>{providerLabel}</span>
        {account.is_default && <em>默认</em>}
      </span>
    </div>
  );
});

export default function AccountList({
  accounts,
  activeAccountId,
  accountCount,
  switchDisabled = false,
  onAdd,
  onSelect,
}: AccountListProps) {
  return (
    <section className="st-section settings-account-list-panel" aria-labelledby="settings-account-list-title">
      <header className="st-section-header">
        <span className="st-section-heading">
          <strong id="settings-account-list-title">邮箱账号</strong>
          <small>选择账号进行管理 · {accountCount} 个账号</small>
        </span>
        <span className="st-section-meta">
          <SettingsButton
            variant="primary"
            size="sm"
            icon={<Plus size={14} />}
            disabled={switchDisabled}
            title={switchDisabled ? '请先保存或放弃当前账号的修改' : undefined}
            onClick={onAdd}
          >
            添加账号
          </SettingsButton>
        </span>
      </header>
      <div className="st-section-body settings-account-list" role="list" aria-label="邮箱账号">
        {accounts.map((account) => (
          <AccountRow
            key={account.id}
            account={account}
            active={account.id === activeAccountId}
            switchDisabled={switchDisabled}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}
