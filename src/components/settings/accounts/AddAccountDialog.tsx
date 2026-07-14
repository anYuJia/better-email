import { Eye, EyeOff, Plus, X } from 'lucide-react';
import type { AccountCreateInput, IncomingProtocol } from '../../../app/types';
import type { AccountProviderPreset } from '../../../providerCatalog';
import ProviderPresetGrid from '../ProviderPresetGrid';
import {
  protocolHint,
  protocolLabel,
  syncModeOptions,
} from './accountSettingsShared';
import { CustomSelect } from './CustomSelect';

type AddAccountDialogProps = {
  form: AccountCreateInput;
  secret: string;
  secretVisible: boolean;
  manualConfigOpen: boolean;
  error: string;
  submitting: boolean;
  submittingStage?: string;
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

const authTypeOptions = [
  { value: 'password', label: '密码 / 授权码' },
  { value: 'oauth2', label: 'OAuth2 Token' },
] as const;

const protocolOptions = [
  { value: 'imap', label: 'IMAP' },
  { value: 'pop3', label: 'POP3' },
] as const;

export default function AddAccountDialog({
  form,
  secret,
  secretVisible,
  manualConfigOpen,
  error,
  submitting,
  submittingStage,
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

        <div className="settings-account-form-grid" style={{ marginBottom: '14px' }}>
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
            显示名称
            <input
              value={form.display_name}
              onChange={(event) => onFormChange({
                ...form,
                display_name: event.target.value,
              })}
              placeholder="默认使用邮箱地址"
            />
          </label>
          <label>
            获取新邮件时间
            <CustomSelect
              value={form.sync_mode === 'push' ? '5min' : form.sync_mode}
              options={syncModeOptions}
              onChange={(val) => onFormChange({ ...form, sync_mode: val })}
            />
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
                认证方式
                <CustomSelect
                  value={form.auth_type}
                  options={authTypeOptions}
                  onChange={(val) => onFormChange({ ...form, auth_type: val })}
                />
              </label>
              <label style={{ display: 'none' }} />
            </div>

            <div className="settings-account-protocol-grid" aria-label="邮件协议">
              <label>
                收信协议
                <CustomSelect
                  value={form.incoming_protocol}
                  options={protocolOptions}
                  onChange={(val) => onProtocolChange(val as IncomingProtocol)}
                />
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

        {submitting && (
          <div className="settings-account-add-progress" style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 12px',
            background: '#f4f8fc',
            borderRadius: '6px',
            border: '1px solid #dbebfa',
            margin: '0 0 12px 0',
            fontSize: '11px',
            color: '#465b70',
          }}>
            <div className="deferred-spinner" />
            <span>{submittingStage || '正在处理中，请稍候...'}</span>
          </div>
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
