import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatDate,
  newMailNotificationDecision,
  newMailNotificationBody,
  prefixedSubject,
  quoteMessage,
  replyThreadingHeaders,
  remoteImageTrustInput,
  senderDomain,
  syncIntervalMs,
  syncStatusLabel,
} from './mailUtils';
import { providerCompatibilityMatrix, providerPresets } from './providerCatalog';

describe('mail UI utilities', () => {
  it('formats invalid dates without destroying the source value', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });

  it('formats attachment sizes for common mail UI ranges', () => {
    expect(formatBytes(42)).toBe('42 B');
    expect(formatBytes(1536)).toBe('2 KB');
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB');
  });

  it('adds reply and forward prefixes only when needed', () => {
    expect(prefixedSubject('Quarterly update', 'Re')).toBe('Re: Quarterly update');
    expect(prefixedSubject('回复: Quarterly update', 'Re')).toBe('回复: Quarterly update');
    expect(prefixedSubject('Fwd: Quarterly update', 'Fwd')).toBe('Fwd: Quarterly update');
    expect(prefixedSubject('', 'Fwd')).toBe('Fwd: (无主题)');
  });

  it('quotes message bodies for reply and forward drafts', () => {
    const quoted = quoteMessage({
      sender_name: 'Ada',
      sender_email: 'ada@example.com',
      received_at: 'bad-date',
      subject: '',
      body: 'Line one\nLine two',
      snippet: 'Fallback snippet',
    });

    expect(quoted).toContain('发件人：Ada <ada@example.com>');
    expect(quoted).toContain('时间：bad-date');
    expect(quoted).toContain('主题：(无主题)');
    expect(quoted).toContain('> Line one\n> Line two');
  });

  it('builds and deduplicates standards-compatible reply threading headers', () => {
    expect(
      replyThreadingHeaders({
        message_id_header: '<latest@example.com>',
        in_reply_to_header: '<parent@example.com>',
        references_header: '<root@example.com> <parent@example.com>',
      }),
    ).toEqual({
      in_reply_to: '<latest@example.com>',
      references: '<root@example.com> <parent@example.com> <latest@example.com>',
    });
    expect(replyThreadingHeaders({ message_id_header: 'imap-42' })).toBeNull();
  });

  it('maps sync modes to conservative background intervals', () => {
    expect(syncIntervalMs('manual')).toBeNull();
    expect(syncIntervalMs('15min')).toBe(15 * 60 * 1000);
    expect(syncIntervalMs('push')).toBe(5 * 60 * 1000);
  });

  it('summarizes sync runs for background status and notifications', () => {
    const run = {
      imported_messages: 3,
      finished_at: 'not-a-date',
      message: 'IMAP 邮件头同步完成：INBOX 扫描 10 封，新增 3 封。',
    };

    expect(syncStatusLabel(run)).toBe('not-a-date · IMAP 邮件头同步完成：INBOX 扫描 10 封，新增 3 封。');
    expect(newMailNotificationBody(run)).toBe('已同步 3 封新邮件');
    expect(newMailNotificationBody({ ...run, imported_messages: 0 })).toBeNull();
  });

  it('applies quiet hours and VIP notification policy', () => {
    const run = {
      imported_messages: 2,
      finished_at: 'not-a-date',
      message: '同步完成',
    };
    const messages = [
      { sender_name: 'Ada', sender_email: 'ada@example.com', subject: 'Review' },
      { sender_name: 'Grace', sender_email: 'grace@example.com', subject: 'FYI' },
    ];

    expect(
      newMailNotificationDecision(
        run,
        {
          quietHoursEnabled: true,
          quietStart: '22:00',
          quietEnd: '08:00',
          vipOnly: false,
          vipSenders: '',
          mutedAccounts: '',
          priorityAccounts: '',
        },
        messages,
        new Date('2026-07-09T23:30:00'),
      ),
    ).toMatchObject({ body: null, reason: 'quiet-hours' });

    expect(
      newMailNotificationDecision(
        run,
        {
          quietHoursEnabled: true,
          quietStart: '22:00',
          quietEnd: '08:00',
          vipOnly: false,
          vipSenders: 'ada@example.com',
          mutedAccounts: '',
          priorityAccounts: '',
        },
        messages,
        new Date('2026-07-09T23:30:00'),
      ),
    ).toMatchObject({ reason: 'send', vipMatches: 1 });

    expect(
      newMailNotificationDecision(
        run,
        {
          quietHoursEnabled: false,
          quietStart: '22:00',
          quietEnd: '08:00',
          vipOnly: true,
          vipSenders: 'boss@example.com',
          mutedAccounts: '',
          priorityAccounts: '',
        },
        messages,
      ),
    ).toMatchObject({ body: null, reason: 'vip-only-no-match' });
  });

  it('applies per-account notification routing for multi-account mailboxes', () => {
    const run = {
      imported_messages: 3,
      finished_at: 'not-a-date',
      message: '统一同步完成',
    };
    const messages = [
      { account_id: 1, account_email: 'work@example.com', sender_name: 'PM', sender_email: 'pm@example.com', subject: 'Roadmap' },
      { account_id: 2, account_email: 'archive@example.com', sender_name: 'Robot', sender_email: 'bot@example.com', subject: 'Digest' },
      { account_id: 3, account_email: 'ops@example.com', sender_name: 'Ops', sender_email: 'ops@example.com', subject: 'Alert' },
    ];

    expect(
      newMailNotificationDecision(
        run,
        {
          quietHoursEnabled: true,
          quietStart: '22:00',
          quietEnd: '08:00',
          vipOnly: false,
          vipSenders: '',
          mutedAccounts: 'archive@example.com',
          priorityAccounts: 'ops@example.com',
        },
        messages,
        new Date('2026-07-09T23:30:00'),
      ),
    ).toMatchObject({ reason: 'send', priorityMatches: 1, mutedMatches: 1 });

    expect(
      newMailNotificationDecision(
        { ...run, imported_messages: 1 },
        {
          quietHoursEnabled: false,
          quietStart: '22:00',
          quietEnd: '08:00',
          vipOnly: false,
          vipSenders: '',
          mutedAccounts: 'work@example.com',
          priorityAccounts: '',
        },
        messages,
      ),
    ).toMatchObject({ body: null, reason: 'account-muted', mutedMatches: 1 });
  });

  it('keeps provider presets aligned with the compatibility matrix', () => {
    expect(providerCompatibilityMatrix).toHaveLength(4);
    expect(providerPresets).toHaveLength(providerCompatibilityMatrix.length);
    expect(providerCompatibilityMatrix.every((provider) => provider.imap_host.includes(':'))).toBe(true);
    expect(providerCompatibilityMatrix.every((provider) => provider.smtp_host.includes(':'))).toBe(true);
    expect(providerCompatibilityMatrix.filter((provider) => provider.auth_type === 'oauth2').map((provider) => provider.id)).toEqual([
      'gmail',
      'outlook',
    ]);
    expect(providerCompatibilityMatrix.filter((provider) => provider.auth_type === 'password').map((provider) => provider.id)).toEqual([
      'qq',
      'netease',
    ]);
    expect(providerCompatibilityMatrix.find((provider) => provider.id === 'netease')?.tested_status).toBe('verified');
  });

  it('builds remote image trust inputs for senders and domains', () => {
    expect(senderDomain('Ada@Example.COM')).toBe('example.com');
    expect(remoteImageTrustInput(7, 'Ada@Example.COM', 'sender')).toEqual({
      account_id: 7,
      scope: 'sender',
      value: 'ada@example.com',
    });
    expect(remoteImageTrustInput(7, 'Ada@Example.COM', 'domain')).toEqual({
      account_id: 7,
      scope: 'domain',
      value: 'example.com',
    });
  });
});
