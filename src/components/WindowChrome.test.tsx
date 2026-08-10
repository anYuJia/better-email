import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import WindowChrome, { detectDesktopPlatform } from './WindowChrome';
import AccountLoginDialog from './AccountLoginDialog';
import { emptyAccountCreateForm } from '../app/uiConfig';

describe('WindowChrome', () => {
  afterEach(() => {
    cleanup();
    document.body.className = '';
  });

  it('detects the web platform when no Tauri runtime is present', () => {
    expect(detectDesktopPlatform()).toBe('web');
  });

  it('renders nothing in web / mock mode', () => {
    const { container } = render(<WindowChrome />);
    expect(container.querySelector('.window-chrome')).toBeNull();
    expect(document.body.classList.contains('platform-web')).toBe(false);
  });

  it('keeps the real WindowChrome visible and clickable above the login gate', () => {
    // Windows/Linux 布局：WindowChrome 与登录遮罩是兄弟节点，
    // 登录遮罩只 inert 其他兄弟，data-window-chrome 必须保持可点。
    const container = document.createElement('div');
    document.body.appendChild(container);
    render(
      <div>
        <div data-window-chrome className="window-chrome window-chrome-windows">
          <button type="button" aria-label="关闭窗口">×</button>
        </div>
        <div data-testid="app-below">
          <button type="button">写邮件</button>
        </div>
        <AccountLoginDialog
          form={emptyAccountCreateForm}
          onFormChange={() => undefined}
          onSubmit={async () => undefined}
        />
      </div>,
      { container },
    );

    const chrome = document.querySelector('[data-window-chrome]');
    const appBelow = document.querySelector('[data-testid="app-below"]');

    // 登录遮罩存在：底层应用 inert，WindowChrome 明确豁免。
    expect(document.querySelector('.account-login-gate')).not.toBeNull();
    expect(appBelow?.hasAttribute('inert')).toBe(true);
    expect(chrome?.hasAttribute('inert')).toBe(false);
    expect(chrome?.hasAttribute('aria-hidden')).toBe(false);

    // 关闭按钮可见可点：点击仍然触发窗口关闭命令（web 环境按钮仍在 DOM）。
    const closeButton = chrome?.querySelector('button[aria-label="关闭窗口"]');
    expect(closeButton).not.toBeNull();
    expect(closeButton).toHaveProperty('disabled', false);
  });
});
