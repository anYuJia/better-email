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
  it('uses the exact selected folder/search result count instead of account-wide stats', () => {
    expect(buildTitlebarViewSummary('messages', stats, 1, 50)).toBe('50 封');
  });

  it('does not use the account-wide total while the scoped count is loading', () => {
    expect(buildTitlebarViewSummary('messages', null, 1)).toBeUndefined();
    expect(buildTitlebarViewSummary('messages', stats, 1)).toBeUndefined();
  });

  it('keeps the conversation summary for conversation mode', () => {
    expect(buildTitlebarViewSummary('threads', stats, 4)).toBe('4 个会话');
  });
});
