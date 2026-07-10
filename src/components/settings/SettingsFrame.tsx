import { useEffect } from 'react';
import type React from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Bell,
  ChevronDown,
  ContactRound,
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
import './settings-shell.css';

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
  | 'contacts'
  | 'rules'
  | 'security-preview';

type SettingsFrameProps = {
  title: string;
  subtitle: string;
  activeSection: SettingsSectionId;
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
      {
        id: 'accounts' as const,
        label: '账号',
        description: '管理账号资料、同步策略和本机账号生命周期。',
        icon: UserRound,
      },
      {
        id: 'providers' as const,
        label: '服务商',
        description: '选择服务商预设，配置 IMAP、SMTP 与兼容性记录。',
        icon: Server,
      },
      {
        id: 'auth' as const,
        label: '认证',
        description: '管理授权码、OAuth2 流程和安全凭据验证。',
        icon: ShieldCheck,
      },
    ],
  },
  {
    label: '体验与隐私',
    items: [
      {
        id: 'sending' as const,
        label: '发送',
        description: '设置撤销发送窗口与发件队列体验。',
        icon: TimerReset,
      },
      {
        id: 'notifications' as const,
        label: '通知',
        description: '配置免打扰、VIP 和账号级提醒优先级。',
        icon: Bell,
      },
      {
        id: 'privacy' as const,
        label: '隐私',
        description: '控制远程图片、追踪防护与发件人信任规则。',
        icon: EyeOff,
      },
      {
        id: 'identities' as const,
        label: '身份',
        description: '维护发件身份、别名、Reply-To 与签名。',
        icon: BadgeCheck,
      },
    ],
  },
  {
    label: '数据与自动化',
    items: [
      {
        id: 'backup' as const,
        label: '备份',
        description: '导入导出本地数据、诊断报告和连接状态。',
        icon: DatabaseBackup,
      },
      {
        id: 'sync' as const,
        label: '同步',
        description: '管理 IMAP 发现、凭据验证、同步和远端回写验收。',
        icon: RefreshCw,
      },
      {
        id: 'contacts' as const,
        label: '联系人',
        description: '维护联系人、别名、VIP 与重复项合并。',
        icon: ContactRound,
      },
      {
        id: 'rules' as const,
        label: '规则',
        description: '按发件人、主题和内容自动处理新邮件。',
        icon: Workflow,
      },
      {
        id: 'security-preview' as const,
        label: '安全预览',
        description: '解析 MIME、清洗 HTML 并检查附件与远程资源。',
        icon: ScanSearch,
      },
    ],
  },
];

const navigationItems = navigationGroups.flatMap((group) => (
  group.items.map((item) => ({ ...item, groupLabel: group.label }))
));

