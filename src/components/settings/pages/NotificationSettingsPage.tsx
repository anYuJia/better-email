import { vipSenderEntries } from '../../../app/appConfig';
import type { NotificationPolicy } from '../../../mailUtils';
import {
  SettingsNotice,
  SettingsSection,
  SettingsSwitch,
} from '../shared';

type NotificationSettingsPageProps = {
  notificationPolicy: NotificationPolicy;
  onNotificationPolicyChange: (policy: NotificationPolicy) => void;
};

export default function NotificationSettingsPage({
  notificationPolicy,
  onNotificationPolicyChange,
}: NotificationSettingsPageProps) {
  const vipEntries = vipSenderEntries(notificationPolicy.vipSenders);
  const quietHoursOn = notificationPolicy.quietHoursEnabled;

  return (
    <SettingsSection
      title="通知"
      description="只保留真正需要打断你的提醒。"
      dataSection="notifications"
    >
      <SettingsSwitch
        label="只提醒 VIP"
        description="开启后，非 VIP 联系人的新邮件保持静默。"
        checked={notificationPolicy.vipOnly}
        onChange={(checked) => onNotificationPolicyChange({
          ...notificationPolicy,
          vipOnly: checked,
        })}
      />
      {notificationPolicy.vipOnly && vipEntries.length === 0 && (
        <SettingsNotice tone="warning" title="还没有 VIP 联系人">
          <p>请先在「通讯录」中把重要联系人设为 VIP，避免错过提醒。</p>
        </SettingsNotice>
      )}

      <SettingsSwitch
        label="免打扰"
        description="该时段内仅 VIP 联系人的邮件可以提醒。"
        checked={quietHoursOn}
        onChange={(checked) => onNotificationPolicyChange({
          ...notificationPolicy,
          quietHoursEnabled: checked,
        })}
      />
      {quietHoursOn && (
        <div className="st-field-grid notification-quiet-times">
          <label className="st-field">
            <span className="st-field-label">开始</span>
            <input
              type="time"
              value={notificationPolicy.quietStart}
              onChange={(event) => onNotificationPolicyChange({
                ...notificationPolicy,
                quietStart: event.target.value,
              })}
            />
          </label>
          <label className="st-field">
            <span className="st-field-label">结束</span>
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
      )}
    </SettingsSection>
  );
}
