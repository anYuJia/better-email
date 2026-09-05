import { ShieldAlert, Sparkles } from 'lucide-react';
import type { Account, AccountScope, RemoteImageTrust } from '../../../app/types';
import {
  MIXED_ACCOUNT_SETTING_VALUE,
  type AccountScopedSettingKey,
} from '../../../app/accountScopedSettings';
import type { SettingsAccountValueChange, SettingsAccountValues } from '../accountScopeTypes';
import { formatDate } from '../../../mailUtils';
import {
  AccountScopeRequired,
  SettingsBadge,
  SettingsButton,
  SettingsEmptyState,
  SettingsNotice,
  SettingsSection,
  SettingsSwitch,
} from '../shared';

type PrivacySettingsPageProps = {
  accountScope: AccountScope;
  accounts: Account[];
  accountForm: Account | null;
  accountValues: SettingsAccountValues;
  remoteImageTrusts: RemoteImageTrust[];
  onAccountFormChange: (account: Account) => void;
  onAccountValueChange: SettingsAccountValueChange;
  onDeleteRemoteImageTrust: (trust: RemoteImageTrust) => void;
  onNavigateToAi?: () => void;
};

function valueIsMixed(value: unknown) {
  return value === MIXED_ACCOUNT_SETTING_VALUE;
}

export default function PrivacySettingsPage({
  accountScope,
  accounts,
  accountForm,
  accountValues,
  remoteImageTrusts,
  onAccountFormChange,
  onAccountValueChange,
  onDeleteRemoteImageTrust,
  onNavigateToAi,
}: PrivacySettingsPageProps) {
  if (accounts.length === 0 || (accountScope !== 'all' && !accountForm)) {
    return (
      <AccountScopeRequired
        accountScope={accountScope}
        accounts={accounts}
        onSelectAccount={onAccountFormChange}
        title="请先添加邮箱账号"
        description="隐私与安全设置需要绑定邮箱账号。请从下方选择账号或使用顶部的邮箱范围选择器继续。"
      />
    );
  }

  const accountTrusts = accountForm
    ? remoteImageTrusts.filter((trust) => trust.account_id === accountForm.id)
    : [];
  const readValue = <K extends AccountScopedSettingKey>(key: K) => (
    accountScope === 'all' ? accountValues[key] : accountForm?.[key]
  );
  const updateBoolean = (key: AccountScopedSettingKey, checked: boolean) => {
    if (accountScope === 'all') {
      onAccountValueChange(key, checked);
      return;
    }
    if (accountForm && typeof accountForm[key] === 'boolean') {
      onAccountFormChange({ ...accountForm, [key]: checked });
    }
  };
  const remoteImagesAllowed = readValue('remote_images_allowed');
  const warnExternalSenders = readValue('warn_external_senders');
  const blockExternalMailboxes = readValue('block_external_mailboxes');
  const interceptHttpsLinks = readValue('intercept_https_links');
  const badge = accountScope === 'all' ? '按账号管理信任项' : `${accountTrusts.length} 条信任`;

  return (
    <SettingsSection
      badge={<SettingsBadge tone="info">{badge}</SettingsBadge>}
      dataSection="privacy"
    >
      {accountScope === 'all' && (
        <SettingsNotice tone="info" title="统一是批量编辑范围">
          <p>下面的偏好只会在你点击“保存”后应用到所有支持的邮箱账号；未修改的字段会保持各账号原值。</p>
        </SettingsNotice>
      )}

      <SettingsSwitch
        label="允许加载远程图片"
        description={valueIsMixed(remoteImagesAllowed)
          ? '不同邮箱账号当前设置不同；修改后会统一应用。'
          : remoteImagesAllowed
            ? '邮件中的远程图片会直接加载，可能暴露打开行为与网络位置；可信发件人或域名仍可单独放行。'
            : '默认阻止远程图片与追踪像素；可信发件人或域名可单独放行。'}
        checked={remoteImagesAllowed === true}
        indeterminate={valueIsMixed(remoteImagesAllowed)}
        onChange={(checked) => updateBoolean('remote_images_allowed', checked)}
      />

      <SettingsSwitch
        label="提示外部发件人"
        description={valueIsMixed(warnExternalSenders)
          ? '不同邮箱账号当前设置不同；修改后会统一应用。'
          : warnExternalSenders
            ? '发件人域名与当前账号不同的邮件会显示“外部发件人”提示，便于核对身份。'
            : '关闭后，外部发件人的邮件不额外提示。'}
        checked={warnExternalSenders === true}
        indeterminate={valueIsMixed(warnExternalSenders)}
        onChange={(checked) => updateBoolean('warn_external_senders', checked)}
      />

      <SettingsSwitch
        label="拦截外部邮箱邮件"
        description={valueIsMixed(blockExternalMailboxes)
          ? '不同邮箱账号当前设置不同；修改后会统一应用。'
          : '对来自其他邮箱域名的邮件显示拦截状态，避免把外部邮件误当作当前账号邮件。'}
        checked={blockExternalMailboxes === true}
        indeterminate={valueIsMixed(blockExternalMailboxes)}
        onChange={(checked) => updateBoolean('block_external_mailboxes', checked)}
      />

      <SettingsSwitch
        label="拦截邮件中的 HTTPS 链接"
        description={valueIsMixed(interceptHttpsLinks)
          ? '不同邮箱账号当前设置不同；修改后会统一应用。'
          : '打开邮件中的链接前先经过安全提示，降低误触风险。'}
        checked={interceptHttpsLinks === true}
        indeterminate={valueIsMixed(interceptHttpsLinks)}
        onChange={(checked) => updateBoolean('intercept_https_links', checked)}
      />

      {accountScope === 'all' ? (
        <SettingsNotice tone="info" title="远程图片信任列表按账号保存">
          <p>请在顶部选择具体邮箱账号后查看或移除该账号的信任项。</p>
        </SettingsNotice>
      ) : (
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
      )}

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
