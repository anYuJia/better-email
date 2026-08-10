import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Account } from '../app/types';
import FirstRunOnboarding from './FirstRunOnboarding';

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

function renderOnboarding(account = newAccount()) {
  const onAccountSettingsChange = vi.fn().mockResolvedValue(undefined);
  const onSendUndoDelayChange = vi.fn();
  const onComplete = vi.fn().mockResolvedValue(undefined);
  const onSkipAll = vi.fn().mockResolvedValue(undefined);
  const onStatus = vi.fn();
  render(
    <FirstRunOnboarding
      accountId={account.id}
      account={account}
      sendUndoDelaySeconds={10}
      onAccountSettingsChange={onAccountSettingsChange}
      onSendUndoDelayChange={onSendUndoDelayChange}
      onComplete={onComplete}
      onSkipAll={onSkipAll}
      onStatus={onStatus}
    />,
  );
  return { onAccountSettingsChange, onSendUndoDelayChange, onComplete, onSkipAll, onStatus };
}

describe('FirstRunOnboarding', () => {
  afterEach(() => cleanup());

  it('shows skippable steps with defaults and only marks complete on 完成 or 跳过全部', async () => {
    const { onComplete, onSkipAll, onAccountSettingsChange } = renderOnboarding();

    // 第 1 步：附件自动下载，默认关闭
    expect(screen.getByRole('switch', { name: '自动下载新邮件附件' })).toHaveProperty('checked', false);
    fireEvent.click(screen.getByRole('button', { name: /下一步/ }));

    // 第 2 步：延迟发送，默认 10 秒
    expect(screen.getByText(/多久才真正发出/)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /下一步/ }));

    // 第 3 步：安全设置，默认图片隐藏、链接隐藏、外部来信不提示
    expect(screen.getByRole('switch', { name: '隐藏远程图片' })).toHaveProperty('checked', true);
    expect(screen.getByRole('switch', { name: '隐藏邮件中的链接' })).toHaveProperty('checked', true);
    expect(screen.getByRole('switch', { name: '提示来自其他邮箱 / 外部发件人的邮件' })).toHaveProperty('checked', false);
    fireEvent.click(screen.getByRole('button', { name: /下一步/ }));

    // 第 4 步：联系人导入可跳过，不阻塞进入应用
    expect(screen.getByRole('button', { name: /导入联系人/ })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /跳过，进入应用/ }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(onSkipAll).not.toHaveBeenCalled();
    expect(onAccountSettingsChange).not.toHaveBeenCalled();
  });

  it('preserves default values when skipping every step', async () => {
    const { onSkipAll, onAccountSettingsChange } = renderOnboarding();

    fireEvent.click(screen.getByRole('button', { name: '跳过全部' }));

    await waitFor(() => expect(onSkipAll).toHaveBeenCalledTimes(1));
    expect(onAccountSettingsChange).not.toHaveBeenCalled();
    expect(screen.getByRole('switch', { name: '自动下载新邮件附件' })).toHaveProperty('checked', false);
  });

  it('applies the chosen attachment policy immediately while preserving send delay default', async () => {
    const { onAccountSettingsChange } = renderOnboarding();

    fireEvent.click(screen.getByRole('switch', { name: '自动下载新邮件附件' }));

    await waitFor(() => {
      expect(onAccountSettingsChange).toHaveBeenCalledWith({ auto_download_attachments: true });
    });
  });

  it('reuses the existing send undo delay configuration and persistence mechanism', async () => {
    const { onSendUndoDelayChange } = renderOnboarding();
    fireEvent.click(screen.getByRole('button', { name: /下一步/ }));

    // 默认值保持 10 秒
    expect(screen.getByRole('button', { name: '撤销发送延迟' }).textContent).toContain('10 秒（推荐）');
    fireEvent.click(screen.getByRole('button', { name: '撤销发送延迟' }));
    fireEvent.click(screen.getByRole('option', { name: '30 秒' }));

    await waitFor(() => {
      expect(onSendUndoDelayChange).toHaveBeenCalledWith(30);
    });
  });

  it('raises the onboarding select menu above the onboarding portal', () => {
    renderOnboarding();
    fireEvent.click(screen.getByRole('button', { name: /下一步/ }));

    fireEvent.click(screen.getByRole('button', { name: '撤销发送延迟' }));
    const listbox = screen.getByRole('listbox');
    expect((listbox as HTMLElement).style.zIndex).toBe('2550');
  });

  it('keeps the external sender warning and cross-account risk flags independent', async () => {
    const { onAccountSettingsChange } = renderOnboarding(newAccount({ warn_external_senders: false, cross_account_risk_warning: true }));
    fireEvent.click(screen.getByRole('button', { name: /下一步/ }));
    fireEvent.click(screen.getByRole('button', { name: /下一步/ }));

    const externalSwitch = screen.getByRole('switch', { name: '提示来自其他邮箱 / 外部发件人的邮件' });
    expect(externalSwitch).toHaveProperty('checked', false);
    fireEvent.click(externalSwitch);
    await waitFor(() => {
      expect(screen.getByText(/发件人域名与本账号不同的邮件会显示外部来信提示/)).not.toBeNull();
    });
    // 跨账号发件风险提示设置未被触碰
    expect(onAccountSettingsChange).not.toHaveBeenCalledWith(expect.objectContaining({
      cross_account_risk_warning: expect.anything(),
    }));
  });

  it('reuses the existing contact import preview flow inside onboarding', async () => {
    renderOnboarding();
    fireEvent.click(screen.getByRole('button', { name: /下一步/ }));
    fireEvent.click(screen.getByRole('button', { name: /下一步/ }));
    fireEvent.click(screen.getByRole('button', { name: /下一步/ }));

    expect(screen.getByRole('button', { name: /导入联系人/ })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /导入联系人/ }));

    // 先显示真正可见的二级导入对话框，再由用户主动选择文件。
    await waitFor(() => {
      expect(document.querySelector('.contact-import-dialog')?.textContent).toContain('选择文件');
    });
    fireEvent.click(screen.getByRole('button', { name: '选择文件' }));

    // 预览弹窗显示在引导之上，可确认导入、可关闭。
    await waitFor(() => expect(screen.getByText(/导入预览/)).not.toBeNull());
    expect(screen.getByText(/import-contacts\.vcf/)).not.toBeNull();
    expect(screen.getByRole('button', { name: /确认导入/ })).not.toBeNull();
    expect(screen.getByRole('button', { name: '关闭导入预览' })).not.toBeNull();

    // 成功后的“完成”会清理本次会话。再次打开不能停留在旧的成功页，
    // 必须能重新选择另一个联系人文件。
    fireEvent.click(screen.getByRole('button', { name: /确认导入/ }));
    await waitFor(() => expect(screen.getByText('导入完成')).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    await waitFor(() => expect(document.querySelector('.contact-import-dialog')).toBeNull());

    const importButton = screen.getByRole('button', { name: /导入联系人（上传文件）/ });
    await waitFor(() => expect(document.activeElement).toBe(importButton));
    expect(importButton).toHaveProperty('disabled', false);
    fireEvent.click(importButton);
    await waitFor(() => {
      expect(document.querySelector('.contact-import-dialog')?.textContent).toContain('选择文件');
    });
  });

  it('shows a readable error with retry when completing the last step fails, keeping the step and settings', async () => {
    const { onComplete, onStatus, onAccountSettingsChange } = renderOnboarding();
    onComplete.mockRejectedValueOnce(new Error('set_account_onboarding_completed 写入失败'));

    fireEvent.click(screen.getByRole('button', { name: /下一步/ }));
    fireEvent.click(screen.getByRole('button', { name: /下一步/ }));
    fireEvent.click(screen.getByRole('button', { name: /下一步/ }));

    // 步骤保持在第 4 步（联系人导入），没有悄悄消失。
    expect(screen.getByRole('button', { name: /导入联系人/ })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /跳过，进入应用/ }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('完成首次引导失败');
    expect(alert.textContent).toContain('set_account_onboarding_completed 写入失败');
    expect(onStatus).toHaveBeenCalledWith(expect.stringContaining('首次引导保存失败'));
    // 引导仍在，用户已选择的设置未丢失。
    expect(screen.getByRole('button', { name: /跳过，进入应用/ })).not.toBeNull();

    // 重试成功后可正常完成。
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/完成首次引导失败/)).toBeNull();
    expect(onAccountSettingsChange).not.toHaveBeenCalled();
  });

  it('shows an error and keeps the onboarding when 跳过全部 fails, then retries', async () => {
    const { onSkipAll } = renderOnboarding();
    onSkipAll.mockRejectedValueOnce(new Error('网络中断'));

    fireEvent.click(screen.getByRole('button', { name: '跳过全部' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('完成首次引导失败');
    expect(alert.textContent).toContain('网络中断');

    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(onSkipAll).toHaveBeenCalledTimes(2));
  });

  it('rolls back the local toggle state and offers retry when the account patch save fails', async () => {
    const { onAccountSettingsChange } = renderOnboarding();
    onAccountSettingsChange.mockRejectedValueOnce(new Error('本地数据库写入失败'));

    const toggle = screen.getByRole('switch', { name: '自动下载新邮件附件' });
    fireEvent.click(toggle);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('保存失败');
    expect(alert.textContent).toContain('本地数据库写入失败');
    // 本地状态回滚：开关回到关闭。
    expect(screen.getByRole('switch', { name: '自动下载新邮件附件' })).toHaveProperty('checked', false);

    onAccountSettingsChange.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(onAccountSettingsChange).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('switch', { name: '自动下载新邮件附件' })).toHaveProperty('checked', true);
  });
});
