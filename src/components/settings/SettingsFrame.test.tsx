import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import SettingsFrame from './SettingsFrame';

describe('SettingsFrame dialog behavior', () => {
  let modalRef: HTMLElement | null = null;

  beforeEach(() => {
    // jsdom has no layout, so offsetParent is always null; stub it so the
    // focus trap can enumerate visible focusable elements.
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
  }: {
    onClose?: () => void;
    activeSection?: Parameters<typeof SettingsFrame>[0]['activeSection'];
    canSaveAndVerify?: boolean;
    isDirty?: boolean;
    onSave?: () => void;
    onTestConnection?: () => void;
  } = {}) {
    const utils = render(
      <div data-testid="app-shell">
        <button type="button">后台按钮</button>
        <SettingsFrame
          title="设置"
          subtitle="work@example.com"
          activeSection={activeSection}
          onNavigate={() => undefined}
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

  it('renders the dialog with role and label', () => {
    renderFrame();
    expect(screen.getByRole('dialog', { name: '设置' })).not.toBeNull();
    expect(screen.getByText('work@example.com')).not.toBeNull();
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
});
