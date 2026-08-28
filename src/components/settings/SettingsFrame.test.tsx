import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import SettingsFrame from './SettingsFrame';

describe('SettingsFrame dialog behavior', () => {
  let modalRef: HTMLElement | null = null;

  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
      configurable: true,
      get() {
        return this.parentElement;
      },
    });
  });

  afterEach(() => {
    modalRef = null;
    cleanup();
    vi.restoreAllMocks();
  });

  function renderFrame({
    onClose = () => undefined,
    activeSection = 'notifications',
    canSaveAndVerify = false,
    isDirty = false,
    onSave = () => undefined,
    onTestConnection = () => undefined,
    onNavigate = () => undefined,
  }: {
    onClose?: () => void;
    activeSection?: Parameters<typeof SettingsFrame>[0]['activeSection'];
    canSaveAndVerify?: boolean;
    isDirty?: boolean;
    onSave?: () => void;
    onTestConnection?: () => void;
    onNavigate?: (section: Parameters<typeof SettingsFrame>[0]['activeSection']) => void;
  } = {}) {
    const utils = render(
      <div data-testid="app-shell">
        <button type="button">后台按钮</button>
        <SettingsFrame
          title="设置"
          subtitle="work@example.com"
          activeSection={activeSection}
          onNavigate={onNavigate}
          onTestConnection={onTestConnection}
          onSave={onSave}
          canSaveAndVerify={canSaveAndVerify}
          isDirty={isDirty}
          onClose={onClose}
        >
          <input placeholder="设置内输入框" />
        </SettingsFrame>
      </div>,
    );
    modalRef = utils.container.querySelector('.settings-modal');
    return utils;
  }

  it('renders the dialog and hides account context on global pages', () => {
    renderFrame();
    expect(screen.getByRole('dialog', { name: '设置' })).not.toBeNull();
    expect(screen.queryByText('work@example.com')).toBeNull();
  });

  it('shows account context and scoped tabs inside the account workspace', () => {
    renderFrame({ activeSection: 'privacy', canSaveAndVerify: true });
    expect(screen.getByText('work@example.com')).not.toBeNull();
    expect(screen.getByRole('navigation', { name: '账号设置分类' })).not.toBeNull();
    expect(screen.getByRole('button', { name: '身份与签名' })).not.toBeNull();
    expect(screen.getByRole('button', { name: '隐私' }).getAttribute('aria-current')).toBe('page');
  });

  it('disables account detail tabs when no account exists', () => {
    renderFrame({ activeSection: 'accounts', canSaveAndVerify: false });
    expect(screen.getByRole('button', { name: '服务器' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '概览' })).not.toBeDisabled();
  });

  it('marks background siblings inert and aria-hidden while open', () => {
    const { container, unmount } = renderFrame();
    const backgroundButton = container.querySelector<HTMLButtonElement>('[data-testid="app-shell"] > button')!;
    expect(backgroundButton.hasAttribute('inert')).toBe(true);
    expect(backgroundButton.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('.settings-backdrop')?.hasAttribute('inert')).toBe(false);
    unmount();
    expect(backgroundButton.hasAttribute('inert')).toBe(false);
    expect(backgroundButton.getAttribute('aria-hidden')).toBeNull();
  });

  it('restores focus to the previously focused element on close', () => {
    const backgroundButton = document.createElement('button');
    backgroundButton.textContent = '触发按钮';
    document.body.appendChild(backgroundButton);
    backgroundButton.focus();
    const { unmount } = renderFrame();
    expect(document.activeElement).not.toBe(backgroundButton);
    unmount();
    expect(document.activeElement).toBe(backgroundButton);
    document.body.removeChild(backgroundButton);
  });

  it('removes inert before restoring focus to an opener inside the app shell', () => {
    const renderShell = (open: boolean) => (
      <div data-testid="focus-shell">
        <button type="button">设置入口</button>
        {open && (
          <SettingsFrame
            title="设置"
            subtitle="work@example.com"
            activeSection="notifications"
            onNavigate={() => undefined}
            onTestConnection={() => undefined}
            onSave={() => undefined}
            onClose={() => undefined}
          >
            <input placeholder="设置内输入框" />
          </SettingsFrame>
        )}
      </div>
    );
    const { rerender } = render(renderShell(false));
    const opener = screen.getByRole('button', { name: '设置入口' });
    opener.focus();

    rerender(renderShell(true));
    expect(opener.closest('[inert]')).not.toBeNull();
    rerender(renderShell(false));

    expect(opener.closest('[inert]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    renderFrame({ onClose });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('lets the mobile page menu own the first Escape', async () => {
    const onClose = vi.fn();
    renderFrame({ onClose });

    const picker = screen.getByRole('button', { name: '切换设置页面' });
    fireEvent.click(picker);
    expect(screen.getByRole('menu', { name: '设置页面' })).not.toBeNull();

    fireEvent.keyDown(document.body, { key: 'Escape' });

    expect(screen.queryByRole('menu', { name: '设置页面' })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(picker));
  });

  it('keeps Tab focus inside the dialog', () => {
    renderFrame();
    const focusable = Array.from(
      modalRef!.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'),
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    last.focus();
    fireEvent.keyDown(modalRef!, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    first.focus();
    fireEvent.keyDown(modalRef!, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('closes when clicking the backdrop outside the modal', () => {
    const onClose = vi.fn();
    const { container } = renderFrame({ onClose });
    const backdrop = container.querySelector('.settings-backdrop')!;
    fireEvent.mouseDown(backdrop, { target: backdrop });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not show a generic save action on auto-saving preference pages', () => {
    renderFrame({ activeSection: 'appearance', canSaveAndVerify: true });
    expect(screen.queryByRole('button', { name: '保存设置' })).toBeNull();
    expect(screen.queryByRole('button', { name: '保存账号设置' })).toBeNull();
  });

  it('shows save only for a dirty account editing section', () => {
    const onSave = vi.fn();
    renderFrame({
      activeSection: 'providers',
      canSaveAndVerify: true,
      isDirty: true,
      onSave,
    });
    const saveActions = screen.getAllByRole('button', { name: '保存账号设置' });
    expect(saveActions).toHaveLength(1);
    expect(document.querySelector('.settings-floating-unsaved-bar')).toBeNull();
    fireEvent.click(saveActions[0]);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: '测试连接' })).toBeNull();
  });

  it('offers connection testing when the active connection page is clean', () => {
    const onTestConnection = vi.fn();
    renderFrame({
      activeSection: 'sync',
      canSaveAndVerify: true,
      onTestConnection,
    });
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }));
    expect(onTestConnection).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: '保存账号设置' })).toBeNull();
  });

  it('uses one General navigation entry with inner appearance and sending tabs', () => {
    const onNavigate = vi.fn();
    renderFrame({ activeSection: 'sending', onNavigate });
    const tabs = screen.getByRole('navigation', { name: '通用设置分类' });
    fireEvent.click(within(tabs).getByRole('button', { name: '外观' }));
    expect(onNavigate).toHaveBeenCalledWith('appearance');
  });
});
