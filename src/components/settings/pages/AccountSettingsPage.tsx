import { Plus } from 'lucide-react';
import type { Account, AccountCreateInput } from '../../../app/types';
import type { AccountProviderPreset } from '../../../providerCatalog';
import AccountRemovalPanel from '../AccountRemovalPanel';
import ProviderPresetGrid from '../ProviderPresetGrid';

type AccountSettingsPageProps = {
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
  accountForm,
  accountCount,
  newAccountForm,
  onAccountFormChange,
  onNewAccountFormChange,
  onApplyNewAccountPreset,
  onCreateNewAccount,
  onRemoveAccount,
}: AccountSettingsPageProps) {
  return (
    <div className="settings-account-stack settings-account-page settings-account-page-accounts">
      <section className="settings-static-section add-account-section" data-settings-section="accounts">
        <header className="settings-static-header">
          <span>
            <strong>添加邮箱账号</strong>
            <em>选择服务商预设并填写邮箱地址</em>
          </span>
          <b>添加</b>
        </header>
        <section className="tool-panel settings-add-account-panel">
          <header className="tool-header">
            <span>
              <strong>新增账号</strong>
              <small>凭据将在账号创建后单独写入系统安全存储</small>
            </span>
            <button type="button" onClick={onCreateNewAccount}>
              <Plus size={14} />
              创建账号
            </button>
          </header>
          <div className="settings-account-form-grid">
            <label>
              邮箱地址
              <input
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
                placeholder="留空则使用邮箱地址"
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
        </section>
      </section>

      <section className="tool-panel settings-current-account-panel">
        <header className="tool-header">
          <span>
            <strong>当前账号</strong>
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
    </div>
  );
}
