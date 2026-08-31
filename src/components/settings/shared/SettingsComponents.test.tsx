import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  SettingsBadge,
  SettingsButton,
  SettingsEmptyState,
  SettingsField,
  SettingsNotice,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from './index';

describe('shared settings components', () => {
  afterEach(() => {
    cleanup();
  });

  it('SettingsSection renders title, description and badge in a header', () => {
    const { container } = render(
      <SettingsSection
        title="账号"
        description="管理邮箱账号"
        badge={<SettingsBadge tone="info">3 个</SettingsBadge>}
      >
        <p>内容</p>
      </SettingsSection>,
    );
    expect(screen.getByText('账号')).not.toBeNull();
    expect(screen.getByText('管理邮箱账号')).not.toBeNull();
    expect(screen.getByText('3 个')).not.toBeNull();
    expect(container.querySelector('.st-section')).not.toBeNull();
    expect(container.querySelector('.st-section-header')).not.toBeNull();
    expect(container.querySelector('.st-section-body')).not.toBeNull();
  });

  it('SettingsSection omits the header and body when not provided', () => {
    const { container } = render(<SettingsSection />);
    expect(container.querySelector('.st-section-header')).toBeNull();
    expect(container.querySelector('.st-section-body')).toBeNull();
  });

  it('SettingsSwitch renders a real checkbox with label and description', () => {
    const { container } = render(
      <SettingsSwitch label="只提醒 VIP" description="其余静默" checked={false} onChange={() => undefined} />,
    );
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    expect(screen.getByText('只提醒 VIP')).not.toBeNull();
    expect(screen.getByText('其余静默')).not.toBeNull();
    expect(container.querySelector('.st-switch')).not.toBeNull();
  });

  it('SettingsSwitch toggles through onChange', () => {
    let checked = false;
    render(
      <SettingsSwitch
        label="开关"
        checked={checked}
        onChange={(next) => { checked = next; }}
      />,
    );
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(checked).toBe(true);
  });

  it('SettingsSwitch exposes a mixed state without choosing either value', () => {
    const { container } = render(
      <SettingsSwitch
        label="统一偏好"
        checked={false}
        indeterminate
        onChange={() => undefined}
      />,
    );
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.getAttribute('aria-checked')).toBe('mixed');
    expect(checkbox.getAttribute('data-indeterminate')).toBe('true');
    expect(checkbox.indeterminate).toBe(true);
    expect(container.querySelector('.st-switch.is-indeterminate')).not.toBeNull();
  });

  it('SettingsSwitch renders copy before the checkbox so the switch sits at the row end', () => {
    const { container } = render(
      <SettingsSwitch label="只提醒 VIP" description="其余静默" checked={false} onChange={() => undefined} />,
    );
    const switchEl = container.querySelector('.st-switch');
    const copyEl = container.querySelector('.st-switch-copy');
    const checkboxEl = container.querySelector('input[type="checkbox"]');
    expect(switchEl).not.toBeNull();
    expect(copyEl).not.toBeNull();
    expect(checkboxEl).not.toBeNull();
    expect(copyEl!.compareDocumentPosition(checkboxEl!) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(switchEl!.children[0]).toBe(copyEl);
    expect(switchEl!.children[switchEl!.children.length - 1]).toBe(checkboxEl);
  });

  it('SettingsRow renders copy and control slots', () => {
    const { container } = render(
      <SettingsRow
        title="撤销延迟"
        description="倒计时后发送"
        control={<select aria-label="延迟"><option>10 秒</option></select>}
      />,
    );
    expect(screen.getByText('撤销延迟')).not.toBeNull();
    expect(screen.getByText('倒计时后发送')).not.toBeNull();
    expect(screen.getByLabelText('延迟')).not.toBeNull();
    expect(container.querySelector('.st-row-control')).not.toBeNull();
  });

  it('SettingsField labels its control and renders hints', () => {
    render(
      <SettingsField label="邮箱地址" hint="用于登录">
        <input aria-label="邮箱地址输入" />
      </SettingsField>,
    );
    expect(screen.getByText('邮箱地址')).not.toBeNull();
    expect(screen.getByText('用于登录')).not.toBeNull();
  });

  it('SettingsButton applies semantic variants', () => {
    const { container } = render(
      <>
        <SettingsButton variant="primary">保存</SettingsButton>
        <SettingsButton variant="danger">删除</SettingsButton>
        <SettingsButton>取消</SettingsButton>
      </>,
    );
    const buttons = Array.from(container.querySelectorAll('.st-btn'));
    expect(buttons.some((button) => button.className.includes('st-btn-primary'))).toBe(true);
    expect(buttons.some((button) => button.className.includes('st-btn-danger'))).toBe(true);
    expect(buttons.some((button) => button.className.includes('st-btn-secondary'))).toBe(true);
    expect(screen.getByRole('button', { name: '保存' })).not.toBeNull();
  });

  it('SettingsNotice renders a warning tone with title and body', () => {
    const { container } = render(
      <SettingsNotice tone="warning" title="注意">
        <p>有风险</p>
      </SettingsNotice>,
    );
    expect(screen.getByText('注意')).not.toBeNull();
    expect(screen.getByText('有风险')).not.toBeNull();
    expect(container.querySelector('.st-notice-warning')).not.toBeNull();
  });

  it('SettingsEmptyState renders children and actions', () => {
    const { container } = render(
      <SettingsEmptyState actions={<button type="button">新建</button>}>
        暂无数据
      </SettingsEmptyState>,
    );
    expect(screen.getByText('暂无数据')).not.toBeNull();
    expect(screen.getByRole('button', { name: '新建' })).not.toBeNull();
    expect(container.querySelector('.st-empty')).not.toBeNull();
  });
});
