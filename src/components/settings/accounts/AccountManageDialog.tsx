import React from 'react';
import { createPortal } from 'react-dom';
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
import { SettingsButton, SettingsSwitch } from '../shared';
import useModalAccessibility from '../../../hooks/useModalAccessibility';

type AccountManageDialogProps = {
  mode: AccountDialogMode;
  account: Account;
  accountCount: number;
  onClose: () => void;
  onAccountChange: (account: Account) => void;
  onProtocolChange: (protocol: IncomingProtocol) => void;
  onRemoveAccount: (deleteSecret: boolean) => Promise<void>;
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
  const titleId = React.useId();
  const backdropRef = React.useRef<HTMLDivElement>(null);
  const dialogRef = React.useRef<HTMLElement>(null);

  useModalAccessibility({
    dialogRef,
    backdropRef,
    onEscape: onClose,
    escapeDisabled: submitting,
  });

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

  const content = (
    <div
      ref={backdropRef}
      className="settings-account-add-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="settings-account-add-dialog settings-account-manage-dialog"
        data-mode={mode}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header>
          <span>
            <strong id={titleId}>{accountDialogTitle(mode)}</strong>
            <small>{account.email}</small>
          </span>
          <button type="button" aria-label="关闭" onClick={onClose}>
            <X size={17} />
          </button>
        </header>

        {mode === 'config' && (
          <div className="st-section-body settings-account-form-grid-wrapper">
            <div className="settings-account-form-grid">
              <label>
                显示名
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
                  dense
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
                  dense
                  value={account.auth_type}
                  options={authTypeOptions}
                  onChange={(val) => onAccountChange({ ...account, auth_type: val })}
                />
              </label>
              <label>
                收信协议
                <CustomSelect
                  dense
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

            <div className="settings-account-risk-toggle">
              <SettingsSwitch
                label="跨邮箱发送风险提示"
                description="回复其他账号的邮件、收件人包含自己其他账号、快捷写信账号不一致时，在发送前提醒。"
                checked={account.cross_account_risk_warning !== false}
                onChange={(checked) => onAccountChange({
                  ...account,
                  cross_account_risk_warning: checked,
                })}
              />
            </div>

            <div className="settings-account-risk-toggle">
              <SettingsSwitch
                label="自动下载新邮件附件"
                description="开启后，同步时新到达邮件的附件会自动下载到本地；开启前已有的邮件附件不会自动下载。"
                checked={account.auto_download_attachments}
                onChange={(checked) => onAccountChange({
                  ...account,
                  auto_download_attachments: checked,
                })}
              />
            </div>

            {error && (
              <p className="settings-account-add-error" role="alert">
                {error}
              </p>
            )}

            <footer>
              <SettingsButton onClick={onClose} disabled={submitting}>取消</SettingsButton>
              <SettingsButton
                variant="primary"
                disabled={submitting}
                icon={<Save size={14} />}
                onClick={handleSave}
              >
                {submitting ? '保存中...' : '保存'}
              </SettingsButton>
            </footer>
          </div>
        )}

        {mode === 'delete' && (
          <AccountRemovalPanel
            account={account}
            accountCount={accountCount}
            embedded
            onRemove={async (deleteSecret) => {
              await onRemoveAccount(deleteSecret);
              onClose();
            }}
          />
        )}
      </section>
    </div>
  );

  const settingsModal = typeof document === 'undefined'
    ? null
    : document.querySelector<HTMLElement>('.settings-modal');
  return settingsModal ? createPortal(content, settingsModal) : content;
}
