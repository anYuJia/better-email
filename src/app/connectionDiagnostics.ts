import type {
  Account,
  ConnectionReport,
  CredentialStatus,
  CredentialVerificationReport,
} from './types';

export type ConnectionDiagnosticState = 'pending' | 'success' | 'warning' | 'error';

export type ConnectionDiagnosticStep = {
  id: 'network' | 'credential' | 'incoming' | 'smtp';
  label: string;
  state: ConnectionDiagnosticState;
  detail: string;
};

export type ConnectionDiagnosticModel = {
  state: ConnectionDiagnosticState;
  title: string;
  summary: string;
  providerLabel: string;
  steps: ConnectionDiagnosticStep[];
  recommendations: string[];
};

type ConnectionDiagnosticInput = {
  account: Account;
  credentialStatus: CredentialStatus | null;
  connectionReport: ConnectionReport | null;
  credentialVerification: CredentialVerificationReport | null;
};

type ProviderKey = 'gmail' | 'outlook' | 'qq' | 'netease' | 'custom';

function providerKey(account: Account): ProviderKey {
  const value = [
    account.provider,
    account.email.split('@')[1] ?? '',
    account.imap_host,
    account.smtp_host,
  ].join(' ').toLowerCase();
  if (value.includes('gmail') || value.includes('google')) return 'gmail';
  if (value.includes('outlook') || value.includes('office365') || value.includes('microsoft')) {
    return 'outlook';
  }
  if (value.includes('qq.com') || value.includes('imap.qq') || value.includes(' qq')) return 'qq';
  if (value.includes('163.com') || value.includes('imap.163') || value.includes('netease')) {
    return 'netease';
  }
  return 'custom';
}

function incomingProtocolLabel(account: Account) {
  return account.incoming_protocol === 'pop3' ? 'POP3' : 'IMAP';
}

function providerLabel(key: ProviderKey, account: Account) {
  if (key === 'gmail') return 'Gmail';
  if (key === 'outlook') return 'Outlook';
  if (key === 'qq') return 'QQ 邮箱';
  if (key === 'netease') return '网易 163';
  return account.provider.trim() || '自定义邮箱';
}

function providerCredentialRecommendations(key: ProviderKey, authType: string): string[] {
  if (authType === 'oauth2') {
    return [
      '重新完成 OAuth2 授权，并确认授权页使用的是当前邮箱账号。',
      '检查收信、SMTP 或离线访问范围是否已获得授权，然后刷新 Token。',
    ];
  }
  if (key === 'netease') {
    return [
      '确认网页版邮箱已开启收信和 SMTP 服务，登录时使用客户端授权码，不使用网页登录密码。',
      '重新生成授权码后等待几分钟再验证，并使用完整邮箱地址作为登录账号。',
      '撤销曾在聊天、截图或日志中暴露的旧授权码，只在本机系统凭据库中保存新码。',
    ];
  }
  if (key === 'qq') {
    return [
      '确认 QQ 邮箱设置中已开启收信和 SMTP，并使用客户端授权码而不是 QQ 密码。',
      '使用完整邮箱地址登录；若触发账号风控，请重新生成授权码后再验证。',
    ];
  }
  if (key === 'gmail') {
    return [
      '推荐切换到 OAuth2；若使用密码模式，需要启用两步验证并创建应用专用密码。',
      '确认账号未阻止第三方邮件客户端登录。',
    ];
  }
  if (key === 'outlook') {
    return [
      '推荐切换到 OAuth2；企业租户可能需要管理员允许收信、SMTP AUTH 与相关授权范围。',
      '确认当前租户没有禁用 SMTP AUTH。',
    ];
  }
  return [
    '确认服务商已开启收信和 SMTP，并核对登录账号格式与应用专用密码要求。',
    '检查服务器地址、端口和 TLS 模式是否与服务商文档一致。',
  ];
}

function reportForAccount<T extends { account_email: string }>(
  report: T | null,
  account: Account,
): T | null {
  return report?.account_email.trim().toLowerCase() === account.email.trim().toLowerCase()
    ? report
    : null;
}

