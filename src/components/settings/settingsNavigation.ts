import {
  Bell,
  ContactRound,
  HardDrive,
  Info,
  LayoutTemplate,
  ScanSearch,
  Settings2,
  Sparkles,
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
  | 'templates'
  | 'about';

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

export const accountScopedSections = new Set<SettingsSectionId>([
  'accounts',
  'providers',
  'auth',
  'identities',
  'sync',
  'privacy',
]);

export const generalScopedSections = new Set<SettingsSectionId>([
  'appearance',
  'sending',
]);

const sectionPresentation: Record<SettingsSectionId, Pick<SettingsNavigationItem, 'label' | 'description'>> = {
  accounts: {
    label: '账号',
    description: '管理邮箱账号，并从这里进入服务器、登录、身份、同步和隐私设置。',
  },
  providers: {
    label: '服务器',
    description: '配置服务商、收信协议以及 IMAP / POP3 / SMTP 服务器。',
  },
  auth: {
    label: '登录与安全',
    description: '管理授权码、OAuth2 与当前邮箱的登录凭据。',
  },
  identities: {
    label: '身份与签名',
    description: '管理发件显示名、别名、Reply-To 与签名。',
  },
  sync: {
    label: '同步',
    description: '查看当前邮箱的同步状态、文件夹映射与手动同步。',
  },
  privacy: {
    label: '隐私',
    description: '控制当前邮箱的远程图片、外部发件人提示、链接保护与信任列表。',
  },
  appearance: {
    label: '外观',
    description: '选择界面主题与系统外观跟随方式。',
  },
  sending: {
    label: '发送',
    description: '设置撤销发送窗口与发送行为。',
  },
  notifications: {
    label: '通知',
    description: '设置免打扰、VIP 发件人和各邮箱账号的提醒优先级。',
  },
  ai: {
    label: 'AI 与集成',
    description: '配置 AI 推理服务、MCP 连接与外部服务隐私授权。',
  },
  backup: {
    label: '数据与存储',
    description: '管理本地占用、附件缓存、下载位置以及备份与恢复。',
  },
  contacts: {
    label: '通讯录',
    description: '管理联系人、VIP、别名以及联系人导入导出。',
  },
  templates: {
    label: '模板',
    description: '管理写信模板、分类、变量和常用模板。',
  },
  rules: {
    label: '自动化',
    description: '按发件人、主题和内容自动处理新邮件。',
  },
  'security-preview': {
    label: '安全预览',
    description: '开发模式下检查 MIME、HTML 清洗、附件和远程资源。',
  },
  about: {
    label: '关于',
    description: '查看版本、更新、开源许可与项目信息。',
  },
};

export function getSettingsSectionPresentation(section: SettingsSectionId) {
  return sectionPresentation[section];
}

export function resolveSettingsNavigationSectionId(section: SettingsSectionId): SettingsSectionId {
  if (accountScopedSections.has(section)) return 'accounts';
  if (generalScopedSections.has(section)) return 'appearance';
  return section;
}

export const settingsNavigationGroups: SettingsNavigationGroup[] = [
  {
    label: '常用',
    items: [
      {
        id: 'appearance',
        label: '通用',
        description: '外观与发送偏好。',
        keywords: ['通用', '外观', '主题', '亮色', '暗色', '发送', '撤销发送', 'undo', 'theme', 'appearance'],
        icon: Settings2,
      },
      {
        id: 'accounts',
        label: '账号',
        description: '邮箱账号、服务器、登录、安全、身份、同步与隐私。',
        keywords: [
          '账号', '邮箱', '服务商', '服务器', '连接', '登录', '密码', '授权码', 'oauth', 'oauth2',
          'imap', 'pop3', 'smtp', '同步', '文件夹', '身份', '别名', '签名', 'reply-to', '隐私', '远程图片',
          '信任', '外部发件人',
        ],
        icon: UserRound,
      },
      {
        id: 'notifications',
        label: '通知',
        description: '免打扰、VIP 与账号级提醒。',
        keywords: ['通知', '提醒', '免打扰', 'vip', '静音', '重点账号', 'notification'],
        icon: Bell,
      },
    ],
  },
  {
    label: '智能',
    items: [
      {
        id: 'ai',
        label: 'AI 与集成',
        description: 'AI 推理、MCP 与隐私授权。',
        keywords: ['ai', '人工智能', '翻译', '摘要', 'api', 'mcp', 'openai', '模型', 'key', '集成'],
        icon: Sparkles,
      },
    ],
  },
  {
    label: '效率工具',
    items: [
      {
        id: 'contacts',
        label: '通讯录',
        description: '联系人、VIP、别名与导入导出。',
        keywords: ['联系人', '通讯录', '别名', 'vip', '合并', '导入', '导出', 'contact'],
        icon: ContactRound,
      },
      {
        id: 'templates',
        label: '模板',
        description: '写信模板、变量与常用模板。',
        keywords: ['模板', '写信', '变量', '常用', '分类', '标签', 'template'],
        icon: LayoutTemplate,
      },
      {
        id: 'rules',
        label: '自动化',
        description: '邮件规则与自动处理。',
        keywords: ['规则', '自动化', '过滤', '标签', '发件人', '主题', 'rule'],
        icon: Workflow,
      },
    ],
  },
  {
    label: '数据与应用',
    items: [
      {
        id: 'backup',
        label: '数据与存储',
        description: '存储、缓存、下载位置与备份恢复。',
        keywords: ['数据', '存储', '缓存', '下载', '附件', '备份', '恢复', '导入', '导出', 'backup', 'storage'],
        icon: HardDrive,
      },
      ...(devMode ? [
        {
          id: 'security-preview' as SettingsSectionId,
          label: '安全预览',
          description: '开发模式邮件安全检查。',
          keywords: ['安全预览', 'mime', 'html', '清洗', '附件', '远程资源', '预览'],
          icon: ScanSearch,
        },
      ] : []),
      {
        id: 'about',
        label: '关于',
        description: '版本、更新、许可与项目。',
        keywords: ['关于', '版本', 'github', '开源', '许可', '更新', 'about', 'release'],
        icon: Info,
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
  const resolvedSection = resolveSettingsNavigationSectionId(activeSection);
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
