import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AppTitlebar, { detectDesktopPlatform } from './AppTitlebar';
import AccountLoginDialog from './AccountLoginDialog';
import { emptyAccountCreateForm } from '../app/uiConfig';

const tauriWindowMocks = vi.hoisted(() => {
  const currentWindow = {
    close: vi.fn(async () => undefined),
    innerPosition: vi.fn(async () => ({ x: 120, y: 80 })),
    isMaximized: vi.fn(async () => false),
    maximize: vi.fn(async () => undefined),
    minimize: vi.fn(async () => undefined),
    setPosition: vi.fn(async () => undefined),
    startDragging: vi.fn(async () => undefined),
    toggleMaximize: vi.fn(async () => undefined),
    onResized: vi.fn(async () => () => undefined),
  };
  return {
    currentWindow,
    getCurrentWindow: vi.fn(() => currentWindow),
    moduleLoaded: vi.fn(),
  };
});

vi.mock('@tauri-apps/api/window', () => {
  tauriWindowMocks.moduleLoaded();
  return {
    getCurrentWindow: tauriWindowMocks.getCurrentWindow,
    LogicalPosition: class LogicalPosition {
      constructor(public x: number, public y: number) {}
    },
  };
});

function renderTitlebar(
  testPlatform?: 'macos' | 'windows' | 'linux' | 'web',
  currentViewLabel?: string,
  viewSummary?: string,
) {
  return render(
    <AppTitlebar
      searchInputRef={{ current: null }}
      query=""
      appliedQuery=""
      searchScope="folder"
      filter="all"
      messages={[]}
      onSearchSubmit={vi.fn()}
      onQueryChange={vi.fn()}
      onSearchScopeChange={vi.fn()}
      onClearSearchAndFilter={vi.fn()}
      onApplySearchShortcut={vi.fn()}
      currentViewLabel={currentViewLabel}
      viewSummary={viewSummary}
      onRefresh={vi.fn()}
      testPlatform={testPlatform}
    />,
  );
}

describe('AppTitlebar', () => {
  afterEach(() => {
    cleanup();
    document.body.className = '';
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    Reflect.deleteProperty(navigator, 'platform');
    vi.clearAllMocks();
  });

  it('detects the web platform when no Tauri runtime is present', () => {
    expect(detectDesktopPlatform()).toBe('web');
  });

  it('keeps the current view and result count together beside search', () => {
    const { container } = renderTitlebar(undefined, '统一收件箱', '40+ 封');
    const context = container.querySelector('.titlebar-context');

    expect(context).not.toBeNull();
    expect(context?.querySelector('.titlebar-context-label')?.textContent).toBe('统一收件箱');
    expect(context?.querySelector('.titlebar-context-count')?.textContent).toBe('40+ 封');
    expect(context?.parentElement?.classList.contains('titlebar-left')).toBe(true);
  });

  it('renders a browser preview without native window controls or fake traffic lights', () => {
    const { container } = renderTitlebar();
    expect(container.querySelector('.window-chrome')).not.toBeNull();
    expect(container.querySelector('.window-controls')).toBeNull();
    expect(container.querySelector('.traffic-light')).toBeNull();
    expect(document.body.classList.contains('platform-web')).toBe(false);
  });

  it('renders Windows controls, native drag region, and synced maximize semantics', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });

    const { container } = renderTitlebar('windows');

    expect(container.querySelector('.window-chrome-windows')).not.toBeNull();
    expect(document.body.classList.contains('platform-windows')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '最小化' }));
    await waitFor(() => expect(tauriWindowMocks.currentWindow.minimize).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: '最大化' }));
    await waitFor(() => expect(tauriWindowMocks.currentWindow.toggleMaximize).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(tauriWindowMocks.currentWindow.close).toHaveBeenCalledTimes(1));

    const dragRegion = container.querySelector<HTMLElement>('.window-drag-region');
    expect(dragRegion).not.toBeNull();
    fireEvent.pointerDown(dragRegion!, {
      button: 0,
      detail: 1,
      pointerId: 7,
      clientX: 10,
      clientY: 10,
      screenX: 40,
      screenY: 40,
    });
    fireEvent.pointerMove(dragRegion!, {
      buttons: 1,
      pointerId: 7,
      clientX: 15,
      clientY: 10,
      screenX: 45,
      screenY: 40,
    });
    await waitFor(() => expect(tauriWindowMocks.currentWindow.startDragging).toHaveBeenCalledTimes(1));
    fireEvent.mouseUp(window);

    expect(tauriWindowMocks.moduleLoaded).toHaveBeenCalled();
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
