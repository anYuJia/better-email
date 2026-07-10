import { describe, expect, it } from 'vitest';
import type { CredentialVerificationReport } from '../app/types';
import {
  credentialVerificationPatch,
  providerVerificationKey,
  providerVerificationRecordFor,
} from './useAccountConnectionController';

describe('account connection controller helpers', () => {
  it('normalizes known and empty provider keys', () => {
    expect(providerVerificationKey(' Gmail ')).toBe('gmail');
    expect(providerVerificationKey('')).toBe('custom');
  });

  it('creates a custom provider verification record for an empty provider', () => {
    expect(providerVerificationRecordFor('', {})).toMatchObject({
      provider_key: 'custom',
      provider_label: 'Custom',
      status: 'untested',
    });
  });

  it('maps partial credential verification without claiming OAuth success', () => {
    const report: CredentialVerificationReport = {
      account_email: 'user@example.com',
      authenticated: false,
      status: 'partial',
      checked_at: '2026-07-10T10:00:00.000Z',
      message: 'IMAP authenticated, SMTP failed',
      checks: [
        {
          name: 'IMAP',
          address: 'imap.example.com:993',
          authenticated: true,
          message: 'ok',
        },
        {
          name: 'SMTP',
          address: 'smtp.example.com:465',
          authenticated: false,
          message: 'failed',
        },
      ],
    };

    expect(credentialVerificationPatch(report, 'password')).toEqual({
      status: 'partial',
      imap_ok: true,
      smtp_ok: false,
      checked_at: report.checked_at,
    });
  });
});
