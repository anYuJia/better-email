import { useState } from 'react';
import type { Account } from '../../../app/types';
import {
  getAccountNotificationMode,
  setAccountNotificationMode,
  vipSenderEntries,
  addVipSenderEntry,
  removeVipSenderEntry,
  isValidVipSenderEntry,
  type AccountNotificationMode,
} from '../../../app/appConfig';
import type { NotificationPolicy } from '../../../mailUtils';
import {
  SettingsButton,
  SettingsEmptyState,
  SettingsNotice,
  SettingsSection,
  SettingsSwitch,
} from '../shared';

type NotificationSettingsPageProps = {
  accounts: Account[];
  notificationPolicy: NotificationPolicy;
  onNotificationPolicyChange: (policy: NotificationPolicy) => void;
};

const accountModeOptions: {
  mode: AccountNotificationMode;
  label: string;
  description: string;
}[] = [
  { mode: 'normal', label: '正常', description: '按全局策略提醒' },
  { mode: 'priority', label: '优先', description: '免打扰时段内仍提醒' },
  { mode: 'muted', label: '静音', description: '此账号邮件不弹系统提醒' },
];

export default function NotificationSettingsPage({
  accounts,
  notificationPolicy,
  onNotificationPolicyChange,
}: NotificationSettingsPageProps) {
  const [vipDraft, setVipDraft] = useState('');
  const [vipDraftError, setVipDraftError] = useState(false);

  const priorityCount = accounts.filter((item) => (
    getAccountNotificationMode(notificationPolicy, item.email) === 'priority'
  )).length;
  const mutedCount = accounts.filter((item) => (
    getAccountNotificationMode(notificationPolicy, item.email) === 'muted'
  )).length;
  const vipEntries = vipSenderEntries(notificationPolicy.vipSenders);
  const quietHoursOn = notificationPolicy.quietHoursEnabled;

  const addVipEntry = () => {
    const draft = vipDraft.trim();
    if (!draft) return;
    if (!isValidVipSenderEntry(draft)) {
      setVipDraftError(true);
      return;
    }
    setVipDraftError(false);
    onNotificationPolicyChange({
      ...notificationPolicy,
      vipSenders: addVipSenderEntry(notificationPolicy.vipSenders, draft),
    });
    setVipDraft('');
  };

  const removeVipEntry = (entry: string) => {
    onNotificationPolicyChange({
      ...notificationPolicy,
      vipSenders: removeVipSenderEntry(notificationPolicy.vipSenders, entry),
    });
  };

  return (
    <>
      <SettingsSection
        title="通知"
        description="只保留真正需要打断你的提醒。"
        dataSection="notifications"
      >
        <SettingsSwitch
          label="只提醒 VIP"
          description="开启后，非 VIP 发件人的新邮件保持静默。"
          checked={notificationPolicy.vipOnly}
          onChange={(checked) => onNotificationPolicyChange({
            ...notificationPolicy,
            vipOnly: checked,
          })}
        />
        {notificationPolicy.vipOnly && vipEntries.length === 0 && (
          <SettingsNotice tone="warning" title="还没有 VIP 发件人">
            <p>当前开启后将不会收到普通新邮件提醒。请在下方“VIP 发件人”中至少添加一项。</p>
          </SettingsNotice>
        )}

        <SettingsSwitch
          label="免打扰"
          description="该时段内仅 VIP 发件人与优先账号可以提醒。"
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

      <SettingsSection
        title="优先与例外"
        description="只有需要精细控制时才展开。"
        dataSection="notification-exceptions"
      >
        <details className="settings-disclosure" data-settings-section="notification-account-rules">
          <summary>
            <span>
              <strong>账号通知优先级</strong>
              <small>为不同邮箱设置正常、优先或静音。</small>
            </span>
            <em>{priorityCount} 优先 · {mutedCount} 静音</em>
          </summary>
          <div className="settings-disclosure-body">
            <div className="notification-account-grid" aria-label="账号提醒模式">
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
                            data-mode={option.mode}
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
                <SettingsEmptyState>还没有可配置的邮箱账号。</SettingsEmptyState>
              )}
            </div>
          </div>
        </details>

        <details className="settings-disclosure" data-settings-section="notification-vip-rules">
          <summary>
            <span>
              <strong>VIP 发件人</strong>
              <small>这些发件人的邮件可以穿透免打扰。</small>
            </span>
            <em>{vipEntries.length} 个</em>
          </summary>
          <div className="settings-disclosure-body vip-sender-editor">
            <div className="vip-sender-input-row">
              <input
                type="text"
                value={vipDraft}
                placeholder="ada@example.com 或 @customer.com"
                aria-label="添加 VIP 发件人"
                aria-invalid={vipDraftError}
                onChange={(event) => {
                  setVipDraft(event.target.value);
                  setVipDraftError(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addVipEntry();
                  }
                }}
              />
              <SettingsButton onClick={addVipEntry}>添加</SettingsButton>
            </div>
            {vipDraftError && (
              <p className="st-field-error">请输入邮箱地址或 @domain.com 形式的域名。</p>
            )}
            {vipEntries.length === 0 ? (
              <SettingsEmptyState>还没有 VIP 发件人。</SettingsEmptyState>
            ) : (
              <ul className="vip-sender-chips" aria-label="VIP 发件人列表">
                {vipEntries.map((entry) => (
                  <li key={entry} className="vip-sender-chip">
                    <span>{entry}</span>
                    <button
                      type="button"
                      aria-label={`移除 ${entry}`}
                      onClick={() => removeVipEntry(entry)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>
      </SettingsSection>
    </>
  );
}
