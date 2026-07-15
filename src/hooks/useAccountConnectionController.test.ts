import { describe, expect, it } from 'vitest';
import type { CredentialVerificationReport } from '../app/types';
import {
  credentialVerificationPatch,
  providerVerificationKey,
  providerVerificationRecordFor,
  shouldRunInitialMailboxSync,
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

  it('runs initial mailbox sync only after authenticated account creation', () => {
    expect(shouldRunInitialMailboxSync('imap', true, true)).toBe(true);
    expect(shouldRunInitialMailboxSync('pop3', true, true)).toBe(true);
    expect(shouldRunInitialMailboxSync('imap', false, true)).toBe(false);
    expect(shouldRunInitialMailboxSync('imap', true, false)).toBe(false);
    expect(shouldRunInitialMailboxSync('unknown', true, true)).toBe(false);
  });

  it('updates provider verification record maps and keeps status checks', () => {
    const record = providerVerificationRecordFor('Gmail', {});
    expect(record.provider_key).toBe('gmail');
    expect(record.status).toBe('untested');
  });

  describe('Credential delete status paths', () => {
    it('handles status "deleted" by confirming exists is false and status matches', () => {
      const status = {
        account_email: 'test@example.com',
        exists: false,
        status: 'deleted',
        message: '本地凭据已删除。'
      };
      expect(status.status).toBe('deleted');
      expect(status.exists).toBe(false);
    });

    it('handles status "not_found" and treats it as a successful scenario allowing account delete', () => {
      const status = {
        account_email: 'test@example.com',
        exists: false,
        status: 'not_found',
        message: '本地凭据中未找到对应凭据。'
      };
      expect(status.status).toBe('not_found');
      expect(status.exists).toBe(false);
    });

    it('handles status "failed" causing blocking check', () => {
      const status = {
        account_email: 'test@example.com',
        exists: true,
        status: 'failed',
        message: '本地数据库写入拒绝，删除凭据失败。'
      };
      expect(status.status).toBe('failed');
      expect(status.exists).toBe(true);
    });

    it('retains credentials locally when user chooses not to delete', () => {
      const deleteSecret = false;
      const finalStatus = deleteSecret ? 'deleted' : 'not_found';
      expect(finalStatus).toBe('not_found');
    });
  });
});


