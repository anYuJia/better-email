import { useEffect, useState } from 'react';
import { Mail, Plus, X } from 'lucide-react';
import type { Account, AccountCreateInput } from '../../../app/types';
import type { AccountProviderPreset } from '../../../providerCatalog';
import AccountRemovalPanel from '../AccountRemovalPanel';
import ProviderPresetGrid from '../ProviderPresetGrid';

type AccountSettingsPageProps = {
  accounts: Account[];
  accountForm: Account;
  accountCount: number;
  newAccountForm: AccountCreateInput;
  onAccountFormChange: (account: Account) => void;
  onNewAccountFormChange: (account: AccountCreateInput) => void;
  onApplyNewAccountPreset: (preset: AccountProviderPreset) => void;
  onCreateNewAccount: () => void;
  onRemoveAccount: () => Promise<void>;
};

export default function AccountSettingsPage({
  accounts,
  accountForm,
  accountCount,
  newAccountForm,
  onAccountFormChange,
  onNewAccountFormChange,
  onApplyNewAccountPreset,
  onCreateNewAccount,
  onRemoveAccount,
}: AccountSettingsPageProps) {
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  useEffect(() => {
    if (!addDialogOpen) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAddDialogOpen(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [addDialogOpen]);

  function handleCreateNewAccount() {
    onCreateNewAccount();
    setAddDialogOpen(false);
  }

  return (
    <div className="settings-account-stack settings-account-page settings-account-page-accounts">
      <section className="tool-panel settings-account-list-panel" aria-labelledby="settings-account-list-title">
        <header className="tool-header settings-account-list-header">
          <span>
            <strong id="settings-account-list-title">邮箱账号</strong>
            <small>{accountCount} 个账号</small>
          </span>
          <button type="button" onClick={() => setAddDialogOpen(true)}>
            <Plus size={14} />
            添加账号
          </button>
        </header>

        <div className="settings-account-list" role="listbox" aria-label="邮箱账号">
          {accounts.map((account) => {
            const active = account.id === accountForm.id;
            return (
              <button
                type="button"
                className={['settings-account-row', active ? 'active' : ''].filter(Boolean).join(' ')}
                key={account.id}
                role="option"
                aria-selected={active}
                onClick={() => onAccountFormChange(account)}
              >
                <span className="settings-account-row-icon" aria-hidden="true">
                  <Mail size={15} />
                </span>
                <span className="settings-account-row-copy">
                  <strong>{account.display_name || account.email}</strong>
                  <span>{account.email}</span>
                </span>
                <span className="settings-account-row-meta">
                  <span>{account.provider}</span>
                  {account.is_default && <em>默认</em>}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="tool-panel settings-current-account-panel">
        <header className="tool-header">
          <span>
            <strong>账号信息</strong>
            <small>{accountForm.email}</small>
          </span>
          <em>{accountForm.provider}</em>
        </header>
        <div className="settings-account-form-grid">
          <label>
            显示名称
            <input
              value={accountForm.display_name}
              onChange={(event) => onAccountFormChange({
                ...accountForm,
                display_name: event.target.value,
              })}
            />
          </label>
          <label>
            同步策略
            <select
              value={accountForm.sync_mode}
              onChange={(event) => onAccountFormChange({ ...accountForm, sync_mode: event.target.value })}
            >
              <option value="manual">手动</option>
              <option value="15min">每 15 分钟</option>
              <option value="push">推送优先</option>
            </select>
          </label>
        </div>
      </section>

      <AccountRemovalPanel
        account={accountForm}
        accountCount={accountCount}
        onRemove={onRemoveAccount}
      />

      {addDialogOpen && (
        <div
          className="settings-account-add-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setAddDialogOpen(false);
          }}
        >
          <section
            className="settings-account-add-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-add-account-title"
          >
            <header>
              <span>
                <strong id="settings-add-account-title">添加邮箱</strong>
                <small>填写账号和服务器</small>
              </span>
              <button type="button" aria-label="关闭" onClick={() => setAddDialogOpen(false)}>
                <X size={17} />
              </button>
            </header>

            <div className="settings-account-form-grid">
              <label>
                邮箱地址
                <input
                  autoFocus
                  value={newAccountForm.email}
                  onChange={(event) => onNewAccountFormChange({ ...newAccountForm, email: event.target.value })}
                  placeholder="name@example.com"
                />
              </label>
              <label>
                显示名称
                <input
                  value={newAccountForm.display_name}
                  onChange={(event) => onNewAccountFormChange({
                    ...newAccountForm,
                    display_name: event.target.value,
                  })}
                  placeholder="可选"
                />
              </label>
            </div>

            <ProviderPresetGrid
              compact
              activeProvider={newAccountForm.provider}
              onSelect={onApplyNewAccountPreset}
            />

            <div className="settings-account-form-grid">
              <label>
                IMAP
                <input
                  value={newAccountForm.imap_host}
                  onChange={(event) => onNewAccountFormChange({
                    ...newAccountForm,
                    imap_host: event.target.value,
                  })}
                />
              </label>
              <label>
                SMTP
                <input
                  value={newAccountForm.smtp_host}
                  onChange={(event) => onNewAccountFormChange({
                    ...newAccountForm,
                    smtp_host: event.target.value,
                  })}
                />
              </label>
            </div>

            <footer>
              <button type="button" className="settings-account-add-cancel" onClick={() => setAddDialogOpen(false)}>
                取消
              </button>
              <button type="button" className="settings-account-add-submit" onClick={handleCreateNewAccount}>
                <Plus size={14} />
                添加
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
