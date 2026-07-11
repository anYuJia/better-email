import { useEffect, useState } from 'react';
import { Eye, EyeOff, Mail, Plus, X } from 'lucide-react';
import type { Account, AccountCreateInput, IncomingProtocol } from '../../../app/types';
import { incomingHostForProtocol, providerPresetForEmail, providerPresets } from '../../../providerCatalog';
import type { AccountProviderPreset } from '../../../providerCatalog';
import AccountRemovalPanel from '../AccountRemovalPanel';
import ProviderPresetGrid from '../ProviderPresetGrid';

type AccountDialogMode = 'details' | 'edit' | 'config' | 'delete';

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/^Error:\s*/i, '')
    .trim() || '添加失败，请检查邮箱和授权码。';
}

function protocolLabel(protocol: string) {
  return protocol === 'pop3' ? 'POP3' : 'IMAP';
}

function protocolHint(protocol: string) {
  return protocol === 'pop3'
    ? 'POP3 只同步收件箱，适合保留本地副本。'
    : 'IMAP 会同步远端文件夹和状态。';
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

  const canCreateAccount = newAccountForm.email.trim().length > 0
    && (newAccountForm.auth_type === 'oauth2' || newAccountSecret.trim().length > 0);

  async function handleCreateNewAccount() {
    if (!canCreateAccount || addAccountSubmitting) return;
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

  function openAccountDialog(account: Account, mode: AccountDialogMode) {
    onAccountFormChange(account);
    setAccountDialogMode(mode);
  }

  function closeAccountDialog() {
    setAccountDialogMode(null);
  }

  function providerPresetFor(provider: string) {
    const normalized = provider.trim().toLowerCase();
    return providerPresets.find((preset) => preset.provider === normalized || preset.id === normalized) ?? null;
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

  const newAccountSecretLabel = newAccountForm.auth_type === 'oauth2' ? 'OAuth2 Token' : '密码 / 授权码';
  const newAccountSecretPlaceholder = newAccountForm.provider === 'netease'
    ? '网易客户端授权码'
    : newAccountForm.provider === 'qq'
      ? 'QQ 邮箱授权码'
    : newAccountForm.auth_type === 'oauth2'
      ? '访问或刷新 Token'
      : '应用专用密码或授权码';
  const matchedNewAccountPreset = providerPresetForEmail(newAccountForm.email);
  const newAccountServerReady = Boolean(newAccountForm.imap_host.trim() && newAccountForm.smtp_host.trim());

  function dialogTitle(mode: AccountDialogMode) {
    if (mode === 'details') return '账号详情';
    if (mode === 'edit') return '修改账号';
    if (mode === 'config') return '账号配置';
    return '删除账号';
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
            const active = account.id === accountForm?.id;
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
                  onClick={() => openAccountDialog(account, 'details')}
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
                  <button type="button" onClick={() => openAccountDialog(account, 'details')}>
                    详情
                  </button>
                  <button type="button" onClick={() => openAccountDialog(account, 'edit')}>
                    修改
                  </button>
                  <button type="button" onClick={() => openAccountDialog(account, 'config')}>
                    配置
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => openAccountDialog(account, 'delete')}
                  >
                    删除
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      </section>

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
                <small>输入邮箱和授权码</small>
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
                  onChange={(event) => updateNewAccountEmail(event.target.value)}
                  placeholder="name@example.com"
                  aria-invalid={Boolean(addAccountError)}
                />
              </label>
              <label>
                {newAccountSecretLabel}
                <span className="settings-account-secret-field">
                  <input
                    autoComplete="new-password"
                    value={newAccountSecret}
                    type={newAccountSecretVisible ? 'text' : 'password'}
                    onChange={(event) => {
                      setAddAccountError('');
                      setNewAccountSecret(event.target.value);
                    }}
                    placeholder={newAccountSecretPlaceholder}
                    required={newAccountForm.auth_type !== 'oauth2'}
                    aria-invalid={Boolean(addAccountError)}
                  />
                  <button
                    type="button"
                    aria-label={newAccountSecretVisible ? '隐藏凭据' : '显示凭据'}
                    disabled={!newAccountSecret}
                    onClick={() => setNewAccountSecretVisible((visible) => !visible)}
                  >
                    {newAccountSecretVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </span>
              </label>
            </div>

            <div className="settings-account-auto-match" data-ready={newAccountServerReady}>
              <span>
                <strong>{matchedNewAccountPreset?.label ?? '自定义邮箱'}</strong>
                <small>
                  {newAccountServerReady
                    ? `${protocolLabel(newAccountForm.incoming_protocol)} ${newAccountForm.imap_host} · SMTP ${newAccountForm.smtp_host}`
                    : '未识别服务商，请打开手动配置填写服务器'}
                </small>
              </span>
              <button type="button" onClick={() => setNewAccountManualConfigOpen((open) => !open)}>
                {newAccountManualConfigOpen ? '收起配置' : '手动配置'}
              </button>
            </div>

            {newAccountManualConfigOpen && (
              <>
                <div className="settings-account-form-grid">
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

                <div className="settings-account-protocol-grid" aria-label="邮件协议">
                  <label>
                    收信协议
                    <select
                      value={newAccountForm.incoming_protocol}
                      onChange={(event) => {
                        setAddAccountError('');
                        switchNewAccountProtocol(event.target.value as IncomingProtocol);
                      }}
                    >
                      <option value="imap">IMAP</option>
                      <option value="pop3">POP3</option>
                    </select>
                  </label>
                  <span>
                    {protocolHint(newAccountForm.incoming_protocol)}
                  </span>
                </div>

                <ProviderPresetGrid
                  compact
                  activeProvider={newAccountForm.provider}
                  onSelect={onApplyNewAccountPreset}
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
                </div>
              </>
            )}

            {addAccountError && (
              <p className="settings-account-add-error" role="alert">
                {addAccountError}
              </p>
            )}

            <footer>
              <button type="button" className="settings-account-add-cancel" onClick={() => setAddDialogOpen(false)}>
                取消
              </button>
              <button
                type="button"
                className="settings-account-add-submit"
                disabled={!canCreateAccount || addAccountSubmitting}
                onClick={() => { handleCreateNewAccount(); }}
              >
                {!addAccountSubmitting && <Plus size={14} />}
                {addAccountSubmitting ? '添加中' : '添加'}
              </button>
            </footer>
          </section>
        </div>
      )}

      {accountDialogMode && accountForm && (
        <div
          className="settings-account-add-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeAccountDialog();
          }}
        >
          <section
            className="settings-account-add-dialog settings-account-manage-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-account-dialog-title"
          >
            <header>
              <span>
                <strong id="settings-account-dialog-title">{dialogTitle(accountDialogMode)}</strong>
                <small>{accountForm.email}</small>
              </span>
              <button type="button" aria-label="关闭" onClick={closeAccountDialog}>
                <X size={17} />
              </button>
            </header>

            {accountDialogMode === 'details' && (
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
                  <small>协议</small>
                  <strong>{protocolLabel(accountForm.incoming_protocol)} / SMTP</strong>
                </span>
                <span>
                  <small>状态</small>
                  <strong>{accountForm.is_default ? '默认账号' : '普通账号'}</strong>
                </span>
              </div>
            )}

            {accountDialogMode === 'edit' && (
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
            )}

            {accountDialogMode === 'config' && (
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
                    <option value="password">密码 / 授权码</option>
                    <option value="oauth2">OAuth2 Token</option>
                  </select>
                </label>
                <label>
                  收信协议
                  <select
                    value={accountForm.incoming_protocol}
                    onChange={(event) => switchAccountProtocol(event.target.value as IncomingProtocol)}
                  >
                    <option value="imap">IMAP</option>
                    <option value="pop3">POP3</option>
                  </select>
                </label>
                <label>
                  收信服务器（{protocolLabel(accountForm.incoming_protocol)}）
                  <input
                    value={accountForm.imap_host}
                    onChange={(event) => onAccountFormChange({ ...accountForm, imap_host: event.target.value })}
                  />
                </label>
                <label>
                  发信服务器（SMTP）
                  <input
                    value={accountForm.smtp_host}
                    onChange={(event) => onAccountFormChange({ ...accountForm, smtp_host: event.target.value })}
                  />
                </label>
              </div>
            )}

            {accountDialogMode === 'delete' && (
              <AccountRemovalPanel
                account={accountForm}
                accountCount={accountCount}
                embedded
                onRemove={async () => {
                  await onRemoveAccount();
                  closeAccountDialog();
                }}
              />
            )}
          </section>
        </div>
      )}
    </div>
  );
}
