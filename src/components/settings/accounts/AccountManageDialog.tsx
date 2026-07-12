import { X } from 'lucide-react';
import type { Account, IncomingProtocol } from '../../../app/types';
import AccountRemovalPanel from '../AccountRemovalPanel';
import {
  accountDialogTitle,
  protocolLabel,
  syncModeLabel,
  syncModeOptions,
  type AccountDialogMode,
} from './accountSettingsShared';

type AccountManageDialogProps = {
  mode: AccountDialogMode;
  account: Account;
  accountCount: number;
  onClose: () => void;
  onAccountChange: (account: Account) => void;
  onProtocolChange: (protocol: IncomingProtocol) => void;
  onRemoveAccount: () => Promise<void>;
};

export default function AccountManageDialog({
  mode,
  account,
  accountCount,
  onClose,
  onAccountChange,
  onProtocolChange,
  onRemoveAccount,
}: AccountManageDialogProps) {
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

        {mode === 'details' && (
          <div className="settings-account-detail-list">
            <span>
              <small>显示名称</small>
              <strong>{account.display_name || account.email}</strong>
            </span>
            <span>
              <small>服务商</small>
              <strong>{account.provider}</strong>
            </span>
            <span>
              <small>获取新邮件</small>
              <strong>{syncModeLabel(account.sync_mode)}</strong>
            </span>
            <span>
              <small>协议</small>
              <strong>{protocolLabel(account.incoming_protocol)} / SMTP</strong>
            </span>
            <span>
              <small>状态</small>
              <strong>{account.is_default ? '默认账号' : '普通账号'}</strong>
            </span>
          </div>
        )}

        {mode === 'edit' && (
          <div className="settings-account-form-grid">
            <label>
              显示名称
              <input
                value={account.display_name}
                onChange={(event) => onAccountChange({
                  ...account,
                  display_name: event.target.value,
                })}
              />
            </label>
            <label>
              获取新邮件时间
              <select
                value={account.sync_mode === 'push' ? '5min' : account.sync_mode}
                onChange={(event) => onAccountChange({ ...account, sync_mode: event.target.value })}
              >
                {syncModeOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
        )}

        {mode === 'config' && (
          <div className="settings-account-form-grid settings-account-config-grid">
            <label>
              服务商
              <input
                value={account.provider}
                onChange={(event) => onAccountChange({ ...account, provider: event.target.value })}
              />
            </label>
            <label>
              认证方式
              <select
                value={account.auth_type}
                onChange={(event) => onAccountChange({ ...account, auth_type: event.target.value })}
              >
                <option value="password">密码 / 授权码</option>
                <option value="oauth2">OAuth2 Token</option>
              </select>
            </label>
            <label>
              收信协议
              <select
                value={account.incoming_protocol}
                onChange={(event) => onProtocolChange(event.target.value as IncomingProtocol)}
              >
                <option value="imap">IMAP</option>
                <option value="pop3">POP3</option>
              </select>
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
