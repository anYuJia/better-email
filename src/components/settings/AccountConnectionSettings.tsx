import { Plus, Save } from 'lucide-react';
import {
  providerCompatibilityMatrix,
  providerPresets,
  type AccountProviderPreset,
} from '../../providerCatalog';
import {
  providerVerificationLabel,
} from '../../app/appConfig';
import type {
  Account,
  AccountCreateInput,
  OAuthCallbackReport,
  OAuthRefreshReport,
  OAuthSession,
  OAuthStartReport,
  OAuthTokenExchangeReport,
  ProviderVerificationRecord,
  ProviderVerificationStatus,
} from '../../app/types';
import { formatDate } from '../../mailUtils';
import OAuthSettingsPanel from './OAuthSettingsPanel';
import './account-settings.css';

type AccountConnectionSettingsProps = {
  accountForm: Account;
  newAccountForm: AccountCreateInput;
  providerVerifications: Record<string, ProviderVerificationRecord>;
  activeProviderVerification: ProviderVerificationRecord | null;
  oauthClientId: string;
  oauthClientSecret: string;
  oauthRedirectUri: string;
  oauthCallbackState: string;
  oauthCallbackCode: string;
  oauthReport: OAuthStartReport | null;
  oauthCallbackReport: OAuthCallbackReport | null;
  oauthExchangeReport: OAuthTokenExchangeReport | null;
  oauthRefreshReport: OAuthRefreshReport | null;
  oauthSessions: OAuthSession[];
  onAccountFormChange: (account: Account) => void;
  onNewAccountFormChange: (account: AccountCreateInput) => void;
  onApplyProviderPreset: (preset: AccountProviderPreset) => void;
  onApplyNewAccountPreset: (preset: AccountProviderPreset) => void;
  onCreateNewAccount: () => void;
  onUpdateProviderVerification: (providerName: string, patch: Partial<ProviderVerificationRecord>) => void;
  onSaveProviderVerification: () => void;
  onOauthClientIdChange: (value: string) => void;
  onOauthClientSecretChange: (value: string) => void;
  onOauthRedirectUriChange: (value: string) => void;
  onOauthCallbackStateChange: (value: string) => void;
  onOauthCallbackCodeChange: (value: string) => void;
  onStartOAuth2Pkce: () => void;
  onRefreshOAuth2Token: () => void;
  onCompleteOAuth2Callback: () => void;
  onWaitForOAuth2Callback: () => void;
  onExchangeOAuth2Token: (sessionId: number) => void;
};

type ProviderPresetGridProps = {
  activeProvider: string;
  compact?: boolean;
  onSelect: (preset: AccountProviderPreset) => void;
};

function ProviderPresetGrid({
  activeProvider,
  compact = false,
  onSelect,
}: ProviderPresetGridProps) {
  return (
    <section
      className={`provider-presets settings-provider-presets${compact ? ' compact' : ''}`}
      aria-label={compact ? '新账号服务商预设' : '服务商预设'}
    >
      {providerPresets.map((preset) => (
        <button
          type="button"
          className={activeProvider === preset.provider ? 'active' : ''}
          key={preset.id}
          onClick={() => onSelect(preset)}
        >
          <strong>{preset.label}</strong>
          <span>{preset.hint}</span>
        </button>
      ))}
    </section>
  );
}

