import { ShieldAlert, Sparkles } from 'lucide-react';
import type { Account, RemoteImageTrust } from '../../../app/types';
import { formatDate } from '../../../mailUtils';
import {
  SettingsBadge,
  SettingsButton,
  SettingsEmptyState,
  SettingsNotice,
  SettingsSection,
  SettingsSwitch,
} from '../shared';

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
  const warnExternalSenders = accountForm.warn_external_senders === true;

  return (
    <SettingsSection
      badge={<SettingsBadge tone="info">{accountTrusts.length} 条信任</SettingsBadge>}
      dataSection="privacy"
    >
      <SettingsSwitch
        label="允许加载远程图片"
        description={
          remoteImagesAllowed
            ? '邮件中的远程图片会直接加载，可能暴露打开行为与网络位置；可信发件人或域名仍可单独放行。'
            : '默认阻止远程图片与追踪像素；可信发件人或域名可单独放行。'
        }
        checked={remoteImagesAllowed}
        onChange={(checked) => onAccountFormChange({
          ...accountForm,
          remote_images_allowed: checked,
        })}
      />

      <SettingsSwitch
        label="提示外部发件人"
        description={
          warnExternalSenders
            ? '发件人域名与当前账号不同的邮件会显示「外部发件人」提示，便于核对身份。'
            : '关闭后，外部发件人的邮件不额外提示。'
        }
        checked={warnExternalSenders}
        onChange={(checked) => onAccountFormChange({
          ...accountForm,
          warn_external_senders: checked,
        })}
      />

      <div className="st-subsection">
        <header className="st-subsection-header">
          <span>
            <strong>远程图片信任列表</strong>
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
            <Sparkles size={13} aria-hidden="true" /> AI 接入
          </SettingsButton>
        ) : undefined}
      >
        <p>
          翻译、摘要与模板生成可能把邮件内容发送到你配置的外部服务。
          可在「AI 接入」中查看服务来源、隐私说明或关闭相关功能。
        </p>
      </SettingsNotice>
    </SettingsSection>
  );
}
