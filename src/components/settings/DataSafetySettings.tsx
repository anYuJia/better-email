import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  Copy,
  Database,
  Download,
  FileInput,
  FolderOpen,
  HardDrive,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
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
  SettingsNotice,
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
  onImportEml: () => void;
  onPreviewBackup: () => void;
  onImportBackup: () => void;
  onExportBackup: () => void;
  onRefreshStorage: () => Promise<void>;
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
  onImportEml,
  onPreviewBackup,
  onImportBackup,
  onExportBackup,
  onRefreshStorage,
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

  useEffect(() => {
    if (!cacheConfirmationOpen) return undefined;
    const previouslyFocused = document.activeElement;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !storageBusy) {
        event.stopPropagation();
        event.preventDefault();
        setCacheConfirmationOpen(false);
        if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
          previouslyFocused.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [cacheConfirmationOpen, storageBusy]);

  const effectiveDir = appSettings?.effective_dir ?? '';

  async function confirmClearAttachmentCache() {
    try {
      await onClearAttachmentCache();
      setCacheConfirmationOpen(false);
    } catch {
      // The parent status surface reports the failure without dismissing this confirmation.
    }
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
      <SettingsNotice tone="info">
        <p>敏感凭据只写入本地凭据表，本地数据库仅保存非敏感配置。</p>
      </SettingsNotice>

      <SettingsSection
        title="本地存储"
        description="数据库、远端附件缓存与本地唯一附件分开统计"
        badge={
          <SettingsBadge tone="neutral">
            {storageUsage ? formatBytes(storageUsage.total_managed_bytes) : '读取中'}
          </SettingsBadge>
        }
        actions={
          <SettingsButton
            size="sm"
            disabled={storageBusy}
            aria-busy={storageBusy}
            icon={<RefreshCw size={14} />}
            onClick={() => { onRefreshStorage().catch(() => undefined); }}
          >
            {storageBusy ? '读取中' : '刷新'}
          </SettingsButton>
        }
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
          <div>
            <Database size={16} />
            <span>
              <small>邮件数据库</small>
              <strong>{storageUsage ? formatBytes(storageUsage.database_bytes) : '—'}</strong>
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
          <div className="protected">
            <ShieldCheck size={16} />
            <span>
              <small>本地唯一附件</small>
              <strong>{storageUsage ? formatBytes(storageUsage.local_attachment_bytes) : '—'}</strong>
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
            <small>清理后远端附件可再次下载；导入 EML 和本地唯一附件不会删除。</small>
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
        <p className="st-field-hint">密码与 OAuth Token 始终保留在本地凭据中，不会写入备份文件。</p>
        <div className="st-actions">
          <SettingsButton icon={<FileInput size={14} />} onClick={onImportEml}>导入 EML</SettingsButton>
          <SettingsButton onClick={onPreviewBackup}>预览备份</SettingsButton>
          <SettingsButton icon={<Upload size={14} />} onClick={onImportBackup}>恢复备份</SettingsButton>
          <SettingsButton variant="primary" icon={<Download size={14} />} onClick={onExportBackup}>
            导出本地备份
          </SettingsButton>
        </div>
        <p className="st-field-hint">单个 EML 上限 25 MB；正文会安全清洗，内嵌附件保存到本地应用数据目录。</p>
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

      {cacheConfirmationOpen && storageUsage && createPortal((
        <div
          className="settings-cache-confirm-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget && !storageBusy) {
              setCacheConfirmationOpen(false);
            }
          }}
        >
          <section
            className="settings-cache-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cache-confirm-title"
          >
            <header>
              <span className="settings-cache-confirm-mark" aria-hidden="true">
                <Trash2 size={17} />
              </span>
              <span>
                <strong id="cache-confirm-title">清理附件缓存</strong>
                <small>释放可重新下载的本地文件</small>
              </span>
              <button
                className="icon-only-action"
                type="button"
                title="关闭"
                aria-label="关闭缓存清理确认"
                disabled={storageBusy}
                onClick={() => setCacheConfirmationOpen(false)}
              >
                <X size={16} />
              </button>
            </header>
            <div className="settings-cache-confirm-summary">
              <strong>{formatBytes(storageUsage.reclaimable_cache_bytes)}</strong>
              <span>
                {storageUsage.reclaimable_file_count} 个文件
                {storageUsage.partial_download_count > 0
                  ? `，其中 ${storageUsage.partial_download_count} 个断点文件`
                  : ''}
              </span>
            </div>
            <p>
              邮件、账号、标签和附件元数据都会保留。远端附件再次打开时按需下载，
              本地导入且没有远端副本的附件不会被清理。
            </p>
            <footer>
              <SettingsButton onClick={() => setCacheConfirmationOpen(false)} disabled={storageBusy}>
                取消
              </SettingsButton>
              <SettingsButton
                variant="danger"
                disabled={storageBusy}
                aria-busy={storageBusy}
                icon={<Trash2 size={14} />}
                onClick={confirmClearAttachmentCache}
              >
                {storageBusy ? '正在清理…' : '确认清理'}
              </SettingsButton>
            </footer>
          </section>
        </div>
      ), document.body)}
    </div>
  );
}
