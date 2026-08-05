import { ShieldAlert, Sparkles } from 'lucide-react';
import type { Account, RemoteImageTrust } from '../../../app/types';
import { formatDate } from '../../../mailUtils';

type PrivacySettingsPageProps = {
  accounts: Account[];
  accountForm: Account;
  remoteImageTrusts: RemoteImageTrust[];
  onAccountFormChange: (account: Account) => void;
  onSelectAccount: (account: Account) => void;
  onDeleteRemoteImageTrust: (trust: RemoteImageTrust) => void;
  onNavigateToAi?: () => void;
};

export default function PrivacySettingsPage({
  accounts,
  accountForm,
  remoteImageTrusts,
  onAccountFormChange,
  onSelectAccount,
  onDeleteRemoteImageTrust,
  onNavigateToAi,
}: PrivacySettingsPageProps) {
  const accountTrusts = remoteImageTrusts.filter((trust) => trust.account_id === accountForm.id);
  const remoteImagesAllowed = accountForm.remote_images_allowed;
  const externalBlocked = accountForm.block_external_mailboxes === true;
  const interceptsHttps = accountForm.intercept_https_links !== false;

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

        {accounts.length > 1 && (
          <div className="privacy-section privacy-account-selector">
            <label htmlFor="privacy-account-select">配置账号</label>
            <select
              id="privacy-account-select"
              value={accountForm.id}
              onChange={(event) => {
                const next = accounts.find((item) => item.id === Number(event.target.value));
                if (next) onSelectAccount(next);
              }}
            >
              {accounts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.display_name || item.email} · {item.email}
                </option>
              ))}
            </select>
            <small>隐私策略按账号独立生效，切换后保存才会应用到所选账号。</small>
          </div>
        )}

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
              <strong>外部邮箱拦截</strong>
              <small>拦截来自外部邮箱（域名与本账号不同）的邮件内容。</small>
            </span>
            <em>{externalBlocked ? '当前：已拦截' : '当前：未拦截'}</em>
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={externalBlocked}
              onChange={(event) => onAccountFormChange({
                ...accountForm,
                block_external_mailboxes: event.target.checked,
              })}
            />
            <span>
              <strong>拦截外部邮箱邮件</strong>
              <small>
                {accountForm.block_external_mailboxes
                  ? '外部发件人（域名与本账号不同）的邮件会显示拦截提示，且不加载其中的远程图片。'
                  : '关闭后，外部发件人的邮件按普通策略处理。'}
              </small>
            </span>
          </label>
          <p className="privacy-section-note">
            常用于防钓鱼：冒充内部发件人、但邮箱域名不一致的邮件会先被拦截。
          </p>
        </div>

        <div className="privacy-section">
          <div className="privacy-section-header">
            <span>
              <strong>HTTPS 链接拦截</strong>
              <small>点击邮件中的 HTTPS 链接前先进行安全确认。</small>
            </span>
            <em>{interceptsHttps ? '当前：已拦截' : '当前：直接打开'}</em>
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={interceptsHttps}
              onChange={(event) => onAccountFormChange({
                ...accountForm,
                intercept_https_links: event.target.checked,
              })}
            />
            <span>
              <strong>拦截 HTTPS 链接并提示确认</strong>
              <small>
                {accountForm.intercept_https_links
                  ? '开启后点击 HTTPS 链接会先显示安全链接检查，确认目标域名后再打开。'
                  : '关闭后点击 HTTPS 链接直接用系统浏览器打开，不再弹确认提示。'}
              </small>
            </span>
          </label>
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
