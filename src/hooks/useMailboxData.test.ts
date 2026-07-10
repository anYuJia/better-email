import { describe, expect, it } from 'vitest';
import { buildMailboxRequests } from './useMailboxData';

describe('buildMailboxRequests', () => {
  it('keeps message and thread queries in the same scoped mailbox view', () => {
    expect(buildMailboxRequests(7, 42, '  subject:Roadmap  ', 'unread', 50)).toEqual({
      messages: {
        accountId: 7,
        folderId: 42,
        query: 'subject:Roadmap',
        filter: 'unread',
        limit: 51,
      },
      threads: {
        accountId: 7,
        folderId: 42,
        query: 'subject:Roadmap',
        filter: 'unread',
        limit: 80,
      },
    });
  });

  it('uses a null account and query for unified unfiltered views', () => {
    expect(buildMailboxRequests('all', -1, '   ', 'all', 25)).toEqual({
      messages: {
        accountId: null,
        folderId: -1,
        query: null,
        filter: 'all',
        limit: 26,
      },
      threads: {
        accountId: null,
        folderId: -1,
        query: null,
        filter: 'all',
        limit: 80,
      },
    });
  });
});
