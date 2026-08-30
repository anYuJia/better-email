import {
  incomingHostForProtocol,
  providerCompatibilityMatrix,
  type AccountProviderPreset,
} from '../../../providerCatalog';
import {
  isCustomProvider,
  ordinaryProviderOptions,
  resolveOrdinaryProviderOption,
  type OrdinaryProviderOptionId,
} from '../../../app/accountConnectionSettings';
import type {
  Account,
  IncomingProtocol,
} from '../../../app/types';
import { CustomSelect } from '../accounts/CustomSelect';
import {
  AnimatedDisclosure,
  SettingsBadge,
  SettingsField,
  SettingsSection,
} from '../shared';

type ProviderSettingsPageProps = {
  accountForm: Account;
  onAccountFormChange: (account: Account) => void;
  onApplyProviderPreset: (preset: AccountProviderPreset) => void;
};

function protocolLabel(protocol: string) {
  return protocol === 'pop3' ? 'POP3' : 'IMAP';
}

export default function ProviderSettingsPage({
  accountForm,
  onAccountFormChange,
  onApplyProviderPreset,
}: ProviderSettingsPageProps) {
  const providerOption = resolveOrdinaryProviderOption(accountForm.provider);
  const customProvider = isCustomProvider(accountForm.provider);

  const serverFields = (
    <div className="settings-account-form-grid st-field-grid">
      {customProvider && (
        <div className="st-field">
          <label className="st-field-label">服务商标识</label>
          <input
            value={accountForm.provider}
            onChange={(event) => onAccountFormChange({ ...accountForm, provider: event.target.value })}
            placeholder="例如 company-mail"
          />
        </div>
      )}
      <div className="st-field">
        <label className="st-field-label">收信协议</label>
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
      </div>
      <div className="st-field">
        <label className="st-field-label">收信服务器（{protocolLabel(accountForm.incoming_protocol)}）</label>
        <input
          value={accountForm.imap_host}
          onChange={(event) => onAccountFormChange({ ...accountForm, imap_host: event.target.value })}
        />
      </div>
      <div className="st-field">
        <label className="st-field-label">SMTP 服务器</label>
        <input
          value={accountForm.smtp_host}
          onChange={(event) => onAccountFormChange({ ...accountForm, smtp_host: event.target.value })}
        />
      </div>
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
        <SettingsField label="服务商" labelMode="static">
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
          <AnimatedDisclosure
            className="settings-provider-advanced settings-provider-server-advanced"
            summary={(
              <>
                <span>
                  <strong>高级服务器设置</strong>
                  <em>{protocolLabel(accountForm.incoming_protocol)} 与 SMTP 地址</em>
                </span>
                <b>默认隐藏</b>
              </>
            )}
          >
            {serverFields}
          </AnimatedDisclosure>
        )}
      </SettingsSection>

    </div>
  );
}
