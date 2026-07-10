import {
  BadgeCheck,
  Bell,
  ContactRound,
  DatabaseBackup,
  EyeOff,
  RefreshCw,
  ScanSearch,
  Server,
  ShieldCheck,
  TimerReset,
  UserRound,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

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

export type SettingsNavigationItem = {
  id: SettingsSectionId;
  label: string;
  description: string;
  icon: LucideIcon;
};

export type SettingsNavigationGroup = {
  label: string;
  items: SettingsNavigationItem[];
};

export const settingsNavigationGroups: SettingsNavigationGroup[] = [
  {
    label: '账号与连接',
    items: [
      {
        id: 'accounts',
        label: '账号',
        description: '管理账号资料、同步策略和本机账号生命周期。',
        icon: UserRound,
      },
      {
        id: 'providers',
        label: '服务商',
        description: '选择服务商预设，配置 IMAP、SMTP 与兼容性记录。',
        icon: Server,
      },
      {
        id: 'auth',
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
        id: 'sending',
        label: '发送',
        description: '设置撤销发送窗口与发件队列体验。',
        icon: TimerReset,
      },
      {
        id: 'notifications',
        label: '通知',
        description: '配置免打扰、VIP 和账号级提醒优先级。',
        icon: Bell,
      },
      {
        id: 'privacy',
        label: '隐私',
        description: '控制远程图片、追踪防护与发件人信任规则。',
        icon: EyeOff,
      },
      {
        id: 'identities',
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
        id: 'backup',
        label: '备份',
        description: '导入导出本地数据、诊断报告和连接状态。',
        icon: DatabaseBackup,
      },
      {
        id: 'sync',
        label: '同步',
        description: '管理 IMAP 发现、凭据验证、同步和远端回写验收。',
        icon: RefreshCw,
      },
      {
        id: 'contacts',
        label: '联系人',
        description: '维护联系人、别名、VIP 与重复项合并。',
        icon: ContactRound,
      },
      {
        id: 'rules',
        label: '规则',
        description: '按发件人、主题和内容自动处理新邮件。',
        icon: Workflow,
      },
      {
        id: 'security-preview',
        label: '安全预览',
        description: '解析 MIME、清洗 HTML 并检查附件与远程资源。',
        icon: ScanSearch,
      },
    ],
  },
];

export const settingsNavigationItems = settingsNavigationGroups.flatMap((group) => (
  group.items.map((item) => ({ ...item, groupLabel: group.label }))
));

export const connectionSettingsSections = new Set<SettingsSectionId>([
  'accounts',
  'providers',
  'auth',
  'sync',
]);

export function getSettingsNavigationContext(activeSection: SettingsSectionId) {
  const group = settingsNavigationGroups.find((candidate) => (
    candidate.items.some((item) => item.id === activeSection)
  )) ?? settingsNavigationGroups[0];
  const item = group.items.find((candidate) => candidate.id === activeSection) ?? group.items[0];

  return {
    group,
    item,
    index: settingsNavigationItems.findIndex((candidate) => candidate.id === activeSection),
  };
}
