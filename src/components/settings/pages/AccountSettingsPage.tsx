import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Account, AccountCreateInput, AccountScope, IncomingProtocol } from '../../../app/types';
import {
  MIXED_ACCOUNT_SETTING_VALUE,
  type AccountScopedSettingKey,
} from '../../../app/accountScopedSettings';
import type { SettingsAccountValueChange, SettingsAccountValues } from '../accountScopeTypes';
import { incomingHostForProtocol, providerPresetForEmail, providerPresets } from '../../../providerCatalog';
import type { AccountProviderPreset } from '../../../providerCatalog';
import {
  settingsAccountConfigurationItems,
  type SettingsSectionId,
} from '../settingsNavigation';
import AddAccountDialog from '../accounts/AddAccountDialog';
import AccountManageDialog from '../accounts/AccountManageDialog';
import { accountFormForEmail, accountFormForIncomingProtocol } from '../accounts/accountSetupForm';
import SettingsDestinationList from '../SettingsDestinationList';
import {
  SettingsField,
  SettingsButton,
  SettingsEmptyState,
  SettingsNotice,
  SettingsRow,
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
  accountScope: AccountScope;
  accountForm: Account | null;
  accountValues: SettingsAccountValues;
  accountCount: number;
  accountSwitchDisabled?: boolean;
  newAccountForm: AccountCreateInput;
  onAccountFormChange: (account: Account) => void;
  onAccountValueChange: SettingsAccountValueChange;
  onNewAccountFormChange: (account: AccountCreateInput) => void;
  onApplyNewAccountPreset: (preset: AccountProviderPreset) => void;
  onCreateNewAccount: (secret?: string, onProgress?: (stage: string) => void) => Promise<void>;
  onRemoveAccount: (deleteSecret: boolean) => Promise<void>;
  onSaveAccountSettings?: (account: Account) => Promise<void>;
  onNavigate: (section: SettingsSectionId) => void;
};

