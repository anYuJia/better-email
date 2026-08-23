import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import AccountSwitcher from './AccountSwitcher';
import type { Account } from '../app/types';

const accounts: Account[] = [
  {
    id: 1,
    email: 'first@example.com',
    display_name: 'First',
    provider: 'gmail',
    imap_host: 'imap.example.com',
    smtp_host: 'smtp.example.com',
    incoming_protocol: 'imap',
    auth_type: 'password',
    sync_mode: 'full',
    remote_images_allowed: false,
    signature: '',
    cross_account_risk_warning: false,
    block_external_mailboxes: false,
    intercept_https_links: false,
    auto_download_attachments: false,
    warn_external_senders: false,
    onboarding_completed: true,
    is_default: true,
  },
  {
    id: 2,
    email: 'second@example.com',
    display_name: 'Second',
    provider: 'outlook',
    imap_host: 'imap.example.com',
    smtp_host: 'smtp.example.com',
    incoming_protocol: 'imap',
    auth_type: 'password',
    sync_mode: 'full',
    remote_images_allowed: false,
    signature: '',
    cross_account_risk_warning: false,
    block_external_mailboxes: false,
    intercept_https_links: false,
    auto_download_attachments: false,
    warn_external_senders: false,
    onboarding_completed: true,
    is_default: false,
  },
];

function renderSwitcher() {
  return render(
    <AccountSwitcher
      accountScope="all"
      accounts={accounts}
      onChange={() => undefined}
      onSetDefault={() => undefined}
      onAddAccount={() => undefined}
    />,
  );
}

function openMenu(trigger: HTMLElement) {
  // 模拟真实点击的完整事件序列,pointerdown 与 click 分属两次独立的
  // React 重渲染——旧实现正是因此把「关闭」误判成「展开」。
  fireEvent.pointerDown(trigger);
  fireEvent.click(trigger);
}

describe('AccountSwitcher', () => {
  afterEach(() => {
    cleanup();
  });

  it('打开后再次点击同一触发按钮会关闭菜单', () => {
    renderSwitcher();
    const trigger = screen.getByRole('button', { name: /统一邮箱/ });

    expect(document.body.querySelector('.account-switcher-menu')).toBeNull();

    openMenu(trigger);
    expect(document.body.querySelector('.account-switcher-menu')).not.toBeNull();

    // 回归测试:此前第二次点击会「关闭又展开」。
    openMenu(trigger);
    expect(document.body.querySelector('.account-switcher-menu')).toBeNull();
  });

  it('打开菜单时转移焦点，Escape 后还给触发按钮', () => {
    renderSwitcher();
    const trigger = screen.getByRole('button', { name: /统一邮箱/ });

    openMenu(trigger);
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: /统一邮箱/ }));

    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
  });
});
