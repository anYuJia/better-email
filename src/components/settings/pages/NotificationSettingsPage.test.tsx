import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { defaultNotificationPolicy, type NotificationPolicy } from '../../../mailUtils';
import NotificationSettingsPage from './NotificationSettingsPage';

function makePolicy(overrides: Partial<NotificationPolicy> = {}): NotificationPolicy {
  return { ...defaultNotificationPolicy, ...overrides };
}

function renderPage(
  policy: NotificationPolicy,
  onChange: (next: NotificationPolicy) => void = () => undefined,
) {
  return render(
    <NotificationSettingsPage
      notificationPolicy={policy}
      onNotificationPolicyChange={onChange}
    />,
  );
}

describe('NotificationSettingsPage', () => {
  afterEach(() => cleanup());

  it('只保留 VIP 与免打扰两个核心通知设置', () => {
    renderPage(makePolicy({ vipOnly: true, quietHoursEnabled: true }));
    expect(screen.getByRole('checkbox', { name: /^只提醒 VIP/ })).not.toBeNull();
    expect(screen.getByRole('checkbox', { name: /^免打扰/ })).not.toBeNull();
    expect(screen.queryByText('账号通知优先级')).toBeNull();
    expect(screen.queryByLabelText('添加 VIP 发件人')).toBeNull();
  });

  it('关闭免打扰时不显示时间输入', () => {
    const { container } = renderPage(makePolicy({ quietHoursEnabled: false }));
    expect(container.querySelector('.notification-quiet-times')).toBeNull();
    expect(screen.queryByLabelText('开始')).toBeNull();
  });

  it('开启免打扰时可调整开始与结束时间', () => {
    const changes: NotificationPolicy[] = [];
    renderPage(makePolicy({ quietHoursEnabled: true }), (next) => changes.push(next));
    fireEvent.change(screen.getByLabelText('开始'), { target: { value: '22:30' } });
    expect(changes[changes.length - 1]?.quietStart).toBe('22:30');
    expect(screen.getByLabelText('结束')).not.toBeNull();
  });

  it('没有 VIP 联系人时引导用户到通讯录设置', () => {
    renderPage(makePolicy({ vipOnly: true, vipSenders: '' }));
    expect(screen.getByText('还没有 VIP 联系人')).not.toBeNull();
    expect(screen.getByText(/在「通讯录」中把重要联系人设为 VIP/)).not.toBeNull();
  });

  it('已有 VIP 联系人时不显示警告', () => {
    renderPage(makePolicy({ vipOnly: true, vipSenders: 'ada@example.com' }));
    expect(screen.queryByText('还没有 VIP 联系人')).toBeNull();
  });
});
