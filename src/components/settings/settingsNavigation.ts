import {
  ContactRound,
  HardDrive,
  Info,
  LayoutTemplate,
  PlugZap,
  ScanSearch,
  Send,
  Settings2,
  Sparkles,
  UserRound,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

export type SettingsSectionId =
  | 'general'
  | 'accounts'
  | 'providers'
  | 'auth'
  | 'privacy'
  | 'identities'
  | 'backup'
  | 'sync'
  | 'tools'
  | 'contacts'
  | 'rules'
  | 'ai'
  | 'mcp'
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

export const accountScopedSections = new Set<SettingsSectionId>([
  'accounts',
  'providers',
  'auth',
  'identities',
  'sync',
  'privacy',
]);

const sectionPresentation: Record<SettingsSectionId, Pick<SettingsNavigationItem, 'label' | 'description'>> = {
  general: {
    label: '通用',
    description: '管理界面、发送与通知偏好。',
  },
  accounts: {
    label: '邮箱账号',
    description: '添加、切换账号并管理常用账号设置。',
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
    label: '发件身份与标签',
    description: '管理发件身份、别名、回复地址与签名。',
  },
  sync: {
    label: '同步',
    description: '管理同步状态、文件夹映射与后台同步。',
  },
  privacy: {
    label: '隐私',
    description: '控制远程图片、外部发件人提示与信任列表。',
  },
  ai: {
    label: 'AI 接入',
    description: '配置 AI 服务、模型与隐私授权。',
  },
  mcp: {
    label: 'MCP',
    description: '连接 MCP 服务，为 AI 功能提供外部工具。',
  },
  tools: {
    label: '效率工具',
    description: '管理联系人、写信模板与邮件自动化。',
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
  backup: {
    label: '数据与存储',
    description: '管理本地占用、附件缓存、下载位置与备份。',
  },
  about: {
    label: '关于',
    description: '查看版本、更新、开源许可与项目信息。',
  },
};

export function getSettingsSectionPresentation(section: SettingsSectionId) {
  return sectionPresentation[section];
}

export const settingsAccountDetailItems: SettingsNavigationItem[] = [
  {
    id: 'providers',
    label: '服务器',
    description: 'IMAP、POP3 与 SMTP 连接',
    keywords: ['服务商', '服务器', 'imap', 'pop3', 'smtp', '端口', 'tls', 'ssl'],
    icon: PlugZap,
  },
  {
    id: 'auth',
    label: '登录与安全',
    description: '授权码、OAuth2 与登录凭据',
    keywords: ['登录', '密码', '授权码', 'oauth', 'oauth2', 'token'],
    icon: ScanSearch,
  },
  {
    id: 'identities',
    label: '发件身份与标签',
    description: '发件身份、别名、回复地址与签名',
    keywords: ['身份', '别名', '签名', 'reply-to', '回复地址'],
    icon: Send,
  },
  {
    id: 'sync',
    label: '同步',
    description: '同步策略、文件夹映射与后台任务',
    keywords: ['同步', '文件夹', '映射', '后台', 'sync'],
    icon: Workflow,
  },
  {
    id: 'privacy',
    label: '隐私',
    description: '远程图片、外部发件人与信任列表',
    keywords: ['隐私', '远程图片', '信任', '外部发件人'],
    icon: ScanSearch,
  },
];

export const settingsToolDetailItems: SettingsNavigationItem[] = [
  {
    id: 'contacts',
    label: '通讯录',
    description: '联系人、VIP、别名与导入导出',
    keywords: ['联系人', '通讯录', '别名', 'vip', '合并', '导入', '导出', 'contact'],
    icon: ContactRound,
  },
  {
    id: 'templates',
    label: '模板',
    description: '写信模板、变量与常用模板',
    keywords: ['模板', '写信', '变量', '常用', '分类', '标签', 'template'],
    icon: LayoutTemplate,
  },
  {
    id: 'rules',
    label: '自动化',
    description: '邮件规则与自动处理',
    keywords: ['规则', '自动化', '过滤', '标签', '发件人', '主题', 'rule'],
    icon: Workflow,
  },
];

const nestedSettingsParents = new Map<SettingsSectionId, SettingsSectionId>([
  ...settingsAccountDetailItems.map((item) => [item.id, 'accounts'] as const),
  ...settingsToolDetailItems.map((item) => [item.id, 'tools'] as const),
]);

export function resolveSettingsNavigationSectionId(section: SettingsSectionId): SettingsSectionId {
  return nestedSettingsParents.get(section) ?? section;
}

export const settingsNavigationGroups: SettingsNavigationGroup[] = [
  {
    label: '偏好',
    items: [
      {
        id: 'general',
        label: '通用',
        description: '界面、发送与通知偏好。',
        keywords: ['通用', '外观', '主题', '发送', '通知', 'general', 'appearance'],
        icon: Settings2,
      },
      {
        id: 'accounts',
        label: '邮箱账号',
        description: '添加、切换与管理邮箱账号。',
        keywords: ['账号', '邮箱', '添加账号', '切换账号', 'account'],
        icon: UserRound,
      },
    ],
  },
  {
    label: '智能与集成',
    items: [
      {
        id: 'ai',
        label: 'AI 接入',
        description: 'AI 服务、模型与隐私授权。',
        keywords: ['ai', '人工智能', '翻译', '摘要', 'api', 'openai', '模型', 'key', '接入'],
        icon: Sparkles,
      },
      {
        id: 'mcp',
        label: 'MCP',
        description: 'MCP 服务端点、访问 Token 与工具连接。',
        keywords: ['mcp', '工具', 'json-rpc', '端点', 'token', '连接'],
        icon: PlugZap,
      },
    ],
  },
  {
    label: '工具与数据',
    items: [
      {
        id: 'tools',
        label: '效率工具',
        description: '联系人、模板与自动化。',
        keywords: ['工具', '联系人', '模板', '自动化', 'tools'],
        icon: Workflow,
      },
      {
        id: 'backup',
        label: '数据与存储',
        description: '存储、缓存、下载位置与备份恢复。',
        keywords: ['数据', '存储', '缓存', '下载', '附件', '备份', '恢复', '导入', '导出', 'backup', 'storage'],
        icon: HardDrive,
      },
    ],
  },
  {
    label: '支持',
    items: [
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
  { label: '界面外观', path: '偏好 › 通用', section: 'general', target: 'appearance', keywords: ['主题', '系统', '亮色', '暗色', 'theme'] },
  { label: '撤销发送', path: '偏好 › 通用', section: 'general', target: 'sending', keywords: ['发送延迟', '撤回', 'undo', '5秒', '10秒'] },
  { label: '只提醒 VIP', path: '偏好 › 通用', section: 'general', target: 'notifications', keywords: ['vip', '只提醒', '重点联系人'] },
  { label: '免打扰时段', path: '偏好 › 通用', section: 'general', target: 'notifications', keywords: ['免打扰', '静音', '时间', 'dnd'] },
  { label: '账号通知优先级', path: '偏好 › 通用 › 通知', section: 'general', target: 'notification-account-rules', keywords: ['重点账号', '静音账号', '优先提醒'] },
  { label: 'VIP 发件人', path: '偏好 › 通用 › 通知', section: 'general', target: 'notification-vip-rules', keywords: ['发件人', 'vip', '域名'] },
  { label: '邮箱账号', path: '偏好 › 邮箱账号', section: 'accounts', target: 'account-overview', keywords: ['添加账号', '删除账号', '邮箱', 'display name'] },
  { label: '获取新邮件', path: '偏好 › 邮箱账号', section: 'accounts', target: 'account-overview', keywords: ['同步频率', '后台检查', 'sync'] },
  { label: '自动下载附件', path: '偏好 › 邮箱账号', section: 'accounts', target: 'account-overview', keywords: ['附件', '自动下载', 'download'] },
  { label: '跨邮箱发送风险提示', path: '偏好 › 邮箱账号', section: 'accounts', target: 'account-overview', keywords: ['发送提醒', '跨账号', 'risk'] },
  { label: '收信与发信服务器', path: '邮箱账号 › 服务器', section: 'providers', keywords: ['imap', 'pop3', 'smtp', '端口', 'ssl', 'tls'] },
  { label: '登录凭据与授权码', path: '邮箱账号 › 登录与安全', section: 'auth', keywords: ['密码', '授权码', 'oauth', 'token'] },
  { label: '发件身份与标签', path: '邮箱账号 › 发件身份与标签', section: 'identities', keywords: ['签名', '别名', 'reply-to', '回复地址', '显示名'] },
  { label: '同步与文件夹映射', path: '邮箱账号 › 同步', section: 'sync', keywords: ['文件夹', '同步', 'imap folder'] },
  { label: '远程图片与信任列表', path: '邮箱账号 › 隐私', section: 'privacy', keywords: ['图片', '隐私', '信任', '外部发件人'] },
  { label: 'AI 功能', path: '智能与集成 › AI 接入', section: 'ai', target: 'ai', keywords: ['翻译', '摘要', '模板生成', '人工智能'] },
  { label: 'AI 服务与模型', path: '智能与集成 › AI 接入', section: 'ai', target: 'ai-llm-provider', keywords: ['openai', '模型', 'api', 'llm'] },
  { label: 'AI 连接参数', path: '智能与集成 › AI 接入 › 高级连接', section: 'ai', target: 'ai-advanced', keywords: ['endpoint', 'api key', 'token', 'timeout', '端点'] },
  { label: 'MCP 服务', path: '智能与集成 › MCP', section: 'mcp', target: 'mcp', keywords: ['mcp', '工具', 'json-rpc'] },
  { label: 'MCP 连接参数', path: '智能与集成 › MCP › 连接参数', section: 'mcp', target: 'mcp-connection', keywords: ['mcp', 'endpoint', 'token', '端点', '访问密钥'] },
  { label: '联系人与 VIP', path: '效率工具 › 通讯录', section: 'contacts', keywords: ['联系人', '通讯录', '别名', 'vip'] },
  { label: '写信模板', path: '效率工具 › 模板', section: 'templates', keywords: ['模板', '变量', '常用模板'] },
  { label: '邮件自动化规则', path: '效率工具 › 自动化', section: 'rules', keywords: ['规则', '过滤', '自动处理'] },
  { label: '附件缓存与下载位置', path: '工具与数据 › 数据与存储', section: 'backup', keywords: ['缓存', '附件', '下载目录', '存储'] },
  { label: '备份与恢复', path: '工具与数据 › 数据与存储', section: 'backup', keywords: ['备份', '恢复', '导入', '导出'] },
  { label: '版本与更新', path: '支持 › 关于', section: 'about', keywords: ['版本', '更新', 'github', 'license'] },
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
