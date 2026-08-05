import { ShieldAlert, Sparkles } from 'lucide-react';
import type { Account, RemoteImageTrust } from '../../../app/types';
import { formatDate } from '../../../mailUtils';

type PrivacySettingsPageProps = {
  accountForm: Account;
  remoteImageTrusts: RemoteImageTrust[];
  onAccountFormChange: (account: Account) => void;
  onDeleteRemoteImageTrust: (trust: RemoteImageTrust) => void;
  onNavigateToAi?: () => void;
};

export default function PrivacySettingsPage({
  accountForm,
  remoteImageTrusts,
  onAccountFormChange,
  onDeleteRemoteImageTrust,
  onNavigateToAi,
}: PrivacySettingsPageProps) {
  const accountTrusts = remoteImageTrusts.filter((trust) => trust.account_id === accountForm.id);
  const remoteImagesAllowed = accountForm.remote_images_allowed;

  return (
    <div className="settings-experience-stack">
      <section className="tool-panel settings-privacy-panel" data-settings-section="privacy">
        <header className="tool-header">
          <span>
            <strong>隐私保护</strong>
            <small>控制远程图片、追踪像素和发件人信任规则。</small>
          </span>
          <em>{accountTrusts.length} 条信任</em>
        </header>

        <div className="privacy-section">
          <div className="privacy-section-header">
            <span>
              <strong>远程图片策略</strong>
              <small>邮件中的远程图片可能被用来追踪你的打开行为。</small>
            </span>
            <em>{remoteImagesAllowed ? '当前：允许加载' : '当前：默认阻止'}</em>
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={remoteImagesAllowed}
              onChange={(event) => onAccountFormChange({
                ...accountForm,
                remote_images_allowed: event.target.checked,
              })}
            />
            <span>
              <strong>允许此账号加载远程图片</strong>
              <small>
                {remoteImagesAllowed
                  ? '开启后邮件中的远程图片会直接加载，可能暴露你的打开行为与网络位置。'
                  : '默认阻止远程图片，减少追踪像素；可信发件人或域名可单独放行。'}
              </small>
            </span>
          </label>
          <p className="privacy-section-note">
            可信发件人/域名可单独放行远程图片，不需要为整个账号开启。
          </p>
        </div>

        <div className="privacy-section">
          <div className="privacy-section-header">
            <span>
              <strong>信任列表</strong>
              <small>已放行远程图片的发件人与域名。</small>
            </span>
          </div>
          {accountTrusts.length === 0 ? (
            <p className="settings-empty-state">
              暂无信任项。你可以在邮件阅读页按发件人或域名允许图片。
            </p>
          ) : (
            <div className="settings-compact-list">
              {accountTrusts.map((trust) => (
                <div className="tool-row" key={trust.id}>
                  <span className={`privacy-trust-scope scope-${trust.scope}`}>
                    {trust.scope === 'sender' ? '发件人' : '域名'}
                  </span>
                  <em>{trust.value}</em>
                  <small>{formatDate(trust.created_at)}</small>
                  <button type="button" onClick={() => onDeleteRemoteImageTrust(trust)}>移除</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="privacy-ai-reminder" role="note">
          <ShieldAlert size={15} aria-hidden="true" />
          <span>
            <strong>邮件内容与外部 AI 服务</strong>
            <small>
              翻译、摘要、模板生成可能会把邮件内容发送到外部 AI 服务。
              可在「AI 服务」中查看服务来源、数据说明或关闭该功能。
            </small>
          </span>
          {onNavigateToAi && (
            <button type="button" onClick={onNavigateToAi}>
              <Sparkles size={13} aria-hidden="true" /> 前往 AI 服务设置
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
