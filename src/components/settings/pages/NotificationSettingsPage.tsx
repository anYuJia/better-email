import type { Account } from '../../../app/types';
import {
  getAccountNotificationMode,
  setAccountNotificationMode,
  type AccountNotificationMode,
} from '../../../app/appConfig';
import type { NotificationPolicy } from '../../../mailUtils';

type NotificationSettingsPageProps = {
  accounts: Account[];
  notificationPolicy: NotificationPolicy;
  onNotificationPolicyChange: (policy: NotificationPolicy) => void;
};

export default function NotificationSettingsPage({
  accounts,
  notificationPolicy,
  onNotificationPolicyChange,
}: NotificationSettingsPageProps) {
  const priorityCount = accounts.filter((item) => (
    getAccountNotificationMode(notificationPolicy, item.email) === 'priority'
  )).length;
  const mutedCount = accounts.filter((item) => (
    getAccountNotificationMode(notificationPolicy, item.email) === 'muted'
  )).length;
  const accountModeOptions: {
    mode: AccountNotificationMode;
    label: string;
    description: string;
  }[] = [
    { mode: 'normal', label: '默认', description: '按全局策略提醒' },
    { mode: 'priority', label: '重点', description: '免打扰内也提醒' },
    { mode: 'muted', label: '静音', description: '不弹系统提醒' },
  ];

  return (
    <div className="settings-experience-stack">
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

        <div className="notification-account-grid" aria-label="账号提醒模式">
          <header className="notification-account-grid-header">
            <span>
              <strong>账号提醒模式</strong>
              <small>常用账号直接点选，避免手写邮箱列表；重点账号会穿透免打扰。</small>
            </span>
            <em>{priorityCount} 个重点 · {mutedCount} 个静音</em>
          </header>
          {accounts.map((item) => {
            const mode = getAccountNotificationMode(notificationPolicy, item.email);
            return (
              <div key={item.id} data-notification-account={item.email}>
                <span>
                  <strong>{item.display_name || item.email}</strong>
                  <small>{item.email}</small>
                </span>
                <div className="notification-account-mode" role="group" aria-label={`${item.email} 提醒模式`}>
                  {accountModeOptions.map((option) => {
                    const active = mode === option.mode;
                    return (
                      <button
                        type="button"
                        className={active ? 'active' : ''}
                        key={option.mode}
                        aria-pressed={active}
                        title={option.description}
                        onClick={() => onNotificationPolicyChange(
                          setAccountNotificationMode(notificationPolicy, item.email, option.mode),
                        )}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {accounts.length === 0 && (
            <p className="settings-empty-state">还没有可配置的邮箱账号。</p>
          )}
        </div>

        <div className="settings-textarea-grid notification-advanced-lists">
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
      </section>
    </div>
  );
}
