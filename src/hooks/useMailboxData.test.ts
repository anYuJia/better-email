import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { buildMailboxRequests } from './mailboxDataRequests';
import useMailboxData from './useMailboxData';
import { invoke } from '../tauriBridge';
import type { MessageSummary, ThreadSummary } from '../app/types';

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

  it('adds an offset only for subsequent stable pages', () => {
    expect(buildMailboxRequests(7, 7, 42, 'folder', '', 'all', 'newest', 199, 199).messages)
      .toMatchObject({ limit: 200, offset: 199 });
    expect(buildMailboxRequests(7, 7, 42, 'folder', '', 'all', 'newest', 199, 0).messages)
      .not.toHaveProperty('offset');
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

  it('does not let an older search response overwrite a newer search result', async () => {
    const firstSearchResponse = deferred<MessageSummary[]>();
    const secondSearchResponse = deferred<MessageSummary[]>();
    mockInvoke
      .mockImplementationOnce((() => firstSearchResponse.promise) as never)
      .mockImplementationOnce((() => secondSearchResponse.promise) as never);
    const mailboxRefreshRef = { current: 10 };
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
    const { result } = renderHook(() => useMailboxData({
      accountScope: 1,
      currentAccountId: 1,
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
    }));

    // 搜索 A（refreshId=11）慢、搜索 B（refreshId=12）快。
    let searchA!: Promise<MessageSummary[]>;
    let searchB!: Promise<MessageSummary[]>;
    await act(async () => {
      searchA = result.current.loadMessages(101, 'alpha', 'all', 1, 11, undefined, 'folder', false);
      await Promise.resolve();
    });
    mailboxRefreshRef.current = 12;
    await act(async () => {
      searchB = result.current.loadMessages(101, 'beta', 'all', 1, 12, undefined, 'folder', false);
      await Promise.resolve();
    });

    // B 先返回并提交。
    await act(async () => {
      secondSearchResponse.resolve([{ id: 2, subject: 'beta' } as MessageSummary]);
      await searchB;
    });
    expect(setters.setMessages).toHaveBeenCalledWith([{ id: 2, subject: 'beta' }]);

    // A 后返回：refreshId 已是 12，A 的 11 不再新鲜，不得覆盖 B。
    setters.setMessages.mockClear();
    setters.setHasMoreMessages.mockClear();
    setters.setSelectedId.mockClear();
    setters.setSelectedMessageIds.mockClear();
    setters.setThreads.mockClear();
    await act(async () => {
      firstSearchResponse.resolve([{ id: 1, subject: 'alpha' } as MessageSummary]);
      await searchA;
    });
    expect(setters.setMessages).not.toHaveBeenCalled();
    expect(setters.setHasMoreMessages).not.toHaveBeenCalled();
    expect(setters.setSelectedId).not.toHaveBeenCalled();
    expect(setters.setSelectedMessageIds).not.toHaveBeenCalled();
    expect(setters.setThreads).not.toHaveBeenCalled();
  });

  it('reuses cached threads for repeated toggles in one mailbox context', async () => {
    mockInvoke.mockResolvedValue([{ thread_key: 'thread-1' }] as never);
    const setThreads = vi.fn();
    const mailboxRefreshRef = { current: 3 };
    const { result } = renderHook(() => useMailboxData({
      accountScope: 1,
      currentAccountId: 1,
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
      setMessages: vi.fn(),
      setThreads,
      setMessageLimit: vi.fn(),
      setHasMoreMessages: vi.fn(),
      setSelectedId: vi.fn(),
      setSelectedMessageIds: vi.fn(),
      setFilter: vi.fn(),
      setStatus: vi.fn(),
    }));

    await act(async () => {
      await result.current.loadThreads();
      for (let index = 0; index < 30; index += 1) {
        await result.current.loadThreads();
      }
    });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(setThreads).toHaveBeenCalledTimes(31);
  });

  it('deduplicates an in-flight thread request and reuses its completed cache', async () => {
    const pending = deferred<ThreadSummary[]>();
    mockInvoke.mockReturnValue(pending.promise as never);
    const setThreads = vi.fn();
    const mailboxRefreshRef = { current: 3 };
    const { result } = renderHook(() => useMailboxData({
      accountScope: 1,
      currentAccountId: 1,
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
      setMessages: vi.fn(),
      setThreads,
      setMessageLimit: vi.fn(),
      setHasMoreMessages: vi.fn(),
      setSelectedId: vi.fn(),
      setSelectedMessageIds: vi.fn(),
      setFilter: vi.fn(),
      setStatus: vi.fn(),
    }));

    let first!: Promise<ThreadSummary[]>;
    let second!: Promise<ThreadSummary[]>;
    act(() => {
      first = result.current.loadThreads(101, '', 'all', 1, 3, 'folder');
      second = result.current.loadThreads(101, '', 'all', 1, 3, 'folder');
    });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    result.current.loadThreads.invalidate?.();
    let afterToggle!: Promise<ThreadSummary[]>;
    act(() => {
      afterToggle = result.current.loadThreads(101, '', 'all', 1, 3, 'folder');
    });
    expect(mockInvoke).toHaveBeenCalledTimes(1);

    const threads = [{
      thread_key: 'thread-1',
      subject: '主题',
      message_count: 2,
      unread_count: 1,
      latest_at: '2026-08-29T10:00:00Z',
      latest_preview: '预览',
      participants: '发件人',
      is_muted: false,
    }];
    pending.resolve(threads);
    await act(async () => {
      await first;
      await second;
      await afterToggle;
    });
    expect(mockInvoke).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.loadThreads(101, '', 'all', 1, 3, 'folder');
    });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('does not commit a late thread result after mailboxRefreshRef changes', async () => {
    const pending = deferred<ThreadSummary[]>();
    mockInvoke.mockReturnValue(pending.promise as never);
    const setThreads = vi.fn();
    const mailboxRefreshRef = { current: 3 };
    const { result } = renderHook(() => useMailboxData({
      accountScope: 1,
      currentAccountId: 1,
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
      setMessages: vi.fn(),
      setThreads,
      setMessageLimit: vi.fn(),
      setHasMoreMessages: vi.fn(),
      setSelectedId: vi.fn(),
      setSelectedMessageIds: vi.fn(),
      setFilter: vi.fn(),
      setStatus: vi.fn(),
    }));

    let loading!: Promise<ThreadSummary[]>;
    act(() => {
      loading = result.current.loadThreads(101, '', 'all', 1, 3, 'folder');
    });
    mailboxRefreshRef.current = 4;
    pending.resolve([]);
    await act(async () => { await loading; });
    expect(setThreads).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.loadThreads(101, '', 'all', 1, 4, 'folder');
    });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(setThreads).toHaveBeenCalledWith([]);
  });

  it('merges a subsequent page from an imperative buffer before React commits', async () => {
    const setMessages = vi.fn();
    mockInvoke.mockImplementation((command, args) => {
      if (command !== 'list_messages') return Promise.resolve(undefined) as never;
      const offset = Number(args?.offset ?? 0);
      return Promise.resolve([
        { id: offset + 1, received_at: `2026-08-09T00:00:0${offset}Z` },
        { id: offset + 2, received_at: `2026-08-08T00:00:0${offset}Z` },
      ] as MessageSummary[]) as never;
    });
    const mailboxRefreshRef = { current: 9 };
    const { result } = renderHook(() => useMailboxData({
      accountScope: 1,
      currentAccountId: 1,
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
      messages: [],
      setMessages,
      setThreads: vi.fn(),
      setMessageLimit: vi.fn(),
      setHasMoreMessages: vi.fn(),
      setSelectedId: vi.fn(),
      setSelectedMessageIds: vi.fn(),
      setFilter: vi.fn(),
      setStatus: vi.fn(),
    }));

    await act(async () => {
      await result.current.loadMessages(101, '', 'all', 1, 9, 1, 'folder', false);
      await result.current.loadMessages(101, '', 'all', 1, 9, 1, 'folder', false, undefined, 1);
    });
    expect(setMessages).toHaveBeenNthCalledWith(1, [{ id: 1, received_at: '2026-08-09T00:00:00Z' }]);
    expect(setMessages).toHaveBeenNthCalledWith(2, [
      { id: 1, received_at: '2026-08-09T00:00:00Z' },
      { id: 2, received_at: '2026-08-09T00:00:01Z' },
    ]);
  });
});
