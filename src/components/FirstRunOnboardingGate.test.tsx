import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Account } from '../app/types';
import FirstRunOnboarding from './FirstRunOnboarding';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function newAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 1,
    email: 'ada@qq.com',
    display_name: 'Ada',
    provider: 'qq',
    imap_host: 'imap.qq.com:993',
    smtp_host: 'smtp.qq.com:587',
    incoming_protocol: 'imap',
    auth_type: 'password',
    sync_mode: '5min',
    remote_images_allowed: false,
    signature: '',
    cross_account_risk_warning: true,
    block_external_mailboxes: false,
    intercept_https_links: true,
    auto_download_attachments: false,
    warn_external_senders: false,
    onboarding_completed: false,
    is_default: true,
    ...overrides,
  };
}

/** 注入真实级联 CSS，使 jsdom 可计算弹层 z-index 与焦点相关样式。 */
function injectLayerCss() {
  for (const file of [
    'components/first-run-onboarding.css',
    'components/settings/settings-pages.css',
    'styles/reader.css',
  ]) {
    const style = document.createElement('style');
    style.setAttribute('data-layer-test', 'true');
    style.textContent = readFileSync(join(root, file), 'utf8');
    document.head.appendChild(style);
  }
}

function renderOnboarding(
  account = newAccount(),
  options: { accountId?: number; failSaves?: number } = {},
) {
  let saveAttempts = 0;
  const onAccountSettingsChange = vi
    .fn()
    .mockImplementation(() => {
      saveAttempts += 1;
      return (options.failSaves ?? 0) >= saveAttempts
        ? Promise.reject(new Error('数据库写入失败'))
        : Promise.resolve(undefined);
    });
  const onSendUndoDelayChange = vi.fn();
  const onComplete = vi.fn().mockResolvedValue(undefined);
  const onSkipAll = vi.fn().mockResolvedValue(undefined);
  const onStatus = vi.fn();
  const container = document.createElement('div');
  document.body.appendChild(container);
  render(
    <div>
      <div data-testid="underlying-app">
        <button type="button">底层按钮</button>
      </div>
      <FirstRunOnboarding
        accountId={options.accountId ?? account.id}
        account={account}
        sendUndoDelaySeconds={10}
        onAccountSettingsChange={onAccountSettingsChange}
        onSendUndoDelayChange={onSendUndoDelayChange}
        onComplete={onComplete}
        onSkipAll={onSkipAll}
        onStatus={onStatus}
      />
    </div>,
    { container },
  );
  return { onAccountSettingsChange, onSendUndoDelayChange, onComplete, onSkipAll, onStatus };
}

function goToContactsStep() {
  fireEvent.click(document.querySelectorAll('.onboarding-primary')[0]);
  fireEvent.click(document.querySelectorAll('.onboarding-primary')[0]);
  fireEvent.click(document.querySelectorAll('.onboarding-primary')[0]);
}

