import type React from 'react';
import {
  BadgeCheck,
  Bell,
  DatabaseBackup,
  EyeOff,
  FlaskConical,
  RefreshCw,
  Save,
  ScanSearch,
  Server,
  ShieldCheck,
  TimerReset,
  UserRound,
  Workflow,
  X,
} from 'lucide-react';
import './settings.css';

export type SettingsSectionId =
  | 'accounts'
  | 'providers'
  | 'auth'
  | 'sending'
  | 'notifications'
  | 'privacy'
  | 'identities'
  | 'backup'
  | 'sync'
  | 'rules'
  | 'security-preview';

type SettingsFrameProps = {
  title: string;
  subtitle: string;
  activeSection: string;
  children: React.ReactNode;
  onNavigate: (section: SettingsSectionId) => void;
  onTestConnection: () => void;
  onSave: () => void;
  onClose: () => void;
};

const navigationGroups = [
  {
    label: '账号与连接',
    items: [
      { id: 'accounts' as const, label: '账号', icon: UserRound },
      { id: 'providers' as const, label: '服务商', icon: Server },
      { id: 'auth' as const, label: '认证', icon: ShieldCheck },
    ],
  },
  {
    label: '体验与隐私',
    items: [
      { id: 'sending' as const, label: '发送', icon: TimerReset },
      { id: 'notifications' as const, label: '通知', icon: Bell },
      { id: 'privacy' as const, label: '隐私', icon: EyeOff },
      { id: 'identities' as const, label: '身份', icon: BadgeCheck },
    ],
  },
  {
    label: '数据与自动化',
    items: [
      { id: 'backup' as const, label: '备份', icon: DatabaseBackup },
      { id: 'sync' as const, label: '同步', icon: RefreshCw },
      { id: 'rules' as const, label: '规则', icon: Workflow },
      { id: 'security-preview' as const, label: '安全预览', icon: ScanSearch },
    ],
  },
];

export default function SettingsFrame({
  title,
  subtitle,
  activeSection,
  children,
  onNavigate,
  onTestConnection,
  onSave,
  onClose,
}: SettingsFrameProps) {
  return (
    <div className="composer-backdrop settings-backdrop">
      <section className="settings-modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="settings-main-header">
          <div className="settings-title">
            <strong>{title}</strong>
            <span>{subtitle}</span>
          </div>
          <div className="settings-header-actions">
            <button
              type="button"
              className="settings-header-button secondary"
              aria-label="服务器测试"
              title="只测试当前账号的 IMAP 与 SMTP 服务器网络连接"
              onClick={onTestConnection}
            >
              <FlaskConical size={14} />
              <span>服务器测试</span>
            </button>
            <button
              type="button"
              className="settings-header-button primary"
              aria-label="保存设置"
              title="保存当前账号设置"
              onClick={onSave}
            >
              <Save size={14} />
              <span>保存设置</span>
            </button>
            <button type="button" className="settings-close-button" onClick={onClose}>
              <X size={15} />
              <span>关闭</span>
            </button>
          </div>
        </header>
        <div className="settings-body">
          <nav className="settings-nav" aria-label="设置分类">
            <div className="settings-nav-intro">
              <strong>设置</strong>
              <span>常用项优先，专业项按需展开</span>
            </div>
            {navigationGroups.map((group) => (
              <div className="settings-nav-section" key={group.label}>
                <span className="settings-nav-group">{group.label}</span>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = activeSection === item.id;
                  return (
                    <button
                      type="button"
                      className={active ? 'active' : ''}
                      key={item.id}
                      aria-current={active ? 'page' : undefined}
                      title={item.label}
                      onClick={() => onNavigate(item.id)}
                    >
                      <Icon size={15} />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
          <div className="settings-content">{children}</div>
        </div>
      </section>
    </div>
  );
}