export default function AccountConnectionSettings({
  accountForm,
  newAccountForm,
  providerVerifications,
  activeProviderVerification,
  oauthClientId,
  oauthClientSecret,
  oauthRedirectUri,
  oauthCallbackState,
  oauthCallbackCode,
  oauthReport,
  oauthCallbackReport,
  oauthExchangeReport,
  oauthRefreshReport,
  oauthSessions,
  onAccountFormChange,
  onNewAccountFormChange,
  onApplyProviderPreset,
  onApplyNewAccountPreset,
  onCreateNewAccount,
  onUpdateProviderVerification,
  onSaveProviderVerification,
  onOauthClientIdChange,
  onOauthClientSecretChange,
  onOauthRedirectUriChange,
  onOauthCallbackStateChange,
  onOauthCallbackCodeChange,
  onStartOAuth2Pkce,
  onRefreshOAuth2Token,
  onCompleteOAuth2Callback,
  onWaitForOAuth2Callback,
  onExchangeOAuth2Token,
}: AccountConnectionSettingsProps) {
  return (
    <div className="settings-account-stack">
      <details className="settings-disclosure add-account-disclosure" data-settings-section="accounts">
        <summary>
          <span>
            <strong>添加邮箱账号</strong>
            <em>选择服务商预设并填写邮箱地址</em>
          </span>
          <b>添加</b>
        </summary>
        <section className="tool-panel settings-add-account-panel">
          <header className="tool-header">
            <span>
              <strong>新增账号</strong>
              <small>凭据将在账号创建后单独写入系统安全存储</small>
            </span>
            <button type="button" onClick={onCreateNewAccount}>
              <Plus size={14} />
              创建账号
            </button>
          </header>
          <div className="settings-account-form-grid">
            <label>
              邮箱地址
              <input
                value={newAccountForm.email}
                onChange={(event) => onNewAccountFormChange({ ...newAccountForm, email: event.target.value })}
                placeholder="name@example.com"
              />
            </label>
            <label>
              显示名称
              <input
                value={newAccountForm.display_name}
                onChange={(event) => onNewAccountFormChange({
                  ...newAccountForm,
                  display_name: event.target.value,
                })}
                placeholder="留空则使用邮箱地址"
              />
            </label>
          </div>
          <ProviderPresetGrid
            compact
            activeProvider={newAccountForm.provider}
            onSelect={onApplyNewAccountPreset}
          />
          <div className="settings-account-form-grid">
            <label>
              IMAP
              <input
                value={newAccountForm.imap_host}
                onChange={(event) => onNewAccountFormChange({
                  ...newAccountForm,
                  imap_host: event.target.value,
                })}
              />
            </label>
            <label>
              SMTP
              <input
                value={newAccountForm.smtp_host}
                onChange={(event) => onNewAccountFormChange({
                  ...newAccountForm,
                  smtp_host: event.target.value,
                })}
              />
            </label>
          </div>
        </section>
      </details>

      <section className="tool-panel settings-current-account-panel">
        <header className="tool-header">
          <span>
            <strong>当前账号</strong>
            <small>{accountForm.email}</small>
          </span>
          <em>{accountForm.provider}</em>
        </header>
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
            服务商
            <input
              value={accountForm.provider}
              onChange={(event) => onAccountFormChange({ ...accountForm, provider: event.target.value })}
            />
          </label>
        </div>
        <ProviderPresetGrid
          activeProvider={accountForm.provider}
          onSelect={onApplyProviderPreset}
        />
        <div className="settings-account-form-grid">
          <label>
            IMAP
            <input
              value={accountForm.imap_host}
              onChange={(event) => onAccountFormChange({ ...accountForm, imap_host: event.target.value })}
            />
          </label>
          <label>
            SMTP
            <input
              value={accountForm.smtp_host}
              onChange={(event) => onAccountFormChange({ ...accountForm, smtp_host: event.target.value })}
            />
          </label>
          <label data-settings-section="auth">
            认证方式
            <select
              value={accountForm.auth_type}
              onChange={(event) => onAccountFormChange({ ...accountForm, auth_type: event.target.value })}
            >
              <option value="password">应用专用密码 / 授权码</option>
              <option value="oauth2">OAuth2 Token</option>
            </select>
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
      </section>

      <details className="settings-disclosure" data-settings-section="providers">
        <summary>
          <span>
            <strong>服务商兼容性与真实验证</strong>
            <em>预设、IMAP/SMTP/OAuth 状态和限制</em>
          </span>
          <b>{providerVerificationLabel(activeProviderVerification?.status ?? 'untested')}</b>
        </summary>
        <section className="provider-matrix settings-provider-matrix" aria-label="服务商兼容性矩阵">
          <header>
            <strong>兼容性矩阵</strong>
            <span>预设已内置，真实账号验证可按服务商记录</span>
          </header>
          {providerCompatibilityMatrix.map((provider) => (
            <button
              type="button"
              className={accountForm.provider === provider.provider ? 'active' : ''}
              key={provider.id}
              onClick={() => onApplyProviderPreset(provider)}
            >
              <strong>{provider.label}</strong>
              <span>
                {provider.auth_type === 'oauth2' ? 'OAuth2' : '授权码'}
                {' · '}{provider.imap_host} · {provider.smtp_host}
              </span>
              <small>{provider.setup}</small>
              <em>
                {provider.tested_status === 'needs-account' ? '需真实账号验证' : '预设可用'}
                {' · '}{provider.limitations}
              </em>
              {providerVerifications[provider.id] && (
                <small>
                  本地验证：{providerVerificationLabel(providerVerifications[provider.id].status)}
                  {providerVerifications[provider.id].checked_at
                    ? ` · ${formatDate(providerVerifications[provider.id].checked_at)}`
                    : ''}
                </small>
              )}
            </button>
          ))}
        </section>
        {activeProviderVerification && (
          <section className="tool-panel settings-provider-verification">
            <header className="tool-header">
              <span>
                <strong>真实账号验证记录</strong>
                <small>记录当前服务商在真实账号环境下的可用性</small>
              </span>
              <em>{providerVerificationLabel(activeProviderVerification.status)}</em>
            </header>
            <label>
              验证状态
              <select
                value={activeProviderVerification.status}
                onChange={(event) => onUpdateProviderVerification(accountForm.provider, {
                  status: event.target.value as ProviderVerificationStatus,
                })}
              >
                <option value="untested">未验证</option>
                <option value="passed">通过</option>
                <option value="partial">部分通过</option>
                <option value="failed">失败</option>
              </select>
            </label>
            <div className="settings-toggle-grid">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={activeProviderVerification.imap_ok}
                  onChange={(event) => onUpdateProviderVerification(accountForm.provider, {
                    imap_ok: event.target.checked,
                  })}
                />
                <span>
                  <strong>IMAP 已通过</strong>
                  <small>登录、文件夹发现和邮件头同步</small>
                </span>
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={activeProviderVerification.smtp_ok}
                  onChange={(event) => onUpdateProviderVerification(accountForm.provider, {
                    smtp_ok: event.target.checked,
                  })}
                />
                <span>
                  <strong>SMTP 已通过</strong>
                  <small>普通文本、HTML 和附件发送</small>
                </span>
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={activeProviderVerification.oauth_ok}
                  onChange={(event) => onUpdateProviderVerification(accountForm.provider, {
                    oauth_ok: event.target.checked,
                  })}
                />
                <span>
                  <strong>OAuth2 已通过</strong>
                  <small>PKCE、刷新和 XOAUTH2 登录</small>
                </span>
              </label>
            </div>
            <label>
              备注
              <textarea
                value={activeProviderVerification.notes}
                onChange={(event) => onUpdateProviderVerification(accountForm.provider, {
                  notes: event.target.value,
                })}
                placeholder="记录失败原因、租户限制、授权码策略或附件/HTML 样本问题"
              />
            </label>
            <button type="button" className="settings-primary-action" onClick={onSaveProviderVerification}>
              <Save size={14} />
              保存验证记录
            </button>
          </section>
        )}
      </details>

      <OAuthSettingsPanel
        authType={accountForm.auth_type}
        clientId={oauthClientId}
        clientSecret={oauthClientSecret}
        redirectUri={oauthRedirectUri}
        callbackState={oauthCallbackState}
        callbackCode={oauthCallbackCode}
        report={oauthReport}
        callbackReport={oauthCallbackReport}
        exchangeReport={oauthExchangeReport}
        refreshReport={oauthRefreshReport}
        sessions={oauthSessions}
        onClientIdChange={onOauthClientIdChange}
        onClientSecretChange={onOauthClientSecretChange}
        onRedirectUriChange={onOauthRedirectUriChange}
        onCallbackStateChange={onOauthCallbackStateChange}
        onCallbackCodeChange={onOauthCallbackCodeChange}
        onStart={onStartOAuth2Pkce}
        onRefresh={onRefreshOAuth2Token}
        onCompleteCallback={onCompleteOAuth2Callback}
        onWaitForCallback={onWaitForOAuth2Callback}
        onExchange={onExchangeOAuth2Token}
      />
    </div>
  );
}
