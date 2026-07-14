import { useEffect, useState } from 'react';
import type { Account, AccountCreateInput, IncomingProtocol } from '../../../app/types';
import { incomingHostForProtocol, providerPresetForEmail, providerPresets } from '../../../providerCatalog';
import type { AccountProviderPreset } from '../../../providerCatalog';
import AccountList from '../accounts/AccountList';
import AddAccountDialog from '../accounts/AddAccountDialog';
import AccountManageDialog from '../accounts/AccountManageDialog';
import type { AccountDialogMode } from '../accounts/accountSettingsShared';

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
  onRemoveAccount: () => Promise<void>;
  onSaveAccountSettings?: (account: Account) => Promise<void>;
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
}: AccountSettingsPageProps) {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newAccountSecret, setNewAccountSecret] = useState('');
  const [newAccountSecretVisible, setNewAccountSecretVisible] = useState(false);
  const [newAccountManualConfigOpen, setNewAccountManualConfigOpen] = useState(false);
  const [addAccountError, setAddAccountError] = useState('');
  const [addAccountSubmitting, setAddAccountSubmitting] = useState(false);
  const [addAccountStage, setAddAccountStage] = useState('');
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
    const domain = email.trim().toLowerCase().split('@').pop() ?? '';
    const preset = providerPresetForEmail(email);
    const localPart = email.trim().split('@')[0] || '';
    if (!preset) {
      if (domain && domain !== email.trim().toLowerCase()) {
        const isPop = newAccountForm.incoming_protocol === 'pop3';
        onNewAccountFormChange({
          ...newAccountForm,
          email,
          display_name: newAccountForm.display_name || localPart,
          imap_host: isPop ? `pop.${domain}:995` : `imap.${domain}:993`,
          smtp_host: `smtp.${domain}:465`,
        });
      } else {
        onNewAccountFormChange({
          ...newAccountForm,
          email,
          display_name: newAccountForm.display_name || localPart,
        });
      }
      return;
    }
    onNewAccountFormChange({
      ...newAccountForm,
      email,
      display_name: newAccountForm.display_name || preset.label,
      provider: preset.provider,
      imap_host: incomingHostForProtocol(preset, newAccountForm.incoming_protocol),
      smtp_host: preset.smtp_host,
      auth_type: 'password',
    });
  }

  function switchNewAccountProtocol(nextProtocol: IncomingProtocol) {
    const preset = providerPresetFor(newAccountForm.provider);
    setAddAccountError('');
    let nextImapHost = newAccountForm.imap_host;
    if (!preset) {
      const domain = newAccountForm.email.trim().toLowerCase().split('@').pop() ?? '';
      if (domain && domain !== newAccountForm.email.trim().toLowerCase()) {
        nextImapHost = nextProtocol === 'pop3' ? `pop.${domain}:995` : `imap.${domain}:993`;
      }
    } else {
      nextImapHost = incomingHostForProtocol(preset, nextProtocol);
    }
    onNewAccountFormChange({
      ...newAccountForm,
      incoming_protocol: nextProtocol,
      imap_host: nextImapHost,
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

      {accountDialogMode && accountForm && (
        <AccountManageDialog
          mode={accountDialogMode}
          account={accountForm}
          accountCount={accountCount}
          onClose={() => setAccountDialogMode(null)}
          onAccountChange={onAccountFormChange}
          onProtocolChange={switchAccountProtocol}
          onRemoveAccount={onRemoveAccount}
          onSaveAccountSettings={onSaveAccountSettings}
        />
      )}
    </div>
  );
}