export default function AccountSettingsPage({
  accounts,
  accountScope,
  accountForm,
  accountCount,
  accountValues,
  accountSwitchDisabled = false,
  newAccountForm,
  onAccountFormChange,
  onAccountValueChange,
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

  const activeProviderLabel = accountForm
    ? providerPresetFor(accountForm.provider)?.label ?? accountForm.provider
    : '';

  const updateBooleanSetting = (key: AccountScopedSettingKey, checked: boolean) => {
    if (accountScope === 'all') {
      onAccountValueChange(key, checked);
      return;
    }
    if (accountForm) onAccountFormChange({ ...accountForm, [key]: checked });
  };

  const readBooleanSetting = (key: AccountScopedSettingKey) => (
    accountScope === 'all' ? accountValues[key] : accountForm?.[key]
  );

  const crossAccountRiskWarning = readBooleanSetting('cross_account_risk_warning');
  const autoDownloadAttachments = readBooleanSetting('auto_download_attachments');

  const openAddAccount = () => {
    setDeleteDialogOpen(false);
    setAddDialogOpen(true);
  };

  const addAccountAction = (
    <SettingsButton
      variant="primary"
      size="sm"
      className="settings-desktop-account-add"
      icon={<Plus size={14} />}
      disabled={accountSwitchDisabled}
      title={accountSwitchDisabled ? '请先保存或放弃当前账号的修改' : undefined}
      onClick={openAddAccount}
    >
      添加账号
    </SettingsButton>
  );

  return (
    <>
      <div className="settings-account-stack">
        {accountScope === 'all' ? (
          <>
            <SettingsSection
              title="所有邮箱账号"
              description="统一范围用于批量编辑账号偏好；服务器、认证、身份和文件夹映射请先选择具体账号。"
              actions={addAccountAction}
              className="settings-account-overview"
              dataSection="account-overview"
            >
              {accounts.length === 0 ? (
                <SettingsEmptyState>
                  添加第一个邮箱账号后，即可配置服务器、登录、身份、同步和隐私。
                </SettingsEmptyState>
              ) : (
                <SettingsNotice tone="info" title="顶部已统一管理邮箱范围">
                  <p>切换邮箱账号、设为默认或添加账号都在页面顶部完成。下面的账号偏好会在保存后应用到所有支持的账号。</p>
                </SettingsNotice>
              )}
            </SettingsSection>

            {accounts.length > 0 && (
              <SettingsSection
                title="账号偏好"
                description="只修改你主动调整的项目；未修改的账号字段会保持原值。"
                dataSection="account-preferences"
              >
                <SettingsSwitch
                  label="跨邮箱发送提醒"
                  description={crossAccountRiskWarning === MIXED_ACCOUNT_SETTING_VALUE
                    ? '不同邮箱账号当前设置不同。修改后会统一应用。'
                    : '发件账号与当前邮件所属账号不一致时提醒。'}
                  checked={crossAccountRiskWarning === true}
                  indeterminate={crossAccountRiskWarning === MIXED_ACCOUNT_SETTING_VALUE}
                  onChange={(checked) => updateBooleanSetting('cross_account_risk_warning', checked)}
                />
                <SettingsSwitch
                  label="自动下载新邮件附件"
                  description={autoDownloadAttachments === MIXED_ACCOUNT_SETTING_VALUE
                    ? '不同邮箱账号当前设置不同。修改后会统一应用。'
                    : '新附件保存到默认下载位置，邮件正文仍按需加载。'}
                  checked={autoDownloadAttachments === true}
                  indeterminate={autoDownloadAttachments === MIXED_ACCOUNT_SETTING_VALUE}
                  onChange={(checked) => updateBooleanSetting('auto_download_attachments', checked)}
                />
              </SettingsSection>
            )}
          </>
        ) : accountForm ? (
          <div
            className="settings-account-detail"
            data-current-account-id={accountForm.id}
          >
            <SettingsSection
              title="账号设置"
              description="服务器、登录、发件身份、同步与隐私。"
              className="settings-mobile-detail-navigation"
              dataSection="account-details"
            >
              <SettingsDestinationList
                ariaLabel="账号详细设置"
                items={settingsAccountConfigurationItems}
                onNavigate={onNavigate}
              />
            </SettingsSection>

            <SettingsSection
              title={accountForm.display_name || accountForm.email}
              description={[
                accountForm.email,
                activeProviderLabel,
                accountForm.is_default ? '默认发件账号' : '',
              ].filter(Boolean).join(' · ')}
              actions={addAccountAction}
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
              </div>

              <SettingsSection
                title="账号偏好"
                description="影响当前邮箱账号的发送与附件处理。"
                dataSection="account-preferences"
              >
                <SettingsSwitch
                  label="跨邮箱发送提醒"
                  description="发件账号与当前邮件所属账号不一致时提醒。"
                  checked={crossAccountRiskWarning === true}
                  onChange={(checked) => updateBooleanSetting('cross_account_risk_warning', checked)}
                />
                <SettingsSwitch
                  label="自动下载新邮件附件"
                  description="新附件保存到默认下载位置，邮件正文仍按需加载。"
                  checked={autoDownloadAttachments === true}
                  onChange={(checked) => updateBooleanSetting('auto_download_attachments', checked)}
                />
              </SettingsSection>

              <SettingsRow
                title="移除账号"
                description="停止在 Better Email 中管理此账号。"
                className="settings-account-remove-row"
                control={(
                  <SettingsButton
                    variant="danger-secondary"
                    size="sm"
                    icon={<Trash2 size={13} />}
                    disabled={accountSwitchDisabled}
                    title={accountSwitchDisabled ? '请先保存或放弃当前账号的修改' : '移除此邮箱账号'}
                    onClick={() => {
                      setAddDialogOpen(false);
                      setDeleteDialogOpen(true);
                    }}
                  >
                    移除账号
                  </SettingsButton>
                )}
              />
            </SettingsSection>
          </div>
        ) : (
          <SettingsSection
            title="账户信息"
            description="添加账号后，每个账号都拥有独立的连接与偏好设置。"
            actions={addAccountAction}
            className="settings-account-detail-empty"
          >
            <SettingsEmptyState>
              添加第一个邮箱账号后，即可配置服务器、登录、身份、同步和隐私。
            </SettingsEmptyState>
          </SettingsSection>
        )}
      </div>

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
