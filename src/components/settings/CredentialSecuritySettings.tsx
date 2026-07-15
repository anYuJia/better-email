import { useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  Eye,
  EyeOff,
  KeyRound,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { buildProviderCredentialGuidance } from '../../app/providerCredentialGuidance';
import type { ProviderValidationReport } from '../../app/providerValidation';
import type {
  Account,
  ConnectionReport,
  CredentialStatus,
  CredentialVerificationReport,
} from '../../app/types';
import ConnectionDiagnosticsPanel from './ConnectionDiagnosticsPanel';
import './data-settings.css';

type CredentialSecuritySettingsProps = {
  account: Account;
  credentialSecret: string;
  credentialStatus: CredentialStatus | null;
  connectionReport: ConnectionReport | null;
  credentialVerification: CredentialVerificationReport | null;
  providerValidationReport: ProviderValidationReport | null;
  providerValidationRunning: boolean;
  onCredentialSecretChange: (value: string) => void;
  onCheckCredential: () => void;
  onVerifyCredential: () => void;
  onRunProviderValidation: () => void;
  onDeleteCredential: () => void;
  onStoreCredential: () => void;
  onStoreAndVerifyCredential: () => void;
};

export default function CredentialSecuritySettings({
  account,
  credentialSecret,
  credentialStatus,
  connectionReport,
  credentialVerification,
  providerValidationReport,
  providerValidationRunning,
  onCredentialSecretChange,
  onCheckCredential,
  onVerifyCredential,
  onRunProviderValidation,
  onDeleteCredential,
  onStoreCredential,
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
    <section
      className="tool-panel settings-credential-panel"
      data-credential-provider={guidance.providerId}
      data-settings-section="auth"
    >
      <header className="tool-header">
        <span className="credential-panel-title">
          <strong>本地凭据存储</strong>
          <small>{account.email}</small>
        </span>
        <em className={activeCredentialStatus?.exists ? 'stored' : ''}>
          {activeCredentialStatus?.exists ? '已保存到本地' : '等待本地凭据'}
        </em>
      </header>

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

      <label className="credential-field">
        <span>{guidance.credentialLabel}</span>
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
        <small>{guidance.verificationHint}</small>
      </label>

      <ul className="credential-safety-points" aria-label="凭据安全说明">
        {guidance.checklist.map((item) => (
          <li key={item}>
            <ShieldCheck size={13} />
            {item}
          </li>
        ))}
      </ul>

      <div className="credential-actions">
        <button className="secondary" type="button" onClick={onCheckCredential}>
          <Search size={14} />
          检查存储
        </button>
        <button
          className="secondary danger"
          disabled={activeCredentialStatus?.exists === false}
          type="button"
          onClick={onDeleteCredential}
        >
          <Trash2 size={14} />
          删除
        </button>
        <button
          className="secondary"
          disabled={!hasSecret}
          type="button"
          onClick={onStoreCredential}
        >
          <KeyRound size={14} />
          仅保存
        </button>
        <button
          data-credential-primary-action
          title={hasSecret ? '保存到本地数据库后立即验证 IMAP 与 SMTP 登录' : '验证已保存的 IMAP 与 SMTP 凭据'}
          type="button"
          onClick={hasSecret ? onStoreAndVerifyCredential : onVerifyCredential}
        >
          <BadgeCheck size={14} />
          {hasSecret ? '保存并验证' : '验证登录'}
        </button>
      </div>

      <ConnectionDiagnosticsPanel
        account={account}
        credentialStatus={activeCredentialStatus}
        connectionReport={connectionReport}
        credentialVerification={credentialVerification}
        providerValidationReport={providerValidationReport}
        providerValidationRunning={providerValidationRunning}
        onRunProviderValidation={onRunProviderValidation}
      />
    </section>
  );
}
