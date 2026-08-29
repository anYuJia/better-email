import { useEffect, useState } from 'react';
import type { Account, AccountCreateInput, IncomingProtocol } from '../../../app/types';
import { incomingHostForProtocol, providerPresetForEmail, providerPresets } from '../../../providerCatalog';
import type { AccountProviderPreset } from '../../../providerCatalog';
import {
  settingsAccountDetailItems,
  type SettingsSectionId,
} from '../settingsNavigation';
import AccountList from '../accounts/AccountList';
import AddAccountDialog from '../accounts/AddAccountDialog';
import AccountManageDialog from '../accounts/AccountManageDialog';
import { syncModeOptions } from '../accounts/accountSettingsShared';
import { accountFormForEmail, accountFormForIncomingProtocol } from '../accounts/accountSetupForm';
import { CustomSelect } from '../accounts/CustomSelect';
import SettingsDestinationList from '../SettingsDestinationList';
import {
  SettingsField,
  SettingsSection,
  SettingsSwitch,
} from '../shared';

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
  onCreateNewAccount: (secret?: string, onProgress?: (stage: string) => void) => Promise<void>;
  onRemoveAccount: (deleteSecret: boolean) => Promise<void>;
  onSaveAccountSettings?: (account: Account) => Promise<void>;
  onNavigate: (section: SettingsSectionId) => void;
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
  onSaveAccountSettings,
  onNavigate,
}: AccountSettingsPageProps) {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newAccountSecret, setNewAccountSecret] = useState('');
  const [newAccountSecretVisible, setNewAccountSecretVisible] = useState(false);
  const [newAccountManualConfigOpen, setNewAccountManualConfigOpen] = useState(false);
  const [addAccountError, setAddAccountError] = useState('');
  const [addAccountSubmitting, setAddAccountSubmitting] = useState(false);
  const [addAccountStage, setAddAccountStage] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  useEffect(() => {
    if (!addDialogOpen) {
      setNewAccountSecret('');
      setNewAccountSecretVisible(false);
      setNewAccountManualConfigOpen(false);
      setAddAccountError('');
      setAddAccountSubmitting(false);
      setAddAccountStage('');
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
    setAddAccountStage('正在初始化...');
    try {
      await onCreateNewAccount(newAccountSecret, (stage) => setAddAccountStage(stage));
      setAddDialogOpen(false);
    } catch (error) {
      setAddAccountError(errorMessage(error));
    } finally {
      setAddAccountSubmitting(false);
      setAddAccountStage('');
    }
  }

  function updateNewAccountEmail(email: string) {
    setAddAccountError('');
    onNewAccountFormChange(accountFormForEmail(newAccountForm, email));
  }

  function switchNewAccountProtocol(nextProtocol: IncomingProtocol) {
    setAddAccountError('');
    onNewAccountFormChange(accountFormForIncomingProtocol(newAccountForm, nextProtocol));
  }

  function providerPresetFor(provider: string) {
    const normalized = provider.trim().toLowerCase();
    return providerPresets.find((preset) => preset.provider === normalized || preset.id === normalized) ?? null;
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

  return (
    <>
      <AccountList
        accounts={accounts}
        activeAccountId={accountForm?.id ?? null}
        accountCount={accountCount}
        onAdd={() => {
          setDeleteDialogOpen(false);
          setAddDialogOpen(true);
        }}
        onSelect={onAccountFormChange}
        onDelete={(account) => {
          setAddDialogOpen(false);
          onAccountFormChange(account);
          setDeleteDialogOpen(true);
        }}
      />

      {accountForm && (
        <SettingsSection
          title="账号偏好"
          description={accountForm.email}
          className="settings-account-overview"
          dataSection="account-overview"
        >
          <div className="settings-account-overview-grid">
            <SettingsField label="显示名" hint="仅用于 Better Email 内识别此账号">
              <input
                value={accountForm.display_name}
                onChange={(event) => onAccountFormChange({
                  ...accountForm,
                  display_name: event.target.value,
                })}
                placeholder="默认使用邮箱地址"
              />
            </SettingsField>
            <SettingsField label="获取新邮件" hint="控制后台检查频率" labelMode="static">
              <CustomSelect
                dense
                ariaLabel="获取新邮件"
                value={accountForm.sync_mode === 'push' ? '5min' : accountForm.sync_mode}
                options={syncModeOptions}
                onChange={(value) => onAccountFormChange({ ...accountForm, sync_mode: value })}
              />
            </SettingsField>
          </div>

          <SettingsSwitch
            label="跨邮箱发送风险提示"
            description="发件账号与当前邮件不一致时，在发送前提醒。"
            checked={accountForm.cross_account_risk_warning !== false}
            onChange={(checked) => onAccountFormChange({
              ...accountForm,
              cross_account_risk_warning: checked,
            })}
          />
          <SettingsSwitch
            label="自动下载新邮件附件"
            description="收到新邮件时自动将附件保存到本地下载位置。"
            checked={accountForm.auto_download_attachments}
            onChange={(checked) => onAccountFormChange({
              ...accountForm,
              auto_download_attachments: checked,
            })}
          />
        </SettingsSection>
      )}

      {accountForm && (
        <SettingsSection
          title="详细设置"
          description="服务器、登录、发件身份、同步与隐私按需打开。"
          dataSection="account-details"
        >
          <SettingsDestinationList
            ariaLabel="账号详细设置"
            items={settingsAccountDetailItems}
            onNavigate={onNavigate}
          />
        </SettingsSection>
      )}

      {!accountForm && accounts.length === 0 && (
        <div className="settings-inline-status">添加第一个邮箱账号后，即可配置服务器、登录、身份、同步和隐私。</div>
      )}

      {addDialogOpen && (
        <AddAccountDialog
          form={newAccountForm}
          secret={newAccountSecret}
          secretVisible={newAccountSecretVisible}
          manualConfigOpen={newAccountManualConfigOpen}
          error={addAccountError}
          submitting={addAccountSubmitting}
          submittingStage={addAccountStage}
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

      {deleteDialogOpen && accountForm && (
        <AccountManageDialog
          mode="delete"
          account={accountForm}
          accountCount={accountCount}
          onClose={() => setDeleteDialogOpen(false)}
          onAccountChange={onAccountFormChange}
          onProtocolChange={switchAccountProtocol}
          onRemoveAccount={onRemoveAccount}
          onSaveAccountSettings={onSaveAccountSettings}
        />
      )}
    </>
  );
}
