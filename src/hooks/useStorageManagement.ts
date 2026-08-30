import { useState, type Dispatch, type SetStateAction } from 'react';
import type {
  LocalBackupSummary,
  StorageUsage,
  CacheClearResult,
  AppSettingsReport,
  DownloadDirSetResult,
  Attachment,
  MessageSummary,
} from '../app/types';
import { formatBytes } from '../mailUtils';
import { invoke } from '../tauriBridge';
import { IPC } from '../ipc/commands';

type StorageManagementOptions = {
  selected: MessageSummary | null;
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  loadMeta: (folderId?: number | null) => Promise<{ folderId: number | null }>;
  loadMessages: (folderId: number | null) => Promise<unknown>;
  setStatus: Dispatch<SetStateAction<string>>;
};

export default function useStorageManagement({
  selected,
  setAttachments,
  loadMeta,
  loadMessages,
  setStatus,
}: StorageManagementOptions) {
  const [localBackupSummary, setLocalBackupSummary] = useState<LocalBackupSummary | null>(null);
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null);
  const [storageBusy, setStorageBusy] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettingsReport | null>(null);
  const [downloadDirBusy, setDownloadDirBusy] = useState(false);
  const [downloadDirError, setDownloadDirError] = useState<string | null>(null);

  async function exportLocalBackup() {
    const summary = await invoke<LocalBackupSummary>(IPC.ExportLocalBackup);
    setLocalBackupSummary(summary);
    setStatus(`本地备份已导出：${summary.messages} 封邮件，${summary.accounts} 个账号`);
  }

  async function importLocalBackup() {
    const summary = await invoke<LocalBackupSummary | null>(IPC.ImportLocalBackup);
    if (!summary) {
      setStatus('已取消恢复本地备份');
      return;
    }
    setLocalBackupSummary(summary);
    const { folderId: nextFolderId } = await loadMeta(null);
    await loadMessages(nextFolderId);
    setStatus(`本地备份已恢复：${summary.messages} 封邮件，${summary.accounts} 个账号`);
  }

  async function refreshStorageUsage(announce = true) {
    setStorageBusy(true);
    try {
      const usage = await invoke<StorageUsage>(IPC.GetStorageUsage);
      setStorageUsage(usage);
      if (announce) {
        setStatus(`本地存储已刷新：共 ${formatBytes(usage.total_managed_bytes)}`);
      }
    } catch (error) {
      setStatus(`读取本地存储失败：${String(error).replace(/^Error:\s*/i, '')}`);
      throw error;
    } finally {
      setStorageBusy(false);
    }
  }

  async function clearAttachmentCache() {
    setStorageBusy(true);
    try {
      const result = await invoke<CacheClearResult>(IPC.ClearAttachmentCache);
      setStorageUsage(result.storage);
      if (selected) {
        const refreshedAttachments = await invoke<Attachment[]>(IPC.ListAttachments, {
          messageId: selected.id,
        });
        setAttachments(refreshedAttachments);
      }
      setStatus(
        result.released_bytes > 0
          ? `已释放 ${formatBytes(result.released_bytes)}，${result.reset_attachment_count} 个远端附件可按需重新下载`
          : '当前没有可清理的远端附件缓存',
      );
    } catch (error) {
      setStatus(`清理附件缓存失败：${String(error).replace(/^Error:\s*/i, '')}`);
      throw error;
    } finally {
      setStorageBusy(false);
    }
  }

  /** 读取应用全局「默认附件下载位置」设置（含回退后的实际生效目录）。 */
  async function refreshAppSettings() {
    try {
      const report = await invoke<AppSettingsReport>(IPC.GetAppSettings);
      setAppSettings(report);
      setDownloadDirError(null);
    } catch (error) {
      setStatus(`读取默认下载位置失败：${String(error).replace(/^Error:\s*/i, '')}`);
      throw error;
    }
  }

  /** 弹出原生目录选择器设置默认下载位置；用户取消时不修改原设置。 */
  async function pickDownloadDir() {
    setDownloadDirBusy(true);
    try {
      const result = await invoke<DownloadDirSetResult>(IPC.SetDownloadDir);
      setDownloadDirError(null);
      if (result.cancelled) {
        setStatus('已取消选择下载位置，设置保持不变');
        return result;
      }
      setAppSettings(result.settings);
      setStatus('默认附件下载位置已更新');
      return result;
    } catch (error) {
      const message = String(error).replace(/^Error:\s*/i, '');
      setDownloadDirError(message);
      setStatus(`设置默认下载位置失败：${message}`);
      throw error;
    } finally {
      setDownloadDirBusy(false);
    }
  }

  /** 恢复系统默认 Downloads/better-email。 */
  async function resetDownloadDir() {
    setDownloadDirBusy(true);
    try {
      const report = await invoke<AppSettingsReport>(IPC.ResetDownloadDir);
      setAppSettings(report);
      setDownloadDirError(null);
      setStatus('已恢复默认下载位置');
      return report;
    } catch (error) {
      const message = String(error).replace(/^Error:\s*/i, '');
      setDownloadDirError(message);
      setStatus(`恢复默认下载位置失败：${message}`);
      throw error;
    } finally {
      setDownloadDirBusy(false);
    }
  }

  return {
    localBackupSummary,
    storageUsage,
    storageBusy,
    appSettings,
    downloadDirBusy,
    downloadDirError,
    exportLocalBackup,
    importLocalBackup,
    refreshStorageUsage,
    clearAttachmentCache,
    refreshAppSettings,
    pickDownloadDir,
    resetDownloadDir,
  };
}
