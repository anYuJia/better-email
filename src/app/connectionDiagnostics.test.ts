import { describe, expect, it } from 'vitest';
import { buildConnectionDiagnosticModel } from './connectionDiagnostics';
import type {
  Account,
  ConnectionReport,
  CredentialStatus,
  CredentialVerificationReport,
} from './types';

const account: Account = {
  id: 1,
  email: 'reader@163.com',
  display_name: 'Reader',
  provider: 'netease',
  imap_host: 'imap.163.com:993',
  smtp_host: 'smtp.163.com:465',
  auth_type: 'password',
  sync_mode: 'manual',
  remote_images_allowed: false,
  signature: '',
  is_default: true,
};

const credentialStatus: CredentialStatus = {
  account_email: account.email,
  exists: true,
  message: 'credential stored',
};

const connectionReport: ConnectionReport = {
  account_email: account.email,
  checked_at: '2026-07-10T12:00:00Z',
  ready_for_credentials: true,
  endpoints: [
    {
      name: 'IMAP',
      address: account.imap_host,
      reachable: true,
      latency_ms: 20,
      message: 'reachable',
    },
    {
      name: 'SMTP',
      address: account.smtp_host,
      reachable: true,
      latency_ms: 22,
      message: 'reachable',
    },
  ],
};

function verification(
  status: CredentialVerificationReport['status'],
  imapAuthenticated: boolean,
  smtpAuthenticated: boolean,
): CredentialVerificationReport {
  return {
    account_email: account.email,
    checked_at: '2026-07-10T12:01:00Z',
    authenticated: imapAuthenticated && smtpAuthenticated,
    status,
    message: 'verification completed',
    checks: [
      {
        name: 'IMAP',
        address: account.imap_host,
        authenticated: imapAuthenticated,
        message: imapAuthenticated ? 'ok' : 'login failed',
      },
      {
        name: 'SMTP',
        address: account.smtp_host,
        authenticated: smtpAuthenticated,
        message: smtpAuthenticated ? 'ok' : 'authentication failed',
      },
    ],
  };
}

describe('buildConnectionDiagnosticModel', () => {
  it('turns a NetEase credential rejection into actionable recovery guidance', () => {
    const model = buildConnectionDiagnosticModel({
      account,
      credentialStatus,
      connectionReport,
      credentialVerification: verification('credential_error', false, false),
    });

    expect(model.state).toBe('error');
    expect(model.title).toBe('授权信息不可用');
    expect(model.providerLabel).toBe('网易 163');
    expect(model.steps.map((step) => step.state)).toEqual([
      'success',
      'error',
      'error',
      'error',
    ]);
    expect(model.recommendations.join(' ')).toContain('重新生成授权码');
    expect(model.recommendations.join(' ')).toContain('撤销');
  });

  it('explains a partial protocol result without treating the account as ready', () => {
    const model = buildConnectionDiagnosticModel({
      account,
      credentialStatus,
      connectionReport,
      credentialVerification: verification('partial', true, false),
    });

    expect(model.state).toBe('warning');
    expect(model.title).toBe('账号仅部分可用');
    expect(model.steps.find((step) => step.id === 'imap')?.state).toBe('success');
    expect(model.steps.find((step) => step.id === 'smtp')?.state).toBe('error');
    expect(model.recommendations[0]).toContain('失败协议');
  });

  it('directs a fully authenticated account into folder discovery and sync', () => {
    const model = buildConnectionDiagnosticModel({
      account,
      credentialStatus,
      connectionReport: null,
      credentialVerification: verification('ok', true, true),
    });

    expect(model.state).toBe('success');
    expect(model.title).toBe('账号连接已就绪');
    expect(model.steps.every((step) => step.state === 'success')).toBe(true);
    expect(model.recommendations[0]).toContain('发现远端文件夹');
  });
});
