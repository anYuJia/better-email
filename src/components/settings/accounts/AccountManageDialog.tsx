import React from 'react';
import { X, Save } from 'lucide-react';
import type { Account, IncomingProtocol } from '../../../app/types';
import AccountRemovalPanel from '../AccountRemovalPanel';
import {
  accountDialogTitle,
  protocolLabel,
  syncModeOptions,
  type AccountDialogMode,
} from './accountSettingsShared';
import { CustomSelect } from './CustomSelect';

type AccountManageDialogProps = {
  mode: AccountDialogMode;
  account: Account;
  accountCount: number;
  onClose: () => void;
  onAccountChange: (account: Account) => void;
  onProtocolChange: (protocol: IncomingProtocol) => void;
  onRemoveAccount: () => Promise<void>;
  onSaveAccountSettings?: (account: Account) => Promise<void>;
};

const authTypeOptions = [
  { value: 'password', label: '密码 / 授权码' },
  { value: 'oauth2', label: 'OAuth2 Token' },
] as const;

const protocolOptions = [
  { value: 'imap', label: 'IMAP' },
  { value: 'pop3', label: 'POP3' },
] as const;

export default function AccountManageDialog({
  mode,
  account,
  accountCount,
  onClose,
  onAccountChange,
  onProtocolChange,
  onRemoveAccount,
  onSaveAccountSettings,
}: AccountManageDialogProps) {
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState('');

  async function handleSave() {
    if (!onSaveAccountSettings) return;
    setSubmitting(true);
    setError('');
    try {
      await onSaveAccountSettings(account);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="settings-account-add-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
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
            <strong id="settings-account-dialog-title">{accountDialogTitle(mode)}</strong>
            <small>{account.email}</small>
          </span>
          <button type="button" aria-label="关闭" onClick={onClose}>
            <X size={17} />
          </button>
        </header>

        {mode === 'config' && (
          <div className="settings-account-form-grid-wrapper">
            <div className="settings-account-form-grid settings-account-config-grid" style={{ marginBottom: '16px' }}>
              <label>
                显示名称
                <input
                  value={account.display_name}
                  onChange={(event) => onAccountChange({
                    ...account,
                    display_name: event.target.value,
                  })}
                  placeholder="默认使用邮箱地址"
                />
              </label>
              <label>
                获取新邮件时间
                <CustomSelect
                  value={account.sync_mode === 'push' ? '5min' : account.sync_mode}
                  options={syncModeOptions}
                  onChange={(val) => onAccountChange({ ...account, sync_mode: val })}
                />
              </label>
              <label>
                服务商
                <input
                  value={account.provider}
                  onChange={(event) => onAccountChange({ ...account, provider: event.target.value })}
                />
              </label>
              <label>
                认证方式
                <CustomSelect
                  value={account.auth_type}
                  options={authTypeOptions}
                  onChange={(val) => onAccountChange({ ...account, auth_type: val })}
                />
              </label>
              <label>
                收信协议
                <CustomSelect
                  value={account.incoming_protocol}
                  options={protocolOptions}
                  onChange={(val) => onProtocolChange(val as IncomingProtocol)}
                />
              </label>
              <label>
                收信服务器（{protocolLabel(account.incoming_protocol)}）
                <input
                  value={account.imap_host}
                  onChange={(event) => onAccountChange({ ...account, imap_host: event.target.value })}
                />
              </label>
              <label>
                发信服务器（SMTP）
                <input
                  value={account.smtp_host}
                  onChange={(event) => onAccountChange({ ...account, smtp_host: event.target.value })}
                />
              </label>
            </div>

            {error && (
              <p className="settings-account-add-error" role="alert" style={{ margin: '0 0 12px 0' }}>
                {error}
              </p>
            )}

            <footer style={{ marginTop: '20px' }}>
              <button type="button" className="settings-account-add-cancel" onClick={onClose} disabled={submitting}>
                取消
              </button>
              <button
                type="button"
                className="settings-account-add-submit"
                disabled={submitting}
                onClick={handleSave}
              >
                <Save size={14} />
                {submitting ? '保存中...' : '保存'}
              </button>
            </footer>
          </div>
        )}

        {mode === 'delete' && (
          <AccountRemovalPanel
            account={account}
            accountCount={accountCount}
            embedded
            onRemove={async () => {
              await onRemoveAccount();
              onClose();
            }}
          />
        )}
      </section>
    </div>
  );
}
