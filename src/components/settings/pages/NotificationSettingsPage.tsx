import type { Account } from '../../../app/types';
import { toggleAccountNotificationList } from '../../../app/appConfig';
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
    </div>
  );
}
