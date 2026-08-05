import { emptyIdentityForm } from '../../../app/appConfig';
import type {
  Account,
  MailIdentity,
  MailIdentityInput,
} from '../../../app/types';
import {
  SettingsBadge,
  SettingsButton,
  SettingsField,
  SettingsSection,
  SettingsSwitch,
} from '../shared';

type IdentitySettingsPageProps = {
  accountForm: Account;
  identities: MailIdentity[];
  identityForm: MailIdentityInput;
  onAccountFormChange: (account: Account) => void;
  onIdentityFormChange: (identity: MailIdentityInput) => void;
  onEditIdentity: (identity: MailIdentity) => void;
  onDeleteIdentity: (identity: MailIdentity) => void;
  onSaveIdentity: () => void;
};

export default function IdentitySettingsPage({
  accountForm,
  identities,
  identityForm,
  onAccountFormChange,
  onIdentityFormChange,
  onEditIdentity,
  onDeleteIdentity,
  onSaveIdentity,
}: IdentitySettingsPageProps) {
  const accountIdentities = identities.filter((identity) => identity.account_id === accountForm.id);

  return (
    <SettingsSection
      title="发件身份与签名"
      description="维护默认身份、别名、Reply-To 和专用签名"
      badge={<SettingsBadge tone="neutral">{accountIdentities.length} 个身份</SettingsBadge>}
      dataSection="identities"
    >
      <SettingsField label="账号默认签名">
        <textarea
          value={accountForm.signature}
          onChange={(event) => onAccountFormChange({ ...accountForm, signature: event.target.value })}
          placeholder="用于没有专用签名的发件身份"
        />
      </SettingsField>

      {accountIdentities.length > 0 && (
        <div className="st-trust-list">
          {accountIdentities.map((identity) => (
            <div className="st-trust-row" key={identity.id}>
              <span className="st-badge st-badge-neutral">
                {identity.is_default ? '默认' : '别名'}
              </span>
              <em>{identity.name} &lt;{identity.email}&gt;</em>
              <small>{identity.reply_to ? `回复到 ${identity.reply_to}` : '无 Reply-To'}</small>
              <span className="st-actions">
                <SettingsButton size="sm" onClick={() => onEditIdentity(identity)}>编辑</SettingsButton>
                {!identity.is_default && (
                  <SettingsButton size="sm" variant="danger-secondary" onClick={() => onDeleteIdentity(identity)}>
                    删除
                  </SettingsButton>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="st-identity-form">
        <SettingsField label="显示名">
          <input
            value={identityForm.name}
            onChange={(event) => onIdentityFormChange({ ...identityForm, name: event.target.value })}
            placeholder="显示名"
          />
        </SettingsField>
        <SettingsField label="发件邮箱 / 别名">
          <input
            value={identityForm.email}
            onChange={(event) => onIdentityFormChange({ ...identityForm, email: event.target.value })}
            placeholder="发件邮箱 / 别名"
          />
        </SettingsField>
        <SettingsField label="Reply-To（可选）">
          <input
            value={identityForm.reply_to}
            onChange={(event) => onIdentityFormChange({ ...identityForm, reply_to: event.target.value })}
            placeholder="Reply-To，可选"
          />
        </SettingsField>
        <SettingsField label="该身份专用签名">
          <textarea
            value={identityForm.signature}
            onChange={(event) => onIdentityFormChange({ ...identityForm, signature: event.target.value })}
            placeholder="该身份专用签名"
          />
        </SettingsField>
        <SettingsSwitch
          label="设为默认发件身份"
          description="新邮件将优先使用该身份"
          checked={identityForm.is_default}
          onChange={(checked) => onIdentityFormChange({ ...identityForm, is_default: checked })}
        />
        <div className="st-actions end">
          <SettingsButton onClick={() => onIdentityFormChange(emptyIdentityForm)}>清空</SettingsButton>
          <SettingsButton variant="primary" onClick={onSaveIdentity}>保存身份</SettingsButton>
        </div>
      </div>
    </SettingsSection>
  );
}
