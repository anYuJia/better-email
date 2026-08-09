import {
  BadgeCheck,
  Bell,
  ContactRound,
  DatabaseBackup,
  EyeOff,
  MoonStar,
  RefreshCw,
  ScanSearch,
  Sparkles,
  TimerReset,
  UserRound,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

export type SettingsSectionId =
  | 'accounts'
  | 'providers'
  | 'auth'
  | 'appearance'
  | 'sending'
  | 'notifications'
  | 'privacy'
  | 'identities'
  | 'backup'
  | 'sync'
  | 'contacts'
  | 'rules'
  | 'security-preview'
  | 'ai'
  | 'templates';

export type SettingsNavigationItem = {
  id: SettingsSectionId;
  label: string;
  description: string;
  keywords?: string[];
  icon: LucideIcon;
};

export type SettingsNavigationGroup = {
  label: string;
  items: SettingsNavigationItem[];
};

export const devMode = typeof window !== 'undefined' &&
  (window.localStorage.getItem('better-email.dev-mode') === '1' ||
   import.meta.env.DEV ||
   import.meta.env.VITE_BETTER_EMAIL_UI_MOCK === '1');

export const settingsNavigationGroups: SettingsNavigationGroup[] = [
  {
    label: '账号与连接',
    items: [
      {
        id: 'accounts',
        label: '账号',
        description: '管理邮箱账号、连接设置和登录方式',
        keywords: ['账号', '服务商', '认证', '连接', '登录', '密码', '授权码', 'oauth', 'oauth2', 'imap', 'smtp', 'pop3'],
        icon: UserRound,
      },
    ],
  },
  {
    label: '使用偏好',
    items: [
      {
        id: 'appearance',
        label: '外观',
        description: '切换亮色、暗色或跟随系统外观。',
        keywords: ['外观', '主题', '亮色', '暗色', '深色', '浅色', '跟随系统', 'appearance', 'theme', 'dark mode', 'light mode', '皮肤'],
        icon: MoonStar,
      },
      {
        id: 'sending',
        label: '发送',
        description: '设置撤销发送窗口与发件队列。',
        keywords: ['发送', '撤销', '取消发送', '发件队列', '队列', 'undo', '收件箱'],
        icon: TimerReset,
      },
      {
        id: 'notifications',
        label: '通知',
        description: '配置免打扰、VIP 和账号级提醒优先级。',
        keywords: ['通知', '提醒', '免打扰', '免打扰时段', 'vip', '静音', '铃声', '通知策略', 'notification'],
        icon: Bell,
      },
    ],
  },
  {
    label: '安全与隐私',
    items: [
      {
        id: 'privacy',
        label: '隐私',
        description: '控制远程图片、追踪像素与发件人信任规则。',
        keywords: ['隐私', '远程图片', '追踪', '像素', '跟踪', '信任', '放行', '图片', 'privacy', 'tracking'],
        icon: EyeOff,
      },
      {
        id: 'identities',
        label: '身份',
        description: '维护发件身份、别名、Reply-To 与签名。',
        keywords: ['身份', '别名', '签名', '发件人', 'reply-to', '回复地址', 'identity'],
        icon: BadgeCheck,
      },
      ...(devMode ? [
        {
          id: 'security-preview' as SettingsSectionId,
          label: '安全预览',
          description: '解析 MIME、清洗 HTML 并检查附件与远程资源。',
          keywords: ['安全预览', 'mime', 'html', '清洗', '附件', '远程资源', '预览'],
          icon: ScanSearch,
        },
      ] : []),
    ],
  },
  {
    label: '智能与效率',
    items: [
      {
        id: 'ai',
        label: 'AI 服务',
        description: '配置翻译、摘要与模板生成的 AI / MCP 服务。',
        keywords: ['ai', '翻译', '摘要', '模板生成', 'api', 'mcp', 'openai', '模型', 'key', '智能', '人工智能'],
        icon: Sparkles,
      },
      {
        id: 'templates',
        label: '模板',
        description: '管理写信模板、分类与变量，支持 AI 辅助生成。',
        keywords: ['模板', '写信', '变量', '常用', '分类', '标签', 'ai 生成', 'template'],
        icon: Workflow,
      },
    ],
  },
  {
    label: '数据与规则',
    items: [
      {
        id: 'backup',
        label: '备份',
        description: '导入导出本地数据、诊断报告和连接状态。',
        keywords: ['备份', '导入', '导出', '诊断', '恢复', 'backup', 'restore'],
        icon: DatabaseBackup,
      },
      {
        id: 'sync',
        label: '同步',
        description: devMode 
          ? '管理 IMAP 发现、凭据验证、同步和远端回写验收。'
          : '管理邮件同步状态与连接。',
        keywords: ['同步', 'imap', '连接', '同步状态', 'sync', '拉取', '刷新'],
        icon: RefreshCw,
      },
      {
        id: 'contacts',
        label: '联系人',
        description: '维护联系人、别名、VIP 与重复项合并。',
        keywords: ['联系人', '通讯录', '别名', 'vip', '合并', '重复', 'contact'],
        icon: ContactRound,
      },
      {
        id: 'rules',
        label: '规则',
        description: '按发件人、主题和内容处理新邮件。',
        keywords: ['规则', '自动化', '过滤', '标签', '发件人', '主题', 'rule'],
        icon: Workflow,
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
  const resolvedSection = (activeSection === 'providers' || activeSection === 'auth') ? 'accounts' : activeSection;
  const group = settingsNavigationGroups.find((candidate) => (
    candidate.items.some((item) => item.id === resolvedSection)
  )) ?? settingsNavigationGroups[0];
  const item = group.items.find((candidate) => candidate.id === resolvedSection) ?? group.items[0];

  return {
    group,
    item,
    index: Math.max(0, settingsNavigationItems.findIndex((candidate) => candidate.id === resolvedSection)),
  };
}
