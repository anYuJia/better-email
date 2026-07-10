import { emptyIdentityForm } from '../../../app/appConfig';
import type {
  Account,
  MailIdentity,
  MailIdentityInput,
} from '../../../app/types';

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
    <div className="settings-experience-stack">
      <section className="tool-panel identity-panel settings-identity-panel" data-settings-section="identities">
        <header className="tool-header">
          <span>
            <strong>发件身份与签名</strong>
            <small>维护默认身份、别名、Reply-To 和专用签名</small>
          </span>
          <em>{accountIdentities.length} 个身份</em>
        </header>

        <label className="settings-account-signature">
          账号默认签名
          <textarea
            value={accountForm.signature}
            onChange={(event) => onAccountFormChange({ ...accountForm, signature: event.target.value })}
            placeholder="用于没有专用签名的发件身份"
          />
        </label>

        <div className="settings-compact-list">
          {accountIdentities.map((identity) => (
            <div className="tool-row" key={identity.id}>
              <span>{identity.is_default ? '默认' : '别名'}</span>
              <em>{identity.name} &lt;{identity.email}&gt;</em>
              <small>{identity.reply_to ? `回复到 ${identity.reply_to}` : '无 Reply-To'}</small>
              <button type="button" onClick={() => onEditIdentity(identity)}>编辑</button>
              {!identity.is_default && (
                <button type="button" className="danger" onClick={() => onDeleteIdentity(identity)}>删除</button>
              )}
            </div>
          ))}
        </div>

        <div className="identity-form settings-identity-form">
          <input
            value={identityForm.name}
            onChange={(event) => onIdentityFormChange({ ...identityForm, name: event.target.value })}
            placeholder="显示名"
          />
          <input
            value={identityForm.email}
            onChange={(event) => onIdentityFormChange({ ...identityForm, email: event.target.value })}
            placeholder="发件邮箱 / 别名"
          />
          <input
            value={identityForm.reply_to}
            onChange={(event) => onIdentityFormChange({ ...identityForm, reply_to: event.target.value })}
            placeholder="Reply-To，可选"
          />
          <textarea
            value={identityForm.signature}
            onChange={(event) => onIdentityFormChange({ ...identityForm, signature: event.target.value })}
            placeholder="该身份专用签名"
          />
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={identityForm.is_default}
              onChange={(event) => onIdentityFormChange({ ...identityForm, is_default: event.target.checked })}
            />
            <span>
              <strong>设为默认发件身份</strong>
              <small>新邮件将优先使用该身份</small>
            </span>
          </label>
          <div>
            <button
              type="button"
              className="secondary"
              onClick={() => onIdentityFormChange(emptyIdentityForm)}
            >
              清空
            </button>
            <button type="button" onClick={onSaveIdentity}>保存身份</button>
          </div>
        </div>
      </section>
    </div>
  );
}