const connectionSections = new Set<SettingsSectionId>([
  'accounts',
  'providers',
  'auth',
  'sync',
]);

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
  const activeGroup = navigationGroups.find((group) => (
    group.items.some((item) => item.id === activeSection)
  )) ?? navigationGroups[0];
  const activeItem = activeGroup.items.find((item) => item.id === activeSection) ?? activeGroup.items[0];
  const activeIndex = navigationItems.findIndex((item) => item.id === activeSection);
  const previousItem = activeIndex > 0 ? navigationItems[activeIndex - 1] : null;
  const nextItem = activeIndex >= 0 && activeIndex < navigationItems.length - 1
    ? navigationItems[activeIndex + 1]
    : null;
  const ActiveIcon = activeItem.icon;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (!event.altKey) return;
      if (event.key === 'ArrowLeft' && previousItem) {
        event.preventDefault();
        onNavigate(previousItem.id);
      }
      if (event.key === 'ArrowRight' && nextItem) {
        event.preventDefault();
        onNavigate(nextItem.id);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nextItem, onClose, onNavigate, previousItem]);

  return (
    <div
      className="composer-backdrop settings-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="settings-modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="settings-main-header">
          <div className="settings-title">
            <span className="settings-app-mark" aria-hidden="true">
              <SettingsGlyph />
            </span>
            <span className="settings-title-copy">
              <strong>{title}</strong>
              <small>{subtitle}</small>
            </span>
          </div>
          <div className="settings-header-actions">
            {connectionSections.has(activeSection) && (
              <button
                type="button"
                className="settings-header-button secondary"
                aria-label="测试连接"
                title="测试当前账号的 IMAP 与 SMTP 服务器连接"
                onClick={onTestConnection}
              >
                <FlaskConical size={15} />
                <span>测试连接</span>
              </button>
            )}
            <button
              type="button"
              className="settings-header-button primary"
              aria-label="保存设置"
              title="保存当前账号设置"
              onClick={onSave}
            >
              <Save size={15} />
              <span>保存</span>
            </button>
            <button
              type="button"
              className="settings-close-button"
              aria-label="关闭设置"
              title="关闭设置"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </div>
        </header>
        <div className="settings-body">
          <nav className="settings-nav" aria-label="设置分类">
            <div className="settings-nav-intro">
              <strong>偏好设置</strong>
              <span>{navigationItems.length} 个独立页面</span>
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
                      title={item.description}
                      onClick={() => onNavigate(item.id)}
                    >
                      <span className="settings-nav-icon">
                        <Icon size={15} />
                      </span>
                      <span className="settings-nav-label">{item.label}</span>
                      {active && <span className="settings-nav-active-dot" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
          <div className="settings-content">
            <div className="settings-mobile-toolbar">
              <label className="settings-page-picker">
                <span>
                  <ActiveIcon size={16} />
                  <strong>{activeItem.label}</strong>
                </span>
                <select
                  aria-label="切换设置页面"
                  value={activeSection}
                  onChange={(event) => onNavigate(event.target.value as SettingsSectionId)}
                >
                  {navigationGroups.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.items.map((item) => (
                        <option key={item.id} value={item.id}>{item.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <ChevronDown size={15} aria-hidden="true" />
              </label>
            </div>
            <section
              key={activeSection}
              className="settings-page"
              data-settings-page={activeSection}
              aria-labelledby={`settings-page-${activeSection}`}
            >
              <header className="settings-page-header">
                <div className="settings-page-heading">
                  <span className="settings-page-icon" aria-hidden="true">
                    <ActiveIcon size={19} />
                  </span>
                  <div>
                    <span>{activeGroup.label} · {activeIndex + 1}/{navigationItems.length}</span>
                    <strong id={`settings-page-${activeSection}`}>{activeItem.label}</strong>
                  </div>
                </div>
                <p>{activeItem.description}</p>
              </header>
              <div className="settings-page-content">{children}</div>
              <footer className="settings-page-pagination" aria-label="设置分页">
                {previousItem ? (
                  <button
                    type="button"
                    onClick={() => onNavigate(previousItem.id)}
                    title={`上一页：${previousItem.label}`}
                  >
                    <ArrowLeft size={16} />
                    <span>
                      <small>上一页</small>
                      <strong>{previousItem.label}</strong>
                    </span>
                  </button>
                ) : <span />}
                {nextItem ? (
                  <button
                    type="button"
                    className="next"
                    onClick={() => onNavigate(nextItem.id)}
                    title={`下一页：${nextItem.label}`}
                  >
                    <span>
                      <small>下一页</small>
                      <strong>{nextItem.label}</strong>
                    </span>
                    <ArrowRight size={16} />
                  </button>
                ) : <span />}
              </footer>
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}

function SettingsGlyph() {
  return (
    <svg viewBox="0 0 24 24" role="presentation">
      <path d="M5.4 7.2h13.2M7.7 12h8.6M9.8 16.8h4.4" />
      <circle cx="8.1" cy="7.2" r="1.5" />
      <circle cx="14.9" cy="12" r="1.5" />
      <circle cx="11.5" cy="16.8" r="1.5" />
    </svg>
  );
}
