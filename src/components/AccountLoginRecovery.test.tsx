import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account, CredentialStatus } from '../app/types';
import AccountLoginRecovery from './AccountLoginRecovery';

const health = vi.hoisted(() => ({ statuses: [] as CredentialStatus[], error: false }));
const openSettingsWindow = vi.hoisted(() => vi.fn());
vi.mock('../hooks/useAccountCredentialHealth', () => ({ default: () => health }));
vi.mock('../tauriBridge', () => ({ openSettingsWindow }));

const accounts: Account[] = [1, 2].map(id => ({
  id, email: `account${id}@example.com`, display_name: `Account ${id}`, provider: 'custom',
  imap_host: 'imap.example.com', smtp_host: 'smtp.example.com', incoming_protocol: 'imap',
  auth_type: 'password', sync_mode: 'full', remote_images_allowed: false, signature: '',
  cross_account_risk_warning: true, block_external_mailboxes: false, intercept_https_links: true,
  auto_download_attachments: false, warn_external_senders: true, onboarding_completed: true, is_default: id === 1,
}));
const missing = (account: Account): CredentialStatus => ({
  account_email: account.email, exists: false, status: 'missing',
  message: '本机未保存登录凭据。账号和缓存邮件仍保留，请重新保存并验证；无需删除账号。',
});
const handlers = () => ({
  changeAccountScope: vi.fn(), selectSettingsAccount: vi.fn(), openSection: vi.fn(),
});
beforeEach(() => { health.statuses = [missing(accounts[0])]; health.error = false; openSettingsWindow.mockReset().mockResolvedValue(undefined); });
afterEach(cleanup);

describe('AccountLoginRecovery', () => {
  it('keeps the repair action available with details collapsed and expands the complete explanation', () => {
    render(<AccountLoginRecovery accounts={accounts} accountScope={1} nativeSettings {...handlers()} />);
    const summary = screen.getByRole('button', { name: '此邮箱需要重新登录' });
    const details = document.getElementById(summary.getAttribute('aria-controls')!)!;
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    expect(details.hidden).toBe(true);
    expect(details.textContent).toContain('无需删除账号');
    fireEvent.click(screen.getByRole('button', { name: '修复登录' }));
    expect(openSettingsWindow).toHaveBeenCalledWith({ section: 'auth', accountScope: 1 });
    fireEvent.click(summary);
    expect(details.hidden).toBe(false);
    expect(summary.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(summary);
    expect(details.hidden).toBe(true);
  });

  it('chooses the requested affected account before opening browser login settings', () => {
    health.statuses = accounts.map(missing);
    const props = { accounts, accountScope: 'all' as const, nativeSettings: false, ...handlers() };
    const view = render(<AccountLoginRecovery {...props} />);
    expect(screen.queryByRole('button', { name: '修复登录' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '2 个邮箱需要重新登录' }));
    fireEvent.click(screen.getByRole('button', { name: '修复 account2@example.com 的登录' }));
    expect(props.changeAccountScope).toHaveBeenCalledWith('2');
    expect(props.openSection).not.toHaveBeenCalled();
    view.rerender(<AccountLoginRecovery {...props} accountScope={2} />);
    expect(props.selectSettingsAccount).toHaveBeenCalledWith(accounts[1]);
    expect(props.openSection).toHaveBeenCalledWith('auth');
    expect(openSettingsWindow).not.toHaveBeenCalled();
  });

  it('reveals a failed settings launch with a retry action, without dismissing the login warning', async () => {
    openSettingsWindow.mockRejectedValueOnce(new Error('window unavailable'));
    render(<AccountLoginRecovery accounts={accounts} accountScope={1} nativeSettings {...handlers()} />);
    fireEvent.click(screen.getByRole('button', { name: '修复登录' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '无法打开登录设置，请重试。');
    expect(screen.getByRole('button', { name: '此邮箱需要重新登录' }).getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '修复登录' }));
    await waitFor(() => expect(openSettingsWindow).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not offer repair for a different scope or an unknown health-check result', () => {
    const props = { accounts, accountScope: 2, nativeSettings: true, ...handlers() };
    const view = render(<AccountLoginRecovery {...props} />);
    expect(screen.queryByRole('region', { name: '邮箱登录状态' })).toBeNull();
    health.error = true;
    view.rerender(<AccountLoginRecovery {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '登录状态暂不可用' }));
    expect(screen.getByText('登录状态检查失败，未删除账号或凭据。稍后将自动重新检查。')).toBeDefined();
    expect(screen.queryByRole('button', { name: '修复登录' })).toBeNull();
  });

  it('delegates the exact account to the shared repair entry and exposes its launch error', () => {
    const onRepairCredentials = vi.fn();
    const props = { accounts, accountScope: 1, nativeSettings: true, ...handlers(), onRepairCredentials };
    const view = render(<AccountLoginRecovery {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '修复登录' }));
    expect(onRepairCredentials).toHaveBeenCalledWith(1);
    expect(openSettingsWindow).not.toHaveBeenCalled();
    view.rerender(<AccountLoginRecovery {...props} repairError="无法打开登录设置，请重试。" />);
    expect(screen.getByRole('alert').textContent).toBe('无法打开登录设置，请重试。');
    expect(screen.getByRole('button', { name: '此邮箱需要重新登录' }).getAttribute('aria-expanded')).toBe('true');
  });
});
