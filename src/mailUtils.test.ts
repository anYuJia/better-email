import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatDate,
  messageDateGroup,
  mailboxListPreview,
  newMailNotificationDecision,
  newMailNotificationBody,
  notificationThreadScopeKey,
  prefixedSubject,
  plainTextPreview,
  quoteMessage,
  replyThreadingHeaders,
  remoteImageTrustInput,
  senderDomain,
  syncIntervalMs,
  syncStatusLabel,
  bodyLooksLikeHtml,
  htmlHasRenderableContent,
  htmlHasRemoteVisualContent,
} from './mailUtils';
import { providerCompatibilityMatrix, providerPresets } from './providerCatalog';

describe('mail UI utilities', () => {
  it('formats invalid dates without destroying the source value', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });

  it('groups message dates into stable mailbox sections', () => {
    const now = new Date('2026-07-11T14:30:00+08:00');

    expect(messageDateGroup('2026-07-11T01:00:00+08:00', now)).toEqual({ id: 'today', label: '今天' });
    expect(messageDateGroup('2026-07-10T23:59:00+08:00', now)).toEqual({ id: 'yesterday', label: '昨天' });
    expect(messageDateGroup('2026-07-08T12:00:00+08:00', now)).toEqual({
      id: 'this-week',
      label: '本周早些时候',
    });
    expect(messageDateGroup('2026-06-30T12:00:00+08:00', now)).toEqual({ id: 'earlier', label: '更早' });
    expect(messageDateGroup('not-a-date', now)).toEqual({ id: 'unknown', label: '时间未知' });
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

  it('cleans raw and escaped HTML from mailbox list previews', () => {
    expect(plainTextPreview('<!doctype html><html><body><div style="font-family: system-ui;">你好&nbsp;世界</div></body></html>'))
      .toBe('你好 世界');
    expect(plainTextPreview('&lt;div style=&quot;font-family: system-ui;&quot;&gt;周雪莹王欣答辩PPT&lt;/div&gt;'))
      .toBe('周雪莹王欣答辩PPT');
    expect(plainTextPreview('<script>alert(1)</script><p>正文</p>')).toBe('正文');
  });

  it('builds mailbox previews without showing remote-header placeholders', () => {
    expect(mailboxListPreview({
      body: '<p>完整正文</p>',
      sanitized_html: '',
      snippet: '短摘要',
    })).toBe('完整正文');
    expect(mailboxListPreview({
      body: '',
      sanitized_html: '&lt;p&gt;安全正文&lt;/p&gt;',
      snippet: '短摘要',
    })).toBe('安全正文');
    expect(mailboxListPreview({
      body: '',
      sanitized_html: '',
      snippet: '远端邮件头已同步，打开邮件后自动获取正文。',
    })).toBe('');
    expect(mailboxListPreview({
      body: '',
      sanitized_html: '',
      snippet: '普通摘要',
    })).toBe('普通摘要');
    expect(mailboxListPreview({
      body: '',
      sanitized_html: '',
      snippet: '!doctype html',
    })).toBe('');
    expect(mailboxListPreview({
      body: '',
      sanitized_html: '',
      snippet: 'div style="font-family: -apple-system, system-ui;"',
    })).toBe('');
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

    const htmlQuoted = quoteMessage({
      sender_name: 'Security',
      sender_email: 'security@example.com',
      received_at: 'bad-date',
      subject: 'HTML message',
      body: '<p>Rendered body</p><img src="https://example.com/open.png">',
      snippet: 'Rendered body',
    });
    expect(htmlQuoted).toContain('> Rendered body');
    expect(htmlQuoted).not.toContain('<img');
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
    expect(syncIntervalMs('1min')).toBe(60 * 1000);
    expect(syncIntervalMs('5min')).toBe(5 * 60 * 1000);
    expect(syncIntervalMs('15min')).toBe(15 * 60 * 1000);
    expect(syncIntervalMs('30min')).toBe(30 * 60 * 1000);
    expect(syncIntervalMs('60min')).toBe(60 * 60 * 1000);
    expect(syncIntervalMs('push')).toBe(5 * 60 * 1000);
    expect(syncIntervalMs('2min')).toBeNull();
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

  it('filters muted threads by account and reports only active notification mail', () => {
    const run = {
      imported_messages: 2,
      finished_at: 'not-a-date',
      message: '统一同步完成',
    };
    const messages = [
      {
        account_id: 1,
        account_email: 'work@example.com',
        thread_key: 'msgid:<shared@example.com>',
        sender_name: 'Work Robot',
        sender_email: 'robot@example.com',
        subject: 'Muted work digest',
      },
      {
        account_id: 2,
        account_email: 'personal@example.com',
        thread_key: 'msgid:<shared@example.com>',
        sender_name: 'Personal Robot',
        sender_email: 'robot@example.com',
        subject: 'Visible personal digest',
      },
    ];
    const mutedScope = notificationThreadScopeKey(messages[0]);

    expect(mutedScope).toBe('1:msgid:<shared@example.com>');
    expect(
      newMailNotificationDecision(
        run,
        undefined,
        messages,
        new Date('2026-07-11T10:00:00'),
        [mutedScope],
      ),
    ).toMatchObject({
      body: '已同步 1 封新邮件',
      reason: 'send',
      threadMutedMatches: 1,
    });
    expect(
      newMailNotificationDecision(
        { ...run, imported_messages: 1 },
        undefined,
        messages,
        new Date('2026-07-11T10:00:00'),
        [mutedScope],
      ),
    ).toMatchObject({
      body: null,
      reason: 'thread-muted',
      threadMutedMatches: 1,
    });
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

  describe('HTML and remote image visual content detection', () => {
    it('detects if body looks like HTML', () => {
      expect(bodyLooksLikeHtml('plain text')).toBe(false);
      expect(bodyLooksLikeHtml('<p>html paragraph</p>')).toBe(true);
      expect(bodyLooksLikeHtml('<!DOCTYPE html><html>')).toBe(true);
    });

    it('detects if HTML has renderable content', () => {
      expect(htmlHasRenderableContent('<img src="cid:abc">')).toBe(true);
      expect(htmlHasRenderableContent('   ')).toBe(false);
      expect(htmlHasRenderableContent('some text')).toBe(true);
      expect(htmlHasRenderableContent('<div>   </div>')).toBe(false);
    });

    it('detects if HTML has remote visual content like td background or css background-image', () => {
      // img src
      expect(htmlHasRemoteVisualContent('<img src="https://example.com/a.png">')).toBe(true);
      // source src
      expect(htmlHasRemoteVisualContent('<source src="https://example.com/a.png">')).toBe(true);
      // td background
      expect(htmlHasRemoteVisualContent('<td background="https://example.com/bg.png"></td>')).toBe(true);
      // inline css background-image
      expect(htmlHasRemoteVisualContent('<div style="background-image: url(\'https://example.com/bg.png\')"></div>')).toBe(true);
      expect(htmlHasRemoteVisualContent('<div style="background: url(\'https://example.com/bg.png\')"></div>')).toBe(true);
      // negative cases
      expect(htmlHasRemoteVisualContent('<img src="cid:local.png">')).toBe(false);
      expect(htmlHasRemoteVisualContent('<img src="/local/path.png">')).toBe(false);
    });
  });
});
