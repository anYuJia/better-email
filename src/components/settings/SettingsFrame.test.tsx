import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import type { Account } from '../../app/types';
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
    accounts = [],
    accountScope = 'all',
    onAccountScopeChange = () => undefined,
    onDiscardChanges = () => undefined,
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
    accounts?: Account[];
    accountScope?: Account['id'] | 'all';
    onAccountScopeChange?: (value: string) => void;
    onDiscardChanges?: () => void;
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
          activeSection={activeSection}
          onNavigate={onNavigate}
          onTestConnection={onTestConnection}
          onSave={onSave}
          canSaveAndVerify={canSaveAndVerify}
          isDirty={isDirty}
          isTestingConnection={isTestingConnection}
          connectionTestFeedback={connectionTestFeedback}
          accounts={accounts}
          accountScope={accountScope}
          onAccountScopeChange={onAccountScopeChange}
          onDiscardChanges={onDiscardChanges}
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
    expect(navigation.querySelectorAll('.settings-nav-subsection.is-open .settings-nav-subitem')).toHaveLength(6);
    const accountParent = screen.getByRole('button', { name: '邮箱账户设置' });
    expect(accountParent.getAttribute('aria-current')).toBeNull();
    expect(accountParent.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('group', { name: '邮箱账户详细设置' })).not.toBeNull();
    expect(screen.getByRole('button', { name: '隐私与安全设置' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: '服务器与协议设置' })).not.toBeNull();
    expect(screen.getByRole('button', { name: '发件身份设置' })).not.toBeNull();
    expect(navigation.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '服务器与协议设置' }));
    expect(onNavigate).toHaveBeenCalledWith('providers');
    fireEvent.click(accountParent);
    expect(screen.queryByRole('group', { name: '邮箱账户详细设置' })).toBeNull();
    expect(accountParent.getAttribute('aria-expanded')).toBe('false');
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).not.toHaveBeenCalledWith('accounts');
  });

  it('uses the account parent only as a disclosure and exposes account management as a child page', () => {
    const onNavigate = vi.fn();
    renderFrame({ activeSection: 'general', canSaveAndVerify: true, onNavigate });
    const navigation = screen.getByRole('navigation', { name: '设置分类' });
    const accountParent = screen.getByRole('button', { name: '邮箱账户设置' });
    expect(accountParent.getAttribute('aria-current')).toBeNull();
    expect(accountParent.getAttribute('aria-expanded')).toBe('false');
    expect(navigation.querySelectorAll('.settings-nav-subsection.is-open .settings-nav-subitem')).toHaveLength(0);
    expect(screen.getByRole('heading', { name: '通用' })).not.toBeNull();
    expect(navigation.querySelectorAll('[aria-current="page"]')).toHaveLength(1);

    fireEvent.click(accountParent);
    expect(navigation.querySelectorAll('.settings-nav-subsection.is-open .settings-nav-subitem')).toHaveLength(6);
    expect(accountParent.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: '账户信息设置' }).getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('heading', { name: '通用' })).not.toBeNull();
    expect(onNavigate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '账户信息设置' }));
    expect(onNavigate).toHaveBeenCalledWith('accounts');
    fireEvent.click(accountParent);
    expect(navigation.querySelectorAll('.settings-nav-subsection.is-open .settings-nav-subitem')).toHaveLength(0);
    expect(accountParent.getAttribute('aria-expanded')).toBe('false');
    expect(onNavigate).toHaveBeenCalledTimes(1);
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
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('opens and closes account and tool detail groups independently without route sync reopening them', () => {
    function InteractiveFrame() {
      const [activeSection, setActiveSection] = useState<Parameters<typeof SettingsFrame>[0]['activeSection']>('privacy');
      return (
          <SettingsFrame
            title="设置"
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
    const accountParent = screen.getByRole('button', { name: '邮箱账户设置' });
    const toolsParent = screen.getByRole('button', { name: '效率工具设置' });

    expect(accountParent.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('heading', { name: '隐私与安全' })).not.toBeNull();
    fireEvent.click(toolsParent);
    expect(screen.getByRole('group', { name: '邮箱账户详细设置' })).not.toBeNull();
    expect(screen.getByRole('group', { name: '效率工具详细设置' })).not.toBeNull();
    expect(container.querySelectorAll('.settings-nav-subsection.is-open')).toHaveLength(2);

    fireEvent.click(accountParent);
    expect(accountParent.getAttribute('aria-current')).toBeNull();
    expect(accountParent.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('group', { name: '邮箱账户详细设置' })).toBeNull();
    expect(screen.getByRole('group', { name: '效率工具详细设置' })).not.toBeNull();
    expect(container.querySelectorAll('.settings-nav-subsection.is-open')).toHaveLength(1);

    fireEvent.click(toolsParent);
    expect(toolsParent.getAttribute('aria-current')).toBeNull();
    expect(toolsParent.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelectorAll('.settings-nav-subsection.is-open')).toHaveLength(0);
    expect(screen.getByRole('heading', { name: '隐私与安全' })).not.toBeNull();
  });

  it('uses the shared account scope picker in the settings header', () => {
    const { container } = renderFrame({ activeSection: 'privacy' });
    const scope = screen.getByRole('region', { name: '邮箱范围' });
    expect(scope).not.toBeNull();
    expect(scope.getAttribute('data-account-scope')).toBe('all');
    expect(container.querySelector('.settings-account-tabs')).toBeNull();
    expect(container.querySelector('.settings-page-header .settings-account-context')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /统一邮箱/ }));
    expect(screen.getByRole('menu', { name: '邮箱范围选择' })).not.toBeNull();
    const unifiedItem = screen.getByRole('menuitemradio', { name: '统一邮箱' });
    const unifiedDescription = document.getElementById(unifiedItem.getAttribute('aria-describedby') ?? '');
    expect(unifiedDescription?.textContent).toContain('所有邮箱账号');
  });

  it('guards a scope change while settings are dirty', () => {
    const onScopeChange = vi.fn();
    const onDiscardChanges = vi.fn();
    const accounts = [
      { id: 1, email: 'one@example.com', display_name: '账号一', provider: 'imap' } as Account,
      { id: 2, email: 'two@example.com', display_name: '账号二', provider: 'imap' } as Account,
    ];
    renderFrame({
      activeSection: 'sync',
      accounts,
      isDirty: true,
      onAccountScopeChange: onScopeChange,
      onDiscardChanges,
    });

    fireEvent.click(screen.getByRole('button', { name: /统一邮箱/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /账号二/ }));
    expect(screen.getByRole('alertdialog', { name: '切换邮箱范围前处理未保存修改' })).not.toBeNull();
    expect(onScopeChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '放弃并切换' }));
    expect(onDiscardChanges).toHaveBeenCalledOnce();
    expect(onScopeChange).toHaveBeenCalledWith('2');
  });

  it('keeps the account hub reachable when no account exists', () => {
    renderFrame({ activeSection: 'accounts', canSaveAndVerify: false });
    const accountParent = screen.getByRole('button', { name: '邮箱账户设置' }) as HTMLButtonElement;
    expect(accountParent.disabled).toBe(false);
    expect(accountParent.getAttribute('aria-current')).toBeNull();
    fireEvent.click(accountParent);
    expect((screen.getByRole('button', { name: '账户信息设置' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole('button', { name: '账户信息设置' }).getAttribute('aria-current')).toBe('page');
    expect((screen.getByRole('button', { name: '服务器与协议设置' }) as HTMLButtonElement).disabled).toBe(true);
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
    expect(mobileBack?.getAttribute('aria-label')).toBe('返回账户信息');
    fireEvent.click(mobileBack!);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('keeps Tab focus inside the settings surface', () => {
    renderFrame();
    const accountScope = screen.getByRole('button', { name: /统一邮箱/ });
    const pageInput = screen.getByPlaceholderText('设置内输入框');

    pageInput.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(accountScope);

    accountScope.focus();
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
