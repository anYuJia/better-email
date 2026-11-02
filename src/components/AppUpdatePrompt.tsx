import { AlertCircle, Download, RefreshCw, X } from 'lucide-react';
import type { AppUpdate, UpdateInstallProgress } from '../app/updateService';

type AppUpdatePromptProps = {
  update: AppUpdate;
  installing: boolean;
  progress: UpdateInstallProgress | null;
  error: string | null;
  onInstall: () => void;
  onDismiss: () => void;
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  for (const unit of units) {
    if (value < 1024 || unit === units[units.length - 1]) {
      return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
    }
    value /= 1024;
  }
  return `${Math.round(bytes)} B`;
}

function getProgressLabel(progress: UpdateInstallProgress | null): string {
  if (!progress) return '正在准备更新…';
  if (progress.phase === 'preparing') return '正在准备更新…';
  if (progress.phase === 'installing') return '下载完成，正在安装…';
  if (progress.phase === 'restarting') return '更新已安装，正在重启…';
  const downloaded = formatBytes(progress.downloadedBytes);
  if (!progress.totalBytes) return `正在下载… ${downloaded}`;
  return `正在下载… ${downloaded} / ${formatBytes(progress.totalBytes)}`;
}

export default function AppUpdatePrompt({
  update,
  installing,
  progress,
  error,
  onInstall,
  onDismiss,
}: AppUpdatePromptProps) {
  const progressPercent = progress?.totalBytes && progress.totalBytes > 0
    ? Math.min(100, Math.round((progress.downloadedBytes / progress.totalBytes) * 100))
    : null;

  return (
    <section className="app-update-prompt" role="status" aria-live="polite">
      <div className="app-update-prompt-heading">
        <span className="app-update-prompt-icon" aria-hidden="true">
          {installing ? <RefreshCw className="settings-action-spinner" size={16} /> : <Download size={16} />}
        </span>
        <span className="app-update-prompt-title">
          <strong>发现新版本</strong>
          <small>Better Email v{update.version}</small>
        </span>
        {!installing && (
          <button type="button" className="app-update-prompt-close" onClick={onDismiss} aria-label="稍后处理更新">
            <X size={15} />
          </button>
        )}
      </div>

      <p className="app-update-prompt-copy">
        {installing ? getProgressLabel(progress) : '新版本已签名，可以安全下载并自动安装。'}
      </p>

      {installing && (
        <div className="app-update-prompt-progress">
          <div className="app-update-prompt-progress-label">
            <span>{getProgressLabel(progress)}</span>
            {progressPercent !== null && <span>{progressPercent}%</span>}
          </div>
          <progress
            max="100"
            value={progressPercent ?? undefined}
            aria-label={getProgressLabel(progress)}
          />
        </div>
      )}

      {error && (
        <p className="app-update-prompt-error" role="alert">
          <AlertCircle size={14} aria-hidden="true" />
          <span>{error}。可以重试，或稍后在设置的“关于”页面更新。</span>
        </p>
      )}

      {!installing && (
        <div className="app-update-prompt-actions">
          <button type="button" className="app-update-prompt-primary" onClick={onInstall}>
            立即更新
          </button>
          <button type="button" className="app-update-prompt-secondary" onClick={onDismiss}>
            稍后
          </button>
        </div>
      )}
    </section>
  );
}
