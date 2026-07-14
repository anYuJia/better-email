import { Mail, Plus } from 'lucide-react';
import type { Account } from '../../../app/types';
import type { AccountDialogMode } from './accountSettingsShared';

type AccountListProps = {
  accounts: Account[];
  activeAccountId: number | null;
  accountCount: number;
  onAdd: () => void;
  onOpen: (account: Account, mode: AccountDialogMode) => void;
};

export default function AccountList({
  accounts,
  activeAccountId,
  accountCount,
  onAdd,
  onOpen,
}: AccountListProps) {
  return (
    <section className="tool-panel settings-account-list-panel" aria-labelledby="settings-account-list-title">
      <header className="tool-header settings-account-list-header">
        <span>
          <strong id="settings-account-list-title">邮箱账号</strong>
          <small>{accountCount} 个账号</small>
        </span>
        <button type="button" onClick={onAdd}>
          <Plus size={14} />
          添加账号
        </button>
      </header>

      <div className="settings-account-list" role="listbox" aria-label="邮箱账号">
        {accounts.map((account) => {
          const active = account.id === activeAccountId;
          return (
            <div
              className={['settings-account-row', active ? 'active' : ''].filter(Boolean).join(' ')}
              key={account.id}
              role="option"
              aria-selected={active}
            >
              <button
                type="button"
                className="settings-account-row-main"
                onClick={() => onOpen(account, 'config')}
              >
                <span className="settings-account-row-icon" aria-hidden="true">
                  <Mail size={15} />
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
                <button type="button" onClick={() => onOpen(account, 'config')}>
                  配置
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => onOpen(account, 'delete')}
                >
                  删除
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
