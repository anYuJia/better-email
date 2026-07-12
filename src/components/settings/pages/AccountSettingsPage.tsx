import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Account, AccountCreateInput, IncomingProtocol } from '../../../app/types';
import { incomingHostForProtocol, providerPresetForEmail, providerPresets } from '../../../providerCatalog';
import type { AccountProviderPreset } from '../../../providerCatalog';
import AccountRemovalPanel from '../AccountRemovalPanel';
import AccountList from '../accounts/AccountList';
import AddAccountDialog from '../accounts/AddAccountDialog';
import AccountManageDialog from '../accounts/AccountManageDialog';
import type { AccountDialogMode } from '../accounts/accountSettingsShared';
import { protocolLabel } from '../accounts/accountSettingsShared';
import ProviderPresetGrid from '../ProviderPresetGrid';

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/^Error:\s*/i, '')
    .trim() || '添加失败，请检查邮箱和授权码。';
}

type AccountSettingsPageProps = {
  accounts: Account[];
  accountForm: Account | null;
  accountCount: number;
  newAccountForm: AccountCreateInput;
  onAccountFormChange: (account: Account) => void;
  onNewAccountFormChange: (account: AccountCreateInput) => void;
  onApplyNewAccountPreset: (preset: AccountProviderPreset) => void;
  onCreateNewAccount: (secret?: string) => Promise<void>;
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
  const [newAccountSecret, setNewAccountSecret] = useState('');
  const [newAccountSecretVisible, setNewAccountSecretVisible] = useState(false);
  const [newAccountManualConfigOpen, setNewAccountManualConfigOpen] = useState(false);
  const [addAccountError, setAddAccountError] = useState('');
  const [addAccountSubmitting, setAddAccountSubmitting] = useState(false);
  const [accountDialogMode, setAccountDialogMode] = useState<AccountDialogMode | null>(null);

  useEffect(() => {
    if (!addDialogOpen && !accountDialogMode) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setAddDialogOpen(false);
      setAccountDialogMode(null);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [addDialogOpen, accountDialogMode]);

  useEffect(() => {
    if (!addDialogOpen) {
      setNewAccountSecret('');
      setNewAccountSecretVisible(false);
      setNewAccountManualConfigOpen(false);
      setAddAccountError('');
      setAddAccountSubmitting(false);
    }
  }, [addDialogOpen]);

  const requiresNewAccountSecret = newAccountForm.auth_type !== 'oauth2';
  const canCreateAccount = newAccountForm.email.trim().length > 0
    && (!requiresNewAccountSecret || newAccountSecret.trim().length > 0);
  const matchedNewAccountPreset = providerPresetForEmail(newAccountForm.email);
  const newAccountServerReady = Boolean(newAccountForm.imap_host.trim() && newAccountForm.smtp_host.trim());
  const newAccountSecretLabel = newAccountForm.auth_type === 'oauth2' ? 'OAuth2 Token' : '密码 / 授权码';
  const newAccountSecretPlaceholder = newAccountForm.provider === 'netease'
    ? '网易客户端授权码'
    : newAccountForm.provider === 'qq'
      ? 'QQ 邮箱授权码'
      : newAccountForm.auth_type === 'oauth2'
        ? '访问或刷新 Token'
        : '应用专用密码或授权码';

  function providerPresetFor(provider: string) {
    const normalized = provider.trim().toLowerCase();
    return providerPresets.find((preset) => preset.provider === normalized || preset.id === normalized) ?? null;
  }

  async function handleCreateNewAccount() {
    if (addAccountSubmitting) return;
    if (!newAccountForm.email.trim()) {
      setAddAccountError('请输入邮箱地址。');
      return;
    }
    if (requiresNewAccountSecret && !newAccountSecret.trim()) {
      setAddAccountError('请输入邮箱授权码或应用专用密码。');
      return;
    }
    if (!canCreateAccount) return;
    if (!newAccountServerReady) {
      setNewAccountManualConfigOpen(true);
      setAddAccountError('未识别服务商，请填写收信服务器和发信服务器。');
      return;
    }

    setAddAccountError('');
    setAddAccountSubmitting(true);
    try {
      await onCreateNewAccount(newAccountSecret);
      setAddDialogOpen(false);
    } catch (error) {
      setAddAccountError(errorMessage(error));
    } finally {
      setAddAccountSubmitting(false);
    }
  }

  async function handleCreateInlineAccount() {
    if (addAccountSubmitting) return;
    if (!newAccountForm.email.trim()) {
      setAddAccountError('请输入邮箱地址。');
      return;
    }
    if (!newAccountServerReady) {
      setAddAccountError('请先选择服务商预设，或填写收信和发信服务器。');
      return;
    }

    setAddAccountError('');
    setAddAccountSubmitting(true);
    try {
      await onCreateNewAccount();
    } catch (error) {
      setAddAccountError(errorMessage(error));
    } finally {
      setAddAccountSubmitting(false);
    }
  }

  function updateNewAccountEmail(email: string) {
    setAddAccountError('');
    const preset = providerPresetForEmail(email);
    if (!preset) {
      onNewAccountFormChange({ ...newAccountForm, email });
      return;
    }
    onNewAccountFormChange({
      ...newAccountForm,
      email,
      provider: preset.provider,
      imap_host: incomingHostForProtocol(preset, newAccountForm.incoming_protocol),
      smtp_host: preset.smtp_host,
      auth_type: 'password',
    });
  }

  function switchNewAccountProtocol(nextProtocol: IncomingProtocol) {
    const preset = providerPresetFor(newAccountForm.provider);
    setAddAccountError('');
    onNewAccountFormChange({
      ...newAccountForm,
      incoming_protocol: nextProtocol,
      imap_host: preset ? incomingHostForProtocol(preset, nextProtocol) : newAccountForm.imap_host,
      auth_type: nextProtocol === 'pop3' && newAccountForm.auth_type === 'oauth2'
        ? 'password'
        : newAccountForm.auth_type,
    });
  }

  function switchAccountProtocol(nextProtocol: IncomingProtocol) {
    if (!accountForm) return;
    const preset = providerPresetFor(accountForm.provider);
    onAccountFormChange({
      ...accountForm,
      incoming_protocol: nextProtocol,
      imap_host: preset ? incomingHostForProtocol(preset, nextProtocol) : accountForm.imap_host,
      auth_type: nextProtocol === 'pop3' && accountForm.auth_type === 'oauth2'
        ? 'password'
        : accountForm.auth_type,
    });
  }

  function openAccountDialog(account: Account, mode: AccountDialogMode) {
    setAddDialogOpen(false);
    onAccountFormChange(account);
    setAccountDialogMode(mode);
  }

  return (
    <div className="settings-account-stack settings-account-page settings-account-page-accounts">
      <AccountList
        accounts={accounts}
        activeAccountId={accountForm?.id ?? null}
        accountCount={accountCount}
        onAdd={() => {
          setAccountDialogMode(null);
          setAddDialogOpen(true);
        }}
        onOpen={openAccountDialog}
      />

      {accountForm && (
        <>
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
                <input value={accountForm.display_name || accountForm.email} readOnly />
              </label>
              <label>
                收信服务器
                <input value={accountForm.imap_host} readOnly />
              </label>
              <label>
                发信服务器
                <input value={accountForm.smtp_host} readOnly />
              </label>
            </div>
          </section>

          <AccountRemovalPanel
            account={accountForm}
            accountCount={accountCount}
            onRemove={onRemoveAccount}
          />
        </>
      )}

      <details className="add-account-disclosure tool-panel">
        <summary>
          <span className="add-account-summary-copy">
            <strong>添加邮箱账号</strong>
            <small>选择服务商预设，或手动填写 IMAP/POP3 与 SMTP 服务器</small>
          </span>
          <span className="add-account-summary-action">
            <Plus size={14} />
            展开
          </span>
        </summary>

        <section className="settings-add-account-panel tool-panel" aria-label="添加邮箱账号">
          <div className="settings-account-form-grid">
            <label>
              邮箱地址
              <input
                value={newAccountForm.email}
                onChange={(event) => updateNewAccountEmail(event.target.value)}
                placeholder="name@example.com"
                aria-invalid={Boolean(addAccountError)}
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
            <label>
              获取新邮件时间
              <select
                value={newAccountForm.sync_mode === 'push' ? '5min' : newAccountForm.sync_mode}
                onChange={(event) => onNewAccountFormChange({
                  ...newAccountForm,
                  sync_mode: event.target.value,
                })}
              >
                <option value="manual">手动</option>
                <option value="5min">每 5 分钟</option>
                <option value="15min">每 15 分钟</option>
                <option value="30min">每 30 分钟</option>
              </select>
            </label>
          </div>

          <ProviderPresetGrid
            compact
            activeProvider={newAccountForm.provider}
            onSelect={(preset) => {
              setAddAccountError('');
              onApplyNewAccountPreset(preset);
            }}
          />

          <div className="settings-account-form-grid">
            <label>
              收信服务器（{protocolLabel(newAccountForm.incoming_protocol)}）
              <input
                value={newAccountForm.imap_host}
                onChange={(event) => onNewAccountFormChange({
                  ...newAccountForm,
                  imap_host: event.target.value,
                })}
              />
            </label>
            <label>
              发信服务器（SMTP）
              <input
                value={newAccountForm.smtp_host}
                onChange={(event) => onNewAccountFormChange({
                  ...newAccountForm,
                  smtp_host: event.target.value,
                })}
              />
            </label>
            <label>
              认证方式
              <select
                value={newAccountForm.auth_type}
                onChange={(event) => onNewAccountFormChange({
                  ...newAccountForm,
                  auth_type: event.target.value,
                })}
              >
                <option value="password">密码 / 授权码</option>
                <option value="oauth2">OAuth2 Token</option>
              </select>
            </label>
          </div>

          {addAccountError && (
            <p className="settings-account-add-error" role="alert">
              {addAccountError}
            </p>
          )}

          <footer>
            <button
              type="button"
              className="settings-account-add-submit"
              disabled={!newAccountForm.email.trim() || !newAccountServerReady || addAccountSubmitting}
              onClick={handleCreateInlineAccount}
            >
              {!addAccountSubmitting && <Plus size={14} />}
              {addAccountSubmitting ? '创建中' : '创建账号'}
            </button>
          </footer>
        </section>
      </details>

      {addDialogOpen && (
        <AddAccountDialog
          form={newAccountForm}
          secret={newAccountSecret}
          secretVisible={newAccountSecretVisible}
          manualConfigOpen={newAccountManualConfigOpen}
          error={addAccountError}
          submitting={addAccountSubmitting}
          canSubmit={canCreateAccount}
          requiresSecret={requiresNewAccountSecret}
          secretLabel={newAccountSecretLabel}
          secretPlaceholder={newAccountSecretPlaceholder}
          matchedProviderLabel={matchedNewAccountPreset?.label ?? '自定义邮箱'}
          serverReady={newAccountServerReady}
          onClose={() => setAddDialogOpen(false)}
          onSubmit={handleCreateNewAccount}
          onSecretChange={(secret) => {
            setAddAccountError('');
            setNewAccountSecret(secret);
          }}
          onSecretVisibleChange={setNewAccountSecretVisible}
          onManualConfigOpenChange={setNewAccountManualConfigOpen}
          onEmailChange={updateNewAccountEmail}
          onFormChange={onNewAccountFormChange}
          onProtocolChange={switchNewAccountProtocol}
          onApplyPreset={onApplyNewAccountPreset}
        />
      )}

      {accountDialogMode && accountForm && (
        <AccountManageDialog
          mode={accountDialogMode}
          account={accountForm}
          accountCount={accountCount}
          onClose={() => setAccountDialogMode(null)}
          onAccountChange={onAccountFormChange}
          onProtocolChange={switchAccountProtocol}
          onRemoveAccount={onRemoveAccount}
        />
      )}
    </div>
  );
}
