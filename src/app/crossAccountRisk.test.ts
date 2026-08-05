import { describe, expect, it } from 'vitest';
import { analyzeCrossAccountRisks, riskSummary } from './crossAccountRisk';
import type { Account } from './types/account';
import type { DraftInput } from './types/composer';
import { emptyDraft } from './composerConfig';

const demoAccount: Account = {
  id: 1,
  email: 'demo@better-email.local',
  display_name: 'Demo',
  provider: 'gmail',
  imap_host: 'imap.gmail.com:993',
  smtp_host: 'smtp.gmail.com:587',
  incoming_protocol: 'imap',
  auth_type: 'oauth2',
  sync_mode: 'manual',
  remote_images_allowed: false,
  signature: '',
  cross_account_risk_warning: true,
  is_default: true,
};

const designAccount: Account = {
  ...demoAccount,
  id: 2,
  email: 'design@better-email.local',
  display_name: 'Design',
  is_default: false,
};

function draftFor(accountId: number, to = 'ada@example.com'): DraftInput {
  return { ...emptyDraft, account_id: accountId, to };
}

describe('cross account risk analysis', () => {
  it('flags replying to another account message', () => {
    const risks = analyzeCrossAccountRisks(
      draftFor(2),
      [demoAccount, designAccount],
      { originalMessageAccountId: 1, contextAccountId: null },
    );
    expect(risks.some((risk) => risk.id === 'reply-account-mismatch')).toBe(true);
  });

  it('does not flag replying with the original account', () => {
    const risks = analyzeCrossAccountRisks(
      draftFor(1),
      [demoAccount, designAccount],
      { originalMessageAccountId: 1, contextAccountId: null },
    );
    expect(risks).toEqual([]);
  });

  it('flags recipients containing another own account address', () => {
    const risks = analyzeCrossAccountRisks(
      { ...draftFor(1), to: 'design@better-email.local' },
      [demoAccount, designAccount],
      { originalMessageAccountId: null, contextAccountId: null },
    );
    expect(risks.some((risk) => risk.id === 'self-recipient-other-account')).toBe(true);
  });

  it('flags context account mismatch from templates', () => {
    const risks = analyzeCrossAccountRisks(
      draftFor(1),
      [demoAccount, designAccount],
      { originalMessageAccountId: null, contextAccountId: 2 },
    );
    expect(risks.some((risk) => risk.id === 'context-account-mismatch')).toBe(true);
  });

  it('respects the per-account toggle', () => {
    const disabledAccount = { ...designAccount, cross_account_risk_warning: false };
    const risks = analyzeCrossAccountRisks(
      draftFor(2),
      [demoAccount, disabledAccount],
      { originalMessageAccountId: 1, contextAccountId: null },
    );
    expect(risks).toEqual([]);
  });

  it('does not disturb single-account users', () => {
    const risks = analyzeCrossAccountRisks(
      draftFor(1),
      [demoAccount],
      { originalMessageAccountId: null, contextAccountId: null },
    );
    expect(risks).toEqual([]);
  });

  it('checks cc and bcc too', () => {
    const risks = analyzeCrossAccountRisks(
      { ...draftFor(1), cc: 'someone@example.com', bcc: 'design@better-email.local' },
      [demoAccount, designAccount],
      { originalMessageAccountId: null, contextAccountId: null },
    );
    expect(risks.some((risk) => risk.id === 'self-recipient-other-account')).toBe(true);
  });

  it('summarizes risks into a readable string', () => {
    const risks = analyzeCrossAccountRisks(
      draftFor(2),
      [demoAccount, designAccount],
      { originalMessageAccountId: 1, contextAccountId: null },
    );
    expect(riskSummary(risks)).toContain('正在回复其他账号的邮件');
  });
});
