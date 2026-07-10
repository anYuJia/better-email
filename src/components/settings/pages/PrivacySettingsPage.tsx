import type { Account, RemoteImageTrust } from '../../../app/types';
import { formatDate } from '../../../mailUtils';

type PrivacySettingsPageProps = {
  accountForm: Account;
  remoteImageTrusts: RemoteImageTrust[];
  onAccountFormChange: (account: Account) => void;
  onDeleteRemoteImageTrust: (trust: RemoteImageTrust) => void;
};

export default function PrivacySettingsPage({
  accountForm,
  remoteImageTrusts,
  onAccountFormChange,
  onDeleteRemoteImageTrust,
}: PrivacySettingsPageProps) {
  const accountTrusts = remoteImageTrusts.filter((trust) => trust.account_id === accountForm.id);

  return (
    <div className="settings-experience-stack">
      <section className="tool-panel settings-privacy-panel" data-settings-section="privacy">
        <header className="tool-header">
          <span>
            <strong>隐私与远程图片</strong>
            <small>默认阻止追踪像素，仅对可信发件人加载图片</small>
          </span>
          <em>{accountTrusts.length} 条信任</em>
        </header>
        <label className="checkbox-row settings-primary-toggle">
          <input
            type="checkbox"
            checked={accountForm.remote_images_allowed}
            onChange={(event) => onAccountFormChange({
              ...accountForm,
              remote_images_allowed: event.target.checked,
            })}
          />
          <span>
            <strong>允许此账号加载远程图片</strong>
            <small>仍会优先使用发件人和域名信任规则</small>
          </span>
        </label>
        {accountTrusts.length === 0 ? (
          <p className="settings-empty-state">暂无信任项，可在邮件阅读页按发件人或域名加入。</p>
        ) : (
          <div className="settings-compact-list">
            {accountTrusts.map((trust) => (
              <div className="tool-row" key={trust.id}>
                <span>{trust.scope === 'sender' ? '发件人' : '域名'}</span>
                <em>{trust.value}</em>
                <small>{formatDate(trust.created_at)}</small>
                <button type="button" onClick={() => onDeleteRemoteImageTrust(trust)}>移除</button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
