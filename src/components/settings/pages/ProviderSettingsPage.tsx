import { Save } from 'lucide-react';
import {
  providerCompatibilityMatrix,
  type AccountProviderPreset,
  type ProviderCompatibility,
} from '../../../providerCatalog';
import {
  providerVerificationLabel,
} from '../../../app/appConfig';
import type {
  Account,
  ProviderVerificationRecord,
  ProviderVerificationStatus,
} from '../../../app/types';
import { formatDate } from '../../../mailUtils';
import ProviderPresetGrid from '../ProviderPresetGrid';

type ProviderSettingsPageProps = {
  accountForm: Account;
  providerVerifications: Record<string, ProviderVerificationRecord>;
  activeProviderVerification: ProviderVerificationRecord | null;
  onAccountFormChange: (account: Account) => void;
  onApplyProviderPreset: (preset: AccountProviderPreset) => void;
  onUpdateProviderVerification: (
    providerName: string,
    patch: Partial<ProviderVerificationRecord>,
  ) => void;
  onSaveProviderVerification: () => void;
};

function providerPresetStatusLabel(status: ProviderCompatibility['tested_status']) {
  if (status === 'verified') return '真实账号已验证';
  if (status === 'needs-account') return '需真实账号验证';
  return '预设可用';
}

export default function ProviderSettingsPage({
  accountForm,
  providerVerifications,
  activeProviderVerification,
  onAccountFormChange,
  onApplyProviderPreset,
  onUpdateProviderVerification,
  onSaveProviderVerification,
}: ProviderSettingsPageProps) {
  return (
    <div className="settings-account-stack settings-account-page settings-account-page-providers">
      <section className="tool-panel settings-current-account-panel settings-provider-config-panel">
        <header className="tool-header">
          <span>
            <strong>服务器与服务商</strong>
            <small>{accountForm.email}</small>
          </span>
          <em>{accountForm.provider}</em>
        </header>
        <label>
          服务商标识
          <input
            value={accountForm.provider}
            onChange={(event) => onAccountFormChange({ ...accountForm, provider: event.target.value })}
          />
        </label>
        <ProviderPresetGrid
          activeProvider={accountForm.provider}
          onSelect={onApplyProviderPreset}
        />
        <div className="settings-account-form-grid">
          <label>
            IMAP 服务器
            <input
              value={accountForm.imap_host}
              onChange={(event) => onAccountFormChange({ ...accountForm, imap_host: event.target.value })}
            />
          </label>
          <label>
            SMTP 服务器
            <input
              value={accountForm.smtp_host}
              onChange={(event) => onAccountFormChange({ ...accountForm, smtp_host: event.target.value })}
            />
          </label>
        </div>
      </section>

      <details
        className="settings-disclosure settings-provider-advanced"
        data-settings-section="providers"
      >
        <summary>
          <span>
            <strong>兼容性与真实验证</strong>
            <em>服务商限制、IMAP/SMTP/OAuth 状态和测试记录</em>
          </span>
          <b>{providerVerificationLabel(activeProviderVerification?.status ?? 'untested')}</b>
        </summary>
        <div className="settings-provider-advanced-content">
          <section className="provider-matrix settings-provider-matrix" aria-label="服务商兼容性矩阵">
            <header>
              <strong>兼容性矩阵</strong>
              <span>用于排查服务商差异，不影响上方常用配置</span>
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
                  {providerPresetStatusLabel(provider.tested_status)}
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
        </div>
      </details>
    </div>
  );
}
