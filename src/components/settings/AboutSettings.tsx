import { useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  Github,
  KeyRound,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { check } from '@tauri-apps/plugin-updater';
import packageJson from '../../../package.json';
import SettingsSection from './shared/SettingsSection';
import SettingsRow from './shared/SettingsRow';
import SettingsButton from './shared/SettingsButton';
import SettingsNotice from './shared/SettingsNotice';

const repositoryUrl = 'https://github.com/anYuJia/better-email';
const releasesUrl = `${repositoryUrl}/releases`;

type AvailableUpdate = {
  version: string;
  date?: string | null;
  body?: string | null;
};

function isTauriRuntime() {
  return typeof window !== 'undefined'
    && Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

export default function AboutSettings() {
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdate | null>(null);

  async function handleCheckUpdates() {
    if (checking) return;
    setChecking(true);
    setStatus(null);
    setAvailableUpdate(null);

    if (!isTauriRuntime()) {
      setStatus('开发预览无法访问桌面更新服务，请在已安装的 Better Email 中检查更新。');
      setChecking(false);
      return;
    }

    try {
      const update = await check();
      if (!update) {
        setStatus('当前已是最新版本，更新签名校验正常。');
        return;
      }
      setAvailableUpdate({
        version: update.version,
        date: update.date,
        body: update.body,
      });
      setStatus(`发现新版本 ${update.version}，签名校验已通过。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`更新检查失败：${message}。仅接受带有效签名的更新包。`);
    } finally {
      setChecking(false);
    }
  }

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
        description="从 GitHub Releases 获取并验证更新"
        actions={(
          <SettingsButton
            variant="primary"
            icon={checking ? <RefreshCw className="settings-action-spinner" size={15} /> : <RefreshCw size={15} />}
            disabled={checking}
            onClick={handleCheckUpdates}
          >
            {checking ? '检查中…' : '检查更新'}
          </SettingsButton>
        )}
      >
        <SettingsNotice tone="info" icon={ShieldCheck} title="签名更新保护">
          <span>
            只有签名校验通过的更新包才会被接受；签名缺失、来源不符或文件被篡改时会拒绝更新。
          </span>
        </SettingsNotice>
        {status && (
          <p className="settings-about-update-status" role="status" aria-live="polite">{status}</p>
        )}
        {availableUpdate && (
          <div className="settings-about-update-result">
            <div>
              <strong>可用更新：{availableUpdate.version}</strong>
              {availableUpdate.date && <small>{availableUpdate.date}</small>}
            </div>
            <a className="st-btn st-btn-secondary st-btn-sm" href={releasesUrl} target="_blank" rel="noreferrer">
              查看发布
              <ExternalLink size={13} />
            </a>
          </div>
        )}
        <p className="settings-about-update-footnote">
          <KeyRound size={13} /> 更新公钥内置于应用，发布私钥不会进入客户端。
        </p>
      </SettingsSection>
    </div>
  );
}
