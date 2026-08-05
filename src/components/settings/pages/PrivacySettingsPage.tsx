import { ShieldAlert, Sparkles } from 'lucide-react';
import type { Account, RemoteImageTrust } from '../../../app/types';
import { formatDate } from '../../../mailUtils';
import { CustomSelect } from '../accounts/CustomSelect';
import {
  SettingsBadge,
  SettingsButton,
  SettingsEmptyState,
  SettingsNotice,
  SettingsSection,
  SettingsSwitch,
} from '../shared';

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
    <SettingsSection
      badge={<SettingsBadge tone="info">{accountTrusts.length} 条信任</SettingsBadge>}
      dataSection="privacy"
    >
      {accounts.length > 1 && (
        <div className="st-field">
          <label className="st-field-label" id="privacy-account-select-label">配置账号</label>
          <CustomSelect
            ariaLabel="配置账号"
            value={String(accountForm.id)}
            options={accounts.map((item) => ({
              value: String(item.id),
              label: `${item.display_name || item.email} · ${item.email}`,
            }))}
            onChange={(nextValue) => {
              const next = accounts.find((item) => item.id === Number(nextValue));
              if (next) onSelectAccount(next);
            }}
          />
          <span className="st-field-hint">隐私策略按账号独立生效，切换后保存才会应用到所选账号。</span>
        </div>
      )}

      <div className="st-subsection">
        <header className="st-subsection-header">
          <span>
            <strong>远程图片策略</strong>
            <small>邮件中的远程图片可能被用来追踪你的打开行为。</small>
          </span>
          <SettingsBadge tone={remoteImagesAllowed ? 'warning' : 'neutral'}>
            当前：{remoteImagesAllowed ? '允许加载' : '默认阻止'}
          </SettingsBadge>
        </header>
        <SettingsSwitch
          label="允许此账号加载远程图片"
          description={
            remoteImagesAllowed
              ? '开启后邮件中的远程图片会直接加载，可能暴露你的打开行为与网络位置；可信发件人或域名仍可单独放行。'
              : '默认阻止远程图片，减少追踪像素；可信发件人或域名可单独放行。'
          }
          checked={remoteImagesAllowed}
          onChange={(checked) => onAccountFormChange({
            ...accountForm,
            remote_images_allowed: checked,
          })}
        />
      </div>

      <div className="st-subsection">
        <header className="st-subsection-header">
          <span>
            <strong>外部邮箱拦截</strong>
            <small>拦截来自外部邮箱（域名与本账号不同）的邮件内容，常用于防钓鱼。</small>
          </span>
          <SettingsBadge tone={externalBlocked ? 'success' : 'neutral'}>
            当前：{externalBlocked ? '已拦截' : '未拦截'}
          </SettingsBadge>
        </header>
        <SettingsSwitch
          label="拦截外部邮箱邮件"
          description={
            externalBlocked
              ? '外部发件人（域名与本账号不同）的邮件会显示拦截提示，且不加载其中的远程图片。'
              : '关闭后，外部发件人的邮件按普通策略处理。'
          }
          checked={externalBlocked}
          onChange={(checked) => onAccountFormChange({
            ...accountForm,
            block_external_mailboxes: checked,
          })}
        />
      </div>

      <div className="st-subsection">
        <header className="st-subsection-header">
          <span>
            <strong>HTTPS 链接拦截</strong>
            <small>点击邮件中的 HTTPS 链接前先进行安全确认。</small>
          </span>
          <SettingsBadge tone={interceptsHttps ? 'success' : 'neutral'}>
            当前：{interceptsHttps ? '已拦截' : '直接打开'}
          </SettingsBadge>
        </header>
        <SettingsSwitch
          label="拦截 HTTPS 链接并提示确认"
          description={
            interceptsHttps
              ? '开启后点击 HTTPS 链接会先显示安全链接检查，确认目标域名后再打开。'
              : '关闭后点击 HTTPS 链接直接用系统浏览器打开，不再弹确认提示。'
          }
          checked={interceptsHttps}
          onChange={(checked) => onAccountFormChange({
            ...accountForm,
            intercept_https_links: checked,
          })}
        />
      </div>

      <div className="st-subsection">
        <header className="st-subsection-header">
          <span>
            <strong>信任列表</strong>
            <small>已放行远程图片的发件人与域名。</small>
          </span>
        </header>
        {accountTrusts.length === 0 ? (
          <SettingsEmptyState>
            暂无信任项。你可以在邮件阅读页按发件人或域名允许图片。
          </SettingsEmptyState>
        ) : (
          <div className="st-trust-list">
            {accountTrusts.map((trust) => (
              <div className="st-trust-row" key={trust.id}>
                <span className={`privacy-trust-scope scope-${trust.scope}`}>
                  {trust.scope === 'sender' ? '发件人' : '域名'}
                </span>
                <em>{trust.value}</em>
                <small>{formatDate(trust.created_at)}</small>
                <SettingsButton size="sm" onClick={() => onDeleteRemoteImageTrust(trust)}>
                  移除
                </SettingsButton>
              </div>
            ))}
          </div>
        )}
      </div>

      <SettingsNotice
        tone="warning"
        icon={ShieldAlert}
        title="邮件内容与外部 AI 服务"
        action={onNavigateToAi ? (
          <SettingsButton size="sm" variant="ghost" onClick={onNavigateToAi}>
            <Sparkles size={13} aria-hidden="true" /> 前往 AI 服务设置
          </SettingsButton>
        ) : undefined}
      >
        <p>
          翻译、摘要、模板生成可能会把邮件内容发送到外部 AI 服务。
          可在「AI 服务」中查看服务来源、数据说明或关闭该功能。
        </p>
      </SettingsNotice>
    </SettingsSection>
  );
}
