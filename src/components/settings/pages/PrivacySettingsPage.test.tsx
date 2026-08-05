import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Account, RemoteImageTrust } from '../../../app/types';
import PrivacySettingsPage from './PrivacySettingsPage';

function makeAccount(overrides: Partial<Account> = {}): Account {
  return { id: 1, email: 'work@example.com', remote_images_allowed: false, ...overrides } as Account;
}

function makeTrust(overrides: Partial<RemoteImageTrust> = {}): RemoteImageTrust {
  return {
    id: 10,
    account_id: 1,
    scope: 'sender',
    value: 'ada@example.com',
    created_at: '2026-07-01T08:00:00+08:00',
    ...overrides,
  } as RemoteImageTrust;
}

function renderPage(
  account: Account,
  trusts: RemoteImageTrust[],
  onNavigateToAi: () => void = () => undefined,
  accounts: Account[] = [account],
) {
  return render(
    <PrivacySettingsPage
      accounts={accounts}
      accountForm={account}
      remoteImageTrusts={trusts}
      onAccountFormChange={() => undefined}
      onSelectAccount={() => undefined}
      onDeleteRemoteImageTrust={() => undefined}
      onNavigateToAi={onNavigateToAi}
    />,
  );
}

describe('PrivacySettingsPage', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the remote image policy toggle with risk-aware copy', () => {
    renderPage(makeAccount({ remote_images_allowed: false }), []);
    const toggles = screen.getAllByRole('checkbox');
    expect(toggles.length).toBe(3);
    expect(screen.getByText('默认阻止远程图片，减少追踪像素；可信发件人或域名可单独放行。')).not.toBeNull();
    expect(screen.getByText('当前：默认阻止')).not.toBeNull();
  });

  it('explains the risk when remote images are allowed', () => {
    renderPage(makeAccount({ remote_images_allowed: true }), []);
    expect(screen.getByText(/可能暴露你的打开行为与网络位置/)).not.toBeNull();
    expect(screen.getByText('当前：允许加载')).not.toBeNull();
  });

  it('offers external mailbox and HTTPS link interception toggles', () => {
    renderPage(makeAccount(), []);
    expect(screen.getByText('拦截外部邮箱邮件')).not.toBeNull();
    expect(screen.getByText('当前：未拦截')).not.toBeNull();
    expect(screen.getByText('拦截 HTTPS 链接并提示确认')).not.toBeNull();
    expect(screen.getByText('当前：已拦截')).not.toBeNull();
  });

  it('shows an explicit empty state for the trust list', () => {
    renderPage(makeAccount(), []);
    expect(screen.getByText('暂无信任项。你可以在邮件阅读页按发件人或域名允许图片。')).not.toBeNull();
  });

  it('offers an account selector only when multiple accounts exist', () => {
    renderPage(makeAccount(), []);
    expect(screen.queryByLabelText('配置账号')).toBeNull();
    const second = makeAccount({ id: 2, email: 'home@example.com' });
    const first = makeAccount();
    const select = vi.fn();
    render(
      <PrivacySettingsPage
        accounts={[first, second]}
        accountForm={first}
        remoteImageTrusts={[]}
        onAccountFormChange={() => undefined}
        onSelectAccount={select}
        onDeleteRemoteImageTrust={() => undefined}
      />,
    );
    fireEvent.change(screen.getByLabelText('配置账号'), { target: { value: '2' } });
    expect(select).toHaveBeenCalledWith(second);
  });

  it('renders trust items with scope, value, created date and remove button', () => {
    renderPage(makeAccount(), [
      makeTrust({ scope: 'sender', value: 'ada@example.com' }),
      makeTrust({ id: 11, scope: 'domain', value: '@customer.com', created_at: '2026-07-02T09:00:00+08:00' }),
    ]);
    expect(screen.getByText('发件人')).not.toBeNull();
    expect(screen.getByText('域名')).not.toBeNull();
    expect(screen.getByText('ada@example.com')).not.toBeNull();
    expect(screen.getByText('@customer.com')).not.toBeNull();
    expect(screen.getAllByRole('button', { name: '移除' })).toHaveLength(2);
  });

  it('only shows trusts belonging to the current account', () => {
    renderPage(makeAccount(), [
      makeTrust({ id: 11, account_id: 2, scope: 'domain', value: '@other.com' }),
    ]);
    expect(screen.queryByText('@other.com')).toBeNull();
    expect(screen.getByText('暂无信任项。你可以在邮件阅读页按发件人或域名允许图片。')).not.toBeNull();
  });

  it('warns about external AI services and offers a navigation entry', () => {
    const navigate = () => undefined;
    const spy = vi.fn(navigate);
    renderPage(makeAccount(), [], spy);
    expect(screen.getByText(/可能会把邮件内容发送到外部 AI 服务/)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /前往 AI 服务设置/ }));
    expect(spy).toHaveBeenCalledOnce();
  });
});
