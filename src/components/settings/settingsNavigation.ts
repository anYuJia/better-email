import {
  Bell,
  ContactRound,
  HardDrive,
  Info,
  LayoutTemplate,
  ScanSearch,
  Send,
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

export type SettingsSearchEntry = {
  label: string;
  path: string;
  section: SettingsSectionId;
  keywords: string[];
  target?: string;
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

// Kept as an export for compatibility. General preferences no longer use a
// second tab row; each primary destination is directly reachable.
export const generalScopedSections = new Set<SettingsSectionId>();

const sectionPresentation: Record<SettingsSectionId, Pick<SettingsNavigationItem, 'label' | 'description'>> = {
  accounts: {
    label: '账号',
    description: '管理邮箱账号与当前账号的常用行为。',
  },
  providers: {
    label: '服务器',
    description: '配置收信与发信服务器。',
  },
  auth: {
    label: '登录与安全',
    description: '管理授权码、OAuth2 与登录凭据。',
  },
  identities: {
    label: '身份与签名',
    description: '管理发件身份、别名、Reply-To 与签名。',
  },
  sync: {
    label: '同步',
    description: '管理同步状态、文件夹映射与手动同步。',
  },
  privacy: {
    label: '隐私',
    description: '控制远程图片、外部发件人提示与信任列表。',
  },
  appearance: {
    label: '通用',
    description: '选择界面外观与主题。',
  },
  sending: {
    label: '发送',
    description: '设置撤销发送窗口与发送行为。',
  },
  notifications: {
    label: '通知',
    description: '管理提醒、免打扰、VIP 与账号优先级。',
  },
  ai: {
    label: 'AI 与集成',
    description: '配置 AI 服务、模型与隐私授权。',
  },
  backup: {
    label: '数据与存储',
    description: '管理本地占用、附件缓存、下载位置与备份。',
  },
  contacts: {
    label: '通讯录',
    description: '管理联系人、VIP、别名与导入导出。',
  },
  templates: {
    label: '模板',
    description: '管理写信模板、分类与变量。',
  },
  rules: {
    label: '自动化',
    description: '按条件自动处理新邮件。',
  },
  'security-preview': {
    label: '安全预览',
    description: '开发模式下检查 MIME、HTML、附件与远程资源。',
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
  return section;
}

export const settingsNavigationGroups: SettingsNavigationGroup[] = [
  {
    label: '常用',
    items: [
      {
        id: 'appearance',
        label: '通用',
        description: '界面外观与主题。',
        keywords: ['通用', '外观', '主题', '亮色', '暗色', 'theme', 'appearance'],
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
        id: 'sending',
        label: '发送',
        description: '撤销发送与发送行为。',
        keywords: ['发送', '撤销发送', '撤回', 'undo', 'send'],
        icon: Send,
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
        description: 'AI 服务、模型、MCP 与隐私授权。',
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

export const settingsSearchEntries: SettingsSearchEntry[] = [
  { label: '界面外观', path: '通用', section: 'appearance', target: 'appearance', keywords: ['主题', '系统', '亮色', '暗色', 'theme'] },
  { label: '撤销发送', path: '发送', section: 'sending', target: 'sending', keywords: ['发送延迟', '撤回', 'undo', '5秒', '10秒'] },
  { label: '邮箱账号', path: '账号 › 概览', section: 'accounts', target: 'account-overview', keywords: ['添加账号', '删除账号', '邮箱', 'display name'] },
  { label: '获取新邮件', path: '账号 › 概览', section: 'accounts', target: 'account-overview', keywords: ['同步频率', '后台检查', 'sync'] },
  { label: '自动下载附件', path: '账号 › 概览', section: 'accounts', target: 'account-overview', keywords: ['附件', '自动下载', 'download'] },
  { label: '跨邮箱发送风险提示', path: '账号 › 概览', section: 'accounts', target: 'account-overview', keywords: ['发送提醒', '跨账号', 'risk'] },
  { label: '收信与发信服务器', path: '账号 › 服务器', section: 'providers', keywords: ['imap', 'pop3', 'smtp', '端口', 'ssl', 'tls'] },
  { label: '登录凭据与授权码', path: '账号 › 登录与安全', section: 'auth', keywords: ['密码', '授权码', 'oauth', 'token'] },
  { label: '发件身份与签名', path: '账号 › 身份与签名', section: 'identities', keywords: ['签名', '别名', 'reply-to', '显示名'] },
  { label: '同步与文件夹映射', path: '账号 › 同步', section: 'sync', keywords: ['文件夹', '同步', 'imap folder'] },
  { label: '远程图片与信任列表', path: '账号 › 隐私', section: 'privacy', keywords: ['图片', '隐私', '信任', '外部发件人'] },
  { label: '只提醒 VIP', path: '通知', section: 'notifications', target: 'notifications', keywords: ['vip', '只提醒', '重点联系人'] },
  { label: '免打扰时段', path: '通知', section: 'notifications', target: 'notifications', keywords: ['免打扰', '静音', '时间', 'dnd'] },
  { label: '账号通知优先级', path: '通知 › 高级', section: 'notifications', target: 'notification-account-rules', keywords: ['重点账号', '静音账号', '优先提醒'] },
  { label: 'VIP 发件人', path: '通知 › 高级', section: 'notifications', target: 'notification-vip-rules', keywords: ['发件人', 'vip', '域名'] },
  { label: 'AI 功能', path: 'AI 与集成', section: 'ai', target: 'ai', keywords: ['翻译', '摘要', '模板生成', '人工智能'] },
  { label: 'AI 服务与模型', path: 'AI 与集成', section: 'ai', target: 'ai-llm-provider', keywords: ['openai', '模型', 'mcp', 'api', 'llm'] },
  { label: 'AI 连接参数', path: 'AI 与集成 › 高级连接', section: 'ai', target: 'ai-advanced', keywords: ['endpoint', 'api key', 'token', 'timeout', '端点'] },
  { label: '联系人与 VIP', path: '通讯录', section: 'contacts', keywords: ['联系人', '通讯录', '别名', 'vip'] },
  { label: '写信模板', path: '模板', section: 'templates', keywords: ['模板', '变量', '常用模板'] },
  { label: '邮件自动化规则', path: '自动化', section: 'rules', keywords: ['规则', '过滤', '自动处理'] },
  { label: '附件缓存与下载位置', path: '数据与存储', section: 'backup', keywords: ['缓存', '附件', '下载目录', '存储'] },
  { label: '备份与恢复', path: '数据与存储', section: 'backup', keywords: ['备份', '恢复', '导入', '导出'] },
  { label: '版本与更新', path: '关于', section: 'about', keywords: ['版本', '更新', 'github', 'license'] },
];

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
