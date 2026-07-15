import type { Account } from './types';

export type ProviderCredentialGuidance = {
  providerId: string;
  providerLabel: string;
  credentialLabel: string;
  title: string;
  summary: string;
  placeholder: string;
  checklist: string[];
  verificationHint: string;
};

type GuidanceAccount = Pick<Account, 'provider' | 'auth_type'>;

const passwordGuidance: Record<string, Omit<ProviderCredentialGuidance, 'providerId'>> = {
  netease: {
    providerLabel: '网易 163',
    credentialLabel: '客户端授权码',
    title: '使用客户端授权码，不是网页登录密码',
    summary: '先在网易邮箱开启 IMAP/SMTP 服务，再把新生成的授权码保存到本机本地凭据。',
    placeholder: '粘贴新生成的客户端授权码',
    checklist: ['仅保存在本地凭据', '保存后立即清空输入框', '验证只登录，不发送邮件'],
    verificationHint: '若 IMAP 与 SMTP 同时拒绝，请撤销旧授权码并重新生成，不要反复尝试网页登录密码。',
  },
  qq: {
    providerLabel: 'QQ 邮箱',
    credentialLabel: '客户端授权码',
    title: '使用独立授权码连接第三方客户端',
    summary: '先在 QQ 邮箱设置中开启 IMAP/SMTP，再保存当前账号生成的客户端授权码。',
    placeholder: '粘贴 QQ 邮箱客户端授权码',
    checklist: ['仅保存在本地凭据', '保存后立即清空输入框', '验证只登录，不发送邮件'],
    verificationHint: '授权码失效或账号触发风控时，请在 QQ 邮箱安全设置中重新生成。',
  },
};

export function buildProviderCredentialGuidance(
  account: GuidanceAccount,
): ProviderCredentialGuidance {
  const providerId = account.provider.trim().toLowerCase() || 'custom';
  if (account.auth_type.trim().toLowerCase() === 'oauth2') {
    const providerLabel = providerId === 'gmail'
      ? 'Gmail'
      : providerId === 'outlook'
        ? 'Outlook'
        : 'OAuth2 邮箱';
    return {
      providerId,
      providerLabel,
      credentialLabel: 'OAuth2 Token',
      title: '优先通过 OAuth2 授权流程写入 Token',
      summary: 'Token 仅写入本机本地凭据，诊断导出和日志不显示完整 Token。',
      placeholder: '粘贴 OAuth2 Token JSON',
      checklist: ['仅保存在本地凭据', '保存后立即清空输入框', '验证使用 XOAUTH2 登录'],
      verificationHint: 'Token 失效时应重新完成 OAuth2 授权，不要在这里输入邮箱网页登录密码。',
    };
  }

  const preset = passwordGuidance[providerId];
  if (preset) {
    return { providerId, ...preset };
  }

  return {
    providerId,
    providerLabel: '自定义邮箱',
    credentialLabel: '应用专用密码 / 授权码',
    title: '使用服务商允许的第三方客户端凭据',
    summary: '优先使用应用专用密码或授权码，避免直接保存主账号密码。',
    placeholder: '粘贴应用专用密码或授权码',
    checklist: ['仅保存在本地凭据', '保存后立即清空输入框', '验证只登录，不发送邮件'],
    verificationHint: '若服务商禁用基础认证，请改用 OAuth2 或确认管理员已开放 IMAP/SMTP。',
  };
}
