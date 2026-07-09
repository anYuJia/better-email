export type ProviderAuthType = 'password' | 'oauth2';

export type AccountProviderPreset = {
  id: string;
  label: string;
  provider: string;
  imap_host: string;
  smtp_host: string;
  auth_type: ProviderAuthType;
  hint: string;
};

export type ProviderCompatibility = AccountProviderPreset & {
  setup: string;
  tested_status: 'preset' | 'needs-account';
  limitations: string;
};

export const providerCompatibilityMatrix: ProviderCompatibility[] = [
  {
    id: 'gmail',
    label: 'Gmail',
    provider: 'gmail',
    imap_host: 'imap.gmail.com:993',
    smtp_host: 'smtp.gmail.com:587',
    auth_type: 'oauth2',
    hint: '推荐 OAuth2；也可临时使用应用专用密码。',
    setup: '开启 IMAP，生产版应使用 OAuth2 PKCE；临时测试可用应用专用密码。',
    tested_status: 'needs-account',
    limitations: 'OAuth2 本地回调、token 自动刷新和 XOAUTH2 已接入；仍需真实账号验证。',
  },
  {
    id: 'outlook',
    label: 'Outlook',
    provider: 'outlook',
    imap_host: 'outlook.office365.com:993',
    smtp_host: 'smtp.office365.com:587',
    auth_type: 'oauth2',
    hint: '企业/个人 Microsoft 账号后续走 OAuth2 更稳。',
    setup: 'Microsoft 个人/企业账号推荐 OAuth2，企业租户可能要求管理员同意。',
    tested_status: 'needs-account',
    limitations: '部分企业租户禁用基础 IMAP/SMTP，需要 Graph 或 OAuth2 范围验证。',
  },
  {
    id: 'qq',
    label: 'QQ 邮箱',
    provider: 'qq',
    imap_host: 'imap.qq.com:993',
    smtp_host: 'smtp.qq.com:587',
    auth_type: 'password',
    hint: '需先在邮箱设置中开启 IMAP/SMTP 并使用授权码。',
    setup: '邮箱设置中开启 IMAP/SMTP，使用客户端授权码写入系统 Keychain。',
    tested_status: 'needs-account',
    limitations: '授权码和风控策略依赖账号安全状态，需逐账号验证。',
  },
  {
    id: 'netease',
    label: '网易 163',
    provider: 'netease',
    imap_host: 'imap.163.com:993',
    smtp_host: 'smtp.163.com:465',
    auth_type: 'password',
    hint: '通常需要客户端授权码，465 端口使用 TLS。',
    setup: '开启 IMAP/SMTP 服务，使用客户端授权码；SMTP 465 使用隐式 TLS。',
    tested_status: 'needs-account',
    limitations: '不同网易邮箱产品端口和授权码策略可能不同，需真实账号验证。',
  },
];

export const providerPresets: AccountProviderPreset[] = providerCompatibilityMatrix.map(
  ({ id, label, provider, imap_host, smtp_host, auth_type, hint }) => ({
    id,
    label,
    provider,
    imap_host,
    smtp_host,
    auth_type,
    hint,
  }),
);
