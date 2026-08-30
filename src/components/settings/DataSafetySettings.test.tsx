import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import DataSafetySettings from './DataSafetySettings';
import type { AppSettingsReport, StorageUsage } from '../../app/types';

const baseStorage: StorageUsage = {
  database_bytes: 2_654_208,
  reclaimable_cache_bytes: 0,
  reclaimable_file_count: 0,
  cached_attachment_count: 0,
  local_attachment_bytes: 0,
  local_attachment_file_count: 0,
  partial_download_bytes: 0,
  partial_download_count: 0,
  total_managed_bytes: 2_654_208,
};

const defaultReport: AppSettingsReport = {
  configured_dir: '',
  effective_dir: '/Users/demo/Downloads/better-email',
  using_default: true,
};

type Overrides = Partial<{
  appSettings: AppSettingsReport | null;
  downloadDirBusy: boolean;
  downloadDirError: string | null;
  onPickDownloadDir: () => void;
  onResetDownloadDir: () => void;
}>;

function renderPage(overrides: Overrides = {}) {
  const pickDownloadDir = overrides.onPickDownloadDir ?? vi.fn();
  const resetDownloadDir = overrides.onResetDownloadDir ?? vi.fn();
  render(
    <DataSafetySettings
      localBackupSummary={null}
      storageUsage={baseStorage}
      storageBusy={false}
      appSettings={overrides.appSettings ?? defaultReport}
      downloadDirBusy={overrides.downloadDirBusy ?? false}
      downloadDirError={overrides.downloadDirError ?? null}
      onImportBackup={vi.fn()}
      onExportBackup={vi.fn()}
      onClearAttachmentCache={() => Promise.resolve()}
      onPickDownloadDir={pickDownloadDir}
      onResetDownloadDir={resetDownloadDir}
    />,
  );
  return { pickDownloadDir, resetDownloadDir };
}

describe('DataSafetySettings 默认下载位置', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('渲染默认下载位置区块与当前生效路径', () => {
    renderPage();
    expect(screen.getByText('默认下载位置')).not.toBeNull();
    expect(screen.getByTestId('download-dir-path').textContent).toContain('/Users/demo/Downloads/better-email');
    expect(screen.getByRole('button', { name: '选择文件夹' })).not.toBeNull();
    expect(screen.getByRole('button', { name: '恢复默认位置' })).not.toBeNull();
  });

  it('不再暴露技术统计、EML 导入与备份预览入口', () => {
    renderPage();
    expect(screen.queryByText('邮件数据库')).toBeNull();
    expect(screen.queryByText('本地唯一附件')).toBeNull();
    expect(screen.queryByRole('button', { name: '导入 EML' })).toBeNull();
    expect(screen.queryByRole('button', { name: '预览备份' })).toBeNull();
  });

  it('默认位置时禁用「恢复默认位置」按钮', () => {
    renderPage({ appSettings: { ...defaultReport, using_default: true } });
    expect((screen.getByRole('button', { name: '恢复默认位置' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('自定义位置时启用「恢复默认位置」按钮', () => {
    renderPage({
      appSettings: {
        configured_dir: '/Users/demo/Documents/附件',
        effective_dir: '/Users/demo/Documents/附件',
        using_default: false,
      },
    });
    expect((screen.getByRole('button', { name: '恢复默认位置' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('点击「选择文件夹」触发目录选择回调', () => {
    const { pickDownloadDir } = renderPage();
    fireEvent.click(screen.getByRole('button', { name: '选择文件夹' }));
    expect(pickDownloadDir).toHaveBeenCalledTimes(1);
  });

  it('点击「恢复默认位置」触发恢复回调', () => {
    const { resetDownloadDir } = renderPage({
      appSettings: {
        configured_dir: '/Users/demo/Documents/附件',
        effective_dir: '/Users/demo/Documents/附件',
        using_default: false,
      },
    });
    fireEvent.click(screen.getByRole('button', { name: '恢复默认位置' }));
    expect(resetDownloadDir).toHaveBeenCalledTimes(1);
  });

  it('选择过程中按钮显示忙碌状态且禁用', () => {
    renderPage({ downloadDirBusy: true });
    const pick = screen.getByRole('button', { name: '正在选择…' }) as HTMLButtonElement;
    expect(pick.disabled).toBe(true);
    expect((screen.getByRole('button', { name: '恢复默认位置' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('显示不可写目录的错误提示（可操作中文）', () => {
    renderPage({
      downloadDirError: '无法写入所选文件夹：权限不足。请换一个可写的目录后再试，本次不会保存该位置。',
    });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('无法写入所选文件夹');
    expect(alert.textContent).toContain('请换一个可写的目录后再试');
  });

  it('路径过长时可通过复制按钮查看完整路径', async () => {
    const longPath = `/Users/demo/Downloads/better-email/${'a'.repeat(120)}/附件.pdf`;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    renderPage({
      appSettings: {
        configured_dir: longPath,
        effective_dir: longPath,
        using_default: false,
      },
    });
    const pathEl = screen.getByTestId('download-dir-path');
    expect(pathEl.textContent).toBe(longPath);
    expect(pathEl.getAttribute('title')).toBe(longPath);

    const copy = screen.getByRole('button', { name: '复制完整路径' });
    fireEvent.click(copy);
    expect(writeText).toHaveBeenCalledWith(longPath);
  });

  it('复制成功后按钮 aria-label 变为已复制', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '复制完整路径' }));
    expect(await screen.findByRole('button', { name: '已复制' })).not.toBeNull();
  });
});
