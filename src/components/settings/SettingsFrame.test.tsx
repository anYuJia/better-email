import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function renderFrame({
    standalone = false,
    nativeCloseRequestVersion = 0,
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
    standalone?: boolean;
    nativeCloseRequestVersion?: number;
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
          standalone={standalone}
          nativeCloseRequestVersion={nativeCloseRequestVersion}
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

  it('fills a standalone native window without modal entrance state', () => {
    const { container } = renderFrame({ standalone: true });
    expect(container.querySelector('.settings-workspace')?.classList.contains('is-standalone')).toBe(true);
    expect(screen.getByRole('region', { name: '设置' }).getAttribute('data-standalone')).toBe('true');
    expect(screen.queryByRole('button', { name: '关闭设置' })).toBeNull();
    expect(container.querySelector('.settings-titlebar-drag-region')?.hasAttribute('data-tauri-drag-region')).toBe(true);
  });

  it('keeps top-level navigation compact and exposes sibling destinations on nested account pages', () => {
    const onNavigate = vi.fn();
    renderFrame({ activeSection: 'privacy', canSaveAndVerify: true, onNavigate });
    const navigation = screen.getByRole('navigation', { name: '设置分类' });
    expect(screen.getByText('偏好')).not.toBeNull();
    expect(screen.getByText('工具与数据')).not.toBeNull();
    expect(navigation.querySelectorAll('.settings-nav-parent')).toHaveLength(7);
    expect(navigation.querySelectorAll('.settings-nav-subsection.is-open .settings-nav-subitem')).toHaveLength(5);
    const accountParent = screen.getByRole('button', { name: '邮箱账号设置' });
    expect(accountParent.getAttribute('aria-current')).toBeNull();
    expect(accountParent.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('group', { name: '邮箱账号详细设置' })).not.toBeNull();
    expect(screen.getByRole('button', { name: '隐私设置' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: '服务器设置' })).not.toBeNull();
    expect(screen.getByRole('button', { name: '发件身份与标签设置' })).not.toBeNull();
    expect(navigation.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '服务器设置' }));
    expect(onNavigate).toHaveBeenCalledWith('providers');
    fireEvent.click(accountParent);
    expect(screen.queryByRole('group', { name: '邮箱账号详细设置' })).toBeNull();
    expect(accountParent.getAttribute('aria-expanded')).toBe('false');
    expect(onNavigate).toHaveBeenCalledTimes(2);
    expect(onNavigate).toHaveBeenCalledWith('accounts');
  });

  it('keeps account details collapsed until the account parent is expanded', () => {
    const onNavigate = vi.fn();
    renderFrame({ activeSection: 'accounts', canSaveAndVerify: true, onNavigate });
    const navigation = screen.getByRole('navigation', { name: '设置分类' });
    const accountParent = screen.getByRole('button', { name: '邮箱账号设置' });
    expect(accountParent.getAttribute('aria-current')).toBe('page');
    expect(accountParent.getAttribute('aria-expanded')).toBe('false');
    expect(navigation.querySelectorAll('.settings-nav-subsection.is-open .settings-nav-subitem')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: '服务器设置' })).toBeNull();
    expect(navigation.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    fireEvent.click(accountParent);
    expect(navigation.querySelectorAll('.settings-nav-subsection.is-open .settings-nav-subitem')).toHaveLength(5);
    expect(accountParent.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: '服务器设置' }).getAttribute('aria-current')).toBeNull();
    fireEvent.click(accountParent);
    expect(navigation.querySelectorAll('.settings-nav-subsection.is-open .settings-nav-subitem')).toHaveLength(0);
    expect(accountParent.getAttribute('aria-expanded')).toBe('false');
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('exposes tool siblings and marks only the current nested tool page', () => {
    const onNavigate = vi.fn();
    renderFrame({ activeSection: 'templates', onNavigate });
    const toolsParent = screen.getByRole('button', { name: '效率工具设置' });
    expect(toolsParent.getAttribute('aria-current')).toBeNull();
    expect(toolsParent.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('group', { name: '效率工具详细设置' })).not.toBeNull();
    expect(screen.getByRole('button', { name: '模板设置' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: '通讯录设置' }).getAttribute('aria-current')).toBeNull();
    fireEvent.click(toolsParent);
    expect(screen.queryByRole('group', { name: '效率工具详细设置' })).toBeNull();
    expect(toolsParent.getAttribute('aria-expanded')).toBe('false');
    expect(onNavigate).toHaveBeenCalledWith('tools');
  });

  it('opens and closes account and tool detail groups independently without route sync reopening them', () => {
    function InteractiveFrame() {
      const [activeSection, setActiveSection] = useState<Parameters<typeof SettingsFrame>[0]['activeSection']>('privacy');
      return (
        <SettingsFrame
          title="设置"
          subtitle="work@example.com"
          activeSection={activeSection}
          onNavigate={setActiveSection}
          canSaveAndVerify
          onTestConnection={() => undefined}
          onSave={() => undefined}
          onClose={() => undefined}
        >
          <input placeholder="设置内输入框" />
        </SettingsFrame>
      );
    }

    const { container } = render(<InteractiveFrame />);
    const accountParent = screen.getByRole('button', { name: '邮箱账号设置' });
    const toolsParent = screen.getByRole('button', { name: '效率工具设置' });

    fireEvent.click(accountParent);
    expect(accountParent.getAttribute('aria-current')).toBe('page');
    expect(accountParent.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelectorAll('.settings-nav-subsection.is-open')).toHaveLength(0);

    fireEvent.click(accountParent);
    expect(accountParent.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toolsParent);
    expect(screen.getByRole('group', { name: '邮箱账号详细设置' })).not.toBeNull();
    expect(screen.getByRole('group', { name: '效率工具详细设置' })).not.toBeNull();
    expect(container.querySelectorAll('.settings-nav-subsection.is-open')).toHaveLength(2);

    fireEvent.click(accountParent);
    expect(accountParent.getAttribute('aria-current')).toBe('page');
    expect(accountParent.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('group', { name: '邮箱账号详细设置' })).toBeNull();
    expect(screen.getByRole('group', { name: '效率工具详细设置' })).not.toBeNull();
    expect(container.querySelectorAll('.settings-nav-subsection.is-open')).toHaveLength(1);

    fireEvent.click(toolsParent);
    expect(toolsParent.getAttribute('aria-current')).toBe('page');
    expect(toolsParent.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelectorAll('.settings-nav-subsection.is-open')).toHaveLength(0);
  });

  it('shows account context only on multi-account scoped pages', () => {
    const accountOptions = [
      { id: 1, label: '工作邮箱', email: 'work@example.com' },
      { id: 2, label: '个人邮箱', email: 'personal@example.com' },
    ];
    const { container, unmount } = renderFrame({
      activeSection: 'privacy',
      canSaveAndVerify: true,
      accountOptions,
      activeAccountId: 1,
    });
    expect(screen.getByRole('combobox', { name: '切换当前设置账号' })).not.toBeNull();
    expect(container.querySelector('.settings-page-header .settings-account-context')).not.toBeNull();
    expect(container.querySelector('.settings-account-workspace')).toBeNull();
    unmount();

    const singleAccount = renderFrame({
      activeSection: 'privacy',
      canSaveAndVerify: true,
      accountOptions: [accountOptions[0]],
      activeAccountId: 1,
    });
    expect(singleAccount.container.querySelector('.settings-page-header .settings-account-context')).toBeNull();
    singleAccount.unmount();

    renderFrame({ activeSection: 'general' });
    expect(screen.queryByRole('combobox', { name: '切换当前设置账号' })).toBeNull();
  });

  it('uses the account list as the account hub switcher instead of duplicating header context', () => {
    const { container } = renderFrame({ activeSection: 'accounts', canSaveAndVerify: true });
    expect(container.querySelector('.settings-page-header .settings-account-context')).toBeNull();
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

  it('routes a native titlebar close through the unsaved-changes confirmation', () => {
    const onClose = vi.fn();
    renderFrame({
      standalone: true,
      nativeCloseRequestVersion: 1,
      isDirty: true,
      onClose,
    });

    expect(screen.getByRole('alertdialog', { name: '放弃未保存的修改' })).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '放弃修改' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes a clean standalone window immediately without overlay exit animation', () => {
    const onClose = vi.fn();
    const { container } = renderFrame({
      standalone: true,
      nativeCloseRequestVersion: 1,
      onClose,
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.settings-workspace')?.classList.contains('is-closing')).toBe(false);
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
      activeSection: 'auth',
      canSaveAndVerify: true,
      onTestConnection,
    });
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }));
    expect(onTestConnection).toHaveBeenCalledTimes(1);
  });

  it('shows connection test progress and result in the settings surface', () => {
    renderFrame({
      activeSection: 'auth',
      canSaveAndVerify: true,
      isTestingConnection: true,
    });
    const button = screen.getByRole('button', { name: '测试连接' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('测试中…');

    cleanup();
    renderFrame({
      activeSection: 'auth',
      canSaveAndVerify: true,
      connectionTestFeedback: { tone: 'success', message: '服务器连接成功' },
    });
    expect(screen.getByRole('status').textContent).toContain('服务器连接成功');
  });

  it('hides connection testing from overview and sync pages', () => {
    const { rerender } = renderFrame({ activeSection: 'accounts', canSaveAndVerify: true });
    expect(screen.queryByRole('button', { name: '测试连接' })).toBeNull();
    rerender(
      <SettingsFrame
        title="设置"
        activeSection="sync"
        onNavigate={() => undefined}
        onTestConnection={() => undefined}
        onSave={() => undefined}
        canSaveAndVerify
        onClose={() => undefined}
      >
        <input placeholder="设置内输入框" />
      </SettingsFrame>,
    );
    expect(screen.queryByRole('button', { name: '测试连接' })).toBeNull();
  });

  it('finishes the exit motion before closing when motion is enabled', () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    const onClose = vi.fn();
    const { container } = renderFrame({ onClose });

    fireEvent.click(screen.getByRole('button', { name: '关闭设置' }));
    expect(container.querySelector('.settings-workspace')?.classList.contains('is-closing')).toBe(true);
    expect(onClose).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(180));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