export function buildConnectionDiagnosticModel({
  account,
  credentialStatus,
  connectionReport,
  credentialVerification,
}: ConnectionDiagnosticInput): ConnectionDiagnosticModel {
  const key = providerKey(account);
  const network = reportForAccount(connectionReport, account);
  const verification = reportForAccount(credentialVerification, account);
  const storedCredential = credentialStatus?.account_email.trim().toLowerCase()
    === account.email.trim().toLowerCase()
    ? credentialStatus
    : null;
  const incomingLabel = incomingProtocolLabel(account);
  const incoming = verification?.checks.find((check) => {
    const name = check.name.toLowerCase();
    return name.includes('imap') || name.includes('pop3');
  }) ?? null;
  const smtp = verification?.checks.find((check) => check.name.toLowerCase().includes('smtp')) ?? null;
  const reachableCount = network?.endpoints.filter((endpoint) => endpoint.reachable).length ?? 0;
  const verificationReachedServers = Boolean(
    verification
    && (
      verification.authenticated
      || verification.status === 'partial'
      || verification.status === 'credential_error'
    ),
  );
  const networkState: ConnectionDiagnosticState = !network
    ? verificationReachedServers
      ? 'success'
      : verification
        ? 'warning'
        : 'pending'
    : network.ready_for_credentials
      ? 'success'
      : reachableCount > 0
        ? 'warning'
        : 'error';
  const credentialState: ConnectionDiagnosticState = verification
    ? verification.status === 'credential_error'
      ? 'error'
      : 'success'
    : !storedCredential
      ? 'pending'
      : storedCredential.exists
        ? 'success'
        : 'warning';
  const protocolState = (
    check: typeof incoming,
  ): ConnectionDiagnosticState => !check ? 'pending' : check.authenticated ? 'success' : 'error';

  const steps: ConnectionDiagnosticStep[] = [
    {
      id: 'network',
      label: '服务器连接',
      state: networkState,
      detail: !network
        ? verificationReachedServers
          ? '登录验证已收到服务器响应，可确认协议端点可达。'
          : verification
            ? '登录验证未确认全部端点，请单独运行服务器测试。'
            : `运行服务器测试，确认 ${incomingLabel} 与 SMTP 地址可达。`
        : network.ready_for_credentials
          ? `${network.endpoints.length} 个端点均可连接。`
          : `${reachableCount}/${network.endpoints.length} 个端点可连接，请检查失败地址。`,
    },
    {
      id: 'credential',
      label: '系统凭据',
      state: credentialState,
      detail: verification?.status === 'credential_error'
        ? '系统凭据可读取，但服务端拒绝了当前授权信息。'
        : verification
          ? '登录验证已读取系统凭据，未向界面返回敏感内容。'
          : !storedCredential
            ? '尚未检查系统凭据库。'
            : storedCredential.exists
              ? '授权信息已保存在系统安全存储中。'
              : '当前账号没有可用凭据，请先保存授权码或 Token。',
    },
    {
      id: 'incoming',
      label: `${incomingLabel} 登录`,
      state: protocolState(incoming),
      detail: incoming
        ? incoming.authenticated ? '登录成功，可以同步邮件。' : '服务器可连接，但账号认证未通过。'
        : '保存凭据后运行登录验证。',
    },
    {
      id: 'smtp',
      label: 'SMTP 登录',
      state: protocolState(smtp),
      detail: smtp
        ? smtp.authenticated ? '登录成功，可以进入发送验证流程。' : '服务器可连接，但账号认证未通过。'
        : '保存凭据后运行登录验证，验证过程不会发送邮件。',
    },
  ];

  const recommendations: string[] = [];
  if (networkState === 'error' || networkState === 'warning') {
    recommendations.push(`先核对 ${incomingLabel}/SMTP 主机、端口与 TLS 模式，再检查防火墙或代理设置。`);
  }
  if (credentialState !== 'success') {
    recommendations.push(
      account.auth_type === 'oauth2'
        ? '完成 OAuth2 授权并保存 Token 后，再运行登录验证。'
        : '将新生成的应用专用密码或授权码保存到系统凭据库。',
    );
  }
  if (verification?.authenticated) {
    recommendations.push('认证已完成，下一步发现远端文件夹并执行一次邮件头同步。');
  } else if (verification?.status === 'partial') {
    recommendations.push('一个协议已通过；重点检查失败协议的服务器地址、端口和服务商开关。');
  } else if (verification && !verification.authenticated) {
    recommendations.push(...providerCredentialRecommendations(key, account.auth_type));
  }
  if (recommendations.length === 0) {
    recommendations.push('按顺序完成服务器测试、保存凭据和登录验证。');
  }

  let state: ConnectionDiagnosticState = 'pending';
  let title = '等待连接验证';
  let summary = `按四个步骤完成 ${providerLabel(key, account)} 账号接入。`;
  if (verification?.authenticated) {
    state = 'success';
    title = '账号连接已就绪';
    summary = `${incomingLabel} 与 SMTP 均已认证，可继续同步邮件。`;
  } else if (verification?.status === 'partial') {
    state = 'warning';
    title = '账号仅部分可用';
    summary = '一个协议登录成功，另一个仍需修复。';
  } else if (verification) {
    state = 'error';
    title = verification.status === 'credential_error' ? '授权信息不可用' : '账号登录未通过';
    summary = network?.ready_for_credentials
      ? '服务器可达，问题集中在授权码、Token 或账号安全策略。'
      : '先修复服务器连接，再重新验证账号授权。';
  } else if (network?.ready_for_credentials && storedCredential?.exists) {
    state = 'warning';
    title = '可以开始登录验证';
    summary = '服务器和系统凭据已准备好，验证过程不会发送邮件。';
  }

  return {
    state,
    title,
    summary,
    providerLabel: providerLabel(key, account),
    steps,
    recommendations,
  };
}
