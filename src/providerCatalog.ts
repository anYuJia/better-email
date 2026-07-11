import type { IncomingProtocol } from './app/types';

export type ProviderAuthType = 'password' | 'oauth2';

export type AccountProviderPreset = {
  id: string;
  label: string;
  provider: string;
  domains: string[];
  imap_host: string;
  pop3_host: string;
  smtp_host: string;
  incoming_protocol: IncomingProtocol;
  auth_type: ProviderAuthType;
  hint: string;
};

export type ProviderCompatibility = AccountProviderPreset & {
  setup: string;
  tested_status: 'preset' | 'needs-account' | 'verified';
  limitations: string;
};

export const providerCompatibilityMatrix: ProviderCompatibility[] = [
  {
    id: 'gmail',
    label: 'Gmail',
    provider: 'gmail',
    domains: ['gmail.com', 'googlemail.com'],
    imap_host: 'imap.gmail.com:993',
    pop3_host: 'pop.gmail.com:995',
    smtp_host: 'smtp.gmail.com:587',
    incoming_protocol: 'imap',
    auth_type: 'oauth2',
    hint: 'OAuth2 或应用专用密码。',
    setup: '开启 IMAP/POP 与 SMTP；POP3 使用应用专用密码。',
    tested_status: 'needs-account',
    limitations: 'OAuth2 用于 IMAP/SMTP；POP3 走授权码或应用专用密码。',
  },
  {
    id: 'outlook',
    label: 'Outlook',
    provider: 'outlook',
    domains: ['outlook.com', 'hotmail.com', 'live.com', 'msn.com'],
    imap_host: 'outlook.office365.com:993',
    pop3_host: 'outlook.office365.com:995',
    smtp_host: 'smtp.office365.com:587',
    incoming_protocol: 'imap',
    auth_type: 'oauth2',
    hint: 'OAuth2 或租户允许的授权方式。',
    setup: 'Microsoft 个人/企业账号推荐 OAuth2；POP3 需租户允许。',
    tested_status: 'needs-account',
    limitations: '部分企业租户禁用基础 IMAP/POP3/SMTP，需要管理员开放。',
  },
  {
    id: 'qq',
    label: 'QQ 邮箱',
    provider: 'qq',
    domains: ['qq.com', 'vip.qq.com', 'foxmail.com'],
    imap_host: 'imap.qq.com:993',
    pop3_host: 'pop.qq.com:995',
    smtp_host: 'smtp.qq.com:587',
    incoming_protocol: 'imap',
    auth_type: 'password',
    hint: '开启服务后使用授权码。',
    setup: '邮箱设置中开启 IMAP/POP3/SMTP，使用客户端授权码。',
    tested_status: 'needs-account',
    limitations: '授权码和风控策略依赖账号安全状态，需逐账号验证。',
  },
  {
    id: 'netease',
    label: '网易 163',
    provider: 'netease',
    domains: ['163.com', '126.com', 'yeah.net'],
    imap_host: 'imap.163.com:993',
    pop3_host: 'pop.163.com:995',
    smtp_host: 'smtp.163.com:465',
    incoming_protocol: 'imap',
    auth_type: 'password',
    hint: '使用客户端授权码。',
    setup: '开启 IMAP/POP3/SMTP 服务，使用客户端授权码；SMTP 465 使用隐式 TLS。',
    tested_status: 'verified',
    limitations: 'IMAP/POP3 收信与 SMTP 发信需要分别开启服务商开关。',
  },
];

export const providerPresets: AccountProviderPreset[] = providerCompatibilityMatrix.map(
  ({ id, label, provider, domains, imap_host, pop3_host, smtp_host, incoming_protocol, auth_type, hint }) => ({
    id,
    label,
    provider,
    domains,
    imap_host,
    pop3_host,
    smtp_host,
    incoming_protocol,
    auth_type,
    hint,
  }),
);

export function incomingHostForProtocol(
  preset: AccountProviderPreset,
  protocol: IncomingProtocol,
): string {
  return protocol === 'pop3' ? preset.pop3_host : preset.imap_host;
}

export function providerPresetForEmail(email: string): AccountProviderPreset | null {
  const domain = email.trim().toLowerCase().split('@').pop() ?? '';
  if (!domain || domain === email.trim().toLowerCase()) return null;
  return providerPresets.find((preset) => preset.domains.includes(domain)) ?? null;
}
