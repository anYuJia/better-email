import { describe, expect, it } from 'vitest';
import { buildMailboxRequests } from './useMailboxData';

describe('buildMailboxRequests', () => {
  it('keeps message and thread queries in the same scoped mailbox view', () => {
    expect(buildMailboxRequests(7, 7, 42, 'folder', '  subject:Roadmap  ', 'unread', 'sender', 50)).toEqual({
      messages: {
        accountId: 7,
        folderId: 42,
        query: 'subject:Roadmap',
        filter: 'unread',
        sort: 'sender',
        limit: 51,
      },
      threads: {
        accountId: 7,
        folderId: 42,
        query: 'subject:Roadmap',
        filter: 'unread',
        sort: 'sender',
        limit: 80,
      },
    });
  });

  it('uses a null account and query for unified unfiltered views', () => {
    expect(buildMailboxRequests('all', 7, -1, 'folder', '   ', 'all', 'newest', 25)).toEqual({
      messages: {
        accountId: null,
        folderId: -1,
        query: null,
        filter: 'all',
        sort: 'newest',
        limit: 26,
      },
      threads: {
        accountId: null,
        folderId: -1,
        query: null,
        filter: 'all',
        sort: 'newest',
        limit: 80,
      },
    });
  });

  it('removes the folder constraint for current-account search', () => {
    expect(buildMailboxRequests('all', 7, -1, 'account', 'invoice', 'all', 'newest', 40)).toEqual({
      messages: {
        accountId: 7,
        folderId: null,
        query: 'invoice',
        filter: 'all',
        sort: 'newest',
        limit: 41,
      },
      threads: {
        accountId: 7,
        folderId: null,
        query: 'invoice',
        filter: 'all',
        sort: 'newest',
        limit: 80,
      },
    });
  });

  it('removes both account and folder constraints for global search', () => {
    expect(buildMailboxRequests(7, 7, 42, 'all', 'roadmap', 'starred', 'subject', 40)).toEqual({
      messages: {
        accountId: null,
        folderId: null,
        query: 'roadmap',
        filter: 'starred',
        sort: 'subject',
        limit: 41,
      },
      threads: {
        accountId: null,
        folderId: null,
        query: 'roadmap',
        filter: 'starred',
        sort: 'subject',
        limit: 80,
      },
    });
  });
});
