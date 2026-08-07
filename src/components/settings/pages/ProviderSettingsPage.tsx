import { Save } from 'lucide-react';
import {
  incomingHostForProtocol,
  providerCompatibilityMatrix,
  type AccountProviderPreset,
  type ProviderCompatibility,
} from '../../../providerCatalog';
import {
  providerVerificationLabel,
} from '../../../app/appConfig';
import {
  isCustomProvider,
  ordinaryProviderOptions,
  resolveOrdinaryProviderOption,
  type OrdinaryProviderOptionId,
} from '../../../app/accountConnectionSettings';
import type {
  Account,
  IncomingProtocol,
  ProviderVerificationRecord,
  ProviderVerificationStatus,
} from '../../../app/types';
import { formatDate } from '../../../mailUtils';
import { CustomSelect } from '../accounts/CustomSelect';
import {
  SettingsBadge,
  SettingsButton,
  SettingsField,
  SettingsSection,
  SettingsSwitch,
} from '../shared';

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

function protocolLabel(protocol: string) {
  return protocol === 'pop3' ? 'POP3' : 'IMAP';
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
  const providerOption = resolveOrdinaryProviderOption(accountForm.provider);
  const customProvider = isCustomProvider(accountForm.provider);

  const serverFields = (
    <div className="settings-account-form-grid">
      {customProvider && (
        <label>
          服务商标识
          <input
            value={accountForm.provider}
            onChange={(event) => onAccountFormChange({ ...accountForm, provider: event.target.value })}
            placeholder="例如 company-mail"
          />
        </label>
      )}
      <label>
        收信协议
        <CustomSelect
          dense
          ariaLabel="收信协议"
          value={accountForm.incoming_protocol}
          options={[
            { value: 'imap', label: 'IMAP' },
            { value: 'pop3', label: 'POP3' },
          ]}
          onChange={(nextProtocol) => {
            const nextProtocolValue = nextProtocol as IncomingProtocol;
            const preset = providerCompatibilityMatrix.find(
              (provider) => provider.provider === accountForm.provider,
            );
            onAccountFormChange({
              ...accountForm,
              incoming_protocol: nextProtocolValue,
              imap_host: preset ? incomingHostForProtocol(preset, nextProtocolValue) : accountForm.imap_host,
              auth_type: nextProtocolValue === 'pop3' && accountForm.auth_type === 'oauth2'
                ? 'password'
                : accountForm.auth_type,
            });
          }}
        />
      </label>
      <label>
        收信服务器（{protocolLabel(accountForm.incoming_protocol)}）
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
  );

  return (
    <div className="settings-provider-stack">
      <SettingsSection
        title="连接参数"
        description={accountForm.email}
        badge={<SettingsBadge tone="info">{accountForm.provider}</SettingsBadge>}
        dataSection="providers"
      >
        <SettingsField label="服务商">
          <CustomSelect
            dense
            ariaLabel="服务商"
            value={providerOption}
            options={ordinaryProviderOptions.map((option) => ({
              value: option.id,
              label: option.label,
            }))}
            onChange={(nextOptionValue) => {
              const nextOption = nextOptionValue as OrdinaryProviderOptionId;
              if (nextOption === 'custom') {
                onAccountFormChange({ ...accountForm, provider: 'custom' });
                return;
              }
              const preset = providerCompatibilityMatrix.find((provider) => provider.id === nextOption);
              if (preset) onApplyProviderPreset(preset);
            }}
          />
        </SettingsField>
        {customProvider ? serverFields : (
          <details className="settings-provider-advanced settings-provider-server-advanced">
            <summary>
              <span>
                <strong>高级服务器设置</strong>
                <em>{protocolLabel(accountForm.incoming_protocol)} 与 SMTP 地址</em>
              </span>
              <b>默认隐藏</b>
            </summary>
            {serverFields}
          </details>
        )}
      </SettingsSection>

      <details
        className="settings-disclosure settings-provider-advanced"
        data-settings-section="providers"
      >
        <summary>
          <span>
            <strong>兼容性验证</strong>
            <em>服务商限制、协议状态和测试记录</em>
          </span>
          <b>{providerVerificationLabel(activeProviderVerification?.status ?? 'untested')}</b>
        </summary>
        <div className="settings-provider-advanced-content">
          <section className="provider-matrix settings-provider-matrix" aria-label="服务商兼容性矩阵">
            <header>
              <strong>兼容性矩阵</strong>
              <span>排查服务商差异</span>
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
                  {' · '}IMAP {provider.imap_host}
                  {' · '}POP3 {provider.pop3_host}
                  {' · '}SMTP {provider.smtp_host}
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
            <SettingsSection title="真实账号验证记录" description="记录真实账号环境下的可用性" badge={
              <SettingsBadge>{providerVerificationLabel(activeProviderVerification.status)}</SettingsBadge>
            }>
              <SettingsField label="验证状态">
                <CustomSelect
                  dense
                  ariaLabel="验证状态"
                  value={activeProviderVerification.status}
                  options={[
                    { value: 'untested', label: '未验证' },
                    { value: 'passed', label: '通过' },
                    { value: 'partial', label: '部分通过' },
                    { value: 'failed', label: '失败' },
                  ]}
                  onChange={(nextStatus) => onUpdateProviderVerification(accountForm.provider, {
                    status: nextStatus as ProviderVerificationStatus,
                  })}
                />
              </SettingsField>
              <div className="settings-toggle-grid">
                <SettingsSwitch
                  label="收信已通过"
                  description="IMAP 或 POP3 登录与同步"
                  checked={activeProviderVerification.imap_ok}
                  onChange={(checked) => onUpdateProviderVerification(accountForm.provider, {
                    imap_ok: checked,
                  })}
                />
                <SettingsSwitch
                  label="SMTP 已通过"
                  description="普通文本、HTML 和附件发送"
                  checked={activeProviderVerification.smtp_ok}
                  onChange={(checked) => onUpdateProviderVerification(accountForm.provider, {
                    smtp_ok: checked,
                  })}
                />
                <SettingsSwitch
                  label="OAuth2 已通过"
                  description="PKCE、刷新和 XOAUTH2 登录"
                  checked={activeProviderVerification.oauth_ok}
                  onChange={(checked) => onUpdateProviderVerification(accountForm.provider, {
                    oauth_ok: checked,
                  })}
                />
              </div>
              <SettingsField label="备注">
                <textarea
                  value={activeProviderVerification.notes}
                  onChange={(event) => onUpdateProviderVerification(accountForm.provider, {
                    notes: event.target.value,
                  })}
                  placeholder="记录失败原因、租户限制、授权码策略或附件/HTML 样本问题"
                />
              </SettingsField>
              <div className="st-actions">
                <SettingsButton variant="primary" icon={<Save size={14} />} onClick={onSaveProviderVerification}>
                  保存验证记录
                </SettingsButton>
              </div>
            </SettingsSection>
          )}
        </div>
      </details>
    </div>
  );
}
