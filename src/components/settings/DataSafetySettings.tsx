import { Download, FileInput, Upload } from 'lucide-react';
import type { ConnectionReport, LocalBackupSummary } from '../../app/types';
import './data-settings.css';

type DataSafetySettingsProps = {
  diagnosticExport: string | null;
  localBackupSummary: LocalBackupSummary | null;
  connectionReport: ConnectionReport | null;
  onExportDiagnostics: () => void;
  onImportEml: () => void;
  onPreviewBackup: () => void;
  onImportBackup: () => void;
  onExportBackup: () => void;
};

export default function DataSafetySettings({
  diagnosticExport,
  localBackupSummary,
  connectionReport,
  onExportDiagnostics,
  onImportEml,
  onPreviewBackup,
  onImportBackup,
  onExportBackup,
}: DataSafetySettingsProps) {
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

      <details className="settings-disclosure" data-settings-section="backup">
        <summary>
          <span>
            <strong>备份、诊断与连接报告</strong>
            <em>导入导出、脱敏 JSON、连接测试详情</em>
          </span>
          <b>{localBackupSummary ? `${localBackupSummary.messages} 封` : '未备份'}</b>
        </summary>
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
                <strong>连接测试</strong>
                <small>IMAP、SMTP 和目标端点可达性</small>
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
      </details>
    </div>
  );
}
