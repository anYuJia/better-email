import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { buildMailboxRequests } from './mailboxDataRequests';
import useMailboxData from './useMailboxData';
import { invoke } from '../tauriBridge';
import type { MessageSummary } from '../app/types';

vi.mock('../tauriBridge', () => ({
  invoke: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  mockInvoke.mockReset();
});

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

  it('keeps empty current-account search scoped to the selected folder', () => {
    expect(buildMailboxRequests(7, 7, 4, 'account', '   ', 'all', 'newest', 40)).toEqual({
      messages: {
        accountId: 7,
        folderId: 4,
        query: null,
        filter: 'all',
        sort: 'newest',
        limit: 41,
      },
      threads: {
        accountId: 7,
        folderId: 4,
        query: null,
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

  it('keeps empty global search scoped to the selected folder', () => {
    expect(buildMailboxRequests(7, 7, 42, 'all', '', 'starred', 'subject', 40)).toEqual({
      messages: {
        accountId: 7,
        folderId: 42,
        query: null,
        filter: 'starred',
        sort: 'subject',
        limit: 41,
      },
      threads: {
        accountId: 7,
        folderId: 42,
        query: null,
        filter: 'starred',
        sort: 'subject',
        limit: 80,
      },
    });
  });
});

describe('useMailboxData request guard', () => {
  it('does not commit an A message response after the mailbox has switched to B', async () => {
    const messagesResponse = deferred<MessageSummary[]>();
    mockInvoke.mockImplementation((() => messagesResponse.promise) as never);
    const mailboxRefreshRef = { current: 4 };
    const setters = {
      setMessages: vi.fn(),
      setThreads: vi.fn(),
      setMessageLimit: vi.fn(),
      setHasMoreMessages: vi.fn(),
      setSelectedId: vi.fn(),
      setSelectedMessageIds: vi.fn(),
      setFilter: vi.fn(),
      setStatus: vi.fn(),
    };
    const { result, rerender } = renderHook(
      ({ activeAccountScope }: { activeAccountScope: number | 'all' }) => useMailboxData({
        accountScope: activeAccountScope,
        currentAccountId: activeAccountScope === 'all' ? null : activeAccountScope,
        folderId: 101,
        searchScope: 'folder',
        query: '',
        filter: 'all',
        listMode: 'messages',
        listSort: 'newest',
        folders: [],
        imapMailboxes: [],
        mailboxRefreshRef,
        loadMeta: vi.fn().mockResolvedValue({ folderId: 101, folders: [] }),
        maybeRunBenchmarkSync: vi.fn().mockResolvedValue(undefined),
        ...setters,
      }),
      { initialProps: { activeAccountScope: 1 } },
    );

    let loading!: Promise<MessageSummary[]>;
    await act(async () => {
      loading = result.current.loadMessages(
        101,
        '',
        'all',
        1,
        4,
        undefined,
        'folder',
        false,
        { id: 4, scope: 1 },
      );
      await Promise.resolve();
    });

    mailboxRefreshRef.current += 1;
    rerender({ activeAccountScope: 2 });
    await act(async () => {
      messagesResponse.resolve([]);
      await loading;
    });

    expect(setters.setMessages).not.toHaveBeenCalled();
    expect(setters.setThreads).not.toHaveBeenCalled();
    expect(setters.setSelectedId).not.toHaveBeenCalled();
    expect(setters.setSelectedMessageIds).not.toHaveBeenCalled();
  });
});
