import { useState } from 'react';
import { emptyIdentityForm } from '../../../app/appConfig';
import type {
  Account,
  MailIdentity,
  MailIdentityInput,
} from '../../../app/types';
import { isValidEmailAddress } from '../../../app/uiConfig';
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
  onSaveIdentity: () => Promise<void>;
};

type IdentitySaveIssue = {
  field: 'name' | 'email' | 'reply_to' | 'save';
  message: string;
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
  const [saveIssue, setSaveIssue] = useState<IdentitySaveIssue | null>(null);
  const [saving, setSaving] = useState(false);
  const accountIdentities = identities.filter((identity) => identity.account_id === accountForm.id);

  function clearSaveIssue() {
    if (saveIssue) setSaveIssue(null);
  }

  function validateIdentity(): IdentitySaveIssue | null {
    if (!identityForm.name.trim()) {
      return { field: 'name', message: '请填写显示名。' };
    }
    const email = identityForm.email.trim();
    if (!email) {
      return { field: 'email', message: '请填写发件邮箱或别名。' };
    }
    if (!isValidEmailAddress(email)) {
      return { field: 'email', message: '请输入有效的邮箱地址。' };
    }
    const duplicate = accountIdentities.some(
      (identity) => identity.id !== identityForm.id
        && identity.email.trim().toLowerCase() === email.toLowerCase(),
    );
    if (duplicate) {
      return { field: 'email', message: '该邮箱已被其他发件身份使用。' };
    }
    const replyTo = identityForm.reply_to.trim();
    if (replyTo && !isValidEmailAddress(replyTo)) {
      return { field: 'reply_to', message: 'Reply-To 不是有效的邮箱地址。' };
    }
    return null;
  }

  async function handleSaveIdentity() {
    const issue = validateIdentity();
    if (issue) {
      setSaveIssue(issue);
      return;
    }
    setSaveIssue(null);
    setSaving(true);
    try {
      await onSaveIdentity();
    } catch (error) {
      const message = error instanceof Error ? error.message.replace(/^Error:\s*/i, '') : String(error);
      setSaveIssue({ field: 'save', message: message || '无法保存发件身份，请稍后重试。' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsSection
      title="发件身份"
      description="管理显示给收件人的名称、别名、Reply-To 与签名"
      badge={<SettingsBadge tone="neutral">{accountIdentities.length} 个</SettingsBadge>}
      dataSection="identities"
    >
      <SettingsField label="账号默认签名" hint="没有专用签名的发件身份会使用这里的内容">
        <textarea
          value={accountForm.signature}
          onChange={(event) => onAccountFormChange({ ...accountForm, signature: event.target.value })}
          placeholder="账号默认签名"
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
        <header className="settings-identity-form-heading">
          <strong>{identityForm.id ? '编辑发件身份' : '添加发件身份'}</strong>
          <small>设置名称、发件地址、回复地址和该身份专用签名。</small>
        </header>
        <SettingsField
          label="显示名"
          hint="必填"
          error={saveIssue?.field === 'name' ? saveIssue.message : undefined}
        >
          <input
            value={identityForm.name}
            aria-invalid={saveIssue?.field === 'name'}
            onChange={(event) => {
              clearSaveIssue();
              onIdentityFormChange({ ...identityForm, name: event.target.value });
            }}
            placeholder="显示名"
          />
        </SettingsField>
        <SettingsField
          label="发件邮箱 / 别名"
          hint="必填"
          error={saveIssue?.field === 'email' ? saveIssue.message : undefined}
        >
          <input
            value={identityForm.email}
            aria-invalid={saveIssue?.field === 'email'}
            onChange={(event) => {
              clearSaveIssue();
              onIdentityFormChange({ ...identityForm, email: event.target.value });
            }}
            placeholder="name@example.com"
          />
        </SettingsField>
        <SettingsField
          label="Reply-To（可选）"
          error={saveIssue?.field === 'reply_to' ? saveIssue.message : undefined}
        >
          <input
            value={identityForm.reply_to}
            aria-invalid={saveIssue?.field === 'reply_to'}
            onChange={(event) => {
              clearSaveIssue();
              onIdentityFormChange({ ...identityForm, reply_to: event.target.value });
            }}
            placeholder="reply@example.com"
          />
        </SettingsField>
        <SettingsField className="settings-identity-signature-field" label="该身份专用签名">
          <textarea
            value={identityForm.signature}
            onChange={(event) => {
              clearSaveIssue();
              onIdentityFormChange({ ...identityForm, signature: event.target.value });
            }}
            placeholder="留空则使用账号默认签名"
          />
        </SettingsField>
        {saveIssue?.field === 'save' && (
          <p className="settings-identity-save-error" role="alert">无法保存发件身份：{saveIssue.message}</p>
        )}
        <footer className="settings-identity-form-footer">
          <SettingsSwitch
            label="设为默认发件身份"
            description="新邮件将优先使用该身份"
            checked={identityForm.is_default}
            onChange={(checked) => onIdentityFormChange({ ...identityForm, is_default: checked })}
          />
          <div className="st-actions">
            <SettingsButton disabled={saving} onClick={() => onIdentityFormChange(emptyIdentityForm)}>清空</SettingsButton>
            <SettingsButton variant="primary" disabled={saving} onClick={() => { void handleSaveIdentity(); }}>
              {saving ? '保存中…' : '保存身份'}
            </SettingsButton>
          </div>
        </footer>
      </div>
    </SettingsSection>
  );
}
