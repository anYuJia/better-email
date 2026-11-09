import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  FolderOpen,
  HardDrive,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import ConfirmDialog from '../ConfirmDialog';
import type {
  AppSettingsReport,
  LocalBackupSummary,
  StorageUsage,
} from '../../app/types';
import { formatBytes } from '../../mailUtils';
import { copyTextToClipboard } from '../../app/clipboard';
import {
  SettingsBadge,
  SettingsButton,
  SettingsRow,
  SettingsSection,
} from './shared';

type DataSafetySettingsProps = {
  localBackupSummary: LocalBackupSummary | null;
  storageUsage: StorageUsage | null;
  storageBusy: boolean;
  appSettings: AppSettingsReport | null;
  downloadDirBusy: boolean;
  downloadDirError: string | null;
  onImportBackup: () => void;
  onExportBackup: () => void;
  onClearAttachmentCache: () => Promise<void>;
  onPickDownloadDir: () => void;
  onResetDownloadDir: () => void;
};

export default function DataSafetySettings({
  localBackupSummary,
  storageUsage,
  storageBusy,
  appSettings,
  downloadDirBusy,
  downloadDirError,
  onImportBackup,
  onExportBackup,
  onClearAttachmentCache,
  onPickDownloadDir,
  onResetDownloadDir,
}: DataSafetySettingsProps) {
  const [cacheConfirmationOpen, setCacheConfirmationOpen] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
  }, []);

  const effectiveDir = appSettings?.effective_dir ?? '';

  async function confirmClearAttachmentCache() {
    await onClearAttachmentCache();
    setCacheConfirmationOpen(false);
  }

  async function copyDownloadDirPath() {
    if (!effectiveDir) return;
    try {
      await copyTextToClipboard(effectiveDir);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopyState('idle'), 1600);
  }

  return (
    <div className="settings-data-safety">
      <SettingsSection
        title="本地存储"
        description="查看本地占用并清理可重新下载的附件缓存。"
        dataSection="backup"
      >
        <div className="settings-storage-metrics" aria-label="本地存储占用">
          <div>
            <HardDrive size={16} />
            <span>
              <small>本地总占用</small>
              <strong data-storage-total>{storageUsage ? formatBytes(storageUsage.total_managed_bytes) : '—'}</strong>
            </span>
          </div>
          <div className="reclaimable">
            <Trash2 size={16} />
            <span>
              <small>可清理缓存</small>
              <strong data-storage-reclaimable>
                {storageUsage ? formatBytes(storageUsage.reclaimable_cache_bytes) : '—'}
              </strong>
            </span>
          </div>
        </div>
        <div className="settings-storage-actions">
          <span>
            <strong>
              {storageUsage
                ? `${storageUsage.cached_attachment_count} 个远端附件 · ${storageUsage.partial_download_count} 个断点文件`
                : '正在读取附件缓存'}
            </strong>
            <small>清理后，远端附件会在再次打开时重新下载。</small>
          </span>
          <SettingsButton
            variant="danger-secondary"
            disabled={!storageUsage || storageUsage.reclaimable_cache_bytes === 0 || storageBusy}
            icon={<Trash2 size={14} />}
            onClick={() => setCacheConfirmationOpen(true)}
          >
            清理缓存
          </SettingsButton>
        </div>

        <div className="settings-download-location" data-testid="download-location">
          <SettingsRow
            title="默认下载位置"
            description={(
              <span className="settings-download-path-wrap">
                <span
                  className="settings-download-path"
                  title={effectiveDir}
                  data-testid="download-dir-path"
                >
                  {effectiveDir || '正在读取…'}
                </span>
                <button
                  type="button"
                  className="icon-only-action"
                  aria-label={copyState === 'copied' ? '已复制' : '复制完整路径'}
                  title={copyState === 'copied' ? '已复制' : '复制完整路径'}
                  disabled={!effectiveDir || copyState === 'copied'}
                  onClick={() => { copyDownloadDirPath().catch(() => undefined); }}
                >
                  {copyState === 'copied' ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </span>
            )}
            control={(
              <span className="st-actions settings-download-actions">
                <SettingsButton
                  icon={<FolderOpen size={14} />}
                  disabled={downloadDirBusy}
                  aria-busy={downloadDirBusy}
                  onClick={onPickDownloadDir}
                >
                  {downloadDirBusy ? '正在选择…' : '选择文件夹'}
                </SettingsButton>
                <SettingsButton
                  icon={<RotateCcw size={14} />}
                  disabled={downloadDirBusy || appSettings?.using_default === true}
                  onClick={onResetDownloadDir}
                >
                  恢复默认位置
                </SettingsButton>
              </span>
            )}
          />
          <p className="st-field-hint settings-download-hint">
            {appSettings?.using_default
              ? '当前使用系统默认目录；手动下载与自动下载的新附件都会保存到这里。'
              : '手动下载与自动下载的新附件都会保存到该文件夹。'}
          </p>
          {downloadDirError && (
            <p className="settings-download-error" role="alert">{downloadDirError}</p>
          )}
        </div>
      </SettingsSection>

      <SettingsSection
        title="备份与恢复"
        description="账号配置、邮件、规则、发件箱和同步记录"
        badge={
          <SettingsBadge tone="neutral">
            {localBackupSummary ? `${localBackupSummary.messages} 封邮件` : '不包含本地凭据'}
          </SettingsBadge>
        }
      >
        <p className="st-field-hint">备份不包含密码、OAuth Token 和附件文件。恢复后，远端附件需重新下载，本地草稿附件需重新添加；待发送邮件需核对后处理。</p>
        <div className="st-actions">
          <SettingsButton icon={<Upload size={14} />} onClick={onImportBackup}>恢复备份</SettingsButton>
          <SettingsButton variant="primary" icon={<Download size={14} />} onClick={onExportBackup}>
            导出本地备份
          </SettingsButton>
        </div>
        {localBackupSummary && (
          <div className="st-data-row ok settings-backup-summary">
            <span>v{localBackupSummary.schema_version}</span>
            <em>{localBackupSummary.path || 'mock://better-email-backup.json'}</em>
            <small>{Math.max(1, Math.round(localBackupSummary.size_bytes / 1024))} KB</small>
            <p>
              账号 {localBackupSummary.accounts} · 邮件 {localBackupSummary.messages} · 标签 {localBackupSummary.labels}
              {' · '}规则 {localBackupSummary.rules} · 凭据
              {localBackupSummary.credentials_included ? '已包含' : '未包含'}
            </p>
          </div>
        )}
      </SettingsSection>

      <ConfirmDialog
        open={cacheConfirmationOpen && storageUsage !== null}
        title="清理附件缓存"
        subtitle="释放可重新下载的本地文件"
        summaryText={storageUsage ? `${formatBytes(storageUsage.reclaimable_cache_bytes)} · ${storageUsage.reclaimable_file_count} 个文件${storageUsage.partial_download_count > 0 ? `，其中 ${storageUsage.partial_download_count} 个断点文件` : ''}` : undefined}
        description="邮件、账号、标签和附件元数据都会保留。远端附件再次打开时按需下载，本地导入且没有远端副本的附件不会被清理。"
        confirmText="确认清理"
        pendingText="正在清理…"
        busy={storageBusy}
        onCancel={() => setCacheConfirmationOpen(false)}
        onConfirm={confirmClearAttachmentCache}
      />
    </div>
  );
}
