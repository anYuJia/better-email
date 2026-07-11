import { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Database,
  Download,
  FileInput,
  HardDrive,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type {
  ConnectionReport,
  LocalBackupSummary,
  StorageUsage,
} from '../../app/types';
import { formatBytes } from '../../mailUtils';
import './data-settings.css';

type DataSafetySettingsProps = {
  diagnosticExport: string | null;
  localBackupSummary: LocalBackupSummary | null;
  connectionReport: ConnectionReport | null;
  storageUsage: StorageUsage | null;
  storageBusy: boolean;
  onExportDiagnostics: () => void;
  onImportEml: () => void;
  onPreviewBackup: () => void;
  onImportBackup: () => void;
  onExportBackup: () => void;
  onRefreshStorage: () => Promise<void>;
  onClearAttachmentCache: () => Promise<void>;
};

export default function DataSafetySettings({
  diagnosticExport,
  localBackupSummary,
  connectionReport,
  storageUsage,
  storageBusy,
  onExportDiagnostics,
  onImportEml,
  onPreviewBackup,
  onImportBackup,
  onExportBackup,
  onRefreshStorage,
  onClearAttachmentCache,
}: DataSafetySettingsProps) {
  const [cacheConfirmationOpen, setCacheConfirmationOpen] = useState(false);

  async function confirmClearAttachmentCache() {
    try {
      await onClearAttachmentCache();
      setCacheConfirmationOpen(false);
    } catch {
      // The parent status surface reports the failure without dismissing this confirmation.
    }
  }

  return (
    <div className="settings-data-safety">
      <div className="settings-action-bar">
        <span>敏感凭据只写入系统安全存储，本地数据库仅保存非敏感配置。</span>
        <div>
          <button className="secondary" type="button" onClick={onExportDiagnostics}>
            <Download size={14} />
            导出诊断
          </button>
        </div>
      </div>

      <section className="settings-static-section" data-settings-section="backup">
        <header className="settings-static-header">
          <span>
            <strong>存储、备份与诊断</strong>
            <em>控制本地占用，保留可恢复的数据边界</em>
          </span>
          <b>{storageUsage ? formatBytes(storageUsage.total_managed_bytes) : '读取中'}</b>
        </header>
        <section className="tool-panel settings-storage-panel">
          <header className="tool-header">
            <span>
              <strong>本地存储</strong>
              <small>数据库、远端附件缓存与本地唯一附件分开统计</small>
            </span>
            <button
              className="secondary settings-storage-refresh"
              type="button"
              disabled={storageBusy}
              aria-busy={storageBusy}
              onClick={() => { onRefreshStorage().catch(() => undefined); }}
            >
              <RefreshCw size={14} />
              {storageBusy ? '读取中' : '刷新'}
            </button>
          </header>
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
              <small>
                清理后远端附件可再次下载；导入 EML 和本地唯一附件不会删除。
              </small>
            </span>
            <button
              className="danger-secondary"
              type="button"
              disabled={!storageUsage || storageUsage.reclaimable_cache_bytes === 0 || storageBusy}
              onClick={() => setCacheConfirmationOpen(true)}
            >
              <Trash2 size={14} />
              清理缓存
            </button>
          </div>
        </section>
        {diagnosticExport && (
          <section className="tool-panel settings-diagnostic-panel">
            <header className="tool-header">
              <span>
                <strong>脱敏诊断</strong>
                <small>敏感字段已移除，可用于排查连接和同步问题</small>
              </span>
              <em>{Math.round(diagnosticExport.length / 1024)} KB JSON</em>
            </header>
            <textarea readOnly value={diagnosticExport.slice(0, 2500)} />
          </section>
        )}
        <section className="tool-panel settings-backup-panel">
          <header className="tool-header">
            <span>
              <strong>本地备份与恢复</strong>
              <small>账号配置、邮件、规则、发件箱和同步记录</small>
            </span>
            <em>{localBackupSummary ? `${localBackupSummary.messages} 封邮件` : '不包含系统凭据'}</em>
          </header>
          <p>密码与 OAuth Token 始终保留在系统安全存储，不会写入备份文件。</p>
          <div className="tool-actions settings-backup-actions">
            <button className="secondary" type="button" onClick={onImportEml}>
              <FileInput size={14} />
              导入 EML
            </button>
            <button className="secondary" type="button" onClick={onPreviewBackup}>预览备份</button>
            <button className="secondary" type="button" onClick={onImportBackup}>
              <Upload size={14} />
              恢复备份
            </button>
            <button type="button" onClick={onExportBackup}>
              <Download size={14} />
              导出本地备份
            </button>
          </div>
          <small>单个 EML 上限 25 MB；正文会安全清洗，内嵌附件保存到本地应用数据目录。</small>
          {localBackupSummary && (
            <div className="tool-row ok settings-backup-summary">
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
        </section>
        {connectionReport && (
          <section className="tool-panel settings-connection-report">
            <header className="tool-header">
              <span>
                <strong>服务器连接</strong>
                <small>仅检查 IMAP、SMTP 网络端点，不验证账号凭据</small>
              </span>
              <em>{connectionReport.endpoints.filter((endpoint) => endpoint.reachable).length}/{connectionReport.endpoints.length} 可用</em>
            </header>
            <div className="settings-endpoint-grid">
              {connectionReport.endpoints.map((endpoint) => (
                <div className={endpoint.reachable ? 'tool-row ok' : 'tool-row warn'} key={endpoint.name}>
                  <span>{endpoint.name}</span>
                  <em>{endpoint.address}</em>
                  <small>{endpoint.latency_ms === null ? '未连通' : `${endpoint.latency_ms}ms`}</small>
                  <p>{endpoint.message}</p>
                </div>
              ))}
            </div>
          </section>
        )}
      </section>

      {cacheConfirmationOpen && storageUsage && createPortal((
        <div
          className="settings-cache-confirm-backdrop"
          onMouseDown={(event) => {
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
              <button
                className="secondary"
                type="button"
                disabled={storageBusy}
                onClick={() => setCacheConfirmationOpen(false)}
              >
                取消
              </button>
              <button
                className="danger"
                type="button"
                disabled={storageBusy}
                aria-busy={storageBusy}
                onClick={confirmClearAttachmentCache}
              >
                <Trash2 size={14} />
                {storageBusy ? '正在清理…' : '确认清理'}
              </button>
            </footer>
          </section>
        </div>
      ), document.body)}
    </div>
  );
}
