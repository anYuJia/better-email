import { useState, type Dispatch, type SetStateAction } from 'react';
import type {
  LocalBackupSummary,
  StorageUsage,
  CacheClearResult,
  Attachment,
  MessageSummary,
} from '../app/types';
import { formatBytes } from '../mailUtils';
import { invoke } from '../tauriBridge';

type StorageManagementOptions = {
  selected: MessageSummary | null;
  diagnosticExport: string | null;
  setDiagnosticExport: Dispatch<SetStateAction<string | null>>;
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  loadMeta: (folderId?: number | null) => Promise<{ folderId: number | null }>;
  loadMessages: (folderId: number | null) => Promise<unknown>;
  setStatus: Dispatch<SetStateAction<string>>;
};

export default function useStorageManagement({
  selected,
  diagnosticExport,
  setDiagnosticExport,
  setAttachments,
  loadMeta,
  loadMessages,
  setStatus,
}: StorageManagementOptions) {
  const [localBackupSummary, setLocalBackupSummary] = useState<LocalBackupSummary | null>(null);
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null);
  const [storageBusy, setStorageBusy] = useState(false);

  async function exportDiagnostics() {
    const payload = await invoke<string>('export_diagnostics');
    setDiagnosticExport(payload);
    try {
      await navigator.clipboard.writeText(payload);
      setStatus('脱敏诊断 JSON 已生成并复制到剪贴板');
    } catch {
      setStatus('脱敏诊断 JSON 已生成，当前环境无法自动复制');
    }
  }

  async function exportLocalBackup() {
    const summary = await invoke<LocalBackupSummary>('export_local_backup');
    setLocalBackupSummary(summary);
    setStatus(`本地备份已导出：${summary.messages} 封邮件，${summary.accounts} 个账号`);
  }

  async function previewLocalBackup() {
    const summary = await invoke<LocalBackupSummary | null>('preview_local_backup');
    if (!summary) {
      setStatus('已取消选择备份文件');
      return;
    }
    setLocalBackupSummary(summary);
    setStatus(`已读取备份预览：${summary.messages} 封邮件，${summary.accounts} 个账号`);
  }

  async function importLocalBackup() {
    const summary = await invoke<LocalBackupSummary | null>('import_local_backup');
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
      const usage = await invoke<StorageUsage>('get_storage_usage');
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
      const result = await invoke<CacheClearResult>('clear_attachment_cache');
      setStorageUsage(result.storage);
      if (selected) {
        const refreshedAttachments = await invoke<Attachment[]>('list_attachments', {
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

  return {
    diagnosticExport,
    localBackupSummary,
    storageUsage,
    storageBusy,
    exportDiagnostics,
    exportLocalBackup,
    previewLocalBackup,
    importLocalBackup,
    refreshStorageUsage,
    clearAttachmentCache,
  };
}
