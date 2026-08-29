import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import SettingsFrame from './SettingsFrame';

describe('SettingsFrame application shell', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
      configurable: true,
      get() {
        return this.parentElement;
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function renderFrame({
    onClose = () => undefined,
    activeSection = 'general',
    canSaveAndVerify = false,
    isDirty = false,
    isTestingConnection = false,
    connectionTestFeedback = null,
    onSave = () => undefined,
    onTestConnection = () => undefined,
    onNavigate = () => undefined,
    accountOptions = [],
    activeAccountId = null,
    onSelectAccountId = () => undefined,
  }: {
    onClose?: () => void;
    activeSection?: Parameters<typeof SettingsFrame>[0]['activeSection'];
    canSaveAndVerify?: boolean;
    isDirty?: boolean;
    isTestingConnection?: boolean;
    connectionTestFeedback?: { tone: 'success' | 'error'; message: string } | null;
    onSave?: () => void;
    onTestConnection?: () => void;
    onNavigate?: (section: Parameters<typeof SettingsFrame>[0]['activeSection']) => void;
    accountOptions?: Array<{ id: number; label: string; email: string }>;
    activeAccountId?: number | null;
    onSelectAccountId?: (accountId: number) => void;
  } = {}) {
    return render(
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
          isTestingConnection={isTestingConnection}
          connectionTestFeedback={connectionTestFeedback}
          accountOptions={accountOptions}
          activeAccountId={activeAccountId}
          onSelectAccountId={onSelectAccountId}
          onClose={onClose}
        >
          <input placeholder="设置内输入框" />
        </SettingsFrame>
      </div>,
    );
  }

  it('renders an application-level settings surface instead of a modal backdrop', () => {
    const { container } = renderFrame();
    expect(screen.getByRole('region', { name: '设置' })).not.toBeNull();
    expect(container.querySelector('.settings-workspace')).not.toBeNull();
    expect(container.querySelector('.settings-backdrop')).toBeNull();
    expect(screen.queryByRole('dialog', { name: '设置' })).toBeNull();
  });

  it('keeps desktop navigation compact and marks nested account pages through their parent', () => {
    renderFrame({ activeSection: 'privacy', canSaveAndVerify: true });
    expect(screen.getByRole('navigation', { name: '设置分类' })).not.toBeNull();
    expect(screen.getByText('偏好')).not.toBeNull();
    expect(screen.getByText('工具与数据')).not.toBeNull();
    expect(screen.getAllByRole('navigation', { name: '设置分类' })[0].querySelectorAll('button').length).toBe(7);
    expect(screen.getByRole('button', { name: '邮箱账号设置' }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('button', { name: '服务器设置' })).toBeNull();
    expect(screen.queryByRole('button', { name: '发件身份与标签设置' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: '账号设置分类' })).toBeNull();
  });

  it('shows account context only on account-scoped pages', () => {
    const { unmount } = renderFrame({ activeSection: 'privacy', canSaveAndVerify: true });
    expect(screen.getByText('work@example.com')).not.toBeNull();
    unmount();
    renderFrame({ activeSection: 'general' });
    expect(screen.queryByText('work@example.com')).toBeNull();
  });

  it('switches the scoped account and locks the switcher while edits are dirty', () => {
    const onSelectAccountId = vi.fn();
    const accountOptions = [
      { id: 1, label: '工作邮箱', email: 'work@example.com' },
      { id: 2, label: '个人邮箱', email: 'personal@example.com' },
    ];
    renderFrame({
      activeSection: 'privacy',
      canSaveAndVerify: true,
      accountOptions,
      activeAccountId: 1,
      onSelectAccountId,
    });

    const picker = screen.getByRole('combobox', { name: '切换当前设置账号' });
    expect((picker as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(picker);
    fireEvent.click(screen.getByRole('option', { name: /个人邮箱/ }));
    expect(onSelectAccountId).toHaveBeenCalledWith(2);

    cleanup();
    renderFrame({
      activeSection: 'privacy',
      canSaveAndVerify: true,
      isDirty: true,
      accountOptions,
      activeAccountId: 1,
      onSelectAccountId,
    });
    expect((screen.getByRole('combobox', { name: '切换当前设置账号' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps the account hub reachable when no account exists', () => {
    renderFrame({ activeSection: 'accounts', canSaveAndVerify: false });
    expect((screen.getByRole('button', { name: '邮箱账号设置' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('button', { name: '服务器设置' })).toBeNull();
  });

  it('keeps the mail workspace inaccessible while settings owns the application surface', () => {
    const { container, unmount } = renderFrame();
    const backgroundButton = container.querySelector<HTMLButtonElement>('[data-testid="app-shell"] > button')!;
    expect(backgroundButton.hasAttribute('inert')).toBe(true);
    expect(backgroundButton.getAttribute('aria-hidden')).toBe('true');
    unmount();
    expect(backgroundButton.hasAttribute('inert')).toBe(false);
    expect(backgroundButton.getAttribute('aria-hidden')).toBeNull();
  });

  it('restores focus to the previously focused opener when settings closes', () => {
    const backgroundButton = document.createElement('button');
    backgroundButton.textContent = '设置入口';
    document.body.appendChild(backgroundButton);
    backgroundButton.focus();
    const { unmount } = renderFrame();
    expect(document.activeElement).not.toBe(backgroundButton);
    unmount();
    expect(document.activeElement).toBe(backgroundButton);
    document.body.removeChild(backgroundButton);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    renderFrame({ onClose });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('uses the mobile back action instead of a category dropdown', () => {
    const onClose = vi.fn();
    const { container } = renderFrame({ activeSection: 'general', onClose });
    expect(container.querySelector('.settings-page-picker')).toBeNull();
    const mobileBack = container.querySelector<HTMLButtonElement>('.settings-mobile-back');
    expect(mobileBack).not.toBeNull();
    fireEvent.click(mobileBack!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('delegates nested mobile back navigation to the history-aware close handler', () => {
    const onClose = vi.fn();
    const onNavigate = vi.fn();
    const { container } = renderFrame({ activeSection: 'providers', onClose, onNavigate });
    const mobileBack = container.querySelector<HTMLButtonElement>('.settings-mobile-back');
    expect(mobileBack?.getAttribute('aria-label')).toBe('返回邮箱账号');
    fireEvent.click(mobileBack!);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('keeps Tab focus inside the settings surface', () => {
    renderFrame();
    const close = screen.getByRole('button', { name: '关闭设置' });
    const pageInput = screen.getByPlaceholderText('设置内输入框');

    pageInput.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(close);

    close.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(pageInput);
  });

  it('does not close when the workspace background is clicked', () => {
    const onClose = vi.fn();
    const { container } = renderFrame({ onClose });
    fireEvent.click(container.querySelector('.settings-workspace')!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows save only for a dirty account editing section', () => {
    const onSave = vi.fn();
    renderFrame({
      activeSection: 'providers',
      canSaveAndVerify: true,
      isDirty: true,
      onSave,
    });
    const save = screen.getByRole('button', { name: '保存账号设置' });
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: '测试连接' })).not.toBeNull();
  });

  it('offers connection testing on connection pages', () => {
    const onTestConnection = vi.fn();
    renderFrame({
      activeSection: 'sync',
      canSaveAndVerify: true,
      onTestConnection,
    });
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }));
    expect(onTestConnection).toHaveBeenCalledTimes(1);
  });

  it('shows connection test progress and result in the settings surface', () => {
    renderFrame({
      activeSection: 'sync',
      canSaveAndVerify: true,
      isTestingConnection: true,
    });
    const button = screen.getByRole('button', { name: '测试连接' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('测试中…');

    cleanup();
    renderFrame({
      activeSection: 'sync',
      canSaveAndVerify: true,
      connectionTestFeedback: { tone: 'success', message: '服务器连接成功' },
    });
    expect(screen.getByRole('status').textContent).toContain('服务器连接成功');
  });
});
