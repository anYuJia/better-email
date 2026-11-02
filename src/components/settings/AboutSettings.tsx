import { useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  Github,
  RefreshCw,
} from 'lucide-react';
import packageJson from '../../../package.json';
import {
  checkForAppUpdate,
  getUpdateErrorMessage,
  installAppUpdate,
  isTauriRuntime,
  type AppUpdate,
  type UpdateInstallProgress,
} from '../../app/updateService';
import SettingsSection from './shared/SettingsSection';
import SettingsRow from './shared/SettingsRow';
import SettingsButton from './shared/SettingsButton';
import type { MessageToast } from '../MessageToastStack';

const repositoryUrl = 'https://github.com/anYuJia/better-email';
const releasesUrl = `${repositoryUrl}/releases`;

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

function progressLabel(progress: UpdateInstallProgress | null): string {
  if (!progress) return '';
  if (progress.phase === 'preparing') return '正在准备更新…';
  if (progress.phase === 'installing') return '下载完成，正在安装…';
  if (progress.phase === 'restarting') return '更新已安装，正在重启…';
  const downloaded = formatBytes(progress.downloadedBytes);
  if (!progress.totalBytes) return `正在下载… ${downloaded}`;
  return `正在下载… ${downloaded} / ${formatBytes(progress.totalBytes)}`;
}

type AboutSettingsProps = {
  onNotify?: (message: string, tone?: MessageToast['tone']) => void;
};

export default function AboutSettings({ onNotify = () => undefined }: AboutSettingsProps) {
  const [checking, setChecking] = useState(false);
  const [availableUpdate, setAvailableUpdate] = useState<AppUpdate | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installProgress, setInstallProgress] = useState<UpdateInstallProgress | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  async function handleCheckUpdates() {
    if (checking) return;
    setChecking(true);
    setAvailableUpdate(null);

    if (!isTauriRuntime()) {
      onNotify('开发预览无法访问桌面更新服务，请在已安装的 Better Email 中检查更新。', 'info');
      setChecking(false);
      return;
    }

    try {
      const update = await checkForAppUpdate();
      if (!update) {
        onNotify('当前已是最新版本。', 'success');
        return;
      }
      setInstallError(null);
      setInstallProgress(null);
      setAvailableUpdate(update);
      onNotify(`发现新版本 ${update.version}。`, 'info');
    } catch (error) {
      const message = getUpdateErrorMessage(error);
      onNotify(`更新检查失败：${message}。`, 'error');
    } finally {
      setChecking(false);
    }
  }

  async function handleInstallUpdate() {
    if (!availableUpdate || installing || checking) return;
    setInstalling(true);
    setInstallError(null);
    setInstallProgress(null);
    onNotify('开始下载更新，完成后将自动安装并重启。', 'info');
    try {
      await installAppUpdate(availableUpdate, setInstallProgress);
      setAvailableUpdate(null);
      setInstallProgress(null);
      onNotify('更新已安装，应用正在重启。', 'success');
    } catch (error) {
      const message = getUpdateErrorMessage(error);
      setInstallError(message);
      onNotify(`更新安装失败：${message}。`, 'error');
    } finally {
      setInstalling(false);
    }
  }

  const progressPercent = installProgress?.totalBytes && installProgress.totalBytes > 0
    ? Math.min(100, Math.round((installProgress.downloadedBytes / installProgress.totalBytes) * 100))
    : null;

  return (
    <div className="settings-about-stack">
      <SettingsSection
        className="settings-about-hero"
      >
        <div className="settings-about-brand">
          <img
            src="/brand/v4/brand-mark-64.png"
            alt="Better Email"
            className="settings-about-brand-mark"
            width={64}
            height={64}
          />
          <div>
            <strong>Better Email</strong>
            <p>简洁、私密的桌面邮箱客户端</p>
          </div>
        </div>
        <p className="settings-about-copy">
          Better Email 是免费开源软件。邮件数据默认保留在你的设备上，不依赖 Better Email 云端服务器。
        </p>
      </SettingsSection>

      <SettingsSection title="应用信息" description="版本、许可与项目地址">
        <SettingsRow
          title="当前版本"
          description="当前安装的 Better Email 版本"
          control={<span className="settings-about-value">v{packageJson.version}</span>}
        />
        <SettingsRow
          title="GitHub"
          description="源代码、问题反馈与发布记录"
          control={(
            <a className="settings-about-link" href={repositoryUrl} target="_blank" rel="noreferrer">
              <Github size={15} />
              <span>anYuJia/better-email</span>
              <ExternalLink size={13} />
            </a>
          )}
        />
        <SettingsRow
          title="开源许可"
          description="MIT License，可免费使用和修改"
          control={<span className="settings-about-license"><CheckCircle2 size={15} /> MIT</span>}
        />
      </SettingsSection>

      <SettingsSection
        title="软件更新"
        description="自动检查签名版本，下载后由应用完成安装并重启"
        actions={(
          <SettingsButton
            variant="primary"
            icon={checking ? <RefreshCw className="settings-action-spinner" size={15} /> : <RefreshCw size={15} />}
            disabled={checking || installing}
            onClick={handleCheckUpdates}
          >
            {checking ? '检查中…' : '检查更新'}
          </SettingsButton>
        )}
      >
        {availableUpdate && (
          <div className="settings-about-update-result">
            <div>
              <strong>可用更新：{availableUpdate.version}</strong>
              {availableUpdate.date && <small>{availableUpdate.date}</small>}
            </div>
            <div className="settings-about-update-actions">
              <SettingsButton
                variant="primary"
                size="sm"
                icon={installing ? <RefreshCw className="settings-action-spinner" size={13} /> : undefined}
                disabled={installing}
                onClick={handleInstallUpdate}
              >
                {installing ? '更新中…' : '立即更新'}
              </SettingsButton>
              <a className="st-btn st-btn-secondary st-btn-sm" href={releasesUrl} target="_blank" rel="noreferrer">
                查看发布
                <ExternalLink size={13} />
              </a>
            </div>
            {availableUpdate.body && (
              <p className="settings-about-update-notes">{availableUpdate.body}</p>
            )}
            {installing && installProgress && (
              <div className="settings-about-update-progress" role="status" aria-live="polite">
                <div className="settings-about-update-progress-label">
                  <span>{progressLabel(installProgress)}</span>
                  {progressPercent !== null && <span>{progressPercent}%</span>}
                </div>
                <progress
                  max="100"
                  value={progressPercent ?? undefined}
                  aria-label={progressLabel(installProgress)}
                />
              </div>
            )}
            {installError && (
              <p className="settings-about-update-error" role="alert">
                {installError}。可以稍后重试，或打开发布页手动安装。
              </p>
            )}
          </div>
        )}
      </SettingsSection>
    </div>
  );
}