describe('FirstRunOnboarding gate', () => {
  afterEach(() => {
    cleanup();
    document.head.querySelectorAll('style[data-layer-test]').forEach((node) => node.remove());
    document.body.innerHTML = '';
  });

  it('renders above the app and makes the underlying app inert', () => {
    injectLayerCss();
    renderOnboarding();

    const backdrop = document.querySelector('.first-run-onboarding-backdrop');
    const underlying = document.querySelector('[data-testid="underlying-app"]');
    expect(backdrop).not.toBeNull();
    expect(underlying?.hasAttribute('inert')).toBe(true);
    expect(underlying?.getAttribute('aria-hidden')).toBe('true');
    expect(window.getComputedStyle(backdrop!).zIndex).toBe('2500');
  });

  it('keeps the real WindowChrome clickable (not inert) during onboarding', () => {
    injectLayerCss();
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(
      <div data-window-chrome>
        <button type="button">关闭窗口</button>
      </div>,
      { container },
    );
    renderOnboarding();

    const chrome = document.querySelector('[data-window-chrome]');
    expect(chrome).not.toBeNull();
    expect(chrome?.hasAttribute('inert')).toBe(false);
    expect(chrome?.hasAttribute('aria-hidden')).toBe(false);
  });

  it('traps Tab focus and ignores Escape instead of skipping the onboarding', () => {
    injectLayerCss();
    renderOnboarding();

    const firstFocusable = document.activeElement;
    expect(firstFocusable).not.toBeNull();

    fireEvent.keyDown(document.querySelector('.first-run-onboarding')!, { key: 'Escape' });
    expect(document.querySelector('.first-run-onboarding')).not.toBeNull();

    fireEvent.keyDown(document.querySelector('.first-run-onboarding')!, { key: 'Tab', shiftKey: true });
    const focusable = Array.from(
      document.querySelectorAll<HTMLElement>('.first-run-onboarding button, .first-run-onboarding input'),
    ).filter((element) => !element.hasAttribute('disabled'));
    expect(focusable).toContain(document.activeElement);
  });

  it('shows a visible save error with retry and rolls back the local toggle on failure', async () => {
    const { onAccountSettingsChange } = renderOnboarding(newAccount(), { failSaves: 1 });
    const toggle = document.querySelector('input[role="switch"][aria-label="自动下载新邮件附件"]') as HTMLInputElement;

    fireEvent.click(toggle);
    expect(toggle.checked).toBe(true);

    // 首次保存失败：本地开关回滚 + 显示错误与重试。
    await waitFor(() => {
      expect(document.querySelector('.onboarding-save-error')).not.toBeNull();
    });
    expect(toggle.checked).toBe(false);
    expect(document.querySelector('.onboarding-save-error')?.textContent).toContain('保存失败');
    expect(onAccountSettingsChange).toHaveBeenCalledTimes(1);

    // 重试入口：再次保存成功后错误消失，开关保持新值。
    const retryButton = document.querySelector('.onboarding-error-retry') as HTMLButtonElement;
    expect(retryButton).not.toBeNull();
    fireEvent.click(retryButton);
    await waitFor(() => {
      expect(onAccountSettingsChange).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(document.querySelector('.onboarding-save-error')).toBeNull();
    });
    expect(toggle.checked).toBe(true);
  });

  it('refuses to save when the bound account id does not match the account prop', async () => {
    const { onAccountSettingsChange } = renderOnboarding(newAccount({ id: 2 }), { accountId: 1 });
    fireEvent.click(document.querySelector('input[role="switch"][aria-label="自动下载新邮件附件"]') as HTMLInputElement);

    await waitFor(() => {
      expect(onAccountSettingsChange).not.toHaveBeenCalled();
    });
    expect(document.querySelector('.onboarding-save-error')?.textContent).toContain('已阻止保存');
  });

  it('keeps an idle contact-import dialog above and makes the onboarding inert', async () => {
    injectLayerCss();
    renderOnboarding();
    goToContactsStep();

    fireEvent.click(document.querySelector('.onboarding-import-button') as HTMLButtonElement);

    const importBackdrop = document.querySelector('.contact-import-backdrop');
    const onboardingBackdrop = document.querySelector('.first-run-onboarding-backdrop');
    expect(importBackdrop).not.toBeNull();
    expect(window.getComputedStyle(importBackdrop!).zIndex).toBe('2600');
    expect(Number(window.getComputedStyle(importBackdrop!).zIndex))
      .toBeGreaterThan(Number(window.getComputedStyle(onboardingBackdrop!).zIndex));

    // 二级模态会先可见，再由用户选择文件。外层引导对鼠标、Tab 与
    // 辅助技术均不可用，避免原生文件选择返回时“没有反应”的错觉。
    expect(document.querySelector('.contact-import-dialog')).not.toBeNull();
    expect(document.querySelector('.contact-import-dialog')?.textContent).toContain('选择文件');
    const onboarding = document.querySelector('.first-run-onboarding') as HTMLElement;
    expect(onboarding.hasAttribute('inert')).toBe(true);
    expect(onboarding.getAttribute('aria-hidden')).toBe('true');

    fireEvent.click(document.querySelector('.contact-import-dialog button:last-child') as HTMLButtonElement);
    await waitFor(() => {
      expect(document.querySelector('.contact-import-dialog')?.textContent).toContain('导入预览');
    });

    fireEvent.click(document.querySelector('button[aria-label="关闭导入预览"]') as HTMLButtonElement);
    await waitFor(() => {
      expect(document.querySelector('.contact-import-backdrop')).toBeNull();
      expect(onboarding.hasAttribute('inert')).toBe(false);
      expect(onboarding.getAttribute('aria-hidden')).toBeNull();
    });
  });
});
