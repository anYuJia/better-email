import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import AccountRemovalPanel from './AccountRemovalPanel';
import type { Account } from '../../app/types';

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 1,
    email: 'Demo@Better-Email.Local',
    display_name: 'Demo',
    provider: 'Custom',
    imap_host: 'imap.example.com:993',
    smtp_host: 'smtp.example.com:587',
    incoming_protocol: 'imap',
    auth_type: 'password',
    sync_mode: 'manual',
    remote_images_allowed: false,
    signature: '',
    cross_account_risk_warning: true,
    block_external_mailboxes: false,
    intercept_https_links: true,
    auto_download_attachments: false,
    warn_external_senders: false,
    onboarding_completed: true,
    is_default: true,
    ...overrides,
  };
}

function renderRemoval(account: Account, accountCount = 2) {
  const onRemove = vi.fn().mockResolvedValue(undefined);
  render(
    <AccountRemovalPanel
      account={account}
      accountCount={accountCount}
      onRemove={onRemove}
      embedded
    />,
  );
  return onRemove;
}

function confirmButton() {
  return screen.getByRole('button', { name: '永久移除' }) as HTMLButtonElement;
}

function isDisabled(button: HTMLButtonElement) {
  return button.disabled;
}

function confirmationInput() {
  return screen.getByLabelText('输入邮箱地址确认移除');
}

describe('AccountRemovalPanel', () => {
  afterEach(() => {
    cleanup();
  });

  it('disables the removal button while the confirmation input is empty', () => {
    renderRemoval(makeAccount());
    expect(isDisabled(confirmButton())).toBe(true);
  });

  it('disables the removal button and shows a mismatch hint for a wrong email', () => {
    renderRemoval(makeAccount());
    fireEvent.change(confirmationInput(), { target: { value: 'other@example.com' } });
    expect(isDisabled(confirmButton())).toBe(true);
    expect(screen.getByText('邮箱地址不匹配，请检查后重试。')).not.toBeNull();
  });

  it('enables the removal button when the exact email is typed (case and whitespace insensitive)', () => {
    renderRemoval(makeAccount({ email: 'Demo@Better-Email.Local' }));
    fireEvent.change(confirmationInput(), { target: { value: '  demo@better-email.local  ' } });
    expect(isDisabled(confirmButton())).toBe(false);
    expect(screen.queryByText(/邮箱地址不匹配/)).toBeNull();
  });

  it('hides the mismatch hint while the input is empty', () => {
    renderRemoval(makeAccount());
    expect(screen.queryByText(/邮箱地址不匹配/)).toBeNull();
  });

  it('shows the target email in the summary and an explicit manual-entry hint', () => {
    renderRemoval(makeAccount({ email: 'demo@better-email.local', display_name: 'Demo User' }));
    expect(screen.getByText('Demo User')).not.toBeNull();
    expect(screen.getAllByText('demo@better-email.local').length).toBeGreaterThan(0);
    expect(screen.getByText(/仅为示例，不会自动填入/)).not.toBeNull();
  });

  it('calls onRemove with the chosen credential option only after confirmation', async () => {
    const onRemove = renderRemoval(makeAccount());
    const toggle = screen.getByRole('checkbox') as HTMLInputElement;
    fireEvent.change(confirmationInput(), { target: { value: 'demo@better-email.local' } });
    fireEvent.click(toggle);
    fireEvent.click(confirmButton());
    await screen.findByText('正在移除…');
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith(false);
  });

  it('calls onRemove with deleteSecret true when the switch stays on', async () => {
    const onRemove = renderRemoval(makeAccount());
    fireEvent.change(confirmationInput(), { target: { value: 'demo@better-email.local' } });
    fireEvent.click(confirmButton());
    await screen.findByText('正在移除…');
    expect(onRemove).toHaveBeenCalledWith(true);
  });

  it('renders the formatted backend error without an Error: prefix', async () => {
    const onRemove = vi.fn().mockRejectedValue('Error: 本地数据库写入拒绝，删除凭据失败。');
    render(
      <AccountRemovalPanel
        account={makeAccount()}
        accountCount={2}
        onRemove={onRemove}
        embedded
      />,
    );
    fireEvent.change(confirmationInput(), { target: { value: 'demo@better-email.local' } });
    fireEvent.click(confirmButton());
    await screen.findByText('本地数据库写入拒绝，删除凭据失败。');
    expect(screen.queryByText(/^Error:/)).toBeNull();
    expect(isDisabled(confirmButton())).toBe(false);
  });

  it('keeps the removal button disabled when there are no accounts', () => {
    renderRemoval(makeAccount(), 0);
    expect(screen.queryByRole('button', { name: '永久移除' })).toBeNull();
    expect(screen.getByText('当前没有可移除的账号。')).not.toBeNull();
  });

  it('Escape closes only the nested dialog, not a parent settings window listener', () => {
    // 模拟 SettingsFrame 的 window 级 Escape 监听：嵌套对话框必须在 document
    // 冒泡阶段 stopPropagation，使父设置页不被一起关闭。
    const settingsClose = vi.fn();
    const windowHandler = () => settingsClose();
    window.addEventListener('keydown', windowHandler);
    try {
      render(
        <AccountRemovalPanel
          account={makeAccount()}
          accountCount={2}
          onRemove={vi.fn().mockResolvedValue(undefined)}
        />,
      );
      const trigger = screen.getByRole('button', { name: '移除账号' });
      trigger.focus();
      fireEvent.click(trigger);
      expect(document.querySelector('[data-account-remove-dialog]')).not.toBeNull();

      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(document.querySelector('[data-account-remove-dialog]')).toBeNull();
      expect(settingsClose).not.toHaveBeenCalled();
      // 焦点应回到打开嵌套框的触发按钮。
      expect(document.activeElement).toBe(trigger);
    } finally {
      window.removeEventListener('keydown', windowHandler);
    }
  });
});
