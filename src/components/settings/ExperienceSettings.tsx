import type {
  Account,
  MailIdentity,
  MailIdentityInput,
  RemoteImageTrust,
} from '../../app/types';
import {
  emptyIdentityForm,
  sendUndoDelayOptions,
  toggleAccountNotificationList,
  type SendUndoDelaySeconds,
} from '../../app/appConfig';
import { formatDate, type NotificationPolicy } from '../../mailUtils';
import './settings.css';

type ExperienceSettingsProps = {
  accountForm: Account;
  accounts: Account[];
  notificationPolicy: NotificationPolicy;
  sendUndoDelaySeconds: SendUndoDelaySeconds;
  remoteImageTrusts: RemoteImageTrust[];
  identities: MailIdentity[];
  identityForm: MailIdentityInput;
  onAccountFormChange: (account: Account) => void;
  onNotificationPolicyChange: (policy: NotificationPolicy) => void;
  onSendUndoDelayChange: (seconds: SendUndoDelaySeconds) => void;
  onDeleteRemoteImageTrust: (trust: RemoteImageTrust) => void;
  onIdentityFormChange: (identity: MailIdentityInput) => void;
  onEditIdentity: (identity: MailIdentity) => void;
  onDeleteIdentity: (identity: MailIdentity) => void;
  onSaveIdentity: () => void;
};

export default function ExperienceSettings({
  accountForm,
  accounts,
  notificationPolicy,
  sendUndoDelaySeconds,
  remoteImageTrusts,
  identities,
  identityForm,
  onAccountFormChange,
  onNotificationPolicyChange,
  onSendUndoDelayChange,
  onDeleteRemoteImageTrust,
  onIdentityFormChange,
  onEditIdentity,
  onDeleteIdentity,
  onSaveIdentity,
}: ExperienceSettingsProps) {
  const accountTrusts = remoteImageTrusts.filter((trust) => trust.account_id === accountForm.id);
  const accountIdentities = identities.filter((identity) => identity.account_id === accountForm.id);

  return (
    <div className="settings-experience-stack">
      <section className="tool-panel settings-send-panel" data-settings-section="sending">
        <header className="tool-header">
          <span>
            <strong>发送与撤回</strong>
            <small>发送后短暂保留在发件箱，误发时可立即撤回到草稿箱</small>
          </span>
          <em>{sendUndoDelaySeconds > 0 ? `${sendUndoDelaySeconds} 秒` : '已关闭'}</em>
        </header>
        <div className="settings-send-control">
          <span>
            <strong>撤销发送延迟</strong>
            <small>倒计时结束后自动进入现有 SMTP 后台发送任务，重启应用后仍会继续。</small>
          </span>
          <label>
            <span>延迟时间</span>
            <select
              aria-label="撤销发送延迟"
              value={sendUndoDelaySeconds}
              onChange={(event) => onSendUndoDelayChange(Number(event.target.value) as SendUndoDelaySeconds)}
            >
              {sendUndoDelayOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="settings-send-note">
          “发件箱”按钮仍用于手动排队或指定稍后发送；“发送”按钮使用这里的撤销延迟。
        </p>
      </section>

      <section className="tool-panel settings-policy-panel" data-settings-section="notifications">
        <header className="tool-header">
          <span>
            <strong>通知策略</strong>
            <small>控制免打扰、VIP 和账号级提醒优先级</small>
          </span>
          <em>
            {notificationPolicy.vipOnly
              ? '仅 VIP'
              : notificationPolicy.priorityAccounts.trim()
                ? '重点账号优先'
                : notificationPolicy.quietHoursEnabled
                  ? '免打扰已配置'
                  : '全部新邮件'}
          </em>
        </header>

        <div className="settings-toggle-grid">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={notificationPolicy.quietHoursEnabled}
              onChange={(event) => onNotificationPolicyChange({
                ...notificationPolicy,
                quietHoursEnabled: event.target.checked,
              })}
            />
            <span>
              <strong>免打扰时段</strong>
              <small>在设定时段内暂停普通新邮件通知</small>
            </span>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={notificationPolicy.vipOnly}
              onChange={(event) => onNotificationPolicyChange({
                ...notificationPolicy,
                vipOnly: event.target.checked,
              })}
            />
            <span>
              <strong>只提醒 VIP</strong>
              <small>忽略不在 VIP 发件人列表中的邮件</small>
            </span>
          </label>
        </div>

        <div className="settings-inline-fields">
          <label>
            免打扰开始
            <input
              type="time"
              value={notificationPolicy.quietStart}
              onChange={(event) => onNotificationPolicyChange({
                ...notificationPolicy,
                quietStart: event.target.value,
              })}
            />
          </label>
          <label>
            免打扰结束
            <input
              type="time"
              value={notificationPolicy.quietEnd}
              onChange={(event) => onNotificationPolicyChange({
                ...notificationPolicy,
                quietEnd: event.target.value,
              })}
            />
          </label>
        </div>

        <div className="settings-textarea-grid">
          <label>
            VIP 发件人
            <textarea
              value={notificationPolicy.vipSenders}
              onChange={(event) => onNotificationPolicyChange({
                ...notificationPolicy,
                vipSenders: event.target.value,
              })}
              placeholder={'ada@example.com\n@customer.com'}
            />
          </label>
          <label>
            静音账号
            <textarea
              value={notificationPolicy.mutedAccounts}
              onChange={(event) => onNotificationPolicyChange({
                ...notificationPolicy,
                mutedAccounts: event.target.value,
              })}
              placeholder={'archive@example.com\n2'}
            />
          </label>
          <label>
            重点账号
            <textarea
              value={notificationPolicy.priorityAccounts}
              onChange={(event) => onNotificationPolicyChange({
                ...notificationPolicy,
                priorityAccounts: event.target.value,
              })}
              placeholder={'work@example.com\n@company.com'}
            />
          </label>
        </div>

        <div className="notification-account-grid">
          {accounts.map((item) => {
            const email = item.email.toLowerCase();
            const muted = notificationPolicy.mutedAccounts.toLowerCase().includes(email);
            const priority = notificationPolicy.priorityAccounts.toLowerCase().includes(email);
            return (
              <div key={item.id}>
                <span>
                  <strong>{item.display_name || item.email}</strong>
                  <small>{item.email}</small>
                </span>
                <div>
                  <button
                    type="button"
                    className={muted ? 'active' : ''}
                    onClick={() => onNotificationPolicyChange(
                      toggleAccountNotificationList(notificationPolicy, 'mutedAccounts', item.email),
                    )}
                  >
                    {muted ? '取消静音' : '静音'}
                  </button>
                  <button
                    type="button"
                    className={priority ? 'active' : ''}
                    onClick={() => onNotificationPolicyChange(
                      toggleAccountNotificationList(notificationPolicy, 'priorityAccounts', item.email),
                    )}
                  >
                    {priority ? '取消重点' : '重点'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

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
