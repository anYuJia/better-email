import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { messagePageSize } from '../app/appConfig';
import type { MessageSummary } from '../app/types';
import useMailboxBootstrap from './useMailboxBootstrap';

type BootstrapProps = {
  accountScope: number | 'all';
  folderId: number | null;
  filter: 'all' | 'unread';
  listSort: 'newest' | 'oldest';
};

function renderBootstrap({
  initialProps = {
    accountScope: 'all',
    folderId: null,
    filter: 'all',
    listSort: 'newest',
  },
  strict = false,
}: {
  initialProps?: BootstrapProps;
  strict?: boolean;
} = {}) {
  const mailboxRefreshRef = { current: 0 };
  const navigationScopeClaimRef: { current: number | 'all' | null } = { current: null };
  const skipNextFolderEffectLoadRef = { current: false };
  const refreshMailbox = vi.fn(async () => 101);
  const loadMessages = vi.fn(async (): Promise<MessageSummary[]> => []);
  const setAccountScope = vi.fn();
  const setStatus = vi.fn();
  const wrapper = strict ? StrictMode : undefined;
  const hook = renderHook(
    (props: BootstrapProps) => useMailboxBootstrap({
      ...props,
      appliedQuery: 'invoice',
      mailboxListStateKey: 'scope=all|folder=101|query=invoice',
      mailboxRefreshRef,
      navigationScopeClaimRef,
      skipNextFolderEffectLoadRef,
      refreshMailbox,
      loadMessages,
      setAccountScope,
      setStatus,
    }),
    { initialProps, wrapper },
  );
  return {
    ...hook,
    mailboxRefreshRef,
    navigationScopeClaimRef,
    skipNextFolderEffectLoadRef,
    refreshMailbox,
    loadMessages,
    setAccountScope,
    setStatus,
  };
}

