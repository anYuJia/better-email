import { memo } from 'react';
import { AtSign, Plus } from 'lucide-react';
import type { Account } from '../../../app/types';
import { SettingsButton } from '../shared';

type AccountListProps = {
  accounts: Account[];
  activeAccountId: number | null;
  accountCount: number;
  onAdd: () => void;
  onSelect: (account: Account) => void;
  onDelete: (account: Account) => void;
};

type AccountRowProps = {
  account: Account;
  active: boolean;
  onSelect: (account: Account) => void;
  onDelete: (account: Account) => void;
};

const AccountRow = memo(function AccountRow({
  account,
  active,
  onSelect,
  onDelete,
}: AccountRowProps) {
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
        <span>{account.provider}</span>
        {account.is_default && <em>默认</em>}
      </span>
      <span className="settings-account-row-actions" aria-label="账号操作">
        <SettingsButton
          size="sm"
          variant="ghost"
          className="settings-account-delete-button"
          onClick={() => onDelete(account)}
        >
          删除
        </SettingsButton>
      </span>
    </div>
  );
});

export default function AccountList({
  accounts,
  activeAccountId,
  accountCount,
  onAdd,
  onSelect,
  onDelete,
}: AccountListProps) {
  return (
    <section className="st-section settings-account-list-panel" aria-labelledby="settings-account-list-title">
      <header className="st-section-header">
        <span className="st-section-heading">
          <strong id="settings-account-list-title">已添加账号</strong>
          <small>选择账号后管理偏好与连接设置 · {accountCount} 个账号</small>
        </span>
        <span className="st-section-meta">
          <SettingsButton variant="primary" size="sm" icon={<Plus size={14} />} onClick={onAdd}>
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
            onSelect={onSelect}
            onDelete={onDelete}
          />
        ))}
      </div>
    </section>
  );
}
