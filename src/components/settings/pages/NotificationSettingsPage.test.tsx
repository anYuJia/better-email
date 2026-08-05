import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Account } from '../../../app/types';
import { defaultNotificationPolicy, type NotificationPolicy } from '../../../mailUtils';
import NotificationSettingsPage from './NotificationSettingsPage';

function makeAccount(id: number, email: string, displayName = ''): Account {
  return {
    id,
    email,
    display_name: displayName || email,
  } as Account;
}

function makePolicy(overrides: Partial<NotificationPolicy> = {}): NotificationPolicy {
  return { ...defaultNotificationPolicy, ...overrides };
}

function renderPage(
  policy: NotificationPolicy,
  accounts: Account[],
  onChange: (next: NotificationPolicy) => void = () => undefined,
) {
  return render(
    <NotificationSettingsPage
      accounts={accounts}
      notificationPolicy={policy}
      onNotificationPolicyChange={onChange}
    />,
  );
}

describe('NotificationSettingsPage', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows the current policy scope in the header status', () => {
    renderPage(makePolicy({ vipOnly: true, quietHoursEnabled: true }), []);
    expect(screen.getByTitle('当前生效的通知范围').textContent).toContain('仅 VIP');
    expect(screen.getByTitle('当前生效的通知范围').textContent).toContain('免打扰');
  });

  it('dimms and disables quiet hours time inputs while the toggle is off', () => {
    const { container } = renderPage(makePolicy({ quietHoursEnabled: false }), []);
    const times = container.querySelector('.notification-quiet-times');
    expect(times?.className).toContain('is-dimmed');
    const start = screen.getByLabelText('免打扰开始') as HTMLInputElement;
    expect(start.disabled).toBe(true);
  });

  it('enables quiet hours time inputs after the toggle is on', () => {
    const { container } = renderPage(makePolicy({ quietHoursEnabled: true }), []);
    const times = container.querySelector('.notification-quiet-times');
    expect(times?.className).not.toContain('is-dimmed');
    const start = screen.getByLabelText('免打扰开始') as HTMLInputElement;
    expect(start.disabled).toBe(false);
  });

  it('maps account notification modes to friendly labels', () => {
    const accounts = [makeAccount(1, 'work@example.com', '工作'), makeAccount(2, 'archive@example.com')];
    const policy = makePolicy({ priorityAccounts: 'work@example.com', mutedAccounts: 'archive@example.com' });
    renderPage(policy, accounts);

    const workButtons = screen.getAllByRole('group', { name: 'work@example.com 提醒模式' })[0];
    const workLabels = Array.from(workButtons.querySelectorAll('button')).map((button) => button.textContent);
    expect(workLabels).toEqual(['正常通知', '优先提醒', '不通知']);

    const priorityButton = Array.from(workButtons.querySelectorAll('button'))
      .find((button) => button.textContent === '优先提醒');
    expect(priorityButton?.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows priority and muted counts next to the account section', () => {
    const accounts = [
      makeAccount(1, 'work@example.com'),
      makeAccount(2, 'archive@example.com'),
      makeAccount(3, 'noise@example.com'),
    ];
    const policy = makePolicy({
      priorityAccounts: 'work@example.com',
      mutedAccounts: 'archive@example.com',
    });
    renderPage(policy, accounts);
    expect(screen.getByText('1 个优先 · 1 个静音')).not.toBeNull();
  });

  it('renders VIP senders as chips with an add form instead of a textarea', () => {
    const policy = makePolicy({ vipSenders: 'ada@example.com\n@customer.com' });
    const { container } = renderPage(policy, []);

    expect(container.querySelector('textarea')).toBeNull();
    expect(screen.getByText('ada@example.com')).not.toBeNull();
    expect(screen.getByText('@customer.com')).not.toBeNull();
    expect(screen.getByPlaceholderText('ada@example.com 或 @customer.com')).not.toBeNull();
  });

  it('adds a valid VIP sender and clears the draft', () => {
    const updated: { policy: NotificationPolicy | null } = { policy: null };
    renderPage(makePolicy({ vipSenders: 'ada@example.com' }), [], (next) => {
      updated.policy = next;
    });

    const input = screen.getByLabelText('添加 VIP 发件人');
    fireEvent.change(input, { target: { value: '@company.com' } });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));

    expect(updated.policy?.vipSenders).toBe('ada@example.com\n@company.com');
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('rejects an invalid VIP sender with an inline hint', () => {
    const updated: { policy: NotificationPolicy | null } = { policy: null };
    renderPage(makePolicy(), [], (next) => {
      updated.policy = next;
    });

    const input = screen.getByLabelText('添加 VIP 发件人');
    fireEvent.change(input, { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));

    expect(updated.policy).toBeNull();
    expect(screen.getByText(/请输入邮箱地址/)).not.toBeNull();
  });

  it('removes a VIP sender chip', () => {
    const updated: { policy: NotificationPolicy | null } = { policy: null };
    renderPage(makePolicy({ vipSenders: 'ada@example.com\n@customer.com' }), [], (next) => {
      updated.policy = next;
    });

    fireEvent.click(screen.getByRole('button', { name: '移除 ada@example.com' }));
    expect(updated.policy?.vipSenders).toBe('@customer.com');
  });

  it('no longer exposes separate muted/priority account textareas', () => {
    const { container } = renderPage(makePolicy(), [makeAccount(1, 'work@example.com')]);
    expect(container.querySelectorAll('textarea')).toHaveLength(0);
    expect(screen.queryByRole('textbox', { name: '静音账号' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: '重点账号' })).toBeNull();
  });

  it('explains the rule evaluation order', () => {
    renderPage(makePolicy(), []);
    const order = screen.getByLabelText('规则优先级说明');
    expect(order.textContent).toContain('静音账号');
    expect(order.textContent).toContain('免打扰时段');
    expect(order.textContent).toContain('正常通知');
  });
});
