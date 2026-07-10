import { describe, expect, it, vi } from 'vitest';
import { runProviderValidation } from './providerValidation';
import type {
  ConnectionReport,
  CredentialVerificationReport,
  ImapProbeReport,
  SyncRun,
} from './types';

const connection: ConnectionReport = {
  account_email: 'reader@example.com',
  checked_at: '2026-07-10T13:00:00Z',
  ready_for_credentials: true,
  endpoints: [
    { name: 'IMAP', address: 'imap.example.com:993', reachable: true, latency_ms: 12, message: 'ok' },
    { name: 'SMTP', address: 'smtp.example.com:465', reachable: true, latency_ms: 14, message: 'ok' },
  ],
};

const credentials: CredentialVerificationReport = {
  account_email: connection.account_email,
  checked_at: '2026-07-10T13:01:00Z',
  authenticated: true,
  status: 'ok',
  message: 'authenticated',
  checks: [
    { name: 'IMAP', address: connection.endpoints[0].address, authenticated: true, message: 'ok' },
    { name: 'SMTP', address: connection.endpoints[1].address, authenticated: true, message: 'ok' },
  ],
};

const folders: ImapProbeReport = {
  account_email: connection.account_email,
  checked_at: '2026-07-10T13:02:00Z',
  folder_count: 4,
  folders: [
    { name: 'INBOX', delimiter: '/', attributes: ['Inbox'] },
    { name: 'Sent', delimiter: '/', attributes: ['Sent'] },
    { name: 'Drafts', delimiter: '/', attributes: ['Drafts'] },
    { name: 'Trash', delimiter: '/', attributes: ['Trash'] },
  ],
  status: 'ok',
  message: 'folders found',
};

const sync: SyncRun = {
  id: 1,
  started_at: '2026-07-10T13:03:00Z',
  finished_at: '2026-07-10T13:03:01Z',
  status: 'imap_headers_account',
  scanned_folders: 4,
  imported_messages: 2,
  message: 'sync complete',
};

describe('runProviderValidation', () => {
  it('completes all read-only stages without sending mail', async () => {
    const updates: string[] = [];
    const report = await runProviderValidation(connection.account_email, {
      testConnection: vi.fn().mockResolvedValue(connection),
      verifyCredentials: vi.fn().mockResolvedValue(credentials),
      discoverFolders: vi.fn().mockResolvedValue(folders),
      syncHeaders: vi.fn().mockResolvedValue(sync),
      onUpdate: (next) => updates.push(next.stages.map((stage) => stage.state).join(',')),
      now: () => '2026-07-10T13:04:00Z',
    });

    expect(report.status).toBe('success');
    expect(report.stages.every((stage) => stage.state === 'success')).toBe(true);
    expect(report.summary).toContain('未发送邮件或修改远端邮件状态');
    expect(updates.some((update) => update.includes('running'))).toBe(true);
  });

  it('stops after a failed connection and skips remote login work', async () => {
    const verifyCredentials = vi.fn();
    const discoverFolders = vi.fn();
    const syncHeaders = vi.fn();
    const report = await runProviderValidation(connection.account_email, {
      testConnection: vi.fn().mockResolvedValue({
        ...connection,
        ready_for_credentials: false,
        endpoints: connection.endpoints.map((endpoint) => ({ ...endpoint, reachable: false })),
      }),
      verifyCredentials,
      discoverFolders,
      syncHeaders,
    });

    expect(report.status).toBe('error');
    expect(report.stages.map((stage) => stage.state)).toEqual([
      'error',
      'skipped',
      'skipped',
      'skipped',
    ]);
    expect(verifyCredentials).not.toHaveBeenCalled();
    expect(discoverFolders).not.toHaveBeenCalled();
    expect(syncHeaders).not.toHaveBeenCalled();
  });

  it('continues read-only IMAP checks when only SMTP authentication fails', async () => {
    const discoverFolders = vi.fn().mockResolvedValue(folders);
    const syncHeaders = vi.fn().mockResolvedValue(sync);
    const report = await runProviderValidation(connection.account_email, {
      testConnection: vi.fn().mockResolvedValue(connection),
      verifyCredentials: vi.fn().mockResolvedValue({
        ...credentials,
        authenticated: false,
        status: 'partial',
        message: 'IMAP passed, SMTP failed',
        checks: [
          credentials.checks[0],
          { ...credentials.checks[1], authenticated: false, message: 'failed' },
        ],
      }),
      discoverFolders,
      syncHeaders,
    });

    expect(report.status).toBe('warning');
    expect(report.stages.map((stage) => stage.state)).toEqual([
      'success',
      'warning',
      'success',
      'success',
    ]);
    expect(discoverFolders).toHaveBeenCalledOnce();
    expect(syncHeaders).toHaveBeenCalledOnce();
    expect(report.summary).toContain('收信链路');
  });

  it('stops when SMTP works but IMAP authentication fails', async () => {
    const discoverFolders = vi.fn();
    const syncHeaders = vi.fn();
    const report = await runProviderValidation(connection.account_email, {
      testConnection: vi.fn().mockResolvedValue(connection),
      verifyCredentials: vi.fn().mockResolvedValue({
        ...credentials,
        authenticated: false,
        status: 'partial',
        message: 'SMTP passed, IMAP failed',
        checks: [
          { ...credentials.checks[0], authenticated: false, message: 'failed' },
          credentials.checks[1],
        ],
      }),
      discoverFolders,
      syncHeaders,
    });

    expect(report.status).toBe('warning');
    expect(report.stages.map((stage) => stage.state)).toEqual([
      'success',
      'warning',
      'skipped',
      'skipped',
    ]);
    expect(discoverFolders).not.toHaveBeenCalled();
    expect(syncHeaders).not.toHaveBeenCalled();
  });
});
