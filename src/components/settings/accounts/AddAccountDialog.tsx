import { Eye, EyeOff, Plus, X } from 'lucide-react';
import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { AccountCreateInput, IncomingProtocol } from '../../../app/types';
import type { AccountProviderPreset } from '../../../providerCatalog';
import ProviderPresetGrid from '../ProviderPresetGrid';
import {
  protocolHint,
  protocolLabel,
  syncModeOptions,
} from './accountSettingsShared';
import { CustomSelect } from './CustomSelect';
import { SettingsButton } from '../shared';
import useModalAccessibility from '../../../hooks/useModalAccessibility';

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
  const titleId = useId();
  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);

  useModalAccessibility({
    dialogRef,
    backdropRef,
    initialFocusRef: emailInputRef,
    onEscape: onClose,
    escapeDisabled: submitting,
  });

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
        className="settings-account-add-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header>
          <span>
            <strong id={titleId}>添加邮箱</strong>
            <small>输入邮箱和授权码</small>
          </span>
          <button type="button" aria-label="关闭" onClick={onClose}>
            <X size={17} />
          </button>
        </header>

        <div className="st-section-body settings-account-form-grid">
          <label>
            邮箱地址
            <input
              ref={emailInputRef}
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
              dense
              value={form.sync_mode === 'push' ? '5min' : form.sync_mode}
              options={syncModeOptions}
              onChange={(val) => onFormChange({ ...form, sync_mode: val })}
            />
          </label>
        </div>

        <label className="settings-account-history-attachments">
          <input
            type="checkbox"
            checked={form.fetch_history_attachments === true}
            onChange={(event) => onFormChange({
              ...form,
              fetch_history_attachments: event.target.checked,
            })}
          />
          <span>
            <strong>读取历史邮件附件信息</strong>
            <small>正文照常同步；附件内容仅在点击下载时获取。</small>
          </span>
        </label>

        <div className="settings-account-auto-match" data-ready={serverReady}>
          <span>
            <strong>{matchedProviderLabel}</strong>
            <small>
              {serverReady
                ? `${protocolLabel(form.incoming_protocol)} ${form.imap_host} · SMTP ${form.smtp_host}`
                : '未识别服务商，请打开手动配置填写服务器'}
            </small>
          </span>
          <SettingsButton size="sm" onClick={() => onManualConfigOpenChange(!manualConfigOpen)}>
            {manualConfigOpen ? '收起配置' : '手动配置'}
          </SettingsButton>
        </div>

        {manualConfigOpen && (
          <div className="st-section-body dialog-nested-body">
            <div className="settings-account-form-grid">
              <label>
                认证方式
                <CustomSelect
                  dense
                  value={form.auth_type}
                  options={authTypeOptions}
                  onChange={(val) => onFormChange({ ...form, auth_type: val })}
                />
              </label>
            </div>

            <div className="settings-account-protocol-grid" aria-label="邮件协议">
              <label>
                收信协议
                <CustomSelect
                  dense
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
          </div>
        )}

        {error && (
          <p className="settings-account-add-error" role="alert">
            {error}
          </p>
        )}

        {submitting && (
          <div className="settings-account-add-progress">
            <div className="deferred-spinner" />
            <span>{submittingStage || '正在处理中，请稍候...'}</span>
          </div>
        )}

        <footer>
          <SettingsButton onClick={onClose}>取消</SettingsButton>
          <SettingsButton
            variant="primary"
            disabled={!canSubmit || submitting}
            icon={!submitting ? <Plus size={14} /> : undefined}
            onClick={onSubmit}
          >
            {submitting ? '添加中' : '添加'}
          </SettingsButton>
        </footer>
      </section>
    </div>
  );

  const settingsModal = typeof document === 'undefined'
    ? null
    : document.querySelector<HTMLElement>('.settings-modal');
  return settingsModal ? createPortal(content, settingsModal) : content;
}
