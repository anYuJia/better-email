import type React from 'react';
import {
  BadgeCheck,
  Bell,
  ChevronLeft,
  ChevronRight,
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

  return (
    <div className="composer-backdrop settings-backdrop">
      <section className="settings-modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="settings-main-header">
          <div className="settings-title">
            <strong>{title}</strong>
            <span>{subtitle}</span>
          </div>
          <div className="settings-header-actions">
            {connectionSections.has(activeSection) && (
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
            )}
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
            <button
              type="button"
              className="settings-close-button"
              aria-label="关闭设置"
              title="关闭设置"
              onClick={onClose}
            >
              <X size={15} />
            </button>
          </div>
        </header>
        <div className="settings-body">
          <nav className="settings-nav" aria-label="设置分类">
            <div className="settings-nav-intro">
              <strong>设置</strong>
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
                      <span className="settings-nav-icon">
                        <Icon size={15} />
                      </span>
                      <span className="settings-nav-label">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
          <div className="settings-content">
            <section
              className="settings-page"
              data-settings-page={activeSection}
              aria-labelledby={`settings-page-${activeSection}`}
            >
              <header className="settings-page-header">
                <div className="settings-page-eyebrow">
                  <span>{activeGroup.label}</span>
                  <em>{activeIndex + 1} / {navigationItems.length}</em>
                </div>
                <strong id={`settings-page-${activeSection}`}>{activeItem.label}</strong>
                <p>{activeItem.description}</p>
              </header>
              <div className="settings-page-content">{children}</div>
              <footer className="settings-page-pagination" aria-label="设置分页">
                {previousItem ? (
                  <button type="button" onClick={() => onNavigate(previousItem.id)}>
                    <ChevronLeft size={15} />
                    <span>
                      <small>上一项</small>
                      <strong>{previousItem.label}</strong>
                    </span>
                  </button>
                ) : <span />}
                {nextItem ? (
                  <button type="button" className="next" onClick={() => onNavigate(nextItem.id)}>
                    <span>
                      <small>下一项</small>
                      <strong>{nextItem.label}</strong>
                    </span>
                    <ChevronRight size={15} />
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
