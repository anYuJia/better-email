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
  const [activeAccountMode, setActiveAccountMode] = useState<'details' | 'edit' | 'config' | null>(null);

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

  function openAccountMode(account: Account, mode: 'details' | 'edit' | 'config') {
    onAccountFormChange(account);
    setActiveAccountMode(mode);
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
              <div
                className={['settings-account-row', active ? 'active' : ''].filter(Boolean).join(' ')}
                key={account.id}
                role="option"
                aria-selected={active}
              >
                <button
                  type="button"
                  className="settings-account-row-main"
                  onClick={() => openAccountMode(account, 'details')}
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
                  <button type="button" onClick={() => openAccountMode(account, 'details')}>
                    详情
                  </button>
                  <button type="button" onClick={() => openAccountMode(account, 'edit')}>
                    修改
                  </button>
                  <button type="button" onClick={() => openAccountMode(account, 'config')}>
                    配置
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {activeAccountMode && (
        <section className="tool-panel settings-current-account-panel">
          <header className="tool-header">
            <span>
              <strong>
                {activeAccountMode === 'details' && '账号详情'}
                {activeAccountMode === 'edit' && '修改账号'}
                {activeAccountMode === 'config' && '账号配置'}
              </strong>
              <small>{accountForm.email}</small>
            </span>
            <button type="button" className="settings-account-close-detail" onClick={() => setActiveAccountMode(null)}>
              <X size={14} />
              收起
            </button>
          </header>

          {activeAccountMode === 'details' && (
            <div className="settings-account-detail-list">
              <span>
                <small>显示名称</small>
                <strong>{accountForm.display_name || accountForm.email}</strong>
              </span>
              <span>
                <small>服务商</small>
                <strong>{accountForm.provider}</strong>
              </span>
              <span>
                <small>同步</small>
                <strong>{accountForm.sync_mode === 'manual' ? '手动' : accountForm.sync_mode}</strong>
              </span>
              <span>
                <small>状态</small>
                <strong>{accountForm.is_default ? '默认账号' : '普通账号'}</strong>
              </span>
            </div>
          )}

          {activeAccountMode === 'edit' && (
            <>
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
              <AccountRemovalPanel
                account={accountForm}
                accountCount={accountCount}
                onRemove={onRemoveAccount}
              />
            </>
          )}

          {activeAccountMode === 'config' && (
            <div className="settings-account-form-grid settings-account-config-grid">
              <label>
                服务商
                <input
                  value={accountForm.provider}
                  onChange={(event) => onAccountFormChange({ ...accountForm, provider: event.target.value })}
                />
              </label>
              <label>
                认证方式
                <select
                  value={accountForm.auth_type}
                  onChange={(event) => onAccountFormChange({ ...accountForm, auth_type: event.target.value })}
                >
                  <option value="password">密码</option>
                  <option value="oauth2">OAuth2</option>
                </select>
              </label>
              <label>
                IMAP
                <input
                  value={accountForm.imap_host}
                  onChange={(event) => onAccountFormChange({ ...accountForm, imap_host: event.target.value })}
                />
              </label>
              <label>
                SMTP
                <input
                  value={accountForm.smtp_host}
                  onChange={(event) => onAccountFormChange({ ...accountForm, smtp_host: event.target.value })}
                />
              </label>
            </div>
          )}
        </section>
      )}

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
