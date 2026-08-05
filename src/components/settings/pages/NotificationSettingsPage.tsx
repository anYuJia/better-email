import React, { useState } from 'react';
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
  SettingsBadge,
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
  { mode: 'normal', label: '正常通知', description: '按全局策略提醒' },
  { mode: 'priority', label: '优先提醒', description: '免打扰时段内仍提醒' },
  { mode: 'muted', label: '不通知', description: '此账号邮件不弹系统提醒' },
];

function policyStatusLabel(policy: NotificationPolicy): string {
  const parts: string[] = [];
  if (policy.vipOnly) parts.push('仅 VIP');
  if (policy.quietHoursEnabled) parts.push(`免打扰 ${policy.quietStart}–${policy.quietEnd}`);
  if (!policy.vipOnly && !policy.quietHoursEnabled) parts.push('全部新邮件');
  return parts.join(' · ');
}

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

  const quietHoursOn = notificationPolicy.quietHoursEnabled;

  return (
    <SettingsSection
      title="通知策略"
      description="控制哪些邮件会通知你，以及什么时候不该被打扰"
      badge={
        <SettingsBadge tone="info" title="当前生效的通知范围">
          {policyStatusLabel(notificationPolicy)}
        </SettingsBadge>
      }
      dataSection="notifications"
    >
      <SettingsNotice tone="info" title="邮件到达时">
        <p>VIP 发件人与重点账号优先提醒；免打扰时段内普通邮件静默，VIP 与重点账号仍然提醒。</p>
      </SettingsNotice>

      <div className="st-subsection">
        <SettingsSwitch
          label="只提醒 VIP"
          description="忽略不在 VIP 发件人列表中的邮件，其余邮件全部静默。"
          checked={notificationPolicy.vipOnly}
          onChange={(checked) => onNotificationPolicyChange({
            ...notificationPolicy,
            vipOnly: checked,
          })}
        />
        <SettingsNotice tone="info">
          <p>
            <strong>VIP 发件人</strong> · {vipEntries.length > 0 ? `${vipEntries.length} 个` : '尚未设置'}
          </p>
        </SettingsNotice>
      </div>

      <div className="st-subsection">
        <SettingsSwitch
          label="免打扰时段"
          description="开启后，仅 VIP 发件人与重点账号的邮件会在该时段内提醒。"
          checked={quietHoursOn}
          onChange={(checked) => onNotificationPolicyChange({
            ...notificationPolicy,
            quietHoursEnabled: checked,
          })}
        />
        <div className={`st-field-grid notification-quiet-times${quietHoursOn ? '' : ' is-dimmed'}`} aria-hidden={!quietHoursOn}>
          <label className="st-field">
            <span className="st-field-label">免打扰开始</span>
            <input
              type="time"
              disabled={!quietHoursOn}
              value={notificationPolicy.quietStart}
              onChange={(event) => onNotificationPolicyChange({
                ...notificationPolicy,
                quietStart: event.target.value,
              })}
            />
          </label>
          <label className="st-field">
            <span className="st-field-label">免打扰结束</span>
            <input
              type="time"
              disabled={!quietHoursOn}
              value={notificationPolicy.quietEnd}
              onChange={(event) => onNotificationPolicyChange({
                ...notificationPolicy,
                quietEnd: event.target.value,
              })}
            />
          </label>
        </div>
        {!quietHoursOn && (
          <p className="st-field-hint">开启免打扰后，可在此设定开始与结束时间。</p>
        )}
      </div>

      <div className="st-subsection">
        <header className="st-subsection-header">
          <span>
            <strong>账号通知优先级</strong>
            <small>为每个账号单独选择提醒方式；优先提醒账号会穿透免打扰时段。</small>
          </span>
          <SettingsBadge>{priorityCount} 个优先 · {mutedCount} 个静音</SettingsBadge>
        </header>
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

      <div className="st-subsection">
        <header className="st-subsection-header">
          <span>
            <strong>发件人规则</strong>
            <small>VIP 发件人的邮件始终提醒，且优先于普通邮件展示。</small>
          </span>
        </header>
        <div className="vip-sender-editor">
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
            <p className="st-field-error">请输入邮箱地址（如 ada@example.com）或域名（如 @customer.com）。</p>
          )}
          {vipEntries.length === 0 ? (
            <SettingsEmptyState>
              还没有 VIP 发件人。添加后，他们的邮件会优先提醒。
            </SettingsEmptyState>
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
      </div>

      <div className="notification-rule-order" aria-label="规则优先级说明">
        <strong>规则判断顺序</strong>
        <ol>
          <li><span>静音账号</span>最先拦截，不弹系统提醒</li>
          <li><span>只提醒 VIP</span>开启后，仅 VIP 发件人的邮件会提醒</li>
          <li><span>免打扰时段</span>内暂停通知，VIP 发件人与重点账号仍会提醒</li>
          <li><span>VIP 发件人 · 重点账号</span>优先提醒</li>
          <li>其余邮件按<span>正常通知</span>处理</li>
        </ol>
      </div>
    </SettingsSection>
  );
}
