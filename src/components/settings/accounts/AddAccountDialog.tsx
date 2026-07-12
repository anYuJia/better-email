import { Eye, EyeOff, Plus, X } from 'lucide-react';
import type { AccountCreateInput, IncomingProtocol } from '../../../app/types';
import type { AccountProviderPreset } from '../../../providerCatalog';
import ProviderPresetGrid from '../ProviderPresetGrid';
import {
  protocolHint,
  protocolLabel,
  syncModeOptions,
} from './accountSettingsShared';

type AddAccountDialogProps = {
  form: AccountCreateInput;
  secret: string;
  secretVisible: boolean;
  manualConfigOpen: boolean;
  error: string;
  submitting: boolean;
  canSubmit: boolean;
  requiresSecret: boolean;
  secretLabel: string;
  secretPlaceholder: string;
  matchedProviderLabel: string;
  serverReady: boolean;
  onClose: () => void;
  onSubmit: () => void;
  onSecretChange: (secret: string) => void;
  onSecretVisibleChange: (visible: boolean) => void;
  onManualConfigOpenChange: (open: boolean) => void;
  onEmailChange: (email: string) => void;
  onFormChange: (form: AccountCreateInput) => void;
  onProtocolChange: (protocol: IncomingProtocol) => void;
  onApplyPreset: (preset: AccountProviderPreset) => void;
};

export default function AddAccountDialog({
  form,
  secret,
  secretVisible,
  manualConfigOpen,
  error,
  submitting,
  canSubmit,
  requiresSecret,
  secretLabel,
  secretPlaceholder,
  matchedProviderLabel,
  serverReady,
  onClose,
  onSubmit,
  onSecretChange,
  onSecretVisibleChange,
  onManualConfigOpenChange,
  onEmailChange,
  onFormChange,
  onProtocolChange,
  onApplyPreset,
}: AddAccountDialogProps) {
  return (
    <div
      className="settings-account-add-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
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
          <button type="button" aria-label="关闭" onClick={onClose}>
            <X size={17} />
          </button>
        </header>

        <div className="settings-account-form-grid">
          <label>
            邮箱地址
            <input
              autoFocus
              value={form.email}
              onChange={(event) => onEmailChange(event.target.value)}
              placeholder="name@example.com"
              aria-invalid={Boolean(error)}
            />
          </label>
          <label>
            {secretLabel}
            <span className="settings-account-secret-field">
              <input
                autoComplete="new-password"
                value={secret}
                type={secretVisible ? 'text' : 'password'}
                onChange={(event) => onSecretChange(event.target.value)}
                placeholder={secretPlaceholder}
                required={requiresSecret}
                aria-invalid={Boolean(error)}
              />
              <button
                type="button"
                aria-label={secretVisible ? '隐藏凭据' : '显示凭据'}
                disabled={!secret}
                onClick={() => onSecretVisibleChange(!secretVisible)}
              >
                {secretVisible ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </span>
          </label>
          <label>
            获取新邮件时间
            <select
              value={form.sync_mode === 'push' ? '5min' : form.sync_mode}
              onChange={(event) => onFormChange({
                ...form,
                sync_mode: event.target.value,
              })}
            >
              {syncModeOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="settings-account-auto-match" data-ready={serverReady}>
          <span>
            <strong>{matchedProviderLabel}</strong>
            <small>
              {serverReady
                ? `${protocolLabel(form.incoming_protocol)} ${form.imap_host} · SMTP ${form.smtp_host}`
                : '未识别服务商，请打开手动配置填写服务器'}
            </small>
          </span>
          <button type="button" onClick={() => onManualConfigOpenChange(!manualConfigOpen)}>
            {manualConfigOpen ? '收起配置' : '手动配置'}
          </button>
        </div>

        {manualConfigOpen && (
          <>
            <div className="settings-account-form-grid">
              <label>
                显示名称
                <input
                  value={form.display_name}
                  onChange={(event) => onFormChange({
                    ...form,
                    display_name: event.target.value,
                  })}
                  placeholder="可选"
                />
              </label>
              <label>
                认证方式
                <select
                  value={form.auth_type}
                  onChange={(event) => onFormChange({
                    ...form,
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
                  value={form.incoming_protocol}
                  onChange={(event) => onProtocolChange(event.target.value as IncomingProtocol)}
                >
                  <option value="imap">IMAP</option>
                  <option value="pop3">POP3</option>
                </select>
              </label>
              <span>
                {protocolHint(form.incoming_protocol)}
              </span>
            </div>

            <ProviderPresetGrid
              compact
              activeProvider={form.provider}
              onSelect={onApplyPreset}
            />

            <div className="settings-account-form-grid">
              <label>
                收信服务器（{protocolLabel(form.incoming_protocol)}）
                <input
                  value={form.imap_host}
                  onChange={(event) => onFormChange({
                    ...form,
                    imap_host: event.target.value,
                  })}
                />
              </label>
              <label>
                发信服务器（SMTP）
                <input
                  value={form.smtp_host}
                  onChange={(event) => onFormChange({
                    ...form,
                    smtp_host: event.target.value,
                  })}
                />
              </label>
            </div>
          </>
        )}

        {error && (
          <p className="settings-account-add-error" role="alert">
            {error}
          </p>
        )}

        <footer>
          <button type="button" className="settings-account-add-cancel" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="settings-account-add-submit"
            disabled={!canSubmit || submitting}
            onClick={onSubmit}
          >
            {!submitting && <Plus size={14} />}
            {submitting ? '添加中' : '添加'}
          </button>
        </footer>
      </section>
    </div>
  );
}
