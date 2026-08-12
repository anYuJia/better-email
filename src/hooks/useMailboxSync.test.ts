import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useMailboxSync from './useMailboxSync';
import type { Folder, MessageSummary } from '../app/types';

vi.mock('../tauriBridge', () => ({
  invoke: vi.fn(),
  listen: vi.fn(() => Promise.resolve(() => undefined)),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

const folders: Folder[] = [
  { id: 101, account_id: 1, name: '收件箱', role: 'inbox', unread_count: 1, is_virtual: false },
  { id: 102, account_id: 1, name: '已发送', role: 'sent', unread_count: 0, is_virtual: false },
];

function renderSync({
  mailboxRefreshRef = { current: 5 },
  loadMeta = vi.fn(async () => ({ folderId: 101, folders })),
  loadMessagesWithVisibleFallback = vi.fn(async (): Promise<MessageSummary[]> => []),
  openThread = vi.fn(async (): Promise<MessageSummary[]> => []),
  setStatus = vi.fn(),
}: {
  mailboxRefreshRef?: { current: number };
  loadMeta?: ReturnType<typeof vi.fn>;
  loadMessagesWithVisibleFallback?: ReturnType<typeof vi.fn>;
  openThread?: ReturnType<typeof vi.fn>;
  setStatus?: ReturnType<typeof vi.fn>;
} = {}) {
  return renderHook(() => useMailboxSync({
    folderId: 101,
    accountScope: 1,
    searchScope: 'folder' as const,
    query: '',
    filter: 'all' as const,
    messageLimit: 50,
    mailboxListStateKey: '1|101||all|messages',
    activeThread: null,
    mailboxRefreshRef,
    loadMeta,
    loadMessagesWithVisibleFallback,
    openThread,
    setStatus,
  }));
}

describe('useMailboxSync', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('refreshAll aborts when the user navigates during a slow meta load', async () => {
    const mailboxRefreshRef = { current: 5 };
    const metaResponse = deferred<{ folderId: number | null; folders: Folder[] }>();
    const loadMeta = vi.fn(() => metaResponse.promise);
    const loadMessagesWithVisibleFallback = vi.fn(async () => []);
    const setStatus = vi.fn();
    const { result } = renderSync({ mailboxRefreshRef, loadMeta, loadMessagesWithVisibleFallback, setStatus });

    // A 文件夹的刷新在途（loadMeta 慢）。
    let refresh!: Promise<void>;
    act(() => {
      refresh = result.current.refreshAll();
    });

    // 用户在刷新期间导航到 B 文件夹（selectFolder 递增 mailbox 世代）。
    mailboxRefreshRef.current += 1;
    await act(async () => {
      metaResponse.resolve({ folderId: 101, folders });
      await refresh;
    });

    // 旧刷新不得提交 A 的消息、也不得设置"已刷新"状态。
    expect(loadMessagesWithVisibleFallback).not.toHaveBeenCalled();
    expect(setStatus).not.toHaveBeenCalledWith('已刷新本地邮箱数据');
  });

  it('refreshAll commits when no navigation happens during the load', async () => {
    const mailboxRefreshRef = { current: 5 };
    const loadMessagesWithVisibleFallback = vi.fn(async (): Promise<MessageSummary[]> => []);
    const { result } = renderSync({ mailboxRefreshRef, loadMessagesWithVisibleFallback });

    await act(async () => {
      await result.current.refreshAll();
    });

    expect(loadMessagesWithVisibleFallback).toHaveBeenCalledTimes(1);
    // 传入的 refreshId 应是发起时的世代值，保证与调用方一致性。
    const callArgs = loadMessagesWithVisibleFallback.mock.calls[0] as unknown[];
    expect(callArgs[4]).toBe(5);
  });

  it('refreshAll commits after a slow meta load only when still on the same view', async () => {
    const mailboxRefreshRef = { current: 9 };
    const metaResponse = deferred<{ folderId: number | null; folders: Folder[] }>();
    const loadMeta = vi.fn(() => metaResponse.promise);
    const loadMessagesWithVisibleFallback = vi.fn(async () => []);
    const { result } = renderSync({ mailboxRefreshRef, loadMeta, loadMessagesWithVisibleFallback });

    let refresh!: Promise<void>;
    act(() => {
      refresh = result.current.refreshAll();
    });
    await act(async () => {
      metaResponse.resolve({ folderId: 101, folders });
      await refresh;
    });

    expect(loadMessagesWithVisibleFallback).toHaveBeenCalledTimes(1);
  });
});
