import type {
  CredentialVerificationReport,
  ProviderVerificationRecord,
} from './types';
import { providerCompatibilityMatrix } from '../providerCatalog';

export function maskEmailForLog(value: string) {
  const email = value.trim();
  const [local, domain] = email.split('@');
  if (!local || !domain) return email ? '***' : '';
  return `${local[0] ?? '*'}***@${domain}`;
}

export interface DeleteFlowResult {
  allowed: boolean;
  credentialStatus: {
    account_email: string;
    exists: boolean;
    status: 'deleted' | 'not_found' | 'failed' | 'invalid_input' | 'exists';
    message: string;
  };
}

export function handleAccountDeleteFlow(
  email: string,
  deleteSecret: boolean,
  backendResult: { status: 'deleted' | 'not_found' | 'failed' | 'invalid_input'; message?: string } | null
): DeleteFlowResult {
  if (!deleteSecret) {
    return {
      allowed: true,
      credentialStatus: {
        account_email: email,
        exists: true,
        status: 'exists',
        message: '账号已成功移除；本地凭据已保留。'
      }
    };
  }

  if (!backendResult) {
    return {
      allowed: false,
      credentialStatus: {
        account_email: email,
        exists: true,
        status: 'failed',
        message: '本地凭据删除失败：未收到有效的后台响应'
      }
    };
  }

  if (backendResult.status === 'deleted') {
    return {
      allowed: true,
      credentialStatus: {
        account_email: email,
        exists: false,
        status: 'deleted',
        message: backendResult.message || '账号及本地凭据已成功移除。'
      }
    };
  }

  if (backendResult.status === 'not_found') {
    return {
      allowed: true,
      credentialStatus: {
        account_email: email,
        exists: false,
        status: 'not_found',
        message: backendResult.message || '账号已移除；本地数据库未找到对应凭据。'
      }
    };
  }

  if (backendResult.status === 'invalid_input') {
    return {
      allowed: false,
      credentialStatus: {
        account_email: email,
        exists: true,
        status: 'invalid_input',
        message: backendResult.message || '输入无效，操作被阻止。'
      }
    };
  }

  return {
    allowed: false,
    credentialStatus: {
      account_email: email,
      exists: true,
      status: 'failed',
      message: backendResult.message || '本地凭据删除失败，操作被阻止。'
    }
  };
}

export function providerVerificationKey(providerName: string): string {
  const normalized = providerName.trim().toLowerCase();
  if (!normalized) return 'custom';
  return providerCompatibilityMatrix.find((provider) => provider.provider === normalized)?.id ?? normalized;
}

export function providerVerificationRecordFor(
  providerName: string,
  records: Record<string, ProviderVerificationRecord>,
): ProviderVerificationRecord {
  const key = providerVerificationKey(providerName);
  const normalized = providerName.trim().toLowerCase();
  const catalogEntry = providerCompatibilityMatrix.find(
    (provider) => provider.id === key || provider.provider === normalized,
  );
  return (
    records[key] ?? {
      provider_key: key,
      provider_label: catalogEntry?.label ?? (providerName.trim() || 'Custom'),
      status: 'untested',
      imap_ok: false,
      smtp_ok: false,
      oauth_ok: false,
      diagnostic_exported: false,
      checked_at: '',
      notes: '',
    }
  );
}

export function credentialVerificationPatch(
  report: CredentialVerificationReport,
  authType: string,
): Partial<ProviderVerificationRecord> {
  const imapOk = report.checks.some((check) => {
    const name = check.name.toLowerCase();
    return (name.includes('imap') || name.includes('pop3')) && check.authenticated;
  });
  const smtpOk = report.checks.some((check) => check.name === 'SMTP' && check.authenticated);
  return {
    status: report.authenticated ? 'passed' : imapOk || smtpOk ? 'partial' : 'failed',
    imap_ok: imapOk,
    smtp_ok: smtpOk,
    checked_at: report.checked_at,
    ...(authType === 'oauth2' ? { oauth_ok: report.authenticated } : {}),
  };
}

export function shouldRunInitialMailboxSync(
  incomingProtocol: string,
  hasSecret: boolean,
  authenticated: boolean,
): boolean {
  if (!hasSecret || !authenticated) return false;
  return ['imap', 'pop3'].includes(incomingProtocol.trim().toLowerCase());
}