describe('useMailboxBootstrap', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it('claims a scope once when StrictMode replays mount effects', () => {
    const { refreshMailbox } = renderBootstrap({ strict: true });
    expect(refreshMailbox).toHaveBeenCalledTimes(1);
    expect(refreshMailbox).toHaveBeenCalledWith('all', null);
  });

  it('lets refreshMailbox own the folder produced by bootstrap', () => {
    const {
      rerender,
      loadMessages,
      skipNextFolderEffectLoadRef,
    } = renderBootstrap();

    expect(skipNextFolderEffectLoadRef.current).toBe(true);
    rerender({
      accountScope: 'all',
      folderId: 101,
      filter: 'all',
      listSort: 'newest',
    });

    expect(loadMessages).not.toHaveBeenCalled();
    expect(skipNextFolderEffectLoadRef.current).toBe(false);
  });

  it('loads exactly once for the next explicit folder or filter change', () => {
    const { rerender, loadMessages, mailboxRefreshRef } = renderBootstrap();
    mailboxRefreshRef.current = 4;

    rerender({
      accountScope: 'all',
      folderId: 101,
      filter: 'all',
      listSort: 'newest',
    });
    rerender({
      accountScope: 'all',
      folderId: 101,
      filter: 'unread',
      listSort: 'newest',
    });

    expect(loadMessages).toHaveBeenCalledTimes(1);
    expect(loadMessages).toHaveBeenCalledWith(
      101,
      'invoice',
      'unread',
      'all',
      4,
      messagePageSize,
    );
  });

  it('replaces a stale load-more announcement after an empty folder loads', async () => {
    const {
      rerender,
      loadMessages,
      mailboxRefreshRef,
      setStatus,
    } = renderBootstrap();
    mailboxRefreshRef.current = 4;

    // Consume the bootstrap-owned folder update first.
    rerender({
      accountScope: 'all',
      folderId: 101,
      filter: 'all',
      listSort: 'newest',
    });
    setStatus('已加载 50 封邮件');
    loadMessages.mockResolvedValueOnce([]);

    rerender({
      accountScope: 'all',
      folderId: 202,
      filter: 'all',
      listSort: 'newest',
    });
    await act(async () => undefined);

    expect(loadMessages).toHaveBeenLastCalledWith(
      202,
      'invoice',
      'all',
      'all',
      4,
      messagePageSize,
    );
    expect(setStatus).toHaveBeenLastCalledWith('当前文件夹暂无邮件');
  });

  it('does not let a slower previous folder overwrite the current status', async () => {
    let resolveSlowFolder: ((messages: MessageSummary[]) => void) | undefined;
    let resolveCurrentFolder: ((messages: MessageSummary[]) => void) | undefined;
    const {
      rerender,
      loadMessages,
      mailboxRefreshRef,
      setStatus,
    } = renderBootstrap();
    mailboxRefreshRef.current = 4;

    // Consume the bootstrap-owned folder update, then control two explicit
    // folder loads that share the same mailbox generation.
    rerender({
      accountScope: 'all',
      folderId: 101,
      filter: 'all',
      listSort: 'newest',
    });
    loadMessages
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveSlowFolder = resolve;
      }))
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveCurrentFolder = resolve;
      }));

    rerender({
      accountScope: 'all',
      folderId: 202,
      filter: 'all',
      listSort: 'newest',
    });
    rerender({
      accountScope: 'all',
      folderId: 303,
      filter: 'all',
      listSort: 'newest',
    });

    await act(async () => {
      resolveCurrentFolder?.([]);
    });
    expect(setStatus).toHaveBeenLastCalledWith('当前文件夹暂无邮件');

    await act(async () => {
      resolveSlowFolder?.([{} as MessageSummary]);
    });
    expect(setStatus).toHaveBeenCalledTimes(1);
    expect(setStatus).toHaveBeenLastCalledWith('当前文件夹暂无邮件');
  });

  it('releases the bootstrap claim when a new scope resolves to the current folder', async () => {
    const {
      rerender,
      loadMessages,
      skipNextFolderEffectLoadRef,
    } = renderBootstrap({
      initialProps: {
        accountScope: 'all',
        folderId: 101,
        filter: 'all',
        listSort: 'newest',
      },
    });

    await act(async () => undefined);
    loadMessages.mockClear();

    rerender({
      accountScope: 7,
      folderId: 101,
      filter: 'all',
      listSort: 'newest',
    });
    expect(skipNextFolderEffectLoadRef.current).toBe(true);

    await act(async () => undefined);
    expect(skipNextFolderEffectLoadRef.current).toBe(false);

    rerender({
      accountScope: 7,
      folderId: 101,
      filter: 'unread',
      listSort: 'newest',
    });
    expect(loadMessages).toHaveBeenCalledTimes(1);
    expect(loadMessages).toHaveBeenCalledWith(
      101,
      'invoice',
      'unread',
      7,
      0,
      messagePageSize,
    );
  });

  it('does not bootstrap a scope already claimed by navigation', () => {
    const navigationScopeClaimRef: { current: number | 'all' | null } = { current: 'all' };
    const refreshMailbox = vi.fn(async () => 101);
    renderHook(() => useMailboxBootstrap({
      accountScope: 'all',
      folderId: null,
      appliedQuery: '',
      filter: 'all',
      listSort: 'newest',
      mailboxListStateKey: 'all',
      mailboxRefreshRef: { current: 0 },
      navigationScopeClaimRef,
      skipNextFolderEffectLoadRef: { current: false },
      refreshMailbox,
      loadMessages: vi.fn(async () => []),
      setAccountScope: vi.fn(),
      setStatus: vi.fn(),
    }));
    expect(refreshMailbox).not.toHaveBeenCalled();
  });

  it('falls back from a removed account and releases the folder claim on failure', async () => {
    const refreshMailbox = vi.fn(async () => {
      throw new Error('missing account');
    });
    const setAccountScope = vi.fn();
    const skipNextFolderEffectLoadRef = { current: false };

    renderHook(() => useMailboxBootstrap({
      accountScope: 7,
      folderId: null,
      appliedQuery: '',
      filter: 'all',
      listSort: 'newest',
      mailboxListStateKey: 'account=7',
      mailboxRefreshRef: { current: 0 },
      navigationScopeClaimRef: { current: null },
      skipNextFolderEffectLoadRef,
      refreshMailbox,
      loadMessages: vi.fn(async () => []),
      setAccountScope,
      setStatus: vi.fn(),
    }));

    await act(async () => undefined);
    expect(setAccountScope).toHaveBeenCalledWith('all');
    expect(skipNextFolderEffectLoadRef.current).toBe(false);
  });
});
