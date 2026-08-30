import { useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  Eye,
  EyeOff,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { buildProviderCredentialGuidance } from '../../app/providerCredentialGuidance';
import type {
  Account,
  CredentialStatus,
} from '../../app/types';
import {
  SettingsBadge,
  SettingsButton,
  SettingsField,
  SettingsSection,
} from './shared';

type CredentialSecuritySettingsProps = {
  account: Account;
  credentialSecret: string;
  credentialStatus: CredentialStatus | null;
  authTypeChangeNotice?: string | null;
  onCredentialSecretChange: (value: string) => void;
  onVerifyCredential: () => void;
  onDeleteCredential: () => void;
  onStoreAndVerifyCredential: () => void;
};

export default function CredentialSecuritySettings({
  account,
  credentialSecret,
  credentialStatus,
  authTypeChangeNotice,
  onCredentialSecretChange,
  onVerifyCredential,
  onDeleteCredential,
  onStoreAndVerifyCredential,
}: CredentialSecuritySettingsProps) {
  const [secretVisible, setSecretVisible] = useState(false);
  const guidance = useMemo(
    () => buildProviderCredentialGuidance(account),
    [account.auth_type, account.provider],
  );
  const activeCredentialStatus = credentialStatus?.account_email === account.email
    ? credentialStatus
    : null;
  const hasSecret = credentialSecret.trim().length > 0;

  useEffect(() => {
    setSecretVisible(false);
  }, [account.email]);

  useEffect(() => {
    if (!hasSecret) setSecretVisible(false);
  }, [hasSecret]);

  return (
    <SettingsSection
      title="本地凭据存储"
      description={account.email}
      badge={
        activeCredentialStatus?.exists
          ? <SettingsBadge tone="success">已保存到本地</SettingsBadge>
          : <SettingsBadge tone="neutral">等待本地凭据</SettingsBadge>
      }
      className="settings-credential-panel"
      dataSection="auth"
    >
      <div className="credential-guide-card">
        <span className="credential-guide-icon" aria-hidden="true">
          <ShieldCheck size={17} />
        </span>
        <div>
          <strong>{guidance.title}</strong>
          <p>{guidance.summary}</p>
        </div>
        <span className="credential-provider-tag">{guidance.providerLabel}</span>
      </div>

      {authTypeChangeNotice && (
        <p className="settings-auth-change-notice" role="status">
          {authTypeChangeNotice}
        </p>
      )}

      <SettingsField label={guidance.credentialLabel} hint={guidance.verificationHint}>
        <div className="credential-input-shell">
          <input
            aria-label={guidance.credentialLabel}
            autoCapitalize="none"
            autoComplete="new-password"
            placeholder={guidance.placeholder}
            spellCheck={false}
            type={secretVisible ? 'text' : 'password'}
            value={credentialSecret}
            onChange={(event) => onCredentialSecretChange(event.target.value)}
          />
          <div className="credential-input-tools">
            {hasSecret && (
              <button
                aria-label="清空凭据输入"
                title="清空输入"
                type="button"
                onClick={() => onCredentialSecretChange('')}
              >
                <X size={14} />
              </button>
            )}
            <button
              aria-label={secretVisible ? '隐藏凭据' : '显示凭据'}
              aria-pressed={secretVisible}
              disabled={!hasSecret}
              title={secretVisible ? '隐藏凭据' : '显示凭据'}
              type="button"
              onClick={() => setSecretVisible((current) => !current)}
            >
              {secretVisible ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>
      </SettingsField>

      <ul className="credential-safety-points" aria-label="凭据安全说明">
        {guidance.checklist.map((item) => (
          <li key={item}>
            <ShieldCheck size={13} />
            {item}
          </li>
        ))}
      </ul>

      <div className="st-actions">
        <SettingsButton
          variant="danger-secondary"
          disabled={activeCredentialStatus?.exists === false}
          icon={<Trash2 size={14} />}
          onClick={onDeleteCredential}
        >
          删除
        </SettingsButton>
        <SettingsButton
          variant="primary"
          title={hasSecret ? '保存到本地数据库后立即验证 IMAP 与 SMTP 登录' : '验证已保存的 IMAP 与 SMTP 凭据'}
          icon={<BadgeCheck size={14} />}
          onClick={hasSecret ? onStoreAndVerifyCredential : onVerifyCredential}
        >
          {hasSecret ? '保存并验证' : '验证登录'}
        </SettingsButton>
      </div>
    </SettingsSection>
  );
}
