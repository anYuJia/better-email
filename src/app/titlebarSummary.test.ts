import { describe, expect, it } from 'vitest';
import { buildTitlebarViewSummary } from './titlebarSummary';
import type { MailStats } from './types';

const stats: MailStats = {
  total_messages: 93,
  unread_messages: 16,
  starred_messages: 0,
  draft_messages: 0,
  attachment_messages: 0,
};

describe('buildTitlebarViewSummary', () => {
  it('uses the account-scoped total instead of the selected folder list size', () => {
    expect(buildTitlebarViewSummary('messages', stats, 1)).toBe('93 封');
  });

  it('does not show a folder-sized fallback while the account total is loading', () => {
    expect(buildTitlebarViewSummary('messages', null, 1)).toBeUndefined();
  });

  it('keeps the conversation summary for conversation mode', () => {
    expect(buildTitlebarViewSummary('threads', stats, 4)).toBe('4 个会话');
  });
});
